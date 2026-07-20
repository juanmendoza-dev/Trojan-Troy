export type ThemeName = "apple" | "iris" | "pulse";
export type Scheme = "light" | "dark";

export function resolveDomAttrs(
  theme: ThemeName,
  systemScheme: Scheme
): { theme: ThemeName; scheme?: Scheme } {
  if (theme === "apple") return { theme, scheme: systemScheme };
  return { theme };
}
