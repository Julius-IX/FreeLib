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
/// Dates are inclusive `YYYY-MM-DD`, and setting a date bound excludes books
/// where that date is NULL.
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
/// - `page_count_min` / `page_count_max`: page count range
///
/// **Author dates** (matches if any single author fits all the bounds you set)
/// - `author_birth_from` / `author_birth_to`
/// - `author_death_from` / `author_death_to`
///
/// **Reading**
/// - `read_status`: `unread`, `inProgress` or `finished`
/// - `started_from` / `started_to` / `finished_from` / `finished_to`: a single
///   reading row must satisfy every bound you set, so rereads can't cross-match
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

fn push_range(
  qb: &mut QueryBuilder<'_, Sqlite>,
  col: &str,
  from: &Option<String>,
  to: &Option<String>,
) {
  if let Some(d) = from {
    qb.push(format!(" AND {col} >= ")).push_bind(d.clone());
  }
  if let Some(d) = to {
    qb.push(format!(" AND {col} <= ")).push_bind(d.clone());
  }
}

fn sorted_unique(ids: &[i64]) -> Vec<i64> {
  let mut v = ids.to_vec();
  v.sort_unstable();
  v.dedup();
  v
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
  push_range(&mut qb, "b.publish_date", &f.publish_from, &f.publish_to);
  if let Some(n) = f.page_count_min {
    qb.push(" AND b.page_count >= ").push_bind(n);
  }
  if let Some(n) = f.page_count_max {
    qb.push(" AND b.page_count <= ").push_bind(n);
  }

  // author dates: one author must satisfy birth AND death bounds together
  if [
    &f.author_birth_from,
    &f.author_birth_to,
    &f.author_death_from,
    &f.author_death_to,
  ]
  .iter()
  .any(|d| d.is_some())
  {
    qb.push(format!(" AND {AUTHOR_EXISTS}"));
    push_range(
      &mut qb,
      "a.birth_date",
      &f.author_birth_from,
      &f.author_birth_to,
    );
    push_range(
      &mut qb,
      "a.death_date",
      &f.author_death_from,
      &f.author_death_to,
    );
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
  if [
    &f.started_from,
    &f.started_to,
    &f.finished_from,
    &f.finished_to,
  ]
  .iter()
  .any(|d| d.is_some())
  {
    qb.push(" AND EXISTS (SELECT 1 FROM reading r WHERE r.book_id = b.book_id");
    push_range(&mut qb, "r.date_started", &f.started_from, &f.started_to);
    push_range(&mut qb, "r.date_finished", &f.finished_from, &f.finished_to);
    qb.push(")");
  }

  qb.push(" ORDER BY b.title COLLATE NOCASE");
  Ok(qb.build_query_as::<Book>().fetch_all(pool.inner()).await?)
}
