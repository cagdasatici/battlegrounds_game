# 0029 Capture camera and reduced motion

Status: accepted. Slice FX5.

## Decision
- `CameraRig.playTrack({ ms, orbitRad, distance })` adds a yaw offset and a distance ease on top of the normal camera.
  Both follow `sin(pi * p)` over the track, so the camera leaves and returns to the player view with no snap. `ms` is
  clamped to 1200. `cancelTrack()` drops it immediately. FX1's `shake` is unchanged and still works during a track.
- `CaptureCam` (apps/client/src/fx/CaptureCam.ts) watches the local player's replicated `action`. A transition into
  `Captured` plays `CAPTURE_TRACK` (1.2 s, 30 degree orbit, 4.5 m). Only the local player is affected.
- Cancel triggers: leaving `Captured` (release, ragdoll, death), a new `lifeId` (respawn), `connected === false`, the
  menu opening, Reduced Motion turning on, and `dispose`. Reduced Motion never starts a track, and `CameraRig`
  cancels a running one when `reducedMotion` is set.
- `main.ts` drives `CaptureCam.update` from a requestAnimationFrame loop with cleanup in `matchCleanups`.

## Limits
- The track is not obstruction aware beyond the existing sphere cast, which still pulls the camera in.
- Distance 4.5 m is the track's peak; the slider distance is the start and end value.
