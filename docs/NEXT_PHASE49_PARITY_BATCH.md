# Phase 49 — acceptance-first large development batch

Use latest dev/phase48-context-recovery commit. Read PHASE48_REPORT.md. Do not bump v0.45.0 until verified. Preserve 16 modules, branding, Rust/Tauri 2 and manual-only Actions.

1. Manual run Windows CI on exact branch. Resolve every actual Rust build, Clippy, rustfmt, browser and package failure. Collect exact commit, job logs, NSIS/portable SHA256 and full-app screenshots. Physical Windows 10/11 tests for native audio, Shelf file picker, media, scheduler, notifications, recovery, multi-monitor/DPI, accessibility and upgrade.
2. Validate recovery and new-backup privacy with real disk corruption tests, retention and opt-in migration. Preserve old backups and reminder reservation/retry guarantees. Test Shelf category actions, audio filter, activity totals, navigation autosave, narrow layouts with full app. No native file operations without separate permission.
3. Deep independent UI/UX work beyond contextual strips: all 16 workflows, populated/empty/loading/error states, Poni 1.5.0 comparison, update 38-category matrix only with verified evidence. Improve calendar/task scheduling, media and native audio, dashboard, timer, health, notes, weather, flashcards, habits, Dock, tools and settings. Provide real evidence, full source, installer only if built, changelog and next prompt.
