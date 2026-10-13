//! One struct per table in migrations/0001_initial.sql.
//!
//! `FromRow` reads them out of sqlx, `Serialize` sends them over IPC, and
//! `TsType` emits the matching `export interface` into src/lib/types.ts.
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

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TsType)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
  pub reading_id: i64,
  pub book_id: i64,
  pub date_started: Option<String>,
  pub date_finished: Option<String>,
}
