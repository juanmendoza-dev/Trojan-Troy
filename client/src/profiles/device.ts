export type DeviceKind = "computer" | "phone";

// Best-effort "computer or phone" for the profile card. Prefer the UA-Client-
// Hints `mobile` boolean when the browser exposes it; otherwise fall back to a
// user-agent sniff. Pure + testable; `detectDevice()` is the thin browser wrapper.
export function deviceFromUserAgent(userAgent: string, uaDataMobile?: boolean): DeviceKind {
  if (uaDataMobile === true) return "phone";
  if (uaDataMobile === false) return "computer";
  return /android|iphone|ipad|ipod|mobile|windows phone/i.test(userAgent) ? "phone" : "computer";
}

export function detectDevice(): DeviceKind {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return deviceFromUserAgent(nav.userAgent ?? "", nav.userAgentData?.mobile);
}
