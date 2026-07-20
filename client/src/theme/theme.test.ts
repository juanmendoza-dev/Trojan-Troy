import { describe, expect, it } from "vitest";
import { resolveDomAttrs, resolveLoadingScheme } from "./theme";

describe("resolveDomAttrs", () => {
  it("passes through system scheme for apple", () => {
    expect(resolveDomAttrs("apple", "dark")).toEqual({ theme: "apple", scheme: "dark" });
    expect(resolveDomAttrs("apple", "light")).toEqual({ theme: "apple", scheme: "light" });
  });

  it("omits scheme for iris and pulse (always dark, single palette)", () => {
    expect(resolveDomAttrs("iris", "light")).toEqual({ theme: "iris" });
    expect(resolveDomAttrs("pulse", "dark")).toEqual({ theme: "pulse" });
  });
});

describe("resolveLoadingScheme", () => {
  it("follows system scheme when the chat theme is apple", () => {
    expect(resolveLoadingScheme("apple", "light")).toBe("light");
    expect(resolveLoadingScheme("apple", "dark")).toBe("dark");
  });

  it("forces dark for iris and pulse regardless of system scheme", () => {
    expect(resolveLoadingScheme("iris", "light")).toBe("dark");
    expect(resolveLoadingScheme("pulse", "light")).toBe("dark");
  });
});
