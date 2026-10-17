use sqlx::SqlitePool;
use tauri::State;
use tauri_groups::command;

use super::{Res, util::delete_by_id};
use crate::models::Shelf;

#[command(db_crud)]
async fn create_shelf(pool: State<'_, SqlitePool>, name: String) -> Res<Shelf> {
  // New shelves go to the end of the tab row.
  Ok(
    sqlx::query_as::<_, Shelf>(
      "INSERT INTO shelf (name, position)
       SELECT ?, COALESCE(MAX(position), 0) + 1 FROM shelf RETURNING *",
    )
    .bind(name.trim())
    .fetch_one(pool.inner())
    .await?,
  )
}

#[command(db_crud)]
async fn get_shelf(pool: State<'_, SqlitePool>, shelf_id: i64) -> Res<Shelf> {
  Ok(
    sqlx::query_as::<_, Shelf>("SELECT * FROM shelf WHERE shelf_id = ?")
      .bind(shelf_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

/// In tab order.
#[command(db_crud)]
async fn list_shelves(pool: State<'_, SqlitePool>) -> Res<Vec<Shelf>> {
  Ok(
    sqlx::query_as::<_, Shelf>("SELECT * FROM shelf ORDER BY position, shelf_id")
      .fetch_all(pool.inner())
      .await?,
  )
}

/// Renames. The position is changed with `reorder_shelves`.
#[command(db_crud)]
async fn update_shelf(pool: State<'_, SqlitePool>, shelf_id: i64, name: String) -> Res<Shelf> {
  Ok(
    sqlx::query_as::<_, Shelf>("UPDATE shelf SET name = ? WHERE shelf_id = ? RETURNING *")
      .bind(name.trim())
      .bind(shelf_id)
      .fetch_one(pool.inner())
      .await?,
  )
}

/// Also takes the shelf off every book (book_shelf cascades). The books themselves stay.
#[command(db_crud)]
async fn delete_shelf(pool: State<'_, SqlitePool>, shelf_id: i64) -> Res<()> {
  delete_by_id(
    pool.inner(),
    "DELETE FROM shelf WHERE shelf_id = ?",
    shelf_id,
  )
  .await
}

/// `shelf_ids` is the new tab order. A shelf missing from the list keeps its place after the
/// listed ones, so a stale list can't lose a shelf.
#[command(db_crud)]
async fn reorder_shelves(pool: State<'_, SqlitePool>, shelf_ids: Vec<i64>) -> Res<()> {
  let mut tx = pool.begin().await?;
  for (i, id) in shelf_ids.iter().enumerate() {
    sqlx::query("UPDATE shelf SET position = ? WHERE shelf_id = ?")
      .bind(i as i64 + 1)
      .bind(*id)
      .execute(&mut *tx)
      .await?;
  }
  tx.commit().await?;
  Ok(())
}

#[command(db_crud)]
async fn get_book_shelves(pool: State<'_, SqlitePool>, book_id: i64) -> Res<Vec<Shelf>> {
  Ok(
    sqlx::query_as::<_, Shelf>(
      "SELECT s.* FROM shelf s
     JOIN book_shelf bs ON bs.shelf_id = s.shelf_id
     WHERE bs.book_id = ?
     ORDER BY s.position, s.shelf_id",
    )
    .bind(book_id)
    .fetch_all(pool.inner())
    .await?,
  )
}

/// Replaces the book's whole shelf set. Shelves have to exist already, a bogus id is a foreign
/// key error. Separate from `update_book` so editing a book's details never touches its shelves.
#[command(db_crud)]
async fn set_book_shelves(
  pool: State<'_, SqlitePool>,
  book_id: i64,
  shelf_ids: Vec<i64>,
) -> Res<()> {
  let mut tx = pool.begin().await?;
  sqlx::query("DELETE FROM book_shelf WHERE book_id = ?")
    .bind(book_id)
    .execute(&mut *tx)
    .await?;
  for id in &shelf_ids {
    sqlx::query("INSERT OR IGNORE INTO book_shelf (book_id, shelf_id) VALUES (?, ?)")
      .bind(book_id)
      .bind(*id)
      .execute(&mut *tx)
      .await?;
  }
  tx.commit().await?;
  Ok(())
}

/// Books that are on no shelf. The library shows them in its "Unshelved" tab, which is only
/// there when this is above zero.
#[command(db)]
async fn count_unshelved_books(pool: State<'_, SqlitePool>) -> Res<i64> {
  Ok(
    sqlx::query_scalar::<_, i64>(
      "SELECT COUNT(*) FROM book b
       WHERE NOT EXISTS (SELECT 1 FROM book_shelf bs WHERE bs.book_id = b.book_id)",
    )
    .fetch_one(pool.inner())
    .await?,
  )
}
