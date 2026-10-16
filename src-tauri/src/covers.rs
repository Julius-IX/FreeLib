//! Cover images, stored as `<app data dir>/cover-images/<ISBN>.<ext>`.
//!
//! The ISBN is the file name (it's already unique, so a re-save simply
//! replaces the old cover and nothing is stored twice). The extension comes
//! from the file's actual bytes, not from the source name, so the stored file
//! is always a real image.
//!
//! `save_cover` accepts an http(s) URL, a plain file path, a `file://` URL, or
//! (Android gallery picks) a `content://` URI. Local reads go through
//! tauri-plugin-fs, which is the one API that understands content URIs.

use std::{
  fs,
  path::{Path, PathBuf},
  time::Duration,
};

use serde::{Serialize, Serializer};
use tauri::{AppHandle, Manager};
use tauri_groups::command;
use tauri_plugin_fs::{FilePath, FsExt};

const DIR_NAME: &str = "cover-images";
const MAX_BYTES: usize = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);
/// Every extension `detect_ext` can return.
const EXTS: [&str; 4] = ["jpg", "png", "webp", "gif"];

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

/// Strips `-` / spaces, upper-cases a trailing `x`, and accepts only 10- or
/// 13-character ISBNs. This also guarantees the value is safe to use as a
/// file name (no separators, no `..`).
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

fn existing_cover(dir: &Path, isbn: &str) -> Option<PathBuf> {
  EXTS
    .iter()
    .map(|ext| dir.join(format!("{isbn}.{ext}")))
    .find(|p| p.is_file())
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

// SECTION: commands

/// Copies the image at `source` (URL, file path, or Android content URI) into
/// the app's `cover-images/` folder as `<isbn>.<ext>`, replacing any previous
/// cover for that ISBN. Returns the absolute path of the stored file.
#[command(covers)]
async fn save_cover(app: AppHandle, isbn: String, source: String) -> Res<String> {
  let isbn = normalize_isbn(&isbn)?;
  let bytes = load_source(&app, &source).await?;
  let ext = detect_ext(&bytes)
    .ok_or_else(|| CoverError::new("not a supported image (jpg, png, webp or gif)"))?;

  let dir = covers_dir(&app)?;
  let target = dir.join(format!("{isbn}.{ext}"));

  // Write beside the target, then rename, so a crash never leaves a
  // half-written cover behind.
  let tmp = dir.join(format!(".{isbn}.tmp"));
  fs::write(&tmp, &bytes).map_err(|e| CoverError::new(format!("couldn't write cover: {e}")))?;

  // Drop a cover saved earlier under a different extension.
  if let Some(old) = existing_cover(&dir, &isbn) {
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

/// Absolute path of the stored cover for `isbn`, or `null` if there isn't one.
#[command(covers)]
async fn get_cover_path(app: AppHandle, isbn: String) -> Res<Option<String>> {
  let isbn = normalize_isbn(&isbn)?;
  let dir = covers_dir(&app)?;
  Ok(existing_cover(&dir, &isbn).map(|p| p.to_string_lossy().into_owned()))
}

/// Removes the stored cover for `isbn`. Not an error if there wasn't one.
#[command(covers)]
async fn delete_cover(app: AppHandle, isbn: String) -> Res<()> {
  let isbn = normalize_isbn(&isbn)?;
  let dir = covers_dir(&app)?;
  if let Some(p) = existing_cover(&dir, &isbn) {
    fs::remove_file(p).map_err(|e| CoverError::new(format!("couldn't delete cover: {e}")))?;
  }
  Ok(())
}
