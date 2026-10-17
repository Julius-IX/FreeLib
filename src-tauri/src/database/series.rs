use sqlx::SqlitePool;
use tauri::State;
use tauri_groups::command;

use super::{Res, util::delete_by_id};
use crate::models::Series;

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
