# Security

Trojan Troy is a hackathon project, built with the discipline of a real one:
every primitive comes from an audited library ([libsodium](https://doc.libsodium.org/),
[@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum)), and
nothing cryptographic is hand-rolled. It has **not** had a formal external
audit — treat it as a demonstration of a design, not a product to bet your
safety on.

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

Found something mis-stated or broken? Open a GitHub issue on this repo — a
security claim we can't defend is a bug, and we'd rather know.
