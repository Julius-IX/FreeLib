//! SQL building blocks shared by every condition: LIKE escaping, `IN (...)` lists, the
//! `EXISTS (...)` openers for the join tables, colour normalising and integer bounds.

use sqlx::{QueryBuilder, Sqlite};

use crate::colors::CssColor;

pub(super) const ESC: &str = " ESCAPE '\\'";
pub(super) const AUTHOR_EXISTS: &str = "EXISTS (SELECT 1 FROM book_author ba \
  JOIN author a ON a.author_id = ba.author_id WHERE ba.book_id = b.book_id";
pub(super) const TAG_EXISTS: &str = "EXISTS (SELECT 1 FROM book_tag bt \
  JOIN tag t ON t.tag_id = bt.tag_id WHERE bt.book_id = b.book_id";
pub(super) const CATEGORY_EXISTS: &str = "EXISTS (SELECT 1 FROM book_category bc \
  JOIN category c ON c.category_id = bc.category_id WHERE bc.book_id = b.book_id";

/// `%needle%` with LIKE wildcards in the needle escaped.
pub(super) fn like(s: &str) -> String {
  format!(
    "%{}%",
    s.replace('\\', "\\\\")
      .replace('%', "\\%")
      .replace('_', "\\_")
  )
}

pub(super) fn push_like(qb: &mut QueryBuilder<'_, Sqlite>, prefix: &str, needle: &str) {
  qb.push(prefix).push_bind(like(needle)).push(ESC);
}

pub(super) fn push_in(qb: &mut QueryBuilder<'_, Sqlite>, ids: &[i64]) {
  qb.push("(");
  let mut sep = qb.separated(", ");
  for id in ids {
    sep.push_bind(*id);
  }
  sep.push_unseparated(")");
}

/// The text of an optional filter field, or `None` when it is missing or empty ("don't filter").
pub(super) fn non_empty(v: &Option<String>) -> Option<&str> {
  v.as_deref().filter(|t| !t.is_empty())
}

/// A CSS colour name or a hex colour -> `#rrggbb`. `None` for anything else. (No CSS name is
/// all hex digits, so the two forms can't clash.)
pub(super) fn norm_color(raw: &str) -> Option<String> {
  CssColor::from_name(raw)
    .map(CssColor::hex)
    .or_else(|| norm_hex(raw))
}

/// `#FF0000`, `ff0000` and `#f00` -> `#ff0000`, the form the category table stores (lower-cased on
/// compare). `None` for anything that isn't a 3 or 6 digit hex colour.
pub(super) fn norm_hex(raw: &str) -> Option<String> {
  let s = raw.trim();
  let h = s.strip_prefix('#').unwrap_or(s);
  if !h.bytes().all(|b| b.is_ascii_hexdigit()) {
    return None;
  }
  let h = h.to_ascii_lowercase();
  match h.len() {
    6 => Some(format!("#{h}")),
    3 => Some(format!(
      "#{}",
      h.chars().flat_map(|c| [c, c]).collect::<String>()
    )),
    _ => None,
  }
}

pub(super) fn sorted_unique(ids: &[i64]) -> Vec<i64> {
  let mut v = ids.to_vec();
  v.sort_unstable();
  v.dedup();
  v
}

/// Swaps a reversed range, so `min = 500, max = 100` behaves like 100..500.
pub(super) fn int_bound(min: Option<i64>, max: Option<i64>) -> (Option<i64>, Option<i64>) {
  match (min, max) {
    (Some(lo), Some(hi)) if lo > hi => (Some(hi), Some(lo)),
    other => other,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn hex_colours() {
    for s in ["#FF0000", "ff0000", " #ff0000 ", "#Ff0000"] {
      assert_eq!(norm_hex(s).as_deref(), Some("#ff0000"), "{s}");
    }
    assert_eq!(norm_hex("#f0A").as_deref(), Some("#ff00aa"));
    assert_eq!(norm_hex("abc").as_deref(), Some("#aabbcc"));
    for s in [
      "", "#", "#ff00", "#ff00000", "#gg0000", "##ff0000", "red", "#ff 000",
    ] {
      assert_eq!(norm_hex(s), None, "{s}");
    }
  }

  #[test]
  fn colour_names() {
    for s in ["red", "Red", " RED ", "#ff0000", "ff0000", "#f00"] {
      assert_eq!(norm_color(s).as_deref(), Some("#ff0000"), "{s}");
    }
    assert_eq!(norm_color("DarkSeaGreen").as_deref(), Some("#8fbc8f"));
    assert_eq!(norm_color("rebeccapurple").as_deref(), Some("#663399"));
    for s in ["", "reddish", "#red", "grn"] {
      assert_eq!(norm_color(s), None, "{s}");
    }
  }

  #[test]
  fn int_bounds() {
    assert_eq!(int_bound(Some(500), Some(100)), (Some(100), Some(500)));
    assert_eq!(int_bound(Some(1), None), (Some(1), None));
    assert_eq!(int_bound(None, Some(9)), (None, Some(9)));
  }
}
