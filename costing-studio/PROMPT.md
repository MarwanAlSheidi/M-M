# Paste into Claude Code

Read CLAUDE.md first.

1. `cp .env.example .env`
2. Run `make unit` on the host (needs uv). Fix failures one at a time.
3. Run `uv lock`, then `make smoke` (needs Docker, make, jq); without Docker use `make smoke-local`.
   Fix failures one at a time and re-run.
4. Don't redesign, add features or change agreed behaviour. If a fix needs a design change, stop and ask.
5. Done when smoke prints SMOKE PASSED with the checks listed in CLAUDE.md.
6. Report back with FIXES.md: every change (file + one line).
