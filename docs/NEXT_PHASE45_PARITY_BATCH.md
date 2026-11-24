# WFS Notch — next large parity batch

Use the latest verified main and inspect dev/phase44-shelf-accessibility candidate v0.45.0. Read PHASE44_CANDIDATE_REPORT.md; do not claim candidate acceptance until manual CI, exact source, native Windows acceptance and package checks pass. Keep original WFS branding, Rust + Tauri 2, no forced pushes, no CI on every push.

1. Run manual CI for candidate; fix Rust/Clippy/rustfmt, static and all browser regressions; verify actual checks and exact commit; merge only after applicable gates pass. Test Windows 10/11 installer upgrade, fullscreen, display/DPI, media sessions, Narrator and toast permissions.
2. Finish File Shelf with explicitly consented safe native file selection, bounded metadata persistence only if opted in, path handling and duplicate policy, restart/privacy tests. Separate any file operations and require explicit review.
3. Expand read-only device diagnostics with precise unavailable/denied/error states, optional audio device enumeration without control, no host identifiers, no networking or background discovery.
4. Improve all 16 modules' keyboard/empty/loading/error/contrast and add screenshot fixtures at narrow and high DPI; compare with Poni 1.5.0 independently; keep 38-category matrix and mark evidence gaps honestly.
5. Address remaining feature parity across media, calendar, tasks, notification history, dashboard widgets, controls, Dock, accessibility; report actual pass/fail and preserve regressions. Provide full source, package only if built, actual test evidence, CHANGELOG and next batch prompt.
