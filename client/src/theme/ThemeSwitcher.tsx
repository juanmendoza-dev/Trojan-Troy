import { useTheme } from "./ThemeContext";
import "./ThemeSwitcher.css";

const OPTIONS: { value: "apple" | "iris" | "pulse"; label: string }[] = [
  { value: "apple", label: "Apple" },
  { value: "iris", label: "Iris Glass" },
  { value: "pulse", label: "Pulse Slate" },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-switcher">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          className={option.value === theme ? "theme-switcher__option theme-switcher__option--active" : "theme-switcher__option"}
          onClick={() => setTheme(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
