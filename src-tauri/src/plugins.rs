//! Book lookup plugins: small `.js` files that fill in a book's details for an ISBN.
//!
//! - Open Library and Google Books are built in (`src-tauri/plugins/*.js`, compiled into the app).
//!   More can be dropped into `<app data>/plugins/`; a plugin there with a built-in's id replaces it.
//! - Plugins run in an embedded QuickJS engine. It has no network or file access of its own.
//! - The only thing a plugin can do is `http.get(url)`. That request is made here, with the same
//!   reqwest client the covers use, after checking the host against the plugin's manifest (again
//!   on every redirect).
//! - What a plugin fills is [`BookInfo`]: one optional field per book property. A plugin fills what
//!   it can and leaves the rest out (or `null`). Each result says what was filled / missing /
//!   invalid / unknown.
//! - `lookup_book` runs every enabled plugin at once, merges what they return and reports the ones
//!   that failed. It's what a scanned barcode goes through.
//! - Plugins can be turned on and off at runtime (`set_plugin_enabled`). The off ones are kept in
//!   the app settings (`settings::PLUGINS_DISABLED`) and survive restarts; lookups skip them.
//! - A plugin's settings (e.g. an API key) are a JSON object saved in `<app data>/plugins/<id>.config.json`.
//!   The Plugins tab edits it (`get_plugin_config` / `set_plugin_config`) and it's handed to the plugin
//!   as its third argument. A plugin that doesn't use settings says `ignoreConfig: true` in its manifest
//!   and always gets `{}`, whatever has been saved.
//!
//! Plugin API, inside the `.js` file (see `src-tauri/plugins/openlibrary.js`):
//!
//! ```js
//! const manifest = { id, name, version, permissions: { http: ["example.com"] },
//!   ignoreConfig: true,                   // optional: never pass settings to this plugin
//!   configExample: { apiKey: "..." } };   // optional: shown as the hint when editing its settings
//! plugin.register((input, http, config) => {  // input = { isbn }. `async` is fine too
//!   const res = http.get(url);                 // { status, ok, body }. No `await` needed
//!   return { title: "..." };                   // any fields of BookInfo
//! });                                          // config = settings such as { apiKey } (see `config_for`)
//! throw new PluginError(code, message) // code: not_found | http | parse | network | result
//! plugin.log(...) / console.log(...)   // shows up in the report's `logs`
//! ```

use std::{
  collections::HashSet,
  path::PathBuf,
  sync::{Arc, Mutex},
  time::{Duration, Instant},
};

use rquickjs::{Context, Ctx, Function, Runtime, Value as JsValue};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager, State};
use tauri_groups::{TsType, command};
use tauri_plugin_fs::{FilePath, FsExt};

use crate::settings::{PLUGINS_DISABLED, Settings};

pub(crate) const DIR_NAME: &str = "plugins";
const LOAD_TIMEOUT: Duration = Duration::from_secs(2);
const RUN_TIMEOUT: Duration = Duration::from_secs(10);
const MEMORY_LIMIT: usize = 32 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const MAX_BODY: usize = 5 * 1024 * 1024;
const MAX_PLUGIN_BYTES: usize = 512 * 1024;

/// Built in. When two plugins fill the same field, the earlier one wins.
const BUILTIN: [(&str, &str); 2] = [
  ("openlibrary.js", include_str!("../plugins/openlibrary.js")),
  ("googlebooks.js", include_str!("../plugins/googlebooks.js")),
];

/// Build-time settings for built-in plugins: (plugin id, setting, value). Set the environment
/// variable when building, e.g. `GOOGLE_BOOKS_API_KEY=... cargo tauri dev`. A key can also be given
/// at runtime in `<app data>/plugins/<id>.config.json` (the Plugins tab writes it), which wins over these.
const BUILTIN_CONFIG: [(&str, &str, Option<&str>); 1] =
  [("googlebooks", "apiKey", option_env!("GOOGLE_BOOKS_API_KEY"))];

// SECTION: the type plugins fill

/// What a plugin may return: one optional field per book property (the same ones the Add Book
/// form has). Add a field here and plugins can fill it, with no other change.
///
/// Keep every field `Option<_>` and don't use `skip_serializing_if`: the list of field names is
/// read from `BookInfo::default()` serialized, and each plugin value is checked by deserializing
/// it into this struct, so serde's own message says what was wrong ("expected i64", ...).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct BookInfo {
  pub title: Option<String>,
  pub isbn: Option<String>,
  /// A full date in any common format ("2004-03-07", "March 7, 2004", "7 Mar 2004"...), turned
  /// into `YYYY-MM-DD`. A bare year or month is rejected: the form and the database need a day.
  pub publish_date: Option<String>,
  pub blurb: Option<String>,
  pub page_count: Option<i64>,
  /// Author names. They're matched against the library when the book is saved.
  pub authors: Option<Vec<String>>,
  /// Tag names (genres, themes). Same matching as authors.
  pub tags: Option<Vec<String>>,
  /// The series' name, without the book's number.
  pub series: Option<String>,
  /// Position in the series (`1`, `2`, `1.5`).
  pub series_position: Option<f64>,
  /// A link to the cover image. It's saved through the covers module.
  pub cover: Option<String>,
}

/// Every `BookInfo` field name as plugins write it (camelCase).
fn field_names() -> Vec<String> {
  match serde_json::to_value(BookInfo::default()) {
    Ok(Value::Object(m)) => m.keys().cloned().collect(),
    _ => vec![],
  }
}

// SECTION: types sent to the frontend

#[derive(Debug, Clone, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
  pub id: String,
  pub name: String,
  pub version: String,
  /// Hostnames the plugin may call.
  pub http: Vec<String>,
  /// Compiled into the app (as opposed to installed from a file).
  pub builtin: bool,
  /// Turned on. Lookups only use enabled plugins.
  pub enabled: bool,
  /// The manifest says this plugin has no settings: whatever is saved for it is never passed on.
  pub ignore_config: bool,
  /// Optional example of the plugin's settings (pretty-printed JSON), shown as a hint in the editor.
  pub config_example: Option<String>,
}

#[derive(Debug, Clone, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct InvalidField {
  pub field: String,
  /// serde's message, e.g. `invalid type: string "abc", expected i64`.
  pub reason: String,
}

/// One plugin's answer.
#[derive(Debug, Clone, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct PluginResult {
  pub plugin: String,
  /// Every field filled and valid.
  pub complete: bool,
  /// The valid fields. Everything else is `null`.
  pub data: BookInfo,
  /// Fields the plugin left out (or returned as null).
  pub missing: Vec<String>,
  /// Fields the plugin returned with the wrong type or an unusable value. Not in `data`.
  pub invalid: Vec<InvalidField>,
  /// Keys the plugin returned that `BookInfo` doesn't have. Usually a typo.
  pub unknown: Vec<String>,
  /// `plugin.log()` output and every HTTP request, in order.
  pub logs: Vec<String>,
}

/// A plugin that couldn't answer.
#[derive(Debug, Clone, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct PluginFailure {
  /// The plugin's display name.
  pub plugin: String,
  /// not_found | load | permission | network | http | parse | result | timeout | crash
  pub stage: String,
  pub message: String,
  /// The whole report (hint, detail, logs). For the console.
  pub report: String,
}

/// What `lookup_book` found.
#[derive(Debug, Clone, Serialize, TsType)]
#[serde(rename_all = "camelCase")]
pub struct LookupOutcome {
  /// Every plugin's answer merged into one. `null` when every plugin failed.
  pub data: Option<BookInfo>,
  /// Names of the plugins that answered.
  pub sources: Vec<String>,
  /// The plugins that didn't. Together with `sources` this covers every installed plugin.
  pub failures: Vec<PluginFailure>,
  /// Smaller problems in answers that were still used (a field with the wrong type, a typo'd key).
  pub warnings: Vec<String>,
}

// SECTION: errors

/// Where something went wrong, plus what's needed to fix it. Never crosses IPC itself:
/// `report()` turns it into the string `PluginError` rejects with.
///
/// stages: not_found | load | permission | network | http | parse | result | timeout | crash
#[derive(Debug)]
pub(crate) struct Failure {
  plugin: String,
  stage: &'static str,
  message: String,
  hint: Option<String>,
  detail: Option<String>,
  logs: Vec<String>,
}

impl Failure {
  fn new(plugin: &str, stage: &'static str, message: impl Into<String>) -> Self {
    Failure {
      plugin: plugin.into(),
      stage,
      message: message.into(),
      hint: None,
      detail: None,
      logs: vec![],
    }
  }

  fn hint(mut self, hint: impl Into<String>) -> Self {
    self.hint = Some(hint.into());
    self
  }

  fn detail(mut self, detail: Option<String>) -> Self {
    self.detail = detail;
    self
  }

  fn logs(mut self, logs: Vec<String>) -> Self {
    self.logs = logs;
    self
  }

  fn report(&self) -> String {
    let mut s = format!("[{}] {}: {}", self.plugin, self.stage, self.message);
    if let Some(h) = &self.hint {
      s += &format!("\n  hint: {h}");
    }
    if let Some(d) = &self.detail {
      s += &format!("\n  detail: {}", d.trim_end().replace('\n', "\n          "));
    }
    if !self.logs.is_empty() {
      s += "\n  logs:";
      for l in &self.logs {
        s += &format!("\n    {l}");
      }
    }
    s
  }

  fn view(&self, name: &str) -> PluginFailure {
    PluginFailure {
      plugin: name.into(),
      stage: self.stage.into(),
      message: self.message.clone(),
      report: self.report(),
    }
  }
}

/// What every `plugins` command rejects with. The frontend just sees a string: the full report.
#[derive(Debug)]
pub struct PluginError(String);

impl From<Failure> for PluginError {
  fn from(f: Failure) -> Self {
    PluginError(f.report())
  }
}

impl Serialize for PluginError {
  fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&self.0)
  }
}

type Res<T> = Result<T, PluginError>;

// SECTION: JS side

const PRELUDE: &str = r#"
(() => {
  class PluginError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  let handler;
  const fmt = (x) => { if (typeof x === "string") return x; try { return JSON.stringify(x); } catch { return String(x); } };
  const http = { get(url) {
    const r = JSON.parse(__get(String(url)));
    if (r.error) throw new PluginError(r.error.code, r.error.message);
    return r;
  } };
  const plugin = {
    register(fn) {
      if (typeof fn !== "function") throw new PluginError("load", "plugin.register() needs a function");
      handler = fn;
    },
    log: (...a) => __log(a.map(fmt).join(" ")),
  };
  const fail = (e) => {
    globalThis.__out = JSON.stringify({ ok: false, code: (e && e.code) || "crash",
      message: String((e && e.message) || e), stack: e && e.stack ? String(e.stack) : undefined });
  };
  Object.assign(globalThis, {
    PluginError, plugin,
    console: { log: plugin.log, warn: plugin.log, error: plugin.log },
    __registered: () => !!handler,
    __start: (input, config) => {
      Promise.resolve()
        .then(() => {
          if (!handler) throw new PluginError("load", "plugin never called plugin.register()");
          return handler(JSON.parse(input), http, JSON.parse(config));
        })
        .then((raw) => { try { globalThis.__out = JSON.stringify({ ok: true, raw }); } catch (e) { fail(e); } }, fail);
    },
  });
})();
"#;

const MANIFEST_JS: &str = "typeof manifest === 'undefined' ? null : JSON.stringify(manifest)";

type Logs = Arc<Mutex<Vec<String>>>;

/// One JS engine with a plugin file loaded. Made fresh for every run, so runs can't affect each other.
struct Session {
  ctx: Context,
  rt: Runtime,
  logs: Logs,
  deadline: Instant,
  manifest_json: Option<String>,
  registered: bool,
}

fn host_fns(
  ctx: &Ctx<'_>,
  logs: Logs,
  hosts: Vec<String>,
  deadline: Instant,
) -> rquickjs::Result<()> {
  let g = ctx.globals();
  let l = logs.clone();
  g.set(
    "__log",
    Function::new(ctx.clone(), move |s: String| {
      l.lock().unwrap().push(s);
    })?,
  )?;
  g.set(
    "__get",
    Function::new(ctx.clone(), move |url: String| {
      http_get(&url, &hosts, deadline, &logs).to_string()
    })?,
  )?;
  Ok(())
}

/// Message and stack of the JS exception that was just thrown.
fn js_msg(ctx: &Ctx<'_>, e: rquickjs::Error) -> (String, Option<String>) {
  if matches!(e, rquickjs::Error::Exception) {
    let v = ctx.catch();
    if let Some(ex) = v.as_exception() {
      return (
        ex.message().unwrap_or_else(|| "exception".into()),
        ex.stack(),
      );
    }
    return (format!("{v:?}"), None);
  }
  (e.to_string(), None)
}

fn boot(
  label: &str,
  code: &str,
  hosts: Vec<String>,
  timeout: Duration,
) -> Result<Session, Failure> {
  let engine_err =
    |e: rquickjs::Error| Failure::new(label, "crash", format!("JS engine error: {e}"));

  let rt = Runtime::new().map_err(engine_err)?;
  rt.set_memory_limit(MEMORY_LIMIT);
  let deadline = Instant::now() + timeout;
  // stops infinite loops in plugin code
  rt.set_interrupt_handler(Some(Box::new(move || Instant::now() > deadline)));
  let ctx = Context::full(&rt).map_err(engine_err)?;
  let logs: Logs = Default::default();

  let loaded = ctx.with(|ctx| -> Result<(Option<String>, bool), Failure> {
    host_fns(&ctx, logs.clone(), hosts, deadline).map_err(engine_err)?;
    ctx.eval::<JsValue, _>(PRELUDE).map_err(engine_err)?;
    ctx.eval::<JsValue, _>(code).map_err(|e| {
      let (msg, stack) = js_msg(&ctx, e);
      Failure::new(label, "load", msg)
        .detail(stack)
        .hint("syntax error, or an exception at the top level of the plugin file (see detail for the line)")
    })?;
    let manifest = ctx.eval::<Option<String>, _>(MANIFEST_JS).map_err(engine_err)?;
    let registered = ctx.eval::<bool, _>("__registered()").map_err(engine_err)?;
    Ok((manifest, registered))
  });

  let (manifest_json, registered) = loaded.map_err(|f| {
    if Instant::now() > deadline {
      Failure::new(label, "load", "plugin took too long to load")
        .hint("top-level code must finish quickly")
    } else {
      f
    }
  })?;

  Ok(Session {
    ctx,
    rt,
    logs,
    deadline,
    manifest_json,
    registered,
  })
}

impl Session {
  fn logs(&self) -> Vec<String> {
    self.logs.lock().unwrap().clone()
  }

  /// Runs the registered handler. Returns the JSON the JS side produced (`None` = it never finished).
  fn call(&self, input: &Value, config: &Value) -> Result<Option<String>, String> {
    self
      .ctx
      .with(|ctx| -> rquickjs::Result<()> {
        let start: Function = ctx.globals().get("__start")?;
        start.call::<_, ()>((input.to_string(), config.to_string()))
      })
      .map_err(|e| e.to_string())?;
    // http.get is synchronous, so draining the job queue is enough to finish async handlers
    while let Ok(true) = self.rt.execute_pending_job() {}
    Ok(self.ctx.with(|ctx| {
      ctx
        .globals()
        .get::<_, Option<String>>("__out")
        .ok()
        .flatten()
    }))
  }
}

// SECTION: http (host side)

fn http_get(url: &str, hosts: &[String], deadline: Instant, logs: &Logs) -> Value {
  let t0 = Instant::now();
  let result = tauri::async_runtime::block_on(fetch(url, hosts, deadline));
  let shown = redact(url);
  let line = match &result {
    Ok(v) => format!(
      "GET {shown} -> {} ({}ms)",
      v["status"],
      t0.elapsed().as_millis()
    ),
    Err((code, msg)) => format!("GET {shown} FAILED {code}: {msg}"),
  };
  logs.lock().unwrap().push(line);
  match result {
    Ok(v) => v,
    Err((code, message)) => json!({ "error": { "code": code, "message": message } }),
  }
}

/// A URL for logs and reports, with API keys and tokens in its query hidden.
fn redact(url: &str) -> String {
  let Ok(mut u) = reqwest::Url::parse(url) else {
    return url.to_string();
  };
  if u.query().is_none() {
    return url.to_string();
  }
  let pairs: Vec<(String, String)> = u
    .query_pairs()
    .map(|(k, v)| {
      let secret = matches!(
        k.to_ascii_lowercase().as_str(),
        "key" | "apikey" | "api_key" | "token" | "access_token"
      );
      (
        k.into_owned(),
        if secret { "***".into() } else { v.into_owned() },
      )
    })
    .collect();
  u.query_pairs_mut().clear().extend_pairs(pairs);
  u.to_string()
}

/// GET with a hostname allowlist. Redirects are followed by hand so every hop is checked too.
async fn fetch(
  start: &str,
  hosts: &[String],
  deadline: Instant,
) -> Result<Value, (&'static str, String)> {
  // without_url: reqwest's message would otherwise repeat the whole URL, API key included
  let net = |e: reqwest::Error| ("network", e.without_url().to_string());

  let client = crate::covers::http_client_builder()
    .redirect(reqwest::redirect::Policy::none())
    .build()
    .map_err(net)?;
  let mut url =
    reqwest::Url::parse(start).map_err(|_| ("network", format!("invalid URL {start:?}")))?;

  for _ in 0..=MAX_REDIRECTS {
    if url.scheme() != "https" {
      return Err((
        "permission",
        format!("only https:// is allowed (got {}://)", url.scheme()),
      ));
    }
    let host = url.host_str().unwrap_or("").to_string();
    if !hosts.contains(&host) {
      let allowed = if hosts.is_empty() {
        "(none: the manifest has no permissions.http)".to_string()
      } else {
        hosts.join(", ")
      };
      return Err((
        "permission",
        format!("not allowed to call {host}. Allowed: {allowed}"),
      ));
    }

    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
      return Err(("network", "ran out of time".into()));
    }
    let mut resp = client
      .get(url.clone())
      .timeout(left)
      .send()
      .await
      .map_err(net)?;
    let status = resp.status();

    if status.is_redirection() {
      let target = resp
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
      if let Some(loc) = target {
        url = url
          .join(&loc)
          .map_err(|_| ("network", format!("bad redirect target {loc:?}")))?;
        continue;
      }
    }

    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(net)? {
      body.extend_from_slice(&chunk);
      if body.len() > MAX_BODY {
        return Err((
          "http",
          format!("response is larger than {} MB", MAX_BODY / 1024 / 1024),
        ));
      }
    }
    return Ok(json!({
      "status": status.as_u16(),
      "ok": status.is_success(),
      "body": String::from_utf8_lossy(&body),
    }));
  }
  Err(("http", "too many redirects".into()))
}

// SECTION: validation

fn parse_manifest(label: &str, raw: Option<&str>, registered: bool) -> Result<PluginInfo, Failure> {
  let bad = |msg: String, hint: &str| {
    let f = Failure::new(label, "load", msg);
    if hint.is_empty() { f } else { f.hint(hint) }
  };
  let v: Value = raw
    .and_then(|s| serde_json::from_str(s).ok())
    .unwrap_or(Value::Null);

  if !v.is_object() {
    return Err(bad(
      "no manifest found".into(),
      "put `const manifest = { id, name, version, permissions }` at the top level of the file",
    ));
  }
  let id = v["id"].as_str().unwrap_or("");
  if id.is_empty()
    || !id
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
  {
    // also what keeps the id safe to use as a file name
    return Err(bad(
      format!("manifest.id {} is invalid", v["id"]),
      "use letters, digits, _ or - only",
    ));
  }
  let name = v["name"]
    .as_str()
    .filter(|s| !s.is_empty())
    .ok_or_else(|| bad("manifest.name is missing".into(), ""))?;
  let version = v["version"]
    .as_str()
    .filter(|s| !s.is_empty())
    .ok_or_else(|| bad("manifest.version is missing".into(), ""))?;

  let mut http = vec![];
  match &v["permissions"]["http"] {
    Value::Null => {}
    Value::Array(items) => {
      for item in items {
        match item.as_str() {
          Some(h) if !h.is_empty() && !h.contains('/') && !h.contains(':') => {
            http.push(h.to_string())
          }
          _ => {
            return Err(bad(
              format!("manifest.permissions.http entry {item} is not a bare hostname"),
              "use just the hostname, e.g. \"openlibrary.org\" (no https:// and no path)",
            ));
          }
        }
      }
    }
    _ => {
      return Err(bad(
        "manifest.permissions.http must be an array".into(),
        "e.g. http: [\"openlibrary.org\"]",
      ));
    }
  }

  let ignore_config = match &v["ignoreConfig"] {
    Value::Null => false,
    Value::Bool(b) => *b,
    _ => {
      return Err(bad(
        "manifest.ignoreConfig must be true or false".into(),
        "or leave it out if the plugin uses settings",
      ));
    }
  };
  let config_example = match &v["configExample"] {
    Value::Null => None,
    Value::Object(_) => serde_json::to_string_pretty(&v["configExample"]).ok(),
    _ => {
      return Err(bad(
        "manifest.configExample must be an object".into(),
        "e.g. configExample: { apiKey: \"your-key\" }",
      ));
    }
  };

  if !registered {
    return Err(bad(
      "plugin never called plugin.register()".into(),
      "add `plugin.register((input, http) => { ... })`",
    ));
  }
  Ok(PluginInfo {
    id: id.into(),
    name: name.into(),
    version: version.into(),
    http,
    builtin: false,
    enabled: true,
    ignore_config,
    config_example,
  })
}

fn describe(v: Option<&Value>) -> String {
  match v {
    None => "undefined".into(),
    Some(Value::Null) => "null".into(),
    Some(Value::Array(_)) => "an array".into(),
    Some(Value::Object(_)) => "an object".into(),
    Some(Value::Bool(b)) => format!("boolean {b}"),
    Some(Value::Number(n)) => format!("number {n}"),
    Some(Value::String(s)) => {
      let short: String = s.chars().take(40).collect();
      format!(
        "string {short:?}{}",
        if s.chars().count() > 40 { "..." } else { "" }
      )
    }
  }
}

/// Sorts what the plugin returned into data / missing / invalid / unknown.
fn shape(plugin: &str, raw: Option<&Value>, logs: Vec<String>) -> Result<PluginResult, Failure> {
  let names = field_names();

  let Some(obj) = raw.and_then(Value::as_object) else {
    return Err(
      Failure::new(
        plugin,
        "result",
        format!("plugin returned {}, expected an object", describe(raw)),
      )
      .hint(format!(
        "return an object with some of: {}",
        names.join(", ")
      ))
      .logs(logs),
    );
  };

  let (mut valid, mut missing, mut invalid) = (Map::new(), vec![], vec![]);
  for name in &names {
    match obj.get(name) {
      None | Some(Value::Null) => missing.push(name.clone()),
      Some(v) => {
        // Check one field at a time: an object holding only it must deserialize into BookInfo
        let probe = Value::Object(Map::from_iter([(name.clone(), v.clone())]));
        match serde_json::from_value::<BookInfo>(probe) {
          Ok(_) => {
            valid.insert(name.clone(), v.clone());
          }
          Err(e) => invalid.push(InvalidField {
            field: name.clone(),
            reason: e.to_string(),
          }),
        }
      }
    }
  }
  let unknown: Vec<String> = obj.keys().filter(|k| !names.contains(k)).cloned().collect();

  // Providers write dates every which way. The form and database want a full YYYY-MM-DD.
  if let Some(Value::String(raw_date)) = valid.get("publishDate").cloned() {
    match crate::filter::parse_full_date(&raw_date) {
      Some(iso) => {
        valid.insert("publishDate".into(), Value::String(iso));
      }
      None => {
        valid.remove("publishDate");
        invalid.push(InvalidField {
          field: "publishDate".into(),
          reason: format!("{raw_date:?} isn't a full date (it needs a year, month and day)"),
        });
      }
    }
  }

  if valid.is_empty() {
    let returned = obj.keys().cloned().collect::<Vec<_>>().join(", ");
    let mut hint = format!(
      "expected some of: {}. The plugin returned: {}",
      names.join(", "),
      if returned.is_empty() {
        "(nothing)"
      } else {
        &returned
      }
    );
    for i in &invalid {
      hint += &format!(". {}: {}", i.field, i.reason);
    }
    return Err(
      Failure::new(plugin, "result", "plugin returned no usable fields")
        .hint(hint)
        .logs(logs),
    );
  }

  let data: BookInfo = serde_json::from_value(Value::Object(valid)).unwrap_or_default();
  let complete = missing.is_empty() && invalid.is_empty();
  Ok(PluginResult {
    plugin: plugin.into(),
    complete,
    data,
    missing,
    invalid,
    unknown,
    logs,
  })
}

/// Turns the JSON the JS side produced into a result (or a failure with the right stage).
fn decode(plugin: &str, s: &Session, out: Option<String>) -> Result<PluginResult, Failure> {
  let logs = s.logs();
  let Some(out) = out else {
    return Err(
      if Instant::now() > s.deadline {
        Failure::new(
          plugin,
          "timeout",
          format!("no result after {}s", RUN_TIMEOUT.as_secs()),
        )
        .hint("an infinite loop, or a request that is too slow")
      } else {
        Failure::new(plugin, "crash", "plugin finished without a result")
          .hint("a promise never resolved: make sure every code path returns or throws")
      }
      .logs(logs),
    );
  };

  let v: Value = serde_json::from_str(&out).unwrap_or(Value::Null);
  if v["ok"] == true {
    return shape(plugin, v.get("raw"), logs);
  }

  let code = v["code"].as_str().unwrap_or("crash");
  let message = v["message"].as_str().unwrap_or("unknown error").to_string();
  let stack = v["stack"].as_str().map(String::from);
  let known = [
    "not_found",
    "http",
    "parse",
    "network",
    "result",
    "permission",
    "load",
  ];

  let f = if let Some(stage) = known.iter().copied().find(|k| *k == code) {
    let f = Failure::new(plugin, stage, message).detail(stack);
    if stage == "permission" {
      f.hint("add the hostname to manifest.permissions.http")
    } else {
      f
    }
  } else if code == "crash" {
    Failure::new(plugin, "crash", message).detail(stack).hint(
      "uncaught exception in the plugin (see detail for the line). If the server's response had \
       an unexpected shape, check for it and `throw new PluginError('parse', '...')`",
    )
  } else {
    Failure::new(
      plugin,
      "crash",
      format!("PluginError with unknown code {code:?}: {message}"),
    )
    .detail(stack)
    .hint(format!("valid codes: {}", known[..5].join(", ")))
  };
  Err(f.logs(logs))
}

// SECTION: merging

/// "J. K. Rowling" and "J.K. Rowling" are the same author.
fn name_key(s: &str) -> String {
  s.chars()
    .filter(|c| c.is_alphanumeric())
    .flat_map(char::to_lowercase)
    .collect()
}

fn same_item(a: &Value, b: &Value) -> bool {
  match (a.as_str(), b.as_str()) {
    (Some(a), Some(b)) => name_key(a) == name_key(b),
    _ => a == b,
  }
}

/// Merges several plugins' answers, given in priority order. For a single value (title, pages,
/// cover...) the first plugin that has one wins. Lists (authors, tags) are combined without repeats.
fn merge<'a>(answers: impl IntoIterator<Item = &'a BookInfo>) -> BookInfo {
  let mut merged = Map::new();
  for answer in answers {
    let Ok(Value::Object(fields)) = serde_json::to_value(answer) else {
      continue;
    };
    for (key, value) in fields {
      if value.is_null() {
        continue;
      }
      match merged.entry(key) {
        serde_json::map::Entry::Vacant(e) => {
          e.insert(value);
        }
        serde_json::map::Entry::Occupied(mut e) => {
          if let (Value::Array(have), Value::Array(more)) = (e.get_mut(), value) {
            for item in more {
              if !have.iter().any(|h| same_item(h, &item)) {
                have.push(item);
              }
            }
          }
        }
      }
    }
  }
  serde_json::from_value(Value::Object(merged)).unwrap_or_default()
}

// SECTION: manager

/// Installed plugins, in priority order. `Arc` so commands can move it
/// onto a thread.
#[derive(Clone)]
pub struct Plugins(Arc<Inner>);

struct Inner {
  /// `<app data dir>/plugins`
  dir: PathBuf,
  loaded: Mutex<Vec<Entry>>,
  /// Holds the ids of the plugins that are turned off (`PLUGINS_DISABLED`). Kept by id, so it
  /// survives a plugin being replaced.
  settings: Settings,
}

struct Entry {
  info: PluginInfo,
  code: String,
}

/// Called once at startup, next to `database::init_db`.
pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
  if app.try_state::<Plugins>().is_some() {
    return Ok(());
  }
  let dir = app.path().app_data_dir()?.join(DIR_NAME);
  std::fs::create_dir_all(&dir)?;

  let settings = app.state::<Settings>().inner().clone();
  let plugins = Plugins::new(dir, settings);
  for f in plugins.reload() {
    eprintln!("plugin not loaded: {}", f.report());
  }
  app.manage(plugins);
  Ok(())
}

impl Plugins {
  fn new(dir: PathBuf, settings: Settings) -> Self {
    Plugins(Arc::new(Inner {
      dir,
      loaded: Mutex::new(Vec::new()),
      settings,
    }))
  }

  /// Ids of the plugins that are turned off.
  fn disabled_ids(&self) -> HashSet<String> {
    self
      .0
      .settings
      .get::<Vec<String>>(PLUGINS_DISABLED)
      .unwrap_or_default()
      .into_iter()
      .collect()
  }

  /// Loads the built-in plugins, then every `<dir>/*.js` (by file name). A file with a built-in's id
  /// takes its place. Returns what failed to load.
  fn reload(&self) -> Vec<Failure> {
    self.0.loaded.lock().unwrap().clear();
    let mut failures = self.load_builtin();

    let Ok(entries) = std::fs::read_dir(&self.0.dir) else {
      return failures;
    };
    let mut files: Vec<_> = entries
      .flatten()
      .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("js"))
      .collect();
    files.sort_by_key(|e| e.file_name());
    for entry in files {
      let file = entry.file_name().to_string_lossy().into_owned();
      match std::fs::read_to_string(entry.path()) {
        Ok(code) => {
          if let Err(f) = self.add(&file, &code, false) {
            failures.push(f);
          }
        }
        Err(e) => failures.push(Failure::new(&file, "load", e.to_string())),
      }
    }
    failures
  }

  /// Re-reads every plugin file (after a backup was imported). Failures are only logged, like at startup.
  pub(crate) fn reload_all(&self) {
    for f in self.reload() {
      eprintln!("plugin not loaded: {}", f.report());
    }
  }

  fn load_builtin(&self) -> Vec<Failure> {
    BUILTIN
      .iter()
      .filter_map(|(file, code)| self.add(file, code, true).err())
      .collect()
  }

  /// Checks the file, saves it as `<id>.js` and enables it. A plugin with the same id is replaced.
  fn install(&self, code: &str) -> Result<PluginInfo, Failure> {
    let mut info = self.add("(new plugin)", code, false)?;
    std::fs::create_dir_all(&self.0.dir)
      .and_then(|_| std::fs::write(self.0.dir.join(format!("{}.js", info.id)), code))
      .map_err(|e| Failure::new(&info.id, "load", format!("couldn't save the plugin: {e}")))?;
    // installing a plugin is asking for it, so it comes in turned on
    if self.disabled_ids().contains(&info.id) {
      self.set_enabled(&info.id, true)?;
    }
    info.enabled = true;
    Ok(info)
  }

  /// Turns a plugin on or off. Saved, so it stays that way after a restart.
  fn set_enabled(&self, id: &str, enabled: bool) -> Result<(), Failure> {
    if !self.list().iter().any(|p| p.id == id) {
      return Err(self.not_found(id));
    }
    let mut ids = self.disabled_ids();
    if enabled {
      ids.remove(id);
    } else {
      ids.insert(id.to_string());
    }
    let mut ids: Vec<_> = ids.into_iter().collect();
    ids.sort();
    self
      .0
      .settings
      .set(PLUGINS_DISABLED, json!(ids))
      .map_err(|e| Failure::new(id, "load", format!("couldn't save the setting: {e}")))
  }

  /// Deletes an installed plugin. If it replaced a built-in one, the built-in comes back.
  fn remove(&self, id: &str) -> Result<(), Failure> {
    // (the lock is released at the end of this statement; `not_found` takes it again)
    let found = self
      .0
      .loaded
      .lock()
      .unwrap()
      .iter()
      .find(|e| e.info.id == id)
      .map(|e| e.info.builtin);
    let Some(builtin) = found else {
      return Err(self.not_found(id));
    };
    if builtin {
      return Err(
        Failure::new(id, "load", "built-in plugins can't be removed")
          .hint("install a plugin with the same id to replace it"),
      );
    }
    // the id is `[A-Za-z0-9_-]+`, so this is a plain file name
    match std::fs::remove_file(self.0.dir.join(format!("{id}.js"))) {
      Ok(()) => {}
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
      Err(e) => {
        return Err(Failure::new(
          id,
          "load",
          format!("couldn't delete the plugin file: {e}"),
        ));
      }
    }
    for f in self.reload() {
      eprintln!("plugin not loaded: {}", f.report());
    }
    Ok(())
  }

  fn list(&self) -> Vec<PluginInfo> {
    let disabled = self.disabled_ids();
    let loaded = self.0.loaded.lock().unwrap();
    loaded
      .iter()
      .map(|e| PluginInfo {
        enabled: !disabled.contains(&e.info.id),
        ..e.info.clone()
      })
      .collect()
  }

  fn run(&self, id: &str, input: Value) -> Result<PluginResult, Failure> {
    let found = self
      .0
      .loaded
      .lock()
      .unwrap()
      .iter()
      .find(|e| e.info.id == id)
      .map(|e| (e.info.http.clone(), e.code.clone(), e.info.ignore_config));
    let Some((http, code, ignore_config)) = found else {
      return Err(self.not_found(id));
    };
    // a plugin that says it has no settings never sees any (and a broken file can't fail it)
    let config = if ignore_config {
      Value::Object(Map::new())
    } else {
      self.config_for(id)?
    };
    let session = boot(id, &code, http, RUN_TIMEOUT)?;
    match session.call(&input, &config) {
      Ok(out) => decode(id, &session, out),
      Err(e) => Err(Failure::new(id, "crash", e).logs(session.logs())),
    }
  }

  /// Settings handed to a plugin as its third argument: its build-time values (`BUILTIN_CONFIG`),
  /// plus `<dir>/<id>.config.json` if that exists (it wins). Always an object.
  fn config_for(&self, id: &str) -> Result<Value, Failure> {
    let mut config = Map::new();
    for (plugin, key, value) in BUILTIN_CONFIG {
      if let (true, Some(v)) = (plugin == id, value.filter(|v| !v.is_empty())) {
        config.insert(key.to_string(), Value::String(v.to_string()));
      }
    }

    let path = self.0.dir.join(format!("{id}.config.json"));
    match std::fs::read_to_string(&path) {
      Ok(text) => match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(file)) => config.extend(file),
        _ => {
          return Err(
            Failure::new(
              id,
              "load",
              format!("{} isn't a JSON object", path.display()),
            )
            .hint("it should look like { \"apiKey\": \"...\" }"),
          );
        }
      },
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
      Err(e) => {
        return Err(Failure::new(
          id,
          "load",
          format!("couldn't read {}: {e}", path.display()),
        ));
      }
    }
    Ok(Value::Object(config))
  }

  /// Load-time check: runs the file once (handler NOT called, no network allowed) and validates the
  /// manifest. A plugin with the same id is replaced where it was, so priorities stay put.
  fn add(&self, label: &str, code: &str, builtin: bool) -> Result<PluginInfo, Failure> {
    let s = boot(label, code, vec![], LOAD_TIMEOUT)?;
    let mut info = parse_manifest(label, s.manifest_json.as_deref(), s.registered)?;
    info.builtin = builtin;

    let entry = Entry {
      info: info.clone(),
      code: code.to_string(),
    };
    let mut loaded = self.0.loaded.lock().unwrap();
    match loaded.iter_mut().find(|e| e.info.id == info.id) {
      Some(slot) => *slot = entry,
      None => loaded.push(entry),
    }
    Ok(info)
  }

  /// `<dir>/<id>.config.json`. Only call this for an id that is a loaded plugin: those are limited
  /// to `[A-Za-z0-9_-]+` (see `parse_manifest`), so this is a plain file name.
  fn config_path(&self, id: &str) -> PathBuf {
    self.0.dir.join(format!("{id}.config.json"))
  }

  /// The saved settings exactly as written (so the editor shows what the user typed), or an empty
  /// string when there are none. Doesn't include build-time values from `BUILTIN_CONFIG`.
  fn read_config(&self, id: &str) -> Result<String, Failure> {
    if !self.list().iter().any(|p| p.id == id) {
      return Err(self.not_found(id));
    }
    let path = self.config_path(id);
    match std::fs::read_to_string(&path) {
      Ok(text) => Ok(text),
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
      Err(e) => Err(Failure::new(
        id,
        "load",
        format!("couldn't read {}: {e}", path.display()),
      )),
    }
  }

  /// Saves the settings. Blank text removes them. Anything else must be a JSON object, so a typo is
  /// refused here instead of surfacing later as a failed lookup.
  fn write_config(&self, id: &str, text: &str) -> Result<(), Failure> {
    if !self.list().iter().any(|p| p.id == id) {
      return Err(self.not_found(id));
    }
    let path = self.config_path(id);
    let failed = |e: std::io::Error| {
      Failure::new(id, "load", format!("couldn't save {}: {e}", path.display()))
    };

    if text.trim().is_empty() {
      return match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(failed(e)),
      };
    }
    match serde_json::from_str::<Value>(text) {
      Ok(Value::Object(_)) => {}
      Ok(_) => {
        return Err(
          Failure::new(id, "parse", "the settings must be a JSON object")
            .hint("it should look like { \"apiKey\": \"...\" }"),
        );
      }
      Err(e) => {
        return Err(Failure::new(
          id,
          "parse",
          format!("the settings aren't valid JSON: {e}"),
        ));
      }
    }
    std::fs::create_dir_all(&self.0.dir)
      .and_then(|_| std::fs::write(&path, text))
      .map_err(failed)
  }

  fn not_found(&self, id: &str) -> Failure {
    let ids: Vec<_> = self.list().into_iter().map(|p| p.id).collect();
    let hint = if ids.is_empty() {
      "no plugins are installed".to_string()
    } else {
      format!("installed: {}", ids.join(", "))
    };
    Failure::new(id, "not_found", format!("no plugin with id \"{id}\"")).hint(hint)
  }
}

// SECTION: lookup

/// Runs every enabled plugin for `isbn` at once (so it takes as long as the slowest one), then
/// merges the answers in priority order. Plugins that fail are listed in `failures`; if all of them fail,
/// `data` is `None`.
async fn lookup(plugins: &Plugins, isbn: &str) -> Res<LookupOutcome> {
  let all = plugins.list();
  if all.is_empty() {
    return Err(PluginError("No lookup plugins are installed".into()));
  }
  let list: Vec<PluginInfo> = all.into_iter().filter(|p| p.enabled).collect();
  if list.is_empty() {
    return Err(PluginError(
      "Every lookup plugin is turned off. Turn one on in Settings".into(),
    ));
  }

  let handles: Vec<_> = list
    .iter()
    .map(|info| {
      let (p, id) = (plugins.clone(), info.id.clone());
      let input = json!({ "isbn": isbn });
      tauri::async_runtime::spawn_blocking(move || p.run(&id, input))
    })
    .collect();

  let (mut answers, mut sources, mut failures, mut warnings) = (vec![], vec![], vec![], vec![]);
  for (info, handle) in list.iter().zip(handles) {
    match handle.await {
      Ok(Ok(r)) => {
        for i in &r.invalid {
          warnings.push(format!("{}: {}: {}", info.name, i.field, i.reason));
        }
        if !r.unknown.is_empty() {
          warnings.push(format!(
            "{}: ignored unknown fields {}",
            info.name,
            r.unknown.join(", ")
          ));
        }
        sources.push(info.name.clone());
        answers.push(r.data);
      }
      Ok(Err(f)) => failures.push(f.view(&info.name)),
      Err(e) => failures
        .push(Failure::new(&info.id, "crash", format!("plugin task failed: {e}")).view(&info.name)),
    }
  }

  let data = if answers.is_empty() {
    None
  } else {
    Some(merge(&answers))
  };
  Ok(LookupOutcome {
    data,
    sources,
    failures,
    warnings,
  })
}

// SECTION: commands

/// QuickJS and the HTTP wait run on a worker thread so the app never freezes. A panic in there
/// comes back as an error instead of a promise that never settles.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Res<T> {
  tauri::async_runtime::spawn_blocking(f)
    .await
    .map_err(|e| PluginError(format!("plugin task failed: {e}")))
}

/// Reads a plugin file from a path or an Android `content://` URI (what the file picker returns).
fn read_source(app: &AppHandle, source: &str) -> Res<String> {
  let path: FilePath = source
    .trim()
    .parse()
    .expect("FilePath::from_str is infallible");
  let bytes = app
    .fs()
    .read(path)
    .map_err(|e| PluginError(format!("couldn't read {source}: {e}")))?;
  if bytes.len() > MAX_PLUGIN_BYTES {
    return Err(PluginError(format!(
      "plugin file is larger than {} KB",
      MAX_PLUGIN_BYTES / 1024
    )));
  }
  String::from_utf8(bytes).map_err(|_| PluginError("plugin file isn't UTF-8 text".into()))
}

/// Asks every enabled plugin about `isbn` and merges the answers. Resolves even when some (or all)
/// plugins failed: look at `data` (null = nothing found) and `failures`. Rejects only when there is
/// no plugin to ask (none installed, or all turned off).
#[command(plugins)]
async fn lookup_book(plugins: State<'_, Plugins>, isbn: String) -> Res<LookupOutcome> {
  lookup(plugins.inner(), &isbn).await
}

/// Installed plugins, in priority order (built-in ones first), each with whether it's turned on.
#[command(plugins)]
fn list_plugins(plugins: State<'_, Plugins>) -> Res<Vec<PluginInfo>> {
  Ok(plugins.list())
}

/// Installs the plugin file at `source` (file path or Android content URI). It's checked first,
/// and a plugin with the same id (built-in ones too) is replaced.
#[command(plugins)]
async fn install_plugin(
  app: AppHandle,
  plugins: State<'_, Plugins>,
  source: String,
) -> Res<PluginInfo> {
  let code = read_source(&app, &source)?;
  let p = plugins.inner().clone();
  Ok(blocking(move || p.install(&code)).await??)
}

/// Turns a plugin on or off. Off plugins are skipped by `lookup_book` (but `run_plugin` can still
/// run them, for debugging). The setting is saved and survives restarts.
#[command(plugins)]
async fn set_plugin_enabled(plugins: State<'_, Plugins>, id: String, enabled: bool) -> Res<()> {
  Ok(plugins.set_enabled(&id, enabled)?)
}

/// The plugin's saved settings as the text the user wrote (empty when there are none). A JSON
/// object such as `{ "apiKey": "..." }`, kept in `<app data>/plugins/<id>.config.json`.
#[command(plugins)]
fn get_plugin_config(plugins: State<'_, Plugins>, id: String) -> Res<String> {
  Ok(plugins.read_config(&id)?)
}

/// Saves the plugin's settings. Blank removes them; anything else must be a JSON object. They take
/// effect on the next lookup, unless the plugin's manifest says `ignoreConfig`.
#[command(plugins)]
fn set_plugin_config(plugins: State<'_, Plugins>, id: String, config: String) -> Res<()> {
  Ok(plugins.write_config(&id, &config)?)
}

/// Deletes an installed plugin. Built-in ones can't be removed (installing one with the same id
/// replaces them, and removing that brings the built-in back).
#[command(plugins)]
async fn remove_plugin(plugins: State<'_, Plugins>, id: String) -> Res<()> {
  let p = plugins.inner().clone();
  Ok(blocking(move || p.remove(&id)).await??)
}

/// Runs one plugin. `input` is whatever the plugin expects, e.g. `{ isbn: "9780140328721" }`.
/// Rejects with a report if the plugin fails. Meant for writing and debugging a plugin.
#[command(plugins)]
async fn run_plugin(plugins: State<'_, Plugins>, id: String, input: Value) -> Res<PluginResult> {
  let p = plugins.inner().clone();
  Ok(blocking(move || p.run(&id, input)).await??)
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Where a test's settings file lives: next to its plugins folder, like in the real app.
  fn settings_file(p: &Plugins) -> PathBuf {
    p.0.dir.parent().unwrap().join("settings.json")
  }

  /// A fresh app data folder per call, so files one test writes (config, settings) can't affect another.
  fn empty() -> Plugins {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let root =
      std::env::temp_dir().join(format!("free-lib-plugin-tests-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    Plugins::new(
      root.join(DIR_NAME),
      Settings::open(root.join("settings.json")),
    )
  }

  fn loaded(code: &str) -> Plugins {
    let p = empty();
    p.add("test.js", code, false).unwrap();
    p
  }

  /// A plugin that answers with the given JS object literal.
  fn answering(id: &str, name: &str, body: &str) -> String {
    format!(
      r#"const manifest = {{ id: "{id}", name: "{name}", version: "1" }};
         plugin.register(() => ({body}));"#
    )
  }

  fn failing(id: &str, name: &str, code: &str, message: &str) -> String {
    format!(
      r#"const manifest = {{ id: "{id}", name: "{name}", version: "1" }};
         plugin.register(() => {{ throw new PluginError("{code}", "{message}"); }});"#
    )
  }

  const MIXED: &str = r#"
    const manifest = { id: "t", name: "T", version: "1" };
    plugin.register(async () => ({
      title: "Matilda", pageCount: 240, authors: ["Roald Dahl"],
      pages: 1,            // typo: unknown
      series: 5,           // wrong type
      blurb: null,         // same as missing
    }));
  "#;

  #[test]
  fn sorts_fields_into_data_missing_invalid_unknown() {
    let r = loaded(MIXED).run("t", json!({})).unwrap();
    assert_eq!(r.data.title.as_deref(), Some("Matilda"));
    assert_eq!(r.data.page_count, Some(240));
    assert_eq!(r.data.authors, Some(vec!["Roald Dahl".to_string()]));
    assert_eq!(r.data.series, None);
    assert_eq!(r.unknown, ["pages"]);
    assert_eq!(r.invalid.len(), 1);
    assert_eq!(r.invalid[0].field, "series");
    assert!(r.missing.contains(&"blurb".to_string()));
    assert!(!r.complete);
  }

  #[test]
  fn dates_are_turned_into_iso_or_rejected() {
    let date = |text: &str| {
      let p = loaded(&answering(
        "d",
        "D",
        &format!(r#"{{ title: "x", publishDate: "{text}" }}"#),
      ));
      p.run("d", json!({})).unwrap()
    };
    assert_eq!(
      date("March 7, 2004").data.publish_date.as_deref(),
      Some("2004-03-07")
    );
    assert_eq!(
      date("2004-03-07").data.publish_date.as_deref(),
      Some("2004-03-07")
    );
    assert_eq!(
      date("7 Mar 2004").data.publish_date.as_deref(),
      Some("2004-03-07")
    );
    for partial in ["1997", "March 1997", "nonsense"] {
      let r = date(partial);
      assert_eq!(r.data.publish_date, None, "{partial}");
      assert_eq!(r.invalid[0].field, "publishDate", "{partial}");
    }
  }

  #[test]
  fn sync_handlers_work_too() {
    let p = loaded(
      r#"const manifest = { id: "s", name: "S", version: "1" };
         plugin.register((input) => ({ title: input.isbn }));"#,
    );
    let r = p.run("s", json!({ "isbn": "123" })).unwrap();
    assert_eq!(r.data.title.as_deref(), Some("123"));
  }

  #[test]
  fn plugin_error_keeps_its_stage_and_logs() {
    let p = loaded(
      r#"const manifest = { id: "e", name: "E", version: "1" };
         plugin.register(() => { plugin.log("looking"); throw new PluginError("not_found", "no such book"); });"#,
    );
    let f = p.run("e", json!({})).unwrap_err();
    assert_eq!(f.stage, "not_found");
    assert_eq!(f.logs, ["looking"]);
    assert!(f.report().contains("[e] not_found: no such book"));
  }

  #[test]
  fn uncaught_exception_is_a_crash_with_a_stack() {
    let p = loaded(
      r#"const manifest = { id: "c", name: "C", version: "1" };
         plugin.register(() => { return undefined.x; });"#,
    );
    let f = p.run("c", json!({})).unwrap_err();
    assert_eq!(f.stage, "crash");
    assert!(f.detail.is_some());
  }

  #[test]
  fn http_to_a_host_outside_the_manifest_is_a_permission_error() {
    let p = loaded(
      r#"const manifest = { id: "h", name: "H", version: "1", permissions: { http: ["a.example"] } };
         plugin.register((i, http) => http.get("https://b.example/x"));"#,
    );
    let f = p.run("h", json!({})).unwrap_err();
    assert_eq!(f.stage, "permission");
    assert!(f.message.contains("b.example"));
    assert!(f.message.contains("a.example"));
  }

  #[test]
  fn returning_a_non_object_is_a_result_error() {
    let p = loaded(
      r#"const manifest = { id: "n", name: "N", version: "1" };
         plugin.register(() => "oops");"#,
    );
    assert_eq!(p.run("n", json!({})).unwrap_err().stage, "result");
  }

  #[test]
  fn load_problems_are_specific() {
    let p = empty();
    let syntax = p.add("a.js", "const manifest = {;", false).unwrap_err();
    assert_eq!(syntax.stage, "load");
    let no_manifest = p
      .add("b.js", "plugin.register(() => ({}));", false)
      .unwrap_err();
    assert!(no_manifest.message.contains("no manifest"));
    let no_register = p
      .add(
        "c.js",
        r#"const manifest = { id: "x", name: "X", version: "1" };"#,
        false,
      )
      .unwrap_err();
    assert!(no_register.message.contains("register"));
    let bad_host = p
      .add(
        "d.js",
        r#"const manifest = { id: "x", name: "X", version: "1", permissions: { http: ["https://a.example"] } };
           plugin.register(() => ({}));"#,
        false,
      )
      .unwrap_err();
    assert!(bad_host.message.contains("bare hostname"));
  }

  #[test]
  fn field_names_come_from_the_struct() {
    let names = field_names();
    for n in [
      "title",
      "isbn",
      "publishDate",
      "blurb",
      "pageCount",
      "authors",
      "tags",
      "series",
      "seriesPosition",
      "cover",
    ] {
      assert!(names.contains(&n.to_string()), "{n}");
    }
    assert_eq!(names.len(), 10);
  }

  fn with_config_file(id: &str, contents: &str) -> Plugins {
    let p = empty();
    std::fs::create_dir_all(&p.0.dir).unwrap();
    std::fs::write(p.0.dir.join(format!("{id}.config.json")), contents).unwrap();
    p
  }

  const SHOW_CONFIG: &str = r#"
    const manifest = { id: "ID", name: "N", version: "1" };
    plugin.register((input, http, config) => ({ title: JSON.stringify(config) }));
  "#;

  #[test]
  fn a_config_file_reaches_the_plugin_as_its_third_argument() {
    let p = with_config_file("cfg-file", r#"{ "apiKey": "abc" }"#);
    p.add("t.js", &SHOW_CONFIG.replace("ID", "cfg-file"), false)
      .unwrap();
    let r = p.run("cfg-file", json!({})).unwrap();
    assert_eq!(r.data.title.as_deref(), Some(r#"{"apiKey":"abc"}"#));
  }

  #[test]
  fn config_is_an_empty_object_when_there_is_no_file() {
    let p = empty();
    p.add("t.js", &SHOW_CONFIG.replace("ID", "cfg-none"), false)
      .unwrap();
    assert_eq!(
      p.run("cfg-none", json!({})).unwrap().data.title.as_deref(),
      Some("{}")
    );
  }

  #[test]
  fn a_broken_config_file_is_a_load_failure_that_says_so() {
    let p = with_config_file("cfg-bad", "not json");
    p.add("t.js", &SHOW_CONFIG.replace("ID", "cfg-bad"), false)
      .unwrap();
    let f = p.run("cfg-bad", json!({})).unwrap_err();
    assert_eq!(f.stage, "load");
    assert!(f.message.contains("cfg-bad.config.json"));
  }

  const IGNORES_CONFIG: &str = r#"
    const manifest = { id: "ID", name: "N", version: "1", ignoreConfig: true };
    plugin.register((input, http, config) => ({ title: JSON.stringify(config) }));
  "#;

  #[test]
  fn a_plugin_that_ignores_config_always_gets_an_empty_object() {
    // even a broken file doesn't matter: it's never read
    let p = with_config_file("cfg-ignored", "not json");
    p.add("t.js", &IGNORES_CONFIG.replace("ID", "cfg-ignored"), false)
      .unwrap();
    assert!(p.list()[0].ignore_config);
    assert_eq!(
      p.run("cfg-ignored", json!({}))
        .unwrap()
        .data
        .title
        .as_deref(),
      Some("{}")
    );
  }

  #[test]
  fn ignore_config_must_be_a_boolean() {
    let code = IGNORES_CONFIG
      .replace("ID", "cfg-type")
      .replace("ignoreConfig: true", "ignoreConfig: \"yes\"");
    assert!(
      empty()
        .add("t.js", &code, false)
        .unwrap_err()
        .message
        .contains("ignoreConfig")
    );
  }

  #[test]
  fn config_example_is_pretty_printed_for_the_editor() {
    let code = SHOW_CONFIG.replace("ID", "cfg-example").replace(
      "version: \"1\"",
      "version: \"1\", configExample: { apiKey: \"abc\" }",
    );
    let p = empty();
    let info = p.add("t.js", &code, false).unwrap();
    assert_eq!(
      info.config_example.as_deref(),
      Some("{\n  \"apiKey\": \"abc\"\n}")
    );
    assert!(!info.ignore_config);
  }

  #[test]
  fn saved_settings_are_read_back_as_written_and_reach_the_plugin() {
    let p = empty();
    p.add("t.js", &SHOW_CONFIG.replace("ID", "cfg-save"), false)
      .unwrap();
    assert_eq!(p.read_config("cfg-save").unwrap(), "");

    let text = "{\n  \"apiKey\": \"abc\"\n}";
    p.write_config("cfg-save", text).unwrap();
    assert_eq!(p.read_config("cfg-save").unwrap(), text);
    assert_eq!(
      p.run("cfg-save", json!({})).unwrap().data.title.as_deref(),
      Some(r#"{"apiKey":"abc"}"#)
    );

    p.write_config("cfg-save", "  \n").unwrap(); // blank = no settings
    assert_eq!(p.read_config("cfg-save").unwrap(), "");
    assert_eq!(
      p.run("cfg-save", json!({})).unwrap().data.title.as_deref(),
      Some("{}")
    );
  }

  #[test]
  fn settings_that_are_not_a_json_object_are_refused_and_nothing_is_written() {
    let p = empty();
    p.add("t.js", &SHOW_CONFIG.replace("ID", "cfg-refuse"), false)
      .unwrap();
    for bad in ["not json", "[1, 2]", "\"abc\"", "{ \"apiKey\": "] {
      assert_eq!(
        p.write_config("cfg-refuse", bad).unwrap_err().stage,
        "parse",
        "{bad}"
      );
    }
    assert_eq!(p.read_config("cfg-refuse").unwrap(), "");
  }

  #[test]
  fn settings_of_an_unknown_plugin_are_refused() {
    let p = empty();
    assert_eq!(p.read_config("nope").unwrap_err().stage, "not_found");
    assert_eq!(
      p.write_config("../evil", "{}").unwrap_err().stage,
      "not_found"
    );
  }

  #[test]
  fn api_keys_are_hidden_in_logs() {
    let shown =
      redact("https://www.googleapis.com/books/v1/volumes?q=isbn:123&maxResults=1&key=SECRET123");
    assert!(!shown.contains("SECRET123"), "{shown}");
    assert!(shown.contains("key=***"), "{shown}");
    assert!(shown.contains("maxResults=1"), "{shown}");
    assert_eq!(
      redact("https://openlibrary.org/isbn/1.json"),
      "https://openlibrary.org/isbn/1.json"
    );
  }

  fn two_plugins() -> Plugins {
    let p = empty();
    p.add(
      "a.js",
      &answering("a", "Plugin A", r#"{ title: "From A", pageCount: 1 }"#),
      false,
    )
    .unwrap();
    p.add(
      "b.js",
      &answering("b", "Plugin B", r#"{ title: "From B", blurb: "B blurb" }"#),
      false,
    )
    .unwrap();
    p
  }

  fn enabled_ids(p: &Plugins) -> Vec<String> {
    p.list()
      .into_iter()
      .filter(|i| i.enabled)
      .map(|i| i.id)
      .collect()
  }

  #[test]
  fn plugins_start_enabled_and_can_be_turned_off_and_on() {
    let p = two_plugins();
    assert_eq!(enabled_ids(&p), ["a", "b"]);
    p.set_enabled("a", false).unwrap();
    assert_eq!(enabled_ids(&p), ["b"]);
    assert!(!p.list()[0].enabled);
    p.set_enabled("a", true).unwrap();
    assert_eq!(enabled_ids(&p), ["a", "b"]);
  }

  #[test]
  fn lookup_skips_disabled_plugins() {
    let p = two_plugins();
    p.set_enabled("a", false).unwrap();
    let out = tauri::async_runtime::block_on(lookup(&p, "9780747532743")).unwrap();
    let data = out.data.unwrap();
    assert_eq!(data.title.as_deref(), Some("From B")); // A would have won if it had run
    assert_eq!(data.page_count, None);
    assert_eq!(out.sources, ["Plugin B"]);
    assert!(out.failures.is_empty()); // switched off is not a failure
  }

  #[test]
  fn lookup_with_every_plugin_off_says_so() {
    let p = two_plugins();
    p.set_enabled("a", false).unwrap();
    p.set_enabled("b", false).unwrap();
    let err = tauri::async_runtime::block_on(lookup(&p, "9780747532743")).unwrap_err();
    assert!(err.0.contains("turned off"), "{}", err.0);
  }

  #[test]
  fn a_disabled_plugin_can_still_be_run_by_id_for_debugging() {
    let p = two_plugins();
    p.set_enabled("a", false).unwrap();
    assert_eq!(
      p.run("a", json!({})).unwrap().data.title.as_deref(),
      Some("From A")
    );
  }

  #[test]
  fn the_setting_survives_a_reload_and_a_restart() {
    let p = empty();
    p.install(&answering("a", "Plugin A", "{ title: 'x' }"))
      .unwrap();
    p.install(&answering("b", "Plugin B", "{ title: 'x' }"))
      .unwrap();
    p.set_enabled("b", false).unwrap();

    // reload clears everything and reads the plugin files again: "b" comes back, still off
    p.reload();
    assert!(p.list().iter().any(|i| i.id == "b" && !i.enabled));
    assert!(p.list().iter().any(|i| i.id == "a" && i.enabled));

    // a new process on the same folder reads the setting back too
    let restarted = Plugins::new(p.0.dir.clone(), Settings::open(settings_file(&p)));
    restarted.reload();
    assert!(restarted.list().iter().any(|i| i.id == "b" && !i.enabled));
    assert!(restarted.list().iter().any(|i| i.id == "a" && i.enabled));
  }

  #[test]
  fn turning_off_an_unknown_plugin_is_not_found() {
    let p = two_plugins();
    let f = p.set_enabled("nope", false).unwrap_err();
    assert_eq!(f.stage, "not_found");
    assert!(f.hint.unwrap().contains("a, b"));
  }

  #[test]
  fn installing_a_plugin_turns_it_on() {
    let p = two_plugins();
    p.set_enabled("a", false).unwrap();
    let info = p
      .install(&answering("a", "Plugin A", "{ title: 'new' }"))
      .unwrap();
    assert!(info.enabled);
    assert_eq!(enabled_ids(&p), ["a", "b"]);
    assert!(p.disabled_ids().is_empty());
  }

  #[test]
  fn builtin_plugins_load_in_priority_order() {
    let p = empty();
    assert!(p.load_builtin().is_empty());
    let list = p.list();
    let ids: Vec<_> = list.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(ids, ["openlibrary", "googlebooks"]);
    assert!(list.iter().all(|i| i.builtin && i.enabled));
    assert_eq!(list[0].http, ["openlibrary.org"]);
    assert_eq!(list[1].http, ["www.googleapis.com"]);
  }

  #[test]
  fn an_installed_plugin_replaces_a_builtin_in_place() {
    let p = empty();
    p.load_builtin();
    p.add(
      "mine.js",
      &answering("openlibrary", "Mine", r#"{ title: "x" }"#),
      false,
    )
    .unwrap();
    let list = p.list();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].name, "Mine");
    assert!(!list[0].builtin);
    assert_eq!(list[1].id, "googlebooks");
  }

  fn info(json: Value) -> BookInfo {
    serde_json::from_value(json).unwrap()
  }

  #[test]
  fn merge_first_plugin_wins_for_single_values() {
    let m = merge(&[
      info(json!({ "title": "A", "pageCount": 100 })),
      info(
        json!({ "title": "B", "pageCount": 200, "blurb": "from B", "cover": "https://x/b.jpg" }),
      ),
      info(
        json!({ "blurb": "from C", "cover": "https://x/c.jpg", "series": "S", "seriesPosition": 2.0 }),
      ),
    ]);
    assert_eq!(m.title.as_deref(), Some("A"));
    assert_eq!(m.page_count, Some(100));
    assert_eq!(m.blurb.as_deref(), Some("from B"));
    assert_eq!(m.cover.as_deref(), Some("https://x/b.jpg"));
    assert_eq!(m.series.as_deref(), Some("S"));
    assert_eq!(m.series_position, Some(2.0));
    assert_eq!(m.isbn, None);
  }

  #[test]
  fn merge_combines_lists_without_repeats() {
    let m = merge(&[
      info(json!({ "authors": ["J. K. Rowling"], "tags": ["Fantasy", "Magic"] })),
      info(json!({ "authors": ["J.K. Rowling", "Mary GrandPré"], "tags": ["fantasy", "Schools"] })),
    ]);
    assert_eq!(
      m.authors,
      Some(vec![
        "J. K. Rowling".to_string(),
        "Mary GrandPré".to_string()
      ])
    );
    assert_eq!(
      m.tags,
      Some(vec![
        "Fantasy".to_string(),
        "Magic".to_string(),
        "Schools".to_string()
      ])
    );
  }

  #[test]
  fn merge_of_nothing_is_empty() {
    let m = merge(&[]);
    assert!(m.title.is_none() && m.authors.is_none());
  }

  #[test]
  fn lookup_merges_every_plugin_and_reports_the_ones_that_failed() {
    let p = empty();
    p.add(
      "a.js",
      &answering(
        "a",
        "Plugin A",
        r#"{ title: "From A", authors: ["J. K. Rowling"], pageCount: 100 }"#,
      ),
      false,
    )
    .unwrap();
    p.add(
      "b.js",
      &failing("b", "Plugin B", "not_found", "no such book"),
      false,
    )
    .unwrap();
    p.add(
      "c.js",
      &answering("c", "Plugin C", r#"{ title: "From C", authors: ["J.K. Rowling", "Someone"], blurb: "C blurb", publishDate: "1997" }"#),
      false,
    )
    .unwrap();

    let out = tauri::async_runtime::block_on(lookup(&p, "9780747532743")).unwrap();
    let data = out.data.unwrap();
    assert_eq!(data.title.as_deref(), Some("From A"));
    assert_eq!(data.page_count, Some(100));
    assert_eq!(data.blurb.as_deref(), Some("C blurb"));
    assert_eq!(
      data.authors,
      Some(vec!["J. K. Rowling".to_string(), "Someone".to_string()])
    );
    assert_eq!(data.publish_date, None); // "1997" isn't a full date
    assert_eq!(out.sources, ["Plugin A", "Plugin C"]);
    assert_eq!(out.failures.len(), 1);
    assert_eq!(out.failures[0].plugin, "Plugin B");
    assert_eq!(out.failures[0].stage, "not_found");
    assert!(out.failures[0].report.contains("no such book"));
    assert!(
      out
        .warnings
        .iter()
        .any(|w| w.contains("Plugin C") && w.contains("publishDate"))
    );
  }

  #[test]
  fn lookup_when_every_plugin_fails_has_no_data() {
    let p = empty();
    p.add(
      "a.js",
      &failing("a", "Plugin A", "not_found", "nope"),
      false,
    )
    .unwrap();
    p.add(
      "b.js",
      &failing("b", "Plugin B", "http", "server returned 503"),
      false,
    )
    .unwrap();
    let out = tauri::async_runtime::block_on(lookup(&p, "9780747532743")).unwrap();
    assert!(out.data.is_none());
    assert!(out.sources.is_empty());
    assert_eq!(out.failures.len(), 2);
    assert_eq!(out.failures[1].stage, "http");
  }

  #[test]
  fn lookup_without_plugins_is_an_error() {
    let r = tauri::async_runtime::block_on(lookup(&empty(), "9780747532743"));
    assert!(r.is_err());
  }
}
