use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, parse_quote, Ident, Item, ItemFn, ItemMod, Meta};

/// `#[command(group)]` on a `pub fn`, in ANY module or file.
///
/// Turns the fn into a real `#[tauri::command]` whose wire name is
/// `<group>__<fn>` (so `files::list` and `db::list` can coexist).
/// `build.rs` finds these and registers them automatically.
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
    f.sig.ident = Ident::new(&format!("{}__{}", group, f.sig.ident), f.sig.ident.span());
    f.attrs.insert(0, parse_quote!(#[tauri::command]));
    f.attrs.push(parse_quote!(#[allow(non_snake_case)])); // `a__b` trips the lint
    quote!(#f).into()
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

fn is_cmd(a: &syn::Attribute) -> bool {
    let p = a.path();
    p.is_ident("command")
        || (p.segments.len() == 2 && p.segments[0].ident == "tauri_groups" && p.segments[1].ident == "command")
}

fn tag(m: &mut ItemMod, group: &Ident) {
    let Some((_, items)) = &mut m.content else { return };
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
