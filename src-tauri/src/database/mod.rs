use sqlx::{
  SqlitePool,
  sqlite::{SqliteConnectOptions, SqliteJournalMode},
};
use tauri::Manager;

mod author;
mod book;
mod category;
mod error;
mod reading;
mod series;
mod tag;
mod tag_type;
mod util;

#[allow(unused_imports)]
pub use author::AuthorInput;
#[allow(unused_imports)]
pub use book::BookInput;
#[allow(unused_imports)]
pub use error::DbError;
#[allow(unused_imports)]
pub use reading::ReadingInput;
#[allow(unused_imports)]
pub use tag::TagInput;

pub(crate) use error::Res;

pub fn init_db(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
  if app.try_state::<SqlitePool>().is_some() {
    return Ok(());
  }

  let dir = app.path().app_data_dir()?;
  std::fs::create_dir_all(&dir)?;

  let opts = SqliteConnectOptions::new()
    .filename(dir.join("db.sqlite"))
    .create_if_missing(true)
    .journal_mode(SqliteJournalMode::Wal)
    .foreign_keys(true);

  let pool = tauri::async_runtime::block_on(async {
    let pool = SqlitePool::connect_with(opts).await?;
    sqlx::migrate!().run(&pool).await?;
    Ok::<_, Box<dyn std::error::Error>>(pool)
  })?;

  app.manage(pool);
  Ok(())
}
