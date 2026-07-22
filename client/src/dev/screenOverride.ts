import type { ThemeName } from "../theme/theme";
import type { ErrorScenario } from "../screens/errorScenario";

export interface ScreenOverride {
  screen: "loading" | "chat" | "waiting" | "connecting" | "safety" | "error" | "profiles";
  theme?: ThemeName;
  /** Only meaningful for the "error" screen — picks which scenario to preview. */
  scenario?: ErrorScenario;
}

const VALID_SCREENS = new Set(["loading", "chat", "waiting", "connecting", "safety", "error", "profiles"]);
const VALID_THEMES = new Set<ThemeName>(["apple", "iris", "pulse"]);
const VALID_SCENARIOS = new Set<ErrorScenario>([
  "friend_left",
  "server_unreachable",
  "bad_code",
  "room_full",
  "handshake_failed",
]);

export function parseScreenOverride(search: string): ScreenOverride | null {
  const params = new URLSearchParams(search);
  const screen = params.get("screen");
  if (!screen || !VALID_SCREENS.has(screen)) return null;
  const theme = params.get("theme");
  const result: ScreenOverride = { screen: screen as ScreenOverride["screen"] };
  if (theme && VALID_THEMES.has(theme as ThemeName)) {
    result.theme = theme as ThemeName;
  }
  const scenario = params.get("scenario");
  if (scenario && VALID_SCENARIOS.has(scenario as ErrorScenario)) {
    result.scenario = scenario as ErrorScenario;
  }
  return result;
}
