# Phase 48 — build and acceptance before release

Start from latest dev/phase47-privacy-planning. Keep v0.45.0 candidate until full gates pass. Preserve original WFS Notch, all 16 modules and manual-only GitHub Actions. Read PHASE47_REPORT.md.

1. Dispatch Windows CI manually on candidate; fix actual compile/Clippy/format and browser failures, validate exact-commit NSIS/portable SHA256. Test Windows 10/11 interactive notification consent, audio enumeration, media, file picker, restart, DPI, fullscreen, Narrator, backup and upgrade. Do not claim parity from browser.
2. Complete durable notification privacy and crash recovery policy (old recovery copies, retention and consent); do not destroy user backups without authorization. Continue native audio and Shelf acceptance and metadata workflow; do not implement file writes or capture without consent.
3. Complete meaningful UI/UX redevelopment across all 16 modules, improve calendar/task scheduling, media, health, timer, tools, weather, dock, settings and dashboard. Capture actual reference and candidate screenshots, compare feature behavior and fixed 38-category coverage. Retain prior features and evidence. Report actual tests, full source, installer only if built, CHANGELOG and next prompt.
