//! Conditions on ids: an exact series, and the "any / all / none" lists of authors, tags,
//! categories and shelves.

use sqlx::{QueryBuilder, Sqlite};

use crate::filter::{
  BookFilter,
  sql::{AUTHOR_EXISTS, CATEGORY_EXISTS, TAG_EXISTS, push_in, sorted_unique},
};

pub(super) fn push(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter) {
  if let Some(id) = f.series_id {
    qb.push(" AND b.series_id = ").push_bind(id);
  }
  if !f.author_ids_any.is_empty() {
    qb.push(format!(" AND {AUTHOR_EXISTS} AND ba.author_id IN "));
    push_in(qb, &f.author_ids_any);
    qb.push(")");
  }

  if !f.tag_ids_any.is_empty() {
    qb.push(format!(" AND {TAG_EXISTS} AND bt.tag_id IN "));
    push_in(qb, &f.tag_ids_any);
    qb.push(")");
  }
  if !f.tag_ids_all.is_empty() {
    let ids = sorted_unique(&f.tag_ids_all);
    qb.push(
      " AND (SELECT COUNT(DISTINCT bt.tag_id) FROM book_tag bt \
       WHERE bt.book_id = b.book_id AND bt.tag_id IN ",
    );
    push_in(qb, &ids);
    qb.push(") = ").push_bind(ids.len() as i64);
  }
  if !f.tag_ids_none.is_empty() {
    qb.push(
      " AND NOT EXISTS (SELECT 1 FROM book_tag bt \
       WHERE bt.book_id = b.book_id AND bt.tag_id IN ",
    );
    push_in(qb, &f.tag_ids_none);
    qb.push(")");
  }

  if !f.category_ids_any.is_empty() {
    qb.push(format!(" AND {CATEGORY_EXISTS} AND bc.category_id IN "));
    push_in(qb, &f.category_ids_any);
    qb.push(")");
  }
  if !f.category_ids_all.is_empty() {
    let ids = sorted_unique(&f.category_ids_all);
    qb.push(
      " AND (SELECT COUNT(DISTINCT bc.category_id) FROM book_category bc \
       WHERE bc.book_id = b.book_id AND bc.category_id IN ",
    );
    push_in(qb, &ids);
    qb.push(") = ").push_bind(ids.len() as i64);
  }
  if !f.category_ids_none.is_empty() {
    qb.push(
      " AND NOT EXISTS (SELECT 1 FROM book_category bc \
       WHERE bc.book_id = b.book_id AND bc.category_id IN ",
    );
    push_in(qb, &f.category_ids_none);
    qb.push(")");
  }

  // Shelves: on at least one of these / on none of these. "On none of the shelves" is how the
  // library finds its unshelved books.
  if !f.shelf_ids_any.is_empty() {
    qb.push(
      " AND EXISTS (SELECT 1 FROM book_shelf bsh \
       WHERE bsh.book_id = b.book_id AND bsh.shelf_id IN ",
    );
    push_in(qb, &f.shelf_ids_any);
    qb.push(")");
  }
  if !f.shelf_ids_none.is_empty() {
    qb.push(
      " AND NOT EXISTS (SELECT 1 FROM book_shelf bsh \
       WHERE bsh.book_id = b.book_id AND bsh.shelf_id IN ",
    );
    push_in(qb, &f.shelf_ids_none);
    qb.push(")");
  }
}
