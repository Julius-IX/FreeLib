//! The database side of an import: reading the backup's database into memory, then either
//! replacing the live library with it or merging it in. All writes are one transaction.

use std::{
  collections::{HashMap, HashSet},
  path::Path,
};

use sqlx::{
  Connection, FromRow, Sqlite, SqliteConnection, SqlitePool, Transaction,
  sqlite::{SqliteConnectOptions, SqliteRow},
};

use super::names::{isbn_key, name_key};
use super::{BackupError, ImportReport, Res};
use crate::models::{
  Author, Book, BookAuthor, BookCategory, BookShelf, BookTag, Category, Reading, Series, Shelf,
  Tag, TagType,
};

pub(super) struct BackupData {
  pub(super) authors: Vec<Author>,
  pub(super) series: Vec<Series>,
  pub(super) tag_types: Vec<TagType>,
  pub(super) tags: Vec<Tag>,
  pub(super) categories: Vec<Category>,
  pub(super) shelves: Vec<Shelf>,
  pub(super) books: Vec<Book>,
  pub(super) notes: HashMap<i64, String>,
  /// `book.added_at` per book id. Empty string = unknown (the database stamps it).
  pub(super) added_at: HashMap<i64, String>,
  pub(super) book_authors: Vec<BookAuthor>,
  pub(super) book_tags: Vec<BookTag>,
  pub(super) book_categories: Vec<BookCategory>,
  pub(super) book_shelves: Vec<BookShelf>,
  pub(super) readings: Vec<Reading>,
  /// Things that were missing or dropped but didn't stop the import. Shown to the user.
  pub(super) warnings: Vec<String>,
}

/// Opens the unpacked database (a private copy, so it may be changed), brings it up to this
/// version's schema, checks it, and reads every table.
pub(super) async fn read_backup_db(path: &Path) -> Res<BackupData> {
  let opts = SqliteConnectOptions::new().filename(path);
  let mut conn = SqliteConnection::connect_with(&opts)
    .await
    .map_err(|_| BackupError::new("the backup's database can't be opened"))?;

  let check: String = sqlx::query_scalar("PRAGMA quick_check")
    .fetch_one(&mut conn)
    .await
    .map_err(|_| BackupError::new("the backup's database is damaged"))?;
  if check != "ok" {
    return Err(BackupError::new("the backup's database is damaged"));
  }

  // An older backup is upgraded here; one from a newer app has migrations we don't know.
  sqlx::migrate!()
    .run_direct(&mut conn)
    .await
    .map_err(|e| match e {
      sqlx::migrate::MigrateError::VersionMissing(_) => BackupError::new(
        "this backup was made by a newer version of the app. Update the app to import it",
      ),
      other => BackupError(format!("the backup's database can't be used: {other}")),
    })?;

  let schema = Schema::load(&mut conn).await?;
  let mut warnings = Vec::new();

  let mut data = BackupData {
    authors: read_rows(&mut conn, &schema, &AUTHOR, "", &mut warnings).await?,
    series: read_rows(&mut conn, &schema, &SERIES, "", &mut warnings).await?,
    tag_types: read_rows(&mut conn, &schema, &TAG_TYPE, "", &mut warnings).await?,
    tags: read_rows(&mut conn, &schema, &TAG, "", &mut warnings).await?,
    categories: read_rows(&mut conn, &schema, &CATEGORY, "", &mut warnings).await?,
    shelves: read_rows(
      &mut conn,
      &schema,
      &SHELF,
      "ORDER BY position, shelf_id",
      &mut warnings,
    )
    .await?,
    books: read_rows(&mut conn, &schema, &BOOK, "ORDER BY book_id", &mut warnings).await?,
    notes: read_rows::<(i64, String)>(&mut conn, &schema, &BOOK_NOTES, "", &mut warnings)
      .await?
      .into_iter()
      .collect(),
    added_at: read_rows::<(i64, String)>(&mut conn, &schema, &BOOK_ADDED_AT, "", &mut warnings)
      .await?
      .into_iter()
      .collect(),
    book_authors: read_rows(&mut conn, &schema, &BOOK_AUTHOR, "", &mut warnings).await?,
    book_tags: read_rows(&mut conn, &schema, &BOOK_TAG, "", &mut warnings).await?,
    book_categories: read_rows(&mut conn, &schema, &BOOK_CATEGORY, "", &mut warnings).await?,
    book_shelves: read_rows(&mut conn, &schema, &BOOK_SHELF, "", &mut warnings).await?,
    readings: read_rows(&mut conn, &schema, &READING, "ORDER BY reading_id", &mut warnings)
      .await?,
    warnings: Vec::new(),
  };
  drop_dangling(&mut data, &mut warnings);
  data.warnings = warnings;
  let _ = conn.close().await;
  Ok(data)
}

// SECTION: reading a backup of any age
//
// The backup's database is brought up to the current schema by the migrations first, which
// covers everything the migration history knows about (e.g. 1.0.0 -> 1.1.0). What's left is a
// backup whose database doesn't match its own migration history (hand-edited, damaged, made by
// a development build). For those: a missing core table or column fails the import with a
// clear message; anything that's optional is read as empty and reported as a warning.

/// One column the importer reads. `fallback` is the SQL value used when the backup doesn't have
/// the column; `None` means the backup can't be imported without it.
struct Col {
  name: &'static str,
  fallback: Option<&'static str>,
}

const fn req(name: &'static str) -> Col {
  Col { name, fallback: None }
}

const fn opt(name: &'static str, fallback: &'static str) -> Col {
  Col {
    name,
    fallback: Some(fallback),
  }
}

/// One table the importer reads. A missing `required` table fails the import; a missing optional
/// one is read as empty.
struct Spec {
  table: &'static str,
  required: bool,
  cols: &'static [Col],
}

static AUTHOR: Spec = Spec {
  table: "author",
  required: true,
  cols: &[req("author_id"), req("name"), opt("birth_date", "NULL"), opt("death_date", "NULL")],
};
static SERIES: Spec = Spec {
  table: "series",
  required: true,
  cols: &[req("series_id"), req("name")],
};
static TAG_TYPE: Spec = Spec {
  table: "tag_type",
  required: true,
  cols: &[req("tag_type_id"), req("name")],
};
static TAG: Spec = Spec {
  table: "tag",
  required: true,
  cols: &[req("tag_id"), req("tag_type_id"), req("name")],
};
static BOOK: Spec = Spec {
  table: "book",
  required: true,
  cols: &[
    req("book_id"),
    req("title"),
    opt("isbn", "NULL"),
    opt("publish_date", "NULL"),
    opt("blurb", "NULL"),
    opt("page_count", "NULL"),
    opt("series_id", "NULL"),
    opt("series_position", "NULL"),
  ],
};
// `notes` and `added_at` are read separately from `Book` (see models.rs), so they have their own specs.
static BOOK_NOTES: Spec = Spec {
  table: "book",
  required: true,
  cols: &[req("book_id"), opt("notes", "''")],
};
static BOOK_ADDED_AT: Spec = Spec {
  table: "book",
  required: true,
  cols: &[req("book_id"), opt("added_at", "''")],
};
static BOOK_AUTHOR: Spec = Spec {
  table: "book_author",
  required: true,
  cols: &[req("book_id"), req("author_id")],
};
static BOOK_TAG: Spec = Spec {
  table: "book_tag",
  required: true,
  cols: &[req("book_id"), req("tag_id")],
};
static CATEGORY: Spec = Spec {
  table: "category",
  required: false,
  cols: &[req("category_id"), req("name"), opt("color", "'#888888'")],
};
static BOOK_CATEGORY: Spec = Spec {
  table: "book_category",
  required: false,
  cols: &[req("book_id"), req("category_id")],
};
static SHELF: Spec = Spec {
  table: "shelf",
  required: false,
  cols: &[req("shelf_id"), req("name"), opt("position", "shelf_id")],
};
static BOOK_SHELF: Spec = Spec {
  table: "book_shelf",
  required: false,
  cols: &[req("book_id"), req("shelf_id")],
};
static READING: Spec = Spec {
  table: "reading",
  required: false,
  cols: &[
    req("reading_id"),
    req("book_id"),
    opt("date_started", "NULL"),
    opt("date_finished", "NULL"),
  ],
};

/// Which tables and columns the backup's database actually has (lowercase names).
struct Schema(HashMap<String, HashSet<String>>);

impl Schema {
  async fn load(conn: &mut SqliteConnection) -> Res<Self> {
    let rows: Vec<(String, String)> = sqlx::query_as(
      "SELECT m.name, p.name FROM sqlite_master m JOIN pragma_table_info(m.name) p
       WHERE m.type = 'table'",
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut tables: HashMap<String, HashSet<String>> = HashMap::new();
    for (table, col) in rows {
      tables
        .entry(table.to_lowercase())
        .or_default()
        .insert(col.to_lowercase());
    }
    Ok(Schema(tables))
  }
}

/// Reads one table as described by `spec`, filling in what the backup lacks (see above).
/// `tail` is appended to the query (an ORDER BY).
async fn read_rows<T>(
  conn: &mut SqliteConnection,
  schema: &Schema,
  spec: &Spec,
  tail: &str,
  warnings: &mut Vec<String>,
) -> Res<Vec<T>>
where
  T: for<'r> FromRow<'r, SqliteRow> + Send + Unpin,
{
  let Some(have) = schema.0.get(spec.table) else {
    if spec.required {
      return Err(BackupError(format!(
        "the backup is damaged: its `{}` table is missing",
        spec.table
      )));
    }
    warnings.push(format!(
      "the backup has no `{}` table, so that part was left empty",
      spec.table
    ));
    return Ok(Vec::new());
  };

  let mut select = Vec::with_capacity(spec.cols.len());
  for col in spec.cols {
    if have.contains(col.name) {
      select.push(col.name.to_string());
    } else if let Some(fallback) = col.fallback {
      select.push(format!("{fallback} AS {}", col.name));
      warnings.push(format!(
        "the backup's `{}` table has no `{}` column, so it was filled in with a default",
        spec.table, col.name
      ));
    } else {
      return Err(BackupError(format!(
        "the backup is damaged: its `{}` table has no `{}` column",
        spec.table, col.name
      )));
    }
  }
  let sql = format!("SELECT {} FROM {} {tail}", select.join(", "), spec.table);
  Ok(sqlx::query_as(&sql).fetch_all(&mut *conn).await?)
}

/// Keeps the rows `keep` accepts and says how many were dropped.
fn prune<T>(rows: &mut Vec<T>, keep: impl Fn(&T) -> bool, what: &str, warnings: &mut Vec<String>) {
  let before = rows.len();
  rows.retain(keep);
  let dropped = before - rows.len();
  if dropped > 0 {
    warnings.push(format!("{dropped} {what} pointed at something that isn't in the backup and were skipped"));
  }
}

/// Rows that point at a row the backup doesn't have (a missing optional table, a hand-edited
/// file) would fail a foreign key on insert and abort the whole import. They are dropped instead.
fn drop_dangling(d: &mut BackupData, warnings: &mut Vec<String>) {
  let tag_types: HashSet<i64> = d.tag_types.iter().map(|t| t.tag_type_id).collect();
  prune(&mut d.tags, |t| tag_types.contains(&t.tag_type_id), "tags", warnings);

  let series: HashSet<i64> = d.series.iter().map(|s| s.series_id).collect();
  let mut unlinked = 0;
  for b in &mut d.books {
    if b.series_id.is_some_and(|s| !series.contains(&s)) {
      b.series_id = None;
      b.series_position = None;
      unlinked += 1;
    }
  }
  if unlinked > 0 {
    warnings.push(format!("{unlinked} books were in a series that isn't in the backup and were left without one"));
  }

  let books: HashSet<i64> = d.books.iter().map(|b| b.book_id).collect();
  let authors: HashSet<i64> = d.authors.iter().map(|a| a.author_id).collect();
  let tags: HashSet<i64> = d.tags.iter().map(|t| t.tag_id).collect();
  let categories: HashSet<i64> = d.categories.iter().map(|c| c.category_id).collect();
  let shelves: HashSet<i64> = d.shelves.iter().map(|s| s.shelf_id).collect();

  prune(
    &mut d.book_authors,
    |l| books.contains(&l.book_id) && authors.contains(&l.author_id),
    "author links",
    warnings,
  );
  prune(
    &mut d.book_tags,
    |l| books.contains(&l.book_id) && tags.contains(&l.tag_id),
    "tag links",
    warnings,
  );
  prune(
    &mut d.book_categories,
    |l| books.contains(&l.book_id) && categories.contains(&l.category_id),
    "category links",
    warnings,
  );
  prune(
    &mut d.book_shelves,
    |l| books.contains(&l.book_id) && shelves.contains(&l.shelf_id),
    "shelf links",
    warnings,
  );
  prune(&mut d.readings, |r| books.contains(&r.book_id), "readings", warnings);
}

// SECTION: apply to the live database

pub(super) type Tx<'a> = Transaction<'a, Sqlite>;

pub(super) async fn insert_reading(tx: &mut Tx<'_>, book_id: i64, r: &Reading) -> Res<()> {
  sqlx::query("INSERT INTO reading (book_id, date_started, date_finished) VALUES (?, ?, ?)")
    .bind(book_id)
    .bind(&r.date_started)
    .bind(&r.date_finished)
    .execute(&mut **tx)
    .await?;
  Ok(())
}

/// Wipes the library and writes the backup's rows with their original ids.
pub(super) async fn replace_db(
  pool: &SqlitePool,
  data: &BackupData,
  report: &mut ImportReport,
) -> Res<()> {
  let mut tx = pool.begin().await?;

  // children first
  for table in [
    "reading",
    "book_shelf",
    "book_category",
    "book_tag",
    "book_author",
    "book",
    "shelf",
    "category",
    "tag",
    "tag_type",
    "series",
    "author",
  ] {
    sqlx::query(&format!("DELETE FROM {table}"))
      .execute(&mut *tx)
      .await?;
  }

  for a in &data.authors {
    sqlx::query("INSERT INTO author (author_id, name, birth_date, death_date) VALUES (?, ?, ?, ?)")
      .bind(a.author_id)
      .bind(&a.name)
      .bind(&a.birth_date)
      .bind(&a.death_date)
      .execute(&mut *tx)
      .await?;
  }
  for s in &data.series {
    sqlx::query("INSERT INTO series (series_id, name) VALUES (?, ?)")
      .bind(s.series_id)
      .bind(&s.name)
      .execute(&mut *tx)
      .await?;
  }
  for t in &data.tag_types {
    sqlx::query("INSERT INTO tag_type (tag_type_id, name) VALUES (?, ?)")
      .bind(t.tag_type_id)
      .bind(&t.name)
      .execute(&mut *tx)
      .await?;
  }
  for t in &data.tags {
    sqlx::query("INSERT INTO tag (tag_id, tag_type_id, name) VALUES (?, ?, ?)")
      .bind(t.tag_id)
      .bind(t.tag_type_id)
      .bind(&t.name)
      .execute(&mut *tx)
      .await?;
  }
  for c in &data.categories {
    sqlx::query("INSERT INTO category (category_id, name, color) VALUES (?, ?, ?)")
      .bind(c.category_id)
      .bind(&c.name)
      .bind(&c.color)
      .execute(&mut *tx)
      .await?;
  }
  for sh in &data.shelves {
    sqlx::query("INSERT INTO shelf (shelf_id, name, position) VALUES (?, ?, ?)")
      .bind(sh.shelf_id)
      .bind(&sh.name)
      .bind(sh.position)
      .execute(&mut *tx)
      .await?;
  }
  for b in &data.books {
    sqlx::query(
      "INSERT INTO book (book_id, title, isbn, publish_date, blurb, page_count, series_id,
                         series_position, notes, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(b.book_id)
    .bind(&b.title)
    .bind(&b.isbn)
    .bind(&b.publish_date)
    .bind(&b.blurb)
    .bind(b.page_count)
    .bind(b.series_id)
    .bind(b.series_position)
    .bind(data.notes.get(&b.book_id).map(String::as_str).unwrap_or(""))
    // '' (unknown) is stamped with the current time by the database
    .bind(data.added_at.get(&b.book_id).map(String::as_str).unwrap_or(""))
    .execute(&mut *tx)
    .await?;
  }
  for l in &data.book_authors {
    sqlx::query("INSERT INTO book_author (book_id, author_id) VALUES (?, ?)")
      .bind(l.book_id)
      .bind(l.author_id)
      .execute(&mut *tx)
      .await?;
  }
  for l in &data.book_tags {
    sqlx::query("INSERT INTO book_tag (book_id, tag_id) VALUES (?, ?)")
      .bind(l.book_id)
      .bind(l.tag_id)
      .execute(&mut *tx)
      .await?;
  }
  for l in &data.book_categories {
    sqlx::query("INSERT INTO book_category (book_id, category_id) VALUES (?, ?)")
      .bind(l.book_id)
      .bind(l.category_id)
      .execute(&mut *tx)
      .await?;
  }
  for l in &data.book_shelves {
    sqlx::query("INSERT INTO book_shelf (book_id, shelf_id) VALUES (?, ?)")
      .bind(l.book_id)
      .bind(l.shelf_id)
      .execute(&mut *tx)
      .await?;
  }
  for r in &data.readings {
    sqlx::query(
      "INSERT INTO reading (reading_id, book_id, date_started, date_finished) VALUES (?, ?, ?, ?)",
    )
    .bind(r.reading_id)
    .bind(r.book_id)
    .bind(&r.date_started)
    .bind(&r.date_finished)
    .execute(&mut *tx)
    .await?;
  }
  tx.commit().await?;

  report.books_added = data.books.len();
  report.authors_added = data.authors.len();
  report.series_added = data.series.len();
  report.tags_added = data.tags.len();
  report.categories_added = data.categories.len();
  report.shelves_added = data.shelves.len();
  Ok(())
}

pub(super) fn group<T: Copy>(pairs: impl Iterator<Item = (i64, T)>) -> HashMap<i64, Vec<T>> {
  let mut out: HashMap<i64, Vec<T>> = HashMap::new();
  for (k, v) in pairs {
    out.entry(k).or_default().push(v);
  }
  out
}

/// Backup row ids -> ids of the matching rows in the live database.
type IdMap = HashMap<i64, i64>;

/// The id maps a book needs to point at the right live rows.
struct IdMaps {
  authors: IdMap,
  series: IdMap,
  tags: IdMap,
  categories: IdMap,
  shelves: IdMap,
}

/// Merges the backup's rows into the live database in one transaction. With `overwrite`, a book
/// that already exists is replaced by the backup's version; without it, it's left alone.
/// Returns the backup's book ids mapped to the live books they were added as or written over,
/// which the cover step needs. A book that was left alone isn't in it.
pub(super) async fn merge_db(
  pool: &SqlitePool,
  data: &BackupData,
  overwrite: bool,
  report: &mut ImportReport,
) -> Res<HashMap<i64, i64>> {
  let mut tx = pool.begin().await?;

  let authors = merge_authors(&mut tx, data, overwrite, report).await?;
  let series = merge_series(&mut tx, data, report).await?;
  let tag_types = merge_tag_types(&mut tx, data).await?;
  let tags = merge_tags(&mut tx, data, &tag_types, report).await?;
  let categories = merge_categories(&mut tx, data, overwrite, report).await?;
  let shelves = merge_shelves(&mut tx, data, report).await?;
  let maps = IdMaps {
    authors,
    series,
    tags,
    categories,
    shelves,
  };
  let applied = merge_books(&mut tx, data, &maps, overwrite, report).await?;

  tx.commit().await?;
  Ok(applied)
}

/// Authors are matched by name. With `overwrite`, a matched author takes the backup's dates.
async fn merge_authors(
  tx: &mut Tx<'_>,
  data: &BackupData,
  overwrite: bool,
  report: &mut ImportReport,
) -> Res<IdMap> {
  let mut host_authors: HashMap<String, i64> =
    sqlx::query_as::<_, (i64, String)>("SELECT author_id, name FROM author")
      .fetch_all(&mut **tx)
      .await?
      .into_iter()
      .map(|(id, n)| (name_key(&n), id))
      .collect();
  let mut author_map = IdMap::new();
  for a in &data.authors {
    if let Some(&id) = host_authors.get(&name_key(&a.name)) {
      author_map.insert(a.author_id, id);
      if overwrite && (a.birth_date.is_some() || a.death_date.is_some()) {
        // a value the backup doesn't have is kept; one the table's date checks refuse is skipped
        let r = sqlx::query(
          "UPDATE author SET birth_date = COALESCE(?, birth_date),
                             death_date = COALESCE(?, death_date) WHERE author_id = ?",
        )
        .bind(&a.birth_date)
        .bind(&a.death_date)
        .bind(id)
        .execute(&mut **tx)
        .await;
        match r {
          Ok(_) => {}
          Err(sqlx::Error::Database(d)) if d.is_check_violation() => {}
          Err(e) => return Err(e.into()),
        }
      }
    } else {
      let id: i64 = sqlx::query_scalar(
        "INSERT INTO author (name, birth_date, death_date) VALUES (?, ?, ?) RETURNING author_id",
      )
      .bind(&a.name)
      .bind(&a.birth_date)
      .bind(&a.death_date)
      .fetch_one(&mut **tx)
      .await?;
      host_authors.insert(name_key(&a.name), id);
      author_map.insert(a.author_id, id);
      report.authors_added += 1;
    }
  }
  Ok(author_map)
}

/// Series are matched by name; missing ones are added.
async fn merge_series(tx: &mut Tx<'_>, data: &BackupData, report: &mut ImportReport) -> Res<IdMap> {
  let mut host_series: HashMap<String, i64> =
    sqlx::query_as::<_, (i64, String)>("SELECT series_id, name FROM series")
      .fetch_all(&mut **tx)
      .await?
      .into_iter()
      .map(|(id, n)| (name_key(&n), id))
      .collect();
  let mut series_map = IdMap::new();
  for s in &data.series {
    let id = match host_series.get(&name_key(&s.name)) {
      Some(&id) => id,
      None => {
        let id: i64 =
          sqlx::query_scalar("INSERT INTO series (name) VALUES (?) RETURNING series_id")
            .bind(&s.name)
            .fetch_one(&mut **tx)
            .await?;
        host_series.insert(name_key(&s.name), id);
        report.series_added += 1;
        id
      }
    };
    series_map.insert(s.series_id, id);
  }
  Ok(series_map)
}

/// Tag types are matched by name; missing ones are added.
async fn merge_tag_types(tx: &mut Tx<'_>, data: &BackupData) -> Res<IdMap> {
  let mut host_types: HashMap<String, i64> =
    sqlx::query_as::<_, (i64, String)>("SELECT tag_type_id, name FROM tag_type")
      .fetch_all(&mut **tx)
      .await?
      .into_iter()
      .map(|(id, n)| (name_key(&n), id))
      .collect();
  let mut type_map = IdMap::new();
  for t in &data.tag_types {
    let id = match host_types.get(&name_key(&t.name)) {
      Some(&id) => id,
      None => {
        let id: i64 =
          sqlx::query_scalar("INSERT INTO tag_type (name) VALUES (?) RETURNING tag_type_id")
            .bind(&t.name)
            .fetch_one(&mut **tx)
            .await?;
        host_types.insert(name_key(&t.name), id);
        id
      }
    };
    type_map.insert(t.tag_type_id, id);
  }
  Ok(type_map)
}

/// Tags are matched by (tag type, name); missing ones are added. `type_map` comes from
/// `merge_tag_types`.
async fn merge_tags(
  tx: &mut Tx<'_>,
  data: &BackupData,
  type_map: &IdMap,
  report: &mut ImportReport,
) -> Res<IdMap> {
  let mut host_tags: HashMap<(i64, String), i64> =
    sqlx::query_as::<_, (i64, i64, String)>("SELECT tag_id, tag_type_id, name FROM tag")
      .fetch_all(&mut **tx)
      .await?
      .into_iter()
      .map(|(id, ty, n)| ((ty, name_key(&n)), id))
      .collect();
  let mut tag_map = IdMap::new();
  for t in &data.tags {
    let Some(&host_type) = type_map.get(&t.tag_type_id) else {
      continue;
    };
    let key = (host_type, name_key(&t.name));
    let id = match host_tags.get(&key) {
      Some(&id) => id,
      None => {
        let id: i64 =
          sqlx::query_scalar("INSERT INTO tag (tag_type_id, name) VALUES (?, ?) RETURNING tag_id")
            .bind(host_type)
            .bind(&t.name)
            .fetch_one(&mut **tx)
            .await?;
        host_tags.insert(key, id);
        report.tags_added += 1;
        id
      }
    };
    tag_map.insert(t.tag_id, id);
  }
  Ok(tag_map)
}

/// Categories are matched by name; missing ones are added. With `overwrite`, a matched category
/// takes the backup's color.
async fn merge_categories(
  tx: &mut Tx<'_>,
  data: &BackupData,
  overwrite: bool,
  report: &mut ImportReport,
) -> Res<IdMap> {
  let mut host_categories: HashMap<String, i64> =
    sqlx::query_as::<_, (i64, String)>("SELECT category_id, name FROM category")
      .fetch_all(&mut **tx)
      .await?
      .into_iter()
      .map(|(id, n)| (name_key(&n), id))
      .collect();
  let mut category_map = IdMap::new();
  for c in &data.categories {
    let id = match host_categories.get(&name_key(&c.name)) {
      Some(&id) => {
        if overwrite {
          sqlx::query("UPDATE category SET color = ? WHERE category_id = ?")
            .bind(&c.color)
            .bind(id)
            .execute(&mut **tx)
            .await?;
        }
        id
      }
      None => {
        let id: i64 = sqlx::query_scalar(
          "INSERT INTO category (name, color) VALUES (?, ?) RETURNING category_id",
        )
        .bind(&c.name)
        .bind(&c.color)
        .fetch_one(&mut **tx)
        .await?;
        host_categories.insert(name_key(&c.name), id);
        report.categories_added += 1;
        id
      }
    };
    category_map.insert(c.category_id, id);
  }
  Ok(category_map)
}

/// Shelves are matched by name; missing ones are added at the end of the tab row (in the
/// backup's order). A matched shelf keeps its place.
async fn merge_shelves(tx: &mut Tx<'_>, data: &BackupData, report: &mut ImportReport) -> Res<IdMap> {
  let mut host_shelves: HashMap<String, i64> =
    sqlx::query_as::<_, (i64, String)>("SELECT shelf_id, name FROM shelf")
      .fetch_all(&mut **tx)
      .await?
      .into_iter()
      .map(|(id, n)| (name_key(&n), id))
      .collect();
  let mut shelf_map = IdMap::new();
  for s in &data.shelves {
    let id = match host_shelves.get(&name_key(&s.name)) {
      Some(&id) => id,
      None => {
        let id: i64 = sqlx::query_scalar(
          "INSERT INTO shelf (name, position)
           SELECT ?, COALESCE(MAX(position), 0) + 1 FROM shelf RETURNING shelf_id",
        )
        .bind(&s.name)
        .fetch_one(&mut **tx)
        .await?;
        host_shelves.insert(name_key(&s.name), id);
        report.shelves_added += 1;
        id
      }
    };
    shelf_map.insert(s.shelf_id, id);
  }
  Ok(shelf_map)
}

/// The live books, for matching: by normalised ISBN, and (only for books without an ISBN) by title.
struct BookIndex {
  by_isbn: HashMap<String, i64>,
  by_title: HashMap<String, i64>,
}

async fn load_book_index(tx: &mut Tx<'_>) -> Res<BookIndex> {
  let mut index = BookIndex {
    by_isbn: HashMap::new(),
    by_title: HashMap::new(),
  };
  for (id, isbn, title) in
    sqlx::query_as::<_, (i64, Option<String>, String)>("SELECT book_id, isbn, title FROM book")
      .fetch_all(&mut **tx)
      .await?
  {
    match isbn.as_deref().and_then(isbn_key) {
      Some(k) => {
        index.by_isbn.insert(k, id);
      }
      None => {
        index.by_title.insert(name_key(&title), id);
      }
    }
  }
  Ok(index)
}

/// The live book that `key` (a normalised ISBN, if the book has one) or `title` matches.
fn find_book(index: &BookIndex, key: &Option<String>, title: &str) -> Option<i64> {
  match key {
    Some(k) => index.by_isbn.get(k).copied(),
    None => index.by_title.get(&name_key(title)).copied(),
  }
}

/// Adds a just-inserted book to the index, so a later duplicate in the backup matches it.
fn remember_book(index: &mut BookIndex, key: Option<String>, title: &str, id: i64) {
  match key {
    Some(k) => index.by_isbn.insert(k, id),
    None => index.by_title.insert(name_key(title), id),
  };
}

/// Books are matched by ISBN (or by title when neither side has one). A matched book is skipped,
/// or with `overwrite` replaced by the backup's version. Returns the backup's book ids mapped to
/// the live ids of the books that were added or replaced.
async fn merge_books(
  tx: &mut Tx<'_>,
  data: &BackupData,
  maps: &IdMaps,
  overwrite: bool,
  report: &mut ImportReport,
) -> Res<HashMap<i64, i64>> {
  let mut index = load_book_index(tx).await?;
  let mut applied = HashMap::new();

  let authors_of = group(
    data
      .book_authors
      .iter()
      .filter_map(|l| Some((l.book_id, *maps.authors.get(&l.author_id)?))),
  );
  let tags_of = group(
    data
      .book_tags
      .iter()
      .filter_map(|l| Some((l.book_id, *maps.tags.get(&l.tag_id)?))),
  );
  let categories_of = group(
    data
      .book_categories
      .iter()
      .filter_map(|l| Some((l.book_id, *maps.categories.get(&l.category_id)?))),
  );
  let shelves_of = group(
    data
      .book_shelves
      .iter()
      .filter_map(|l| Some((l.book_id, *maps.shelves.get(&l.shelf_id)?))),
  );
  let readings_of = group(data.readings.iter().map(|r| (r.book_id, r)));

  for b in &data.books {
    let key = b.isbn.as_deref().and_then(isbn_key);
    let hit = find_book(&index, &key, &b.title);
    let series_id = b.series_id.and_then(|s| maps.series.get(&s).copied());
    let notes = data.notes.get(&b.book_id).map(String::as_str).unwrap_or("");
    let added_at = data.added_at.get(&b.book_id).map(String::as_str).unwrap_or("");

    let host_id = match hit {
      Some(_) if !overwrite => {
        report.books_skipped += 1;
        continue;
      }
      Some(id) => {
        overwrite_book(tx, id, b, series_id, notes, added_at).await?;
        report.books_updated += 1;
        id
      }
      None => {
        let id = insert_book(tx, b, series_id, notes, added_at).await?;
        remember_book(&mut index, key, &b.title, id);
        report.books_added += 1;
        id
      }
    };

    applied.insert(b.book_id, host_id);

    let of = |m: &HashMap<i64, Vec<i64>>| m.get(&b.book_id).cloned().unwrap_or_default();
    let readings = readings_of
      .get(&b.book_id)
      .map(Vec::as_slice)
      .unwrap_or(&[]);
    link_book(
      tx,
      host_id,
      &of(&authors_of),
      &of(&tags_of),
      &of(&categories_of),
      &of(&shelves_of),
      readings,
    )
    .await?;
  }
  Ok(applied)
}

/// Replaces a live book's details with the backup's and clears its authors, tags, categories, shelves
/// and readings
/// (`link_book` puts the backup's back). The ISBN is what matched, so it's left as it is here.
async fn overwrite_book(
  tx: &mut Tx<'_>,
  id: i64,
  b: &Book,
  series_id: Option<i64>,
  notes: &str,
  added_at: &str,
) -> Res<()> {
  sqlx::query(
    "UPDATE book SET title = ?, publish_date = ?, blurb = ?, page_count = ?, series_id = ?,
                     series_position = ?, notes = ? WHERE book_id = ?",
  )
  .bind(&b.title)
  .bind(&b.publish_date)
  .bind(&b.blurb)
  .bind(b.page_count)
  .bind(series_id)
  .bind(b.series_position)
  .bind(notes)
  .bind(id)
  .execute(&mut **tx)
  .await?;
  // The book was in the library before the backup's copy was: keep whichever date is older.
  // (Unknown is '', which would always win the comparison, so it's skipped.)
  if !added_at.is_empty() {
    sqlx::query("UPDATE book SET added_at = ? WHERE book_id = ? AND ? < added_at")
      .bind(added_at)
      .bind(id)
      .bind(added_at)
      .execute(&mut **tx)
      .await?;
  }
  for table in ["book_author", "book_tag", "book_category", "book_shelf", "reading"] {
    sqlx::query(&format!("DELETE FROM {table} WHERE book_id = ?"))
      .bind(id)
      .execute(&mut **tx)
      .await?;
  }
  Ok(())
}

/// Inserts a book from the backup and returns its new id.
async fn insert_book(
  tx: &mut Tx<'_>,
  b: &Book,
  series_id: Option<i64>,
  notes: &str,
  added_at: &str,
) -> Res<i64> {
  let id: i64 = sqlx::query_scalar(
    "INSERT INTO book (title, isbn, publish_date, blurb, page_count, series_id,
                       series_position, notes, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING book_id",
  )
  .bind(&b.title)
  .bind(&b.isbn)
  .bind(&b.publish_date)
  .bind(&b.blurb)
  .bind(b.page_count)
  .bind(series_id)
  .bind(b.series_position)
  .bind(notes)
  .bind(added_at)
  .fetch_one(&mut **tx)
  .await?;
  Ok(id)
}

/// Attaches authors, tags, categories, shelves and readings (already mapped to live ids) to a live book.
async fn link_book(
  tx: &mut Tx<'_>,
  book_id: i64,
  author_ids: &[i64],
  tag_ids: &[i64],
  category_ids: &[i64],
  shelf_ids: &[i64],
  readings: &[&Reading],
) -> Res<()> {
  for author_id in author_ids {
    sqlx::query("INSERT OR IGNORE INTO book_author (book_id, author_id) VALUES (?, ?)")
      .bind(book_id)
      .bind(author_id)
      .execute(&mut **tx)
      .await?;
  }
  for tag_id in tag_ids {
    sqlx::query("INSERT OR IGNORE INTO book_tag (book_id, tag_id) VALUES (?, ?)")
      .bind(book_id)
      .bind(tag_id)
      .execute(&mut **tx)
      .await?;
  }
  for category_id in category_ids {
    sqlx::query("INSERT OR IGNORE INTO book_category (book_id, category_id) VALUES (?, ?)")
      .bind(book_id)
      .bind(category_id)
      .execute(&mut **tx)
      .await?;
  }
  for shelf_id in shelf_ids {
    sqlx::query("INSERT OR IGNORE INTO book_shelf (book_id, shelf_id) VALUES (?, ?)")
      .bind(book_id)
      .bind(shelf_id)
      .execute(&mut **tx)
      .await?;
  }
  for r in readings {
    insert_reading(tx, book_id, r).await?;
  }
  Ok(())
}
