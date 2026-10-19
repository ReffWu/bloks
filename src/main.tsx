import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./lib/theme";
// the optical-size cut: big type drawn tighter, small type more open
import "@fontsource-variable/inter/opsz.css";
import "./styles.css";
import { startTranscriptWidth } from "./lib/useTranscriptWidth";

startTranscriptWidth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
