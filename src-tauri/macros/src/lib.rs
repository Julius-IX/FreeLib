//! Proc macros for `tauri-groups`. Used through the `tauri_groups` crate,
//! which re-exports everything here.

use proc_macro::TokenStream;
use quote::{format_ident, quote};
use syn::{
  parse_macro_input, parse_quote, spanned::Spanned, Attribute, FnArg, Ident, Item, ItemFn, ItemMod,
  Meta, Pat, Type,
};

mod ts_derive;

/// Argument types Tauri injects itself; these never cross the wire.
const INJECTED: &[&str] = &[
  "State",
  "AppHandle",
  "Window",
  "WebviewWindow",
  "Webview",
  "Request",
];

/// `#[command(group)]` on a fn, in ANY module or file.
///
/// - Turns the fn into a real `#[tauri::command]` named `<group>__<fn>`
///   (so `files::list` and `db::list` can coexist).
/// - Registers it (handler + TypeScript signature) in a link-time registry,
///   so there's nothing to list by hand and nothing for build.rs to scan.
#[proc_macro_attribute]
pub fn command(args: TokenStream, input: TokenStream) -> TokenStream {
  let mut f = parse_macro_input!(input as ItemFn);
  if args.is_empty() {
    return syn::Error::new_spanned(
      &f.sig.ident,
      "missing group: write `#[command(group_name)]`, \
             or put this fn inside an inline `#[group]` module",
    )
    .to_compile_error()
    .into();
  }
  let group = parse_macro_input!(args as Ident);
  let name = f.sig.ident.clone();
  let wire = format_ident!("{}__{}", group, name);

  // TS signature: every non-injected, named argument
  let mut ts_args = vec![];
  for a in &f.sig.inputs {
    let FnArg::Typed(p) = a else { continue };
    if is_injected(&p.ty) {
      continue;
    }
    let Pat::Ident(id) = &*p.pat else { continue };
    // Tauri maps JS camelCase -> Rust snake_case for arg names
    let js = camel(id.ident.to_string().trim_start_matches("r#"));
    let ty = strip_refs(&p.ty);
    ts_args.push(quote! {
        ::tauri_groups::Arg {
            name: #js,
            ty: <#ty as ::tauri_groups::TsType>::ts(),
            optional: <#ty as ::tauri_groups::TsType>::OPTIONAL,
        }
    });
  }
  let ret: Type = match &f.sig.output {
    syn::ReturnType::Default => parse_quote!(()),
    syn::ReturnType::Type(_, t) => (**t).clone(),
  };

  let (group_s, name_s, wire_s) = (group.to_string(), name.to_string(), wire.to_string());
  f.sig.ident = wire.clone();
  f.attrs.insert(0, parse_quote!(#[tauri::command]));
  f.attrs.push(parse_quote!(#[allow(non_snake_case)])); // `a__b` trips the lint

  quote! {
      #f

      ::tauri_groups::__private::inventory::submit! {
          ::tauri_groups::CommandEntry {
              group: #group_s,
              name: #name_s,
              wire: #wire_s,
              sig: || ::tauri_groups::Sig {
                  args: ::std::vec![#(#ts_args),*],
                  ret: <#ret as ::tauri_groups::TsType>::ts(),
              },
              call: ::tauri::generate_handler![#wire],
          }
      }
  }
  .into()
}

/// Sugar for an INLINE module: bare `#[command]` fns inside default to this
/// group (`#[group]` = module name, `#[group(name)]` = explicit).
/// Attribute macros can't see into `mod x;` files, so for those, put the
/// group on each fn: `#[command(group)]`.
#[proc_macro_attribute]
pub fn group(args: TokenStream, input: TokenStream) -> TokenStream {
  let mut module = parse_macro_input!(input as ItemMod);
  if module.content.is_none() {
    return syn::Error::new_spanned(
      &module,
      "#[group] only works on inline modules (`mod x { .. }`); \
             for `mod x;` files use `#[command(group)]` on each fn",
    )
    .to_compile_error()
    .into();
  }
  let name = if args.is_empty() {
    module.ident.clone()
  } else {
    parse_macro_input!(args as Ident)
  };
  tag(&mut module, &name);
  quote!(#module).into()
}

/// Derive a TypeScript equivalent for a struct / newtype / unit-only enum.
/// Emitted as an `export interface` / `export type` into the generated file.
/// Honors `#[serde(rename_all, rename, skip)]`; per-field override with
/// `#[ts(type = "string")]`, and `#[ts(skip)]`.
#[proc_macro_derive(TsType, attributes(ts))]
pub fn derive_ts_type(input: TokenStream) -> TokenStream {
  let input = parse_macro_input!(input as syn::DeriveInput);
  ts_derive::expand(input)
    .unwrap_or_else(|e| e.to_compile_error())
    .into()
}

fn is_cmd(a: &Attribute) -> bool {
  let p = a.path();
  p.is_ident("command")
    || (p.segments.len() == 2
      && p.segments[0].ident == "tauri_groups"
      && p.segments[1].ident == "command")
}

fn tag(m: &mut ItemMod, group: &Ident) {
  let Some((_, items)) = &mut m.content else {
    return;
  };
  for item in items {
    match item {
      Item::Fn(f) => {
        for a in &mut f.attrs {
          if is_cmd(a) && matches!(a.meta, Meta::Path(_)) {
            *a = parse_quote!(#[::tauri_groups::command(#group)]);
          }
        }
      }
      // a nested #[group] expands itself and wins over ours
      Item::Mod(inner) if !inner.attrs.iter().any(|a| a.path().is_ident("group")) => {
        tag(inner, group)
      }
      _ => {}
    }
  }
}

fn is_injected(ty: &Type) -> bool {
  match ty {
    Type::Path(p) => p
      .path
      .segments
      .last()
      .is_some_and(|s| INJECTED.contains(&s.ident.to_string().as_str())),
    Type::Reference(r) => is_injected(&r.elem),
    _ => false,
  }
}

fn strip_refs(ty: &Type) -> &Type {
  match ty {
    Type::Reference(r) => strip_refs(&r.elem),
    t => t,
  }
}

fn camel(s: &str) -> String {
  let (mut out, mut up) = (String::new(), false);
  for c in s.chars() {
    if c == '_' {
      up = true;
    } else if up {
      out.extend(c.to_uppercase());
      up = false;
    } else {
      out.push(c);
    }
  }
  out
}

pub(crate) fn err<T>(span: impl Spanned, msg: &str) -> syn::Result<T> {
  Err(syn::Error::new(span.span(), msg))
}
