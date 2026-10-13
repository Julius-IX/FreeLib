use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;

/// "What does this Rust type look like on the TS side?"
///
/// Derive this for custom types (`#[derive(TsType)]`); it's implemented here
/// for std types, so a command argument whose type has no impl is a compile error
/// rather than a silently wrong `.ts` file.
pub trait TsType {
  /// `true` for `Option<_>`: the arg becomes `name?: T | null`.
  const OPTIONAL: bool = false;
  /// The TS type expression, e.g. `string`, `Todo[]`, `Todo | null`.
  fn ts() -> String;
}

fn paren(t: String) -> String {
  if t.contains(' ') {
    format!("({t})")
  } else {
    t
  }
}

macro_rules! prim {
    ($ts:literal => $($t:ty),+) => { $(impl TsType for $t { fn ts() -> String { $ts.into() } })+ };
}
prim!("string" => String, str, char, Path, PathBuf);
prim!("boolean" => bool);
// NOTE: 64/128-bit ints exceed JS's 2^53 safe range; Tauri sends them as plain numbers anyway.
prim!("number" => i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize, f32, f64);
prim!("void" => ());
prim!("unknown" => serde_json::Value);

impl<T: TsType + ?Sized> TsType for &T {
  const OPTIONAL: bool = T::OPTIONAL;
  fn ts() -> String {
    T::ts()
  }
}
impl<T: TsType + ?Sized> TsType for &mut T {
  const OPTIONAL: bool = T::OPTIONAL;
  fn ts() -> String {
    T::ts()
  }
}
impl<T: TsType + ?Sized> TsType for Box<T> {
  const OPTIONAL: bool = T::OPTIONAL;
  fn ts() -> String {
    T::ts()
  }
}
impl<T: TsType + ?Sized> TsType for Arc<T> {
  const OPTIONAL: bool = T::OPTIONAL;
  fn ts() -> String {
    T::ts()
  }
}
impl<T: TsType + ?Sized> TsType for Rc<T> {
  const OPTIONAL: bool = T::OPTIONAL;
  fn ts() -> String {
    T::ts()
  }
}
impl<T: TsType + ?Sized + ToOwned> TsType for Cow<'_, T> {
  fn ts() -> String {
    T::ts()
  }
}

impl<T: TsType> TsType for Option<T> {
  const OPTIONAL: bool = true;
  fn ts() -> String {
    format!("{} | null", T::ts())
  }
}
// Result<T, E> -> T: errors reject the promise, they aren't part of the resolved value
impl<T: TsType, E> TsType for Result<T, E> {
  fn ts() -> String {
    T::ts()
  }
}

macro_rules! seq {
    ($($t:ident),+) => { $(impl<T: TsType> TsType for $t<T> { fn ts() -> String { format!("{}[]", paren(T::ts())) } })+ };
}
seq!(Vec, VecDeque, HashSet, BTreeSet);
impl<T: TsType> TsType for [T] {
  fn ts() -> String {
    format!("{}[]", paren(T::ts()))
  }
}
impl<T: TsType, const N: usize> TsType for [T; N] {
  fn ts() -> String {
    format!("{}[]", paren(T::ts()))
  }
}

// keys are always strings in JSON
impl<K, V: TsType> TsType for HashMap<K, V> {
  fn ts() -> String {
    format!("Record<string, {}>", V::ts())
  }
}
impl<K, V: TsType> TsType for BTreeMap<K, V> {
  fn ts() -> String {
    format!("Record<string, {}>", V::ts())
  }
}

macro_rules! tuple {
    ($($t:ident),+) => {
        impl<$($t: TsType),+> TsType for ($($t,)+) {
            fn ts() -> String { format!("[{}]", [$($t::ts()),+].join(", ")) }
        }
    };
}
tuple!(A);
tuple!(A, B);
tuple!(A, B, C);
tuple!(A, B, C, D);
tuple!(A, B, C, D, E);

// Serde serializes all of these as ISO strings
#[cfg(feature = "chrono")]
mod chrono_impls {
  use super::TsType;
  impl<Tz: chrono::TimeZone> TsType for chrono::DateTime<Tz> {
    fn ts() -> String {
      "string".into()
    }
  }
  prim!("string" => chrono::NaiveDateTime, chrono::NaiveDate, chrono::NaiveTime);
}
#[cfg(feature = "uuid")]
prim!("string" => uuid::Uuid);
