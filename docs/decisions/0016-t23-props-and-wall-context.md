# 0016 Props and wall context rules (T23)

Date: 2026-11-01. Status: recorded while implementing T23; reversible by a later spec edit. Numbers are D unless the spec
card states them. (0014 and 0015 are reserved by other sessions.)

## Conflicts and gaps, with the smallest rule chosen
1. **Shared moves have no kit.** The wall attack, urn pickup and ordinary throw apply to every kit, and the Artificer files
   belong to T20. One definition template per move is mapped over `KIT_PREFIXES` (`packages/shared/src/config/wall.ts`,
   `props.ts`), giving `sv.wall`, `td.wall`, `ea.wall`, `<kit>.pickup` and `<kit>.throw` (`input: "context"`, no slot) through
   the generic `ALL_ABILITY_DEFS` list. No `ea.*` file changed. The consequence is that `ea.wall`, `ea.pickup` and `ea.throw`
   exist in the registry while the Artificer kit proper is still empty; the T19 assertion "ea stays empty until T20" now
   excludes exactly those three generated ids. Vanguard keeps `sv.x1` to `sv.x3`.
2. **P0/P1 switch.** Spec 13 says P0 disables the wall branch. No phase flag existed, so the smallest one is
   `ContextSystem.enabled` (default false; `ArenaRoom.onCreate` sets it true, which also covers PracticeRoom). A bare M1 rig
   keeps P0 behaviour. The flag gates the whole context hook (pickup, throw, wall, sv.x1 to sv.x3); nothing else reads it.
3. **Hook point.** `M1System.contextHook` is asked before every M1 commit. This is the shared M1/chain layer, so every kit
   gets the behaviour without touching kit files. A context answer replaces that M1 request (the "fourth M1 request" for
   wall and sv.x1/x2; chain index 0 for pickup; any index for a throw). Fourth-hit context moves reset the chain.
4. **Priority.** Held urn (throw) -> pickup -> wall opportunity -> grounded jump-held uppercut (sv.x1). Pickup is only
   offered at chain index 0 so a mid-combo press never turns into a pickup. Pickup and throw require a fresh press (within the 6 tick
   buffer window) so a held Attack never chains pickup into throw. A rejected `<kit>.wall` (cooldown 360, never touches contextSpent) falls back to the
   normal fourth hit and may still reach sv.x1 only for an awakened Vanguard with the bit open and no wall target.
5. **One use bit.** `Fighter.contextSpent` is set at commit of sv.x1, sv.x2 or sv.x3 (miss or hit), checked by
   `AbilityRunner.startContext`, reset by the existing awakening/death/respawn code. It never touches `awakenedUsedMask`,
   the form, or slotted awakening ability. Pickup and the ordinary throw do not spend it. A held urn thrown by an awakened
   Vanguard with the bit open is Meteor Cast (spec: "Attack while holding an urn"); otherwise it is the ordinary 8 HP throw.
6. **Gale Rebuff "capture up to 60".** Read as: capture window 3 ticks (same as the shared wall script), capture lasts at
   most 60 ticks (safety deadline), damage 40 HP at capture + 48, release at +49. The capture hit deals nothing and is
   counterable; the scheduled hit is not. It is cinematic (third parties cannot hit either participant).
7. **Wall opportunity (spec 13).** Enemy within 0.6 m of the vertical static face (measured from the capsule surface),
   vertical spans overlapping, attacker within 2 m horizontally (and 1.2 m vertically). Only `obstacle`/`guardrail` colliders
   count; island slabs and bridges do not. Colliders are axis aligned boxes and upright cylinders, so every side face
   normal is exactly horizontal (inside the 15 degree limit). Standing on top of a box never qualifies. The same test is
   rechecked on the victim at the capture probe. Release launch is the shared capture release (away from the caster), not a
   wall normal; it is "away from the wall" in practice because the caster stands on the open side.
8. **Urn lifecycle.** anchored -> reserved (12 tick pickup channel, one urn per fighter) -> held -> returning. A drop (guard,
   damage that removes HP, capture, stun, ragdoll, death, leave, life change) returns the urn to its anchor at once: urns never
   become loose bodies (spec 10 forbids unconstrained debris physics). A thrown urn is a swept projectile (existing
   `ProjectileSystem`, A19 safe) and returns to its anchor exactly 600 ticks after the throw tick whether it hit, was
   blocked, countered or missed. Blocked or countered hits do not drop a carried urn.
9. **Throw numbers.** `<kit>.throw`: startup 10, active 1, recovery 20 (D), speed 18, radius 0.3, 8 HP, B, R36 F6 U2, no chip.
   sv.x3: startup 10, recovery 24, speed 28, radius 0.4, 15 HP, U, R60 F10 U3. Both are reflectable and counterable
   through the T19 projectile rules.
10. **Replication.** `ArenaState.urns` (id, state, holderId, returnTick, x, y, z in cm) is public and appended as the LAST field of `ArenaState`; `URN_FIELDS` is a new constant in shared/schema.ts (no existing list reordered), so a later client can draw
    the urns and the "Pick up" label. No client change in T23.
11. **Disconnect and dispose.** `ArenaRoom.onDrop` and `onLeave` call `urns.drop(entity)`, so a holder that disconnects (even if
    its seat is reserved for 20 s) never keeps an urn. `onDispose` calls `urns.clear()`. Both are tested.
