use sqlx::{SqlitePool, sqlite::SqliteConnectOptions};
use tauri::Manager;

pub fn init_db(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
  if app.try_state::<SqlitePool>().is_some() { return Ok(()) }

  let dir = app.path().app_data_dir()?;
  std::fs::create_dir_all(&dir)?;

  let opts = SqliteConnectOptions::new()
    .filename(dir.join("db.sqlite"))
    .create_if_missing(true);

  let pool = tauri::async_runtime::block_on(async {
    let pool = SqlitePool::connect_with(opts).await?;
    sqlx::migrate!().run(&pool).await?;
    Ok::<_, Box<dyn std::error::Error>>(pool)
  })?;

  app.manage(pool);
  Ok(())
}
