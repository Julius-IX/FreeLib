use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::State;
use tauri_groups::{TsType, command};

use super::{Res, util::delete_by_id};
use crate::models::Reading;

#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct ReadingInput {
  pub book_id: i64,
  pub date_started: Option<String>,
  pub date_finished: Option<String>,
}

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
