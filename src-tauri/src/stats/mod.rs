//! Statistics for the stats tab. `run_stats` groups the library by one dimension and measures
//! every group, `library_summary` gives the headline numbers.
//!
//! The SQL text is only ever picked from the enums below, so nothing the frontend sends can end
//! up inside it. Which books take part is a [`BookFilter`], the same one the library search uses.
//!
//! A book with several values for a dimension (two authors, three tags) is counted in every one
//! of them, so the groups can add up to more than the number of books. Dimensions that read
//! reading dates (`FinishedYear`, `FinishedMonth`) count one row per read-through instead, so a
//! reread shows up again in the year it was finished.
//!
//! **Adding a dimension**
//! 1. Add a [`StatsGroup`] variant and its [`Dim`] in `StatsGroup::dim`.
//! 2. Add it to `src/lib/types.ts` (generated: `cargo test export_bindings`, or run the app) and
//!    to `GROUPS` in `src/features/stats/options.ts`.
//! 3. Add a case to `tests.rs`.

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};
use tauri::{AppHandle, State};
use tauri_groups::{TsType, command};

use crate::database::Res;
use crate::filter::{BookFilter, Outside, outside_for, push_conditions, push_finished_bounds};

/// Most rows a query may return. The charts stop being readable long before this.
const MAX_LIMIT: i64 = 200;

/// What is worked out for every group.
#[derive(Debug, Clone, Copy, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub enum StatsMeasure {
  /// Number of books.
  Books,
  /// Sum of the page counts. Books without a page count add nothing.
  Pages,
  /// Mean rating on the 0-10 scale. Unrated books are left out of the mean, not counted as 0.
  AvgRating,
  /// Mean page count, over the books that have one.
  AvgPages,
}

impl StatsMeasure {
  fn sql(self) -> &'static str {
    match self {
      Self::Books => "COUNT(DISTINCT b.book_id)",
      Self::Pages => "SUM(b.page_count)",
      Self::AvgRating => "ROUND(AVG(NULLIF(b.rating, 0)), 2)",
      Self::AvgPages => "ROUND(AVG(b.page_count), 0)",
    }
  }
}

/// What the books are split by. One row of the result per value.
#[derive(Debug, Clone, Copy, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub enum StatsGroup {
  /// Unread, in progress or finished. A reread that is under way counts as in progress.
  ReadStatus,
  Author,
  Tag,
  Category,
  Shelf,
  Series,
  PublishYear,
  PublishDecade,
  /// Whole points on the 0-10 scale, so 7.3 lands in 7.
  Rating,
  /// Page count in steps of 200.
  PageCount,
  /// Month a book was added to the library.
  AddedMonth,
  /// Year a read-through was finished.
  FinishedYear,
  FinishedMonth,
}

/// How the rows of a group are put in order.
#[derive(Clone, Copy)]
enum Order {
  /// Biggest first. The only order a limit can cut sensibly.
  Value,
  /// Oldest first, for labels that are dates.
  Text,
  /// Smallest first, for labels that start with a number.
  Number,
}

/// How one [`StatsGroup`] reads the library.
struct Dim {
  /// Joins that give a book one row per value it has. Aliases start with `g_` so they can't
  /// clash with the ones the filter conditions use.
  joins: &'static str,
  /// Text of the group, NULL when the book has no value.
  label: &'static str,
  order: Order,
  /// The rows are read-throughs and not books, so the `finished` bounds of the filter also have
  /// to narrow the readings that are grouped.
  by_reading: bool,
}

impl StatsGroup {
  fn dim(self) -> Dim {
    let plain = |label, order| Dim {
      joins: "",
      label,
      order,
      by_reading: false,
    };
    let joined = |joins, label| Dim {
      joins,
      label,
      order: Order::Value,
      by_reading: false,
    };
    match self {
      Self::ReadStatus => plain(
        "CASE \
           WHEN EXISTS (SELECT 1 FROM reading r \
             WHERE r.book_id = b.book_id AND r.date_finished IS NULL) THEN 'In progress' \
           WHEN EXISTS (SELECT 1 FROM reading r WHERE r.book_id = b.book_id) THEN 'Finished' \
           ELSE 'Unread' END",
        Order::Value,
      ),
      Self::Author => joined(
        "LEFT JOIN book_author g_ba ON g_ba.book_id = b.book_id \
         LEFT JOIN author g_a ON g_a.author_id = g_ba.author_id",
        "g_a.name",
      ),
      Self::Tag => joined(
        "LEFT JOIN book_tag g_bt ON g_bt.book_id = b.book_id \
         LEFT JOIN tag g_t ON g_t.tag_id = g_bt.tag_id",
        "g_t.name",
      ),
      Self::Category => joined(
        "LEFT JOIN book_category g_bc ON g_bc.book_id = b.book_id \
         LEFT JOIN category g_c ON g_c.category_id = g_bc.category_id",
        "g_c.name",
      ),
      Self::Shelf => joined(
        "LEFT JOIN book_shelf g_bs ON g_bs.book_id = b.book_id \
         LEFT JOIN shelf g_s ON g_s.shelf_id = g_bs.shelf_id",
        "g_s.name",
      ),
      Self::Series => joined(
        "LEFT JOIN series g_se ON g_se.series_id = b.series_id",
        "g_se.name",
      ),
      // Stored publish dates are whole days, so the first characters are the year.
      Self::PublishYear => plain("substr(b.publish_date, 1, 4)", Order::Text),
      Self::PublishDecade => plain(
        "CASE WHEN b.publish_date IS NOT NULL THEN substr(b.publish_date, 1, 3) || '0s' END",
        Order::Text,
      ),
      // MAX keeps a rating under half a point out of the unrated 0 bucket.
      Self::Rating => plain(
        "CASE WHEN b.rating > 0 THEN CAST(CAST(MAX(1, ROUND(b.rating)) AS INTEGER) AS TEXT) END",
        Order::Number,
      ),
      // The labels start with their lower bound, which is what `Order::Number` sorts on.
      Self::PageCount => plain(
        "CASE WHEN b.page_count IS NULL THEN NULL \
           WHEN b.page_count < 200 THEN '1-199' \
           WHEN b.page_count < 400 THEN '200-399' \
           WHEN b.page_count < 600 THEN '400-599' \
           ELSE '600+' END",
        Order::Number,
      ),
      Self::AddedMonth => plain("substr(b.added_at, 1, 7)", Order::Text),
      Self::FinishedYear => by_reading("substr(g_r.date_finished, 1, 4)"),
      Self::FinishedMonth => by_reading("substr(g_r.date_finished, 1, 7)"),
    }
  }
}

/// A read-through that has a finish date, one row each.
fn by_reading(label: &'static str) -> Dim {
  Dim {
    joins: "JOIN reading g_r ON g_r.book_id = b.book_id AND g_r.date_finished IS NOT NULL",
    label,
    order: Order::Text,
    by_reading: true,
  }
}

/// A question the stats tab asks.
///
/// `limit` only applies to groups ordered by size. Groups that are dates or numbers are always
/// returned whole, since cutting them would leave a hole in the axis. `include_empty` adds a
/// "None" row for the books that have no value for `group_by`.
#[derive(Debug, Clone, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct StatsQuery {
  pub measure: StatsMeasure,
  pub group_by: StatsGroup,
  pub filter: BookFilter,
  pub limit: Option<i64>,
  pub include_empty: bool,
}

#[derive(Debug, Clone, Serialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct StatsRow {
  pub label: String,
  pub value: f64,
  /// Books behind the value, whatever the measure is.
  pub books: i64,
}

#[derive(Debug, Clone, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct StatsResult {
  pub rows: Vec<StatsRow>,
  /// Books that pass the filter, before they are split into groups.
  pub matching_books: i64,
}

#[derive(Debug, Clone, Serialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySummary {
  pub books: i64,
  /// Books with at least one finished read-through.
  pub finished: i64,
  /// Books with a read-through that has no finish date.
  pub in_progress: i64,
  /// Pages over every finished read-through, so a reread counts again.
  pub pages_read: i64,
  /// Mean over the rated books only. `None` when nothing is rated.
  pub avg_rating: Option<f64>,
}

#[command(stats)]
async fn run_stats(
  app: AppHandle,
  pool: State<'_, SqlitePool>,
  query: StatsQuery,
) -> Res<StatsResult> {
  let outside = outside_for(&app, &query.filter);
  run(pool.inner(), &query, &outside).await
}

/// Numbers for the top of the tab. Not narrowed by any filter.
#[command(stats)]
async fn library_summary(pool: State<'_, SqlitePool>) -> Res<LibrarySummary> {
  summary(pool.inner()).await
}

pub(crate) async fn summary(pool: &SqlitePool) -> Res<LibrarySummary> {
  Ok(
    sqlx::query_as::<_, LibrarySummary>(
      "SELECT
         (SELECT COUNT(*) FROM book) AS books,
         (SELECT COUNT(DISTINCT book_id) FROM reading
            WHERE date_finished IS NOT NULL) AS finished,
         (SELECT COUNT(DISTINCT book_id) FROM reading
            WHERE date_finished IS NULL) AS in_progress,
         (SELECT CAST(COALESCE(SUM(b.page_count), 0) AS INTEGER) FROM reading r
            JOIN book b ON b.book_id = r.book_id
            WHERE r.date_finished IS NOT NULL) AS pages_read,
         (SELECT CAST(AVG(rating) AS REAL) FROM book WHERE rating > 0) AS avg_rating",
    )
    .fetch_one(pool)
    .await?,
  )
}

/// What the command runs. The tests call it directly.
pub(crate) async fn run(
  pool: &SqlitePool,
  query: &StatsQuery,
  outside: &Outside,
) -> Res<StatsResult> {
  let mut groups = groups_query(query, outside);
  let rows = groups.build_query_as::<StatsRow>().fetch_all(pool).await?;

  let mut count = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM book b WHERE 1 = 1");
  push_conditions(&mut count, &query.filter, outside);
  let matching_books = count
    .build_query_scalar::<i64>()
    .fetch_one(pool)
    .await?;

  Ok(StatsResult {
    rows,
    matching_books,
  })
}

fn groups_query<'q>(query: &'q StatsQuery, outside: &'q Outside) -> QueryBuilder<'q, Sqlite> {
  let dim = query.group_by.dim();

  // The value is cast so SQLite hands back a REAL for every measure, which is what sqlx reads
  // into an f64. COALESCE gives the books without a value their own "None" group.
  let mut qb = QueryBuilder::<Sqlite>::new(format!(
    "SELECT COALESCE({label}, 'None') AS label, \
            CAST({measure} AS REAL) AS value, \
            COUNT(DISTINCT b.book_id) AS books \
     FROM book b {joins} WHERE 1 = 1",
    label = dim.label,
    measure = query.measure.sql(),
    joins = dim.joins,
  ));
  push_conditions(&mut qb, &query.filter, outside);
  if dim.by_reading {
    push_finished_bounds(&mut qb, &query.filter, "g_r.date_finished");
  }
  if !query.include_empty {
    qb.push(format!(" AND {} IS NOT NULL", dim.label));
  }

  // A group with nothing to measure (no page counts at all) is dropped. "None" always goes last.
  qb.push(" GROUP BY label HAVING value IS NOT NULL ORDER BY (label = 'None'), ");
  qb.push(match dim.order {
    Order::Value => "value DESC, label",
    Order::Text => "label",
    Order::Number => "CAST(label AS INTEGER)",
  });
  if let (Order::Value, Some(limit)) = (dim.order, query.limit) {
    qb.push(" LIMIT ").push_bind(limit.clamp(1, MAX_LIMIT));
  }
  qb
}
