//! "Has this" conditions: `BookFilter::has` lists fields a book must have filled in.

use sqlx::{QueryBuilder, Sqlite};

use crate::filter::{BookField, BookFilter, Outside};

pub(super) fn push(qb: &mut QueryBuilder<'_, Sqlite>, f: &BookFilter, outside: &Outside) {
  for (i, field) in f.has.iter().enumerate() {
    if f.has[..i].contains(field) {
      continue; // listed twice
    }
    qb.push(" AND ");
    present(qb, *field, outside);
  }
}

/// Some text that isn't only spaces, tabs or line breaks. A column that is NULL isn't either.
fn text(column: &str) -> String {
  format!("TRIM(COALESCE({column}, ''), char(32, 9, 10, 13)) <> ''")
}

/// At least one row of a join table for the book.
fn any_row(table: &str) -> String {
  format!("EXISTS (SELECT 1 FROM {table} x WHERE x.book_id = b.book_id)")
}

/// The condition for one field being there, without the leading ` AND `.
fn present(qb: &mut QueryBuilder<'_, Sqlite>, field: BookField, outside: &Outside) {
  match field {
    BookField::Isbn => qb.push(text("b.isbn")),
    BookField::Blurb => qb.push(text("b.blurb")),
    BookField::Notes => qb.push(text("b.notes")),
    BookField::Published => qb.push(text("b.publish_date")),
    BookField::Pages => qb.push("b.page_count IS NOT NULL"),
    BookField::Rating => qb.push("b.rating > 0"), // 0 means not rated
    BookField::Series => qb.push("b.series_id IS NOT NULL"),
    BookField::Author => qb.push(any_row("book_author")),
    BookField::Tag => qb.push(any_row("book_tag")),
    BookField::Category => qb.push(any_row("book_category")),
    BookField::Shelf => qb.push(any_row("book_shelf")),
    BookField::Cover => {
      // One JSON array as a single parameter, however many covers there are.
      let ids = serde_json::to_string(&outside.cover_ids).unwrap_or_else(|_| "[]".into());
      qb.push("b.book_id IN (SELECT value FROM json_each(")
        .push_bind(ids)
        .push("))")
    }
  };
}
