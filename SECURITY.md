# Security

Trojan Troy is a hackathon project, built with security at the forefront of it: 
every primitive comes from an audited library ([libsodium](https://doc.libsodium.org/),
[@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum)), and
nothing cryptographic is made by me (from scratch). It has **not** had a formal external/3rd party audit
treat it as a proof of concept, not a product to bet ur life on.

## Threat model in five lines

- **Assumed hostile:** the relay operator, anyone on the network path, and
  anyone recording traffic today to decrypt later (including with a quantum
  computer).
- **Guaranteed:** the relay handles only ciphertext — content, metadata
  (message ids, types, receipts, ratchet state), and even frame sizes are
  hidden from it. See [docs/protocol.md](docs/protocol.md).
- **Not defended:** a compromised endpoint, a user who skips safety-number
  verification, and the bare fact that a session exists between two peers.
- The full, honest residuals table lives in the
  [README](README.md#threat-model--and-what-this-does-not-protect-you-from).
- The internal security review that drove much of the hardening is committed
  at [docs/reviews/2026-07-22-security-review.md](docs/reviews/2026-07-22-security-review.md).

## Reporting

If you found something, please report it! I would love to try to fix it!!!!
or even better try to fix urself and I can add it to the repo 
