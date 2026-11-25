# Phase 47 candidate report

Baseline a6a2baa248851455bf3e3e54bfe356098a61f775; no version bump. Direct git ls-remote fails DNS, rustc/cargo absent. Chromium 144 and Playwright available locally. No workflow dispatch action exposed by GitHub connector; prior run 44755910010 does not match candidate. Manual-only workflow retained, main untouched.

New explicit local history recording preference defaults to off for legacy settings. Supported 0/25/100/200 entries with existing 30-day age limit. Manual restore preserves current consent and history, not old backup values. Trimming/clear does not change reminder delivery reservations. Old state backups and automatic crash recovery can retain historical metadata; not a secure deletion guarantee. Rust policy tests written but not compiled. Agenda, task sort, Shelf totals, common responsive and keyboard navigation refinements across existing 16 modules. Audio and native Shelf picker acceptance remain open. No production release or parity increase.

Local isolated Phase 47 Chromium fixture ran 27 assertions successfully. It uses actual new UI module and style, but surrounding DOM, IPC, local state and Windows are mocked. Full integration and all 80 screenshot cases pending. Exact pushed blob hashes and fixture script verification recorded in follow-up.
