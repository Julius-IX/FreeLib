use sqlx::SqlitePool;

use super::Res;

pub(super) async fn delete_by_id(pool: &SqlitePool, sql: &'static str, id: i64) -> Res<()> {
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
