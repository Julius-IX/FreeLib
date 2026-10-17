use sqlx::SqlitePool;
use tauri::State;
use tauri_groups::command;

use super::{Res, util::delete_by_id};
use crate::models::TagType;

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
