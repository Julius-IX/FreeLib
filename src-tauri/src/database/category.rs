use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::State;
use tauri_groups::{TsType, command};

use super::{Res, util::delete_by_id};
use crate::models::Category;

#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
  pub name: String,
  /// `#rrggbb`. Anything else trips the table's CHECK and comes back as "invalid value".
  pub color: String,
}

#[command(db_crud)]
async fn create_category(pool: State<'_, SqlitePool>, category: CategoryInput) -> Res<Category> {
  Ok(
    sqlx::query_as::<_, Category>("INSERT INTO category (name, color) VALUES (?, ?) RETURNING *")
      .bind(category.name)
      .bind(category.color)
      .fetch_one(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn get_category(pool: State<'_, SqlitePool>, category_id: i64) -> Res<Category> {
  Ok(
    sqlx::query_as::<_, Category>("SELECT * FROM category WHERE category_id = ?")
      .bind(category_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn list_categories(pool: State<'_, SqlitePool>) -> Res<Vec<Category>> {
  Ok(
    sqlx::query_as::<_, Category>("SELECT * FROM category ORDER BY name COLLATE NOCASE")
      .fetch_all(pool.inner())
      .await?,
  )
}

#[command(db_crud)]
async fn update_category(
  pool: State<'_, SqlitePool>,
  category_id: i64,
  category: CategoryInput,
) -> Res<Category> {
  Ok(
    sqlx::query_as::<_, Category>(
      "UPDATE category SET name = ?, color = ? WHERE category_id = ? RETURNING *",
    )
    .bind(category.name)
    .bind(category.color)
    .bind(category_id)
    .fetch_one(pool.inner())
    .await?,
  )
}

/// Also removes the category from every book (book_category cascades).
#[command(db_crud)]
async fn delete_category(pool: State<'_, SqlitePool>, category_id: i64) -> Res<()> {
  delete_by_id(
    pool.inner(),
    "DELETE FROM category WHERE category_id = ?",
    category_id,
  )
  .await
}
