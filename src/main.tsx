import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./lib/theme";
// the optical-size cut: big type drawn tighter, small type more open
import "@fontsource-variable/inter/opsz.css";
import "./styles.css";
import { startTranscriptWidth } from "./lib/useTranscriptWidth";
import { applyAccent, chooseAccent, hasStoredAccent, storedAccent } from "./lib/accent";
import { accentForMark } from "./lib/workspaceMark";

// before the first render, so the chosen colour is there from the start.
// A workspace opened for the first time starts on the accent nearest its
// mark, so it looks like itself from its first screen; Personal keeps the
// accent it always had.
const workspace = window.bloks?.workspace;
if (workspace && workspace.kind !== "personal" && workspace.mark && !hasStoredAccent()) chooseAccent(accentForMark(workspace.mark.color));
else applyAccent(storedAccent());
startTranscriptWidth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
