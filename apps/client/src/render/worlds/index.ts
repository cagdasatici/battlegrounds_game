/**
 * WORLD01: picks the visual builder for a registry map. The grove keeps the original ArenaView; every other map has its own
 * terrain and props module here. All builders return the same `ArenaBuild`, so the scene never needs to know which world it shows.
 */
import type { DataTexture } from "three";
import type { Collider } from "@eb/shared/config/arena";
import type { MapDefinition } from "@eb/shared/config/maps";
import { buildArena, type ArenaBuild } from "../../scene/ArenaView.js";
import { getEnvTheme } from "../environment/theme.js";
import { buildCoastWorld } from "./coastWorld.js";

export function buildWorldView(map: MapDefinition, colliders: readonly Collider[], ramp: DataTexture): ArenaBuild {
  const theme = getEnvTheme(map.themeId);
  switch (map.themeId) {
    case "coast": return buildCoastWorld(colliders, ramp, { theme, map });
    default: return buildArena(colliders, ramp, { detail: 1, theme });
  }
}
