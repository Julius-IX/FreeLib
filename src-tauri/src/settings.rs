//! A small key-value store for UI state (theme, toggles, dropdowns, ...), saved as one JSON
//! file: `<app data dir>/settings.json`. Rust uses `Settings` directly (managed Tauri state);
//! the frontend uses the `settings` commands, see `src/lib/settings.ts`.
//!
//! Keys are plain strings, values are any JSON. Every `set` is written to disk right away.
//!
//! Only the keys listed in `KNOWN` are kept. Whatever else is in the file (a setting that was
//! removed from the app, a typo, hand-edited junk) is dropped when the file is loaded, and every
//! save rewrites the whole file from the current settings, so the file can't slowly collect keys
//! nothing reads anymore. To add a setting: add its key to `KNOWN`, and its default (and check)
//! in `src/lib/settings.ts`.

use std::{
  collections::HashMap,
  fs, io,
  io::Write,
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
};

use serde::{Serialize, Serializer, de::DeserializeOwned};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State};
use tauri_groups::command;

/// Ids of the plugins that are turned off: a JSON array of strings.
pub const PLUGINS_DISABLED: &str = "plugins.disabled";

/// Every setting the app has. Keep in step with the keys in `src/lib/settings.ts`.
const KNOWN: &[&str] = &[
  "theme",
  "mode",
  "sidebarW",
  "libraryColumns",
  PLUGINS_DISABLED,
];

// SECTION: store

#[derive(Clone)]
pub struct Settings(Arc<Inner>);

struct Inner {
  path: PathBuf,
  values: Mutex<Map<String, Value>>,
}

/// Called once at startup, before anything that reads settings (e.g. `plugins::init`).
pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
  if app.try_state::<Settings>().is_some() {
    return Ok(());
  }
  let dir = app.path().app_data_dir()?;
  fs::create_dir_all(&dir)?;
  app.manage(Settings::open(dir.join("settings.json")));
  Ok(())
}

impl Settings {
  /// Loads the file at `path`. Missing or unreadable means no settings yet.
  pub fn open(path: PathBuf) -> Self {
    let mut values = read(&path);
    let before = values.len();
    values.retain(|k, _| KNOWN.contains(&k.as_str()));
    if values.len() != before {
      // rewrite the file without the stale keys (if this fails, it's retried on the next load)
      let _ = save(&path, &values);
    }
    Settings(Arc::new(Inner {
      path,
      values: Mutex::new(values),
    }))
  }

  pub fn all(&self) -> Map<String, Value> {
    self.0.values.lock().unwrap().clone()
  }

  /// The value saved under `key`, or `None` if there isn't one (or it isn't a `T`).
  pub fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
    let values = self.0.values.lock().unwrap();
    serde_json::from_value(values.get(key)?.clone()).ok()
  }

  /// Replaces every setting at once (used when a backup is imported). Keys the app doesn't
  /// have are dropped, like on load. Nothing changes if the file can't be written.
  pub fn replace(&self, mut next: Map<String, Value>) -> io::Result<()> {
    next.retain(|k, _| KNOWN.contains(&k.as_str()));
    let mut values = self.0.values.lock().unwrap();
    save(&self.0.path, &next)?;
    *values = next;
    Ok(())
  }

  pub fn set(&self, key: &str, value: Value) -> io::Result<()> {
    if !KNOWN.contains(&key) {
      return Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "not a setting this app has",
      ));
    }
    // the lock is held while writing, so saves reach the disk in the order they were made
    let mut values = self.0.values.lock().unwrap();
    let mut next = values.clone();
    next.insert(key.to_string(), value);
    save(&self.0.path, &next)?;
    *values = next;
    Ok(())
  }
}

fn read(path: &Path) -> Map<String, Value> {
  let text = match fs::read_to_string(path) {
    Ok(text) => text,
    Err(e) if e.kind() == io::ErrorKind::NotFound => return Map::new(), // first run
    Err(e) => {
      eprintln!("couldn't read {}: {e}; using defaults", path.display());
      return Map::new();
    }
  };
  match serde_json::from_str::<Value>(&text) {
    Ok(Value::Object(map)) => map,
    other => {
      let why = match other {
        Err(e) => e.to_string(),
        _ => "not a JSON object".to_string(),
      };
      let aside = path.with_extension("json.corrupt");
      eprintln!(
        "{} is unusable ({why}); moved to {}",
        path.display(),
        aside.display()
      );
      let _ = fs::rename(path, aside);
      Map::new()
    }
  }
}

/// Writes to `settings.json.tmp`, flushes it to disk, then renames it over the real file.
fn save(path: &Path, values: &Map<String, Value>) -> io::Result<()> {
  if let Some(dir) = path.parent() {
    fs::create_dir_all(dir)?;
  }
  let tmp = path.with_extension("json.tmp");
  let written = fs::File::create(&tmp).and_then(|mut f| {
    f.write_all(serde_json::to_string_pretty(values)?.as_bytes())?;
    f.sync_all()
  });
  written
    .and_then(|_| fs::rename(&tmp, path))
    .inspect_err(|_| {
      let _ = fs::remove_file(&tmp);
    })
}

// SECTION: commands

/// What every `settings` command rejects with. The frontend just sees a string.
#[derive(Debug)]
pub struct SettingsError(String);

impl Serialize for SettingsError {
  fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&self.0)
  }
}

/// Everything saved so far. Settings that were never changed are absent; the frontend has the
/// defaults.
#[command(settings)]
fn get_settings(settings: State<'_, Settings>) -> HashMap<String, Value> {
  settings.all().into_iter().collect()
}

#[command(settings)]
fn set_setting(
  settings: State<'_, Settings>,
  key: String,
  value: Value,
) -> Result<(), SettingsError> {
  settings
    .set(&key, value)
    .map_err(|e| SettingsError(format!("couldn't save {key:?}: {e}")))
}

// SECTION: tests

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn temp_file() -> PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("free-lib-settings-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir.join("settings.json")
  }

  #[test]
  fn nothing_is_set_on_a_fresh_install() {
    assert!(Settings::open(temp_file()).all().is_empty());
  }

  #[test]
  fn a_setting_survives_a_restart() {
    let path = temp_file();
    Settings::open(path.clone())
      .set("theme", json!("ocean"))
      .unwrap();
    let restarted = Settings::open(path);
    assert_eq!(restarted.get::<String>("theme").as_deref(), Some("ocean"));
  }

  #[test]
  fn a_corrupt_file_is_kept_aside_and_saving_still_works() {
    let path = temp_file();
    fs::write(&path, "{{nope").unwrap();

    let s = Settings::open(path.clone());
    assert!(s.all().is_empty());
    assert_eq!(
      fs::read_to_string(path.with_extension("json.corrupt")).unwrap(),
      "{{nope"
    );

    s.set("theme", json!("ocean")).unwrap();
    assert_eq!(
      Settings::open(path).get::<String>("theme").as_deref(),
      Some("ocean")
    );
  }

  #[test]
  fn a_file_that_is_not_an_object_counts_as_corrupt() {
    let path = temp_file();
    fs::write(&path, "[1, 2]").unwrap();
    assert!(Settings::open(path.clone()).all().is_empty());
    assert!(path.with_extension("json.corrupt").exists());
  }

  #[test]
  fn a_leftover_temp_file_from_a_crash_is_harmless() {
    let path = temp_file();
    Settings::open(path.clone())
      .set("theme", json!("ocean"))
      .unwrap();
    fs::write(path.with_extension("json.tmp"), "{half a wri").unwrap(); // crash mid-save
    let s = Settings::open(path.clone());
    assert_eq!(s.get::<String>("theme").as_deref(), Some("ocean"));
    s.set("mode", json!("dark")).unwrap();
    assert_eq!(
      Settings::open(path).get::<String>("mode").as_deref(),
      Some("dark")
    );
  }

  #[test]
  fn keys_the_app_no_longer_has_are_dropped_from_the_file() {
    let path = temp_file();
    fs::write(
      &path,
      r#"{"theme": "ocean", "oldSetting": 1, "typo": true}"#,
    )
    .unwrap();

    let s = Settings::open(path.clone());
    assert_eq!(s.all().len(), 1);
    // gone from the file itself right away, not only from memory
    let on_disk: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(on_disk, json!({ "theme": "ocean" }));
  }

  #[test]
  fn replace_swaps_everything_and_drops_unknown_keys() {
    let path = temp_file();
    let s = Settings::open(path.clone());
    s.set("theme", json!("ocean")).unwrap();
    s.set("mode", json!("dark")).unwrap();

    let mut next = Map::new();
    next.insert("theme".into(), json!("forest"));
    next.insert("bogus".into(), json!(1));
    s.replace(next).unwrap();

    assert_eq!(s.get::<String>("theme").as_deref(), Some("forest"));
    assert_eq!(s.get::<String>("mode"), None); // not in the replacement: gone
    let on_disk: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(on_disk, json!({ "theme": "forest" }));
  }

  #[test]
  fn an_unknown_key_cannot_be_saved() {
    let s = Settings::open(temp_file());
    assert!(s.set("whatever", json!(1)).is_err());
    assert!(s.all().is_empty());
  }

  #[test]
  fn a_failed_save_changes_nothing() {
    // a directory where the file should be makes the rename fail
    let path = temp_file();
    fs::create_dir_all(&path).unwrap();
    let s = Settings::open(path);
    assert!(s.set("theme", json!("ocean")).is_err());
    assert_eq!(s.get::<String>("theme"), None);
  }
}
