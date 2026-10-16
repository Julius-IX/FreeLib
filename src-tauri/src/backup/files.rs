//! The file side of an import: cover images and plugin files.

use std::{collections::HashSet, fs, io, path::Path};

use super::archive::Staged;
use super::{ImportMode, ImportReport};
use crate::{covers, plugins};

pub(super) fn clear_dir(dir: &Path) -> io::Result<()> {
  match fs::remove_dir_all(dir) {
    Ok(()) => {}
    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
    Err(e) => return Err(e),
  }
  fs::create_dir_all(dir)
}

pub(super) fn apply_files(
  data: &Path,
  staged: &Staged,
  mode: ImportMode,
  existed: &HashSet<String>,
  report: &mut ImportReport,
) -> io::Result<()> {
  let covers_dir = data.join(covers::DIR_NAME);
  let plugins_dir = data.join(plugins::DIR_NAME);
  let full = mode == ImportMode::FullReplace;
  let overwrite = mode != ImportMode::AppendMerge;

  prepare_dirs(&[&covers_dir, &plugins_dir], full)?;
  copy_covers(&covers_dir, staged, full, overwrite, existed, report)?;
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

/// Whether the backup's cover for `isbn` should be written. A book that was already here keeps
/// its cover unless the backup has priority.
fn cover_wanted(
  covers_dir: &Path,
  isbn: &str,
  full: bool,
  overwrite: bool,
  existed: &HashSet<String>,
) -> bool {
  let applies = !existed.contains(isbn) || overwrite;
  full || (applies && (overwrite || covers::existing_cover(covers_dir, isbn).is_none()))
}

fn copy_covers(
  covers_dir: &Path,
  staged: &Staged,
  full: bool,
  overwrite: bool,
  existed: &HashSet<String>,
  report: &mut ImportReport,
) -> io::Result<()> {
  for (isbn, file) in &staged.covers {
    if cover_wanted(covers_dir, isbn, full, overwrite, existed) {
      replace_cover(covers_dir, isbn, &staged.cover_path(file), file)?;
      report.covers_copied += 1;
    }
  }
  Ok(())
}

/// Puts `from` in place as `<isbn>`'s cover. It's copied to a temp name first, so a failed copy
/// doesn't destroy the old cover, and any cover with another extension is removed.
fn replace_cover(covers_dir: &Path, isbn: &str, from: &Path, file: &str) -> io::Result<()> {
  let tmp = covers_dir.join(format!(".{isbn}.tmp"));
  fs::copy(from, &tmp)?;
  for ext in covers::EXTS {
    let _ = fs::remove_file(covers_dir.join(format!("{isbn}.{ext}")));
  }
  fs::rename(&tmp, covers_dir.join(file))
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
