use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::State;
use tauri_groups::{TsType, command};

use super::{Res, util::delete_by_id};
use crate::models::Author;

#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct AuthorInput {
  pub name: String,
  pub birth_date: Option<String>,
  pub death_date: Option<String>,
}

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
