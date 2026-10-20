use proc_macro2::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Expr, Fields, Lit, LitStr, Token};

use crate::err;

#[derive(Default)]
struct Attrs {
  rename_all: Option<String>,
  rename: Option<String>,
  skip: bool,
  ty: Option<String>, // #[ts(type = "...")]
}

/// Reads `#[serde(..)]` and `#[ts(..)]`. Ignores every serde key that is irrelevant here.
fn attrs(list: &[syn::Attribute]) -> syn::Result<Attrs> {
  let mut out = Attrs::default();
  for a in list {
    let is_ts = a.path().is_ident("ts");
    if !is_ts && !a.path().is_ident("serde") {
      continue;
    }
    a.parse_nested_meta(|m| {
      let key = m
        .path
        .get_ident()
        .map(|i| i.to_string())
        .unwrap_or_default();
      // `key = "str"` / `key = expr`
      if m.input.peek(Token![=]) {
        let e: Expr = m.value()?.parse()?;
        let s = match &e {
          Expr::Lit(l) => match &l.lit {
            Lit::Str(s) => Some(s.value()),
            _ => None,
          },
          _ => None,
        };
        match (key.as_str(), s) {
          ("rename_all", Some(s)) => out.rename_all = Some(s),
          ("rename", Some(s)) => out.rename = Some(s),
          ("type", Some(s)) if is_ts => out.ty = Some(s),
          ("flatten", _) => return Err(m.error("flatten isn't supported by TsType")),
          _ => {}
        }
      } else if m.input.peek(syn::token::Paren) {
        // e.g. rename_all(serialize = "..", deserialize = ".."): not worth modelling
        let content;
        syn::parenthesized!(content in m.input);
        let _: TokenStream = content.parse()?;
      } else {
        match key.as_str() {
          "skip" | "skip_serializing" => out.skip = true,
          "flatten" => return Err(m.error("flatten isn't supported by TsType")),
          _ => {}
        }
      }
      Ok(())
    })?;
  }
  Ok(out)
}

fn words(s: &str) -> Vec<String> {
  let mut out: Vec<String> = vec![];
  let mut cur = String::new();
  let mut prev_lower = false;
  for c in s.chars() {
    if c == '_' || c == '-' {
      if !cur.is_empty() {
        out.push(std::mem::take(&mut cur));
      }
      prev_lower = false;
      continue;
    }
    if c.is_uppercase() && prev_lower && !cur.is_empty() {
      out.push(std::mem::take(&mut cur));
    }
    prev_lower = c.is_lowercase() || c.is_ascii_digit();
    cur.extend(c.to_lowercase());
  }
  if !cur.is_empty() {
    out.push(cur);
  }
  out
}

fn cap(w: &str) -> String {
  let mut c = w.chars();
  c.next()
    .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
    .unwrap_or_default()
}

fn apply_case(s: &str, rule: &str, span: proc_macro2::Span) -> syn::Result<String> {
  let w = words(s);
  Ok(match rule {
    "lowercase" => w.concat(),
    "UPPERCASE" => w.concat().to_uppercase(),
    "PascalCase" => w.iter().map(|x| cap(x)).collect(),
    "camelCase" => w
      .iter()
      .enumerate()
      .map(|(i, x)| if i == 0 { x.clone() } else { cap(x) })
      .collect(),
    "snake_case" => w.join("_"),
    "SCREAMING_SNAKE_CASE" => w.join("_").to_uppercase(),
    "kebab-case" => w.join("-"),
    "SCREAMING-KEBAB-CASE" => w.join("-").to_uppercase(),
    other => {
      return Err(syn::Error::new(
        span,
        format!("unknown rename_all `{other}`"),
      ))
    }
  })
}

fn key(name: &str) -> String {
  let ident = !name.is_empty()
    && !name.starts_with(|c: char| c.is_ascii_digit())
    && name
      .chars()
      .all(|c| c.is_alphanumeric() || c == '_' || c == '$');
  if ident {
    name.to_string()
  } else {
    format!("{name:?}")
  }
}

pub fn expand(input: DeriveInput) -> syn::Result<TokenStream> {
  let ident = &input.ident;
  let name = ident.to_string();
  if !input.generics.params.is_empty() {
    return err(
      &input.generics,
      "TsType can't derive generics; implement `TsType` by hand",
    );
  }
  let container = attrs(&input.attrs)?;
  let rule = container.rename_all.as_deref();

  // Body expression: a `String` describing the declaration
  let decl: TokenStream = match &input.data {
    Data::Struct(s) => match &s.fields {
      Fields::Named(named) => {
        let mut lines = vec![];
        for f in &named.named {
          let a = attrs(&f.attrs)?;
          if a.skip {
            continue;
          }
          let fname = f.ident.as_ref().unwrap().to_string();
          let fname = fname.trim_start_matches("r#");
          let k = match (&a.rename, rule) {
            (Some(r), _) => r.clone(),
            (None, Some(rule)) => apply_case(fname, rule, ident.span())?,
            _ => fname.to_string(),
          };
          let k = key(&k);
          let ty = &f.ty;
          let ty_expr = match &a.ty {
            Some(t) => quote!(::std::string::String::from(#t)),
            None => quote!(<#ty as ::tauri_groups::TsType>::ts()),
          };
          lines.push(quote!(::std::format!("  {}: {};\n", #k, #ty_expr)));
        }
        quote! {{
            let mut s = ::std::format!("export type {} = {{\n", #name);
            #( s += &#lines; )*
            s += "}";
            s
        }}
      }
      Fields::Unnamed(u) => {
        let tys: Vec<_> = u.unnamed.iter().map(|f| &f.ty).collect();
        match tys.as_slice() {
          [] => quote!(::std::format!("export type {} = null;", #name)),
          [one] => quote! {
              ::std::format!("export type {} = {};", #name, <#one as ::tauri_groups::TsType>::ts())
          },
          many => quote! {{
              let parts: ::std::vec::Vec<::std::string::String> =
                  ::std::vec![#(<#many as ::tauri_groups::TsType>::ts()),*];
              ::std::format!("export type {} = [{}];", #name, parts.join(", "))
          }},
        }
      }
      Fields::Unit => quote!(::std::format!("export type {} = null;", #name)),
    },
    Data::Enum(e) => {
      let mut variants = vec![];
      for v in &e.variants {
        if !matches!(v.fields, Fields::Unit) {
          return err(
            v,
            "TsType only supports enums with unit variants; implement `TsType` by hand",
          );
        }
        let a = attrs(&v.attrs)?;
        if a.skip {
          continue;
        }
        let vn = v.ident.to_string();
        let vn = match (&a.rename, rule) {
          (Some(r), _) => r.clone(),
          (None, Some(rule)) => apply_case(&vn, rule, v.ident.span())?,
          _ => vn,
        };
        variants.push(LitStr::new(&format!("{vn:?}"), v.ident.span()));
      }
      let joined = if variants.is_empty() {
        "never".to_string()
      } else {
        variants
          .iter()
          .map(|l| l.value())
          .collect::<Vec<_>>()
          .join(" | ")
      };
      quote!(::std::format!("export type {} = {};", #name, #joined))
    }
    Data::Union(_) => return err(ident, "TsType can't derive unions"),
  };

  Ok(quote! {
      impl ::tauri_groups::TsType for #ident {
          fn ts() -> ::std::string::String { ::std::string::String::from(#name) }
      }
      ::tauri_groups::__private::inventory::submit! {
          ::tauri_groups::TypeEntry { name: #name, decl: || #decl }
      }
  })
}
