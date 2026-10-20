//! Conditions on the book's own columns: publish date and page count.

use sqlx::{QueryBuilder, Sqlite};

use crate::filter::{
  BookFilter,
  dates::{date_bound, push_date},
  sql::int_bound,
};

pub(super) fn push(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter) {
  push_date(
    qb,
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
}
