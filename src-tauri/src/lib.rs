mod backup;
mod colors;
mod covers;
mod database;
mod filter;
mod import;
pub mod models;
mod plugins;
mod settings;

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

#[cfg(target_os = "linux")]
fn fix_appimage_gstreamer() {
  use std::path::PathBuf;
  let Some(appdir) = std::env::var_os("APPDIR").map(PathBuf::from) else {
    return; // not an AppImage
  };
  let plugins = appdir.join("usr/lib/gstreamer-1.0");
  let scanner = plugins.join("gst-plugin-scanner");
  if !scanner.exists() {
    return;
  }

  // SAFETY: called first in run(), before any other threads start.
  unsafe {
    // The AppRun hook sets these _1_0 variants (wrongly), and GStreamer prefers them
    std::env::set_var("GST_PLUGIN_SCANNER_1_0", &scanner);
    std::env::set_var("GST_PLUGIN_SCANNER", &scanner);
    std::env::set_var("GST_PLUGIN_PATH_1_0", &plugins);
    std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &plugins);

    // Only set this if gst-ptp-helper exists in the bundle. It's unused for camera capture
    // std::env::set_var("GST_PTP_HELPER_1_0", plugins.join("gst-ptp-helper"));
  }
}

fn on_startup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  database::init_db(app.handle())?;
  covers::migrate_legacy_covers(app.handle());
  settings::init(app.handle())?;
  plugins::init(app.handle())?;
  #[cfg(target_os = "linux")]
  allow_webcam(app);
  Ok(())
}

/// Whether to run through X11 (XWayland) when started in a Wayland session. Wayland-native
/// WebKitGTK can freeze the whole UI while opening the camera. X11 doesn't. An explicit
/// `GDK_BACKEND` in the environment always wins over this.
///
/// This is the "Use X11 on Wayland" setting (`settings::LINUX_X11_ON_WAYLAND`, on by default).
/// It is read before GTK starts, i.e. before the Tauri app handle exists, so it can't go through
/// `Settings`. `settings::peek_early` reads the settings file directly instead.
#[cfg(target_os = "linux")]
fn linux_prefer_x11(identifier: &str) -> bool {
  settings::peek_early(identifier, settings::LINUX_X11_ON_WAYLAND).unwrap_or(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Built this early only for its app identifier.
  let context = tauri::generate_context!();

  // The AppImage's gstreamer hook points at a scanner path that doesn't exist in Tauri's flat
  // bundle layout. Must run before GTK / WebKit start.
  #[cfg(target_os = "linux")]
  fix_appimage_gstreamer();

  // WebKitGTK's DMA-BUF renderer is a known cause of frozen / stale video frames on some Linux
  // GPU + driver combos. Opt out unless the user set it themselves.
  #[cfg(target_os = "linux")]
  if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
    // SAFETY: first thing in run(), before this process starts any other threads.
    unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
  }

  // Camera freezes on native Wayland (see README, "Linux: camera requirements"). Users can opt
  // out in Settings ("Use X11 on Wayland", takes effect on the next start). Must happen before
  // GTK / WebKit start, so it can't wait for the Tauri app or its database.
  #[cfg(target_os = "linux")]
  if std::env::var_os("GDK_BACKEND").is_none()
    && std::env::var_os("WAYLAND_DISPLAY").is_some()
    && linux_prefer_x11(&context.config().identifier)
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

  // The barcode scanner only exists on mobile. Desktop scans with the webcam in the webview.
  #[cfg(mobile)]
  let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

  builder
    // built from every `#[command(group)]` fn in the crate: no lists to maintain
    .invoke_handler(tauri_groups::handler())
    .run(context)
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
