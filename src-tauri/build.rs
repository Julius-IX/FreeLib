use std::{
  collections::BTreeMap,
  env, fs,
  path::{Path, PathBuf},
};
use syn::{
  Attribute, FnArg, GenericArgument, Ident, Item, ItemFn, ItemMod, Meta, Pat, PathArguments,
  ReturnType, Type, Visibility,
};

const TS_OUT: &str = "../src/lib/commands.ts"; // relative to src-tauri/
const INJECTED: &[&str] = &[
  "State",
  "AppHandle",
  "Window",
  "WebviewWindow",
  "Webview",
  "Request",
];

struct Arg {
  name: String,
  ty: String,
  optional: bool,
}
struct Cmd {
  group: String,
  name: String,
  module: Vec<String>, // path under `crate::`
  args: Vec<Arg>,
  ret: String,
}

fn main() {
  println!("cargo:rerun-if-changed=src");
  let mut s = Scanner { cmds: vec![] };
  // Follow `mod x;` declarations from the crate root, like rustc does.
  s.file(Ctx {
    file: "src/lib.rs".into(),
    module: vec![],
    child_dir: "src".into(),
    group: None,
    hidden: None,
  });
  let mut cmds = s.cmds;
  cmds.sort_by(|a, b| (&a.group, &a.name).cmp(&(&b.group, &b.name)));
  check_duplicates(&cmds);

  let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("groups.rs");
  write_if_changed(&out, &rust_handler(&cmds));
  write_if_changed(Path::new(TS_OUT), &ts_file(&cmds));
  tauri_build::build();
}

// build.rs runs BEFORE macros expand, so the source needs to be parsed manually

#[derive(Clone)]
struct Ctx {
  file: PathBuf,
  module: Vec<String>,
  child_dir: PathBuf,
  group: Option<String>,  // default group from an enclosing #[group]
  hidden: Option<String>, // first private module below the crate root's children
}

struct Scanner {
  cmds: Vec<Cmd>,
}

impl Scanner {
  fn file(&mut self, cx: Ctx) {
    let src = fs::read_to_string(&cx.file).unwrap_or_else(|e| panic!("{}: {e}", cx.file.display()));
    let ast = syn::parse_file(&src).unwrap_or_else(|e| panic!("{}: {e}", cx.file.display()));
    self.items(ast.items, &cx);
  }

  fn items(&mut self, items: Vec<Item>, cx: &Ctx) {
    for item in items {
      match item {
        Item::Fn(f) => self.func(f, cx),
        Item::Mod(m) => self.module(m, cx),
        _ => {}
      }
    }
  }

  fn module(&mut self, m: ItemMod, cx: &Ctx) {
    let name = m.ident.to_string();
    let group = group_attr(&m.attrs, &name).or_else(|| cx.group.clone());
    let mut module = cx.module.clone();
    module.push(name.clone());
    // generated code lives in a child of the crate root, so modules at
    // depth >= 2 must be pub/pub(crate) to be reachable from it
    let hidden = cx
      .hidden
      .clone()
      .or_else(|| (module.len() >= 2 && !visible(&m.vis)).then(|| module.join("::")));
    let child_dir = cx.child_dir.join(&name);
    let sub = Ctx {
      file: cx.file.clone(),
      module,
      child_dir: child_dir.clone(),
      group,
      hidden,
    };

    match m.content {
      Some((_, items)) => self.items(items, &sub),
      None => {
        if has_group_attr(&m.attrs) {
          panic!(
            "{}: `#[group]` on `mod {name};` can't work, macros can't see into files. \
                         Put `#[command(group_name)]` on each fn inside that file instead.",
            cx.file.display()
          );
        }
        let flat = cx.child_dir.join(format!("{name}.rs"));
        let nested = child_dir.join("mod.rs");
        let file = if flat.exists() {
          flat
        } else if nested.exists() {
          nested
        } else {
          panic!("{}: can't find file for `mod {name};`", cx.file.display())
        };
        self.file(Ctx {
          file,
          group: None,
          ..sub
        });
      }
    }
  }

  fn func(&mut self, f: ItemFn, cx: &Ctx) {
    let Some(attr) = f.attrs.iter().find(|a| is_cmd(a)) else {
      return;
    };
    let name = f.sig.ident.to_string();
    let at = format!("{} (fn {name})", cx.file.display());

    let group = match &attr.meta {
            Meta::Path(_) => cx.group.clone().unwrap_or_else(|| {
                panic!("{at}: `#[command]` needs a group: `#[command(group)]`, or wrap it in an inline `#[group]` module")
            }),
            _ => attr.parse_args::<Ident>().unwrap_or_else(|e| panic!("{at}: {e}")).to_string(),
        };

    // Tauri limitation: a `pub` command at the crate root gets #[macro_export],
    // which breaks. Root commands must be private (`mod groups` can still see
    // them, since it's a child of the root). Everywhere else they must be pub.
    if cx.module.is_empty() {
      if visible(&f.vis) {
        panic!("{at}: commands in lib.rs must NOT be `pub` (Tauri limitation); remove `pub`");
      }
    } else if !visible(&f.vis) {
      panic!(
        "{at}: commands outside lib.rs must be `pub` (or `pub(crate)`) so they can be registered"
      );
    }
    if let Some(m) = &cx.hidden {
      panic!(
        "{at}: module `{m}` is private; make it `pub(crate) mod` so the generated handler can reach it"
      );
    }

    let args = f
      .sig
      .inputs
      .iter()
      .filter_map(|a| {
        let FnArg::Typed(p) = a else { return None };
        if is_injected(&p.ty) {
          return None;
        }
        let Pat::Ident(id) = &*p.pat else { return None };
        Some(Arg {
          // Tauri maps JS camelCase -> Rust snake_case for arg names
          name: camel(&id.ident.to_string()),
          ty: ts_type(&p.ty),
          optional: is_option(&p.ty),
        })
      })
      .collect();
    let ret = match &f.sig.output {
      ReturnType::Default => "void".to_string(),
      ReturnType::Type(_, t) => ts_type(t),
    };
    self.cmds.push(Cmd {
      group,
      name,
      module: cx.module.clone(),
      args,
      ret,
    });
  }
}

fn visible(v: &Visibility) -> bool {
  match v {
    Visibility::Public(_) => true,
    Visibility::Restricted(r) => r.path.is_ident("crate"),
    Visibility::Inherited => false,
  }
}

// `#[command]` or `#[tauri_groups::command]` (not `#[tauri::command]`)
fn is_cmd(a: &Attribute) -> bool {
  let p = a.path();
  p.is_ident("command")
    || (p.segments.len() == 2
      && p.segments[0].ident == "tauri_groups"
      && p.segments[1].ident == "command")
}

fn has_group_attr(attrs: &[Attribute]) -> bool {
  attrs.iter().any(|a| a.path().is_ident("group"))
}

fn group_attr(attrs: &[Attribute], mod_name: &str) -> Option<String> {
  let a = attrs.iter().find(|a| a.path().is_ident("group"))?;
  Some(match &a.meta {
    Meta::Path(_) => mod_name.to_string(),
    _ => a
      .parse_args::<Ident>()
      .unwrap_or_else(|e| panic!("bad #[group(..)]: {e}"))
      .to_string(),
  })
}

fn check_duplicates(cmds: &[Cmd]) {
  let mut seen: BTreeMap<String, String> = BTreeMap::new();
  for c in cmds {
    let wire = format!("{}__{}", c.group, c.name);
    let at = format!("crate::{}", c.module.join("::"));
    if let Some(prev) = seen.insert(wire.clone(), at.clone()) {
      panic!(
        "command `{}.{}` is defined twice ({prev} and {at}); names must be unique within a group",
        c.group, c.name
      );
    }
  }
}

fn rust_handler(cmds: &[Cmd]) -> String {
  let paths: Vec<String> = cmds
    .iter()
    .map(|c| {
      let mut p = vec!["crate".to_string()];
      p.extend(c.module.iter().cloned());
      p.push(format!("{}__{}", c.group, c.name));
      format!("        {}", p.join("::"))
    })
    .collect();
  // Returning the closure as `impl Fn(..)` is what gives Rust its parameter type.
  // Pinned to `Wry` because `tauri::AppHandle` (no type arg) means `AppHandle<Wry>`.
  format!(
    "// WARN: AUTO-GENERATED by build.rs. Do not edit.\n\
         pub fn handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {{\n    \
         tauri::generate_handler![\n{}\n    ]\n}}\n",
    paths.join(",\n")
  )
}

fn ts_file(cmds: &[Cmd]) -> String {
  let mut groups: BTreeMap<&str, Vec<&Cmd>> = BTreeMap::new();
  for c in cmds {
    groups.entry(&c.group).or_default().push(c);
  }
  let mut s = String::from(
    "// WARN: AUTO-GENERATED by src-tauri/build.rs. Do not edit.\n\
         import { invoke } from \"@tauri-apps/api/core\";\n\n\
         export const commands = {\n",
  );
  for (g, list) in groups {
    s += &format!("  {g}: {{\n");
    for c in list {
      let wire = format!("{}__{}", c.group, c.name);
      let name = camel(&c.name);
      if c.args.is_empty() {
        s += &format!("    {name}: () => invoke<{}>(\"{wire}\"),\n", c.ret);
      } else {
        let fields = c
          .args
          .iter()
          .map(|a| format!("{}{}: {}", a.name, if a.optional { "?" } else { "" }, a.ty))
          .collect::<Vec<_>>()
          .join("; ");
        // all-optional args -> the whole object is optional too
        let q = if c.args.iter().all(|a| a.optional) {
          "?"
        } else {
          ""
        };
        s += &format!(
          "    {name}: (args{q}: {{ {fields} }}) => invoke<{}>(\"{wire}\", args),\n",
          c.ret
        );
      }
    }
    s += "  },\n";
  }
  s += "} as const;\n";
  s
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

fn is_option(ty: &Type) -> bool {
  matches!(ty, Type::Path(p) if p.path.segments.last().is_some_and(|s| s.ident == "Option"))
}

fn ts_type(ty: &Type) -> String {
  match ty {
    Type::Reference(r) => ts_type(&r.elem),
    Type::Tuple(t) if t.elems.is_empty() => "void".into(),
    Type::Tuple(t) => format!(
      "[{}]",
      t.elems.iter().map(ts_type).collect::<Vec<_>>().join(", ")
    ),
    Type::Slice(s) => format!("{}[]", paren(ts_type(&s.elem))),
    Type::Array(a) => format!("{}[]", paren(ts_type(&a.elem))),
    Type::Path(p) => {
      let seg = p.path.segments.last().unwrap();
      let g: Vec<String> = match &seg.arguments {
        PathArguments::AngleBracketed(a) => a
          .args
          .iter()
          .filter_map(|x| match x {
            GenericArgument::Type(t) => Some(ts_type(t)),
            _ => None,
          })
          .collect(),
        _ => vec![],
      };
      let arg = |i: usize| g.get(i).cloned().unwrap_or_else(|| "unknown".into());
      match seg.ident.to_string().as_str() {
        "String" | "str" | "char" | "PathBuf" | "Path" => "string".into(),
        "bool" => "boolean".into(),
        "i8" | "i16" | "i32" | "i64" | "isize" | "u8" | "u16" | "u32" | "u64" | "usize" | "f32"
        | "f64" => "number".into(),
        "Vec" | "VecDeque" | "HashSet" | "BTreeSet" => format!("{}[]", paren(arg(0))),
        "Option" => format!("{} | null", arg(0)),
        "Result" | "Box" | "Arc" => arg(0),
        "HashMap" | "BTreeMap" => format!("Record<string, {}>", arg(1)),
        "Value" => "unknown".into(),
        // Custom types: emitted by name. Define/import them in TS
        // (or generate them with ts-rs / specta).
        other => other.to_string(),
      }
    }
    _ => "unknown".into(),
  }
}

fn paren(t: String) -> String {
  if t.contains(' ') { format!("({t})") } else { t }
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

// Don't touch a file if nothing changed (avoids pointless rebuilds / HMR reloads)
fn write_if_changed(path: &Path, s: &str) {
  if fs::read_to_string(path).ok().as_deref() == Some(s) {
    return;
  }
  fs::create_dir_all(path.parent().unwrap()).unwrap();
  fs::write(path, s).unwrap();
}
