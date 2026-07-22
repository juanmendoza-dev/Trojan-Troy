import type { ThemeName } from "../theme/theme";

export interface ScreenOverride {
  screen: "loading" | "chat" | "waiting" | "connecting" | "safety";
  theme?: ThemeName;
}

const VALID_SCREENS = new Set(["loading", "chat", "waiting", "connecting", "safety"]);
const VALID_THEMES = new Set<ThemeName>(["apple", "iris", "pulse"]);

export function parseScreenOverride(search: string): ScreenOverride | null {
  const params = new URLSearchParams(search);
  const screen = params.get("screen");
  if (!screen || !VALID_SCREENS.has(screen)) return null;
  const theme = params.get("theme");
  const result: ScreenOverride = { screen: screen as ScreenOverride["screen"] };
  if (theme && VALID_THEMES.has(theme as ThemeName)) {
    result.theme = theme as ThemeName;
  }
  return result;
}
