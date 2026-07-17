import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PrefsProvider } from "./PrefsContext";
import { bootstrapAppearance } from "./prefs";
import "./styles.css";

bootstrapAppearance();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root missing");
}

createRoot(root).render(
  <StrictMode>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </StrictMode>,
);
