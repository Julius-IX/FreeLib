//! Conditions on the authors' own dates.

use sqlx::{QueryBuilder, Sqlite};

use crate::filter::{
  BookFilter,
  dates::{date_bound, push_date},
  sql::AUTHOR_EXISTS,
};

pub(super) fn push(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter) {
  // One author must satisfy the birth AND death bounds together.
  let birth = date_bound(&f.author_birth_from, &f.author_birth_to);
  let death = date_bound(&f.author_death_from, &f.author_death_to);
  if birth.is_empty() && death.is_empty() {
    return;
  }
  qb.push(format!(" AND {AUTHOR_EXISTS}"));
  push_date(qb, "a.birth_date", &birth);
  push_date(qb, "a.death_date", &death);
  qb.push(")");
}
