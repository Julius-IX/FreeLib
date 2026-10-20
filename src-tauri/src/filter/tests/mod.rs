//! The filter against a real (in-memory) database. `cases.rs` is the table of scenarios,
//! `seed.sql` the library they run on.

mod cases;

use std::str::FromStr;

use sqlx::{
  SqlitePool,
  sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

use super::{BookFilter, BookSort, query_books};
use cases::CASES;

const SEED: &str = include_str!("seed.sql");

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

/// The ids `filter` (as JSON) returns, in order.
fn ids(pool: &SqlitePool, filter: &str, sort: &str) -> Vec<i64> {
  let filter: BookFilter = serde_json::from_str(filter).expect("a valid BookFilter");
  let sort: BookSort = if sort.is_empty() {
    BookSort::default()
  } else {
    serde_json::from_str(sort).expect("a valid BookSort")
  };
  tauri::async_runtime::block_on(query_books(pool, &filter, sort))
    .expect("the query runs")
    .iter()
    .map(|b| b.book_id)
    .collect()
}

#[test]
fn every_case_returns_what_it_should() {
  let pool = pool();
  let wrong: Vec<String> = CASES
    .iter()
    .filter_map(|&(name, filter, sort, expected)| {
      let got = ids(&pool, filter, sort);
      (got != expected).then(|| format!("{name}: expected {expected:?}, got {got:?}"))
    })
    .collect();
  assert!(
    wrong.is_empty(),
    "{} cases failed:\n{}",
    wrong.len(),
    wrong.join("\n")
  );
}

#[test]
fn case_names_are_unique() {
  let mut names: Vec<_> = CASES.iter().map(|c| c.0).collect();
  names.sort_unstable();
  let before = names.len();
  names.dedup();
  assert_eq!(before, names.len(), "two cases share a name");
}
