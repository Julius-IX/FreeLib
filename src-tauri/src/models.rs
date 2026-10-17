//! `FromRow` reads them out of sqlx, `Serialize` sends them over IPC, and
//! `TsType` emits the matching `export type` into src/lib/types.ts.
//! Dates are ISO `YYYY-MM-DD` text (SQLite has no real date type).

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use tauri_groups::TsType;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct Author {
  pub author_id: i64,
  pub name: String,
  pub birth_date: Option<String>,
  pub death_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct Series {
  pub series_id: i64,
  pub name: String,
}

/// `book.notes` is not mapped here on purpose: notes can be long, and every list /
/// filter query returns whole `Book`s. Read and write them with
/// `get_book_notes` / `update_book_notes`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct Book {
  pub book_id: i64,
  pub title: String,
  pub isbn: Option<String>,
  pub publish_date: Option<String>,
  pub blurb: Option<String>,
  pub page_count: Option<i64>,
  pub series_id: Option<i64>,
  pub series_position: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct BookAuthor {
  pub book_id: i64,
  pub author_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct TagType {
  pub tag_type_id: i64,
  pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
  pub tag_id: i64,
  pub tag_type_id: i64,
  pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct BookTag {
  pub book_id: i64,
  pub tag_id: i64,
}

/// `color` is a `#rrggbb` hex string (enforced by a CHECK on the table).
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct Category {
  pub category_id: i64,
  pub name: String,
  pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct BookCategory {
  pub book_id: i64,
  pub category_id: i64,
}

/// A user-defined group of books, shown as a tab in the library. `position` is the tab order.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
  pub shelf_id: i64,
  pub name: String,
  pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct BookShelf {
  pub book_id: i64,
  pub shelf_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
  pub reading_id: i64,
  pub book_id: i64,
  pub date_started: Option<String>,
  pub date_finished: Option<String>,
}
