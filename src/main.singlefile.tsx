import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Portable single-file build entry point.
//
// Why HashRouter here and BrowserRouter in main.tsx: this build is opened
// directly as a local file (e.g. via a content:// or file:// URL on
// Android), not served from a web server with real URL rewriting. With
// BrowserRouter, any path other than "/" (like "/teacher") doesn't match
// an actual file on disk, so the OS/webview reports "Page not found"
// before React ever gets a chance to render. HashRouter keeps all
// routing state after a "#", so the browser only ever requests the one
// real file (index.html) no matter which in-app route is active.
//
// See index.singlefile.html for a safety shim around window.URL: it has
// to live there (as a plain classic script before this module script),
// not here, because ES module imports always evaluate before this
// file's own top-level code runs, and the import chain below already
// creates the Supabase client — which is where the crash this shim
// prevents actually happens — before a shim placed in this file could
// ever take effect.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
