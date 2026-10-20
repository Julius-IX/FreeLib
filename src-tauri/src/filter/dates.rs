//! Reading the dates people type, and turning them into SQL on the stored (possibly partial) dates.
//!
//! Bounds are inclusive and forgiving: see [`parse_date`] for what is accepted and the docs on
//! `BookFilter` for how a partial date (`2024`) stands for its whole period.

use sqlx::{QueryBuilder, Sqlite};

const MONTHS: [&str; 12] = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

#[derive(Clone, Copy)]
enum Part {
  /// A run of digits and how many digits it had.
  Num(u32, usize),
  Month(u32),
}

/// "mar", "March", "sept" -> month number. Needs at least 3 letters.
fn month_name(s: &str) -> Option<u32> {
  let s = s.to_ascii_lowercase();
  if s.len() < 3 {
    return None;
  }
  MONTHS
    .iter()
    .position(|m| m.starts_with(&s))
    .map(|i| i as u32 + 1)
}

fn parse_part(tok: &str) -> Option<Part> {
  if tok.bytes().all(|b| b.is_ascii_digit()) {
    return Some(Part::Num(tok.parse().ok()?, tok.len()));
  }
  // ordinals: 1st, 2nd, 3rd, 7th
  let digits = tok.trim_end_matches(|c: char| c.is_ascii_alphabetic());
  let suffix = &tok[digits.len()..];
  if !digits.is_empty()
    && digits.bytes().all(|b| b.is_ascii_digit())
    && matches!(
      suffix.to_ascii_lowercase().as_str(),
      "st" | "nd" | "rd" | "th"
    )
  {
    return Some(Part::Num(digits.parse().ok()?, digits.len()));
  }
  month_name(tok).map(Part::Month)
}

fn month_of(p: &Part) -> Option<u32> {
  match p {
    Part::Num(n, len) if *len <= 2 && (1..=12).contains(n) => Some(*n),
    Part::Month(m) => Some(*m),
    _ => None,
  }
}

fn day_of(p: &Part) -> Option<u32> {
  match p {
    Part::Num(n, len) if *len <= 2 && (1..=31).contains(n) => Some(*n),
    _ => None,
  }
}

/// `a b year` -> (month, day). Month names decide the order. With two numbers
/// the one above 12 is the day, and when it's ambiguous (03/04/2024) the day
/// comes first (3 April), the way it is written in most of the world.
fn month_day_before_year(a: &Part, b: &Part) -> Option<(u32, u32)> {
  match (a, b) {
    (Part::Month(m), d) | (d, Part::Month(m)) => Some((*m, day_of(d)?)),
    (Part::Num(x, _), Part::Num(z, _)) => {
      if *x <= 12 && *z > 12 {
        Some((month_of(a)?, day_of(b)?))
      } else {
        Some((month_of(b)?, day_of(a)?))
      }
    }
  }
}

fn days_in_month(y: u32, m: u32) -> u32 {
  match m {
    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
    4 | 6 | 9 | 11 => 30,
    _ if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
    _ => 28,
  }
}

/// Parses a full or partial date into `YYYY-MM-DD`. A partial date expands to
/// the first day of its period (`end = false`) or the last (`end = true`).
///
/// Accepted: `2024`, `2024-03`, `2024-03-07` (separators `-` `/` `.` or
/// spaces, 1 or 2 digit month and day), compact `202403` / `20240307`,
/// `March 2024`, `Mar 7, 2024`, `7th March 2024`, `3/2024`, `07.03.2024`, and
/// anything with a trailing `T...` time part. Returns `None` for anything else
/// and for dates that don't exist (`2023-02-29`).
fn parse_date(raw: &str, end: bool) -> Option<String> {
  let mut s = raw.trim();
  if let Some(i) = s.find('T') {
    if s[..i].ends_with(|c: char| c.is_ascii_digit())
      && s[i + 1..].starts_with(|c: char| c.is_ascii_digit())
    {
      s = &s[..i];
    }
  }

  // Only known separators are accepted. Anything else (`>2024`, `2024:`) is not a date,
  // rather than silently becoming one.
  if s
    .chars()
    .any(|c| !(c.is_alphanumeric() || c.is_whitespace() || "-/.,".contains(c)))
  {
    return None;
  }

  let parts: Vec<Part> = s
    .split(|c: char| !c.is_alphanumeric())
    .filter(|t| !t.is_empty() && !t.eq_ignore_ascii_case("of"))
    .map(parse_part)
    .collect::<Option<_>>()?;

  let (y, m, d): (u32, Option<u32>, Option<u32>) = match parts.as_slice() {
    [Part::Num(n, 4)] => (*n, None, None),
    [Part::Num(n, 6)] => (n / 100, Some(n % 100), None),
    [Part::Num(n, 8)] => (n / 10_000, Some(n / 100 % 100), Some(n % 100)),
    [Part::Num(y, 4), a] => (*y, Some(month_of(a)?), None),
    [a, Part::Num(y, 4)] => (*y, Some(month_of(a)?), None),
    [Part::Num(y, 4), a, b] => (*y, Some(month_of(a)?), Some(day_of(b)?)),
    [a, b, Part::Num(y, 4)] => {
      let (m, d) = month_day_before_year(a, b)?;
      (*y, Some(m), Some(d))
    }
    _ => return None,
  };

  if !(1..=9999).contains(&y) {
    return None;
  }
  let m = m.unwrap_or(if end { 12 } else { 1 });
  if !(1..=12).contains(&m) {
    return None;
  }
  let last = days_in_month(y, m);
  let d = match d {
    Some(d) if (1..=last).contains(&d) => d,
    Some(_) => return None,
    None if end => last,
    None => 1,
  };
  Some(format!("{y:04}-{m:02}-{d:02}"))
}

/// A normalised inclusive date range. Either side may be open.
#[derive(Debug, Default, PartialEq)]
pub(super) struct DateBound {
  pub(super) from: Option<String>,
  pub(super) to: Option<String>,
}

impl DateBound {
  pub(super) fn is_empty(&self) -> bool {
    self.from.is_none() && self.to.is_none()
  }
}

/// Parses both sides (unparseable ones become open) and swaps a reversed range.
pub(super) fn date_bound(from: &Option<String>, to: &Option<String>) -> DateBound {
  let parse = |s: &Option<String>, end: bool| s.as_deref().and_then(|s| parse_date(s, end));
  let b = DateBound {
    from: parse(from, false),
    to: parse(to, true),
  };
  let reversed = matches!((&b.from, &b.to), (Some(f), Some(t)) if f > t);
  if reversed {
    DateBound {
      from: parse(to, false),
      to: parse(from, true),
    }
  } else {
    b
  }
}

/// Adds the date conditions for `col`. The column is read as the period it
/// names: `1950` is 1950-01-01..1950-12-31, `1950-03` is all of March 1950.
/// It matches when that period overlaps the range. Done in SQL by padding the
/// stored text, so plain string comparison on ISO dates stays correct.
pub(super) fn push_date(qb: &mut QueryBuilder<'_, Sqlite>, col: &str, b: &DateBound) {
  if b.is_empty() {
    return;
  }
  let d = format!("NULLIF(SUBSTR({col}, 1, 10), '')");
  qb.push(format!(" AND {d} GLOB '[0-9][0-9][0-9][0-9]*'"));
  if let Some(f) = &b.from {
    // latest day the stored value could mean must reach the range start
    qb.push(format!(
      " AND ({d} || SUBSTR('9999-12-31', LENGTH({d}) + 1)) >= "
    ))
    .push_bind(f.clone());
  }
  if let Some(t) = &b.to {
    // earliest day the stored value could mean must not pass the range end
    qb.push(format!(
      " AND ({d} || SUBSTR('0000-01-01', LENGTH({d}) + 1)) <= "
    ))
    .push_bind(t.clone());
  }
}

/// A full date as `YYYY-MM-DD`, from whatever format a provider uses ("March 7, 2004", "2004/3/7"...).
/// `None` for anything that isn't a single day, including a bare year or month: a partial date
/// expands to different days depending on `end`, so those two disagree.
pub(crate) fn parse_full_date(raw: &str) -> Option<String> {
  let first = parse_date(raw, false)?;
  (parse_date(raw, true)? == first).then_some(first)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn p(s: &str, end: bool) -> Option<String> {
    parse_date(s, end)
  }

  #[test]
  fn full_dates_any_format() {
    for s in [
      "2024-03-07",
      "2024/3/7",
      "2024.03.07",
      "20240307",
      "2024 03 07",
      "7 March 2024",
      "Mar 7, 2024",
      "7th of March 2024",
      "07.03.2024",
      "2024-03-07T10:00:00Z",
      " 2024-03-07 ",
      "2024-Mar-07",
    ] {
      assert_eq!(p(s, false).as_deref(), Some("2024-03-07"), "{s}");
      assert_eq!(p(s, true).as_deref(), Some("2024-03-07"), "{s}");
    }
  }

  #[test]
  fn partial_dates_expand_by_side() {
    assert_eq!(p("2024", false).as_deref(), Some("2024-01-01"));
    assert_eq!(p("2024", true).as_deref(), Some("2024-12-31"));
    for s in [
      "2024-02",
      "2024/2",
      "Feb 2024",
      "February 2024",
      "2/2024",
      "202402",
    ] {
      assert_eq!(p(s, false).as_deref(), Some("2024-02-01"), "{s}");
      assert_eq!(p(s, true).as_deref(), Some("2024-02-29"), "{s}"); // leap year
    }
    assert_eq!(p("2023-02", true).as_deref(), Some("2023-02-28"));
    assert_eq!(p("1900-02", true).as_deref(), Some("1900-02-28"));
    assert_eq!(p("2000-02", true).as_deref(), Some("2000-02-29"));
  }

  #[test]
  fn ambiguous_numeric_is_day_first() {
    assert_eq!(p("03/04/2024", false).as_deref(), Some("2024-04-03"));
    assert_eq!(p("13/04/2024", false).as_deref(), Some("2024-04-13"));
    assert_eq!(p("04/13/2024", false).as_deref(), Some("2024-04-13"));
  }

  #[test]
  fn rejects_garbage() {
    for s in [
      "",
      "  ",
      "abc",
      "20",
      "202",
      "2024-13",
      "2024-00-10",
      "2023-02-29",
      "2024-04-31",
      "2024-1-2-3",
      "0000",
      "mar",
      "2024-xx",
      ">2024",
      "99999",
    ] {
      assert_eq!(p(s, false), None, "{s}");
    }
  }

  #[test]
  fn bounds() {
    let s = |x: &str| Some(x.to_string());
    let b = date_bound(&s("1990"), &s("2000-06"));
    assert_eq!(b.from.as_deref(), Some("1990-01-01"));
    assert_eq!(b.to.as_deref(), Some("2000-06-30"));

    // same partial on both sides = the whole period
    let b = date_bound(&s("2024"), &s("2024"));
    assert_eq!(
      (b.from.as_deref(), b.to.as_deref()),
      (Some("2024-01-01"), Some("2024-12-31"))
    );

    // reversed range is swapped, re-expanding each side correctly
    let b = date_bound(&s("2000"), &s("1990"));
    assert_eq!(
      (b.from.as_deref(), b.to.as_deref()),
      (Some("1990-01-01"), Some("2000-12-31"))
    );

    // unparseable side is open, both unparseable is empty
    let b = date_bound(&s("19"), &s("2000"));
    assert_eq!((b.from, b.to.as_deref()), (None, Some("2000-12-31")));
    assert!(date_bound(&s("19"), &s("x")).is_empty());
    assert!(date_bound(&None, &None).is_empty());
  }
}
