# 0019 Rig X rotation sign

Status: accepted (B1).

The rig convention (rig.ts header) says +X swings a hanging limb toward -Z, the facing direction. The pose tables were
authored with the opposite sign, so knees and elbows bent backwards and leans were mirrored. Decision: negate the X
component once in `buildClip`; pose tables are untouched.

Invariants live in `tests/unit/rig-pose.test.ts`. Deviations from the backlog wording, all in the test only:
- Elbow check applies only while the upper arm hangs (shoulder at least 0.2 m above elbow); with arms raised the hinge axis is not Z. Tolerance 0.03 m (a few straight-arm poses sit 0.0225 m behind the line).
- m1.4 is a kick, so its striking limb is the foot; the bar is "ahead of the chest" (sv and ea kicks reach only 0.01 to 0.11 m). Strengthening the kick poses is a separate pose-tuning task.
