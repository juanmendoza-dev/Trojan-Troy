# AGENTS.md — Rules for All Agents (including Claude)

This file applies to every AI agent working in this repo — Claude, Codex, or
anyone else brought in later. Read this before touching anything.

## Git & Commits

1. **Never commit or co-author as an agent.** Do not set commit author to an
   AI identity, and do not add `Co-Authored-By: <AI name>` trailers (e.g.
   "Claude", "Codex"). Every commit uses the human git identity already
   configured on this machine (`git config user.name` / `user.email`).
   Agents assist with the work; they do not appear in the authorship record.
2. **All commits and pushes must be verified.** Commit signing
   (`commit.gpgsign`) is already enabled globally — don't disable it or pass
   `--no-gpg-sign`. If a commit isn't signing successfully, stop and flag it
   rather than pushing unsigned.
3. **Commit and push early and often, even for small changes.** This
   hackathon is judged on time tracked, and Hackatime reads from commit
   activity. Don't batch work into one big commit at the end of a session —
   commit each meaningful step as you go.
4. **Commit messages must read as human-written: short and sweet.** One
   plain-language line describing what changed (imperative mood, e.g. "Add
   safety number screen"), no AI-generated verbosity, no bullet-point essays,
   no trailers beyond what's required by rule 1.

## Roadmap Changes

If something in `roadmap.md` looks inefficient or wrong once you're actually
building it, **don't just deviate — ask first.** Flag it, explain why, and
wait for a decision. Once agreed, update `roadmap.md` (and log the change in
`decisions.md`) before continuing.

## Project Docs — Read Before Working

- `roadmap.md` — the phase order for Version A. **Do not skip ahead** — e.g.
  don't start UI polish (Phase 4) before encrypted messaging (Phase 2) works.
- `decisions.md` — the log of choices already made and why. Check it before
  re-deciding something. When you make a new non-obvious call (a "would you
  rather X or Y" moment), add an entry — don't leave it undocumented.
- `progress.md` — what's actually been done. Update it after finishing a
  chunk of work, not just at session end.

## Hard Constraints (carried from the project brief)

- Never implement custom cryptographic primitives. Use established, audited
  libraries only (libsodium.js or the Web Crypto API for X25519 / AES-GCM).
- The relay server must be architecturally incapable of reading message
  content — it only ever handles/stores ciphertext.
- Live calling / true peer-to-peer networking is out of scope for this
  version. Do not build toward it yet.
