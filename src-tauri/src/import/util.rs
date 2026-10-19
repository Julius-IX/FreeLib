//! Small cleaning helpers any import format can use. They take messy text from a file and return
//! what the database accepts, or `None` when the text isn't usable.

/// Adds `value` (trimmed) unless it's empty or already in the list, ignoring case.
pub(super) fn push_unique(list: &mut Vec<String>, value: &str) {
  let value = value.trim();
  if value.is_empty() {
    return;
  }
  let key = value.to_lowercase();
  if !list.iter().any(|v| v.to_lowercase() == key) {
    list.push(value.to_string());
  }
}

/// `="0316187747"` -> `0316187747`. Only 10- and 13-character ISBNs pass (same rule as covers).
///
/// Anything that isn't an ISBN (empty, an ASIN, junk) gives `None`: the book is still imported,
/// just without one (`book.isbn` is nullable).
pub(super) fn clean_isbn(raw: &str) -> Option<String> {
  let s: String = raw
    .chars()
    .filter(|c| c.is_ascii_alphanumeric())
    .collect::<String>()
    .to_ascii_uppercase();
  let digits = |t: &str| t.bytes().all(|b| b.is_ascii_digit());
  match s.len() {
    13 if digits(&s) => Some(s),
    10 if digits(&s[..9]) && matches!(s.as_bytes()[9], b'0'..=b'9' | b'X') => Some(s),
    _ => None,
  }
}

/// `2026/10/17` -> `2026-10-17`. `None` for anything that isn't a real calendar date.
pub(super) fn iso_date(raw: &str) -> Option<String> {
  let mut parts = raw.trim().split(['/', '-']);
  let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
  if parts.next().is_some() {
    return None;
  }
  let (y, m, d): (i32, u32, u32) = (y.parse().ok()?, m.parse().ok()?, d.parse().ok()?);
  let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
  let max = match m {
    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
    4 | 6 | 9 | 11 => 30,
    2 if leap => 29,
    2 => 28,
    _ => return None,
  };
  if !(1..=9999).contains(&y) || d < 1 || d > max {
    return None;
  }
  Some(format!("{y:04}-{m:02}-{d:02}"))
}

/// Reviews exported by book sites are small HTML: `<br/>` for line breaks, a few entities. This
/// keeps the text and the line breaks and drops the rest.
pub(super) fn clean_html(raw: &str) -> String {
  let mut out = String::with_capacity(raw.len());
  let mut rest = raw;
  while let Some(i) = rest.find('<') {
    out.push_str(&rest[..i]);
    match rest[i..].find('>') {
      Some(j) => {
        let tag = rest[i + 1..i + j].trim().to_ascii_lowercase();
        if tag.starts_with("br") || tag == "/p" {
          out.push('\n');
        }
        rest = &rest[i + j + 1..];
      }
      None => {
        out.push_str(&rest[i..]);
        rest = "";
      }
    }
  }
  out.push_str(rest);
  out
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&amp;", "&")
    .trim()
    .to_string()
}

/// Turns a rating on any scale into FreeLib's 0-10 (a float, 0 = no rating): `value` out of
/// `max`, so Goodreads' 5 stars is `scale_rating(raw, 5.0)`. Unparseable text, a value of 0 and
/// anything outside `0..=max` all mean "no rating" rather than an error.
pub(super) fn scale_rating(raw: &str, max: f64) -> f64 {
  raw
    .trim()
    .parse::<f64>()
    .ok()
    .filter(|v| (0.0..=max).contains(v))
    // multiply first: 3.5 * 10 / 5 is exactly 7, 3.5 / 5 * 10 can round to 6.999...
    .map_or(0.0, |v| v * 10.0 / max)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn isbns_and_dates_are_cleaned() {
    assert_eq!(clean_isbn("=\"0316187747\"").as_deref(), Some("0316187747"));
    assert_eq!(clean_isbn("=\"978-0-316-18774-9\"").as_deref(), Some("9780316187749"));
    assert_eq!(clean_isbn("=\"080442957x\"").as_deref(), Some("080442957X"));
    assert_eq!(clean_isbn("=\"\""), None);
    assert_eq!(clean_isbn("B00ABCDEFG"), None);

    assert_eq!(iso_date("2026/10/17").as_deref(), Some("2026-10-17"));
    assert_eq!(iso_date("2024/2/29").as_deref(), Some("2024-02-29"));
    assert_eq!(iso_date("2025/02/29"), None);
    assert_eq!(iso_date("2025/13/01"), None);
    assert_eq!(iso_date("2025"), None);
    assert_eq!(iso_date(""), None);
  }

  #[test]
  fn html_loses_its_tags() {
    assert_eq!(clean_html("Great<br/>stuff &amp; <i>more</i><br />end"), "Great\nstuff & more\nend");
    assert_eq!(clean_html("I <3 this"), "I <3 this");
  }

  #[test]
  fn ratings_are_scaled_to_ten() {
    assert_eq!(scale_rating("4.0", 5.0), 8.0);
    assert_eq!(scale_rating("5", 5.0), 10.0);
    assert_eq!(scale_rating("3.5", 5.0), 7.0);
    assert_eq!(scale_rating("0", 5.0), 0.0);
    assert_eq!(scale_rating("", 5.0), 0.0);
    assert_eq!(scale_rating("9", 5.0), 0.0);
    assert_eq!(scale_rating("9", 10.0), 9.0);
  }

  #[test]
  fn push_unique_ignores_case_and_blanks() {
    let mut list = Vec::new();
    for v in ["Ann", " ann ", "", "Bob"] {
      push_unique(&mut list, v);
    }
    assert_eq!(list, vec!["Ann".to_string(), "Bob".to_string()]);
  }
}
