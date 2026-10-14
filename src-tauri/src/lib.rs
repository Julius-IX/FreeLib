mod covers;
mod database;
mod filter;
pub mod models;

fn on_startup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  database::init_db(app.handle())?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Regenerates the frontend bindings (commands.ts + types.ts) on every
  // desktop dev launch. Skipped on mobile: the app runs on the device, where
  // the baked-in project path doesn't exist / is read-only. Also runnable
  // without launching the app: `cargo test export_bindings`.
  #[cfg(all(debug_assertions, desktop))]
  export_bindings();

  tauri::Builder::default()
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| on_startup(app))
    .plugin(tauri_plugin_opener::init())
    // built from every `#[command(group)]` fn in the crate: no lists to maintain
    .invoke_handler(tauri_groups::handler())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(any(all(debug_assertions, desktop), test))]
fn export_bindings() {
  tauri_groups::export_ts(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib"))
    .expect("failed to write src/lib/{commands,types}.ts");
}

#[cfg(test)]
mod tests {
  #[test]
  fn export_bindings() {
    super::export_bindings();
  }
}
