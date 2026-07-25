import { describe, it, expect } from "vitest";
import { decideAccess } from "./accessControl";

const KEY = "peerkey";

describe("accessControl", () => {
  it("allows anyone when contacts-only is off", () => {
    expect(
      decideAccess(KEY, { contactsOnly: false, blocked: new Set(), knownContact: false })
    ).toBe("allow");
  });

  it("allows a known contact under contacts-only", () => {
    expect(
      decideAccess(KEY, { contactsOnly: true, blocked: new Set(), knownContact: true })
    ).toBe("allow");
  });

  it("refuses an unknown key under contacts-only", () => {
    expect(
      decideAccess(KEY, { contactsOnly: true, blocked: new Set(), knownContact: false })
    ).toBe("refuse-unknown");
  });

  it("refuses a blocked key even when it would otherwise be allowed", () => {
    expect(
      decideAccess(KEY, { contactsOnly: false, blocked: new Set([KEY]), knownContact: true })
    ).toBe("refuse-blocked");
  });

  it("lets a block take precedence over a contacts-only unknown refusal", () => {
    expect(
      decideAccess(KEY, { contactsOnly: true, blocked: new Set([KEY]), knownContact: false })
    ).toBe("refuse-blocked");
  });
});
