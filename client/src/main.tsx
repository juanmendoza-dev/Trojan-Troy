import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeContext";
import { ThemeSwitcher } from "./theme/ThemeSwitcher";
import "./styles/keyframes.css";
import "./styles/tokens.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <ThemeSwitcher />
    </ThemeProvider>
  </StrictMode>
);
