import { describe, expect, it } from "vitest";
import { buildInviteLink, parseInviteCode } from "./inviteLink";

describe("buildInviteLink", () => {
  it("joins origin, pathname, and code with a hash", () => {
    expect(buildInviteLink("https://troy.app", "/", "K7F-2QX")).toBe("https://troy.app/#K7F-2QX");
  });

  it("works for a localhost origin", () => {
    expect(buildInviteLink("http://localhost:5173", "/", "ABC-123")).toBe(
      "http://localhost:5173/#ABC-123"
    );
  });

  it("preserves a nested pathname", () => {
    expect(buildInviteLink("https://troy.app", "/chat/", "K7F-2QX")).toBe(
      "https://troy.app/chat/#K7F-2QX"
    );
  });
});

describe("parseInviteCode", () => {
  it("extracts the code from a hash", () => {
    expect(parseInviteCode("#K7F-2QX")).toBe("K7F-2QX");
  });

  it("uppercases and trims like the join form", () => {
    expect(parseInviteCode("#  k7f-2qx  ")).toBe("K7F-2QX");
  });

  it("handles a hash without the leading #", () => {
    expect(parseInviteCode("K7F-2QX")).toBe("K7F-2QX");
  });

  it("returns null for an empty or hash-only string", () => {
    expect(parseInviteCode("")).toBeNull();
    expect(parseInviteCode("#")).toBeNull();
  });

  it("round-trips with buildInviteLink", () => {
    const link = buildInviteLink("https://troy.app", "/", "K7F-2QX");
    const hash = "#" + link.split("#")[1];
    expect(parseInviteCode(hash)).toBe("K7F-2QX");
  });
});
