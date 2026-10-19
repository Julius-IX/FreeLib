//! The Goodreads format: the CSV from *My Books → Import and export → Export Library*.
//!
//! This file only turns that CSV into [`ImportBook`]s; writing them to the database is shared
//! with every other format (see the parent module).
//!
//! What a row becomes:
//! - Title: a trailing `(Series Name, #N)` is split off into FreeLib's series + position
//!   (`#1-2` omnibuses take the first number). Parentheticals without a `#` are left in the title.
//! - ISBN: ISBN13 if present, else ISBN10. Goodreads wraps them as `="978..."`, that is undone.
//!   A book with no usable ISBN (empty, an ASIN, junk, or no ISBN column at all) is still
//!   imported, just without one.
//! - Authors: the `Author` column. `Additional Authors` mixes co-authors with translators and
//!   illustrators, so it is opt-in (`include_additional_authors`).
//! - Shelves: `Bookshelves` plus the exclusive shelf become shelves, except `read` and
//!   `currently-reading`, which become the reading state instead.
//! - Reading state: the `read` / `currently-reading` shelf. A custom exclusive shelf
//!   (`owned-read`...) has no fixed meaning, so besides `read` a book counts as finished when it
//!   has a read date or has been read before.
//! - Rating: Goodreads' 0-5 stars, scaled to FreeLib's 0-10 (0 = no rating).
//! - Review (small HTML, cleaned to text) and private notes.
//! - `Date Added` and `Date Read`.
//!
//! Not imported: publish date (Goodreads only gives a year), blurb, cover, read counts beyond
//! the first.

use super::{
  FormatOptions, ImportBook, ImportOptionSpec, Importer, ImportError, ParsedImport, ReadStatus,
  Res,
  util::{clean_html, clean_isbn, iso_date, push_unique, scale_rating},
};

/// These two exclusive shelves describe reading status, which FreeLib keeps as readings.
const STATUS_SHELVES: [&str; 2] = ["read", "currently-reading"];

const ADDITIONAL_AUTHORS: &str = "include_additional_authors";

pub(super) struct Goodreads;

impl Importer for Goodreads {
  fn id(&self) -> &'static str {
    "goodreads"
  }

  fn name(&self) -> &'static str {
    "Goodreads"
  }

  fn description(&self) -> &'static str {
    "On goodreads.com open My Books → Import and export → Export Library, then pick the CSV \
     file it downloads."
  }

  fn extensions(&self) -> &'static [&'static str] {
    &["csv"]
  }

  fn options(&self) -> Vec<ImportOptionSpec> {
    vec![ImportOptionSpec::new(
      ADDITIONAL_AUTHORS,
      "Import additional authors",
      "Also add the \"Additional Authors\" column. It lists co-authors, but also translators \
       and illustrators.",
      false,
    )]
  }

  fn parse(&self, text: &str, options: &FormatOptions) -> Res<ParsedImport> {
    parse_export(text, options.enabled(ADDITIONAL_AUTHORS))
  }
}

// SECTION: parsing

fn field(rec: &csv::StringRecord, idx: Option<usize>) -> &str {
  idx.and_then(|i| rec.get(i)).map(str::trim).unwrap_or("")
}

/// `"Theft of Swords (The Riyria Revelations, #1-2)"` -> (`"Theft of Swords"`, `("The Riyria
/// Revelations", 1.0)`). Titles without a trailing `(... #N)` come back unchanged.
fn split_series(raw: &str) -> (String, Option<(String, f64)>) {
  let title = raw.trim();
  let plain = || (title.to_string(), None);
  if !title.ends_with(')') {
    return plain();
  }

  // The '(' that matches the final ')', so series names with parentheses of their own work.
  let mut depth = 0usize;
  let mut open = None;
  for (i, c) in title.char_indices().rev() {
    match c {
      ')' => depth += 1,
      '(' => {
        depth -= 1;
        if depth == 0 {
          open = Some(i);
          break;
        }
      }
      _ => {}
    }
  }
  let Some(open) = open else { return plain() };

  let inner = &title[open + 1..title.len() - 1];
  let Some(hash) = inner.rfind('#') else { return plain() };
  let name = inner[..hash].trim().trim_end_matches(',').trim();
  let number: String = inner[hash + 1..]
    .trim()
    .chars()
    .take_while(|c| c.is_ascii_digit() || *c == '.')
    .collect();
  let Ok(position) = number.trim_end_matches('.').parse::<f64>() else {
    return plain();
  };
  let base = title[..open].trim();
  if name.is_empty() || base.is_empty() {
    return plain();
  }
  (base.to_string(), Some((name.to_string(), position)))
}

fn status_of(exclusive_shelf: &str, date_read: &Option<String>, read_count: i64) -> ReadStatus {
  match exclusive_shelf.to_ascii_lowercase().as_str() {
    "currently-reading" => ReadStatus::Reading,
    "read" => ReadStatus::Finished,
    _ if date_read.is_some() || read_count > 0 => ReadStatus::Finished,
    _ => ReadStatus::Unread,
  }
}

fn parse_export(text: &str, include_additional_authors: bool) -> Res<ParsedImport> {
  let text = text.trim_start_matches('\u{feff}');
  let mut reader = csv::ReaderBuilder::new()
    .flexible(true)
    .from_reader(text.as_bytes());
  let headers = reader
    .headers()
    .map_err(|e| ImportError::new(format!("couldn't read the CSV: {e}")))?
    .clone();
  let col = |name: &str| headers.iter().position(|h| h.trim() == name);

  let title_col = col("Title");
  if title_col.is_none() || col("Book Id").is_none() {
    return Err(ImportError::new(
      "this doesn't look like a Goodreads export (no \"Book Id\" and \"Title\" columns)",
    ));
  }
  let (author, additional) = (col("Author"), col("Additional Authors"));
  let (isbn10, isbn13) = (col("ISBN"), col("ISBN13"));
  let (rating, pages) = (col("My Rating"), col("Number of Pages"));
  let (date_read, date_added) = (col("Date Read"), col("Date Added"));
  let (bookshelves, exclusive) = (col("Bookshelves"), col("Exclusive Shelf"));
  let (review, private_notes) = (col("My Review"), col("Private Notes"));
  let read_count = col("Read Count");

  let mut books = Vec::new();
  let mut problems = Vec::new();
  for (n, rec) in reader.records().enumerate() {
    let number = n + 1;
    let rec = match rec {
      Ok(rec) => rec,
      Err(e) => {
        problems.push(format!("row {number}: unreadable ({e})"));
        continue;
      }
    };

    let (title, series) = split_series(field(&rec, title_col));
    if title.is_empty() {
      problems.push(format!("row {number}: no title"));
      continue;
    }

    let mut authors = Vec::new();
    push_unique(&mut authors, field(&rec, author));
    if include_additional_authors {
      for name in field(&rec, additional).split(',') {
        push_unique(&mut authors, name);
      }
    }

    let exclusive_shelf = field(&rec, exclusive);
    let mut shelves = Vec::new();
    for name in field(&rec, bookshelves)
      .split(',')
      .chain(std::iter::once(exclusive_shelf))
    {
      let name = name.trim();
      if !STATUS_SHELVES.contains(&name.to_ascii_lowercase().as_str()) {
        push_unique(&mut shelves, name);
      }
    }

    let date_read = iso_date(field(&rec, date_read));
    let status = status_of(
      exclusive_shelf,
      &date_read,
      field(&rec, read_count).parse().unwrap_or(0),
    );

    books.push(ImportBook {
      number,
      title,
      series,
      authors,
      isbn: clean_isbn(field(&rec, isbn13)).or_else(|| clean_isbn(field(&rec, isbn10))),
      page_count: field(&rec, pages).parse::<i64>().ok().filter(|n| *n > 0),
      // Goodreads rates 0-5 stars (exports write `4.0`, older ones `4`, `0` = unrated)
      rating: scale_rating(field(&rec, rating), 5.0),
      review: clean_html(field(&rec, review)),
      private_notes: clean_html(field(&rec, private_notes)),
      date_added: iso_date(field(&rec, date_added)),
      date_read,
      shelves,
      status,
    });
  }

  // Goodreads lists newest first. Flipping it gives oldest first, so books with the same date
  // keep their order once the importer sorts by date added (a stable sort).
  books.reverse();
  Ok(ParsedImport { books, problems })
}

// SECTION: tests

/// A real-looking export, shared with the importer's database tests.
#[cfg(test)]
pub(super) mod test_support {
  pub(in crate::import) const HEADER: [&str; 23] = [
    "Book Id", "Title", "Author", "Author l-f", "Additional Authors", "ISBN", "ISBN13",
    "My Rating", "Publisher", "Binding", "Number of Pages", "Year Published",
    "Original Publication Year", "Date Read", "Date Added", "Bookshelves",
    "Bookshelves with positions", "Exclusive Shelf", "My Review", "Spoiler", "Private Notes",
    "Read Count", "Owned Copies",
  ];

  /// Quotes every field, like Goodreads does, so ISBNs come out as `="123"`-style cells.
  pub(in crate::import) fn line(fields: [&str; 23]) -> String {
    fields
      .iter()
      .map(|f| format!("\"{}\"", f.replace('"', "\"\"")))
      .collect::<Vec<_>>()
      .join(",")
  }

  /// Newest first, like a real export: a to-read book without ISBN and with extra authors, one
  /// in progress, a read book with a multi-line review, a custom exclusive shelf with a read
  /// date, and a row with no title.
  pub(in crate::import) fn sample() -> String {
    let rows = [
      line(["58826678", "Lord of the Mysteries Volume 1", "Ai Qianshui de Wuzei", "Wuzei, Ai Qianshui de",
        "Cuttlefish That Loves Diving, 爱潜水的乌贼", "=\"\"", "=\"\"", "0", "", "Kindle Edition", "1165",
        "2021", "", "", "2026/10/17", "to-read", "to-read (#63)", "to-read", "", "", "", "0", "0"]),
      line(["301538", "The Darkness That Comes Before (The Prince of Nothing, #1)", "R. Scott Bakker",
        "Bakker, R. Scott", "", "=\"1585676772\"", "=\"9781585676774\"", "4.0", "Overlook Books", "Paperback",
        "608", "2005", "2003", "", "2026/10/09", "", "", "read",
        "Great<br/>stuff &amp; more\nsecond line", "", "", "1", "0"]),
      line(["7", "Dune", "Frank Herbert", "Herbert, Frank", "", "=\"0441013597\"", "=\"\"", "0", "Ace",
        "Paperback", "0", "1990", "1965", "", "2026/09/01", "", "", "currently-reading", "", "", "", "0", "0"]),
      line(["8", "Mistborn (Mistborn, #1.5)", "Brandon Sanderson", "Sanderson, Brandon", "", "=\"\"",
        "=\"9780765311788\"", "5", "Tor", "Hardcover", "541", "2006", "2006", "2026/05/04", "2026/05/01",
        "favorites, owned-read", "favorites (#1)", "owned-read", "", "", "Mine", "1", "1"]),
      line(["9", "", "Nobody", "Nobody", "", "=\"\"", "=\"\"", "0", "", "", "", "", "", "", "2026/01/01", "",
        "", "to-read", "", "", "", "0", "0"]),
    ];
    format!("{}\n{}\n", HEADER.map(|h| format!("\"{h}\"")).join(","), rows.join("\n"))
  }
}

#[cfg(test)]
mod tests {
  use std::collections::HashMap;

  use super::{test_support::sample, *};

  fn parse(text: &str, additional: bool) -> Res<ParsedImport> {
    parse_export(text, additional)
  }

  #[test]
  fn series_is_split_from_the_title() {
    let (title, series) = split_series("The Darkness That Comes Before (The Prince of Nothing, #1)");
    assert_eq!(title, "The Darkness That Comes Before");
    assert_eq!(series, Some(("The Prince of Nothing".to_string(), 1.0)));

    let series = |t: &str| split_series(t).1;
    assert_eq!(series("Theft of Swords (The Riyria Revelations, #1-2)"), Some(("The Riyria Revelations".to_string(), 1.0)));
    assert_eq!(series("Mistborn (Mistborn, #1.5)"), Some(("Mistborn".to_string(), 1.5)));
    assert_eq!(series("A Title (Series (Part One), #3)"), Some(("Series (Part One)".to_string(), 3.0)));
    assert_eq!(series("C Sharp (C#, #2)"), Some(("C#".to_string(), 2.0)));

    // not series: left alone
    for t in ["Dune", "Dune (Penguin Classics)", "Odd (#1)", "Odd (Series, #)", "(Series, #1)"] {
      assert_eq!(split_series(t), (t.to_string(), None), "{t}");
    }
  }

  #[test]
  fn other_csv_files_are_refused() {
    assert!(parse("a,b\n1,2\n", false).is_err());
  }

  #[test]
  fn rows_become_neutral_books() {
    let parsed = parse(&sample(), false).unwrap();
    assert_eq!(parsed.problems, vec!["row 5: no title".to_string()]);
    // flipped to oldest first: Mistborn, Dune, Darkness, Lord of the Mysteries
    let titles: Vec<_> = parsed.books.iter().map(|b| b.title.as_str()).collect();
    assert_eq!(titles, ["Mistborn", "Dune", "The Darkness That Comes Before", "Lord of the Mysteries Volume 1"]);

    let darkness = &parsed.books[2];
    assert_eq!(darkness.series, Some(("The Prince of Nothing".to_string(), 1.0)));
    assert_eq!(darkness.isbn.as_deref(), Some("9781585676774"));
    assert_eq!(darkness.rating, 8.0);
    assert_eq!(darkness.review, "Great\nstuff & more\nsecond line");
    assert_eq!(darkness.date_added.as_deref(), Some("2026-10-09"));
    assert_eq!(darkness.status, ReadStatus::Finished);
    assert!(darkness.shelves.is_empty(), "read is a status, not a shelf: {:?}", darkness.shelves);

    let mistborn = &parsed.books[0];
    assert_eq!(mistborn.rating, 10.0);
    assert_eq!(mistborn.private_notes, "Mine");
    assert_eq!(mistborn.date_read.as_deref(), Some("2026-05-04"));
    assert_eq!(mistborn.shelves, ["favorites", "owned-read"]);
    // custom exclusive shelf, but it has a read date
    assert_eq!(mistborn.status, ReadStatus::Finished);

    assert_eq!(parsed.books[1].status, ReadStatus::Reading);
    assert_eq!(parsed.books[3].status, ReadStatus::Unread);
  }

  #[test]
  fn additional_authors_are_opt_in() {
    let lord = |additional| parse(&sample(), additional).unwrap().books.pop().unwrap().authors;
    assert_eq!(lord(false), ["Ai Qianshui de Wuzei"]);
    assert_eq!(lord(true), ["Ai Qianshui de Wuzei", "Cuttlefish That Loves Diving", "爱潜水的乌贼"]);
  }

  #[test]
  fn the_switch_is_read_from_the_format_options() {
    let on = FormatOptions(HashMap::from([(ADDITIONAL_AUTHORS.to_string(), true)]));
    let off = FormatOptions::default();
    let authors = |o: &FormatOptions| Goodreads.parse(&sample(), o).unwrap().books.pop().unwrap().authors.len();
    assert_eq!((authors(&off), authors(&on)), (1, 3));
    assert!(Goodreads.options().iter().any(|o| o.key == ADDITIONAL_AUTHORS && !o.default_value));
  }
}
