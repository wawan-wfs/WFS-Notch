# Phase 44 candidate v0.45.0

Baseline: migrated repository wawan-wfs/WFS-Notch, main ae2b2b3a3edbff83a892afb42345ca6a022ee1fb. Old account returned HTTP 403 suspended. Existing source v0.44.0 preserved; no force push. CI configuration unchanged (manual dispatch and PR opened/reopened, not every push).

## Scope
- File Shelf in existing Dock, maximum 32 entries, exact metadata tuple deduplication, no File references, paths, reads, copy/move/delete operations, network calls or persistence. Names are rendered as text; clear affects entries only. Session-only is deliberate privacy-first scope; files must be reselected after restart.
- Read-only device snapshot on explicit button: OS name/version, kernel, app architecture, available parallelism. Clear invalidates in-flight responses; missing fields labeled unavailable. Browser mode does not simulate device information.
- Five authored small-text colors now inherit theme muted token; Notes accessible names; Flashcards empty option/reset; storage/network reading and failure throttling. Still requires rendered contrast and Windows accessibility verification.
- Added browser fixture assertions and static wiring assertions. Eight pure checks of the exact Shelf normalization/add functions executed in JavaScript before commit, all passed. Full browser suite and Rust/Clippy/rustfmt/build NOT RUN in this session; no Rust compiler and direct GitHub clone unavailable in execution environment. No Windows hardware, Narrator, Poni comparison or installer verified.

## Acceptance
Run existing CI manually on this branch before merge. Check all 16 modules and narrow viewport, note source deletion, native file picker, focus, device clear while reading, error path, original files untouched, signed/unsigned status and package hashes. Keep existing functionality and main untouched until checks pass. Coverage remains last reported 28.9%; do not claim increase without updated fixed 38-category evidence.

Additional fixtures: device partial fields, failure, pending state, clear and late response rejection; both contrast themes checked in the existing four-profile screenshot suite. These added browser fixtures have not yet been executed.

## Exact-source follow-up inspection

Implementation/test commit: 8dd751cee989b4d3c01f356502f20a4dc8b1128b. Source retrieved through GitHub connector after push: six focused checks passed (249 unique HTML IDs, feature ID references resolved, 16 tabs, Cargo/Tauri version alignment, device command registration, representative contrast ratios). Normal muted #8f939f against #15161b, #1a1b22, #111319 yields 5.89:1, 5.59:1 and 6.05:1 respectively. This is authored-color arithmetic, not a rendered contrast audit. The new browser fixtures were added but not executed. The previous eight pure Shelf checks used the actual function definitions committed in modules.js.

Full CI: [Actions](https://github.com/wawan-wfs/WFS-Notch/actions). Existing workflow supports manual dispatch and PR opened/reopened. No PR or workflow was triggered in this batch to preserve the no-automatic-run preference; main remains at the baseline. Run manually against the development branch before merge. No new Windows artifacts are claimed.
