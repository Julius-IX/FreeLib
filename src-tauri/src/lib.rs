mod covers;
mod database;
mod filter;
pub mod models;

/// Linux (WebKitGTK) refuses every getUserMedia request unless the app answers the permission
/// request itself, and ships with media streams off. The desktop barcode scanner needs the
/// webcam, so turn streams on and allow camera requests. macOS / Windows webviews handle this
/// with the OS's own prompt.
#[cfg(target_os = "linux")]
fn allow_webcam(app: &tauri::App) {
  use tauri::Manager;
  use webkit2gtk::glib::prelude::Cast;
  use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};

  let Some(window) = app.get_webview_window("main") else {
    return;
  };
  let _ = window.with_webview(|webview| {
    let view = webview.inner();
    if let Some(settings) = WebViewExt::settings(&view) {
      settings.set_enable_media_stream(true);
    }
    view.connect_permission_request(|_, request| {
      if request
        .downcast_ref::<UserMediaPermissionRequest>()
        .is_some()
      {
        request.allow();
        true
      } else {
        false // anything else: WebKit's default (deny)
      }
    });
  });
}

fn on_startup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  database::init_db(app.handle())?;
  #[cfg(target_os = "linux")]
  allow_webcam(app);
  Ok(())
}

/// Whether to run through X11 (XWayland) when started in a Wayland session. Wayland-native
/// WebKitGTK can freeze the whole UI while opening the camera; X11 doesn't. An explicit
/// `GDK_BACKEND` in the environment always wins over this.
///
/// TODO: this is meant to become a user setting ("Use X11 on Wayland"). It is read
/// before GTK starts, i.e. before the Tauri app handle (and so the database) exists, so the
/// setting has to be stored somewhere readable this early
#[cfg(target_os = "linux")]
fn linux_prefer_x11() -> bool {
  true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // WebKitGTK's DMA-BUF renderer is a known cause of frozen / stale video frames on some Linux
  // GPU + driver combos. Opt out unless the user set it themselves.
  #[cfg(target_os = "linux")]
  if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
    // SAFETY: first thing in run(), before this process starts any other threads.
    unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
  }

  // TODO: update after README.md is defined
  // Camera freezes on native Wayland (see README, "Linux: camera requirements"). Must happen
  // before GTK / WebKit start, so it can't wait for the Tauri app or its database.
  #[cfg(target_os = "linux")]
  if std::env::var_os("GDK_BACKEND").is_none()
    && std::env::var_os("WAYLAND_DISPLAY").is_some()
    && linux_prefer_x11()
  {
    // SAFETY: same as above, still single-threaded.
    unsafe { std::env::set_var("GDK_BACKEND", "x11") };
  }

  // Regenerates the frontend bindings (commands.ts + types.ts) on every
  // desktop dev launch. Skipped on mobile: the app runs on the device, where
  // the baked-in project path doesn't exist / is read-only. Also runnable
  // without launching the app: `cargo test export_bindings`.
  #[cfg(all(debug_assertions, desktop))]
  export_bindings();

  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| on_startup(app))
    .plugin(tauri_plugin_opener::init());

  // The barcode scanner only exists on mobile; desktop scans with the webcam in the webview.
  #[cfg(mobile)]
  let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

  builder
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
