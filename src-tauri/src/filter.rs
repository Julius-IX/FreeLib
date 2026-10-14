use serde::Deserialize;
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use tauri::State;
use tauri_groups::{TsType, command};

use crate::database::Res;
use crate::models::Book;

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
/// - `text`: title OR blurb OR isbn OR any author name OR any tag name OR series name
/// - `title`, `blurb`: that field only
/// - `author`: any of the book's authors
/// - `tag`: any of the book's tags
/// - `series`: the series name
///
/// **Ids**
/// - `series_id`: exact series
/// - `author_ids_any`: has at least one of these authors
/// - `tag_ids_any`: has at least one of these tags
/// - `tag_ids_all`: has every one of these tags
/// - `tag_ids_none`: has none of these tags
///
/// **Book**
/// - `publish_from` / `publish_to`: publish date range
/// - `page_count_min` / `page_count_max`: inclusive page range. Setting either
///   excludes books with no page count. A reversed range (min > max) is swapped.
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
  pub author: Option<String>,
  pub tag: Option<String>,
  pub series: Option<String>,

  pub series_id: Option<i64>,
  pub author_ids_any: Vec<i64>,
  pub tag_ids_any: Vec<i64>,
  pub tag_ids_all: Vec<i64>,
  pub tag_ids_none: Vec<i64>,

  pub publish_from: Option<String>,
  pub publish_to: Option<String>,
  pub page_count_min: Option<i64>,
  pub page_count_max: Option<i64>,

  pub author_birth_from: Option<String>,
  pub author_birth_to: Option<String>,
  pub author_death_from: Option<String>,
  pub author_death_to: Option<String>,

  pub read_status: Option<ReadStatus>,
  pub started_from: Option<String>,
  pub started_to: Option<String>,
  pub finished_from: Option<String>,
  pub finished_to: Option<String>,
}

// SECTION: helpers

const ESC: &str = " ESCAPE '\\'";
const AUTHOR_EXISTS: &str = "EXISTS (SELECT 1 FROM book_author ba \
  JOIN author a ON a.author_id = ba.author_id WHERE ba.book_id = b.book_id";
const TAG_EXISTS: &str = "EXISTS (SELECT 1 FROM book_tag bt \
  JOIN tag t ON t.tag_id = bt.tag_id WHERE bt.book_id = b.book_id";

/// `%needle%` with LIKE wildcards in the needle escaped.
fn like(s: &str) -> String {
  format!(
    "%{}%",
    s.replace('\\', "\\\\")
      .replace('%', "\\%")
      .replace('_', "\\_")
  )
}

fn push_like(qb: &mut QueryBuilder<'_, Sqlite>, prefix: &str, needle: &str) {
  qb.push(prefix).push_bind(like(needle)).push(ESC);
}

fn push_in(qb: &mut QueryBuilder<'_, Sqlite>, ids: &[i64]) {
  qb.push("(");
  let mut sep = qb.separated(", ");
  for id in ids {
    sep.push_bind(*id);
  }
  sep.push_unseparated(")");
}

fn sorted_unique(ids: &[i64]) -> Vec<i64> {
  let mut v = ids.to_vec();
  v.sort_unstable();
  v.dedup();
  v
}

// SECTION: dates

// BEGIN DATES (extracted verbatim by the unit tests)

const MONTHS: [&str; 12] = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

#[derive(Clone, Copy)]
enum Part {
  /// A run of digits and how many digits it had.
  Num(u32, usize),
  Month(u32),
}

/// "mar", "March", "sept" -> month number. Needs at least 3 letters.
fn month_name(s: &str) -> Option<u32> {
  let s = s.to_ascii_lowercase();
  if s.len() < 3 {
    return None;
  }
  MONTHS
    .iter()
    .position(|m| m.starts_with(&s))
    .map(|i| i as u32 + 1)
}

fn parse_part(tok: &str) -> Option<Part> {
  if tok.bytes().all(|b| b.is_ascii_digit()) {
    return Some(Part::Num(tok.parse().ok()?, tok.len()));
  }
  // ordinals: 1st, 2nd, 3rd, 7th
  let digits = tok.trim_end_matches(|c: char| c.is_ascii_alphabetic());
  let suffix = &tok[digits.len()..];
  if !digits.is_empty()
    && digits.bytes().all(|b| b.is_ascii_digit())
    && matches!(
      suffix.to_ascii_lowercase().as_str(),
      "st" | "nd" | "rd" | "th"
    )
  {
    return Some(Part::Num(digits.parse().ok()?, digits.len()));
  }
  month_name(tok).map(Part::Month)
}

fn month_of(p: &Part) -> Option<u32> {
  match p {
    Part::Num(n, len) if *len <= 2 && (1..=12).contains(n) => Some(*n),
    Part::Month(m) => Some(*m),
    _ => None,
  }
}

fn day_of(p: &Part) -> Option<u32> {
  match p {
    Part::Num(n, len) if *len <= 2 && (1..=31).contains(n) => Some(*n),
    _ => None,
  }
}

/// `a b year` -> (month, day). Month names decide the order; with two numbers
/// the one above 12 is the day, and when it's ambiguous (03/04/2024) the day
/// comes first (3 April), the way it is written in most of the world.
fn month_day_before_year(a: &Part, b: &Part) -> Option<(u32, u32)> {
  match (a, b) {
    (Part::Month(m), d) | (d, Part::Month(m)) => Some((*m, day_of(d)?)),
    (Part::Num(x, _), Part::Num(z, _)) => {
      if *x <= 12 && *z > 12 {
        Some((month_of(a)?, day_of(b)?))
      } else {
        Some((month_of(b)?, day_of(a)?))
      }
    }
  }
}

fn days_in_month(y: u32, m: u32) -> u32 {
  match m {
    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
    4 | 6 | 9 | 11 => 30,
    _ if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
    _ => 28,
  }
}

/// Parses a full or partial date into `YYYY-MM-DD`. A partial date expands to
/// the first day of its period (`end = false`) or the last (`end = true`).
///
/// Accepted: `2024`, `2024-03`, `2024-03-07` (separators `-` `/` `.` or
/// spaces, 1 or 2 digit month and day), compact `202403` / `20240307`,
/// `March 2024`, `Mar 7, 2024`, `7th March 2024`, `3/2024`, `07.03.2024`, and
/// anything with a trailing `T...` time part. Returns `None` for anything else
/// and for dates that don't exist (`2023-02-29`).
fn parse_date(raw: &str, end: bool) -> Option<String> {
  let mut s = raw.trim();
  if let Some(i) = s.find('T') {
    if s[..i].ends_with(|c: char| c.is_ascii_digit())
      && s[i + 1..].starts_with(|c: char| c.is_ascii_digit())
    {
      s = &s[..i];
    }
  }

  // Only separators we understand. Anything else (`>2024`, `2024:`) is not a date,
  // rather than silently becoming one.
  if s
    .chars()
    .any(|c| !(c.is_alphanumeric() || c.is_whitespace() || "-/.,".contains(c)))
  {
    return None;
  }

  let parts: Vec<Part> = s
    .split(|c: char| !c.is_alphanumeric())
    .filter(|t| !t.is_empty() && !t.eq_ignore_ascii_case("of"))
    .map(parse_part)
    .collect::<Option<_>>()?;

  let (y, m, d): (u32, Option<u32>, Option<u32>) = match parts.as_slice() {
    [Part::Num(n, 4)] => (*n, None, None),
    [Part::Num(n, 6)] => (n / 100, Some(n % 100), None),
    [Part::Num(n, 8)] => (n / 10_000, Some(n / 100 % 100), Some(n % 100)),
    [Part::Num(y, 4), a] => (*y, Some(month_of(a)?), None),
    [a, Part::Num(y, 4)] => (*y, Some(month_of(a)?), None),
    [Part::Num(y, 4), a, b] => (*y, Some(month_of(a)?), Some(day_of(b)?)),
    [a, b, Part::Num(y, 4)] => {
      let (m, d) = month_day_before_year(a, b)?;
      (*y, Some(m), Some(d))
    }
    _ => return None,
  };

  if !(1..=9999).contains(&y) {
    return None;
  }
  let m = m.unwrap_or(if end { 12 } else { 1 });
  if !(1..=12).contains(&m) {
    return None;
  }
  let last = days_in_month(y, m);
  let d = match d {
    Some(d) if (1..=last).contains(&d) => d,
    Some(_) => return None,
    None if end => last,
    None => 1,
  };
  Some(format!("{y:04}-{m:02}-{d:02}"))
}

/// A normalised inclusive date range. Either side may be open.
#[derive(Debug, Default, PartialEq)]
struct DateBound {
  from: Option<String>,
  to: Option<String>,
}

impl DateBound {
  fn is_empty(&self) -> bool {
    self.from.is_none() && self.to.is_none()
  }
}

/// Parses both sides (unparseable ones become open) and swaps a reversed range.
fn date_bound(from: &Option<String>, to: &Option<String>) -> DateBound {
  let parse = |s: &Option<String>, end: bool| s.as_deref().and_then(|s| parse_date(s, end));
  let b = DateBound {
    from: parse(from, false),
    to: parse(to, true),
  };
  let reversed = matches!((&b.from, &b.to), (Some(f), Some(t)) if f > t);
  if reversed {
    DateBound {
      from: parse(to, false),
      to: parse(from, true),
    }
  } else {
    b
  }
}

/// Adds the date conditions for `col`. The column is read as the period it
/// names: `1950` is 1950-01-01..1950-12-31, `1950-03` is all of March 1950.
/// It matches when that period overlaps the range. Done in SQL by padding the
/// stored text, so plain string comparison on ISO dates stays correct.
fn push_date(qb: &mut QueryBuilder<'_, Sqlite>, col: &str, b: &DateBound) {
  if b.is_empty() {
    return;
  }
  let d = format!("NULLIF(SUBSTR({col}, 1, 10), '')");
  qb.push(format!(" AND {d} GLOB '[0-9][0-9][0-9][0-9]*'"));
  if let Some(f) = &b.from {
    // latest day the stored value could mean must reach the range start
    qb.push(format!(
      " AND ({d} || SUBSTR('9999-12-31', LENGTH({d}) + 1)) >= "
    ))
    .push_bind(f.clone());
  }
  if let Some(t) = &b.to {
    // earliest day the stored value could mean must not pass the range end
    qb.push(format!(
      " AND ({d} || SUBSTR('0000-01-01', LENGTH({d}) + 1)) <= "
    ))
    .push_bind(t.clone());
  }
}

// END DATES

/// Swaps a reversed range, so `min = 500, max = 100` behaves like 100..500.
fn int_bound(min: Option<i64>, max: Option<i64>) -> (Option<i64>, Option<i64>) {
  match (min, max) {
    (Some(lo), Some(hi)) if lo > hi => (Some(hi), Some(lo)),
    other => other,
  }
}

// SECTION: filter

#[command(db)]
async fn filter_books(pool: State<'_, SqlitePool>, filter: BookFilter) -> Res<Vec<Book>> {
  let f = filter;
  let mut qb = QueryBuilder::<Sqlite>::new("SELECT b.* FROM book b WHERE 1 = 1");

  // substring
  if let Some(t) = f.text.as_deref().filter(|t| !t.is_empty()) {
    let p = like(t);
    qb.push(" AND (b.title LIKE ")
      .push_bind(p.clone())
      .push(ESC);
    qb.push(" OR b.blurb LIKE ").push_bind(p.clone()).push(ESC);
    qb.push(" OR b.isbn LIKE ").push_bind(p.clone()).push(ESC);
    qb.push(format!(" OR {AUTHOR_EXISTS} AND a.name LIKE "))
      .push_bind(p.clone())
      .push(ESC)
      .push(")");
    qb.push(format!(" OR {TAG_EXISTS} AND t.name LIKE "))
      .push_bind(p.clone())
      .push(ESC)
      .push(")");
    qb.push(" OR EXISTS (SELECT 1 FROM series s WHERE s.series_id = b.series_id AND s.name LIKE ")
      .push_bind(p)
      .push(ESC)
      .push("))");
  }
  if let Some(t) = f.title.as_deref().filter(|t| !t.is_empty()) {
    push_like(&mut qb, " AND b.title LIKE ", t);
  }
  if let Some(t) = f.blurb.as_deref().filter(|t| !t.is_empty()) {
    push_like(&mut qb, " AND b.blurb LIKE ", t);
  }
  if let Some(t) = f.author.as_deref().filter(|t| !t.is_empty()) {
    push_like(
      &mut qb,
      &format!(" AND {AUTHOR_EXISTS} AND a.name LIKE "),
      t,
    );
    qb.push(")");
  }
  if let Some(t) = f.tag.as_deref().filter(|t| !t.is_empty()) {
    push_like(&mut qb, &format!(" AND {TAG_EXISTS} AND t.name LIKE "), t);
    qb.push(")");
  }
  if let Some(t) = f.series.as_deref().filter(|t| !t.is_empty()) {
    push_like(
      &mut qb,
      " AND EXISTS (SELECT 1 FROM series s WHERE s.series_id = b.series_id AND s.name LIKE ",
      t,
    );
    qb.push(")");
  }

  // ids
  if let Some(id) = f.series_id {
    qb.push(" AND b.series_id = ").push_bind(id);
  }
  if !f.author_ids_any.is_empty() {
    qb.push(format!(" AND {AUTHOR_EXISTS} AND ba.author_id IN "));
    push_in(&mut qb, &f.author_ids_any);
    qb.push(")");
  }
  if !f.tag_ids_any.is_empty() {
    qb.push(format!(" AND {TAG_EXISTS} AND bt.tag_id IN "));
    push_in(&mut qb, &f.tag_ids_any);
    qb.push(")");
  }
  if !f.tag_ids_all.is_empty() {
    let ids = sorted_unique(&f.tag_ids_all);
    qb.push(
      " AND (SELECT COUNT(DISTINCT bt.tag_id) FROM book_tag bt \
       WHERE bt.book_id = b.book_id AND bt.tag_id IN ",
    );
    push_in(&mut qb, &ids);
    qb.push(") = ").push_bind(ids.len() as i64);
  }
  if !f.tag_ids_none.is_empty() {
    qb.push(
      " AND NOT EXISTS (SELECT 1 FROM book_tag bt \
       WHERE bt.book_id = b.book_id AND bt.tag_id IN ",
    );
    push_in(&mut qb, &f.tag_ids_none);
    qb.push(")");
  }

  // book dates / size
  push_date(
    &mut qb,
    "b.publish_date",
    &date_bound(&f.publish_from, &f.publish_to),
  );
  let (pages_min, pages_max) = int_bound(f.page_count_min, f.page_count_max);
  if let Some(n) = pages_min {
    qb.push(" AND b.page_count >= ").push_bind(n);
  }
  if let Some(n) = pages_max {
    qb.push(" AND b.page_count <= ").push_bind(n);
  }

  // author dates: one author must satisfy birth AND death bounds together
  let birth = date_bound(&f.author_birth_from, &f.author_birth_to);
  let death = date_bound(&f.author_death_from, &f.author_death_to);
  if !birth.is_empty() || !death.is_empty() {
    qb.push(format!(" AND {AUTHOR_EXISTS}"));
    push_date(&mut qb, "a.birth_date", &birth);
    push_date(&mut qb, "a.death_date", &death);
    qb.push(")");
  }

  // reading
  match &f.read_status {
    Some(ReadStatus::Unread) => {
      qb.push(" AND NOT EXISTS (SELECT 1 FROM reading r WHERE r.book_id = b.book_id)");
    }
    Some(ReadStatus::InProgress) => {
      qb.push(
        " AND EXISTS (SELECT 1 FROM reading r \
         WHERE r.book_id = b.book_id AND r.date_finished IS NULL)",
      );
    }
    Some(ReadStatus::Finished) => {
      qb.push(
        " AND EXISTS (SELECT 1 FROM reading r \
         WHERE r.book_id = b.book_id AND r.date_finished IS NOT NULL)",
      );
    }
    None => {}
  }
  let started = date_bound(&f.started_from, &f.started_to);
  let finished = date_bound(&f.finished_from, &f.finished_to);
  if !started.is_empty() || !finished.is_empty() {
    qb.push(" AND EXISTS (SELECT 1 FROM reading r WHERE r.book_id = b.book_id");
    push_date(&mut qb, "r.date_started", &started);
    push_date(&mut qb, "r.date_finished", &finished);
    qb.push(")");
  }

  qb.push(" ORDER BY b.title COLLATE NOCASE");
  Ok(qb.build_query_as::<Book>().fetch_all(pool.inner()).await?)
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

#[cfg(test)]
mod tests {
  use super::*;

  fn p(s: &str, end: bool) -> Option<String> {
    parse_date(s, end)
  }

  #[test]
  fn full_dates_any_format() {
    for s in [
      "2024-03-07",
      "2024/3/7",
      "2024.03.07",
      "20240307",
      "2024 03 07",
      "7 March 2024",
      "Mar 7, 2024",
      "7th of March 2024",
      "07.03.2024",
      "2024-03-07T10:00:00Z",
      " 2024-03-07 ",
      "2024-Mar-07",
    ] {
      assert_eq!(p(s, false).as_deref(), Some("2024-03-07"), "{s}");
      assert_eq!(p(s, true).as_deref(), Some("2024-03-07"), "{s}");
    }
  }

  #[test]
  fn partial_dates_expand_by_side() {
    assert_eq!(p("2024", false).as_deref(), Some("2024-01-01"));
    assert_eq!(p("2024", true).as_deref(), Some("2024-12-31"));
    for s in [
      "2024-02",
      "2024/2",
      "Feb 2024",
      "February 2024",
      "2/2024",
      "202402",
    ] {
      assert_eq!(p(s, false).as_deref(), Some("2024-02-01"), "{s}");
      assert_eq!(p(s, true).as_deref(), Some("2024-02-29"), "{s}"); // leap year
    }
    assert_eq!(p("2023-02", true).as_deref(), Some("2023-02-28"));
    assert_eq!(p("1900-02", true).as_deref(), Some("1900-02-28"));
    assert_eq!(p("2000-02", true).as_deref(), Some("2000-02-29"));
  }

  #[test]
  fn ambiguous_numeric_is_day_first() {
    assert_eq!(p("03/04/2024", false).as_deref(), Some("2024-04-03"));
    assert_eq!(p("13/04/2024", false).as_deref(), Some("2024-04-13"));
    assert_eq!(p("04/13/2024", false).as_deref(), Some("2024-04-13"));
  }

  #[test]
  fn rejects_garbage() {
    for s in [
      "",
      "  ",
      "abc",
      "20",
      "202",
      "2024-13",
      "2024-00-10",
      "2023-02-29",
      "2024-04-31",
      "2024-1-2-3",
      "0000",
      "mar",
      "2024-xx",
      ">2024",
      "99999",
    ] {
      assert_eq!(p(s, false), None, "{s}");
    }
  }

  #[test]
  fn bounds() {
    let s = |x: &str| Some(x.to_string());
    let b = date_bound(&s("1990"), &s("2000-06"));
    assert_eq!(b.from.as_deref(), Some("1990-01-01"));
    assert_eq!(b.to.as_deref(), Some("2000-06-30"));

    // same partial on both sides = the whole period
    let b = date_bound(&s("2024"), &s("2024"));
    assert_eq!(
      (b.from.as_deref(), b.to.as_deref()),
      (Some("2024-01-01"), Some("2024-12-31"))
    );

    // reversed range is swapped, re-expanding each side correctly
    let b = date_bound(&s("2000"), &s("1990"));
    assert_eq!(
      (b.from.as_deref(), b.to.as_deref()),
      (Some("1990-01-01"), Some("2000-12-31"))
    );

    // unparseable side is open; both unparseable is empty
    let b = date_bound(&s("19"), &s("2000"));
    assert_eq!((b.from, b.to.as_deref()), (None, Some("2000-12-31")));
    assert!(date_bound(&s("19"), &s("x")).is_empty());
    assert!(date_bound(&None, &None).is_empty());
  }

  #[test]
  fn int_bounds() {
    assert_eq!(int_bound(Some(500), Some(100)), (Some(100), Some(500)));
    assert_eq!(int_bound(Some(1), None), (Some(1), None));
    assert_eq!(int_bound(None, Some(9)), (None, Some(9)));
  }
}
