# 0033 QI01 review delegated to the orchestrator

Status: accepted. 2026-11-02.

## Decision
The owner told the orchestrator to proceed without asking and to use its own judgment. The "owner approval" step of QI01 (PASS/REWORK per lane for environment, silhouette and warning/impact) is therefore replaced by an orchestrator review of the automated captures in `docs/test-results/QI01/`. This is owner delegated approval to the orchestrator. It is NOT a human sign-off. A human or both-iPad review (QD01) is still required before any release claim, and the mandatory gate "QI01 approval" in the 90 plan is satisfied only in this delegated sense.

## Limits of the evidence (all labelled in QI01.md)
- Desktop Chromium on SwiftShader (CPU raster), 1024x768, dev client. Not an iPad, not full speed.
- Medium tier uses a test-only spoofed WebGL renderer string (the ordinary client pins SwiftShader to low).
- Stills only. No full-speed clips were kept; screenshot latency under three SwiftShader clients means "windup/impact/settle" are triggers, and the metrics file records the actual replicated action at capture time.
- Placement, camera yaw, HP/cooldown resets and awakening meter are synthetic fixtures; skills are held real keys and hits come from the server.
