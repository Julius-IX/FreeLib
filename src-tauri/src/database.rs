use serde::{Deserialize, Serialize, Serializer};
use sqlx::{
  SqliteConnection, SqlitePool,
  sqlite::{SqliteConnectOptions, SqliteJournalMode},
};
use tauri::{Manager, State};
use tauri_groups::{TsType, command};

use crate::models::{Author, Book, Reading, Series, Tag, TagType};

pub fn init_db(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
  if app.try_state::<SqlitePool>().is_some() {
    return Ok(());
  }

  let dir = app.path().app_data_dir()?;
  std::fs::create_dir_all(&dir)?;

  let opts = SqliteConnectOptions::new()
    .filename(dir.join("db.sqlite"))
    .create_if_missing(true)
    .journal_mode(SqliteJournalMode::Wal)
    .foreign_keys(true);

  let pool = tauri::async_runtime::block_on(async {
    let pool = SqlitePool::connect_with(opts).await?;
    sqlx::migrate!().run(&pool).await?;
    Ok::<_, Box<dyn std::error::Error>>(pool)
  })?;

  app.manage(pool);
  Ok(())
}

// SECTION: errors

/// What every `db` command rejects with. The frontend just sees a string.
#[derive(Debug)]
pub struct DbError(String);

impl From<sqlx::Error> for DbError {
  fn from(e: sqlx::Error) -> Self {
    let msg = match &e {
      sqlx::Error::RowNotFound => "not found".to_string(),
      sqlx::Error::Database(d) if d.is_unique_violation() => {
        format!("already exists ({})", d.message())
      }
      // needs `PRAGMA foreign_keys = ON` (set in the migration)
      sqlx::Error::Database(d) if d.is_foreign_key_violation() => {
        "still referenced by other rows, or points at a row that doesn't exist".to_string()
      }
      sqlx::Error::Database(d) if d.is_check_violation() => {
        format!("invalid value ({})", d.message())
      }
      _ => e.to_string(),
    };
    DbError(msg)
  }
}

impl Serialize for DbError {
  fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&self.0)
  }
}

type Res<T> = Result<T, DbError>;

// SECTION: inputs

#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct AuthorInput {
  pub name: String,
  pub birth_date: Option<String>,
  pub death_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct BookInput {
  pub title: String,
  pub isbn: Option<String>,
  pub publish_date: Option<String>,
  pub blurb: Option<String>,
  pub page_count: Option<i64>,
  pub series_id: Option<i64>,
  pub series_position: Option<f64>,
  /// Replaces the book's whole author set.
  pub author_ids: Vec<i64>,
  /// Replaces the book's whole tag set.
  pub tag_ids: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct TagInput {
  pub tag_type_id: i64,
  pub name: String,
}

#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct ReadingInput {
  pub book_id: i64,
  pub date_started: Option<String>,
  pub date_finished: Option<String>,
}

// SECTION: helpers

async fn delete_by_id(pool: &SqlitePool, sql: &'static str, id: i64) -> Res<()> {
  let n = sqlx::query(sql)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
  if n == 0 {
    return Err(sqlx::Error::RowNotFound.into());
  }
  Ok(())
}

/// Wipe and rewrite a book's author links. Run inside the caller's transaction.
async fn set_book_authors(conn: &mut SqliteConnection, book_id: i64, ids: &[i64]) -> Res<()> {
  sqlx::query("DELETE FROM book_author WHERE book_id = ?")
    .bind(book_id)
    .execute(&mut *conn)
    .await?;
  for id in ids {
    // OR IGNORE swallows duplicate ids in the input, but NOT foreign key
    // violations, so a bogus author id still errors out.
    sqlx::query("INSERT OR IGNORE INTO book_author (book_id, author_id) VALUES (?, ?)")
      .bind(book_id)
      .bind(*id)
      .execute(&mut *conn)
      .await?;
  }
  Ok(())
}

async fn set_book_tags(conn: &mut SqliteConnection, book_id: i64, ids: &[i64]) -> Res<()> {
  sqlx::query("DELETE FROM book_tag WHERE book_id = ?")
    .bind(book_id)
    .execute(&mut *conn)
    .await?;
  for id in ids {
    sqlx::query("INSERT OR IGNORE INTO book_tag (book_id, tag_id) VALUES (?, ?)")
      .bind(book_id)
      .bind(*id)
      .execute(&mut *conn)
      .await?;
  }
  Ok(())
}

// SECTION: author

#[command(db_crud)]
async fn create_author(pool: State<'_, SqlitePool>, author: AuthorInput) -> Res<Author> {
  Ok(
    sqlx::query_as::<_, Author>(
      "INSERT INTO author (name, birth_date, death_date) VALUES (?, ?, ?) RETURNING *",
    )
    .bind(author.name)
    .bind(author.birth_date)
    .bind(author.death_date)
    .fetch_one(pool.inner())
    .await?,
  )
}

#[command(db_crud)]
async fn get_author(pool: State<'_, SqlitePool>, author_id: i64) -> Res<Author> {
  Ok(
    sqlx::query_as::<_, Author>("SELECT * FROM author WHERE author_id = ?")
      .bind(author_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn list_authors(pool: State<'_, SqlitePool>) -> Res<Vec<Author>> {
  Ok(
    sqlx::query_as::<_, Author>("SELECT * FROM author ORDER BY name COLLATE NOCASE")
      .fetch_all(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn update_author(
  pool: State<'_, SqlitePool>,
  author_id: i64,
  author: AuthorInput,
) -> Res<Author> {
  Ok(
    sqlx::query_as::<_, Author>(
      "UPDATE author SET name = ?, birth_date = ?, death_date = ?
     WHERE author_id = ? RETURNING *",
    )
    .bind(author.name)
    .bind(author.birth_date)
    .bind(author.death_date)
    .bind(author_id)
    .fetch_one(pool.inner())
    .await?,
  )
}

/// Fails while the author is still attached to any book (book_author has no cascade on this side).
#[command(db_crud)]
async fn delete_author(pool: State<'_, SqlitePool>, author_id: i64) -> Res<()> {
  delete_by_id(
    pool.inner(),
    "DELETE FROM author WHERE author_id = ?",
    author_id,
  )
  .await
}

// SECTION: series

#[command(db_crud)]
async fn create_series(pool: State<'_, SqlitePool>, name: String) -> Res<Series> {
  Ok(
    sqlx::query_as::<_, Series>("INSERT INTO series (name) VALUES (?) RETURNING *")
      .bind(name)
      .fetch_one(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn get_series(pool: State<'_, SqlitePool>, series_id: i64) -> Res<Series> {
  Ok(
    sqlx::query_as::<_, Series>("SELECT * FROM series WHERE series_id = ?")
      .bind(series_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn list_series(pool: State<'_, SqlitePool>) -> Res<Vec<Series>> {
  Ok(
    sqlx::query_as::<_, Series>("SELECT * FROM series ORDER BY name COLLATE NOCASE")
      .fetch_all(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn update_series(pool: State<'_, SqlitePool>, series_id: i64, name: String) -> Res<Series> {
  Ok(
    sqlx::query_as::<_, Series>("UPDATE series SET name = ? WHERE series_id = ? RETURNING *")
      .bind(name)
      .bind(series_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

/// Fails while any book still belongs to the series.
#[command(db_crud)]
async fn delete_series(pool: State<'_, SqlitePool>, series_id: i64) -> Res<()> {
  delete_by_id(
    pool.inner(),
    "DELETE FROM series WHERE series_id = ?",
    series_id,
  )
  .await
}

// SECTION: tag_type

#[command(db_crud)]
async fn create_tag_type(pool: State<'_, SqlitePool>, name: String) -> Res<TagType> {
  Ok(
    sqlx::query_as::<_, TagType>("INSERT INTO tag_type (name) VALUES (?) RETURNING *")
      .bind(name)
      .fetch_one(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn get_tag_type(pool: State<'_, SqlitePool>, tag_type_id: i64) -> Res<TagType> {
  Ok(
    sqlx::query_as::<_, TagType>("SELECT * FROM tag_type WHERE tag_type_id = ?")
      .bind(tag_type_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn list_tag_types(pool: State<'_, SqlitePool>) -> Res<Vec<TagType>> {
  Ok(
    sqlx::query_as::<_, TagType>("SELECT * FROM tag_type ORDER BY tag_type_id")
      .fetch_all(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn update_tag_type(
  pool: State<'_, SqlitePool>,
  tag_type_id: i64,
  name: String,
) -> Res<TagType> {
  Ok(
    sqlx::query_as::<_, TagType>("UPDATE tag_type SET name = ? WHERE tag_type_id = ? RETURNING *")
      .bind(name)
      .bind(tag_type_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

/// Fails while any tag still uses this type.
#[command(db_crud)]
async fn delete_tag_type(pool: State<'_, SqlitePool>, tag_type_id: i64) -> Res<()> {
  delete_by_id(
    pool.inner(),
    "DELETE FROM tag_type WHERE tag_type_id = ?",
    tag_type_id,
  )
  .await
}

// SECTION: tag

#[command(db_crud)]
async fn create_tag(pool: State<'_, SqlitePool>, tag: TagInput) -> Res<Tag> {
  Ok(
    sqlx::query_as::<_, Tag>("INSERT INTO tag (tag_type_id, name) VALUES (?, ?) RETURNING *")
      .bind(tag.tag_type_id)
      .bind(tag.name)
      .fetch_one(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn get_tag(pool: State<'_, SqlitePool>, tag_id: i64) -> Res<Tag> {
  Ok(
    sqlx::query_as::<_, Tag>("SELECT * FROM tag WHERE tag_id = ?")
      .bind(tag_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

/// Pass `tagTypeId` to only get tags of one type (e.g. all genres).
#[command(db_crud)]
async fn list_tags(pool: State<'_, SqlitePool>, tag_type_id: Option<i64>) -> Res<Vec<Tag>> {
  Ok(
    sqlx::query_as::<_, Tag>(
      "SELECT * FROM tag WHERE (?1 IS NULL OR tag_type_id = ?1) ORDER BY name COLLATE NOCASE",
    )
    .bind(tag_type_id)
    .fetch_all(pool.inner())
    .await?,
  )
}

#[command(db_crud)]
async fn update_tag(pool: State<'_, SqlitePool>, tag_id: i64, tag: TagInput) -> Res<Tag> {
  Ok(
    sqlx::query_as::<_, Tag>(
      "UPDATE tag SET tag_type_id = ?, name = ? WHERE tag_id = ? RETURNING *",
    )
    .bind(tag.tag_type_id)
    .bind(tag.name)
    .bind(tag_id)
    .fetch_one(pool.inner())
    .await?,
  )
}

/// Also removes the tag from every book (book_tag cascades).
#[command(db_crud)]
async fn delete_tag(pool: State<'_, SqlitePool>, tag_id: i64) -> Res<()> {
  delete_by_id(pool.inner(), "DELETE FROM tag WHERE tag_id = ?", tag_id).await
}

// SECTION: book (+ book_author, book_tag)
// The junction tables don't get their own CRUD: authors and tags travel with
// the book as id lists and are written in the same transaction as the row.

#[command(db_crud)]
async fn create_book(pool: State<'_, SqlitePool>, book: BookInput) -> Res<Book> {
  let mut tx = pool.begin().await?;

  let row = sqlx::query_as::<_, Book>(
    "INSERT INTO book (title, isbn, publish_date, blurb, page_count, series_id, series_position)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
  )
  .bind(book.title)
  .bind(book.isbn)
  .bind(book.publish_date)
  .bind(book.blurb)
  .bind(book.page_count)
  .bind(book.series_id)
  .bind(book.series_position)
  .fetch_one(&mut *tx)
  .await?;

  set_book_authors(&mut tx, row.book_id, &book.author_ids).await?;
  set_book_tags(&mut tx, row.book_id, &book.tag_ids).await?;

  tx.commit().await?;
  Ok(row)
}

#[command(db_crud)]
async fn get_book(pool: State<'_, SqlitePool>, book_id: i64) -> Res<Book> {
  Ok(
    sqlx::query_as::<_, Book>("SELECT * FROM book WHERE book_id = ?")
      .bind(book_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

/// Every filter is optional and they stack (AND).
#[command(db_crud)]
async fn list_books(
  pool: State<'_, SqlitePool>,
  series_id: Option<i64>,
  author_id: Option<i64>,
  tag_id: Option<i64>,
) -> Res<Vec<Book>> {
  Ok(
    sqlx::query_as::<_, Book>(
      "SELECT b.* FROM book b
     WHERE (?1 IS NULL OR b.series_id = ?1)
       AND (?2 IS NULL OR EXISTS (
             SELECT 1 FROM book_author ba
             WHERE ba.book_id = b.book_id AND ba.author_id = ?2))
       AND (?3 IS NULL OR EXISTS (
             SELECT 1 FROM book_tag bt
             WHERE bt.book_id = b.book_id AND bt.tag_id = ?3))
     ORDER BY b.title COLLATE NOCASE",
    )
    .bind(series_id)
    .bind(author_id)
    .bind(tag_id)
    .fetch_all(pool.inner())
    .await?,
  )
}

#[command(db_crud)]
async fn get_book_authors(pool: State<'_, SqlitePool>, book_id: i64) -> Res<Vec<Author>> {
  Ok(
    sqlx::query_as::<_, Author>(
      "SELECT a.* FROM author a
     JOIN book_author ba ON ba.author_id = a.author_id
     WHERE ba.book_id = ?
     ORDER BY a.name COLLATE NOCASE",
    )
    .bind(book_id)
    .fetch_all(pool.inner())
    .await?,
  )
}

#[command(db_crud)]
async fn get_book_tags(pool: State<'_, SqlitePool>, book_id: i64) -> Res<Vec<Tag>> {
  Ok(
    sqlx::query_as::<_, Tag>(
      "SELECT t.* FROM tag t
     JOIN book_tag bt ON bt.tag_id = t.tag_id
     WHERE bt.book_id = ?
     ORDER BY t.name COLLATE NOCASE",
    )
    .bind(book_id)
    .fetch_all(pool.inner())
    .await?,
  )
}

/// Full replacement, authors and tags included.
#[command(db_crud)]
async fn update_book(pool: State<'_, SqlitePool>, book_id: i64, book: BookInput) -> Res<Book> {
  let mut tx = pool.begin().await?;

  let row = sqlx::query_as::<_, Book>(
    "UPDATE book
     SET title = ?, isbn = ?, publish_date = ?, blurb = ?,
         page_count = ?, series_id = ?, series_position = ?
     WHERE book_id = ? RETURNING *",
  )
  .bind(book.title)
  .bind(book.isbn)
  .bind(book.publish_date)
  .bind(book.blurb)
  .bind(book.page_count)
  .bind(book.series_id)
  .bind(book.series_position)
  .bind(book_id)
  .fetch_one(&mut *tx)
  .await?;

  set_book_authors(&mut tx, book_id, &book.author_ids).await?;
  set_book_tags(&mut tx, book_id, &book.tag_ids).await?;

  tx.commit().await?;
  Ok(row)
}

/// Also deletes the book's author links, tag links and readings (all cascade).
#[command(db_crud)]
async fn delete_book(pool: State<'_, SqlitePool>, book_id: i64) -> Res<()> {
  delete_by_id(pool.inner(), "DELETE FROM book WHERE book_id = ?", book_id).await
}

// SECTION: reading

#[command(db_crud)]
async fn create_reading(pool: State<'_, SqlitePool>, reading: ReadingInput) -> Res<Reading> {
  Ok(
    sqlx::query_as::<_, Reading>(
      "INSERT INTO reading (book_id, date_started, date_finished) VALUES (?, ?, ?) RETURNING *",
    )
    .bind(reading.book_id)
    .bind(reading.date_started)
    .bind(reading.date_finished)
    .fetch_one(pool.inner())
    .await?,
  )
}

#[command(db_crud)]
async fn get_reading(pool: State<'_, SqlitePool>, reading_id: i64) -> Res<Reading> {
  Ok(
    sqlx::query_as::<_, Reading>("SELECT * FROM reading WHERE reading_id = ?")
      .bind(reading_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

/// Newest first. Pass `bookId` for one book's read-throughs.
#[command(db_crud)]
async fn list_readings(pool: State<'_, SqlitePool>, book_id: Option<i64>) -> Res<Vec<Reading>> {
  Ok(
    sqlx::query_as::<_, Reading>(
      "SELECT * FROM reading WHERE (?1 IS NULL OR book_id = ?1)
     ORDER BY date_started DESC, reading_id DESC",
    )
    .bind(book_id)
    .fetch_all(pool.inner())
    .await?,
  )
}

#[command(db_crud)]
async fn update_reading(
  pool: State<'_, SqlitePool>,
  reading_id: i64,
  reading: ReadingInput,
) -> Res<Reading> {
  Ok(
    sqlx::query_as::<_, Reading>(
      "UPDATE reading SET book_id = ?, date_started = ?, date_finished = ?
     WHERE reading_id = ? RETURNING *",
    )
    .bind(reading.book_id)
    .bind(reading.date_started)
    .bind(reading.date_finished)
    .bind(reading_id)
    .fetch_one(pool.inner())
    .await?,
  )
}

#[command(db_crud)]
async fn delete_reading(pool: State<'_, SqlitePool>, reading_id: i64) -> Res<()> {
  delete_by_id(
    pool.inner(),
    "DELETE FROM reading WHERE reading_id = ?",
    reading_id,
  )
  .await
}
