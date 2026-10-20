//! Text: the free-text search over many fields, the one-field substring searches, and the
//! category / colour condition.

use sqlx::{QueryBuilder, Sqlite};

use crate::filter::{
  BookFilter,
  sql::{
    AUTHOR_EXISTS, CATEGORY_EXISTS, ESC, TAG_EXISTS, like, non_empty, norm_color, norm_hex,
    push_like,
  },
};

pub(super) fn push(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter) {
  if let Some(t) = non_empty(&f.text) {
    any_field(qb, t);
  }
  if let Some(t) = non_empty(&f.title) {
    push_like(qb, " AND b.title LIKE ", t);
  }
  if let Some(t) = non_empty(&f.blurb) {
    push_like(qb, " AND b.blurb LIKE ", t);
  }
  if let Some(t) = non_empty(&f.notes) {
    push_like(qb, " AND b.notes LIKE ", t);
  }
  if let Some(t) = non_empty(&f.author) {
    push_like(qb, &format!(" AND {AUTHOR_EXISTS} AND a.name LIKE "), t);
    qb.push(")");
  }
  if let Some(t) = non_empty(&f.tag) {
    push_like(qb, &format!(" AND {TAG_EXISTS} AND t.name LIKE "), t);
    qb.push(")");
  }
  if let Some(t) = non_empty(&f.series) {
    push_like(
      qb,
      " AND EXISTS (SELECT 1 FROM series s WHERE s.series_id = b.series_id AND s.name LIKE ",
      t,
    );
    qb.push(")");
  }
  category_and_color(qb, f);
}

/// `text`: title, blurb, notes, ISBN, any author, tag or category name, or the series name.
fn any_field(qb: &mut QueryBuilder<'_, Sqlite>, t: &str) {
  let p = like(t);
  qb.push(" AND (b.title LIKE ")
    .push_bind(p.clone())
    .push(ESC);
  qb.push(" OR b.blurb LIKE ").push_bind(p.clone()).push(ESC);
  qb.push(" OR b.notes LIKE ").push_bind(p.clone()).push(ESC);
  qb.push(" OR b.isbn LIKE ").push_bind(p.clone()).push(ESC);
  qb.push(format!(" OR {AUTHOR_EXISTS} AND a.name LIKE "))
    .push_bind(p.clone())
    .push(ESC)
    .push(")");
  qb.push(format!(" OR {TAG_EXISTS} AND t.name LIKE "))
    .push_bind(p.clone())
    .push(ESC)
    .push(")");
  qb.push(format!(" OR {CATEGORY_EXISTS} AND c.name LIKE "))
    .push_bind(p.clone())
    .push(ESC)
    .push(")");
  // `#ff0000` on its own also finds books in a category of that colour. Only with the `#`:
  // plain words like "bad" or "face" are valid 3 digit hex too.
  if t.starts_with('#') {
    if let Some(hex) = norm_hex(t) {
      qb.push(format!(" OR {CATEGORY_EXISTS} AND LOWER(c.color) = "))
        .push_bind(hex)
        .push(")");
    }
  }
  qb.push(" OR EXISTS (SELECT 1 FROM series s WHERE s.series_id = b.series_id AND s.name LIKE ")
    .push_bind(p)
    .push(ESC)
    .push("))");
}

/// Category name + colour: ONE category has to satisfy both.
fn category_and_color(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter) {
  let color = f.color.as_deref().and_then(norm_color);
  let category = non_empty(&f.category);
  if category.is_none() && color.is_none() {
    return;
  }
  qb.push(format!(" AND {CATEGORY_EXISTS}"));
  if let Some(name) = category {
    push_like(qb, " AND c.name LIKE ", name);
  }
  if let Some(hex) = color {
    qb.push(" AND LOWER(c.color) = ").push_bind(hex);
  }
  qb.push(")");
}
