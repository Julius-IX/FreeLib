use serde::Deserialize;
use sqlx::{SqliteConnection, SqlitePool};
use tauri::State;
use tauri_groups::{TsType, command};

use super::{Res, util::delete_by_id};
use crate::models::{Author, Book, Tag};

// The junction tables don't get their own CRUD: authors and tags travel with
// the book as id lists and are written in the same transaction as the row.

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

/// The book's markdown notes. `""` when it has none.
#[command(db_crud)]
async fn get_book_notes(pool: State<'_, SqlitePool>, book_id: i64) -> Res<String> {
  Ok(
    sqlx::query_scalar::<_, String>("SELECT notes FROM book WHERE book_id = ?")
      .bind(book_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

/// Replaces the whole notes string. Separate from `update_book` so editing a
/// book's details can never wipe its notes (and notes autosave stays cheap).
#[command(db_crud)]
async fn update_book_notes(pool: State<'_, SqlitePool>, book_id: i64, notes: String) -> Res<()> {
  let n = sqlx::query("UPDATE book SET notes = ? WHERE book_id = ?")
    .bind(notes)
    .bind(book_id)
    .execute(pool.inner())
    .await?
    .rows_affected();
  if n == 0 {
    return Err(sqlx::Error::RowNotFound.into());
  }
  Ok(())
}

/// Full replacement, authors and tags included. Notes are untouched.
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
