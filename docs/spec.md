ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION




Elemental Battlegrounds implementation
specification
Mac Studio hosted multiplayer for iPad browsers
Version 1.0 • Research cut off 1 November 2026 • Implementation contract
Build a private, browser playable, third person 3D free for all for Arel and Nora. Run the authoritative game
server on the Mac Studio and render the game locally in each iPad browser. Use floating islands and an
original anime inspired visual identity. Preserve the reference game’s recognizable action vocabulary, four
slot kits, directional dashes, defensive timing and awakening structure.
This specification defines a complete implementation path, not game code. The initial playable release
contains two fully specified fighters; the next milestone adds a third. Across these milestones it specifies 24
slotted abilities, three awakening activations, three contextual attacks, universal combat, and the relevant
variants and passives. Every shipped name, character, animation, icon, sound and environment must be
independently created.
The reference is Roblox The Strongest Battlegrounds by Yielding Arts. The official experience confirms
mobile support and the core control actions. Detailed moves and variants are documented by community
sources, with conflicts recorded here. No live Roblox iPad session or frame measurement was performed.
This is therefore a researched compatibility target, not a certification of exact November 2026 parity. [R01–
R10]

Main implementation decision
Implement the precise local rules in this document. Keep original game observations in a separate
reference ledger. Do not fill gaps by inventing facts about the reference. Local tuning values are
deliberately specified so the engineering work is not blocked by missing proprietary timings.

Intended implementers
Sonnet 5.5 Low and Sol 6.1 Low are the requested execution targets. Treat these labels as the user’s
agent selections, not a claim about model availability. Give each agent one numbered task with its
dependencies, files and acceptance checks. The embedded AGENTS.md governs implementation work.

Delivery contents
Product and touch UX • source backed move catalog • executable rules and data contracts • authoritative
simulation • project structure • deployment and security • performance budgets • test matrix • sequenced
commits • verification ledger • source bibliography.




                                                                                                  Version 1.0 | 1
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



Contents
Use this map to find the implementation contracts. Headings are also available in Word’s navigation pane.
All local gameplay numbers are design values unless explicitly identified as source observations.
1 Scope and document authority
2 Research findings and verification limits
3 Reference catalog for The Strongest Hero
4 Reference catalog for Hero Hunter
5 Reference catalog for Destructive Cyborg
6 Player journeys and screen behavior
7 iPad touch layout
8 Touch gestures and input ownership
9 Camera settings and feedback
10 Floating island arena contract
11 Universal movement and combat values
12 Authoritative state machines
13 Hit resolution and combat invariants
14 Ability data schema and defaults
15 Stone Vanguard base abilities
16 Shared variants passives and handler tests
17 Architecture and dependency baseline
18 Project tree and module ownership
19 Network message contracts
20 Replicated state and HTTP interface
21 Fixed simulation loop and movement
22 Prediction interpolation and reconnection
23 Rendering animation assets and audio
24 Performance budgets and hosting
25 Automated acceptance tests
26 Device network and performance acceptance
27 Sequenced commits for the playable release
28 Agent readable AGENTS instructions
29 Assumptions verification log and deviations
30 Game research sources




                                                                                              Version 1.0 | 2
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



1 Scope and document authority
Release priorities

Milestone                  Required content                              Exit condition
                           Two iPads, one private room, floating
                           arena, universal combat, Stone Vanguard       Two people complete the device acceptance
P0 playable release
                           and Tide Duelist, all 16 slotted moves and    suite with no input or authority failures
                           both awakenings
                           Ember Artificer and its eight moves, all
P1 complete scoped         three contextual Vanguard attacks, props      All P0 and P1 tests pass and asset
release                    and contextual wall attacks, final original   provenance is complete
                           assets
                           Other reference fighters, alternate Monster
P2 separately approved                                                   New source ledger and complete ability
                           Form, event or restricted kits, ranked
expansion                                                                contract before implementation
                           modes, additional reported burst systems

P0 and P1 together are the full scope of this document. Do not add a new character because a guide
mentions it. Arel and Nora can choose the same fighter. No purchases, loot boxes, account registration,
public chat, voice, public matchmaking, mobile app wrapper, persistent competitive ranking or Roblox
integration are required.

Normative language and evidence
MUST means acceptance requires it. SHOULD is a preferred implementation with a documented
equivalent allowed. Every rule without a source tag is a local product decision, marked D by default; it is not
a claim about The Strongest Battlegrounds.
Tag                        Meaning                                       Permitted use
                                                                         Cite precisely; do not extend beyond the
V                          Verified in an inspected primary source
                                                                         source
                           Community documented, not directly            Use for reference behavior with stated
C
                           measured                                      freshness limits
                                                                         Keep alternatives in the ledger; do not call one
X                          Conflicting or incomplete evidence
                                                                         exact
                                                                         Implement as written and expose in
D                          Deliberate local design value
                                                                         configuration
U                          Unknown or unverified                         Do not ship as a claim of original fidelity

Order of authority
Explicit product requirements → this document’s local rules and numeric registry → ability overrides →
default handler semantics → task acceptance tests. A contradiction must produce a short decision record
and a corrected test, not silent improvisation. Source descriptions never silently override local
configuration.

How to use the document
Read sections 1–6 before scaffolding. Implement sections 7–16 as the gameplay contract, sections 17–24
as engineering and hosting contracts, and sections 25–29 as delivery gates. Source IDs resolve in section
30. The page headings form a navigable outline in Word.
All distances are metres in the new game. Time in simulation tables is integer ticks at 60 Hz. Health is 100
points. Reference percentages are reported separately and are never converted from Roblox studs without
a measurement.




                                                                                                             Version 1.0 | 3
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



2 Research findings and verification limits
What the primary source actually establishes
The official Roblox experience names Yielding Arts, supports mobile, PC and console, and lists punch,
block, dash, ragdoll cancel, run, awakening and emote actions. It does not establish iPad coordinates,
touch target sizes, hitbox dimensions, damage schedules or frame data. The indexed page showed an
update date of 17 October 2026; other aggregators reported later dates. Treat this as an indexing
discrepancy, not proof of the live build. [R01]

Research method
Research used the official experience page, community character and combat pages, contemporary control
guides, update archives, and primary engine documentation. Search indexed excerpts were used where
direct Fandom fetches failed. These excerpts were available on 1 November 2026, but many character
pages were last crawled roughly four months earlier. A recently crawled derivative guide does not
independently verify a changed move.
Question                    Finding                                      Status and consequence
                            Core actions confirmed by creator listing;   V for action set, C for touch mapping [R01
Action mapping
                            mobile guide maps them to touch controls     R02]
                            No authoritative pixel map obtained; players U; use measured local layout and calibration
Exact default iPad layout
                            report customization                         procedure
                            Four base and four awakening slots
Three core kits                                                          C; scope is explicit [R03 R05 R07]
                            documented per selected kit
                            Vanguard reference has Slap, Sneeze and
New contextual attacks                                                   C; implement in P1 [R04 R09]
                            Trashcan entries
                            Hero values, counter rules and cyborg
Numeric balance                                                          X; use D values, preserve conflict log
                            duration differ across pages
                            Sources count public, alternate and
Current entire roster                                                    U; no claim of complete current roster
                            restricted entries differently
                            Colyseus documentation now describes         V; use current contract, not old tutorials [T01–
Engine APIs
                            version 0.18 APIs                            T03]

Required fidelity check before calling the game a close reproduction
On each actual iPad, record model, iPadOS, viewport, browser chrome, Roblox build observation date and
the original game’s control settings. Capture the default layout and one customized layout with permission.
In a private reference session, measure 20 trials per input and 10 per move; record median, range and
frame rate. Compare placement, hold behavior, charge release, evasive reuse and fourth punch variants.
Store observations in docs/reference-observations.md and normalized rectangles in docs/control-
calibration.json. This gate affects fidelity claims; it does not block implementing the D defaults.




                                                                                                            Version 1.0 | 4
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



3 Reference catalog for The Strongest Hero
The following is a concise record of community reported mechanics, not a balance promise. Names in this
section are research labels only. The game’s shipped names appear in the right column. The base and
awakening catalog is corroborated across character pages. [R03 R04 R09]
Reference move            Reported behavior                           Independent move ID and label
                          Heavy direct strike with a ranged shock
Normal Punch                                                          sv.b1 Fault Strike
                          component
Consecutive Punches       Repeated forward hits                       sv.b2 Gravel Flurry
Shove                     Short push; can reflect some projectiles    sv.b3 Rift Palm
Uppercut                  Upward launcher                             sv.b4 Rising Pillar
Death Counter             Reactive lethal counter                     sv.a1 Stillpoint Reversal
Table Flip                Large ground upheaval                       sv.a2 Skybreak
Serious Punch             Large directional shock attack              sv.a3 Horizon Break
                          Capture followed by attacks from multiple
Omni Directional Punch                                                sv.a4 Orbit Collapse
                          directions

Serious Mode is reported as persisting until an awakening skill is used. Sources describe unusually fast
meter gain and no immediate activation heal. One source says twice the meter rate; another reports three
times. These are not reconciled as exact values here. [R03 R04 R11]

Additional reported context
The newer character page lists Serious Slap, Serious Sneeze and Serious Trashcan as mutually exclusive
contextual uses within an awakening, in addition to a slotted awakening skill. Map these to sv.x1 Echo Tap,
sv.x2 Gale Rebuff and sv.x3 Meteor Cast. Their existence is community documented; their exact live
triggers require an iPad reference check. [R04 R09]

Numeric conflicts worth preserving
The older page reports Normal Punch as 30 percent total including landing damage, and Consecutive
Punches as 15 percent. The newer page reports Consecutive Punches up to 14.5 percent and Shove as
6.9 percent. Do not average contradictory numbers or label the local values as measured. [R03 R04]

Identity brief
Stone Vanguard uses a broad, asymmetrical stone mantle, cropped dark hair, a charcoal and amber
palette, bare stone bracers and angular footwork. No bald yellow suited hero, red glove costume,
recognizable facial design, signature cinematic composition, copied typography or sampled voice/music.
The power fantasy is geological force. Original attack names in this document remain working names
subject to a distinctiveness review before public release.
P0 includes all eight slotted moves and the awakening. P1 adds all three contextual moves, a wall
interaction and cosmetic knockout finishers. All local timing and damage values below are D.




                                                                                                      Version 1.0 | 5
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



4 Reference catalog for Hero Hunter
This scoped kit is the standard Hero Hunter, not its separately listed Monster Form. The character page
flags unfinished and rework related content, so archived variants must not be mistaken for confirmed live
behavior. [R05]
Reference move              Reported behavior                            Independent move ID and label
Flowing Water               Capture into a sequence of strikes           td.b1 Current Bind
Lethal Whirlwind Stream     Grab, drag and slam                          td.b2 Undertow Spiral
Hunter’s Grasp              Grab and throw                               td.b3 Tidal Cast
Prey’s Peril                Counter stance; projectile reflection        td.b4 Mirror Current
Water Stream Cutting Fist   Awakened barrage ending in a slam            td.a1 Cascade Chain
The Final Hunt              Launch and aerial follow up slam             td.a2 Deepfall
Rock Splitting Fist         Powerful chop with a follow up               td.a3 Split Tide
Crushed Rock                Advancing capture and impact, with variants td.a4 Riptide Pursuit

Rampage replaces the four slots; a community page reports 49 seconds, a damaging activation, armor
during successful grabs and a finisher healing passive. These are C observations, not proprietary
implementation details. The new game uses different presentation and explicitly defines which attacks
grant armor. [R05]

Variants and limits
A contemporary derivative guide describes a close range Crushed Rock assault chain, a ranged variant,
and a character specific Martial Artist interaction. It also distinguishes a missed first hit of Rock Splitting Fist
and lists removed moves Hunter’s Cruelty and Doomed Prey. P1 includes local close and ranged branches
and the missed chop branch. The Martial Artist interaction is excluded because that fighter is outside
scope. Removed moves are not implemented. [R06]
The guide reports Flowing Water 24.5 percent, Lethal Whirlwind Stream 18.5 percent, Hunter’s Grasp 8.3
percent with collision dependence, and Crushed Rock 27 percent. These values are reference
observations only. Exact finisher thresholds, wall geometry exploits and all reported combo techniques are
not a compatibility guarantee. [R06]

Identity brief
Tide Duelist wears layered ivory and teal fabric over dark trousers, with a circular ceramic shoulder guard,
tied copper hair and an upright open palm stance. Effects are translucent ribbons and refracted droplets,
not a copied martial arts costume, hairstyle, aura, choreography or anime face.
P0 includes all eight slotted moves and awakening. P1 adds the defined variant branches, wall interaction
and original knockout effects. The default P0 branches still follow the complete local ability contract.




                                                                                                         Version 1.0 | 6
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



5 Reference catalog for Destructive Cyborg
This ranged pressure kit is P1. Its inclusion adds charge and release input, directed aerial movement and
beam attacks, which must pass the same authority tests as melee. [R07 R08]
Reference move            Reported behavior                            Independent move ID and label
Machine Gun Blows         Barrage followed by a launching hit          ea.b1 Cinder Array
                          Propulsion with a finishing blast; early
Ignition Burst                                                         ea.b2 Vent Rush
                          second press
Blitz Shot                Charged projectile, released by letting go   ea.b3 Ember Orb
Jet Dive                  Rise then descending area impact             ea.b4 Furnace Drop
                          Advancing kick and follow up; miss
Thunder Kick                                                           ea.a1 Arc Descent
                          explosion branch
Speedblitz Dropkick       Fast capture into aerial slam                ea.a2 Comet Lock
Flamewave Cannon          Sustained directional beam                   ea.a3 Furnace Ray
Incinerate                Large one use beam                           ea.a4 Solar Vent

Maximum Energy Output is a damaging transformation. One community page reports 42 seconds and
another 47 seconds. Sources also describe an extended fourth basic attack, a damaging grounded evasive
and a finisher cooldown reset. [R07 R08]

Conflicting details
The newer page excludes Flamewave Cannon and Incinerate from the reset passive. Counterability of the
grounded evasive differs between pages. Thunder Kick is listed as 40 or 41 percent; Speedblitz Dropkick
as 50 or 49 percent against standing targets. The local configuration intentionally resolves these rather
than claiming live numerical parity. [R07 R08]

Variants included in the local contract
Ember Orb supports partial and full charge; Vent Rush supports airborne aim and an early second press;
Furnace Drop supports landing impact and an interrupted fall. Arc Descent has hit, miss and interrupted
miss branches. Comet Lock has a lower damage branch for ragdolled targets. Furnace Ray and Solar Vent
specify sweep limits and repeated hit caps. The cyborg and hero joint awakening cinematic is excluded: it
is a presentation interaction, not required to reproduce the combat roles. [R08]

Identity brief
Ember Artificer is a human engineer with a segmented ceramic backpack, floating copper rings and heat
vents in independent gauntlets. Use plum, copper and pale orange; no copied cybernetic arms, hair, face,
costume, voice or transformation. Beam silhouettes, lens effects and sound envelopes must be original.
Unverified roster and update claims, including new global burst meters or character exceptions, are tracked
as P2 research. Do not create generic damage multipliers based on unsourced guide statements.




                                                                                                       Version 1.0 | 7
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



6 Player journeys and screen behavior
First visit and joining
1. Boot loads a small shell, checks WebGL2 and WebAssembly, and displays “Preparing arena” with byte
based asset progress. Unsupported hardware shows a readable explanation and Retry, with no join
request.
2. Welcome shows Play, Practice, Settings and a connection status. Arel and Nora are local preset labels;
selecting a name never authenticates a player. An adult supplied invitation authenticates the session
separately.
3. Play exchanges the invitation for a session, then shows a private lobby with room status, fighter
selection and Ready. Default room capacity is 4; target use is 2. Seats include reconnect reservations.
4. Selecting a fighter shows its four base moves, awakening overview and a 3D original model.
Unimplemented P1 kits are hidden in P0, not clickable placeholders.
5. Ready submits the selected kit and content hash. Server validates both, spawns the player and sends
the full state. Client enables gameplay only after state plus required assets are ready.

During a session
FFA has no teams and no timed round. A session scoreboard tracks knockouts, deaths and assists. A KO
awards one point; falling off an island awards the most recent hostile attacker within 8 seconds, otherwise
no scorer. A same tick tie uses the damage resolver order. A player who dealt at least 20 damage in the
previous 8 seconds receives an assist if another player receives the KO. Each victim life can award only
one KO.
Amendment (decision 0054, owner approved 2026-11-03): hosted sparring rooms and admin rooms with bots may opt in to a
`roundTarget` of 5 or 10 KOs; the server then ends the round at that score, shows results for 600 ticks, resets the
scoreboard and respawns everyone. Open FFA is unchanged and stays endless.
Death shows the scorer and a 3 second respawn countdown. The server chooses a safe spawn and
restores health. Kit changes requested in combat take effect at next respawn; a living out of combat player
may change after 8 seconds without dealing or taking damage, resetting meter and cooldowns. Never use
kit switching to heal or clear a combat timer.

Menus and interruption
Settings and the scoreboard do not pause the world. Opening Settings releases every held input and
explains “The arena continues while this menu is open.” Leave returns to Welcome and closes the room
connection. Reconnect preserves the existing fighter and life state; it does not grant a fresh spawn or
invulnerability.
Practice runs a separate server room with one stationary dummy and optional guard/ragdoll toggles.
Practice damage and meters never affect FFA. A short tutorial asks the player to move, turn, hold attack,
hold block, dash, use all four skills and awaken; each completion is server confirmed.

Error states
ROOM_FULL, INVITE_INVALID, VERSION_MISMATCH, SERVER_OFFLINE and ASSET_FAILED each
have plain language text and Retry or Back. Retry uses bounded exponential delay; never loop invitations
or silently enter another room. Do not expose stack traces to children.




                                                                                                Version 1.0 | 8
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



7 iPad touch layout
All dimensions here are D, not measured Roblox coordinates. The layout preserves the researched control
vocabulary and thumb zones. Exact visual similarity is subject to calibration; use original icons and styling.
[R01 R02 R10]
Define the safe rectangle from visualViewport and CSS env safe area insets. W and H are its CSS pixel
width and height; its origin is x0,y0. Use landscape. Scale s = clamp(min(W/1024,H/768),0.78,1.25). All
positions below are centres in the safe rectangle. Final hit targets are at least 48 CSS pixels, separated by
at least 8 pixels.
Control                    Centre formula in CSS pixels             Visual size
Movement joystick          (104s, H−112s)                           Base diameter 136s; knob 58s
Attack                     (W−92s, H−190s)                          Diameter 76s
Jump                       (W−76s, H−80s)                           Diameter 68s
Dash or Evasive            (W−180s, H−110s)                         Diameter 64s
Block                      (W−182s, H−205s)                         Diameter 64s
Camera facing lock         (W−78s, H−286s)                          Diameter 48s
Skill slots 1 to 4         (W/2 + (i−2.5)90s, H−64s)                82s by 60s
Awakening bar and action   (W/2, H−126s)                            320s by 44s
Menu and fighter           (32s,32s), (92s,32s)                     48s each
Health and name            (W/2,32s)                                240s by 32s
Scoreboard                 (W−36s,32s)                              48s

At W=1024,H=768,s=1, attack is (932,578), jump (948,688), dash (844,658), block (842,563), skills
(377,704), (467,704), (557,704), (647,704). These coordinates are reproducible acceptance fixtures.

Responsive behavior
For W<900, use s from the formula and reduce the skill strip gap to 6s; rerun the rectangle collision test. If
safe width is below 700 or H below 420, show a rotate or enlarge window panel and release inputs.
Conflict note (user requirement, 2026-11-05): iPhone landscape must be playable. Safe H below 560 uses a
compact phone cluster (D values in ControlLayout computePhoneLayout); the enlarge panel now applies only
below W 480 or H 290. This overrides the 700/420 gate above. Portrait
is supported for lobby and settings; active combat shows “Turn your iPad sideways” and does not pretend
that orientation can be forced. The avatar remains vulnerable until normal server timeout rules apply.
Layout editor in Settings allows drag, size 0.85–1.30 times default, opacity 0.35–0.90, left hand mirror and
Reset. Reject overlaps and unsafe positions. Persist normalized positions per viewport class and local
profile. On rotation, validate and fall back to defaults if necessary.




                                                                                                   Version 1.0 | 9
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



7 Touch layout reference drawing




The drawing shows the specified local landscape layout at a 1024 by 768 CSS pixel safe rectangle. It is an
engineering wireframe, not a screenshot of Roblox and not a verified original default. Use section 7
formulas as the source of dimensions.
Buttons occupy the lower corners and bottom centre. The camera drag region is the unoccupied play
surface; it does not overlap a control owner. The joystick stays anchored while the thumb moves. Skill slots
use original icons and visible numbers, while awakening has a larger separate action target.
The player may customize this arrangement after calibration. Save separate normalized layouts for wide
landscape and compact landscape, retaining minimum target dimensions. Verify the actual iPad viewport
after browser bars and safe areas are applied; do not use hardware screen pixels as CSS coordinates.




                                                                                               Version 1.0 | 10
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



8 Touch gestures and input ownership
Use Pointer Events with touch action disabled only on the combat surface. Capture each pointer on its
initial owner. Release on pointerup, pointercancel, lostpointercapture, blur, visibility loss, orientation change
and menu opening. Each pointer owns exactly one control until release; moving over another button does
not activate it. [T06]
Input                             Local behavior and server intent
                                  Fixed centre; 10s pixel dead zone; radial magnitude remapped to 0–1; cap at 56s
Joystick
                                  radius. Send a camera relative horizontal movement vector
                                  Any unowned pointer starting outside controls rotates view. Sensitivity 0.003 rad per
Camera drag
                                  CSS pixel divided by s; pitch clamp −55 to +25 degrees
                                  pointerdown requests M1; holding sets attackHeld. Server repeats at legal combo
Attack
                                  times. No synthetic browser click action
                                  Hold sets blockHeld; release clears it immediately. No toggle by default. Cannot
Block
                                  attack and guard simultaneously
                                  pointerdown sends edge; held state selects grounded fourth hit uppercut. Holding
Jump
                                  does not repeatedly jump
                                  pointerdown sends one edge, with current move vector. While ragdolled it requests
Dash
                                  evasive. Stationary request defaults forward
                                  Tap fires on pointerdown in Quick Use mode. Charge skill begins on down and
Skills
                                  releases on up. A second distinct press triggers a permitted recast
                                  One tap requests activation only if the server meter is full; never on pointerup after a
Awakening
                                  cancelled touch
                                  Tap toggles camera aligned facing; client shows a small original reticle. It is not
Facing lock
                                  automatic target lock

Multi touch and conflicts
Support at least five simultaneous pointers: move, camera, attack, jump and one skill or dash. UI
precedence is button → joystick → camera. The first pointer wins if two pointers claim the same hold
control. Ignored extra pointers cannot release the owner’s action. Releasing the camera must not stop
movement or guard.
Jump versus fourth M1: on attack commit, airborne selects downslam; otherwise jumpHeld selects mini
uppercut; otherwise the normal finisher. During an active combo, holding Jump suppresses the ordinary
grounded jump until the combo ends, allowing the uppercut gesture. A jump edge before starting the
combo is an ordinary jump. These precise priorities are local decisions.

Optional selection mode
Quick Use is on by default. If off, tapping a skill selects it and Attack activates it once; a charge skill
charges while Attack is held. Cancel selection with a second tap of the same slot, guard, another slot or 3
seconds inactivity. Selected mode is local only and does not bypass server checks. Suppress normal
attackHeld until that activation pointer is released. The original’s exact settings defaults remain U; an
update archive reports held skills with auto use. [R10]
Send neutral intent immediately when input is cancelled. Server additionally clears held actions after 15
ticks without a fresh input packet. Never rely on a pointerup packet reaching the server.




                                                                                                             Version 1.0 | 11
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



9 Camera settings and feedback
Camera contract
Third person camera pivot is character centre plus 1.1 metres. Default distance 6.5 m, allowed 3.5–10 m
via Settings slider; vertical field of view 60 degrees, near 0.1, far 180. Camera sphere cast radius 0.18 m
against static geometry pulls inward to the nearest obstruction, with 0.1 m clearance. Ease outward over
0.15 seconds; pull inward immediately. Camera position and shake never affect hit detection.
Facing lock on: horizontal camera yaw determines requested facing, validated to at most 720
degrees/second when not locked by an ability. Facing lock off: moving turns the avatar toward movement
at 540 degrees/second; while stationary keep last facing. Ability commit uses authoritative facing, except
specifically allowed aim updates. No invisible aim assist, enemy magnetism or automatic camera target
selection.
A cinematic is a local presentation of a server event. Captured participants may receive a short original
camera track; other players keep normal camera control. Reduced Motion uses the ordinary camera.
Cancel the track immediately on victim death, respawn, disconnect, menu, or scene disposal. The world
never pauses for a cinematic.

Feedback timing
Button highlight begins on local input within one render frame. Cooldown tint may show a pending outline,
but the countdown begins at the server accepted tick. Rejection clears the pending outline and shows one
of “Recovering”, “Cooling down”, “Need full meter” or “Cannot use now” for 0.7 seconds. Reject messages
are rate limited to one per reason per second.
Confirmed hits create distinct light, heavy, blocked and countered sound/visual cues. Predicted attacks can
animate a windup but cannot show confirmed damage, hitstun, KO or meter gain. Damage numbers default
off. The awakening bar shows integer percent and “Ready”; all cooldowns use one decimal under 10
seconds and ceiling integer seconds above it.

Accessibility and comfort
Default camera shake is 0.25 of authored amplitude, flash intensity 0.3 and motion blur off. Reduced
Motion disables shake, screen warps and forced cameras. Color is reinforced with shape and text. Combat
hit targets are 48 px minimum; menu targets are 44 px minimum. Sound sliders are independent for effects
and music, both bounded 0–1. Audio starts only after Play or another user gesture and resumes after
returning from background. No reliance on browser vibration.
Settings persist locally with a schema version and validated ranges: layout, sensitivity, facing lock, Quick
Use, auto run, handedness, volume, quality, reduced motion and flash level. Export/import settings JSON
is capped at 8 KB and accepts only known keys. Do not store invitations in these settings.




                                                                                                Version 1.0 | 12
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



10 Floating island arena contract
Geometry and units
Use Y up, metres, and local forward −Z. Main island walkable top is a 48 by 40 m rounded rectangle at
y=0, thickness 5 m. Four satellite islands are 12 by 12 m at centres (−36,0,0), (36,0,0), (0,0,−32), (0,0,32).
Connect with 4 m wide bridges: 6 m east and west, 6 m north and south. Bridges are permanent static
colliders. Guardrails appear only at spawn decks; combat edges remain exposed.
Use simple invisible collision hulls distinct from decorative meshes. Static obstacles on the main island:
four 3 by 2 by 2 m pillars at (±12,1,±10), two waist high walls at (−10,0.6,0) and (10,0.6,0), each 4 by 1.2 by
0.6 m. Keep the central 12 m diameter area clear. Satellite islands contain no hard cover in P0.

Spawns and falls
Eight spawn anchors are (±18,0,±14) and (±34,0,±3). Spawn capsule centre is surface height plus 0.9 m.
Reject anchors within 2 m of occupied capsules or within an active hostile hit region; choose the remaining
anchor maximizing distance to the nearest living enemy. Ties use lowest anchor ID. If none qualify, retry for
60 ticks, then choose the farthest and grant the standard spawn protection.
Void plane y=−25 causes immediate KO once per life; radial horizontal boundary 90 m does the same.
Falling itself deals no generic damage. The specific Fault Strike landing bonus is separate. Knockback can
cause ring outs. Jump and mobility abilities cannot create a safe invisible floor. A grab must abort if its next
position intersects a solid wall; release the victim at the last valid point.

Destruction and props
P0 destruction is cosmetic. No ability removes bridge or island collision. P1 adds eight server owned
throwable stone urns at centres (±9,0.25,±10) and (±15,0.25,±10), each with radius 0.25, mass
presentation only, and 10 second respawn. One can be picked up using the contextual Attack rule. Thrown
urns use authoritative swept projectile queries, not unconstrained debris physics.
Maximum 80 cosmetic fragments per client, lifetime 2 seconds, no gameplay collision. Pool shards and
dust. Large ground attacks deform a visual decal or temporary mesh layer only; they never invalidate
navigation or spawn anchors.

Map artifact acceptance
assets/maps/islands.v1.json stores collider primitives, spawn anchors, urn anchors and content hash.
Client and server load the identical collision description. A build check verifies bridge connectivity, capsule
headroom, spawn containment and all anchors above the void. Keep silhouettes and architecture
independent from the reference map.




                                                                                                  Version 1.0 | 13
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



11 Universal movement and combat values
The original held attack and fourth hit vocabulary is community documented. [R12] Every number on this
page is D. Values are tuned for readable tablet play, not claimed as original frame data. Keep them in
packages/shared/src/config/combat.ts.
System                           Exact local rule
                                 HP 100; walk 5 m/s; run 8; guard 2; acceleration 45 m/s²; air control 30 percent;
Health and movement
                                 gravity −24 m/s²
                                 Radius 0.35 m, cylindrical half height 0.55; total height 1.8 m; jump speed 8 m/s; no
Capsule and jump
                                 double jump; 6 tick coyote and jump buffer
                                 Offset 0.02 m; step height 0.3; minimum step width 0.2; max slope 45 degrees; snap
Ground control
                                 down 0.2; no snap while rising
                                 Four hits: 3,3,4,4 HP. Each has startup 8, active 3, recovery 10 ticks; fourth recovery
Basic chain
                                 30. Gap >54 ticks resets chain
                                 Box width 1.5, height 1.7, depth 1.8 m; front face at 2.1 m from centre; one hit per
M1 reach
                                 target per swing
                                 First three M1 hits stun 24 ticks; fourth ragdolls 72 ticks and adds velocity (forward 8,
Hit effects
                                 up 3) m/s
                                 Mini uppercut: 4 HP, up 10 m/s, ragdoll 72. Air downslam: 4 HP, down 16 m/s, radial
Fourth variations
                                 landing radius 1.5 m, no second damage
                                 18 ticks, speed 22 m/s, last 3 ticks have M1 sized hitbox; 4 HP, stun 24; cooldown
Forward dash
                                 300 ticks
Side dash                        12 ticks at 24 m/s; no attack; shared left/right cooldown 120 ticks; no invulnerability
Back dash                        18 ticks at 18 m/s; no attack; cooldown 240 ticks; no invulnerability
                                 Legal after 12 ragdoll ticks; 12 ticks at 20 m/s; invulnerable first 8; cooldown 1800
Evasive
                                 ticks
                                 Frontal 120 degree cone; zero default chip; blocks only attacks marked B; startup 3
Guard
                                 ticks; recovery 3 ticks

Auto run defaults on for joystick magnitude ≥0.9 for 6 ticks; stops below 0.75. With auto run off, a second
forward joystick excursion above 0.9 within 18 ticks requests run; release below 0.2 cancels it. Dash type
uses the larger absolute forward/right component of the joystick relative to authoritative facing; ties choose
forward/back. Keep normalized diagonal direction. No input means forward; stationary evasive uses facing
right. Keyboard fallback: WASD, mouse attack, F guard, Q dash, Space jump, 1–4 abilities, G awakening,
Shift facing lock, Esc menu. Double W requests run.
No passive health regeneration in P0/P1. Spawn protection lasts 120 ticks, cancels on any offensive
request accepted, and prevents dealing or receiving damage. Death resets meter, held inputs, capture,
combo and all cooldowns. Basic M1, dash and abilities share recovery permission; no animation
cancellation unless a handler explicitly allows it.




                                                                                                            Version 1.0 | 14
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



12 Authoritative state machines
Use orthogonal fields rather than a single enum for every combination. locomotion is Grounded or Airborne;
action is Idle, Guard, Dash, Windup, Active, Recovery, Stunned, Ragdolled, Captured, Awakening or Dead;
form is Base or Awakened; connection is Active or Dropped. An action instance contains startTick, endTick,
moveId, phase, targetId and generation. All deadlines are exclusive: a state is active while tick < endTick.
From                      Trigger and condition                    Transition and side effects
                                                                   Windup; commit charge/cooldown; assign cast
Idle                      Legal ability intent; cooldown ready
                                                                   ID; snapshot aim
Windup                    tick reaches activeStart                 Active; create scheduled hit phases
                                                                   Recovery; remove hit volumes and release
Active                    Last active tick completes
                                                                   capture if specified
Recovery                  tick reaches endTick                     Idle; consume one still valid buffered intent
                                                                   Guard after 3 startup ticks; disallow attack until
Idle                      blockHeld and grounded
                                                                   guard release recovery
                                                                   Dash; consume corresponding cooldown;
Idle                      Dash request and legal cooldown
                                                                   airborne horizontal dash is allowed
                                                                   Stunned or Ragdolled; cancel current cast
Any vulnerable action     Valid hit with stun
                                                                   unless protected
                                                                   Idle; ground or air state continues
Stunned                   Timer expires
                                                                   independently
                                                                   Dash with evasive flag; remove pending
Ragdolled                 Valid evasive after minimum
                                                                   landing bonus
                                                                   Recovery 12 ticks then Idle; airborne remains
Ragdolled                 Timer expires and grounded
                                                                   ragdolled
                                                                   Captured; suppress locomotion and all intents
Any capturable state      Capture wins arbitration
                                                                   except disconnect
                                                                   Awakening; form switches at completion; no
Idle                      Full meter awakening request
                                                                   attack during activation
                                                                   Dead; cancel all casts, captures and projectile
Any living state          HP reaches zero or void rule
                                                                   ownership effects
                                                                   Idle, Grounded, Base; lifeId increments; apply
Dead                      Respawn deadline and valid anchor
                                                                   protection

Interrupt ordering
At the beginning of a tick apply deaths from the prior tick and administrative removals, then expiries, input
intents, locomotion, collision queries, hit resolution and newly caused deaths. Within hit resolution,
invulnerability wins; then a valid counter; then guard; then damage and reaction. Armor ignores stun/ragdoll
from attacks without armorBreak, but still takes damage. armorBreak bypasses armor, not invulnerability.
Captured fighters can take third party damage only where the capture handler permits it.
Input priority within one player and tick: evasive → awakening → skill lowest slot index → dash → M1 →
jump → guard → movement. An illegal higher priority request does not suppress a legal lower request.
Buffer one offensive edge for 6 ticks; replace with the most recent edge, tie by lowest action number. Never
buffer awakening, dash, recast or counter stance. Held M1 is not an unbounded queue.
Action cancellation invalidates scheduled effects with the cast generation token. No JavaScript timeout
controls damage. A victim death or departure releases its captor immediately into 18 ticks recovery; no
stale joint or permanent lock may remain.




                                                                                                     Version 1.0 | 15
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



13 Hit resolution and combat invariants
Geometry and ordering
Evaluate server poses at the current simulation tick. P0/P1 do not rewind hitboxes; client supplied
timestamps cannot make historical attacks. Broad phase uses Rapier queries; exact acceptance uses
attack shape intersection, target state and static occlusion. Sweep moving attacks from their previous to
current position so a dash cannot tunnel through a target. Exclude self and the same life’s already hit
entries.
Collect candidate hits, then sort by time of impact within the tick, attacker entity ID, cast counter and hit
index. Apply that order serially. Later attacks from a player killed or interrupted earlier in the same tick are
invalid. This is a deliberate deterministic tie rule; simultaneous trades are not promised.

Guard and counter rules
For guard, flatten the vector from target to impact origin, normalize, and compare dot(target.forward,
towardImpact) ≥ cos(60°). The attacker’s screen position is irrelevant. A zero length vector counts as
frontal. B means blockable with chip 0 unless overridden; U means bypass guard. Neither implies armor
break. A blocked hit consumes its per target hit entry and adds 6 ticks blockstun. It never builds meter.
A counter can intercept only a hit marked counterable and arriving during its open interval. It consumes the
incoming hit. Reflection changes projectile owner and direction toward the original owner’s current position,
preserves damage, assigns a new cast ID and limits reflection count to one. Reflection never teleports a
projectile through a wall. A second reflection attempt absorbs it with no damage. A counter cannot
recursively trigger another counter from its response unless explicitly stated; all local counter responses are
noncounterable.

Capture arbitration and damage
Only one capture owner per victim. At capture commit test both participants alive, within reach,
unobstructed and eligible. First valid sorted candidate reserves the victim. Default capture lasts through the
scripted damage schedule, releases on final hit, and makes the victim immune to third party capture but not
ordinary third party damage. A handler explicitly marked cinematic grants both participants invulnerability to
third parties from capture until release; scheduled owner damage bypasses only that capture protection.
Damage is integer hundredths of HP internally. Clamp damage to remaining HP. Meter gain uses actual
HP removed, not overkill, blocked damage, practice damage or self damage. No meter gain while
Awakened or during an awakening activation. Store damage attribution per victim life; trim entries older
than 480 ticks.

Invariants
HP stays in [0,10000]; one KO per life; one passive reward per victim life; all cooldowns are server ticks; no
ability hits the same target more than its declared cap; no nonfinite vectors; no movement across static
collision; no orphan captures; no attacks during spawn protection; no hitbox derives from animation bone
timing.
Wall attacks require an enemy within 0.6 m of a vertical static collider, normal within 15 degrees of
horizontal, attacker within 2 m and a fourth M1 request. Reserve wall attack before normal fourth hit. P0
disables this branch; P1 enables the shared wall script in section 16.




                                                                                                   Version 1.0 | 16
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



14 Ability data schema and defaults
The following schema is an implementation contract. Generate runtime validation from it. Unknown
properties fail validation in server configuration. Reference evidence lives in a separate ledger, never in
shipped player facing labels.
type MoveId = `${"sv"|"td"|"ea"}.${string}`;
type Phase = "Base" | "Awakened";
type Shape = { kind:"box"; w:number; h:number; d:number }
  | { kind:"sphere"; r:number }
  | { kind:"beam"; length:number; radius:number };
interface AbilityDef {
  id: MoveId; slot: 1|2|3|4|null; form: Phase;
  label: string; handler: string; startup: number;
  active: number; recovery: number; cooldown: number;
  hitOffsets: number[]; damage100: number[];
  shape: Shape; range: number; block: "B"|"U";
  counterable: boolean; armorBreak: boolean;
  targetStates: ("standing"|"air"|"ragdoll")[];
  stunTicks: number; ragdollTicks: number;
  launch: { forward:number; up:number };
  armor: "none"|"startup"|"onHit";
  input: "press"|"holdRelease"|"recast"|"context";
  moveScale: number; turnRate: number;
  oncePerForm: boolean; consumesForm: boolean;
  maxTargets: number; maxHitsPerTarget: number;
  animationId: string; vfxId: string; sfxId: string;
}

Defaults applied before the per move overrides
slot follows ID suffix; base prefix b and awakened prefix a. startup/active/recovery are ticks; cooldown
starts on accepted initial press, including a miss or interruption. activeStart = startTick + startup; hitOffsets
are relative to activeStart. Default one hit at offset 0, full listed damage; maxHitsPerTarget equals the
explicit hitOffsets length where a multi hit schedule is given, otherwise 1; active is a query window, not a
repeated damage interval. Deduplicate one hit across the window.
Default shape box 2 m wide, 2 m high, depth = range, centred range/2 forward and 0.2 m up. Default
targets standing and air, maxTargets=1, stun=24, ragdoll=0, launch=(0,0), armor=none, counterable=true,
armorBreak=false, moveScale=0, turnRate=0 after commit. Before commit facing uses section 9. Attacks
may activate in air unless a card says grounded. “R72 F10 U4” overrides reaction to ragdoll 72 ticks and
velocity forward 10, up 4. Effects use IDs equal to move ID plus .anim, .vfx or .sfx.
Once per form means used bit resets only on a new awakening. consumesForm marks the awakening
spent at commit; resolve the current ability, then return Base even if interrupted. A one use miss is still
spent. Every table number is D. Handler names below are internal interfaces, not library APIs.




                                                                                                    Version 1.0 | 17
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



15 Stone Vanguard base abilities
                             Startup active
ID and label                                   Cooldown         Damage HP            Range and flags
                             recovery
sv.b1 Fault Strike           24 4 24           1200             20 plus 10 landing   3 m U; box wave 8 m B
sv.b2 Gravel Flurry          10 40 18          900              15 total             2.5 m B; max 3 targets
sv.b3 Rift Palm              8 3 14            600              7                    2mU
sv.b4 Rising Pillar          16 4 20           900              15                   2mU

Fault Strike handler faultStrike
Accept grounded or air; target states include ragdoll for direct strike. Direct hit R72 F14 U4. On direct
damage attach landingBonus=10 to that victim and cast, expiring after 120 ticks. Apply it on the first new
ground contact after at least one airborne tick; evasive, death or protection clears it. At activeStart also
query a forward box width 2, height 2, depth 8 for wave targets not directly struck; wave damage 10, R36
F6 U1, no ragdoll targets. Maximum 4 targets across direct and wave. This is a mutually exclusive damage
branch, not 20+10+10 on the same target. Acceptance: direct target cancels before landing and loses
exactly 20 HP.

Gravel Flurry handler barrage
hitOffsets=[0,8,16,24,32,39], damage=[2,2,2,2,2,5]. Query each tick group once per target. Intermediate
hits stun 12; final hit R60 F7 U2. Supports ragdolled targets; moveScale=0.15, turnRate=90
degrees/second. No capture and no armor; a third party hit may interrupt remaining hits. Maximum damage
per target is 15. Acceptance: a target entering only at offset 39 receives 5 HP damage, not the missed hits.

Rift Palm handler reflectPalm
On active ticks, first check reflectable projectile overlap with a 1.8 m radius frontal hemisphere, then melee.
At most one reflected projectile per cast; a melee hit is still permitted on one other target. Melee supports
ragdoll; stun=30; launch F2 U0, no ragdoll. A reflect does not reset cooldown or grant meter until the
reflected projectile actually damages someone. Acceptance: an incoming Ember Orb returns with its
existing charge damage and cannot bounce indefinitely.

Rising Pillar handler launcher
Supports standing, airborne and ragdolled targets. On hit R84 F1 U11; no extra damage when landing. A
target already captured by another attacker is ineligible. Aerial use applies the same shape relative to the
authoritative capsule, not to the camera pitch. Acceptance: changing animation playback speed does not
change the active tick or launch velocity.
Base abilities do not reset M1 chain progression. A chain gap greater than 54 ticks still resets normally.
Finisher art is triggered only after server confirmed lethal damage and cannot add damage or extend
capture.




                                                                                                  Version 1.0 | 18
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



15 Stone Vanguard awakened abilities
                            Startup active
ID and label                                  Use limit       Damage HP            Shape and flags
                            recovery
                                                                                   Counter trigger; U;
sv.a1 Stillpoint Reversal   0 600 18          Consumes form   Lethal on response
                                                                                   noncounterable response
                                                                                   Box 20 by 8 by 24 m; U;
sv.a2 Skybreak              90 6 45           Consumes form   100
                                                                                   armorBreak
                                                                                   Beam 32 m radius 3; U;
sv.a3 Horizon Break         72 6 42           Consumes form   100 near, 60 far
                                                                                   armorBreak
                                                                                   Capture range 3 m; U;
sv.a4 Orbit Collapse        24 6 36           Consumes form   100
                                                                                   armorBreak

Stillpoint Reversal handler lethalCounter
Commit marks the form spent and returns the base slot set immediately while leaving a counter status
open for 600 ticks. Allow base actions during that status. A valid counterable incoming hit triggers a
cinematic capture if the attacker is within 40 m and reachable without a solid wall between the pair;
otherwise absorb that hit and end the counter. On trigger, cancel both actions, grant capture protection,
and schedule 100 damage at trigger+60 ticks, then release at +72. No trigger means no damage or heal.
On successful damage heal caster to 100 HP. A noncounterable hit damages normally and may kill the
caster, ending the status. No hidden teleport through terrain.

Skybreak handler groundWave
Grounded only. Cast has invulnerability from commit through last active tick; recovery is vulnerable. At
activeStart query the forward volume, maximum 4 targets, excluding victims behind solid walls; R120 F4
U20. No actual terrain removal and no reference cinematic recreation. Heal caster by 60 HP once if any
target takes damage. Only one hit per target. The entire form is spent on a miss. Visual rocks are client
only.

Horizon Break handler longBeam
Grounded only. Same invulnerability window as Skybreak. Query beam against static cover and truncate at
first solid obstacle. Targets with distance ≤8 m receive 100, otherwise 60, maximum 4; R90 F22 U5. No
damage beyond obstruction or 32 m. Heal caster to full only if a near target takes damage; far hits heal 30
once. This finite damage rule deliberately replaces unclear source infinity and wind kill descriptions.

Orbit Collapse handler cinematicGrab
At active ticks select the nearest eligible victim, tie by entity ID. On capture both participants become
protected from third parties. Anchor the sequence to the capture point; do not move collision capsules
through the island. Schedule 100 damage 90 ticks after capture; release at +96 with R90 F6 U10, then
recovery. On miss use the listed recovery with no capture extension. Heal caster to full on successful
damage. A small cosmetic shockwave has no secondary damage. This simplified multi target treatment is
an intentional local deviation.
All awakened attacks are noncounterable except the incoming hit that triggers Stillpoint Reversal. Setting
consumesForm does not cancel the cast in progress. Damage caps remain 100 HP per target; do not
encode JavaScript Infinity.




                                                                                                Version 1.0 | 19
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



15 Stone Vanguard activation and context
Awakening activation sv.activate Ground Resonance
Required meter=200 damage points; gain 1 point per actual HP dealt in Base. This explicitly resolves
conflicting meter multipliers locally. Idle, grounded and unprotected are required. Activation lasts 30 ticks
with armor, no invulnerability, no damage and no heal. On completion set form=Awakened, meter=0, reset
awakened use bits, contextSpent=false. There is no time expiry. Death, accepted kit change, or use of a
slotted awakening consumes it. Natural health regeneration remains off.

P1 contextual attack selection
While awakened and contextSpent=false, the following inputs replace one M1 action. Priority is held urn →
wall opportunity → grounded mini uppercut finisher. They do not occupy skill slots. contextSpent becomes
true at commit even on a miss. An accepted contextual move never consumes the slotted awakening
opportunity.
ID and label               Trigger                                     Timing and local outcome
                           Fourth M1 with jumpHeld, grounded, no urn   Startup 12, active 4, recovery 30; 24 HP; box 2
sv.x1 Echo Tap
                           or wall target                              by 2 by 2 m; U; R84 F14 U6
                                                                       Startup 12, capture up to 60, recovery 24; 40
sv.x2 Gale Rebuff          Fourth M1 with valid wall target
                                                                       HP at capture+48; U; R90 F18 U3
                                                                       Startup 10, projectile life 120, recovery 24; 15
sv.x3 Meteor Cast          Attack while holding an urn
                                                                       HP; radius 0.4; speed 28 m/s; U; R60 F10 U3

All three share once per form contextSpent; there is no additional cooldown. Echo Tap and Meteor Cast
are counterable; Gale Rebuff is counterable at capture, not after capture. No invulnerability except capture
protection for Gale Rebuff. Launch flags are local outcomes, not literal source choreography. On projectile
miss the urn still returns to its anchor after 600 ticks.

Urn interaction shared by all kits
When not attacking, standing within 1.2 m of an unheld urn and pressing Attack with joystick magnitude
<0.1 picks it up after 12 ticks instead of M1. Show a small “Pick up” label on Attack only while eligible.
Holding an urn makes the next Attack throw it: ordinary throw damage 8, startup 10, speed 18, sphere
radius 0.3, B, R36 F6 U2. Guard drops it harmlessly; damage, capture or death drops it. Ground pickup is
not available in P0.

Passive and finisher policy
Faster awakening is represented by the 200 point requirement; other kits require 350. No unknown extra
stat boost is inferred. Cosmetic knockout variations use the lethal hit’s existing tick and damage. No gore,
bodily dismemberment, copied impact frames or recognizable anime sequence. The counter status is
private to the owner; the local UI shows its remaining duration, other players see only the original stance
animation.




                                                                                                         Version 1.0 | 20
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



15 Tide Duelist base abilities
                             Startup active
ID and label                                    Cooldown         Damage HP            Range and flags
                             recovery
td.b1 Current Bind           10 5 18            1020             24 total             2.4 m U; capture
td.b2 Undertow Spiral        14 5 24            1200             19 total             2.2 m B; capture
td.b3 Tidal Cast             12 4 18            900              9 plus collision 3   2.2 m U; capture
td.b4 Mirror Current         0 60 30            1020             22 response          Counter; U response

Current Bind handler captureBarrage
On initial capture schedule damage [4,4,4,4,8] at relative ticks [0,10,20,30,42]. Give caster armor on
capture; victim is susceptible to third party ordinary damage. Release at +43 with R60 F7 U3. Supports
airborne ragdoll but not grounded ragdoll. If victim dies mid sequence stop remaining damage and release.
Capture duration extends the initial active window only after a successful hit; miss transitions directly to
recovery. Acceptance: a missed initial probe cannot attach a later victim during recovery.

Undertow Spiral handler dragSlam
On capture, caster armor; schedule 5 damage at +0 and 14 at +48. Move the pair forward by 3 m over 36
ticks using swept collision; hitting a wall stops motion but not the remaining schedule. Release at +49 with
R72 F3 U8. Supports airborne and grounded ragdoll. P1 elevated branch: if cast started at least 2 m above
the surface and lands before +48, increase final damage to 24, once. This local cap replaces unbounded
slope velocity exploits. Acceptance: crossing a wall never drags the victim through it.

Tidal Cast handler throwCapture
Capture supports all three target states; apply 9 damage at +18, then release with R60 F10 U2 at +19.
Attach one collision bonus of 3 for the next 90 ticks if the victim hits a static wall, never the floor. The
thrown victim can hit one other living player for 5, B, stun 18; that third party damage cannot trigger a
counter or another thrown body collision. The first wall or player collision also deals the 3 bonus to the
thrown victim, then clears the collision marker; never apply it twice. Caster armor only during capture.
Acceptance: two nearby walls cannot multiply the 3 damage bonus.

Mirror Current handler counter
Open window [commit,commit+60). On a counterable melee hit, cancel the incoming hit, capture its
attacker within 4 m with line of sight, then deal [6,16] at trigger+[12,30]; release at +31 with R60 F8 U3.
Caster has armor, not invulnerability. If melee attacker is beyond 4 m, absorb and end stance without
response damage. A reflectable projectile triggers the shared reflection rule, ends stance and grants no
automatic melee response. Response is noncounterable. On whiff, recovery is fully vulnerable. No held
button prolongs the window.




                                                                                                   Version 1.0 | 21
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



15 Tide Duelist awakening and variants
Awakening td.activate Ocean Surge
Required meter 350; 60 tick grounded activation; armor during startup, invulnerability ticks 48–59. At tick 48
deal 20 HP in radius 5 m, U, armorBreak, noncounterable, R72 F6 U6, max 4. Heal 40 HP once at
completion. Awakened duration is 2940 ticks from completion. Timers continue during all abilities and
disconnection. A committed cast completes after form expiry, but new awakened casts cannot start. Base
cooldown clocks continue running in parallel.
                            Startup active
ID and label                                   Cooldown        Damage HP           Range and flags
                            recovery
td.a1 Cascade Chain         8 5 16             510             26 total            2.5 m U; capture
                                                                                   2.5 m U; cinematic;
td.a2 Deepfall              16 5 30            Once per form   69
                                                                                   armorBreak
                                                               38 or 26 miss
td.a3 Split Tide            16 18 24           840                                 3mU
                                                               branch
                                                               27 ranged or 30
td.a4 Riptide Pursuit       12 30 30           570                                 Travel 9 m U; capture
                                                               close

Cascade Chain captures all target states; damage [4,4,4,4,10] at capture+[0,8,16,24,32]. Caster gains
armor on capture. Release +33, R60 F5 U4. No area damage. Deepfall gives startup armor, then protects
captured participants. Damage at capture+72; release +78, R90 F4 U12. On final impact other targets
within 4 m take 20, U, noncounterable, R60 F6 U4 once. Maximum total targets 4; original victim cannot
also take area damage. A miss spends the one use.
Split Tide grants startup armor through active end. Probe at offsets 0 and 17; first hit deals 12, stun 30,
second 26, R72 F10 U4. Same victim can receive both for 38. If first misses, the second remains valid for
26. No capture; counterable; no armor break. A first hit interrupted by armorBreak prevents the second.
Riptide Pursuit selects close branch if an eligible target is within 2 m at commit. Otherwise dash forward at
18 m/s for up to 30 active ticks, stop at wall or capture. Ranged capture deals 27 at +36; close capture
deals [8,22] at +0,+36. Release +37, R72 F8 U5. Caster armor only after capture. P1 close branch may
continue once toward a second distinct target within 6 m after release: 12 tick sweep, capture then 31
damage at +30. Never recapture the same life; total cast duration cap 150 ticks; no extra cooldown reset.
Counterable initial captures; no copied character specific clash.
Finisher passive heals caster once per victim life: b1 35, b2 30, b3 20, b4 40, a1/a2/a3 50, a4 zero. Only a
lethal hit to a living enemy qualifies; corpse farming is deliberately excluded.




                                                                                                 Version 1.0 | 22
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



15 Ember Artificer base abilities
                             Startup active
ID and label                                    Cooldown         Damage HP           Range and flags
                             recovery
                                                                 21 standing or 13
ea.b1 Cinder Array           10 40 24           900                                  2.5 m B; max 3
                                                                 ragdoll
ea.b2 Vent Rush              10 24 24           1020             15 front; 10 rear   Travel 8 m; radius 2.5 m B
                             Charge 0–180
ea.b3 Ember Orb                                 1500             15 or 25 full       Projectile 40 m, radius 0.35
                             then 6 release
ea.b4 Furnace Drop           18 48 30           1020             20                  Impact radius 4 m B

Cinder Array uses hit offsets [0,8,16,24,32,39], standing damage [2,2,2,2,3,10], ragdoll damage
[1,1,1,1,2,7]. Snapshot target branch at its first hit, not on every tick. Final hit R72 F3 U9. moveScale=0.2,
turnRate=90 degrees/second. In air hold caster vertical velocity at zero through active ticks. Armor none.
Vent Rush moves along commit aim at 20 m/s during active ticks, with sweep and wall stop. A second
press after 6 active ticks ends travel early; pressing before that is ignored. Rear blast at activeStart: radius
2 m centred 1.5 m behind, 10 HP, U, R36 F4 U2. Front blast at travel end: sphere radius 2.5 centred 1.5 m
ahead, 15 HP standing or 24 ragdoll, chip 6, R72 F10 U3. A target may take only the larger of the two
phases: reserve rear candidates and apply rear damage only if not hit by front, at travel end. No gain from
duplicated phases. Air aim pitch is clamped −45 to +45 degrees; floor collisions end motion.
Ember Orb is holdRelease. Server starts charge on accepted down, releases on up or after 180 ticks; every
hold packet refreshes the lease. A stale input lease cancels charge with no shot and keeps cooldown.
Partial charge damage 15, B with chip 5; only full 180 tick charge deals 25, U. moveScale=0.15,
turnRate=120 degrees/second, vertical velocity frozen in air. On release: 6 tick windup, spawn at capsule
front clear of walls, speed 24 m/s, life 120 ticks, path has a fixed 0.5 m lateral arc easing back to centre at
20 m. Sphere sweep each tick. On collision radius 2 m splash, max 4, damage applied once; R60 F6 U3.
Reflectable; direct and splash do not stack.
Furnace Drop rises with velocity +10 for 18 ticks, then aims toward a point up to 8 m ahead and descends
at 18 m/s. Impact on first ground contact within 48 active ticks; otherwise expire into normal fall without
explosion. Damage 20, chip 4, R84 F4 U10. Interruption cancels damage and restores gravity. Aerial start
follows the same cap.




                                                                                                   Version 1.0 | 23
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



15 Ember Artificer awakening abilities
Awakening ea.activate Stellar Furnace
Meter requirement 350; grounded activation 90 ticks. Armor throughout; no invulnerability. Radius 5 m
damage pulses at 0 and 72 ticks, each 16 HP, U, noncounterable, R60 F4 U3; maximum 4 targets and one
hit per pulse. Heal 40 at completion. Duration 2820 ticks from completion. Caster cannot gain meter from
activation. This chooses the reported 47 second duration as a D tuning value, not verified parity.
                             Startup active
ID and label                                    Cooldown         Damage HP           Geometry and flags
                             recovery
ea.a1 Arc Descent            30 18 30           900              40 hit or 20 miss   Swept reach 8 m; U
                                                                 50 standing or 30   Sweep 16 m; U;
ea.a2 Comet Lock             20 24 36           1200
                                                                 ragdoll             noncounterable
                                                                                     Beam length 24, radius 1 m;
ea.a3 Furnace Ray            30 90 30           1500             35 maximum
                                                                                     B
                                                                 70 near or 30 far   Beam length 36, radius 3 m;
ea.a4 Solar Vent             72 180 48          Once per form
                                                                 maximum             U

Arc Descent advances at 24 m/s during active ticks, stopping on wall. Startup armor; initial hit counterable.
On capture grant cinematic protection; deal 15 immediately and 25 at +36, release +42 R84 F5 U8. If initial
probe misses, enter 30 tick vulnerable blast windup then explode radius 5 for 20, U, noncounterable, R60
F5 U5. If interrupted during that windup, emit one smaller radius 2 blast for 13 before cancellation; if killed,
emit none. No miss branch if a captured victim dies after capture.
Comet Lock travels at 40 m/s for up to 24 ticks. Startup vulnerable; dash and capture invulnerable. On hit
capture all target states; branch is fixed at capture. Deal branch damage at +54; nearby other targets within
4 m take 20, chip 5, R72 F5 U6. Victim excluded from splash. Release +60 with R90 F3 U8. Motion and
capture are bounded by static collision. On miss enter vulnerable recovery. Noncounterable does not mean
it can hit invulnerable targets.
Furnace Ray emits seven pulses at [0,15,30,45,60,75,89], each 5 HP, max 4 targets; no more than 35 per
target. Clip beam at solid cover; turnRate=30 degrees/second; movement zero, vertical velocity zero. Gain
armor after first confirmed damage through active end. Each pulse stuns 18 and pushes 1 m/s along the
beam; chip 1 each. Counterable; interruption clears pending pulses.
Solar Vent emits ten pulses at [0,20,40,60,80,100,120,140,160,179]. At each pulse distance ≤10 m deals 7,
otherwise 3; total cap 70 per target. U, counterable, no armor; turnRate=15 degrees/second; vertical
velocity zero. Stun 24, forward velocity 2 m/s. Cover truncates the beam. Miss or interruption spends the
use. No cumulative wall trapping damage beyond the ten pulses.




                                                                                                  Version 1.0 | 24
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



16 Shared variants passives and handler tests
Cyborg passive equivalents
Extended fourth M1: Ember Artificer uses depth 2.6 m and launch F10 U4; mini uppercut U12. Other hits
retain universal values. Grounded evasive creates one radius 2.5 m blast on evasive tick 0 for 14 HP, B,
noncounterable, stun 18, max 4; airborne evasive has no blast. The local counterability choice resolves the
source conflict explicitly.
On a lethal ability hit, reset ea.b1–b4 and ea.a1–a2 cooldown end ticks to the current tick. Never reset
ea.a3 or ea.a4, once use bits or evasive. One reward per victim life, awarded to the actual killer only.
Deferred hit phases from the same cast cannot trigger a second reset. A room restart does not restore
dead bodies as rewardable targets.

P1 wall attack shared handler
With the section 13 wall condition, replace the fourth M1 with wallCombo. Startup 8, capture window 3,
scheduled hits [3,3,6] at capture+[0,12,30], release +36, recovery 18, cooldown 360 ticks. Initial capture B
and counterable; subsequent hits cannot be countered. Caster armor during capture. Release victim R60
F7 U3 away from wall. For Vanguard awakened context, Gale Rebuff takes priority and uses its own
values. Kit specific original animations share this deterministic behavior; exact reference wall choreography
and damage are not reproduced.

Handler implementation interface
interface AbilityHandler {
  canStart(ctx: CombatContext, def: AbilityDef): Reject | null;
  start(ctx: CombatContext, def: AbilityDef): Cast;
  step(ctx: CombatContext, cast: Cast): HitIntent[];
  recast?(ctx: CombatContext, cast: Cast): void;
  release?(ctx: CombatContext, cast: Cast): void;
  cancel(ctx: CombatContext, cast: Cast, why: CancelReason): void;
}

Cast stores immutable initial aim, tick, generation and definition hash; mutable phase, hit registry, captured
life ID, branch, deadlines and local counters. cancel must be idempotent and restore gravity, input
permission, capture protection and temporary armor. Never change a shared AbilityDef at runtime. Use a
fresh cast instance.

Mandatory per ability tests
Generate tests for every 24 slotted and 3 context IDs: accepted use; cooldown rejection; correct phase
ticks; miss; valid hit; no duplicate damage; correct block behavior; counter behavior; interrupted startup;
caster death; victim death; static occlusion; ragdoll eligibility; form expiry; two clients observing the same
result. Charge and recast add cancellation, lease timeout and duplicate edge tests. Cinematic captures add
owner removal and simultaneous capture tests. Beam tests hold a target against a wall for the full duration
and assert the damage cap.
Reference quirks intentionally excluded: corpse farming, infinite damage values, client owned hit claims,
wall tunnelling, physics exploit damage amplification and copied cinematic clashes. Maintain these as
documented deviations, not unresolved implementation choices.




                                                                                                 Version 1.0 | 25
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



16 Ability normalization and handler boundaries
This page supplies implementation defaults for cases where a card describes a sequence rather than one
fixed hit window. It is part of the local contract and takes precedence over generic shape defaults for these
handlers.

Cast timing and data completion
A cast starts at commit tick c; active interval is [c+startup,c+startup+active). A probe that captures extends
the cast through captureTick+lastScheduledOffset+1, then recovery begins. On miss, recovery begins at
the end of the probe window. Cooldown is measured from c even when the cast has a charge or capture
extension. For once per form actions use cooldown=0 plus oncePerForm=true; it does not mean reusable.
A consuming Vanguard move has both oncePerForm and consumesForm. All other slotted skills have
consumesForm=false.
Ember Orb has variable charge stage 0–180 ticks, then startup=6, active=1 spawn tick, recovery=24. The
projectile remains alive independently of recovery. Meteor Cast has startup=10, active=1, recovery=24; its
projectile life is 120. A dead or disconnected owner does not erase an already fired projectile; it retains
attribution to that owner life and expires normally. It cannot grant meter, healing or cooldown reset to a new
life. This overrides removal of owner effects on death only for detached projectiles; held beams and
scheduled capture damage always cancel.

Exact special shapes
Dash/capture sweeps use sphere radius 0.6 m at capsule centre+0.2 m Y, swept over the previous to next
authoritative centre. This applies to Arc Descent, Comet Lock and Riptide Pursuit. Their stated range limits
total caster travel from activeStart; stop at the smaller of that range, active duration travel or solid collision.
All spherical area attacks centre on the stated impact or caster position, use 3D distance and static line of
sight. No target is hit across an island slab.
Skybreak’s box is width 20, height 8, depth 24, centred 12 m forward and 2 m above caster centre. Other
box attacks use section 14. Beams begin 0.6 m forward of capsule centre+0.4 m Y and extend along
allowed aim. Clip the beam against static geometry before testing player capsules. Arc Descent’s missed
blast and any collateral area effect exclude the caster. Generic area events target at most four opponents;
melee barrage maxTargets is per cast, not per pulse.

Remaining rules
All cooldowns persist while in another form; base slots display their own timers on return. New awakening
resets only awakened use bits and contextSpent, not base cooldowns. Activation is accepted only from
grounded Idle and does not cleanse stun. Meter gain is floor(actualDamage100/100) points with fractional
remainder retained in meter100; no artificial rounding loss per pulse. Player meter100 thresholds are 20000
or 35000, while HUD percent is threshold normalized.
Temporary gravity suspension sets vY=0 each tick while active and restores ordinary gravity on exit; it does
not restore the old velocity. Prop pickups, wall actions and M1 finishers share the offensive permission
check. Counterable defaults remain true unless an explicit card says otherwise; armor is not damage
reduction. P1 generic finishers are cosmetic on lethal damage only, so they do not require unverified
original HP thresholds.




                                                                                                     Version 1.0 | 26
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



17 Architecture and dependency baseline
Process boundaries
The iPad runs a Vite built TypeScript client with Three.js rendering and a local Rapier world for movement
prediction against static colliders. The Mac Studio runs one Node.js process with Colyseus rooms,
authoritative Rapier worlds and an HTTP session service. One same origin HTTPS entry serves the client,
HTTP endpoints and WebSocket upgrade. No Redis, database server or multi process matchmaking is
required for four players.
The authoritative world is headless. It never imports Three.js, browser APIs or asset loaders. Shared
modules contain serializable types, pure arithmetic, data validators and collision descriptions. Client
presentation consumes events and snapshots; it cannot mutate server state. Data registries are bundled
and hashed. Both sides refuse a connection with incompatible protocolVersion or contentHash.

Version baseline observed on 1 November 2026
These versions were read from the npm registry during specification research. Availability does not prove
mutual compatibility; task T01 must compile and run the adapter smoke test before the lockfile is accepted.
Use exact versions, no caret or tilde. [T09]
Package                   Version                                 Role
colyseus                  0.18.10                                 Rooms, authenticated matchmaking, transport
@colyseus/sdk             0.18.9                                  Browser client and reconnection
@colyseus/schema          5.0.43                                  Replicated state encoding
@dimforge/rapier3d-
                          0.21.0                                  Shared static collision and server queries
compat
three                     0.187.0                                 WebGL2 renderer
typescript                7.0.2                                   Type checks and build
vite                      8.3.5                                   Client build
vitest                    5.0.5                                   Unit and headless integration tests
@playwright/test          1.64.1                                  Browser journeys and layout checks
zod                       4.6.7                                   Strict runtime message validation

Use Node 24 LTS, pnpm workspace and a committed lockfile; pin the exact Node 24 patch and pnpm
version in T01 after checking their official release metadata. Do not silently downgrade dependencies or
combine an old Colyseus tutorial with 0.18 imports. Verify @types/three, transport and test adapter
versions against package peer dependencies; record exact resolutions in docs/dependencies.md.

Colyseus adapter decision
Use 0.18 room lifecycle and reconnection hooks. This specification uses a custom fixed step accumulator
inside setTimestep(callback, 1000/60) and custom input packets. Do not also enable built in prediction or a
second physics scheduler. patchRate=50 ms, maxClients=4, maxMessagesPerSecond=90. onDrop
reserves 20 seconds; onReconnect restores the same life; onLeave cleans up. API signatures are checked
in T01 because docs and published packages can drift. [T01 T02 T03]




                                                                                                    Version 1.0 | 27
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



18 Project tree and module ownership
elemental-battlegrounds/
  AGENTS.md
  package.json pnpm-workspace.yaml pnpm-lock.yaml
  tsconfig.base.json .node-version .env.example
  apps/
    client/
       index.html vite.config.ts
       src/
         main.ts app/AppFlow.ts app/SettingsStore.ts
         input/PointerRouter.ts input/IntentSampler.ts
         input/ControlLayout.ts input/KeyboardRouter.ts
         net/RoomClient.ts net/ClockSync.ts
         net/Prediction.ts net/SnapshotBuffer.ts
         scene/GameScene.ts scene/CameraRig.ts
         scene/FighterView.ts scene/EffectsPool.ts
         ui/Hud.ts ui/Lobby.ts ui/Settings.ts
         assets/AssetManifest.ts audio/AudioBus.ts
    server/
       src/
         main.ts http/sessionRoutes.ts
         auth/InviteStore.ts auth/SessionStore.ts
         rooms/ArenaRoom.ts rooms/PracticeRoom.ts
         state/ArenaSchema.ts state/PlayerSchema.ts
         sim/World.ts sim/FixedClock.ts
         sim/Movement.ts sim/ActionMachine.ts
         combat/HitResolver.ts combat/CaptureRegistry.ts
         combat/MeterSystem.ts combat/RespawnSystem.ts
         abilities/AbilityRunner.ts abilities/handlers/
         net/ValidateInput.ts net/RateLimits.ts
         ops/Health.ts ops/StructuredLog.ts
  packages/shared/src/
    protocol.ts schema.ts math.ts movement.ts
    config/combat.ts config/abilities.ts
    config/arena.ts config/abilityOverrides.ts
    evidence/referenceCatalog.ts
  assets/
    fighters/ animations/ effects/ audio/ maps/
    manifest.json provenance.csv
  tests/
    unit/ combat/ integration/ browser/
    fixtures/ load/ device/checklist.md
  ops/
    launchd/com.elemental.arena.plist
    scripts/start.sh scripts/stop.sh scripts/smoke.sh
    scripts/invite.ts README.md
  docs/
    spec.md decisions/ dependencies.md
    reference-observations.md control-calibration.json
    tasks.md test-results/ asset-guidelines.md

Ability handlers are named functions, not a switch that grows without tests. Keep handler state in Cast,
world authority in sim, render objects in scene, and DOM listeners in input/ui. Every long lived object has
dispose(). Package boundaries are enforced through import rules. No client imports apps/server or secret
bearing modules. shared/evidence is build excluded from the browser bundle so research names are not
accidentally shipped as UI labels.




                                                                                               Version 1.0 | 28
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



19 Network message contracts
Protocol version is 1. Transport is Colyseus over secure WebSocket. Packets are reliable and ordered by
transport, but validate duplicates and reconnect epochs at the application boundary. Never trust a client
claimed player ID; derive identity from the authenticated Client.
type Edge = { id:number; kind:"jump"|"dash"|"skillDown"
  |"skillUp"|"awaken"; slot?:1|2|3|4 };
interface InputPacket {
  v:1; epoch:number; seq:number; sampleTick:number;
  moveX:number; moveZ:number; yaw:number; pitch:number;
  attackHeld:boolean; blockHeld:boolean; jumpHeld:boolean;
  runHeld:boolean; chargeHeldSlot:0|1|2|3|4;
  edges:Edge[];
}
interface ActionResult {
  epoch:number; seq:number; edgeId:number;
  accepted:boolean; tick:number; castId?:string;
  reason?:"STATE"|"COOLDOWN"|"METER"|"FORM"|"INVALID";
}
interface CombatEvent {
  eventId:string; tick:number; kind:"cast"|"hit"|"block"
    |"counter"|"capture"|"release"|"ko"|"respawn";
  actorId:string; targetId?:string; lifeId:number;
  moveId?:string; damage100?:number; position?:Vec3;
}

Send input at 30 Hz; send a new packet immediately for edges if the rate bucket permits. Max 45 input
packets/second sustained, burst 15. Max 6 edges per packet, 20 per second sustained, burst 8. moveX/Z
and yaw/pitch must be finite; clamp vector length to 1, pitch to the permitted ability range, and angular delta
to the applicable turn rate. seq and edge IDs are monotonic uint32 within an epoch; renew the epoch
before wrap. Reject unknown keys, wrong version, stale epoch and packets >1024 bytes.
Input coordinates are world horizontal vectors already transformed from camera space; the server still
normalizes them. sampleTick is diagnostic only and cannot schedule a past or future hit. Process latest
held values at the next server tick, and unique edges in arrival order under section 12 priorities. An old seq
cannot overwrite newer holds. Ack the newest processed seq in owner state; send one ActionResult per
edge. M1 hold repeats have server generated cast IDs, no edge ID.
Other client messages: ready {kitId,contentHash}, changeKit {kitId}, ping {nonce,clientMs}, leave {}. Server
messages: welcome {epoch,serverTick,tickRate,contentHash}, actionResult, combatEvent, pong
{nonce,serverMs,serverTick}, shutdown {deadlineMs,reason}. Rate limits: ready/changeKit 2 per second;
ping 1 per second; no arbitrary client events. All message schemas are versioned and tested independently
of UI.




                                                                                                 Version 1.0 | 29
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



20 Replicated state and HTTP interface
State schema
RoomState contains protocolVersion, contentHash, serverTick, mapId, phase, players and projectiles.
Player records contain entityId, lifeId, kitId, position xyz, velocity xyz, facingYaw, hp100, action,
actionStartTick, actionEndTick, moveId, form, formEndTick, meter100, cooldownEndTicks[4],
awakenedUsedMask, contextSpent, connected, protectedUntilTick, kills, deaths and assists. Owner only
fields include ackSeq, ackInputTick, epoch, pendingKit, evasiveEndTick and chargeStartTick. Do not
replicate invites, tokens or internal auth identifiers.
Projectiles contain entityId, castId, ownerId, ownerLifeId, spawnTick, position, velocity, chargeClass,
remainingTicks and reflectionCount. They are authoritative gameplay entities; visual debris is not
replicated. On each 20 Hz patch include the current serverTick alongside positional fields. Encode
positions to centimetres and yaw to 1/1024 turn in schema adapter code; the simulation retains full
precision. Health is integer hundredths; cooldowns are absolute ticks, not decremented network counters.

HTTP endpoints

Route                     Authentication and request                     Response and errors
GET /healthz              None; no details                               200 {ok:true}; 503 if not ready
GET /api/version          None                                           200 {protocolVersion,contentHash,buildId}
                          Same origin;                                   201 with HttpOnly session cookie and
POST /api/session
                          {invite:string,displayName:string}; max 1 KB   {expiresAt}; 401 invalid, 429 rate limited
                          Valid session cookie; {roomCode:string};       200 {ticket,expiresAt,roomName};
POST /api/join-ticket
                          CSRF header                                    401/403/409/429
DELETE /api/session       Cookie plus CSRF                               204; revoke session and disconnect sockets
GET /api/csrf             Valid cookie; same origin                      200 {csrfToken}; no cache

A join ticket is random 256 bit, one use, valid 30 seconds, bound to session, room, content hash and
protocol. Pass it as a join option; Colyseus onAuth consumes it atomically. The room cannot be joined
merely by guessing its ID or calling joinOrCreate directly. Allow only configured room names; server owns
room creation. Cookie is Secure, HttpOnly, SameSite=Strict, Path=/, 8 hour idle session with 24 hour
absolute expiry. Refresh idle expiry only on authenticated activity.
Display names are plain text 1–16 Unicode grapheme clusters; reject control characters and render with
textContent. Presets Arel and Nora are conveniences, not identities. Invitation tokens never appear in logs.
Invitation links use a URL fragment consumed by the Welcome page and removed with
history.replaceState before requests. No token in query strings, analytics or referrers.
Session and invitation hashes are stored in a small local SQLite file or an atomic JSON store for P0;
choose atomic JSON as baseline. Write temp file, fsync and rename; permissions 0600. Server memory
remains the authority for active rooms; no combat persistence is required.




                                                                                                           Version 1.0 | 30
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



21 Fixed simulation loop and movement
Use a monotonic clock, dt=1/60 second, at most 5 catch up steps per scheduler callback. Track overload
separately. Physics and combat each run exactly once per logical tick; render rate cannot accelerate
cooldowns. Rapier world.timestep is dt. The official character controller computes corrected displacement
against geometry; gameplay supplies gravity, jump and knockback. [T04 T05]
onScheduler(elapsedMs):
  accumulator += min(elapsedMs, 250)
  steps = 0
  while accumulator >= 1000/60 and steps < 5:
    tick += 1
    expireStatesAndReservations(tick)
    drainValidatedIntents(tick)
    clearHoldsIfLeaseExpired(tick, 15)
    runActionTransitions(tick)
    for player in stableEntityOrder:
      desired = integrateMovementAndAbilityMotion(player, dt)
      corrected = controller.computeMovement(desired, staticWorld)
      stageKinematicPosition(player, corrected)
    physics.step()
    hits = querySweptAttacksAndProjectiles(tick)
    resolveHitsInStableOrder(hits)
    releaseInvalidCaptures(); processDeathsAndRespawns()
    publishSchemaFields(); recordReplayChecksum()
    accumulator -= 1000/60; steps += 1
  if accumulator >= 1000/60:
    recordOverload(); accumulator = min(accumulator,1000/60)

Dropping excess accumulated time slows simulation relative to wall time under overload; it never grants
extra hits or accelerates timers. Alert if this occurs more than 3 times in 10 seconds. Stop accepting new
players while overloaded. Match timers are simulation ticks; invite/session/reconnect deadlines use
monotonic wall time. No request may submit its own dt.

Motion integration
Player collider is position based kinematic. vHorizontal approaches desiredVelocity by acceleration*dt,
unless action motion overrides it. vY += gravity*dt unless grounded or a handler suspends gravity.
desiredTranslation = velocity*dt; character controller adjusts it against static geometry. Apply next
kinematic translation, then step. Filter player capsules out of movement collision to avoid client prediction
dependence on remote poses; combat still hits their hurt capsules. Local players can overlap but cannot
push each other through cover.
Knockback replaces velocity components using the hit origin’s horizontal direction; if zero distance, use
attacker forward. Ragdoll is an authoritative capsule with ballistic motion, not a networked skeleton. Visual
limbs are procedural only. Ground normal dot up must exceed cos(45°) to count grounded. Detect landing
from previousGrounded=false to currentGrounded=true with downward prior velocity.
Use seeded random only for cosmetic spawn choices that are not covered by a deterministic rule. Replay
records validated inputs, seed, config hash and server build; never promise cross platform bitwise Rapier
determinism. Test numerical tolerance and state invariants on the pinned runtime.




                                                                                                 Version 1.0 | 31
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



21 Hit resolver and protocol adapter pseudocode
These are algorithms to implement, not complete game source. Keep all shape queries and state mutation
on the server. The network adapter queues intent; it never calls damage directly.
validateAndQueue(client, packet):
  player = authenticatedPlayerFor(client)
  require strictSchema(packet) and boundedPacketSize(packet)
  require packet.epoch == player.inputEpoch
  require packet.seq > player.lastReceivedSeq
  consumePacketRateTokenOrReject(client)
  require finiteAndBoundedVectors(packet)
  for edge in packet.edges:
    if edge.id > player.lastEdgeId:
      consumeActionRateTokenOrReject(client)
      queue(edge, arrivalTick, player.entityId)
      player.lastEdgeId = edge.id
  replaceHeldIntent(player, normalized(packet))
  player.lastReceivedSeq = packet.seq
  player.lastInputTick = tick

resolve(hit):
  if invalidLifeOrCastGeneration(hit): return
  if hitAlreadyRecorded(hit.cast, hit.target, hit.phase): return
  if deadOrProtectedOrOutOfRangeOrOccluded(hit): return
  if not eligibleTargetState(hit): return
  recordHitOnce(hit)
  if eligibleCounter(hit):
    consumeIncomingHit(); triggerCounterOrReflect(); return
  if blockableAndInGuardCone(hit):
    applyChipAndBlockstun(); emitBlock(); return
  damage = min(hit.damage100, target.hp100)
  target.hp100 -= damage
  creditDamageToCurrentLife(hit.owner, damage)
  if not armorStopsReaction(hit): applyStunOrRagdoll(hit)
  if target.hp100 == 0: finalizeKOOnce(target.lifeId)
  emitHit(hit, damage)

cancelCast(cast):
  if cast.cancelled: return
  cast.cancelled = true; cast.generation += 1
  cancelFutureHitPhases(cast)
  releaseOwnedCaptureIfAny(cast)
  removeTemporaryArmorAndGravityOverride(cast)
  enterRecoveryUnlessDead(cast.owner)

A reflected detached projectile retains its new owner and that owner’s life ID. Meter and passive rewards
require that same owner life to remain alive. The schema/state adapter publishes after all tick mutations.
Do not emit a mutable object reference into asynchronous logging or event delivery; serialize an immutable
copy. Event IDs are roomEpoch:serverTick:counter. Client event dedup keeps a bounded 2048 entry ring.
State is authoritative even when a cosmetic event was missed; a late join reconstructs current actions from
moveId and actionStartTick rather than replaying old explosions.
Transport room hooks use onCreate for registry/world initialization, onAuth for ticket consumption, onJoin
for entity allocation, onDrop/onReconnect for seat preservation, onLeave for permanent removal and
onDispose for world cleanup. No authentication secrets belong in replicated schema. Validate actual
installed Colyseus signatures in T01, with a real join, patch, drop and reconnect smoke test.




                                                                                              Version 1.0 | 32
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



22 Prediction interpolation and reconnection
Local prediction
Predict locomotion against the shared static collider map at 60 Hz using the same movement function.
Keep up to 120 tick samples of movement intent and predicted pose. Do not predict damage, capture, KO,
meter, passive rewards or successful counters. A provisional cast animation may start, but the server
acceptance tick controls its real phase.
A 30 Hz input sample represents held intent until superseded. Owner snapshots also include
acknowledged input receive tick so replay can anchor the held interval. For replay, store the client’s
estimated server tick and duration of that intent, not simply one movement step per packet. Server ackSeq
confirms intent processing, not that the two machines stepped at identical times. On owner snapshot, reset
the prediction base to authoritative position/velocity/action at snapshot.serverTick and replay locally
buffered held inputs for subsequent estimated ticks, capped at 12 ticks. Discard edges already
acknowledged; never replay damage side effects.
If positional error ≤0.1 m, ease visual offset over 6 frames; between 0.1 and 2 m, correct simulation
immediately and ease visual mesh over 100 ms. Above 2 m or on capture, teleport, death or respawn, snap
and clear old prediction. Collision logic always uses corrected pose, never smoothed mesh pose. When
stunned or captured, suspend locomotion prediction until a newer server action permits it.

Remote presentation and clocks
Buffer snapshots for 100 ms, interpolate position and shortest path yaw. Extrapolate at most 100 ms with
last velocity, then freeze and show connection uncertainty. Never extrapolate damage. Estimate server
time from a ping midpoint, median of the last 8 samples; clamp clock corrections to 5 ms/frame unless
reconnecting. Display cooldown using estimated serverTick but let server rejection settle discrepancies.

Connection lifecycle
On unexpected loss show “Reconnecting” and disable input. Clear all held states and provisional actions.
Server onDrop sets connected=false, neutralizes input and reserves the seat for 20 wall clock seconds.
Avatar remains present, vulnerable and subject to void/death rules; no disconnect escape. After 20
seconds onLeave removes it and releases captures. Graceful leave has no reservation. [T03]
On successful reconnect receive a full authoritative state, increment input epoch, reset seq/edge IDs, clear
snapshot and prediction buffers, and resume only after the new welcome arrives. Preserve health,
cooldowns, form and scores; a dead avatar stays dead until the usual respawn deadline. Disable SDK
offline gameplay message buffering or drop queued old epoch packets explicitly. Keep a reconnection
token in sessionStorage for reload recovery, never localStorage; redact it from logs.
If the server restarts, room state is lost. Show “Arena restarted” and return to the lobby using the still valid
session if available; no silent reconstruction of stale combat. Content changes require reload after leaving
the room, never hot swap collision or abilities mid session.




                                                                                                   Version 1.0 | 33
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



23 Rendering animation assets and audio
Scene and lifecycle
One WebGLRenderer, one scene, one camera per active game. Use WebGL2; initialize Rapier before
joining. Render independently with requestAnimationFrame. Resize canvas from its displayed CSS
rectangle and update camera aspect; cap the internal pixel count rather than blindly using
devicePixelRatio. Dispose materials, textures, geometries, audio nodes, listeners and room subscriptions
on exit. [T07 T08]

Asset contract
Each fighter has an independently authored glTF 2.0 model with one consistent rig and named clips: idle,
walk, run, jump, fall, land, guard, dashFront, dashSide, dashBack, hitLight, ragdollPose, getup, death, plus
the ability IDs. Use one shared rig when practical. Gameplay timing is stored in ability data; clip duration is
retimed to the server phase, with markers used only for visual and sound effects.
Required manifest entry: id, path, SHA256, byteSize, license, author, sourceURL or commission reference,
creationMethod, rigVersion and bounds. Empty provenance fails the production build. Keep original source
files for art and audio. No extraction from Roblox, wiki GIFs, anime footage, game sounds or community
asset rips. Reference names exist only in research records. A renamed asset alone does not establish
independent creation.

Art limits and readable combat
P0 uses original geometric fighters and simple effects with the final scale and silhouettes; P1 replaces them
without changing hitboxes. Use cel shading with three tonal bands, one directional light and an ambient
hemisphere. Maximum one shadow casting light, shadow map 1024 on medium and disabled on low. Avoid
full screen post processing on low; no motion blur. Telegraph large attacks with ground shape and charging
silhouette visible before damage.
For each move create an original windup, active and recovery pose. Big ground attacks use stone fans,
circular fractures and original motion rhythm. Water moves use ribbon arcs. Heat moves use rings and heat
particles. No source camera shot recreation, logos, sound samples or title typography. KO effects are dust,
light and a falling silhouette with no gore.

Audio and effects
Unlock AudioContext on Play. Sound event is keyed by combatEvent.eventId; deduplicate across
reconnect and replay. Maximum 16 simultaneous one shots; prioritize local hits, then nearby major abilities,
then ambience. Spatial attenuation reaches zero by 45 m. Limit combined loudness through a master
compressor; maintain volume sliders. No autoplay music before interaction.
All effects use pools and an expiry tick. Maximum 200 active particles on low, 600 medium, 1000 high;
translucent layers should not cover the entire screen. Reduce particle density first under load. Gameplay
telegraphs cannot be removed by quality scaling. Context loss pauses rendering and inputs, shows
Recovering graphics, and rebuilds from authoritative state after restoration.




                                                                                                  Version 1.0 | 34
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



24 Performance budgets and hosting
Measurable budgets

Area                            Target and required measurement
                                Median ≥55 FPS, p95 frame ≤25 ms during 10 minute ordinary play; no sustained <30
Two actual iPads
                                FPS for >3 s
Four player stress              p95 frame ≤33.3 ms for 5 minutes with overlapping awakenings on low quality
                                JS heap steady state ≤150 MB where measurable; no upward trend >20 MB across
Client memory
                                10 room joins
                                ≤120 draw calls and ≤300k visible triangles on medium (raised from 150k by decision 0048); 512 by 512 typical character
GPU budget
                                textures, 1024 maximum
                                Low ≤0.75 million, medium ≤1.5 million, high ≤2.5 million; scale 0.6–1.5 relative to
Rendering pixels
                                CSS
Initial load                    Compressed shell ≤1 MB; playable P0 assets ≤15 MB; P1 full cache ≤35 MB
Server tick                     Four players: p95 ≤4 ms, p99 ≤8 ms; no backlog sustained beyond 3 callbacks
Network                         Steady per player upstream ≤8 KB/s, downstream ≤30 KB/s; burst ≤80 KB/s for 1 s
                                Local button highlight <1 frame; LAN confirmed action p95 <100 ms; remote target
Interaction
                                p95 <200 ms at RTT≤120 ms

These are acceptance targets, not claims about unknown iPad models or Mac Studio specifications.
Record hardware, browser and OS in the report. Safari may not expose reliable total memory; use
available counters, repeated scene cycling and crash observations, and mark unavailable metrics explicitly.
Adaptive quality samples frame time over 120 frames. If p90 >28 ms for two windows, drop one quality
level; if p90 <18 ms for 30 seconds, raise one. Minimum 15 seconds between changes. Never reduce
simulation rate or hit detection accuracy. Asset LOD and particle density are client only.

Mac Studio topology
Default remote access is a private Tailscale network with the Mac Studio and both iPads enrolled. Tailscale
Serve provides the HTTPS entry for the local game service; the iPads still play in Safari, but need the
Tailscale app connected for remote access. Use a stable tailnet hostname and same origin HTTPS/WSS.
Do not use Funnel for the private default. Tailscale documents Serve as private to the tailnet. [T10]
Node listens on 127.0.0.1:2567 and serves both static build and API/Colyseus transport. Proxy the entire
origin, preserving Colyseus generated room WebSocket paths; do not assume only /ws requires upgrade.
Keep the Mac on Ethernet, prevent sleep during sessions and ensure enough cooling. A Mac that sleeps
cannot host an active game.
If the family requires access without a VPN app, implement a separately configured public HTTPS reverse
proxy or authenticated tunnel with the same invitation system. This is an optional deployment profile, not
part of the default setup. No router port forwarding is required for the private profile.




                                                                                                         Version 1.0 | 35
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



24 Deployment runbook and recovery
Build and start contract
Repository scripts MUST exist with these names: dev, build, typecheck, lint, test, test:integration,
test:browser, test:load, content:validate, assets:audit and start:prod. A fresh install runs pnpm install --
frozen-lockfile, pnpm build and pnpm start:prod without editing source code. Local development may
expose a LAN port for testing only; production binds loopback behind HTTPS.
Environment keys: NODE_ENV=production, HOST=127.0.0.1, PORT=2567,
PUBLIC_ORIGIN=https://configured-tailnet-host, ROOM_CAPACITY=4, DATA_DIR=an-owner-only-
directory, LOG_LEVEL=info. Session secrets and invitation hashes live outside the repository. Validate all
required configuration at startup and fail with a nonsecret explanation.

First deployment sequence
1. Record the Mac hardware, OS and runtime versions; build from a tagged commit and validate the
content hash.
2. Start the production service on loopback. Check /healthz, /api/version, static assets, session exchange
and a local two client room.
3. Configure the supported Tailscale Serve command for the installed version; the researched pattern is
tailscale serve --bg http://127.0.0.1:2567. Verify with tailscale serve status. Restrict tailnet grants to the
family devices and this HTTPS service. [T10]
4. Open the HTTPS URL on both iPads. Confirm certificate trust, WSS upgrade, audio activation and actual
simultaneous touch behavior. Test once from another network, not only home Wi Fi.
5. Generate separate single use invitations with ops/scripts/invite.ts, validity 24 hours. Let the adult
distribute them; do not send messages automatically. Run a full match and reconnect test.
6. Install the provided launchd job under the chosen service account with absolute runtime paths,
WorkingDirectory, logs and restart on failure. Keep data and secrets restricted to that account.

Operations and updates
Log structured events: startup build hash, room counts, join/leave reason, tick percentiles, input rejects by
category, overload and unexpected exceptions. No names, invitation tokens, session cookies, reconnection
tokens or raw IPs in routine logs. Rotate daily, retain seven days, cap total logs at 100 MB. Health endpoint
contains no player list. Metrics/admin UI is local only.
For upgrade: announce shutdown in game with 60 second notice, stop new joins, drain rooms, back up the
small session store, switch the release directory and restart. Roll back by selecting the prior tagged build
and compatible content/config; reject old clients until they reload. Do not migrate active combat state
between builds.
On failure: show service unavailable, inspect health and redacted logs, confirm Mac awake and tailnet
connection, then restart the service. A watchdog restart must not enter a crash loop; after five failures in
five minutes stop and notify the operator. Verify shutdown releases all resources and exits within 10
seconds.




                                                                                                   Version 1.0 | 36
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



24 Security and privacy requirements
Authority and abuse resistance
The server accepts intentions only. Never expose RPCs for setPosition, damage, hitTarget, awardKill,
refillMeter, resetCooldown, changePhysics or spawn arbitrary assets. Clamp movement and angular rate,
verify state transitions, check every cooldown on the server and reject expired or repeated action IDs.
Private networking reduces exposure but does not replace game validation.
Boundary                  Required control                             Acceptance probe
                          Hashed single use 256 bit invitations; 5     Reuse and brute force fail without a valid
Session exchange
                          attempts/min per source plus 30/min global   cookie
                          Exact Origin allowlist; TLS; max bodies;
HTTP and WebSocket                                                     Foreign origin and missing ticket rejected
                          tickets bound to room/session
                          Strict schemas, finite numbers, length limits, NaN, huge arrays, unknown keys and invalid
Messages
                          per action rate buckets                        slots cannot crash room
                          Same origin content hashed files; no user    A client cannot request an arbitrary remote
Assets
                          supplied URLs                                asset through server
                          Local operator scripts, no browser admin     A player token cannot create invites or run
Admin
                          API in P0/P1                                 room commands
                          Outside source and client bundle; redacted   Build artifact and log scans find no tokens or
Secrets
                          logs                                         secret values

Use a restrictive Content Security Policy: default-src self; script-src self plus only the WebAssembly
allowance required by the tested Safari build; style-src self; img-src self blob data as needed; connect-src
self wss to the configured origin; object-src none; frame-ancestors none; base-uri none. Avoid unsafe-eval
and inline scripts. If the installed runtime needs wasm-unsafe-eval, document and test that exact exception.
Security headers include nosniff and a no-referrer policy. CSRF applies to cookie authenticated mutation
routes; Origin validation also applies to WebSocket upgrades.

Privacy and child friendly scope
Store only a pseudonymous session ID, preset/custom display label, local preferences and in memory
session scores. No real names required, no email address, birthday, location, ads, analytics SDK, public
profiles or chat. Arel and Nora can use their preferred labels without exposing them to a public service.
Delete expired session records daily and allow an operator to revoke a session instantly.

Availability limits
One room defaults to four players; at most four rooms in P1 if load tests pass. Max 32 projectiles per room
and max 4 active casts per player including persistent statuses. Expensive area queries cap candidates at
room population; cosmetic debris never generates server entities. Bound every collection and timer.
Disconnect a client after 10 invalid messages in 10 seconds; record the category, not payload. Rate limiting
must tolerate legitimate five finger input and reconnection bursts.
No automatic public publication, domain purchase or installation is performed by this specification. The
deployment tasks describe the authorized implementation deliverable; external rollout remains an operator
action.




                                                                                                        Version 1.0 | 37
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



25 Automated acceptance tests
Test IDs are stable. Use deterministic simulated ticks for combat, real sockets for protocol integration, and
browser automation for UI. A passing unit suite alone is not evidence that touch controls work on an iPad.
ID                         Fixture and action                             Required result
                           Two authenticated clients join same private    Distinct entity and life IDs; both see each other
A01
                           room and select identical kits                 and identical health
                                                                          Four hit sequence follows legal timing; no
A02                        Hold M1 for 180 ticks at a target in range     attacks during fourth recovery; total per chain
                                                                          14
                           Fourth M1 grounded with Jump held; repeat      First produces uppercut, second downslam; no
A03
                           airborne                                       simultaneous ordinary jump
                           Guard at angles 59, 60 and 61 degrees          B hit blocks at ≤60; hits at 61; U always
A04
                           from front                                     bypasses
                           Request dash twice one tick apart; then left   Only first forward dash; side dashes share their
A05
                           and right                                      bucket, independent of forward
                                                                          First rejected, second accepted if cooldown
A06                        Evasive at ragdoll age 11 then 12 ticks
                                                                          ready; landing bonus cleared
                           Replay same skill edge 10 times, including     One cast and one cooldown; stale epoch
A07
                           stale epoch                                    rejected
                           Two attackers capture same target on same Stable order chooses one; losing cast cannot
A08
                           tick                                      damage as if it captured
                           Fault Strike direct hit then evasive before    Exactly 20 damage, no later 10; without
A09
                           landing                                        evasive exactly 30
                           Ember Orb held 179 versus 180 ticks,           Damage 15 versus 25; partial blockable, full
A10
                           release                                        bypass; one projectile
A11                        Charge with missing input for 15 ticks         Cancelled without projectile; cooldown retained
                                                                          Furnace Ray ≤35; Solar Vent ≤70; no repeated
A12                        Beam target trapped at wall full duration
                                                                          extra hits
A13                        Lethal hit plus another hit same tick          One KO, one passive reward, no negative HP
                                                                          Committed cast finishes; no new awakened
A14                        Form expires while a capture is active
                                                                          cast; all protections released
                           Disconnect while captured; expire              No stuck capture, no fresh HP on reconnect,
A15
                           reservation                                    seat released on expiry
                           Malformed packet NaN, 100 edges,               Reject safely; room remains running; rate
A16
                           oversized string                               bucket enforces limits
                           Cross origin join and ticket reused in         Authentication fails; no state or player list
A17
                           another room                                   leaked
                           Spawn anchors occupied or under active         Deterministic farthest valid selection; fallback
A18
                           attack                                         protection works
                           Throw urn through thin cover at maximum        Swept query hits cover; no damage behind
A19
                           speed                                          cover
                           Reconnect with queued old                      Old epoch discarded; no cast or stuck charge
A20
                           skillUp/skillDown                              after resync

Every ability adds the matrix from section 16. T12, T13, T15, T16, T20 and T21 are split into subcommits .1
through .4, one per slotted move; T23 uses .1 through .3 for the contextual moves. Snapshot equality
compares health, action, cooldowns, meter and ownership; rendering differences are irrelevant. Server
tests must explicitly assert damage sums and time boundaries, not only “event emitted”. Keep tests
independent from the implementation’s internal branch structure.




                                                                                                             Version 1.0 | 38
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



26 Device network and performance acceptance
Actual iPad checklist
Run on both Arel’s and Nora’s iPads in Safari, with installed iPadOS recorded. Also test a home screen
shortcut if used. Browser emulation is useful but cannot certify physical multitouch, thermal behavior or
Safari lifecycle handling.
ID                        Manual scenario                              Pass condition
                          Landscape at 1024×768, 1180×820 and          All buttons within safe rectangle, no overlap,
D01
                          actual safe viewport                         touch targets meet minimum
                                                                       Inputs remain independent for 30 seconds;
D02                       Move plus camera plus held M1 plus Jump
                                                                       fourth hit variant works
                          Charge skill while moving camera, release    One shot at server charge value; captured
D03
                          outside its button                           pointer does not activate another button
                                                                       No stuck guard or movement;
D04                       Block, invoke app switcher, return
                                                                       reconnect/neutral behavior visible
                          Rotate, resize browser chrome, enter split   Layout recalculates; no inherited pointer; small
D05
                          view                                         view shows rotate/enlarge panel
                                                                       Stable normalized positions; invalid overlaps
D06                       Drag button layout, save, reload and reset
                                                                       rejected; Reset restores fixture
                          Start music and effects, background then     Audio resumes only through supported user
D07
                          return                                       interaction; no overlapping loops
                                                                       Camera returns safely; no invisible UI or
D08                       Die during a cinematic; open Settings
                                                                       permanent invulnerability
                          Ten minute match, then ten lobby/game        Meets frame budget, no crash, no growing
D09
                          cycles                                       listener/entity counts
                          Reference layout comparison in private       Record deltas and settings; never mark exact
D10
                          Roblox session                               parity without measurements

Network simulation matrix
Run A01, A07, A08, A12, A15 and A20 with RTT 20/80/150/250 ms, jitter 0/20/40 ms and 0/1/3 percent
packet loss at the transport/network layer. WebSocket retransmission means loss often appears as delay;
do not simulate unordered delivery as if the transport were UDP. At RTT≤150, confirm responsive
prediction and no authority divergence. At 250 ms, allow delayed combat feedback but never duplicate
damage, teleport cheating or stuck states.
Test Wi Fi to cellular hotspot switch, 2 second outage, 19 second outage, 21 second outage, browser
reload and Mac service restart. Outages that recover within the reservation reconnect to the same life;
beyond reservation returns to lobby. Network outage durations are measured from server drop detection;
include detection time in the report.

Load and release evidence
Use four authenticated headless clients cycling melee, projectiles and awakenings for 15 minutes. Record
server tick histograms, messages per second, bandwidth and heap trend. Separately run two physical
iPads for 20 minutes to capture thermal effects. Save reports under docs/test-results with commit, content
hash and device metadata. A release report lists each test PASS, FAIL or NOT RUN. Missing physical
device tests remain NOT RUN; agents must never fabricate them.




                                                                                                        Version 1.0 | 39
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



27 Sequenced commits for the playable release
Each task should be one reviewable commit. If a task grows beyond roughly 500 changed nonasset lines,
split it by module or handler while retaining its acceptance ID. Tests may be in the same commit as the
behavior they establish. Do not defer all integration to the final phase.
Task and dependency         Files to create or change                   Done means
                            Root package files, docs/dependencies.md,   Exact lockfile; typecheck/build; one real
T01 Bootstrap none
                            minimal client/server entry                 Colyseus join using installed API
                            shared/protocol.ts, schema.ts,
T02 Shared contracts T01                                                Strict validators and protocol compatibility tests
                            config/combat.ts
                            server/auth, http/sessionRoutes.ts,         Session exchange and single use join ticket;
T03 Authentication T02
                            ops/scripts/invite.ts                       A17
                            ArenaRoom, ArenaSchema, PlayerSchema, A01 and reconnect seat reservation with
T04 Room lifecycle T03
                            RoomClient                            minimal state
                                                                        Collision hash match; bridge and spawn
T05 Arena colliders T02     config/arena.ts, map JSON, sim/World.ts
                                                                        validator
                            shared/movement.ts, sim/Movement.ts,        Fixed step capsule movement and jump; wall
T06 Movement T04 T05
                            FixedClock                                  blocking
                            PointerRouter, ControlLayout,               Layout fixture; independent pointer ownership;
T07 Touch shell T02
                            IntentSampler, Hud                          D01 simulated
T08 Camera and prediction   CameraRig, Prediction, ClockSync,           Reconciliation, camera collision and stale input
T06 T07                     SnapshotBuffer                              lease tests
                            ActionMachine, HitResolver,
T09 Combat states T06                                                   A04 A05 A06 A08; no orphan captures
                            CaptureRegistry
                                                                        A02 A03; touch hold maps to legal server
T10 M1 and guard T07 T09    Universal handlers and combat tests
                                                                        repeats
                            AbilityRunner, ability schema, registry     Phase scheduler, hit deduplication, cancel
T11 Ability framework T09
                            validator                                   idempotence
T12 Vanguard base T11       Four sv base handlers and definitions       A09 plus all four per move matrices
T13 Duelist base T11        Four td base handlers and definitions       Capture, throw and counter matrices
T14 Awakening system T12                                                Damage based meter, expiry, death and use
                         MeterSystem, form state, owner HUD
T13                                                                     flags; A14
T15 Vanguard awakening                                                  One move consumes form, counter status and
                            Four sv awakened handlers
T14                                                                     finite damage
                                                                        Captures, miss branch, one use and expiry
T16 Duelist awakening T14   Four td awakened handlers
                                                                        tests
T17 Respawn and FFA T10 RespawnSystem, scoreboard, lobby kit
                                                                        A13 A18; scoring, assist, spawn protection
T14                     change
T18 P0 playable gate T15                                                Two clients complete all moves; D02 D04 D08
                            AppFlow, PracticeRoom, onboarding, tests
T16 T17                                                                 on both iPads

T18 may use original geometric placeholder art. It cannot omit functionality, fake networking with local bots,
or claim physical device tests that were not run. The first playtest is intentionally early enough to adjust
control spacing before expensive animation work.




                                                                                                          Version 1.0 | 40
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



27 Sequenced commits for the complete scope
Task and dependency            Files to create or change                       Done means
T19 Charge and projectile      Projectile simulation, hold lease, projectile
                                                                               Sweeps, reflect cap, A10 A11 A19
system T18                     state
                                                                               Recast, air branches and charge release
T20 Artificer base T19         Four ea base handlers and definitions
                                                                               matrices
T21 Artificer awakening
                               Four ea awakened handlers and activation        A12; hit/miss/interrupted branches; form expiry
T20
T22 Passives T21               Passive hooks, reward registry                  One per life healing/reset; explicit exclusions
T23 Props and wall context                                                     All three context moves; shared one use bit;
                               Urn state, wall handler, sv context handlers
T18 T19                                                                        pickup priority
                                                                               Two distinct targets maximum; no unbounded
T24 Duelist P1 variants T16 Elevated slam and assault chain
                                                                               chain
T25 Original art pipeline      AssetManifest, provenance, rig and
                                                                               Asset audit and all required animation IDs
T18                            placeholder replacements
T26 Effects audio and                                                          Effects caps, event dedup, reduced motion and
                               EffectsPool, AudioBus, original tracks
camera T21 T23 T25                                                             D07 D08
T27 Settings and layout
                               SettingsStore, layout editor, accessibility     D05 D06; validation and versioned persistence
editor T07 T18
T28 Production hosting T04                                                     HTTPS/WSS from both iPads on remote
                           ops scripts, launchd, same origin server
T18                                                                            network
T29 Security hardening T22
                           RateLimits, origin checks, CSP, redaction           A16 A17; secrets scan and revocation
T28
T30 Performance pass T24                                                       Section 24 budgets measured; no combat rate
                               LOD, pixel caps, pooling, load fixtures
T26 T27                                                                        changes
T31 Fidelity calibration T18   reference observations, layout JSON,            D10; discrepancies tagged C/X/U, defaults
T27                            decision records                                revised only deliberately
T32 Release candidate T29                                                      All P0/P1 tests PASS or explicit approved
                          Test reports, README, release manifest
T30 T31                                                                        limitations; tagged build

Task packet template
Task ID and objective; prerequisite commit hashes; allowed files; relevant specification section; exact
behavior; tests to run; expected outputs; excluded scope. End with changed files, executed checks and
remaining failures. Do not ask an agent to “finish combat” or “implement all abilities” without a list of IDs.

Definition of done for every commit
Build and type checks pass; task tests pass; no secret material; no invented source fact; no stale listeners
or timer; no client authority leak; no unrelated refactor; task ledger updated. Asset only changes require
provenance and visual review rather than meaningless unit tests. UI changes require a layout screenshot
at the target viewport.

Change control
If a reference check changes a move observation, update the evidence ledger first. If local behavior must
change, create a decision record containing old value, new value, reason, affected move IDs,
protocol/content hash impact and tests. Rebalance only through shared configuration; do not scatter
numeric overrides in animation code. A new dependency requires a brief compatibility check and exact
version pin.
The implementing agent may resolve routine code structure without asking permission. It must not interpret
a missing fidelity observation as permission to invent source mechanics, install public services or extend
the roster.




                                                                                                                 Version 1.0 | 41
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



28 Agent readable AGENTS instructions
Copy the following into the repository root AGENTS.md before T01. The document’s own task is complete
at delivery; these instructions govern later game implementation.
Current rules index: see docs/current-contract.md (amendments and decisions in force).

# Elemental Battlegrounds implementation contract

Read docs/spec.md and docs/tasks.md before changing code.
Implement one task ID at a time. Check its prerequisites first.
Treat Sonnet 5.5 Low and Sol 6.1 Low as selected execution agents.
Do not infer capabilities or change model settings from these names.

Authority order:
1. Explicit user requirements.
2. Specification local rules and numeric registry.
3. Per ability overrides.
4. Default handler semantics.
5. Acceptance tests consistent with the above.

Never claim an original game fact without an evidence ID.
D values are local design choices. C and X are not verified facts.
Do not copy Roblox or anime assets, audio, animation or UI artwork.
Use original shipped names. Keep reference labels in research only.
Do not expand the three fighter scope without a new specification.

Server decides position limits, hits, HP, cooldowns, forms and scores.
Clients send validated intent only. Never accept a target damage claim.
Use fixed 60 Hz simulation. Render timing never schedules damage.
All action timers use integer ticks. Auth expiry uses wall time.
Do not add setTimeout damage handlers or a second physics scheduler.
Every capture, listener, effect and room subscription has cleanup.
Use strict TypeScript and strict runtime message schemas.
Keep pure shared modules free of DOM, Three.js and server secrets.
Use exact dependency versions and the committed lockfile.

Before implementing an ability, add its definition and tests.
Test miss, block, counter, duplicate hit, interruption, death and expiry.
Test network behavior with real clients, not only mocked callbacks.
Physical iPad checks must be recorded as NOT RUN until actually run.
Do not report success from unexecuted tests or invented measurements.

Use rg for file/text discovery. Read relevant code before editing.
Keep each task small. No unrelated refactoring or package upgrades.
Resolve routine details autonomously within the approved contract.
If requirements conflict, document the conflict before choosing a rule.
For a broad new request, list concrete items and files and get scope
confirmation before exploring or editing beyond the current task.

Run pnpm typecheck, pnpm lint, relevant tests and pnpm build.
Run content:validate after data changes and assets:audit for assets.
Update docs/tasks.md with status and evidence, then commit coherently.
Report changed behavior, executed checks and actual limitations.
Never expose secrets in logs, chat, screenshots or version control.
Do not send invitations, deploy publicly or buy services automatically.

Keep each session to one task. When finished or around 50 steps,
recommend a fresh session with a 2 to 3 line handoff summary.

The task ledger uses TODO, IN PROGRESS, BLOCKED or DONE plus commit hash and test report path.
BLOCKED must name a concrete missing dependency. A completed code task with pending physical
checks is IMPLEMENTED, DEVICE CHECK PENDING rather than DONE.




                                                                                         Version 1.0 | 42
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



29 Assumptions verification log and deviations
Assumptions to validate without blocking scaffolding

ID                        Assumption or uncertainty                     Current decision and closure evidence
                                                                        Use WebGL2 baseline; record both physical
V01                       iPad models and OS unknown
                                                                        devices at T18
                                                                        Private Tailscale default; confirm adult setup at
V02                       Home network and remote needs unknown
                                                                        T28
                                                                        D layout in section 7; measure and compare at
V03                       Exact original touch rectangles unavailable
                                                                        T31
                                                                        D Quick Use and auto run on; observe original
V04                       Default hold/Quick Use settings unclear
                                                                        settings
                          Character pages have stale indexed            Preserve C status; record build date for any
V05
                          content                                       live checks
                                                                        D requirement 200 versus 350; do not claim 2×
V06                       Hero meter multiplier differs
                                                                        or 3× parity
                                                                        D 2820 ticks; compare source 42 and 47
V07                       Cyborg awakening duration differs
                                                                        seconds
                                                                        D noncounterable local blast; document as a
V08                       Evasive counterability differs
                                                                        deviation
                                                                        Every local tick and hitbox value is D, editable
V09                       Detailed frame data not published
                                                                        in data
                          Current extra burst systems not               Exclude from P0/P1; create a P2 source task
V10
                          corroborated                                  before adding
                                                                        Three core kits only; other and restricted forms
V11                       Complete current roster uncertain
                                                                        excluded
                                                                        T01 smoke test pins exact runtime and
V12                       Dependency API compatibility untested
                                                                        resolves peer versions

Explicit fidelity deviations
The game uses metres and finite damage, a small floating island arena, a four player default cap, original
names and assets, no passive regeneration, simplified wall attacks, capped collateral damage, protected
cinematic captures, deterministic hit arbitration, a limited prop system and no corpse farming. It omits
reference map destruction, ranked modes, cosmetics economy, character specific cross kit cinematics and
out of scope fighters. Movement speeds raised by owner request, decision 0020. These choices are intentional and testable; none should be described as exact
original mechanics.

What counts as verified later
A source check needs URL, publisher, access date, claim and quoted or paraphrased evidence. A
measurement needs device, game setting, date, video frame rate, trial count and observed range. Record
disagreements without deleting old evidence. A guide repeating a wiki is not independent corroboration.
Never infer a missing number from an animation or a marketing phrase.

Release gates
P0: T01–T18 complete, two physical iPads connect and fight, both kits fully usable, no authority or stuck
input bugs. P1: T19–T32 complete, third kit and context attacks present, original assets audited, remote
play and performance tested. Fidelity label: only use “closely matched controls” after T31; never use “exact
replica” based on this document alone.
Completion means a reproducible build plus the required test evidence, not merely code generation. The
source and assumption ledgers remain living project records after implementation.




                                                                                                          Version 1.0 | 43
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



30 Game research sources
All sources accessed or searched on 1 November 2026. Fandom citations may refer to searchable indexed
text when direct retrieval failed; their crawl age is not a live build verification. Short factual summaries are
used here; no reference artwork or audio is included.
[R01] Yielding Arts. The Strongest Battlegrounds official Roblox experience. Primary creator listing.
Establishes game identity, mobile support and core PC action mapping; not touch dimensions or numeric
combat data.
https://www.roblox.com/games/10449761463/The-Strongest-Battlegrounds
[R02] The Strongest Battlegrounds Controls PC Mobile and Console. Community guide, dated 11 August
2026. Supports touch action vocabulary; not an authoritative layout measurement.
https://thestrongestbattleground.wiki/tools/controls/
[R03] The Strongest Hero. The strongest battlegrounds community wiki. Indexed character move set,
Serious Mode behavior and older balance values. Direct fetch failed during research; indexed text used.
https://the-strongest-battlegrounds.fandom.com/wiki/The_Strongest_Hero
[R04] The Strongest Hero. The Strongest Battlegrounds Rblx community wiki. Additional contextual
attacks, variants and differing numbers. Indexed text used; current live parity unverified.
https://the-strongest-battlegrounds-rblx.fandom.com/wiki/The_Strongest_Hero
[R05] Hero Hunter. The Strongest Battlegrounds Rblx community wiki. Core kit, awakening, passive and
explicit unfinished/rework/archive warnings. Indexed text used.
https://the-strongest-battlegrounds-rblx.fandom.com/wiki/Hero_Hunter
[R06] Hero Hunter Garou Moves Damage and Ultimate. RBLXGUIDE. Derivative community guide; useful
for variant inventory, not independent confirmation of live balance.
https://rblxguide.com/games/the-strongest-battlegrounds/characters/hero-hunter
[R07] Destructive Cyborg. The strongest battlegrounds community wiki. Older ability, charge, passive and
duration descriptions; indexed text used.
https://the-strongest-battlegrounds.fandom.com/wiki/Destructive_Cyborg
[R08] Destructive Cyborg. The Strongest Battlegrounds Rblx community wiki. Updated variant and passive
descriptions, including conflicting awakening duration and evasive details; indexed text used.
https://the-strongest-battlegrounds-rblx.fandom.com/wiki/Destructive_Cyborg
[R09] All TSB Characters Moves Damage and Ultimates. RBLXGUIDE. Index corroborates the three
contextual Hero attacks, but its roster counts include differing categories.
https://rblxguide.com/games/the-strongest-battlegrounds/characters
[R10] Updates. The Strongest Battlegrounds Rblx community wiki. Historical reports of auto run, held auto
use skills and additional Hero context moves; not proof of present defaults.
https://the-strongest-battlegrounds-rblx.fandom.com/wiki/Updates




                                                                                                  Version 1.0 | 44
ELEMENTAL BATTLEGROUNDS • IMPLEMENTATION SPECIFICATION



30 Additional sources and engineering references
[R11] The Strongest Hero. Strongest Battlegrounds Roblox community wiki. Reports a conflicting three
times awakening passive; used only to document uncertainty.
https://strongest-battlegrounds-roblox.fandom.com/wiki/The_Strongest_Hero
[R12] Basic Combat. The Strongest Battlegrounds Rblx community wiki. Reports held M1 strings and fourth
hit variation vocabulary. Character specific exceptions are not adopted without separate verification.
https://the-strongest-battlegrounds-rblx.fandom.com/wiki/Basic_Combat
[T01] Colyseus. Rooms documentation, version 0.18. Primary source for room loop and patch
configuration. Local simulation and packet design are decisions of this specification.
https://docs.colyseus.io/room
[T02] Colyseus. Migrating to 0.18. Documents setTimestep replacing the older name and built in prediction
alternatives; this design uses one custom scheduler.
https://docs.colyseus.io/migrating/0.18
[T03] Colyseus. Reconnection. Primary lifecycle documentation for onDrop, allowReconnection,
onReconnect and final leave behavior.
https://docs.colyseus.io/room/reconnection
[T04] Dimforge. Rapier JavaScript Controllers, version 0.21 guide. Character controller movement
correction and kinematic usage.
https://rapier.rs/docs/user_guides/javascript/character_controller/
[T05] Dimforge. Rapier JavaScript Scene queries. Primary documentation for ray and shape queries. Local
hit semantics are not Rapier defaults.
https://rapier.rs/docs/user_guides/javascript/scene_queries/
[T06] W3C. Pointer Events. Primary standard for pointer ownership, capture and touch action behavior.
https://www.w3.org/TR/pointerevents/latest/
[T07] Three.js. Responsive Design. Canvas CSS sizing, camera aspect and drawing buffer limits.
https://threejs.org/manual/pages/responsive.html
[T08] Three.js. WebGLRenderer documentation. Rendering and resource lifecycle reference.
https://threejs.org/docs/pages/WebGLRenderer.html
[T09] npm package registry. Package publisher metadata retrieved directly for the ten package versions
listed in section 17. Query pattern is registry.npmjs.org followed by package name and /latest; record the
exact lockfile at implementation time.
https://registry.npmjs.org/colyseus/latest
https://registry.npmjs.org/@colyseus/sdk/latest
https://registry.npmjs.org/@dimforge/rapier3d-compat/latest
https://registry.npmjs.org/three/latest
[T10] Tailscale. tailscale serve command. Primary reference for private tailnet service exposure and
HTTPS proxy configuration. Verify installed CLI behavior during deployment.
https://tailscale.com/docs/reference/tailscale-cli/serve




                                                                                               Version 1.0 | 45

Hosted sparring extension (planned): see [docs/sparring-plan.md](sparring-plan.md) for host-configured opponents, scoped guest invitations and acceptance criteria. Section 6 continues to govern the stationary tutorial.
