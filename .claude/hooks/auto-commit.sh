#!/usr/bin/env bash
# .claude/hooks/auto-commit.sh
#
# Auto-commit + push uncommitted work when a Claude Code turn ends, enforcing
# the AGENTS.md rule "commit and push early and often". Wired up as a Stop hook
# in .claude/settings.json.
#
# Guardrails (so an auto-committer stays safe):
#   - never commits on the default branch (main/master) — AGENTS.md: branch first
#   - never commits during a merge/rebase/cherry-pick (avoids a half-done state)
#   - debounced: only fires once uncommitted work has been sitting a while
#     (TT_AUTOCOMMIT_MIN_GAP_SECS, default 15 min) — it's a safety net, not a
#     per-turn committer, so it won't pile "work in progress" commits mid-build.
#     The agent's own per-task commits carry Hackatime activity between fires.
#   - respects .gitignore (uses `git add -A`, which skips ignored files)
#   - never disables signing; if the commit fails to sign/commit, it does NOT
#     push — it reports the failure instead (AGENTS.md rule 2)
#   - never force-pushes
#
# Safe to test without committing anything:
#   TT_AUTOCOMMIT_DRYRUN=1 bash .claude/hooks/auto-commit.sh

set -uo pipefail

# Move to the repo root. The hook's cwd is the project dir (inside the repo),
# so git works here; this also makes the relative script path resilient.
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0

DRY="${TT_AUTOCOMMIT_DRYRUN:-0}"

# Sanitize a string for embedding in a JSON systemMessage (no jq on this box).
san()  { printf '%s' "${1:-}" | tr '\n\r\t' '   ' | sed 's/[\\"]/ /g'; }
emit() { printf '{"systemMessage":"%s","suppressOutput":true}\n' "$(san "$1")"; exit 0; }

# 1. Nothing to commit -> let the turn end silently.
[ -z "$(git status --porcelain 2>/dev/null)" ] && exit 0

# 2. Default-branch guard.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
case "$branch" in
  main|master|HEAD|"")
    emit "Auto-commit skipped: on '$branch'. Branch off main before editing (AGENTS.md)." ;;
esac

# 3. Mid-merge/rebase/cherry-pick guard.
gitdir="$(git rev-parse --git-dir 2>/dev/null)"
if [ -e "$gitdir/MERGE_HEAD" ] || [ -e "$gitdir/CHERRY_PICK_HEAD" ] \
   || [ -d "$gitdir/rebase-merge" ] || [ -d "$gitdir/rebase-apply" ]; then
  emit "Auto-commit skipped: a merge/rebase is in progress on '$branch'."
fi

# 3b. Debounce. Don't commit on top of a recent commit — the agent's own
#     per-task commits are what feed Hackatime; this hook only needs to catch
#     work that's been left uncommitted for a while. Skip if the last commit on
#     this branch is newer than TT_AUTOCOMMIT_MIN_GAP_SECS (default 15 min;
#     set 0 to disable the debounce). Uses last-commit age as a proxy for how
#     long the current changes have been accumulating.
min_gap="${TT_AUTOCOMMIT_MIN_GAP_SECS:-900}"
last_commit="$(git log -1 --format=%ct 2>/dev/null || echo 0)"
now="$(date +%s)"
if [ "$min_gap" -gt 0 ] && [ "$last_commit" -gt 0 ] \
   && [ "$((now - last_commit))" -lt "$min_gap" ]; then
  emit "Auto-commit debounced: last commit $(( (now - last_commit) / 60 ))m ago (< $((min_gap / 60))m). Work is saved locally; it'll auto-commit if it keeps sitting."
fi

# 4. Build a short, plain, human-ish message from the change set.
count="$(git status --porcelain | grep -c '.')"
if [ "$count" = "1" ]; then
  first="$(git status --porcelain | head -n1 | sed -e 's/^...//' -e 's/.* -> //' -e 's/^"//' -e 's/"$//')"
  msg="Update $(basename "$first")"
else
  msg="Save work in progress ($count files)"
fi

if [ "$DRY" = "1" ]; then
  emit "[dry-run] would commit + push: $msg  (branch: $branch, files: $count)"
fi

# 5. Stage + commit. Signing stays on (global commit.gpgsign). If the commit
#    fails, do NOT push unsigned/partial work — flag it (AGENTS.md rule 2).
git add -A || emit "Auto-commit skipped: 'git add' failed on '$branch'."
if ! git commit -m "$msg" >/tmp/tt-autocommit.log 2>&1; then
  emit "Auto-commit: commit failed, not pushing -- $(tail -n1 /tmp/tt-autocommit.log)"
fi

# 6. Push (set upstream on a branch's first push; never force).
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  out="$(git push 2>&1)"                      || emit "Committed '$msg' but push failed -- $out"
else
  out="$(git push -u origin "$branch" 2>&1)"  || emit "Committed '$msg' but push failed -- $out"
fi

emit "Auto-committed + pushed: $msg ($branch)."
