# Phase 44 candidate v0.45.0

Baseline: migrated repository wawan-wfs/WFS-Notch, main ae2b2b3a3edbff83a892afb42345ca6a022ee1fb. Old account returned HTTP 403 suspended. Existing source v0.44.0 preserved; no force push. CI configuration unchanged (manual dispatch and PR opened/reopened, not every push).

## Scope
- File Shelf in existing Dock, maximum 32 entries, exact metadata tuple deduplication, no File references, paths, reads, copy/move/delete operations, network calls or persistence. Names are rendered as text; clear affects entries only. Session-only is deliberate privacy-first scope; files must be reselected after restart.
- Read-only device snapshot on explicit button: OS name/version, kernel, app architecture, available parallelism. Clear invalidates in-flight responses; missing fields labeled unavailable. Browser mode does not simulate device information.
- Five authored small-text colors now inherit theme muted token; Notes accessible names; Flashcards empty option/reset; storage/network reading and failure throttling. Still requires rendered contrast and Windows accessibility verification.
- Added browser fixture assertions and static wiring assertions. Eight pure checks of the exact Shelf normalization/add functions executed in JavaScript before commit, all passed. Full browser suite and Rust/Clippy/rustfmt/build NOT RUN in this session; no Rust compiler and direct GitHub clone unavailable in execution environment. No Windows hardware, Narrator, Poni comparison or installer verified.

## Acceptance
Run existing CI manually on this branch before merge. Check all 16 modules and narrow viewport, note source deletion, native file picker, focus, device clear while reading, error path, original files untouched, signed/unsigned status and package hashes. Keep existing functionality and main untouched until checks pass. Coverage remains last reported 28.9%; do not claim increase without updated fixed 38-category evidence.
