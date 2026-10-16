import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { AppThemeProvider } from "./themes/AppThemeProvider";
import { loadSettings } from "./lib/settings";

// Settings are read first, so the very first render already has the saved theme (no flash).
loadSettings().then(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppThemeProvider>
        <App />
      </AppThemeProvider>
    </React.StrictMode>
  )
);
