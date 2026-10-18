//! The file side of an import: cover images and plugin files.

use std::{collections::HashMap, fs, io, path::Path};

use super::archive::Staged;
use super::names::{CoverKey, isbn_key};
use super::{ImportMode, ImportReport};
use crate::models::Book;
use crate::{covers, plugins};

pub(super) fn clear_dir(dir: &Path) -> io::Result<()> {
  match fs::remove_dir_all(dir) {
    Ok(()) => {}
    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
    Err(e) => return Err(e),
  }
  fs::create_dir_all(dir)
}

/// Which live book each cover in the backup belongs to: `(live book id, file name in the backup)`.
///
/// `applied` maps the ids of the backup's books to the live books they were written to (see
/// `db::merge_db`; for a full replace the ids are kept, so it's the identity). A book that isn't in
/// it was left alone, so its cover is too. Covers that match no book are dropped: a cover saved
/// under an id nobody has would otherwise show up on whichever book gets that id next.
///
/// Backups made before covers were stored by book id name them after the ISBN. Those are matched
/// to the backup's books by ISBN, so they end up under the same live ids as the rest.
pub(super) fn cover_targets(
  staged: &Staged,
  backup_books: &[Book],
  applied: &HashMap<i64, i64>,
) -> Vec<(i64, String)> {
  let by_isbn: HashMap<String, i64> = backup_books
    .iter()
    .filter_map(|b| Some((isbn_key(b.isbn.as_deref()?)?, b.book_id)))
    .collect();
  staged
    .covers
    .iter()
    .filter_map(|(key, file)| {
      let backup_id = match key {
        CoverKey::Book(id) => *id,
        CoverKey::Isbn(isbn) => *by_isbn.get(isbn)?,
      };
      Some((*applied.get(&backup_id)?, file.clone()))
    })
    .collect()
}

/// Copies the covers in `book_covers` (see `cover_targets`) and the plugin files into place.
pub(super) fn apply_files(
  data: &Path,
  staged: &Staged,
  mode: ImportMode,
  book_covers: &[(i64, String)],
  report: &mut ImportReport,
) -> io::Result<()> {
  let covers_dir = data.join(covers::DIR_NAME);
  let plugins_dir = data.join(plugins::DIR_NAME);
  let full = mode == ImportMode::FullReplace;
  let overwrite = mode != ImportMode::AppendMerge;

  prepare_dirs(&[&covers_dir, &plugins_dir], full)?;
  copy_covers(&covers_dir, staged, book_covers, report)?;
  copy_plugins(&plugins_dir, staged, overwrite, report)
}

/// Makes sure the folders exist, emptying them first in a full replace.
fn prepare_dirs(dirs: &[&Path], clear: bool) -> io::Result<()> {
  for dir in dirs {
    if clear {
      clear_dir(dir)?;
    }
    fs::create_dir_all(dir)?;
  }
  Ok(())
}

/// A cover whose book was added or updated by the import replaces whatever cover that book had.
/// (Books that were left alone aren't in `book_covers`, so they keep theirs.)
fn copy_covers(
  covers_dir: &Path,
  staged: &Staged,
  book_covers: &[(i64, String)],
  report: &mut ImportReport,
) -> io::Result<()> {
  for (book_id, file) in book_covers {
    replace_cover(covers_dir, *book_id, &staged.cover_path(file), file)?;
    report.covers_copied += 1;
  }
  Ok(())
}

/// Puts `from` in place as the cover of `book_id`, keeping the extension of `file` (its name in
/// the backup). It's copied to a temp name first, so a failed copy doesn't destroy the old cover,
/// and any cover with another extension is removed.
fn replace_cover(covers_dir: &Path, book_id: i64, from: &Path, file: &str) -> io::Result<()> {
  let (_, ext) = file.rsplit_once('.').ok_or_else(|| {
    io::Error::new(io::ErrorKind::InvalidInput, "a cover file without an extension")
  })?;
  let tmp = covers_dir.join(format!(".{book_id}.tmp"));
  fs::copy(from, &tmp)?;
  for old in covers::EXTS {
    let _ = fs::remove_file(covers_dir.join(format!("{book_id}.{old}")));
  }
  fs::rename(&tmp, covers_dir.join(format!("{book_id}.{ext}")))
}

/// Plugin files that exist here are kept, unless the backup has priority.
fn copy_plugins(
  plugins_dir: &Path,
  staged: &Staged,
  overwrite: bool,
  report: &mut ImportReport,
) -> io::Result<()> {
  for file in &staged.plugin_files {
    let target = plugins_dir.join(file);
    if !overwrite && target.exists() {
      continue;
    }
    fs::copy(staged.plugin_path(file), &target)?;
    report.plugin_files_copied += 1;
  }
  Ok(())
}
