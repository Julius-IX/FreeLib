//! Import a library exported from another book app.
//!
//! The work is split in two so a new format only has to do the first half:
//!
//! 1. **Parsing** (one file per format, e.g. `goodreads`): turns an export's text into a list of
//!    [`ImportBook`]s, FreeLib's neutral description of a book. It never touches the database.
//! 2. **Importing** (this file): writes those books in one transaction with a savepoint per book.
//!    A failing book is rolled back and reported, the rest still import. Running the same export
//!    twice is safe, existing books are skipped (by ISBN, or title + first author without one).
//!
//! The frontend asks `list_import_formats` for what can be imported (so the picker and the option
//! toggles are built from data), reads the file and calls `import_library` with the format's id.
//!
//! ## What a book becomes
//!
//! - Title, authors, ISBN, page count: as given. A book without a usable ISBN is imported without one.
//! - Series + position, shelves (created when missing, added to the end of the tab row), rating
//!   (0-10, 0 = none, converted while parsing) and notes (review + private notes).
//! - Reading state: finished books get one reading, in-progress books an open one (no finish date
//!   = in progress). Formats often omit the finish date, so with `estimate_dates` the date added
//!   is used instead. Without it a finished book with no date gets no reading at all.
//! - Date added: `book.added_at`. Books are inserted oldest first so ids follow the order they were
//!   added in (the tie-break for equal dates).
//!
//! Not imported, because no export has it in a form the schema accepts: publish date (often only a
//! year, `book.publish_date` needs a full date), blurb and cover. The frontend can fill those in by
//! running the lookup plugins on `LibraryImportReport::imported_book_ids`.
//!
//! ## Adding a format
//!
//! 1. Create `import/<name>.rs` with a unit struct and `impl Importer for It` (see `goodreads`).
//! 2. Add `mod <name>;` below and the struct to [`IMPORTERS`].
//!
//! Everything else (command, report, duplicate detection, transactions, format list) needs no
//! change. Shared cleaning helpers (ISBNs, dates, HTML, rating scales) are in `util`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize, Serializer};
use sqlx::{Acquire, SqliteConnection, SqlitePool};
use tauri::State;
use tauri_groups::{TsType, command};

mod goodreads;
#[cfg(test)]
mod tests;
mod util;

const MAX_MESSAGES: usize = 50;

// SECTION: formats

/// Where a book is in its reading life, as the source app described it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReadStatus {
  /// To read, wishlist, anything that isn't being read or finished.
  Unread,
  Reading,
  Finished,
}

/// One book from an export, cleaned up and in FreeLib's terms. This is all the importing half
/// knows about, so a format's quirks (column names, HTML, rating scales, ISBN wrapping) must be
/// gone by the time a book is in this shape.
#[derive(Debug, Clone)]
pub(crate) struct ImportBook {
  /// 1-based position in the file (not counting a header), for messages.
  pub number: usize,
  pub title: String,
  /// Series name and the book's position in it.
  pub series: Option<(String, f64)>,
  pub authors: Vec<String>,
  /// A valid 10- or 13-character ISBN, no punctuation (`util::clean_isbn`).
  pub isbn: Option<String>,
  pub page_count: Option<i64>,
  /// 0-10, 0 = no rating.
  pub rating: f64,
  pub review: String,
  pub private_notes: String,
  /// `YYYY-MM-DD`
  pub date_added: Option<String>,
  pub date_read: Option<String>,
  /// Shelf names. Reading state (`read`, `currently-reading`...) belongs in `status`, not here.
  pub shelves: Vec<String>,
  pub status: ReadStatus,
}

/// What a format's `parse` returns.
#[derive(Debug, Default)]
pub(crate) struct ParsedImport {
  pub books: Vec<ImportBook>,
  /// One line per row that couldn't be read (they count as failed in the report).
  pub problems: Vec<String>,
}

/// A switch a format offers on top of the options every format has. The frontend renders these
/// as toggles. The chosen values come back in `LibraryImportOptions::format_options`.
#[derive(Debug, Clone, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptionSpec {
  pub key: String,
  pub label: String,
  pub description: String,
  /// Used when the frontend doesn't send this key.
  pub default_value: bool,
}

impl ImportOptionSpec {
  pub(crate) fn new(key: &str, label: &str, description: &str, default_value: bool) -> Self {
    Self {
      key: key.to_string(),
      label: label.to_string(),
      description: description.to_string(),
      default_value,
    }
  }
}

/// The values of one format's own switches, with defaults filled in for the ones not sent.
#[derive(Debug, Default)]
pub(crate) struct FormatOptions(pub(crate) HashMap<String, bool>);

impl FormatOptions {
  /// Whether the switch is on. A key the format never declared is off.
  pub(crate) fn enabled(&self, key: &str) -> bool {
    self.0.get(key).copied().unwrap_or(false)
  }
}

/// One importable format. See the module docs for how to add one.
pub(crate) trait Importer: Sync {
  /// Stable identifier the frontend sends back, lower-case (`"goodreads"`). Never change it once
  /// released.
  fn id(&self) -> &'static str;

  /// Shown in the format picker (`"Goodreads"`).
  fn name(&self) -> &'static str;

  /// How to get the file, shown under the picker.
  fn description(&self) -> &'static str;

  /// Extensions of the files this format uses, lower-case, no dot (`["csv"]`), for the file dialog.
  fn extensions(&self) -> &'static [&'static str];

  /// Switches only this format has. The one every format shares (`estimate_dates`) is not listed
  /// here.
  fn options(&self) -> Vec<ImportOptionSpec> {
    Vec::new()
  }

  /// Reads the file's text into books. Must not touch the database. A file that isn't this
  /// format at all is an `Err` (nothing is imported). A row that can't be used goes in
  /// `ParsedImport::problems` and the rest carry on. The order doesn't matter, books are
  /// sorted oldest-added first afterwards.
  fn parse(&self, text: &str, options: &FormatOptions) -> Res<ParsedImport>;
}

/// Every format, in the order the picker shows them.
static IMPORTERS: &[&dyn Importer] = &[&goodreads::Goodreads];

fn find_importer(id: &str) -> Option<&'static dyn Importer> {
  IMPORTERS.iter().copied().find(|i| i.id() == id)
}

fn resolve_options(importer: &dyn Importer, given: &HashMap<String, bool>) -> FormatOptions {
  FormatOptions(
    importer
      .options()
      .into_iter()
      .map(|spec| {
        let on = given.get(&spec.key).copied().unwrap_or(spec.default_value);
        (spec.key, on)
      })
      .collect(),
  )
}

// SECTION: types

/// What `list_import_formats` tells the frontend about one format.
#[derive(Debug, Clone, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct ImportFormat {
  pub id: String,
  pub name: String,
  pub description: String,
  pub extensions: Vec<String>,
  pub options: Vec<ImportOptionSpec>,
}

#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct LibraryImportOptions {
  /// Use the date a book was added when it has no read date, so finished books don't show as in
  /// progress. When off, a finished book without a date gets no reading at all.
  pub estimate_dates: bool,
  /// The chosen format's own switches, by `ImportOptionSpec::key`. Missing keys use the default.
  #[serde(default)]
  pub format_options: HashMap<String, bool>,
}

#[derive(Debug, Clone, Default, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct LibraryImportReport {
  pub imported: usize,
  pub skipped_duplicates: usize,
  /// Rows that couldn't be read or saved, see `messages`.
  pub failed: usize,
  pub authors_created: usize,
  pub series_created: usize,
  pub shelves_created: usize,
  pub readings_created: usize,
  /// Readings whose date came from the date added because the export had no read date.
  pub estimated_dates: usize,
  /// One line per problem, at most 50.
  pub messages: Vec<String>,
  /// The ids of the books that were created (not the skipped duplicates), in the order they were
  /// imported. For follow-up work on exactly these books, such as running the lookup plugins.
  pub imported_book_ids: Vec<i64>,
}

/// What every `importer` command rejects with. The frontend just sees a string.
#[derive(Debug)]
pub struct ImportError(String);

impl ImportError {
  /// For formats: "this file isn't mine".
  pub(crate) fn new(msg: impl Into<String>) -> Self {
    Self(msg.into())
  }
}

impl Serialize for ImportError {
  fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&self.0)
  }
}

impl From<sqlx::Error> for ImportError {
  fn from(e: sqlx::Error) -> Self {
    Self(e.to_string())
  }
}

pub(crate) type Res<T> = Result<T, ImportError>;

// SECTION: notes

/// The review and the private notes, separated by a blank line.
fn build_notes(review: &str, private_notes: &str) -> String {
  let mut parts = Vec::new();
  let review = review.trim();
  if !review.is_empty() {
    parts.push(review.to_string());
  }
  let private_notes = private_notes.trim();
  if !private_notes.is_empty() {
    parts.push(format!("Private notes: {private_notes}"));
  }
  parts.join("\n\n")
}

/// `book.rating` only takes 0-10. A format that gets this wrong shouldn't fail the whole book.
fn sane_rating(rating: f64) -> f64 {
  if rating.is_finite() { rating.clamp(0.0, 10.0) } else { 0.0 }
}

// SECTION: database

#[derive(Clone, Copy, Default)]
struct Created {
  authors: usize,
  series: usize,
  shelves: usize,
}

/// Name -> id caches (lower-cased names), so a 500-book import doesn't look up "Brandon
/// Sanderson" 40 times.
#[derive(Default)]
struct Ctx {
  authors: HashMap<String, i64>,
  series: HashMap<String, i64>,
  shelves: HashMap<String, i64>,
  created: Created,
}

enum Outcome {
  Imported {
    book_id: i64,
    readings: usize,
    estimated: bool,
  },
  Duplicate,
}

/// Looks the name up (case-insensitively), creating it when missing.
async fn named_id(
  conn: &mut SqliteConnection,
  cache: &mut HashMap<String, i64>,
  created: &mut usize,
  name: &str,
  select_sql: &'static str,
  insert_sql: &'static str,
) -> Result<i64, sqlx::Error> {
  let key = name.to_lowercase();
  if let Some(id) = cache.get(&key) {
    return Ok(*id);
  }
  let id = match sqlx::query_scalar::<_, i64>(select_sql)
    .bind(name)
    .fetch_optional(&mut *conn)
    .await?
  {
    Some(id) => id,
    None => {
      *created += 1;
      sqlx::query_scalar::<_, i64>(insert_sql)
        .bind(name)
        .fetch_one(&mut *conn)
        .await?
    }
  };
  cache.insert(key, id);
  Ok(id)
}

async fn already_have(conn: &mut SqliteConnection, book: &ImportBook) -> Result<bool, sqlx::Error> {
  let found = match &book.isbn {
    Some(isbn) => {
      sqlx::query_scalar::<_, i64>("SELECT 1 FROM book WHERE isbn = ?")
        .bind(isbn)
        .fetch_optional(&mut *conn)
        .await?
    }
    None => {
      sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM book b
         WHERE b.title = ?1 COLLATE NOCASE
           AND (?2 IS NULL OR EXISTS (
                 SELECT 1 FROM book_author ba
                 JOIN author a ON a.author_id = ba.author_id
                 WHERE ba.book_id = b.book_id AND a.name = ?2 COLLATE NOCASE))
         LIMIT 1",
      )
      .bind(&book.title)
      .bind(book.authors.first().map(String::as_str))
      .fetch_optional(&mut *conn)
      .await?
    }
  };
  Ok(found.is_some())
}

async fn import_book(
  conn: &mut SqliteConnection,
  ctx: &mut Ctx,
  book: &ImportBook,
  opts: &LibraryImportOptions,
) -> Result<Outcome, sqlx::Error> {
  if already_have(conn, book).await? {
    return Ok(Outcome::Duplicate);
  }

  let series_id = match &book.series {
    Some((name, _)) => Some(
      named_id(
        conn,
        &mut ctx.series,
        &mut ctx.created.series,
        name,
        "SELECT series_id FROM series WHERE name = ? COLLATE NOCASE",
        "INSERT INTO series (name) VALUES (?) RETURNING series_id",
      )
      .await?,
    ),
    None => None,
  };
  let series_position = book.series.as_ref().map(|(_, position)| *position);

  // An empty added_at makes the book_added_at trigger stamp it with "now".
  let added_at = book
    .date_added
    .as_ref()
    .map(|d| format!("{d}T00:00:00.000Z"))
    .unwrap_or_default();

  let rating = sane_rating(book.rating);
  let notes = build_notes(&book.review, &book.private_notes);

  let book_id: i64 = sqlx::query_scalar(
    "INSERT INTO book (title, isbn, page_count, series_id, series_position, notes, rating, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING book_id",
  )
  .bind(&book.title)
  .bind(&book.isbn)
  .bind(book.page_count)
  .bind(series_id)
  .bind(series_position)
  .bind(notes)
  .bind(rating)
  .bind(added_at)
  .fetch_one(&mut *conn)
  .await?;

  for name in &book.authors {
    let author_id = named_id(
      conn,
      &mut ctx.authors,
      &mut ctx.created.authors,
      name,
      "SELECT author_id FROM author WHERE name = ? COLLATE NOCASE",
      "INSERT INTO author (name) VALUES (?) RETURNING author_id",
    )
    .await?;
    sqlx::query("INSERT OR IGNORE INTO book_author (book_id, author_id) VALUES (?, ?)")
      .bind(book_id)
      .bind(author_id)
      .execute(&mut *conn)
      .await?;
  }

  for name in &book.shelves {
    let shelf_id = named_id(
      conn,
      &mut ctx.shelves,
      &mut ctx.created.shelves,
      name,
      // shelf.name is declared COLLATE NOCASE, so a plain = is already case-insensitive
      "SELECT shelf_id FROM shelf WHERE name = ?",
      // new shelves go to the end of the tab row, same as `create_shelf`
      "INSERT INTO shelf (name, position)
       SELECT ?, COALESCE(MAX(position), 0) + 1 FROM shelf RETURNING shelf_id",
    )
    .await?;
    sqlx::query("INSERT OR IGNORE INTO book_shelf (book_id, shelf_id) VALUES (?, ?)")
      .bind(book_id)
      .bind(shelf_id)
      .execute(&mut *conn)
      .await?;
  }

  // (date_started, date_finished). A reading without a finish date counts as in progress.
  let fallback = opts.estimate_dates.then(|| book.date_added.clone()).flatten();
  let (reading, estimated) = match book.status {
    ReadStatus::Unread => (None, false),
    ReadStatus::Reading => (Some((fallback.clone(), None)), fallback.is_some()),
    ReadStatus::Finished => match &book.date_read {
      Some(read) => (Some((None, Some(read.clone()))), false),
      None => match fallback {
        Some(added) => (Some((None, Some(added))), true),
        None => (None, false),
      },
    },
  };
  if let Some((started, finished)) = &reading {
    sqlx::query("INSERT INTO reading (book_id, date_started, date_finished) VALUES (?, ?, ?)")
      .bind(book_id)
      .bind(started)
      .bind(finished)
      .execute(&mut *conn)
      .await?;
  }

  Ok(Outcome::Imported {
    book_id,
    readings: usize::from(reading.is_some()),
    estimated,
  })
}

pub(crate) async fn run_import(
  pool: &SqlitePool,
  importer: &dyn Importer,
  text: &str,
  opts: &LibraryImportOptions,
) -> Res<LibraryImportReport> {
  let format_options = resolve_options(importer, &opts.format_options);
  let mut parsed = importer.parse(text, &format_options)?;
  // Oldest first (stable, so books with the same date keep the file's order), so book ids follow
  // the order they were added in, which is what `added_at` ties are broken by.
  parsed.books.sort_by(|a, b| a.date_added.cmp(&b.date_added));

  let mut report = LibraryImportReport {
    failed: parsed.problems.len(),
    messages: parsed.problems,
    ..Default::default()
  };

  let mut ctx = Ctx::default();
  let mut tx = pool.begin().await?;
  for book in &parsed.books {
    let created_before = ctx.created;
    let mut savepoint = tx.begin().await?;
    match import_book(&mut savepoint, &mut ctx, book, opts).await {
      Ok(Outcome::Imported {
        book_id,
        readings,
        estimated,
      }) => {
        savepoint.commit().await?;
        report.imported += 1;
        report.imported_book_ids.push(book_id);
        report.readings_created += readings;
        report.estimated_dates += usize::from(estimated);
      }
      Ok(Outcome::Duplicate) => {
        savepoint.commit().await?;
        report.skipped_duplicates += 1;
      }
      Err(e) => {
        savepoint.rollback().await?;
        // The rolled-back book may have created authors / series / shelves the caches now point at.
        ctx.authors.clear();
        ctx.series.clear();
        ctx.shelves.clear();
        ctx.created = created_before;
        report.failed += 1;
        report
          .messages
          .push(format!("row {}: \"{}\": {e}", book.number, book.title));
      }
    }
  }
  tx.commit().await?;

  report.authors_created = ctx.created.authors;
  report.series_created = ctx.created.series;
  report.shelves_created = ctx.created.shelves;
  if report.messages.len() > MAX_MESSAGES {
    let more = report.messages.len() - MAX_MESSAGES;
    report.messages.truncate(MAX_MESSAGES);
    report.messages.push(format!("...and {more} more"));
  }
  Ok(report)
}

// SECTION: commands

/// Every format `import_library` understands, with the switches each one offers.
#[command(importer)]
fn list_import_formats() -> Vec<ImportFormat> {
  IMPORTERS
    .iter()
    .map(|i| ImportFormat {
      id: i.id().to_string(),
      name: i.name().to_string(),
      description: i.description().to_string(),
      extensions: i.extensions().iter().map(|e| e.to_string()).collect(),
      options: i.options(),
    })
    .collect()
}

/// `format` is an id from `list_import_formats`, `text` the text of the exported file. Safe to
/// run again on the same export.
#[command(importer)]
async fn import_library(
  pool: State<'_, SqlitePool>,
  format: String,
  text: String,
  options: LibraryImportOptions,
) -> Res<LibraryImportReport> {
  let importer = find_importer(&format)
    .ok_or_else(|| ImportError::new(format!("unknown import format \"{format}\"")))?;
  run_import(pool.inner(), importer, &text, &options).await
}
