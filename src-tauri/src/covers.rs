//! Cover images, stored as `<app data dir>/cover-images/<book_id>.<ext>`.
//!
//! The book id is the file name (unlike the ISBN it is unique, never changes and every book has
//! one), so a re-save simply replaces the old cover. The extension comes from the file's actual
//! bytes, not the source name, so the stored file is always a real image.
//!
//! Versions before this one named files after the ISBN (`<ISBN>.<ext>`). Those covers are renamed
//! to the book id on every startup (`migrate_legacy_covers`), before the frontend asks for any, so
//! nothing else needs to know the old names. Backups from those versions are converted on import
//! (see `backup`).
//!
//! `save_cover` accepts an http(s) URL, a file path, a `file://` URL or (Android gallery picks) a
//! `content://` URI. Local reads go through tauri-plugin-fs, the one API that understands content
//! URIs.

use std::{
  collections::HashMap,
  fs,
  path::{Path, PathBuf},
  time::Duration,
};

use serde::{Serialize, Serializer};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tauri_groups::command;
use tauri_plugin_fs::{FilePath, FsExt};

pub(crate) const DIR_NAME: &str = "cover-images";
const MAX_BYTES: usize = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);
/// Every extension `detect_ext` can return.
pub(crate) const EXTS: [&str; 4] = ["jpg", "png", "webp", "gif"];
/// The largest book id a cover can be stored under: nine digits. ISBNs are 10 or 13 characters,
/// so a file stem is never both a valid book id and a valid ISBN. That is what lets the legacy
/// `<ISBN>.<ext>` names and the current `<book_id>.<ext>` ones share a folder without ambiguity.
const MAX_BOOK_ID: i64 = 999_999_999;

// SECTION: errors

/// What every `covers` command rejects with. The frontend just sees a string.
#[derive(Debug)]
pub struct CoverError(String);

impl CoverError {
  fn new(msg: impl Into<String>) -> Self {
    Self(msg.into())
  }
}

impl Serialize for CoverError {
  fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&self.0)
  }
}

type Res<T> = Result<T, CoverError>;

// SECTION: helpers

/// Rejects ids no cover can be stored under (only a hand-edited database would have one).
fn check_book_id(book_id: i64) -> Res<i64> {
  if (1..=MAX_BOOK_ID).contains(&book_id) {
    Ok(book_id)
  } else {
    Err(CoverError::new(format!("invalid book id: {book_id}")))
  }
}

/// The book id a cover file name stem stands for: plain digits, no sign and no leading zeros.
/// `None` for anything else, including every ISBN.
pub(crate) fn parse_book_id(stem: &str) -> Option<i64> {
  let id: i64 = stem.parse().ok()?;
  // Round-tripping through `to_string` rejects "+5", "007" and the like.
  if (1..=MAX_BOOK_ID).contains(&id) && id.to_string() == stem {
    Some(id)
  } else {
    None
  }
}

/// Only used to recognise covers saved under the old ISBN-based names. Strips `-` / spaces,
/// upper-cases a trailing `x` and accepts only 10- or 13-character ISBNs, which also makes the
/// value safe as a file name.
fn normalize_isbn(raw: &str) -> Res<String> {
  let isbn: String = raw
    .chars()
    .filter(|c| *c != '-' && !c.is_whitespace())
    .collect::<String>()
    .to_ascii_uppercase();

  let digits_ok = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
  let valid = match isbn.len() {
    13 => digits_ok(&isbn),
    10 => digits_ok(&isbn[..9]) && matches!(isbn.as_bytes()[9], b'0'..=b'9' | b'X'),
    _ => false,
  };
  if valid {
    Ok(isbn)
  } else {
    Err(CoverError::new(format!("invalid ISBN: {raw:?}")))
  }
}

fn covers_dir(app: &AppHandle) -> Res<PathBuf> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| CoverError::new(format!("no app data dir: {e}")))?
    .join(DIR_NAME);
  fs::create_dir_all(&dir)
    .map_err(|e| CoverError::new(format!("couldn't create {}: {e}", dir.display())))?;
  Ok(dir)
}

fn existing_cover(dir: &Path, book_id: i64) -> Option<PathBuf> {
  EXTS
    .iter()
    .map(|ext| dir.join(format!("{book_id}.{ext}")))
    .find(|p| p.is_file())
}

/// The ids of the books that have a cover file in `dir`, sorted. Anything else in the folder (an
/// ISBN-named leftover, a partial download, a sub-folder) is not the cover of any book.
fn book_ids_with_cover_in(dir: &Path) -> Vec<i64> {
  let Ok(entries) = fs::read_dir(dir) else {
    return Vec::new();
  };
  let mut ids: Vec<i64> = entries
    .filter_map(Result::ok)
    .map(|entry| entry.path())
    .filter(|path| path.is_file())
    .filter_map(|path| {
      if !EXTS.contains(&path.extension()?.to_str()?) {
        return None;
      }
      parse_book_id(path.file_stem()?.to_str()?)
    })
    .collect();
  ids.sort_unstable();
  ids.dedup();
  ids
}

/// Every book that has a stored cover, for the library filter's "has a cover". No cover folder
/// yet (or one that can't be read) just means no covers.
pub(crate) fn book_ids_with_cover(app: &AppHandle) -> Vec<i64> {
  covers_dir(app)
    .map(|dir| book_ids_with_cover_in(&dir))
    .unwrap_or_default()
}

fn detect_ext(b: &[u8]) -> Option<&'static str> {
  if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
    Some("jpg")
  } else if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
    Some("png")
  } else if b.starts_with(b"GIF8") {
    Some("gif")
  } else if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
    Some("webp")
  } else {
    None
  }
}

fn too_big() -> CoverError {
  CoverError::new(format!(
    "image is larger than {} MB",
    MAX_BYTES / 1024 / 1024
  ))
}

/// The HTTP client builder used for cover downloads (and by `plugins`, so lookups get the same
/// user agent and the same Android certificate handling).
///
/// On Android, reqwest 0.13's default certificate check is rustls-platform-verifier, which has
/// to be initialised from Java at startup. Passing custom roots via `tls_certs_only` makes reqwest verify against
/// Mozilla's public roots and never touch the platform verifier. Desktop keeps the OS trust
/// store, so corporate / user-installed CAs still work there.
pub(crate) fn http_client_builder() -> reqwest::ClientBuilder {
  let builder = reqwest::Client::builder()
    .timeout(DOWNLOAD_TIMEOUT)
    .user_agent(concat!("free-lib/", env!("CARGO_PKG_VERSION")));

  #[cfg(target_os = "android")]
  let builder = builder.tls_certs_only(
    webpki_root_certs::TLS_SERVER_ROOT_CERTS
      .iter()
      .filter_map(|der| reqwest::Certificate::from_der(der.as_ref()).ok()),
  );

  builder
}

fn http_client() -> Result<reqwest::Client, reqwest::Error> {
  http_client_builder().build()
}

async fn download(url: &str) -> Res<Vec<u8>> {
  let net = |e: reqwest::Error| CoverError::new(format!("download failed: {e}"));

  let client = http_client().map_err(net)?;
  let mut resp = client
    .get(url)
    .send()
    .await
    .and_then(|r| r.error_for_status())
    .map_err(net)?;

  if resp.content_length().is_some_and(|n| n > MAX_BYTES as u64) {
    return Err(too_big());
  }
  let mut buf = Vec::new();
  while let Some(chunk) = resp.chunk().await.map_err(net)? {
    buf.extend_from_slice(&chunk);
    if buf.len() > MAX_BYTES {
      return Err(too_big());
    }
  }
  Ok(buf)
}

fn read_local(app: &AppHandle, source: &str) -> Res<Vec<u8>> {
  // Infallible: URLs (file://, content://) become `FilePath::Url`, everything
  // else (including `C:\...`) becomes `FilePath::Path`.
  let path: FilePath = source.parse().expect("FilePath::from_str is infallible");
  let bytes = app
    .fs()
    .read(path)
    .map_err(|e| CoverError::new(format!("couldn't read {source}: {e}")))?;
  if bytes.len() > MAX_BYTES {
    return Err(too_big());
  }
  Ok(bytes)
}

async fn load_source(app: &AppHandle, source: &str) -> Res<Vec<u8>> {
  let source = source.trim();
  let lower = source.to_ascii_lowercase();
  if lower.starts_with("http://") || lower.starts_with("https://") {
    // Own task: if anything in the network stack panics, that surfaces here as an error the
    // frontend can show. A panic inside the command itself is never answered, so the
    // frontend promise would wait forever.
    let url = source.to_owned();
    tauri::async_runtime::spawn(async move { download(&url).await })
      .await
      .map_err(|e| CoverError::new(format!("download task failed: {e}")))?
  } else {
    read_local(app, source)
  }
}

// SECTION: legacy ISBN-named covers

/// The covers an older version saved, by normalised ISBN: `<ISBN>.<ext>` -> (file, extension).
fn legacy_cover_files(dir: &Path) -> HashMap<String, (PathBuf, &'static str)> {
  let Ok(read) = fs::read_dir(dir) else {
    return HashMap::new();
  };
  read
    .flatten()
    .filter(|e| e.path().is_file())
    .filter_map(|e| {
      let path = e.path();
      let name = path.file_name()?.to_str()?.to_owned();
      let (stem, ext) = name.rsplit_once('.')?;
      let ext = EXTS.iter().copied().find(|x| *x == ext)?;
      // A stem that is a valid, already normalised ISBN. Anything else (a book id, a temp file,
      // a stray file) isn't ours to touch.
      let isbn = normalize_isbn(stem).ok().filter(|n| n == stem)?;
      Some((isbn, (path, ext)))
    })
    .collect()
}

/// Renames `legacy` covers to the id of the book that has that ISBN. `books` is `(book_id, isbn)`
/// for every book with an ISBN. Returns how many were renamed.
///
/// A cover is only moved onto a free name: if the book already has a cover under its id, the old
/// file stays rather than guessing which of the two is wanted. Covers of ISBNs no book has any
/// more are left alone too.
fn adopt_legacy_covers(
  dir: &Path,
  legacy: &HashMap<String, (PathBuf, &'static str)>,
  books: &[(i64, String)],
) -> usize {
  let mut moved = 0;
  for (book_id, isbn) in books {
    let Ok(isbn) = normalize_isbn(isbn) else {
      continue;
    };
    let Some((from, ext)) = legacy.get(&isbn) else {
      continue;
    };
    if check_book_id(*book_id).is_err() || existing_cover(dir, *book_id).is_some() {
      continue;
    }
    match fs::rename(from, dir.join(format!("{book_id}.{ext}"))) {
      Ok(()) => moved += 1,
      Err(e) => eprintln!("couldn't move cover {} to book {book_id}: {e}", from.display()),
    }
  }
  moved
}

/// Moves covers saved by older versions (named after the ISBN) to the book-id names. Runs at every
/// startup, after the database is ready and before the window loads, so it also picks up covers
/// saved after a downgrade. A failure is logged and never stops the app from starting.
pub(crate) fn migrate_legacy_covers(app: &AppHandle) {
  let Ok(base) = app.path().app_data_dir() else {
    return;
  };
  let dir = base.join(DIR_NAME);
  let legacy = legacy_cover_files(&dir);
  if legacy.is_empty() {
    return;
  }
  let Some(pool) = app.try_state::<SqlitePool>() else {
    return;
  };
  let books = tauri::async_runtime::block_on(
    sqlx::query_as::<_, (i64, String)>("SELECT book_id, isbn FROM book WHERE isbn IS NOT NULL")
      .fetch_all(pool.inner()),
  );
  match books {
    Ok(books) => {
      let moved = adopt_legacy_covers(&dir, &legacy, &books);
      if moved > 0 {
        eprintln!("moved {moved} cover(s) from ISBN names to book ids");
      }
    }
    Err(e) => eprintln!("couldn't read the books to move their covers: {e}"),
  }
}

// SECTION: commands

/// Copies the image at `source` (URL, file path or Android content URI) into `cover-images/` as
/// `<book_id>.<ext>`, replacing any previous cover. Returns the absolute path of the stored file.
#[command(covers)]
async fn save_cover(app: AppHandle, book_id: i64, source: String) -> Res<String> {
  let book_id = check_book_id(book_id)?;
  let bytes = load_source(&app, &source).await?;
  let ext = detect_ext(&bytes)
    .ok_or_else(|| CoverError::new("not a supported image (jpg, png, webp or gif)"))?;

  let dir = covers_dir(&app)?;
  let target = dir.join(format!("{book_id}.{ext}"));

  // Write beside the target, then rename, so a crash never leaves a
  // half-written cover behind.
  let tmp = dir.join(format!(".{book_id}.tmp"));
  fs::write(&tmp, &bytes).map_err(|e| CoverError::new(format!("couldn't write cover: {e}")))?;

  // Drop a cover saved earlier under a different extension.
  if let Some(old) = existing_cover(&dir, book_id) {
    if old != target {
      let _ = fs::remove_file(old);
    }
  }
  fs::rename(&tmp, &target).map_err(|e| {
    let _ = fs::remove_file(&tmp);
    CoverError::new(format!("couldn't store cover: {e}"))
  })?;

  Ok(target.to_string_lossy().into_owned())
}

/// Absolute path of the stored cover of `book_id`, or `null` if there isn't one.
#[command(covers)]
async fn get_cover_path(app: AppHandle, book_id: i64) -> Res<Option<String>> {
  let book_id = check_book_id(book_id)?;
  let dir = covers_dir(&app)?;
  Ok(existing_cover(&dir, book_id).map(|p| p.to_string_lossy().into_owned()))
}

/// Removes the stored cover of `book_id`. Not an error if there wasn't one.
#[command(covers)]
async fn delete_cover(app: AppHandle, book_id: i64) -> Res<()> {
  let book_id = check_book_id(book_id)?;
  let dir = covers_dir(&app)?;
  if let Some(p) = existing_cover(&dir, book_id) {
    fs::remove_file(p).map_err(|e| CoverError::new(format!("couldn't delete cover: {e}")))?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("free-lib-covers-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn only_files_named_after_a_book_id_count_as_covers() {
    let dir = temp_dir("has-cover");
    for name in [
      "5.jpg", "7.png", "12.webp", "3.gif", // covers
      "007.jpg", "9780441013593.jpg", "8.txt", "9.jpg.part", "10", // not covers
    ] {
      fs::write(dir.join(name), b"x").unwrap();
    }
    fs::create_dir(dir.join("11.jpg")).unwrap(); // a folder is not a cover
    assert_eq!(book_ids_with_cover_in(&dir), vec![3, 5, 7, 12]);
    // a book with two files (an old extension left behind) is listed once
    fs::write(dir.join("5.png"), b"x").unwrap();
    assert_eq!(book_ids_with_cover_in(&dir), vec![3, 5, 7, 12]);
    // no folder at all: no covers
    assert!(book_ids_with_cover_in(&dir.join("missing")).is_empty());
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn book_ids_are_plain_positive_numbers_that_can_never_be_isbns() {
    assert_eq!(parse_book_id("7"), Some(7));
    assert_eq!(parse_book_id("999999999"), Some(999_999_999));
    for bad in ["", "0", "007", "+7", "-7", "1a", "1000000000", "9780441013593", "019971110X"] {
      assert_eq!(parse_book_id(bad), None, "{bad}");
    }
    assert!(check_book_id(1).is_ok() && check_book_id(MAX_BOOK_ID).is_ok());
    assert!(check_book_id(0).is_err() && check_book_id(-3).is_err());
    assert!(check_book_id(MAX_BOOK_ID + 1).is_err());
  }

  #[test]
  fn covers_named_after_the_isbn_are_moved_to_the_book_id() {
    let dir = temp_dir("legacy");
    let put = |name: &str, bytes: &[u8]| fs::write(dir.join(name), bytes).unwrap();
    put("9780441013593.jpg", b"dune"); // book 4, whose ISBN is stored with dashes
    put("9780199535675.png", b"old"); // book 5, which already has a cover under its id
    put("5.webp", b"new");
    put("9780141439587.gif", b"orphan"); // no book has this ISBN any more
    put("7.jpg", b"already moved");
    put(".9780441013593.tmp", b"half written");
    let books = [
      (4, "978-0-441-01359-3".to_string()),
      (5, "9780199535675".to_string()),
      (6, "not an isbn".to_string()),
    ];

    let legacy = legacy_cover_files(&dir);
    assert_eq!(legacy.len(), 3); // the three ISBN-named covers, nothing else
    assert_eq!(adopt_legacy_covers(&dir, &legacy, &books), 1);

    assert_eq!(fs::read(dir.join("4.jpg")).unwrap(), b"dune");
    assert!(!dir.join("9780441013593.jpg").exists());
    // never moved onto a name that is taken, never deleted, never touched when nothing matches
    assert_eq!(fs::read(dir.join("5.webp")).unwrap(), b"new");
    assert!(dir.join("9780199535675.png").exists());
    assert!(dir.join("9780141439587.gif").exists());
    assert!(dir.join("7.jpg").exists());

    // a second run has nothing left to move
    assert_eq!(adopt_legacy_covers(&dir, &legacy_cover_files(&dir), &books), 0);
    let _ = fs::remove_dir_all(&dir);
  }
}
