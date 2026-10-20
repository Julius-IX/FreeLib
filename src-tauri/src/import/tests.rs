//! Tests of the importing half against a real (in-memory) database: the Goodreads export end to
//! end, plus a made-up second format to show the core doesn't care where books come from.

use std::{collections::HashMap, str::FromStr};

use sqlx::{
  SqlitePool,
  sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

use super::{
  FormatOptions, ImportBook, ImportOptionSpec, Importer, LibraryImportOptions,
  LibraryImportReport, ParsedImport, ReadStatus, Res, build_notes, find_importer,
  goodreads::{Goodreads, test_support::sample},
  resolve_options, run_import, IMPORTERS,
};

fn opts() -> LibraryImportOptions {
  LibraryImportOptions {
    estimate_dates: true,
    format_options: HashMap::new(),
  }
}

fn pool() -> SqlitePool {
  tauri::async_runtime::block_on(async {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
      .unwrap()
      .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
      .max_connections(1)
      .connect_with(options)
      .await
      .unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    pool
  })
}

fn import_with(
  pool: &SqlitePool,
  importer: &dyn Importer,
  text: &str,
  opts: &LibraryImportOptions,
) -> LibraryImportReport {
  tauri::async_runtime::block_on(run_import(pool, importer, text, opts)).unwrap()
}

fn import(pool: &SqlitePool, csv: &str, opts: &LibraryImportOptions) -> LibraryImportReport {
  import_with(pool, &Goodreads, csv, opts)
}

fn count(pool: &SqlitePool, sql: &str) -> i64 {
  tauri::async_runtime::block_on(sqlx::query_scalar(sql).fetch_one(pool)).unwrap()
}

fn rating_of(pool: &SqlitePool, title: &str) -> f64 {
  tauri::async_runtime::block_on(
    sqlx::query_scalar::<_, f64>("SELECT rating FROM book WHERE title = ?")
      .bind(title.to_string())
      .fetch_one(pool),
  )
  .unwrap()
}

// SECTION: the generic core

#[test]
fn notes_combine_review_and_private_notes() {
  assert_eq!(build_notes("", ""), "");
  assert_eq!(build_notes("  Great  ", ""), "Great");
  assert_eq!(build_notes("", "Mine"), "Private notes: Mine");
  assert_eq!(build_notes("Great", "Mine"), "Great\n\nPrivate notes: Mine");
}

#[test]
fn the_registry_is_sound() {
  let mut ids: Vec<_> = IMPORTERS.iter().map(|i| i.id()).collect();
  assert!(!ids.is_empty());
  for id in &ids {
    assert_eq!(*id, id.to_ascii_lowercase(), "ids are lower-case: {id}");
    assert!(find_importer(id).is_some(), "{id}");
  }
  ids.sort_unstable();
  ids.dedup();
  assert_eq!(ids.len(), IMPORTERS.len(), "ids are unique");
  assert!(find_importer("nope").is_none());
  for i in IMPORTERS {
    assert!(!i.name().is_empty() && !i.extensions().is_empty());
  }
}

/// A made-up format: one `title;author;date added` per line. Adding a real format is this much
/// work in the importing half, which is the point.
struct Lines;

impl Importer for Lines {
  fn id(&self) -> &'static str {
    "lines"
  }
  fn name(&self) -> &'static str {
    "Lines"
  }
  fn description(&self) -> &'static str {
    "title;author;date"
  }
  fn extensions(&self) -> &'static [&'static str] {
    &["txt"]
  }
  fn options(&self) -> Vec<ImportOptionSpec> {
    vec![ImportOptionSpec::new("shout", "Shout", "Upper-case titles", false)]
  }
  fn parse(&self, text: &str, options: &FormatOptions) -> Res<ParsedImport> {
    let mut parsed = ParsedImport::default();
    for (n, line) in text.lines().enumerate() {
      let parts: Vec<_> = line.split(';').collect();
      let [title, author, date] = parts[..] else {
        parsed.problems.push(format!("row {}: expected 3 parts", n + 1));
        continue;
      };
      parsed.books.push(ImportBook {
        number: n + 1,
        title: if options.enabled("shout") { title.to_uppercase() } else { title.to_string() },
        series: None,
        authors: vec![author.to_string()],
        isbn: None,
        page_count: None,
        rating: 0.0,
        review: String::new(),
        private_notes: String::new(),
        date_added: Some(date.to_string()),
        date_read: None,
        shelves: Vec::new(),
        status: ReadStatus::Unread,
      });
    }
    Ok(parsed)
  }
}

#[test]
fn any_format_can_feed_the_importer() {
  let pool = pool();
  // listed newest first, the importer inserts oldest first whatever order the format gives
  let text = "Newer;Ann;2026-02-01\nOlder;Bob;2026-01-01\nbroken line\n";
  let report = import_with(&pool, &Lines, text, &opts());
  assert_eq!((report.imported, report.failed), (2, 1));
  assert_eq!(report.messages, vec!["row 3: expected 3 parts".to_string()]);

  let titles: Vec<String> = tauri::async_runtime::block_on(
    sqlx::query_scalar("SELECT title FROM book ORDER BY book_id").fetch_all(&pool),
  )
  .unwrap();
  assert_eq!(titles, ["Older", "Newer"]);
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM author"), 2);

  // same books again: duplicates by title + first author
  let again = import_with(&pool, &Lines, text, &opts());
  assert_eq!((again.imported, again.skipped_duplicates), (0, 2));
}

#[test]
fn format_options_default_and_override() {
  let off = resolve_options(&Lines, &HashMap::new());
  assert!(!off.enabled("shout"));
  assert!(!off.enabled("never-declared"));

  let on = resolve_options(&Lines, &HashMap::from([("shout".to_string(), true)]));
  assert!(on.enabled("shout"));
  // keys the format didn't declare are dropped
  let stray = resolve_options(&Lines, &HashMap::from([("other".to_string(), true)]));
  assert!(!stray.enabled("other"));

  let pool = pool();
  let mut o = opts();
  o.format_options.insert("shout".to_string(), true);
  import_with(&pool, &Lines, "quiet;Ann;2026-01-01\n", &o);
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM book WHERE title = 'QUIET'"), 1);
}

#[test]
fn a_file_of_the_wrong_format_changes_nothing() {
  let pool = pool();
  let result = tauri::async_runtime::block_on(run_import(&pool, &Goodreads, "a,b\n1,2\n", &opts()));
  assert!(result.is_err());
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM book"), 0);
}

// SECTION: Goodreads end to end

#[test]
fn imports_books_series_shelves_and_readings() {
  let pool = pool();
  let report = import(&pool, &sample(), &opts());

  assert_eq!((report.imported, report.skipped_duplicates, report.failed), (4, 0, 1));
  assert_eq!(report.messages, vec!["row 5: no title".to_string()]);
  // exactly the created books, each id a real row
  assert_eq!(report.imported_book_ids.len(), 4);
  for id in &report.imported_book_ids {
    let sql = format!("SELECT COUNT(*) FROM book WHERE book_id = {id}");
    assert_eq!(count(&pool, &sql), 1);
  }
  assert_eq!(
    (report.authors_created, report.series_created, report.shelves_created),
    (4, 2, 3)
  );
  // Dune (open, started = date added), Darkness (finished = date added), Mistborn (real date)
  assert_eq!((report.readings_created, report.estimated_dates), (3, 2));

  let (title, series, position, notes): (String, String, f64, String) = tauri::async_runtime::block_on(
    sqlx::query_as(
      "SELECT b.title, s.name, b.series_position, b.notes FROM book b
       JOIN series s ON s.series_id = b.series_id WHERE b.isbn = '9781585676774'",
    )
    .fetch_one(&pool),
  )
  .unwrap();
  assert_eq!(title, "The Darkness That Comes Before");
  assert_eq!(series, "The Prince of Nothing");
  assert_eq!(position, 1.0);
  assert_eq!(notes, "Great\nstuff & more\nsecond line");

  // a book with only a private note
  assert_eq!(
    tauri::async_runtime::block_on(
      sqlx::query_scalar::<_, String>("SELECT notes FROM book WHERE isbn = '9780765311788'").fetch_one(&pool)
    )
    .unwrap(),
    "Private notes: Mine"
  );

  let reading = |isbn: &str| -> (Option<String>, Option<String>) {
    tauri::async_runtime::block_on(
      sqlx::query_as(
        "SELECT r.date_started, r.date_finished FROM reading r
         JOIN book b ON b.book_id = r.book_id WHERE b.isbn = ?",
      )
      .bind(isbn.to_string())
      .fetch_one(&pool),
    )
    .unwrap()
  };
  assert_eq!(reading("0441013597"), (Some("2026-09-01".into()), None));
  assert_eq!(reading("9781585676774"), (None, Some("2026-10-09".into())));
  assert_eq!(reading("9780765311788"), (None, Some("2026-05-04".into())));

  // to-read book: no reading, shelf, no ISBN, no pages guessed, one author
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM reading"), 3);
  assert_eq!(
    count(&pool, "SELECT COUNT(*) FROM book b JOIN book_shelf bs ON bs.book_id = b.book_id JOIN shelf s ON s.shelf_id = bs.shelf_id WHERE s.name = 'to-read' AND b.isbn IS NULL"),
    1
  );
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM book WHERE page_count IS NULL AND title = 'Dune'"), 1);
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM book_author"), 4);
  // "read" / "currently-reading" are statuses, not shelves
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM shelf WHERE name IN ('read', 'currently-reading')"), 0);
  // added_at comes from Date Added
  assert_eq!(
    count(&pool, "SELECT COUNT(*) FROM book WHERE title = 'Dune' AND added_at = '2026-09-01T00:00:00.000Z'"),
    1
  );
  // oldest added first, so ids follow the order books were added in
  assert_eq!(count(&pool, "SELECT book_id FROM book WHERE title = 'Mistborn'"), 1);
}

#[test]
fn ratings_land_in_the_rating_column() {
  let pool = pool();
  import(&pool, &sample(), &opts());
  assert_eq!(rating_of(&pool, "The Darkness That Comes Before"), 8.0);
  assert_eq!(rating_of(&pool, "Mistborn"), 10.0);
  // unrated books are 0, not NULL (the column is NOT NULL)
  assert_eq!(rating_of(&pool, "Dune"), 0.0);
}

#[test]
fn the_database_refuses_ratings_outside_zero_to_ten() {
  let pool = pool();
  let insert = |rating: f64| {
    tauri::async_runtime::block_on(
      sqlx::query("INSERT INTO book (title, rating) VALUES ('X', ?)")
        .bind(rating)
        .execute(&pool),
    )
  };
  assert!(insert(10.5).is_err());
  assert!(insert(-1.0).is_err());
  assert!(insert(7.5).is_ok());
}

#[test]
fn books_without_an_isbn_are_still_imported() {
  // No ISBN columns at all (a trimmed export): everything still comes in.
  let pool = pool();
  let csv = "Book Id,Title,Author\n1,Alpha,Ann Author\n2,Beta,Ann Author\n3,Alpha,Bob Other\n";
  let report = import(&pool, csv, &opts());
  assert_eq!((report.imported, report.failed), (3, 0));
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM book WHERE isbn IS NULL"), 3);

  // Empty `=""`, an ASIN and a too-short number aren't ISBNs: imported without one.
  let csv = "Book Id,Title,Author,ISBN,ISBN13\n\
             4,Gamma,Ann Author,\"=\"\"\"\"\",\"=\"\"\"\"\"\n\
             5,Delta,Ann Author,\"=\"\"B00XYZ1234\"\"\",\"=\"\"\"\"\"\n\
             6,Epsilon,Ann Author,\"=\"\"12345\"\"\",\"=\"\"\"\"\"\n";
  let report = import(&pool, csv, &opts());
  assert_eq!((report.imported, report.failed), (3, 0));
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM book WHERE isbn IS NULL"), 6);

  // Same title by a different author is a different book. The same one again is a repeat.
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM book WHERE title = 'Alpha'"), 2);
  let again = import(&pool, csv, &opts());
  assert_eq!((again.imported, again.skipped_duplicates), (0, 3));
}

#[test]
fn importing_twice_adds_nothing() {
  let pool = pool();
  import(&pool, &sample(), &opts());
  let again = import(&pool, &sample(), &opts());
  assert_eq!((again.imported, again.skipped_duplicates), (0, 4));
  assert!(again.imported_book_ids.is_empty());
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM book"), 4);
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM reading"), 3);
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM author"), 4);
}

#[test]
fn options_change_the_result() {
  let pool = pool();
  let report = import(
    &pool,
    &sample(),
    &LibraryImportOptions {
      estimate_dates: false,
      format_options: HashMap::from([("include_additional_authors".to_string(), true)]),
    },
  );
  // Lord of the Mysteries brings two more "authors"
  assert_eq!(report.authors_created, 6);
  // only Mistborn has a real date, the in-progress book still gets an (undated) open reading
  // but the finished one without a date gets none
  assert_eq!((report.readings_created, report.estimated_dates), (2, 0));
  // the options don't touch ratings
  assert_eq!(count(&pool, "SELECT COUNT(*) FROM book WHERE rating > 0"), 2);
}
