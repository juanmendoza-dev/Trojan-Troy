# Docs

The reasoning behind the code — kept in the repo, not in someone's head.

| Folder / file | What's in it |
|---|---|
| [protocol.md](protocol.md) | One-page overview of the wire protocol: handshake, ratchet, sealed frames, cover traffic. Start here. |
| [specs/](specs/) | Design specs, one per feature, each with its own residuals ("what this deliberately doesn't do") section. |
| [plans/](plans/) | Implementation plans the features were built from, in phase order. |
| [reviews/](reviews/) | Security reviews — findings, severities, and how each was resolved. |
| [design/](design/) | Original design-tool handoffs (HTML mockups). Reference only; the shipped design is `client/src/`. |
| [devlog/](devlog/) | The build's paper trail: [decisions.md](devlog/decisions.md) (every non-obvious call and why), [progress.md](devlog/progress.md) (what shipped, verified how), [roadmap.md](devlog/roadmap.md) (the original phase plan, kept as history). |

The security model itself is summarized in the root [SECURITY.md](../SECURITY.md)
and the [README's threat-model section](../README.md#threat-model--and-what-this-does-not-protect-you-from).
