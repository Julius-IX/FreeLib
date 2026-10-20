//! Every condition a [`BookFilter`] can hold, one file per kind. Each file has one `push` that
//! appends ` AND <condition>` for the fields it owns that are set.

mod authors;
mod book;
mod ids;
mod reading;
mod text;

use sqlx::{QueryBuilder, Sqlite};

use super::BookFilter;

/// Appends the conditions of every filter field that is set. They are all ANDed.
pub(super) fn push(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter) {
  text::push(qb, f);
  ids::push(qb, f);
  book::push(qb, f);
  authors::push(qb, f);
  reading::push(qb, f);
}
