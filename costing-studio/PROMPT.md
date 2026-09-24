# Paste into Claude Code

Read CLAUDE.md and ASSEMBLY_NOTES.md first. The repo is already assembled.

1. `cp .env.example .env`
2. Run `make unit` on the host (needs uv). Fix failures one at a time. `test_backtest_walk_forward.py`
   is the first-ever LightGBM run; expect something there.
3. Run `uv lock`, then `make smoke` (needs Docker, make, jq). Fix failures one at a time and re-run.
4. Don't redesign, add features or change agreed behaviour. If a fix needs a design change, stop and ask me.
5. Done when `make smoke` prints SMOKE PASSED with the checks listed in CLAUDE.md.
6. Report back with FIXES.md: every fix (file + one line), `[DESIGN]` on any that shows a wrong design assumption.
