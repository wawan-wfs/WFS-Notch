# WFS Notch Phase 46 — acceptance-first large batch

Start with dev/phase45-acceptance candidate, v0.45.0. Read PHASE45_REPORT.md and verify branch tip. Do not release or merge until full manual CI passes on exact commit. Preserve all 16 modules, original WFS branding and manual-only CI. No automatic pushes, no force pushes.

1. Run Windows CI via workflow_dispatch (branch selection), inspect all failures and fix; run static/browser matrix (80 views), Rust tests, Clippy, rustfmt and exact-commit Windows NSIS/portable SHA256. Run Windows 10/11 hardware acceptance including native file picker and storage restart/forget, upgrade, mixed DPI/fullscreen, Narrator and notification permissions.
2. Complete Shelf with explicit native picker and optional independently tested persistent metadata lifecycle, storage failures and privacy QA. Do not add file operations without separate review. Expand consented audio endpoint inventory read-only (no remote scanning, no identifiers, no control), add precise permission/unavailable state.
3. Large UI/UX batch: every module's populated, empty, pending, failed, narrow/high-DPI, keyboard, contrast and high-contrast states; compare with Poni 1.5.0 on real Windows and independently measure fixed 38 categories. Add notification history, dashboard widgets, calendar/task and media improvements where evidence identifies gaps. Keep existing behavior.
4. Publish evidence and next prompt; full source, CHANGELOG, real tests and verified packages only. Do not manufacture percentage or release claims.
