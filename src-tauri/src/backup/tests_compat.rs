//! Tests for importing backups that don't match the current schema exactly: made by an older
//! version, missing optional parts, damaged, or from a newer app. Also `book.added_at` round trips.

use std::{
  borrow::Cow,
  fs,
  path::{Path, PathBuf},
  sync::atomic::{AtomicUsize, Ordering},
};

use sqlx::{
  SqlitePool,
  sqlite::{SqliteConnectOptions, SqliteJournalMode},
};

use super::db::{read_backup_db, merge_db, replace_db};
use super::ImportReport;

fn temp_dir(tag: &str) -> PathBuf {
  static NEXT: AtomicUsize = AtomicUsize::new(0);
  let n = NEXT.fetch_add(1, Ordering::Relaxed);
  let dir = std::env::temp_dir().join(format!("free-lib-compat-{tag}-{}-{n}", std::process::id()));
  let _ = fs::remove_dir_all(&dir);
  fs::create_dir_all(&dir).unwrap();
  dir
}

async fn open(path: &Path, foreign_keys: bool) -> SqlitePool {
  let opts = SqliteConnectOptions::new()
    .filename(path)
    .create_if_missing(true)
    .journal_mode(SqliteJournalMode::Wal)
    .foreign_keys(foreign_keys);
  SqlitePool::connect_with(opts).await.unwrap()
}

/// A database at the current schema.
async fn current_db(path: &Path) -> SqlitePool {
  let pool = open(path, true).await;
  sqlx::migrate!().run(&pool).await.unwrap();
  pool
}

/// A database exactly as 1.0.0 left it: only migration 0001 applied.
async fn v1_0_0_db(path: &Path) -> SqlitePool {
  let pool = open(path, true).await;
  let mut migrator = sqlx::migrate!();
  let first: Vec<_> = migrator.migrations.iter().filter(|m| m.version == 1).cloned().collect();
  assert_eq!(first.len(), 1, "migration 0001 should exist");
  migrator.migrations = Cow::Owned(first);
  migrator.run(&pool).await.unwrap();
  pool
}

async fn add_book(pool: &SqlitePool, title: &str, isbn: &str) -> i64 {
  sqlx::query_scalar("INSERT INTO book (title, isbn) VALUES (?, ?) RETURNING book_id")
    .bind(title)
    .bind(isbn)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn added_at(pool: &SqlitePool, isbn: &str) -> String {
  sqlx::query_scalar("SELECT added_at FROM book WHERE isbn = ?")
    .bind(isbn)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// The message of the error `read_backup_db` returns (its data isn't `Debug`).
async fn read_error(path: &Path) -> String {
  match read_backup_db(path).await {
    Ok(_) => panic!("expected the backup to be refused"),
    Err(e) => e.0,
  }
}

const OLD: &str = "2020-01-01T00:00:00.000Z";
const NEWER: &str = "2030-01-01T00:00:00.000Z";

#[test]
fn a_1_0_0_backup_is_upgraded_and_imports_without_warnings() {
  tauri::async_runtime::block_on(async {
    let dir = temp_dir("v100");
    let old = v1_0_0_db(&dir.join("backup.sqlite")).await;
    let series: i64 = sqlx::query_scalar("INSERT INTO series (name) VALUES ('Dune') RETURNING series_id")
      .fetch_one(&old)
      .await
      .unwrap();
    let id = add_book(&old, "Dune", "9780441013593").await;
    sqlx::query("UPDATE book SET series_id = ?, series_position = 1, notes = 'n' WHERE book_id = ?")
      .bind(series)
      .bind(id)
      .execute(&old)
      .await
      .unwrap();
    sqlx::query("INSERT INTO reading (book_id, date_started) VALUES (?, '2024-01-01')")
      .bind(id)
      .execute(&old)
      .await
      .unwrap();
    // the 1.0.0 schema really has none of the 1.1.0 tables
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = 'shelf'")
      .fetch_one(&old)
      .await
      .unwrap();
    assert_eq!(n, 0);
    old.close().await;

    let data = read_backup_db(&dir.join("backup.sqlite")).await.unwrap();
    assert!(data.warnings.is_empty(), "{:?}", data.warnings);
    assert_eq!(data.books.len(), 1);
    assert_eq!(data.books[0].series_position, Some(1.0));
    assert_eq!(data.notes.get(&id).map(String::as_str), Some("n"));
    assert_eq!(data.readings.len(), 1);
    // 1.0.0 never recorded when a book was added; the upgrade stamps one
    assert!(!data.added_at[&id].is_empty());
    assert!(data.shelves.is_empty() && data.categories.is_empty());

    let host = current_db(&dir.join("host.sqlite")).await;
    let mut report = ImportReport::default();
    replace_db(&host, &data, &mut report).await.unwrap();
    assert_eq!(report.books_added, 1);
    assert_eq!(added_at(&host, "9780441013593").await, data.added_at[&id]);
  });
}

#[test]
fn added_at_survives_a_full_replace() {
  tauri::async_runtime::block_on(async {
    let dir = temp_dir("added-replace");
    let backup = current_db(&dir.join("backup.sqlite")).await;
    add_book(&backup, "A", "9780000000001").await;
    sqlx::query("UPDATE book SET added_at = ?").bind(OLD).execute(&backup).await.unwrap();
    backup.close().await;

    let data = read_backup_db(&dir.join("backup.sqlite")).await.unwrap();
    let host = current_db(&dir.join("host.sqlite")).await;
    replace_db(&host, &data, &mut ImportReport::default()).await.unwrap();
    assert_eq!(added_at(&host, "9780000000001").await, OLD);
  });
}

#[test]
fn added_at_survives_merges_and_the_older_date_wins_on_override() {
  tauri::async_runtime::block_on(async {
    let dir = temp_dir("added-merge");
    let backup = current_db(&dir.join("backup.sqlite")).await;
    for (title, isbn, date) in [
      ("New", "9780000000001", OLD),
      ("Both, backup older", "9780000000002", OLD),
      ("Both, backup newer", "9780000000003", NEWER),
    ] {
      add_book(&backup, title, isbn).await;
      sqlx::query("UPDATE book SET added_at = ? WHERE isbn = ?")
        .bind(date)
        .bind(isbn)
        .execute(&backup)
        .await
        .unwrap();
    }
    backup.close().await;
    let data = read_backup_db(&dir.join("backup.sqlite")).await.unwrap();

    let make_host = |name: &'static str| {
      let path = dir.join(name);
      async move {
        let host = current_db(&path).await;
        for (title, isbn) in [("Both, backup older", "9780000000002"), ("Both, backup newer", "9780000000003")] {
          add_book(&host, title, isbn).await;
        }
        sqlx::query("UPDATE book SET added_at = '2025-06-01T00:00:00.000Z'").execute(&host).await.unwrap();
        host
      }
    };

    // append: the new book keeps its date, existing books are left alone
    let host = make_host("append.sqlite").await;
    merge_db(&host, &data, false, &mut ImportReport::default()).await.unwrap();
    assert_eq!(added_at(&host, "9780000000001").await, OLD);
    assert_eq!(added_at(&host, "9780000000002").await, "2025-06-01T00:00:00.000Z");

    // override: whichever date is older is kept
    let host = make_host("override.sqlite").await;
    merge_db(&host, &data, true, &mut ImportReport::default()).await.unwrap();
    assert_eq!(added_at(&host, "9780000000001").await, OLD);
    assert_eq!(added_at(&host, "9780000000002").await, OLD);
    assert_eq!(added_at(&host, "9780000000003").await, "2025-06-01T00:00:00.000Z");
  });
}

#[test]
fn a_missing_core_table_or_column_fails_with_a_clear_message() {
  tauri::async_runtime::block_on(async {
    let dir = temp_dir("core");

    let path = dir.join("no-links.sqlite");
    let db = current_db(&path).await;
    sqlx::query("DROP TABLE book_author").execute(&db).await.unwrap();
    db.close().await;
    let msg = read_error(&path).await;
    assert!(msg.contains("book_author"), "{msg}");

    let path = dir.join("no-title.sqlite");
    let db = current_db(&path).await;
    sqlx::query("ALTER TABLE book DROP COLUMN title").execute(&db).await.unwrap();
    db.close().await;
    let msg = read_error(&path).await;
    assert!(msg.contains("book") && msg.contains("title"), "{msg}");
  });
}

#[test]
fn missing_optional_tables_are_read_as_empty_with_warnings() {
  tauri::async_runtime::block_on(async {
    let dir = temp_dir("optional-tables");
    let path = dir.join("backup.sqlite");
    let db = current_db(&path).await;
    let id = add_book(&db, "Kept", "9780000000001").await;
    sqlx::query("INSERT INTO reading (book_id, date_started) VALUES (?, '2024-01-01')")
      .bind(id)
      .execute(&db)
      .await
      .unwrap();
    for table in ["book_shelf", "shelf", "book_category", "category", "reading"] {
      sqlx::query(&format!("DROP TABLE {table}")).execute(&db).await.unwrap();
    }
    db.close().await;

    let data = read_backup_db(&path).await.unwrap();
    assert_eq!(data.books.len(), 1);
    assert!(data.shelves.is_empty() && data.categories.is_empty() && data.readings.is_empty());
    for table in ["shelf", "category", "reading"] {
      assert!(
        data.warnings.iter().any(|w| w.contains(&format!("`{table}`"))),
        "no warning for {table}: {:?}",
        data.warnings
      );
    }

    let host = current_db(&dir.join("host.sqlite")).await;
    replace_db(&host, &data, &mut ImportReport::default()).await.unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM book").fetch_one(&host).await.unwrap();
    assert_eq!(n, 1);
  });
}

#[test]
fn a_missing_optional_column_gets_a_default() {
  tauri::async_runtime::block_on(async {
    let dir = temp_dir("optional-column");
    let path = dir.join("backup.sqlite");
    let db = current_db(&path).await;
    let id = add_book(&db, "Kept", "9780000000001").await;
    sqlx::query("UPDATE book SET blurb = 'gone soon', notes = 'gone too' WHERE book_id = ?")
      .bind(id)
      .execute(&db)
      .await
      .unwrap();
    sqlx::query("ALTER TABLE book DROP COLUMN blurb").execute(&db).await.unwrap();
    sqlx::query("ALTER TABLE book DROP COLUMN notes").execute(&db).await.unwrap();
    db.close().await;

    let data = read_backup_db(&path).await.unwrap();
    assert_eq!(data.books[0].blurb, None);
    assert_eq!(data.notes.get(&id).map(String::as_str), Some(""));
    assert!(data.warnings.iter().any(|w| w.contains("`blurb`")), "{:?}", data.warnings);
    assert!(data.warnings.iter().any(|w| w.contains("`notes`")), "{:?}", data.warnings);

    let host = current_db(&dir.join("host.sqlite")).await;
    replace_db(&host, &data, &mut ImportReport::default()).await.unwrap();
    assert_eq!(added_at(&host, "9780000000001").await, data.added_at[&id]);
  });
}

#[test]
fn rows_pointing_at_missing_rows_are_dropped_instead_of_aborting_the_import() {
  tauri::async_runtime::block_on(async {
    let dir = temp_dir("dangling");
    let path = dir.join("backup.sqlite");
    // foreign keys off, so a damaged file can be built
    let db = open(&path, false).await;
    sqlx::migrate!().run(&db).await.unwrap();
    let id = add_book(&db, "Kept", "9780000000001").await;
    sqlx::query("UPDATE book SET series_id = 999, series_position = 2 WHERE book_id = ?")
      .bind(id)
      .execute(&db)
      .await
      .unwrap();
    sqlx::query("INSERT INTO book_tag (book_id, tag_id) VALUES (?, 999)").bind(id).execute(&db).await.unwrap();
    sqlx::query("INSERT INTO book_author (book_id, author_id) VALUES (12345, 1)").execute(&db).await.unwrap();
    db.close().await;

    let data = read_backup_db(&path).await.unwrap();
    assert_eq!(data.books[0].series_id, None);
    assert_eq!(data.books[0].series_position, None);
    assert!(data.book_tags.is_empty() && data.book_authors.is_empty());
    assert_eq!(data.warnings.len(), 3, "{:?}", data.warnings);

    let host = current_db(&dir.join("host.sqlite")).await;
    replace_db(&host, &data, &mut ImportReport::default()).await.unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM book").fetch_one(&host).await.unwrap();
    assert_eq!(n, 1);
  });
}

#[test]
fn a_backup_from_a_newer_schema_is_refused() {
  tauri::async_runtime::block_on(async {
    let dir = temp_dir("newer");
    let path = dir.join("backup.sqlite");
    let db = current_db(&path).await;
    sqlx::query(
      "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
       VALUES (9999, 'from the future', 1, X'00', 0)",
    )
    .execute(&db)
    .await
    .unwrap();
    db.close().await;
    let msg = read_error(&path).await;
    assert!(msg.contains("newer version"), "{msg}");
  });
}
