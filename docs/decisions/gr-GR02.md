# GR02 Occupant-bound projectile ownership

Status: D (local design choice, not an original-game fact).

Entity ids are uint8 and reused after a player leaves. A detached projectile therefore carries a server-only occupant generation (`ownerOccupant`) next to its owner id and life id. The room keeps `Map<entityId, generation>` with a monotonic counter: incremented on every allocation (human join, bot, practice dummy), released on leave or bot clear, unchanged by respawn. Never replicated; the wire stays uint8.

Rules: self-exclusion, reflection and the self-hit check use `(entityId, occupant)`. A departed owner's shot still deals unchanged damage (range, splash, caps untouched) but credits nobody: no kill, assist, combat timer, meter or passive for the id's new occupant. Events and the KO fall back to the victim as actor (same format as a ring-out). The same occupant after death and respawn may still take a posthumous KO; heal, meter and reset still require the firing life (existing `ownerLifeId` check). Reflection replaces occupant and life with the reflector's current values and aims at the original owner only while that occupant holds the id.
