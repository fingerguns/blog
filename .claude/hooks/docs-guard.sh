#!/usr/bin/env bash
# PreToolUse(Bash) hook: refuse a `git commit` that changes what the site does
# without also updating the docs that describe it — README.md and BOTH versions
# of the colophon (the plain prose and the Whitman retelling live in the same
# file, so a colophon edit that touches only one is still incomplete).
#
# Escape hatch: put `skip-docs` anywhere in the commit command.
set -uo pipefail

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
case "$cmd" in
  *skip-docs*|*--amend*) exit 0 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

# `git commit -a` commits tracked changes that were never staged, so the file
# set has to come from the working tree in that case.
case "$cmd" in
  *" -a"*|*"--all"*) files=$(git diff --name-only HEAD) ;;
  *) files=$(git diff --cached --name-only) ;;
esac
[ -z "$files" ] && exit 0

# Code that can change what a visitor or the admin actually sees. Tests and
# docs are deliberately absent: they describe behaviour rather than change it.
behaviour=$(printf '%s\n' "$files" | grep -Ev '\.test\.mjs$' | grep -E \
  '^(scripts/|worker/|admin/|styles\.css$|_headers$|build-pages\.mjs$|about/|contact/)' || true)
[ -z "$behaviour" ] && exit 0

if printf '%s\n' "$files" | grep -q '^README\.md$'; then readme=yes; else readme=no; fi
if printf '%s\n' "$files" | grep -q '^colophon/index\.html$'; then colophon=yes; else colophon=no; fi
[ "$readme" = yes ] && [ "$colophon" = yes ] && exit 0

missing=""
[ "$readme" = no ] && missing="README.md"
[ "$colophon" = no ] && missing="${missing:+$missing and }colophon/index.html (both the prose and the Whitman version)"

reason="This commit changes behaviour but does not update $missing.

Behaviour changes in this commit:
$(printf '%s\n' "$behaviour" | sed 's/^/  /')

Update the docs for this change and include them in the same commit: README.md for features and architecture, colophon/index.html in BOTH versions — the plain prose and the matching Whitman section. Read the existing text for anything this change makes wrong (a renamed tab, a changed default, a number that moved), not only for something to add.

If this change genuinely needs no docs — a refactor, a chore, a fix with no visible effect — put skip-docs anywhere in the commit command."

jq -nc --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
