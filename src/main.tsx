import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./app/App";
import { AppThemeProvider } from "./themes/AppThemeProvider";
import { loadSettings } from "./lib/settings";

// The window starts hidden (tauri.conf.json) so the OS never shows a blank white webview while it
// boots. It's shown once the themed UI has mounted. The timer is a failsafe: if anything stops
// that from happening, the window still appears rather than the app staying invisible.
let shown = false;
function showWindow() {
  if (shown) return;
  shown = true;
  clearTimeout(failsafe);
  try {
    getCurrentWindow()
      .show()
      .catch(() => {}); // mobile has no window to show
  } catch {
    /* not running inside Tauri (plain browser) */
  }
}
const failsafe = setTimeout(showWindow, 4000);

function ShowWindowWhenMounted() {
  useEffect(showWindow, []);
  return null;
}

// Settings are read first, so the very first render already has the saved theme (no flash).
loadSettings().then(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppThemeProvider>
        <App />
        <ShowWindowWhenMounted />
      </AppThemeProvider>
    </React.StrictMode>
  )
);
