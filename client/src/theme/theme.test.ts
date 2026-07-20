import { describe, expect, it } from "vitest";
import { resolveDomAttrs } from "./theme";

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
