# 0026 Audio bus and original synthesized sounds

Status: accepted. Slice FX3.

## Decision
- `AudioBus` (apps/client/src/audio) owns one AudioContext, one `DynamicsCompressorNode` on the master bus, and an
  effects gain taken from `settings.effectsVolume`. Music slider is stored by settings; no music is produced here.
- At most 16 one-shot voices. Priority 0 local-player hits/blocks/counters, 1 major abilities (not m1 or dash) and KOs
  within 20 m, 2 everything else. When full, the lowest-priority oldest voice is stolen; a newcomer that ranks below
  every active voice is dropped.
- Attenuation is linear: 1 at 0 m, 0.5 at 22.5 m, 0 at 45 m. Distance uses event.position if present, else replicated
  player centimetres divided by 100.
- Sounds are generated from oscillators, a seeded noise buffer and envelopes (`synth.ts` recipe tables). No samples or
  recordings, so they are original. Casts: sv stone thud, td water swell, ea rising saw with crackle.
- Unlock: `main.ts` is outside FX3's ownership, so `Sfx.attach` unlocks on the first pointerdown, touchend or keydown
  (the Play press is one), removing its listeners afterwards and on dispose. Before that the bus is silent.
- Deduplication comes from `CombatBus`. Presentation only, nothing feeds simulation.

## Consequences
Audibility and iPad Safari unlock are NOT RUN (need a person).
