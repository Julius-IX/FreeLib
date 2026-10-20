//! Every condition a [`BookFilter`] can hold, one file per kind. Each file has one `push` that
//! appends ` AND <condition>` for the fields it owns that are set. This file adds the one
//! condition that is made of the others: leaving out whatever a nested filter matches.

mod authors;
mod book;
mod has;
mod ids;
mod reading;
mod text;

use sqlx::{QueryBuilder, Sqlite};

use super::{BookFilter, Outside};

/// How deep `exclude` entries may be nested inside each other. The search box makes one level.
/// The limit only stops a hand-made filter from making the query absurdly large.
const MAX_NESTING: usize = 4;

/// Appends the conditions of every filter field that is set, and of every `exclude` entry. They
/// are all ANDed.
pub(super) fn push(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter, outside: &Outside) {
  push_at(qb, f, outside, 0);
}

fn push_at(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter, outside: &Outside, depth: usize) {
  text::push(qb, f);
  ids::push(qb, f);
  book::push(qb, f);
  has::push(qb, f, outside);
  authors::push(qb, f);
  reading::push(qb, f);
  if depth < MAX_NESTING {
    excluded(qb, f, outside, depth);
  }
}

/// One ` AND NOT (<entry>)` per `exclude` entry.
///
/// `COALESCE(.., 0)` because a condition on a missing value is NULL, not false, and `NOT NULL`
/// is NULL: without it a book with no page count would vanish from `NOT (pages > 500)` instead of
/// staying. An entry that adds no condition at all (every value in it was unusable) is skipped:
/// `NOT (1 = 1)` would leave out every book.
fn excluded(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter, outside: &Outside, depth: usize) {
  for entry in &f.exclude {
    let mut probe = QueryBuilder::<Sqlite>::new("");
    push_at(&mut probe, entry, outside, depth + 1);
    if probe.sql().is_empty() {
      continue;
    }
    qb.push(" AND NOT COALESCE((1 = 1");
    push_at(qb, entry, outside, depth + 1);
    qb.push("), 0)");
  }
}
