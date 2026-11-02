# 0034 QU01 HUD choices (delegated)

The owner delegated design decisions to the orchestrator. Not a human sign-off.

1. Sparring button: placed by `placeSparringRect` (first free 150x48 slot on the top rows, 8 px clearance) instead of a fixed corner; hidden when none fits.
2. Skill labels: name up to 12 characters, else the first word; readiness is text ("Ready" or cooldown) plus border shape (solid or dashed), not colour only.
3. Block feedback is driven only by the server "block" combat event for the local player, 0.8 s. Counter feedback is out of scope.
4. Guide prompts use the exact words Move, Aim, Strike, Guard, Use a skill. The HUD facing button is labelled "Aim"; the existing "Facing lock" line is kept (now "Facing lock (the Aim button)") so older assertions hold. Keyboard Aim reads "press Shift to lock or unlock facing" because there is no mouse look.
