//! Filtering and sorting the library: the `filter_books` command.
//!
//! [`BookFilter`] says which books to keep, [`BookSort`] how to order them. The pieces:
//!
//! - `conditions/`: one file per kind of condition. Each turns the filter fields it owns into SQL.
//! - `sort.rs`: the ordering, independent of what is filtered.
//! - `dates.rs`: reading typed dates, and the SQL that compares them with stored (partial) dates.
//! - `sql.rs`: small SQL building blocks the conditions share.
//!
//! **Adding a filter**
//! 1. Add the field to [`BookFilter`] (and its line in the doc above it).
//! 2. Add its SQL to the file in `conditions/` that fits, or a new file plus one line in
//!    `conditions/mod.rs`. Every condition appends ` AND <condition>`, and ignores a value it can't
//!    use (half-typed input) instead of failing.
//! 3. Add the field to `src/lib/types.ts` (generated: `cargo test export_bindings`, or run the app)
//!    and a definition under `src/features/library/search/fields/` so it can be typed in the
//!    search box.
//! 4. Add a case to `tests/cases.rs`.

mod conditions;
mod dates;
mod sort;
mod sql;
#[cfg(test)]
mod tests;

use serde::Deserialize;
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use tauri::{AppHandle, State};
use tauri_groups::{TsType, command};

use crate::covers;
use crate::database::Res;
use crate::models::Book;

pub(crate) use dates::parse_full_date;
use sort::BookSort;

#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub enum ReadStatus {
  /// No reading rows at all.
  Unread,
  /// At least one reading row with no `date_finished`.
  InProgress,
  /// At least one reading row with a `date_finished`.
  Finished,
}

/// Everything you can filter books on. Every field is optional (or an empty
/// list) and means "don't filter on this"; all the ones you set are ANDed.
///
/// **Substring** (case-insensitive, ASCII only)
/// - `text`: title OR blurb OR notes OR isbn OR any author name OR any tag name OR any category
///   name OR series name. A `text` that is only a `#` hex colour (`#ff0000`) also matches books
///   with a category of that colour.
/// - `title`, `blurb`, `notes`: that field only
/// - `author`: any of the book's authors
/// - `tag`: any of the book's tags
/// - `series`: the series name
/// - `category`: any of the book's categories
///
/// **Colour**
/// - `color`: a CSS colour name (`red`, `DarkSeaGreen`, see [`CssColor`], any case) or a hex colour
///   (`#ff0000`, `ff0000` or `#f00`, any case) that one of the book's categories has, exactly.
///   Anything that is neither a CSS colour name nor a 3 or 6 digit hex colour is ignored, like a
///   half-typed date. If `category` is set too, a single category must match both.
///
/// **Ids**
/// - `series_id`: exact series
/// - `author_ids_any`: has at least one of these authors
/// - `tag_ids_any`: has at least one of these tags
/// - `tag_ids_all`: has every one of these tags
/// - `tag_ids_none`: has none of these tags
/// - `category_ids_any` / `category_ids_all` / `category_ids_none`: the same three, for categories
/// - `shelf_ids_any` / `shelf_ids_none`: on at least one of these shelves / on none of them
///
/// **Book**
/// - `publish_from` / `publish_to`: publish date range
/// - `page_count_min` / `page_count_max`: inclusive page range. Setting either
///   excludes books with no page count. A reversed range (min > max) is swapped.
/// - `rating_min` / `rating_max`: inclusive rating range, on the 0-10 scale a rating is stored in.
///   Setting either excludes unrated books (rating 0), so `rating_max = 5` means "rated 5 or less",
///   not "5 or less, or never rated". With `rating_min_exclusive` / `rating_max_exclusive` the
///   bound itself is left out (`>` and `<` instead of `>=` and `<=`). A reversed range is swapped,
///   each bound keeping its own exclusivity.
///
/// **Author dates** (matches if any single author fits all the bounds you set)
/// - `author_birth_from` / `author_birth_to`
/// - `author_death_from` / `author_death_to`
///
/// **Reading**
/// - `read_status`: `unread`, `inProgress` or `finished`
/// - `started_from` / `started_to` / `finished_from` / `finished_to`: a single
///   reading row must satisfy every bound you set, so rereads can't cross-match
///
/// **Filled in**
/// - `has`: every field listed is there. `isbn`, `blurb`, `notes` and `published` need some text
///   (spaces alone don't count), `pages` a page count, `rating` a rating above 0, `series` a
///   series, `author` / `tag` / `category` / `shelf` at least one of them, and `cover` a stored
///   cover image (a file, so which books have one is looked up outside the database).
///
/// **Leaving books out**
/// - `exclude`: filters whose matches are left out. Each entry is a whole `BookFilter`, so
///   anything above works in it (`has`, ranges, text, even another `exclude`), and a book is left
///   out when it matches the entry. `[{ tag: "fantasy" }, { has: ["cover"] }]` leaves out the
///   fantasy books AND the books with a cover: the entries are independent. Several conditions
///   inside ONE entry must all match to leave a book out (`{ tag: "fantasy", has: ["cover"] }`
///   leaves out only fantasy books that have a cover). A book that has no value for a field
///   doesn't match a condition on it, so it stays: "not published in 2024" keeps the books with
///   no publish date. An entry with nothing usable in it leaves nothing out.
///
/// **Dates** (every `*_from` / `*_to` field)
///
/// Bounds are inclusive and forgiving about format, see [`parse_date`]:
/// `2024-03-07`, `2024/3/7`, `2024.03.07`, `20240307`, `7 March 2024`,
/// `Mar 7, 2024`, `2024-03-07T10:00:00Z`, and partial dates `2024`, `2024-03`,
/// `March 2024`. A partial date stands for its whole period: as a `from` bound
/// it is the first day (`2024` -> `2024-01-01`), as a `to` bound the last day
/// (`2024` -> `2024-12-31`), so `from = to = "2024"` means "during 2024".
///
/// Stored values may be partial too (`1950`, `1950-03`). A stored value counts
/// as the whole period it names, and matches if that period overlaps your
/// range. Rows where the date is NULL, empty or not date-like never match a
/// date bound. A bound that can't be parsed (for example half-typed input) is
/// ignored rather than treated as an error. If `from` ends up after `to`, the
/// two are swapped.
#[derive(Debug, Clone, Default, Deserialize, TsType)]
#[serde(rename_all = "camelCase", default)]
pub struct BookFilter {
  pub text: Option<String>,
  pub title: Option<String>,
  pub blurb: Option<String>,
  pub notes: Option<String>,
  pub author: Option<String>,
  pub tag: Option<String>,
  pub series: Option<String>,
  pub category: Option<String>,
  pub color: Option<String>,

  pub series_id: Option<i64>,
  pub author_ids_any: Vec<i64>,
  pub tag_ids_any: Vec<i64>,
  pub tag_ids_all: Vec<i64>,
  pub tag_ids_none: Vec<i64>,
  pub category_ids_any: Vec<i64>,
  pub category_ids_all: Vec<i64>,
  pub category_ids_none: Vec<i64>,
  pub shelf_ids_any: Vec<i64>,
  pub shelf_ids_none: Vec<i64>,

  pub publish_from: Option<String>,
  pub publish_to: Option<String>,
  pub page_count_min: Option<i64>,
  pub page_count_max: Option<i64>,
  pub rating_min: Option<f64>,
  pub rating_max: Option<f64>,
  pub rating_min_exclusive: bool,
  pub rating_max_exclusive: bool,

  pub author_birth_from: Option<String>,
  pub author_birth_to: Option<String>,
  pub author_death_from: Option<String>,
  pub author_death_to: Option<String>,

  pub read_status: Option<ReadStatus>,
  pub started_from: Option<String>,
  pub started_to: Option<String>,
  pub finished_from: Option<String>,
  pub finished_to: Option<String>,

  pub has: Vec<BookField>,

  pub exclude: Vec<BookFilter>,
}

/// Something a book can have or lack, for `BookFilter::has`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub enum BookField {
  Isbn,
  Cover,
  Rating,
  Blurb,
  Notes,
  Published,
  Pages,
  Series,
  Author,
  Tag,
  Category,
  Shelf,
}

/// What a query needs to know that isn't in the database.
#[derive(Debug, Default)]
pub(crate) struct Outside {
  /// The books that have a cover. Covers are files, so the command looks them up and hands the
  /// answer in; it only does so when the filter asks about covers (see [`BookFilter::asks_about_covers`]).
  pub cover_ids: Vec<i64>,
}

impl BookFilter {
  /// Whether answering this filter needs to know which books have a cover.
  fn asks_about_covers(&self) -> bool {
    self.has.contains(&BookField::Cover) || self.exclude.iter().any(BookFilter::asks_about_covers)
  }
}
// SECTION: query

/// `sort` defaults to title, A to Z.
#[command(db)]
async fn filter_books(
  app: AppHandle,
  pool: State<'_, SqlitePool>,
  filter: BookFilter,
  sort: Option<BookSort>,
) -> Res<Vec<Book>> {
  let outside = Outside {
    cover_ids: if filter.asks_about_covers() {
      covers::book_ids_with_cover(&app)
    } else {
      Vec::new()
    },
  };
  query_books(pool.inner(), &filter, sort.unwrap_or_default(), &outside).await
}

/// The books matching `filter`, in `sort` order. What the command runs; the tests call it directly.
pub(crate) async fn query_books(
  pool: &SqlitePool,
  filter: &BookFilter,
  sort: BookSort,
  outside: &Outside,
) -> Res<Vec<Book>> {
  let mut qb = QueryBuilder::<Sqlite>::new("SELECT b.* FROM book b WHERE 1 = 1");
  conditions::push(&mut qb, filter, outside);
  qb.push(sort::order_by(sort));
  Ok(qb.build_query_as::<Book>().fetch_all(pool).await?)
}

#[command(db)]
pub async fn series_exists(pool: State<'_, SqlitePool>, name: String) -> Res<bool> {
  Ok(
    sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM series WHERE name = ?)")
      .bind(name)
      .fetch_one(pool.inner())
      .await?,
  )
}
