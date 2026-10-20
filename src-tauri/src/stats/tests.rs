//! The stats against the same in-memory library the filter tests use (`filter/tests/seed.sql`).

use std::str::FromStr;

use sqlx::{
  SqlitePool,
  sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

use super::{StatsQuery, StatsResult, run, summary};
use crate::filter::Outside;

const SEED: &str = include_str!("../filter/tests/seed.sql");

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
    sqlx::raw_sql(SEED).execute(&pool).await.unwrap();
    pool
  })
}

/// Runs a query given as JSON, with the filter fields left out meaning "don't filter".
fn stats(pool: &SqlitePool, measure: &str, group_by: &str, filter: &str, rest: &str) -> StatsResult {
  let json = format!(
    r#"{{"measure":"{measure}","groupBy":"{group_by}","filter":{filter},{rest}}}"#
  );
  let query: StatsQuery = serde_json::from_str(&json).expect("a valid StatsQuery");
  tauri::async_runtime::block_on(run(pool, &query, &Outside::default())).expect("the query runs")
}

fn rows(result: &StatsResult) -> Vec<(&str, f64)> {
  result
    .rows
    .iter()
    .map(|r| (r.label.as_str(), r.value))
    .collect()
}

const WHOLE: &str = r#""limit":null,"includeEmpty":false"#;

#[test]
fn books_per_author_are_biggest_first_and_ties_alphabetical() {
  let r = stats(&pool(), "books", "author", "{}", WHOLE);
  assert_eq!(
    rows(&r),
    [
      ("Frank Herbert", 4.0),
      ("Ursula K. Le Guin", 4.0),
      ("N. K. Jemisin", 3.0),
      ("Isaac Asimov", 2.0),
      ("Anonymous", 1.0),
    ]
  );
  assert_eq!(r.matching_books, 14);
}

#[test]
fn a_limit_cuts_groups_ordered_by_size_only() {
  let pool = pool();
  let cut = stats(&pool, "books", "author", "{}", r#""limit":2,"includeEmpty":false"#);
  assert_eq!(cut.rows.len(), 2);
  // dates are never cut, a hole in the axis would be worse than a long chart
  let years = stats(&pool, "books", "finishedYear", "{}", r#""limit":2,"includeEmpty":false"#);
  assert_eq!(years.rows.len(), 5);
}

#[test]
fn books_without_a_value_form_a_none_group_that_comes_last() {
  let r = stats(&pool(), "pages", "series", "{}", r#""limit":null,"includeEmpty":true"#);
  assert_eq!(
    rows(&r),
    [
      ("Dune", 943.0),
      ("Broken Earth", 468.0),
      ("Earthsea", 343.0),
      ("None", 2835.0),
    ]
  );
  let left_out = stats(&pool(), "pages", "series", "{}", WHOLE);
  assert!(left_out.rows.iter().all(|r| r.label != "None"));
}

#[test]
fn the_filter_narrows_the_books_and_the_count() {
  let r = stats(&pool(), "books", "readStatus", r#"{"tag":"fantasy"}"#, WHOLE);
  assert_eq!(r.matching_books, 6);
  assert_eq!(r.rows.iter().map(|r| r.value).sum::<f64>(), 6.0);
}

#[test]
fn finished_bounds_also_narrow_the_readings_that_are_grouped() {
  let r = stats(
    &pool(),
    "books",
    "finishedYear",
    r#"{"finishedFrom":"2020","finishedTo":"2021"}"#,
    WHOLE,
  );
  assert_eq!(rows(&r), [("2020", 1.0), ("2021", 1.0)]);
}

#[test]
fn averages_leave_out_what_is_missing() {
  let r = stats(&pool(), "avgRating", "tag", "{}", WHOLE);
  let classic = r.rows.iter().find(|r| r.label == "classic").unwrap();
  assert_eq!(classic.value, 9.17);
  assert_eq!(classic.books, 4);
}

#[test]
fn the_summary_counts_rereads_in_pages_only() {
  let s = tauri::async_runtime::block_on(summary(&pool())).unwrap();
  assert_eq!(
    (s.books, s.finished, s.in_progress, s.pages_read),
    (14, 5, 3, 1678)
  );
  assert!((s.avg_rating.unwrap() - 7.125).abs() < 1e-9);
}
