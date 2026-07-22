export type AccessDecision = "allow" | "refuse-unknown" | "refuse-blocked";

// Decide whether to complete a handshake with a peer, keyed ONLY on the peer's
// identity key — never the self-asserted display name — so anonymous-but-known
// peers are allowed and unknown-but-named peers are refused. Blocking always
// takes precedence over everything else.
export function decideAccess(
  peerIdentityKey: string,
  opts: { contactsOnly: boolean; blocked: Set<string>; knownContact: boolean }
): AccessDecision {
  if (opts.blocked.has(peerIdentityKey)) return "refuse-blocked";
  if (opts.contactsOnly && !opts.knownContact) return "refuse-unknown";
  return "allow";
}
