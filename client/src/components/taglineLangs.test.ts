import { describe, expect, it } from "vitest";
import { TAGLINE_LANGS, nextTaglineIndex } from "./taglineLangs";

describe("nextTaglineIndex", () => {
  it("advances to the next index", () => {
    expect(nextTaglineIndex(0, 5)).toBe(1);
  });

  it("wraps back to 0 after the last index", () => {
    expect(nextTaglineIndex(4, 5)).toBe(0);
  });

  it("defaults length to the full language list", () => {
    expect(nextTaglineIndex(TAGLINE_LANGS.length - 1)).toBe(0);
  });
});

describe("TAGLINE_LANGS", () => {
  it("anchors on English first", () => {
    expect(TAGLINE_LANGS[0].name).toBe("English");
    expect(TAGLINE_LANGS[0].rtl).toBe(false);
  });

  it("gives every language a non-empty native name, flag code, and text", () => {
    for (const lang of TAGLINE_LANGS) {
      expect(lang.native.length).toBeGreaterThan(0);
      expect(lang.flagCode.length).toBeGreaterThan(0);
      expect(lang.text.length).toBeGreaterThan(0);
    }
  });
});
