//! Conditions on the book's readings: its status, and when it was started / finished.

use sqlx::{QueryBuilder, Sqlite};

use crate::filter::{
  BookFilter, ReadStatus,
  dates::{date_bound, push_date},
};

pub(super) fn push(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter) {
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

  // A single reading row must satisfy every bound, so rereads can't cross-match.
  let started = date_bound(&f.started_from, &f.started_to);
  let finished = date_bound(&f.finished_from, &f.finished_to);
  if started.is_empty() && finished.is_empty() {
    return;
  }
  qb.push(" AND EXISTS (SELECT 1 FROM reading r WHERE r.book_id = b.book_id");
  push_date(qb, "r.date_started", &started);
  push_date(qb, "r.date_finished", &finished);
  qb.push(")");
}
