import { describe, expect, test } from "vitest";
import { P0_KITS } from "../../packages/shared/src/protocol.js";
import { KIT_LABEL, baseMoveLabels, lobbyKits } from "../../apps/client/src/ui/Lobby.js";

describe("lobby kit list (T21, decision 0022)", () => {
  test("the Ember Artificer can be picked: it is listed, labelled with its shipped name and shows its four base moves", () => {
    expect(P0_KITS).toEqual(["sv", "td", "ea"]);
    expect(lobbyKits()).toEqual(["sv", "td", "ea"]);
    expect(KIT_LABEL.ea).toBe("Ember Artificer");
    expect(baseMoveLabels("ea")).toEqual(["Cinder Array", "Vent Rush", "Ember Orb", "Furnace Drop"]);
    expect(baseMoveLabels("sv").length).toBe(4);
    expect(baseMoveLabels("td").length).toBe(4);
  });
});
