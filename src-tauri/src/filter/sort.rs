//! How the books are ordered. Independent of what is filtered.

use serde::Deserialize;
use tauri_groups::TsType;

/// What to order the books by. A book with no value for the key (no series, never read, no page
/// count...) always goes last, whichever direction is picked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
  /// Title, case-insensitive. The default.
  #[default]
  Title,
  /// The book's first author alphabetically.
  Author,
  /// Series name, then position in the series.
  Series,
  /// The book's first category alphabetically.
  Category,
  /// When the book was added to the library.
  Added,
  /// Publish date.
  Published,
  /// Page count.
  Pages,
  /// Most recent reading: its finish date, or its start date while it is still in progress.
  LastRead,
  /// How many readings are finished. A book never read counts as 0 (it is never "missing").
  TimesRead,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub enum SortDir {
  #[default]
  Asc,
  Desc,
}

/// Ties are always broken by title, then id, so the order is stable.
#[derive(Debug, Clone, Copy, Default, Deserialize, TsType)]
#[serde(rename_all = "camelCase", default)]
pub struct BookSort {
  pub by: SortKey,
  pub dir: SortDir,
}

impl SortKey {
  /// The SQL expression this key orders on (`b` is the book).
  fn expr(self) -> &'static str {
    match self {
      SortKey::Title => "b.title COLLATE NOCASE",
      SortKey::Author => {
        "(SELECT a.name FROM book_author ba JOIN author a ON a.author_id = ba.author_id \
         WHERE ba.book_id = b.book_id ORDER BY a.name COLLATE NOCASE LIMIT 1) COLLATE NOCASE"
      }
      SortKey::Series => {
        "(SELECT s.name FROM series s WHERE s.series_id = b.series_id) COLLATE NOCASE"
      }
      SortKey::Category => {
        "(SELECT c.name FROM book_category bc JOIN category c ON c.category_id = bc.category_id \
         WHERE bc.book_id = b.book_id ORDER BY c.name COLLATE NOCASE LIMIT 1) COLLATE NOCASE"
      }
      SortKey::Added => "b.added_at",
      SortKey::Published => "b.publish_date",
      SortKey::Pages => "b.page_count",
      SortKey::LastRead => {
        "(SELECT MAX(COALESCE(r.date_finished, r.date_started)) FROM reading r \
         WHERE r.book_id = b.book_id)"
      }
      SortKey::TimesRead => {
        "(SELECT COUNT(r.date_finished) FROM reading r WHERE r.book_id = b.book_id)"
      }
    }
  }

  /// Whether `expr` can be NULL. Those rows are pushed to the end.
  fn nullable(self) -> bool {
    !matches!(self, SortKey::Title | SortKey::TimesRead)
  }
}

/// The whole ` ORDER BY ...` clause.
pub(super) fn order_by(sort: BookSort) -> String {
  let dir = match sort.dir {
    SortDir::Asc => "ASC",
    SortDir::Desc => "DESC",
  };
  let e = sort.by.expr();
  let mut s = String::from(" ORDER BY ");
  if sort.by.nullable() {
    s += &format!("({e}) IS NULL, ");
  }
  s += &format!("{e} {dir}");
  match sort.by {
    // books inside a series stay in reading order, whichever way the series are sorted
    SortKey::Series => s += ", b.series_position IS NULL, b.series_position",
    // books added in the same instant (and all those from before the column existed) keep
    // their insertion order
    SortKey::Added => s += &format!(", b.book_id {dir}"),
    _ => {}
  }
  s += ", b.title COLLATE NOCASE, b.book_id";
  s
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn order_clause() {
    let sql = |by, dir| order_by(BookSort { by, dir });
    // nothing set = the old behaviour: title A to Z
    assert_eq!(
      sql(SortKey::Title, SortDir::Asc),
      " ORDER BY b.title COLLATE NOCASE ASC, b.title COLLATE NOCASE, b.book_id"
    );
    // missing values go last in both directions
    for dir in [SortDir::Asc, SortDir::Desc] {
      let s = sql(SortKey::Pages, dir);
      assert!(
        s.starts_with(" ORDER BY (b.page_count) IS NULL, b.page_count "),
        "{s}"
      );
    }
    assert!(sql(SortKey::Pages, SortDir::Desc).contains("b.page_count DESC"));
    // series keep reading order whichever way they are sorted
    assert!(
      sql(SortKey::Series, SortDir::Desc)
        .contains("DESC, b.series_position IS NULL, b.series_position,")
    );
    assert!(sql(SortKey::Added, SortDir::Desc).contains("b.added_at DESC, b.book_id DESC,"));
    // never-read books are 0, not missing
    assert!(!sql(SortKey::TimesRead, SortDir::Asc).contains("IS NULL"));
  }
}
