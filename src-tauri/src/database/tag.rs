use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::State;
use tauri_groups::{TsType, command};

use super::{Res, util::delete_by_id};
use crate::models::Tag;

#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct TagInput {
  pub tag_type_id: i64,
  pub name: String,
}

/// Tag names are stored trimmed and lower-cased, whatever the caller sends. Doing it here (not in
/// each caller) means no code path, scan, form or import, can leave a "Fantasy" next to a "fantasy".
fn norm_tag_name(name: &str) -> String {
  name.trim().to_lowercase()
}

#[command(db_crud)]
async fn create_tag(pool: State<'_, SqlitePool>, tag: TagInput) -> Res<Tag> {
  Ok(
    sqlx::query_as::<_, Tag>("INSERT INTO tag (tag_type_id, name) VALUES (?, ?) RETURNING *")
      .bind(tag.tag_type_id)
      .bind(norm_tag_name(&tag.name))
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
    .bind(norm_tag_name(&tag.name))
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
