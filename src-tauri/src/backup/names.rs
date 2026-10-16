//! Names of things in a backup: archive entries, ISBNs, plugin files, and the keys things are
//! matched by.

use crate::covers;

pub(super) const MANIFEST: &str = "manifest.json";
pub(super) const DB_FILE: &str = "db.sqlite";
pub(super) const SETTINGS_FILE: &str = "settings.json";
pub(super) const PLUGINS_PREFIX: &str = "plugins/";
pub(super) const COVERS_PREFIX: &str = "cover-images/";

/// Same rule as `normalize_isbn` in `covers`, but only a check (no stripping).
pub(super) fn is_valid_isbn(s: &str) -> bool {
  let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
  match s.len() {
    13 => digits(s),
    10 => digits(&s[..9]) && matches!(s.as_bytes()[9], b'0'..=b'9' | b'X'),
    _ => false,
  }
}

/// An ISBN with dashes and spaces removed, upper-cased. `None` for an empty one.
pub(super) fn isbn_key(raw: &str) -> Option<String> {
  let k: String = raw
    .chars()
    .filter(|c| *c != '-' && !c.is_whitespace())
    .collect::<String>()
    .to_ascii_uppercase();
  (!k.is_empty()).then_some(k)
}

/// Names (authors, series, tags, titles) are matched ignoring case and outer spaces.
pub(super) fn name_key(s: &str) -> String {
  s.trim().to_lowercase()
}

/// `<ISBN>.<ext>` -> the ISBN, if it's a file name `covers` could have written.
pub(super) fn cover_isbn(file: &str) -> Option<String> {
  let (stem, ext) = file.rsplit_once('.')?;
  (covers::EXTS.contains(&ext) && is_valid_isbn(stem)).then(|| stem.to_string())
}

/// `<id>.js` or `<id>.config.json` with `id` made of `[A-Za-z0-9_-]` (what `plugins` accepts).
pub(super) fn is_plugin_file(file: &str) -> bool {
  let id = file
    .strip_suffix(".config.json")
    .or_else(|| file.strip_suffix(".js"));
  id.is_some_and(|id| {
    !id.is_empty()
      && id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
  })
}

/// What an archive entry is, going only by its exact name. Anything else is ignored, which is
/// also what keeps a crafted entry name (`../x`) from ever reaching the disk.
pub(super) enum Entry {
  Manifest,
  Db,
  Settings,
  Plugin(String),
  Cover(String),
}

pub(super) fn classify(name: &str) -> Option<Entry> {
  match name {
    MANIFEST => Some(Entry::Manifest),
    DB_FILE => Some(Entry::Db),
    SETTINGS_FILE => Some(Entry::Settings),
    _ => {
      if let Some(f) = name.strip_prefix(PLUGINS_PREFIX) {
        is_plugin_file(f).then(|| Entry::Plugin(f.to_string()))
      } else if let Some(f) = name.strip_prefix(COVERS_PREFIX) {
        cover_isbn(f).map(|_| Entry::Cover(f.to_string()))
      } else {
        None
      }
    }
  }
}
