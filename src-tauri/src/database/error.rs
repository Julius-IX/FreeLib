use serde::{Serialize, Serializer};

/// What every `db` command rejects with. The frontend just sees a string.
#[derive(Debug)]
pub struct DbError(String);

impl From<sqlx::Error> for DbError {
  fn from(e: sqlx::Error) -> Self {
    let msg = match &e {
      sqlx::Error::RowNotFound => "not found".to_string(),
      sqlx::Error::Database(d) if d.is_unique_violation() => {
        format!("already exists ({})", d.message())
      }
      // needs `PRAGMA foreign_keys = ON` (set in the migration)
      sqlx::Error::Database(d) if d.is_foreign_key_violation() => {
        "still referenced by other rows, or points at a row that doesn't exist".to_string()
      }
      sqlx::Error::Database(d) if d.is_check_violation() => {
        format!("invalid value ({})", d.message())
      }
      _ => e.to_string(),
    };
    DbError(msg)
  }
}

impl Serialize for DbError {
  fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&self.0)
  }
}

pub(crate) type Res<T> = Result<T, DbError>;
