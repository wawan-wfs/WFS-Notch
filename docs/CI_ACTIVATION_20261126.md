# Candidate CI activation

Owner approval 2026-11-26 for WFS Notch only. Baseline b3b4b8124d85b85ae2e2b2108abfd9b3b9f76767 on dev/phase50-workbench. Latest visible run before activation: 45673734919, Phase 49 SHA dc9b3a4d57061c4748f7f69bee3b1cec1e0c4531, all three jobs PASS. No Phase 50 run yet.

Enable push for dev/phase[0-9]* only, plus workflow_dispatch. Same read-only token, cancel-in-progress per ref, all prior browser/Rust/Windows build gates. No main edit, auto-merge, deployment or publication. Package artifacts remain CI artifacts. Automatic push is not proof a runner started; check exact head SHA and event in run list. Local rustc/cargo unavailable, Git DNS fails. Native physical Windows acceptance not completed; Phase 51 feature batch gated on Phase 50 success.
