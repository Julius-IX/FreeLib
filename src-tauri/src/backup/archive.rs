//! The zip itself: writing one (`write_archive`), and unpacking one into a staging folder with
//! every entry checked (`unpack`). Also where the backup is saved and where an import reads from.

use std::{
  fs,
  io::{self, Read, Write},
  path::{Path, PathBuf},
  time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri_plugin_fs::{FilePath, FsExt};
use zip::{CompressionMethod, write::SimpleFileOptions};

use super::names::{
  COVERS_PREFIX, DB_FILE, Entry, MANIFEST, PLUGINS_PREFIX, SETTINGS_FILE, classify, cover_isbn,
  is_plugin_file,
};
use super::{BackupError, Res, ctx};
use crate::{covers, plugins};

pub(super) const FORMAT: &str = "free-lib-backup";
pub(super) const FORMAT_VERSION: u32 = 1;

const MAX_DB_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;
const MAX_PLUGIN_BYTES: u64 = 512 * 1024;
const MAX_COVER_BYTES: u64 = 15 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Manifest {
  format: String,
  format_version: u32,
  app_version: String,
  /// Unix seconds.
  created_at: u64,
}

/// A path or an Android `content://` URI, as the fs plugin wants it.
fn file_path(s: &str) -> FilePath {
  s.trim().parse().expect("FilePath::from_str is infallible")
}

/// Copies the finished zip to the location the user picked. `destination` is whatever the save
/// dialog returned: a file path on desktop, a `content://` URI on Android. The fs plugin opens
/// both. Returns the number of bytes written.
pub(super) fn save_to(app: &AppHandle, zip: &Path, destination: &str) -> Res<u64> {
  let path = file_path(destination);
  let mut opts = tauri_plugin_fs::OpenOptions::new();
  opts.write(true).create(true).truncate(true);
  let mut out = app
    .fs()
    .open(path, opts)
    .map_err(ctx("couldn't open the chosen location"))?;
  let mut src = fs::File::open(zip).map_err(ctx("couldn't read the backup file"))?;
  let written = io::copy(&mut src, &mut out).map_err(ctx("couldn't save the backup"))?;
  out.flush().map_err(ctx("couldn't save the backup"))?;
  out.sync_all().map_err(ctx("couldn't save the backup"))?;
  Ok(written)
}

pub(super) fn files_in(dir: &Path, keep: impl Fn(&str) -> bool) -> Vec<(String, PathBuf)> {
  let Ok(read) = fs::read_dir(dir) else {
    return vec![];
  };
  let mut out: Vec<_> = read
    .flatten()
    .filter(|e| e.path().is_file())
    .filter_map(|e| {
      let name = e.file_name().to_string_lossy().into_owned();
      keep(&name).then(|| (name, e.path()))
    })
    .collect();
  out.sort();
  out
}

type Zip = zip::ZipWriter<io::BufWriter<fs::File>>;

fn zip_err(e: zip::result::ZipError) -> BackupError {
  BackupError(format!("couldn't write the backup: {e}"))
}

/// Adds an entry made of in-memory bytes.
fn add_bytes(zip: &mut Zip, name: &str, bytes: &[u8], opts: SimpleFileOptions) -> Res<()> {
  zip.start_file(name, opts).map_err(zip_err)?;
  zip
    .write_all(bytes)
    .map_err(ctx("couldn't write the backup"))
}

/// Adds an entry streamed from a file on disk. `what` names it in error messages.
fn add_file(
  zip: &mut Zip,
  name: &str,
  path: &Path,
  opts: SimpleFileOptions,
  what: &str,
) -> Res<()> {
  zip.start_file(name, opts).map_err(zip_err)?;
  let mut f = fs::File::open(path).map_err(ctx(what))?;
  io::copy(&mut f, zip).map_err(ctx("couldn't write the backup"))?;
  Ok(())
}

/// Adds every file in `files` under `prefix/`.
fn add_files(
  zip: &mut Zip,
  prefix: &str,
  files: &[(String, PathBuf)],
  opts: SimpleFileOptions,
  what: &str,
) -> Res<()> {
  for (name, path) in files {
    add_file(zip, &format!("{prefix}{name}"), path, opts, what)?;
  }
  Ok(())
}

fn manifest_json() -> Vec<u8> {
  let manifest = Manifest {
    format: FORMAT.into(),
    format_version: FORMAT_VERSION,
    app_version: env!("CARGO_PKG_VERSION").into(),
    created_at: SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|d| d.as_secs())
      .unwrap_or(0),
  };
  serde_json::to_vec_pretty(&manifest).unwrap_or_default()
}

/// Writes the archive. `db_snapshot` is an already-made copy of the database.
pub(super) fn write_archive(
  out: fs::File,
  data: &Path,
  db_snapshot: &Path,
  settings: &Map<String, Value>,
) -> Res<(usize, usize)> {
  let packed = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
  // images are compressed already
  let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
  let mut zip = Zip::new(io::BufWriter::new(out));

  add_bytes(&mut zip, MANIFEST, &manifest_json(), packed)?;
  let settings_json = serde_json::to_vec_pretty(settings).unwrap_or_default();
  add_bytes(&mut zip, SETTINGS_FILE, &settings_json, packed)?;
  add_file(
    &mut zip,
    DB_FILE,
    db_snapshot,
    packed,
    "couldn't read the database copy",
  )?;

  let plugin_files = files_in(&data.join(plugins::DIR_NAME), is_plugin_file);
  add_files(
    &mut zip,
    PLUGINS_PREFIX,
    &plugin_files,
    packed,
    "couldn't read a plugin file",
  )?;
  let cover_files = files_in(&data.join(covers::DIR_NAME), |n| cover_isbn(n).is_some());
  add_files(
    &mut zip,
    COVERS_PREFIX,
    &cover_files,
    stored,
    "couldn't read a cover",
  )?;

  let mut w = zip.finish().map_err(zip_err)?;
  w.flush().map_err(ctx("couldn't write the backup"))?;
  Ok((cover_files.len(), plugin_files.len()))
}

/// A backup unpacked into the staging folder and checked.
pub(super) struct Staged {
  pub(super) root: PathBuf,
  pub(super) settings: Map<String, Value>,
  /// File names (`<id>.js`, `<id>.config.json`).
  pub(super) plugin_files: Vec<String>,
  /// `(ISBN, file name)`.
  pub(super) covers: Vec<(String, String)>,
}

impl Staged {
  pub(super) fn db(&self) -> PathBuf {
    self.root.join(DB_FILE)
  }
  pub(super) fn plugin_path(&self, file: &str) -> PathBuf {
    self.root.join("plugins").join(file)
  }
  pub(super) fn cover_path(&self, file: &str) -> PathBuf {
    self.root.join("covers").join(file)
  }
}

pub(super) fn not_a_backup() -> BackupError {
  BackupError::new("this isn't a Free Lib backup file")
}

pub(super) fn copy_limited(from: &mut impl Read, to: &Path, limit: u64) -> Res<()> {
  let mut out = fs::File::create(to).map_err(ctx("couldn't unpack the backup"))?;
  let n =
    io::copy(&mut from.take(limit + 1), &mut out).map_err(ctx("couldn't unpack the backup"))?;
  if n > limit {
    return Err(BackupError::new(
      "the backup contains a file that is far larger than it should be",
    ));
  }
  out.flush().map_err(ctx("couldn't unpack the backup"))
}

/// Reads and checks `manifest.json`, so a random zip, or one from a newer app, is refused.
fn check_manifest(zip: &mut zip::ZipArchive<fs::File>) -> Res<()> {
  let manifest: Manifest = {
    let mut entry = zip.by_name(MANIFEST).map_err(|_| not_a_backup())?;
    let mut text = String::new();
    entry
      .by_ref()
      .take(64 * 1024)
      .read_to_string(&mut text)
      .map_err(|_| not_a_backup())?;
    serde_json::from_str(&text).map_err(|_| not_a_backup())?
  };
  if manifest.format != FORMAT {
    return Err(not_a_backup());
  }
  if manifest.format_version > FORMAT_VERSION {
    return Err(BackupError::new(format!(
      "this backup was made by a newer version of the app (v{}). Update the app to import it",
      manifest.app_version
    )));
  }
  Ok(())
}

/// Reads `settings.json`: size-limited, and it must be a JSON object.
fn read_settings(entry: &mut impl Read) -> Res<Map<String, Value>> {
  let mut text = String::new();
  entry
    .by_ref()
    .take(MAX_SETTINGS_BYTES + 1)
    .read_to_string(&mut text)
    .map_err(|_| BackupError::new("the backup's settings aren't readable"))?;
  if text.len() as u64 > MAX_SETTINGS_BYTES {
    return Err(BackupError::new("the backup's settings file is too large"));
  }
  match serde_json::from_str::<Value>(&text) {
    Ok(Value::Object(map)) => Ok(map),
    _ => Err(BackupError::new("the backup's settings aren't valid")),
  }
}

/// Unpacks one entry into the staging folder and records it in `staged`.
fn unpack_entry(entry: &mut impl Read, kind: Entry, staged: &mut Staged) -> Res<()> {
  match kind {
    Entry::Manifest => {}
    Entry::Db => copy_limited(entry, &staged.db(), MAX_DB_BYTES)?,
    Entry::Settings => staged.settings = read_settings(entry)?,
    Entry::Plugin(name) => {
      copy_limited(entry, &staged.plugin_path(&name), MAX_PLUGIN_BYTES)?;
      staged.plugin_files.push(name);
    }
    Entry::Cover(name) => {
      copy_limited(entry, &staged.cover_path(&name), MAX_COVER_BYTES)?;
      let isbn = cover_isbn(&name).expect("classify checked this");
      staged.covers.push((isbn, name));
    }
  }
  Ok(())
}

pub(super) fn unpack(zip_file: &Path, root: &Path) -> Res<Staged> {
  let file = fs::File::open(zip_file).map_err(ctx("couldn't open the backup"))?;
  let mut zip = zip::ZipArchive::new(file).map_err(|_| not_a_backup())?;
  check_manifest(&mut zip)?;

  fs::create_dir_all(root.join("plugins")).map_err(ctx("couldn't unpack the backup"))?;
  fs::create_dir_all(root.join("covers")).map_err(ctx("couldn't unpack the backup"))?;
  let mut staged = Staged {
    root: root.to_path_buf(),
    settings: Map::new(),
    plugin_files: vec![],
    covers: vec![],
  };
  let mut has_db = false;

  for i in 0..zip.len() {
    let mut entry = zip.by_index(i).map_err(|_| not_a_backup())?;
    if entry.is_dir() {
      continue;
    }
    let Some(kind) = classify(entry.name()) else {
      continue;
    };
    has_db |= matches!(kind, Entry::Db);
    unpack_entry(&mut entry, kind, &mut staged)?;
  }
  if !has_db {
    return Err(BackupError::new("the backup has no database"));
  }
  Ok(staged)
}

/// Copies the picked file (a path, or an Android `content://` URI) into the staging folder.
pub(super) fn fetch_source(app: &AppHandle, source: &str, to: &Path) -> Res<()> {
  let path = file_path(source);
  let mut opts = tauri_plugin_fs::OpenOptions::new();
  opts.read(true);
  let mut from = app
    .fs()
    .open(path, opts)
    .map_err(ctx("couldn't open the backup file"))?;
  let mut out = fs::File::create(to).map_err(ctx("couldn't read the backup file"))?;
  io::copy(&mut from, &mut out).map_err(ctx("couldn't read the backup file"))?;
  Ok(())
}
