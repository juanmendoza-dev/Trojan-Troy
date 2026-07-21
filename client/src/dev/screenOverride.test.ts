import { describe, expect, it } from "vitest";
import { parseScreenOverride } from "./screenOverride";

describe("parseScreenOverride", () => {
  it("returns null when there is no screen param", () => {
    expect(parseScreenOverride("")).toBeNull();
    expect(parseScreenOverride("?theme=iris")).toBeNull();
  });

  it("parses a valid screen and theme", () => {
    expect(parseScreenOverride("?screen=chat&theme=iris")).toEqual({ screen: "chat", theme: "iris" });
    expect(parseScreenOverride("?screen=loading&theme=pulse")).toEqual({ screen: "loading", theme: "pulse" });
  });

  it("parses the waiting screen", () => {
    expect(parseScreenOverride("?screen=waiting")).toEqual({ screen: "waiting" });
    expect(parseScreenOverride("?screen=waiting&theme=iris")).toEqual({
      screen: "waiting",
      theme: "iris",
    });
  });

  it("parses the connecting screen", () => {
    expect(parseScreenOverride("?screen=connecting")).toEqual({ screen: "connecting" });
  });

  it("omits theme when not given or invalid", () => {
    expect(parseScreenOverride("?screen=chat")).toEqual({ screen: "chat" });
    expect(parseScreenOverride("?screen=chat&theme=nope")).toEqual({ screen: "chat" });
  });

  it("returns null for an invalid screen value", () => {
    expect(parseScreenOverride("?screen=nope")).toBeNull();
  });
});
