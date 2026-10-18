//! Backup and restore: the whole app (database, cover images, plugins and their configs,
//! settings) in one `.zip` file.
//!
//! ```text
//! free-lib-backup-<stamp>.zip
//!   manifest.json          what this is (format + version), so a random zip is refused
//!   db.sqlite              a consistent snapshot made with `VACUUM INTO`
//!   settings.json
//!   plugins/<id>.js, plugins/<id>.config.json
//!   cover-images/<book_id>.<ext>   (the id in db.sqlite; older backups named them <ISBN>.<ext>)
//! ```
//!
//! `create_backup` writes it wherever the user chose in the system save dialog (a path on
//! desktop, a `content://` URI on Android), so the file never ends up in the app's private storage.
//!
//! `import_backup` has three modes:
//!
//! - **Full replace**: the current library, covers, plugins and settings are wiped, then the
//!   backup is applied exactly as it was.
//! - **Append merge** ("host priority"): books are matched by ISBN. A book that already exists
//!   here is left completely alone: no database info, no cover, no notes and no readings are
//!   taken from the backup. Everything else in the backup is added.
//! - **Override merge** ("backup priority"): like append, but a book that exists here is
//!   overwritten by the backup's version (details, authors, tags, notes, readings and cover).
//!
//! Both merges also replace the settings file, add authors / series / tags / categories / shelves that are missing,
//! and add plugin files. Merging never deletes anything: a book, cover or plugin that is only
//! here stays. Plugin files that exist in both are kept (append) or overwritten (override).
//!
//! Books are matched by ISBN with dashes and spaces ignored. A book without an ISBN can't be
//! matched that way, so it matches a book here that also has no ISBN and the same title
//! (ignoring case).
//!
//! Covers are stored by book id (`covers`), and the ids in a backup are the backup's own. A full
//! replace keeps them. A merge gives new books new ids, so each cover follows its book to
//! whatever id it got (`files::cover_targets`); the cover of a book the merge left alone is
//! ignored. Backups made by versions that named covers after the ISBN are still read: those covers
//! are matched to their books by ISBN.
//!
//! Layout: `names` (entry / ISBN / file-name rules), `archive` (the zip, unpacking, where files
//! are saved), `db` (reading the backup database, replace and merge), `files` (covers and
//! plugin files), `tests`. This file has the two commands and the shared types.
//!
//! A backup made by an older version is upgraded by the migrations before it is read. One whose
//! database is missing optional tables or columns is read with those left empty, and each such
//! gap comes back in `ImportReport::warnings`; a missing core table or column refuses the import.
//!
//! The backup is unpacked and checked in a staging folder first, and the database part of an
//! import is a single transaction, so a bad file changes nothing.

use std::{
  collections::HashMap,
  fmt::Display,
  fs, io,
  path::PathBuf,
  sync::atomic::{AtomicBool, Ordering},
};

use serde::{Deserialize, Serialize, Serializer};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};
use tauri_groups::{TsType, command};

use crate::{plugins::Plugins, settings::Settings};

mod archive;
mod db;
mod files;
mod names;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_compat;

use archive::{Staged, fetch_source, save_to, unpack, write_archive};
use db::{merge_db, read_backup_db, replace_db};
use files::{apply_files, cover_targets};
use names::DB_FILE;

// SECTION: types

/// What to do with the current data when a backup is imported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub enum ImportMode {
  /// Delete everything, then apply the backup.
  FullReplace,
  /// Add what's missing; books that already exist keep their current data and cover.
  AppendMerge,
  /// Add what's missing; books that already exist are overwritten by the backup's version.
  OverrideMerge,
}

#[derive(Debug, Clone, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct CreatedBackup {
  /// Where the file was saved.
  pub path: String,
  pub size_bytes: u64,
  pub books: usize,
  pub covers: usize,
  pub plugins: usize,
}

/// What an import did. In a full replace the `*_added` counts are everything that came in.
#[derive(Debug, Clone, Default, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
  pub books_added: usize,
  /// Existing books overwritten by the backup (override merge only).
  pub books_updated: usize,
  /// Books in the backup that already existed and were left alone (append merge only).
  pub books_skipped: usize,
  pub authors_added: usize,
  pub series_added: usize,
  pub tags_added: usize,
  pub categories_added: usize,
  pub shelves_added: usize,
  pub covers_copied: usize,
  pub plugin_files_copied: usize,
  /// Parts of the backup that were missing or dropped without stopping the import (an older or
  /// slightly damaged backup). Empty for a normal one.
  pub warnings: Vec<String>,
}

// SECTION: errors

/// What every `backup` command rejects with. The frontend just sees a string.
#[derive(Debug)]
pub struct BackupError(String);

impl BackupError {
  fn new(msg: impl Into<String>) -> Self {
    Self(msg.into())
  }
}

impl Serialize for BackupError {
  fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&self.0)
  }
}

impl From<sqlx::Error> for BackupError {
  fn from(e: sqlx::Error) -> Self {
    BackupError(format!("database error: {e}"))
  }
}

type Res<T> = Result<T, BackupError>;

fn ctx<E: Display>(what: &str) -> impl FnOnce(E) -> BackupError + '_ {
  move |e| BackupError(format!("{what}: {e}"))
}

/// Only one backup or import at a time.
static BUSY: AtomicBool = AtomicBool::new(false);

struct BusyGuard;

impl BusyGuard {
  fn take() -> Res<Self> {
    if BUSY.swap(true, Ordering::SeqCst) {
      return Err(BackupError::new(
        "another backup or import is already running",
      ));
    }
    Ok(BusyGuard)
  }
}

impl Drop for BusyGuard {
  fn drop(&mut self) {
    BUSY.store(false, Ordering::SeqCst);
  }
}

/// A scratch folder that is deleted when it goes out of scope.
struct Scratch(PathBuf);

impl Scratch {
  fn fresh(path: PathBuf) -> io::Result<Self> {
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path)?;
    Ok(Scratch(path))
  }
}

impl Drop for Scratch {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

// SECTION: commands

fn app_data(app: &AppHandle) -> Res<PathBuf> {
  app.path().app_data_dir().map_err(ctx("no app data folder"))
}

/// Saves everything (database, covers, plugins, settings) as one `.zip` at `destination`, which
/// the user picked in the system save dialog: a plain path on desktop, a `content://` URI on
/// Android. The zip is built in the app's staging folder first, then copied out, so a failure
/// never leaves a half-written file at the destination. Returns where the file ended up.
#[command(backup)]
async fn create_backup(
  app: AppHandle,
  pool: State<'_, SqlitePool>,
  settings: State<'_, Settings>,
  destination: String,
) -> Res<CreatedBackup> {
  if destination.trim().is_empty() {
    return Err(BackupError::new("no save location was chosen"));
  }
  let _busy = BusyGuard::take()?;
  let data = app_data(&app)?;
  let scratch = Scratch::fresh(data.join("backup-staging")).map_err(ctx("couldn't prepare"))?;

  // A consistent copy even while the app is writing (the database runs in WAL mode).
  let snapshot = scratch.0.join(DB_FILE);
  sqlx::query("VACUUM INTO ?")
    .bind(snapshot.to_string_lossy().into_owned())
    .execute(pool.inner())
    .await?;
  let books: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM book")
    .fetch_one(pool.inner())
    .await?;

  let staged_zip = scratch.0.join("backup.zip");
  let settings = settings.all();
  let result = {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Res<CreatedBackup> {
      let file = fs::File::create(&staged_zip).map_err(ctx("couldn't prepare the backup file"))?;
      let (covers, plugins) = write_archive(file, &data, &snapshot, &settings)?;
      let size_bytes = save_to(&app, &staged_zip, &destination)?;
      Ok(CreatedBackup {
        size_bytes,
        path: destination,
        books: books as usize,
        covers,
        plugins,
      })
    })
    .await
    .map_err(ctx("backup task failed"))?
  };

  drop(scratch);
  result
}

#[command(backup)]
async fn import_backup(
  app: AppHandle,
  pool: State<'_, SqlitePool>,
  settings: State<'_, Settings>,
  plugins: State<'_, Plugins>,
  source: String,
  mode: ImportMode,
) -> Res<ImportReport> {
  let _busy = BusyGuard::take()?;
  let data = app_data(&app)?;
  let scratch = Scratch::fresh(data.join("import-staging")).map_err(ctx("couldn't prepare"))?;

  // unpack and validate
  let staged = {
    let (app, root) = (app.clone(), scratch.0.clone());
    tauri::async_runtime::spawn_blocking(move || -> Res<Staged> {
      let zip_path = root.join("backup.zip");
      fetch_source(&app, &source, &zip_path)?;
      let staged = unpack(&zip_path, &root.join("unpacked"))?;
      let _ = fs::remove_file(&zip_path);
      Ok(staged)
    })
    .await
    .map_err(ctx("import task failed"))??
  };
  let backup = read_backup_db(&staged.db()).await?;

  // database
  let mut report = ImportReport {
    warnings: backup.warnings.clone(),
    ..ImportReport::default()
  };
  // backup book id -> live book id, for every book the import wrote
  let applied: HashMap<i64, i64> = match mode {
    ImportMode::FullReplace => {
      replace_db(pool.inner(), &backup, &mut report).await?;
      backup.books.iter().map(|b| (b.book_id, b.book_id)).collect()
    }
    ImportMode::AppendMerge => merge_db(pool.inner(), &backup, false, &mut report).await?,
    ImportMode::OverrideMerge => merge_db(pool.inner(), &backup, true, &mut report).await?,
  };
  let book_covers = cover_targets(&staged, &backup.books, &applied);

  // files, settings, plugins
  let partial = |what: &str, e: &dyn Display| {
    BackupError(format!(
      "the library was imported, but {what}: {e}. Import the backup again to retry"
    ))
  };
  let new_settings = staged.settings.clone();
  let files_data = data.clone();
  let report = tauri::async_runtime::spawn_blocking(move || -> Res<ImportReport> {
    let mut report = report;
    apply_files(&files_data, &staged, mode, &book_covers, &mut report)
      .map_err(|e| partial("copying covers and plugins failed", &e))?;
    Ok(report)
  })
  .await
  .map_err(ctx("import task failed"))??;

  settings
    .replace(new_settings)
    .map_err(|e| partial("the settings couldn't be saved", &e))?;
  let plugin_state = plugins.inner().clone();
  tauri::async_runtime::spawn_blocking(move || plugin_state.reload_all())
    .await
    .map_err(ctx("import task failed"))?;

  drop(scratch);
  Ok(report)
}
