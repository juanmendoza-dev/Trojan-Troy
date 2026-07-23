import { useEffect } from "react";

// Publishes the *visual* viewport height to `--app-height` on the root element,
// updating as the mobile URL bar and — crucially — the soft keyboard resize it.
// Screen roots use `height: var(--app-height, 100dvh)` so the chat composer
// rides above the keyboard instead of being covered by it. Safe where
// visualViewport is unavailable (falls back to window.innerHeight).
export function useAppHeight(): void {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const apply = () => {
      const height = vv?.height ?? window.innerHeight;
      root.style.setProperty("--app-height", `${Math.round(height)}px`);
    };

    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);
}
