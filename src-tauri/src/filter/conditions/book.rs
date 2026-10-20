//! Conditions on the book's own columns: publish date, page count and rating.

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
  pages(qb, f);
  rating(qb, f);
}

fn pages(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter) {
  let (pages_min, pages_max) = int_bound(f.page_count_min, f.page_count_max);
  if let Some(n) = pages_min {
    qb.push(" AND b.page_count >= ").push_bind(n);
  }
  if let Some(n) = pages_max {
    qb.push(" AND b.page_count <= ").push_bind(n);
  }
}

/// One end of a rating range: the value, and whether the value itself is left out.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Edge {
  value: f64,
  exclusive: bool,
}

/// The rating range as `(lowest, highest)`. A reversed range is swapped, each end keeping its own
/// exclusivity. A value that isn't a number is treated as not set.
fn rating_range(f: &BookFilter) -> (Option<Edge>, Option<Edge>) {
  let edge = |value: Option<f64>, exclusive: bool| {
    value
      .filter(|v| v.is_finite())
      .map(|value| Edge { value, exclusive })
  };
  let min = edge(f.rating_min, f.rating_min_exclusive);
  let max = edge(f.rating_max, f.rating_max_exclusive);
  match (min, max) {
    (Some(lo), Some(hi)) if lo.value > hi.value => (Some(hi), Some(lo)),
    other => other,
  }
}

/// A rating of 0 means "not rated", so only rated books can be inside a range.
fn rating(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter) {
  let (min, max) = rating_range(f);
  if min.is_none() && max.is_none() {
    return;
  }
  qb.push(" AND b.rating > 0");
  if let Some(e) = min {
    qb.push(if e.exclusive {
      " AND b.rating > "
    } else {
      " AND b.rating >= "
    })
    .push_bind(e.value);
  }
  if let Some(e) = max {
    qb.push(if e.exclusive {
      " AND b.rating < "
    } else {
      " AND b.rating <= "
    })
    .push_bind(e.value);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn range(
    min: Option<f64>,
    max: Option<f64>,
    min_excl: bool,
    max_excl: bool,
  ) -> (Option<Edge>, Option<Edge>) {
    rating_range(&BookFilter {
      rating_min: min,
      rating_max: max,
      rating_min_exclusive: min_excl,
      rating_max_exclusive: max_excl,
      ..Default::default()
    })
  }

  fn e(value: f64, exclusive: bool) -> Option<Edge> {
    Some(Edge { value, exclusive })
  }

  #[test]
  fn an_unset_range_has_no_edges() {
    assert_eq!(range(None, None, false, false), (None, None));
    // exclusivity without a value means nothing
    assert_eq!(range(None, None, true, true), (None, None));
  }

  #[test]
  fn a_reversed_range_is_swapped_and_edges_keep_their_exclusivity() {
    assert_eq!(
      range(Some(2.0), Some(8.0), false, false),
      (e(2.0, false), e(8.0, false))
    );
    assert_eq!(
      range(Some(9.0), Some(7.0), true, false),
      (e(7.0, false), e(9.0, true))
    );
  }

  #[test]
  fn values_that_are_not_numbers_count_as_not_set() {
    assert_eq!(
      range(Some(f64::NAN), Some(5.0), false, false),
      (None, e(5.0, false))
    );
    assert_eq!(range(Some(f64::INFINITY), None, false, false), (None, None));
  }
}
