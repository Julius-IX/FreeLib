mod database;
pub mod models;

fn on_startup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  database::init_db(app.handle())?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Regenerates the frontend bindings (commands + table types) on every dev
  // launch. Also runnable without launching the app: `cargo test export_bindings`.
  #[cfg(debug_assertions)]
  export_bindings();

  tauri::Builder::default()
    .setup(|app| on_startup(app))
    .plugin(tauri_plugin_opener::init())
    // built from every `#[command(group)]` fn in the crate: no lists to maintain
    .invoke_handler(tauri_groups::handler())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(any(debug_assertions, test))]
fn export_bindings() {
  tauri_groups::export_ts(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/lib/commands.ts"
  ))
  .expect("failed to write src/lib/commands.ts");
}

#[cfg(test)]
mod tests {
  #[test]
  fn export_bindings() {
    super::export_bindings();
  }
}
