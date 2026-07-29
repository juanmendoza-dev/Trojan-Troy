# Integrator Agent — role & runbook

The **integrator** is a single dedicated agent whose only job is to merge
finished feature branches into `main`, one at a time. Worker agents never
touch `main` — they push their own branches and open a PR when done. The
integrator turns those PRs into a clean `main`.

**Run only ONE integrator at a time.** Serializing merges is the entire point —
it keeps `main` coherent and surfaces conflicts one at a time instead of a
pileup. Run it from the top-level `Trojan Troy` folder, checked out on `main`.

## The "ready" signal

A worker agent signals it's done by **opening a PR** for its branch:

```
gh pr create --fill --base main
```

A pushed branch with no PR is treated as work-in-progress and left alone.

## The loop (autonomous)

Repeat until no ready PRs remain:

1. **Refresh.** `git switch main` then `git pull`.
2. **List ready PRs.** `gh pr list --state open --base main`. Pick the oldest.
3. **Check mergeability.** `gh pr view <n> --json mergeable,mergeStateStatus`.
4. **Verify the branch before merging.** Check it out in a scratch worktree,
   install if needed, and run the gates:
   ```
   git worktree add .worktrees/verify-<n> <branch>
   cd client && npm run typecheck && npm test && npm run build
   ```
   (Only run the client gates when the PR touches `client/`; same for
   `server/`.) Remove the scratch worktree when done.
5. **Merge decision:**
   - **Clean + green** → merge it:
     `gh pr merge <n> --merge --delete-branch`
     (Server-side merge — GitHub creates a signed merge commit, so no local
     GPG/PowerShell signing step is needed.)
   - **Conflict** (`mergeable: CONFLICTING`) → **do NOT guess.** Leave the PR
     open, post a short comment naming the conflicting files and which other
     merged branch touched them, then move on to the next PR:
     `gh pr comment <n> --body "Merge conflict in <files> vs recently merged <branch> — needs a human or the owning agent to rebase."`
   - **Verification fails** (typecheck/test/build red) → leave the PR open,
     comment with the failing command + output tail, move on.
6. **Clean up.** Delete any leftover `.worktrees/verify-*` worktree and its
   branch. Prune: `git worktree prune`.
7. Go back to step 1 (pull again — the branch you just merged changed `main`,
   so the next PR must be evaluated against the new `main`).

## Rules

- **One branch at a time.** Never merge two PRs "in parallel" — always pull,
  merge one, pull again, merge the next.
- **Never force-resolve a conflict.** Autonomy = handle everything that merges
  cleanly and verifies green, unattended. A real conflict means two agents
  edited the same lines — that's a human/owning-agent call, so flag it and
  keep going, don't silently pick a side.
- **Never commit directly to `main`.** The pre-commit hook enforces this;
  merges via `gh pr merge` are the only thing that lands on `main`.
- **Signed commits** (satisfied automatically by GitHub's server-side merge)
  and short, plain commit messages.
- **Stop and report** if `main` itself won't build after a merge, or if the
  same PR fails twice — don't loop forever.

## When done

Report a short summary: which PRs merged, which were left open and why.
