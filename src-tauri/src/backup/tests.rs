//! Tests for the backup module: the three import modes, the file rules, the archive round trip.

use std::{
  collections::HashSet,
  fs,
  io::Write,
  path::{Path, PathBuf},
  sync::atomic::Ordering,
};

use serde_json::json;
use sqlx::{
  SqlitePool,
  sqlite::{SqliteConnectOptions, SqliteJournalMode},
};

use super::archive::{unpack, write_archive};
use super::db::{BackupData, merge_db, read_backup_db, replace_db};
use super::files::apply_files;
use super::names::{Entry, classify, isbn_key};
use super::{ImportMode, ImportReport};

fn temp_dir(tag: &str) -> PathBuf {
  static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
  let n = NEXT.fetch_add(1, Ordering::Relaxed);
  let dir = std::env::temp_dir().join(format!("free-lib-backup-{tag}-{}-{n}", std::process::id()));
  let _ = fs::remove_dir_all(&dir);
  fs::create_dir_all(&dir).unwrap();
  dir
}

async fn migrated_pool(path: &Path) -> SqlitePool {
  let opts = SqliteConnectOptions::new()
    .filename(path)
    .create_if_missing(true)
    .journal_mode(SqliteJournalMode::Wal)
    .foreign_keys(true);
  let pool = SqlitePool::connect_with(opts).await.unwrap();
  sqlx::migrate!().run(&pool).await.unwrap();
  pool
}

async fn add_book(pool: &SqlitePool, title: &str, isbn: Option<&str>, author: &str, notes: &str) {
  let author_id: i64 = match sqlx::query_scalar("SELECT author_id FROM author WHERE name = ?")
    .bind(author)
    .fetch_optional(pool)
    .await
    .unwrap()
  {
    Some(id) => id,
    None => sqlx::query_scalar("INSERT INTO author (name) VALUES (?) RETURNING author_id")
      .bind(author)
      .fetch_one(pool)
      .await
      .unwrap(),
  };
  let book_id: i64 = sqlx::query_scalar(
    "INSERT INTO book (title, isbn, blurb, notes) VALUES (?, ?, ?, ?) RETURNING book_id",
  )
  .bind(title)
  .bind(isbn)
  .bind(format!("blurb of {title}"))
  .bind(notes)
  .fetch_one(pool)
  .await
  .unwrap();
  sqlx::query("INSERT INTO book_author (book_id, author_id) VALUES (?, ?)")
    .bind(book_id)
    .bind(author_id)
    .execute(pool)
    .await
    .unwrap();
  sqlx::query("INSERT INTO reading (book_id, date_started) VALUES (?, '2024-01-01')")
    .bind(book_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn add_category(pool: &SqlitePool, isbn: &str, name: &str, color: &str) {
  let category_id: i64 = match sqlx::query_scalar("SELECT category_id FROM category WHERE name = ?")
    .bind(name)
    .fetch_optional(pool)
    .await
    .unwrap()
  {
    Some(id) => id,
    None => sqlx::query_scalar("INSERT INTO category (name, color) VALUES (?, ?) RETURNING category_id")
      .bind(name)
      .bind(color)
      .fetch_one(pool)
      .await
      .unwrap(),
  };
  sqlx::query(
    "INSERT INTO book_category (book_id, category_id)
     SELECT book_id, ? FROM book WHERE isbn = ?",
  )
  .bind(category_id)
  .bind(isbn)
  .execute(pool)
  .await
  .unwrap();
}

async fn categories_of(pool: &SqlitePool, isbn: &str) -> Vec<(String, String)> {
  sqlx::query_as(
    "SELECT c.name, c.color FROM category c
     JOIN book_category bc USING (category_id) JOIN book b USING (book_id)
     WHERE b.isbn = ? ORDER BY c.name",
  )
  .bind(isbn)
  .fetch_all(pool)
  .await
  .unwrap()
}

/// Host has Dune ("host version") and Emma. The backup has Dune ("backup version") and
/// Ulysses.
async fn scenario() -> (SqlitePool, BackupData) {
  let dir = temp_dir("db");
  let host = migrated_pool(&dir.join("host.sqlite")).await;
  add_book(
    &host,
    "Dune host",
    Some("9780441013593"),
    "Frank Herbert",
    "host notes",
  )
  .await;
  add_book(&host, "Emma", Some("9780141439587"), "Jane Austen", "").await;
  add_category(&host, "9780441013593", "Fiction", "#ff0000").await;
  add_category(&host, "9780141439587", "Romance", "#ff00ff").await;

  let other = migrated_pool(&dir.join("backup.sqlite")).await;
  add_book(
    &other,
    "Dune backup",
    Some("978-0-441-01359-3"),
    "frank herbert",
    "backup notes",
  )
  .await;
  add_book(&other, "Ulysses", Some("9780199535675"), "James Joyce", "").await;
  add_category(&other, "978-0-441-01359-3", "fiction", "#0000ff").await;
  add_category(&other, "978-0-441-01359-3", "Sci-Fi", "#00ff00").await;
  add_category(&other, "9780199535675", "Classics", "#123456").await;
  other.close().await;

  let data = read_backup_db(&dir.join("backup.sqlite")).await.unwrap();
  (host, data)
}

async fn titles(pool: &SqlitePool) -> Vec<String> {
  sqlx::query_scalar("SELECT title FROM book ORDER BY title")
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn notes_of(pool: &SqlitePool, isbn: &str) -> String {
  sqlx::query_scalar("SELECT notes FROM book WHERE isbn = ?")
    .bind(isbn)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[test]
fn append_merge_keeps_existing_books_and_adds_new_ones() {
  tauri::async_runtime::block_on(async {
    let (host, data) = scenario().await;
    let mut report = ImportReport::default();
    let existed = merge_db(&host, &data, false, &mut report).await.unwrap();

    assert_eq!(titles(&host).await, ["Dune host", "Emma", "Ulysses"]);
    assert_eq!(notes_of(&host, "9780441013593").await, "host notes");
    assert_eq!(
      (
        report.books_added,
        report.books_skipped,
        report.books_updated
      ),
      (1, 1, 0)
    );
    // "frank herbert" is the same author as "Frank Herbert": only Joyce is new
    assert_eq!(report.authors_added, 1);
    assert!(existed.contains("9780441013593") && existed.contains("9780141439587"));
    // the existing book's readings weren't doubled
    let n: i64 = sqlx::query_scalar(
      "SELECT COUNT(*) FROM reading r JOIN book b USING (book_id) WHERE b.title = 'Dune host'",
    )
    .fetch_one(&host)
    .await
    .unwrap();
    assert_eq!(n, 1);
  });
}

#[test]
fn override_merge_replaces_existing_books_with_the_backups_version() {
  tauri::async_runtime::block_on(async {
    let (host, data) = scenario().await;
    let mut report = ImportReport::default();
    merge_db(&host, &data, true, &mut report).await.unwrap();

    assert_eq!(titles(&host).await, ["Dune backup", "Emma", "Ulysses"]);
    assert_eq!(notes_of(&host, "9780441013593").await, "backup notes");
    assert_eq!(
      (
        report.books_added,
        report.books_skipped,
        report.books_updated
      ),
      (1, 0, 1)
    );
    // Emma was only here: untouched
    assert_eq!(notes_of(&host, "9780141439587").await, "");
    // links were replaced, not piled up
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM book_author ba JOIN book b USING (book_id) WHERE b.isbn = '9780441013593'")
      .fetch_one(&host)
      .await
      .unwrap();
    assert_eq!(n, 1);
  });
}

#[test]
fn full_replace_leaves_exactly_the_backup() {
  tauri::async_runtime::block_on(async {
    let (host, data) = scenario().await;
    let mut report = ImportReport::default();
    replace_db(&host, &data, &mut report).await.unwrap();
    assert_eq!(titles(&host).await, ["Dune backup", "Ulysses"]); // Emma is gone
    assert_eq!(report.books_added, 2);
    let types: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tag_type")
      .fetch_one(&host)
      .await
      .unwrap();
    assert_eq!(types, 3);
  });
}

#[test]
fn append_merge_adds_missing_categories_and_leaves_existing_books_alone() {
  tauri::async_runtime::block_on(async {
    let (host, data) = scenario().await;
    let mut report = ImportReport::default();
    merge_db(&host, &data, false, &mut report).await.unwrap();

    // "fiction" is the host's "Fiction": matched by name, color kept; Sci-Fi and Classics are new
    assert_eq!(report.categories_added, 2);
    // the existing Dune keeps exactly its own categories
    assert_eq!(
      categories_of(&host, "9780441013593").await,
      [("Fiction".to_string(), "#ff0000".to_string())]
    );
    // the new book arrives with its category
    assert_eq!(
      categories_of(&host, "9780199535675").await,
      [("Classics".to_string(), "#123456".to_string())]
    );
  });
}

#[test]
fn override_merge_replaces_categories_of_existing_books() {
  tauri::async_runtime::block_on(async {
    let (host, data) = scenario().await;
    let mut report = ImportReport::default();
    merge_db(&host, &data, true, &mut report).await.unwrap();

    // matched category takes the backup's color; Dune now has the backup's two categories
    assert_eq!(
      categories_of(&host, "9780441013593").await,
      [
        ("Fiction".to_string(), "#0000ff".to_string()),
        ("Sci-Fi".to_string(), "#00ff00".to_string()),
      ]
    );
    // Emma was only here: untouched
    assert_eq!(
      categories_of(&host, "9780141439587").await,
      [("Romance".to_string(), "#ff00ff".to_string())]
    );
  });
}

#[test]
fn full_replace_restores_categories_exactly() {
  tauri::async_runtime::block_on(async {
    let (host, data) = scenario().await;
    let mut report = ImportReport::default();
    replace_db(&host, &data, &mut report).await.unwrap();

    assert_eq!(report.categories_added, 3);
    let names: Vec<String> = sqlx::query_scalar("SELECT name FROM category ORDER BY name")
      .fetch_all(&host)
      .await
      .unwrap();
    assert_eq!(names, ["Classics", "Sci-Fi", "fiction"]); // the host's Romance is gone
    assert_eq!(categories_of(&host, "9780441013593").await.len(), 2);
    assert_eq!(categories_of(&host, "9780199535675").await.len(), 1);
  });
}

#[test]
fn archive_round_trip_and_cover_rules() {
  let data = temp_dir("rt-data");
  fs::create_dir_all(data.join("plugins")).unwrap();
  fs::create_dir_all(data.join("cover-images")).unwrap();
  fs::write(data.join("plugins/mine.js"), "// plugin").unwrap();
  fs::write(data.join("plugins/mine.config.json"), "{\"apiKey\":\"k\"}").unwrap();
  fs::write(data.join("plugins/notes.txt"), "not a plugin").unwrap();
  fs::write(
    data.join("cover-images/9780441013593.jpg"),
    b"\xFF\xD8\xFFbackup",
  )
  .unwrap();
  fs::write(data.join("cover-images/9780199535675.png"), b"png").unwrap();
  let snapshot = temp_dir("rt-snap").join("db.sqlite");
  tauri::async_runtime::block_on(async {
    migrated_pool(&snapshot).await.close().await;
  });
  let settings = json!({ "theme": "ocean" }).as_object().unwrap().clone();

  let zip_path = temp_dir("rt-out").join("b.zip");
  let (covers, plugin_files) = write_archive(
    fs::File::create(&zip_path).unwrap(),
    &data,
    &snapshot,
    &settings,
  )
  .unwrap();
  assert_eq!((covers, plugin_files), (2, 2)); // notes.txt isn't packed

  let staged = unpack(&zip_path, &temp_dir("rt-un")).unwrap();
  assert_eq!(staged.settings, settings);
  assert_eq!(staged.covers.len(), 2);
  assert_eq!(staged.plugin_files.len(), 2);

  // append merge into a folder that already has a cover for Dune but not for Ulysses
  let host = temp_dir("rt-host");
  fs::create_dir_all(host.join("cover-images")).unwrap();
  fs::write(host.join("cover-images/9780441013593.png"), b"host").unwrap();
  fs::create_dir_all(host.join("plugins")).unwrap();
  fs::write(host.join("plugins/mine.js"), "// host plugin").unwrap();
  let existed: HashSet<String> = ["9780441013593".to_string()].into();
  let mut report = ImportReport::default();
  apply_files(
    &host,
    &staged,
    ImportMode::AppendMerge,
    &existed,
    &mut report,
  )
  .unwrap();
  assert_eq!(
    fs::read(host.join("cover-images/9780441013593.png")).unwrap(),
    b"host"
  );
  assert!(!host.join("cover-images/9780441013593.jpg").exists());
  assert!(host.join("cover-images/9780199535675.png").exists());
  assert_eq!(
    fs::read_to_string(host.join("plugins/mine.js")).unwrap(),
    "// host plugin"
  );
  assert!(host.join("plugins/mine.config.json").exists());
  assert_eq!((report.covers_copied, report.plugin_files_copied), (1, 1));

  // override merge: the backup's cover replaces the host's, whatever its extension
  let mut report = ImportReport::default();
  apply_files(
    &host,
    &staged,
    ImportMode::OverrideMerge,
    &existed,
    &mut report,
  )
  .unwrap();
  assert!(!host.join("cover-images/9780441013593.png").exists());
  assert!(host.join("cover-images/9780441013593.jpg").exists());
  assert_eq!(
    fs::read_to_string(host.join("plugins/mine.js")).unwrap(),
    "// plugin"
  );

  // full replace wipes what the backup doesn't have
  fs::write(host.join("cover-images/9780141439587.jpg"), b"only here").unwrap();
  let mut report = ImportReport::default();
  apply_files(
    &host,
    &staged,
    ImportMode::FullReplace,
    &HashSet::new(),
    &mut report,
  )
  .unwrap();
  assert!(!host.join("cover-images/9780141439587.jpg").exists());
  assert_eq!(report.covers_copied, 2);
}

#[test]
fn files_that_are_not_backups_are_refused() {
  let dir = temp_dir("bad");
  let junk = dir.join("junk.zip");
  fs::write(&junk, "definitely not a zip").unwrap();
  assert!(unpack(&junk, &dir.join("u1")).is_err());

  // a zip without our manifest
  let other = dir.join("other.zip");
  {
    let mut z = zip::ZipWriter::new(fs::File::create(&other).unwrap());
    z.start_file("hello.txt", zip::write::SimpleFileOptions::default())
      .unwrap();
    z.write_all(b"hi").unwrap();
    z.finish().unwrap();
  }
  let e = unpack(&other, &dir.join("u2")).err().unwrap();
  assert!(e.0.contains("isn't a Free Lib backup"));
}

#[test]
fn only_known_entry_names_are_unpacked() {
  assert!(matches!(classify("db.sqlite"), Some(Entry::Db)));
  assert!(matches!(
    classify("plugins/a-b_1.js"),
    Some(Entry::Plugin(_))
  ));
  assert!(matches!(
    classify("plugins/a.config.json"),
    Some(Entry::Plugin(_))
  ));
  assert!(matches!(
    classify("cover-images/9780441013593.jpg"),
    Some(Entry::Cover(_))
  ));
  assert!(matches!(
    classify("cover-images/019971110X.webp"),
    Some(Entry::Cover(_))
  ));
  for bad in [
    "../evil.js",
    "plugins/../evil.js",
    "plugins/sub/a.js",
    "plugins/a.txt",
    "plugins/.js",
    "cover-images/../x.jpg",
    "cover-images/abc.jpg",
    "cover-images/9780441013593.exe",
    "/etc/passwd",
    "other/file",
  ] {
    assert!(classify(bad).is_none(), "{bad}");
  }
}

#[test]
fn isbns_are_compared_without_dashes_or_spaces() {
  assert_eq!(
    isbn_key("978-0-441 01359-3").as_deref(),
    Some("9780441013593")
  );
  assert_eq!(isbn_key("0-19-953567-x").as_deref(), Some("019953567X"));
  assert_eq!(isbn_key("  "), None);
}
