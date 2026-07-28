import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeContext";
import { useAppHeight } from "./hooks/useAppHeight";
import "./styles/base.css";
import "./styles/fonts.css";
import "./styles/keyframes.css";
import "./styles/tokens.css";

function Root() {
  useAppHeight();
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </StrictMode>
);
