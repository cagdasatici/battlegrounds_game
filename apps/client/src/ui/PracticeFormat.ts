import { TUTORIAL_STEPS, type TutorialStep } from "@eb/shared/protocol";

/** Pure display model of the practice tutorial. The inputs are replicated, server confirmed values only. */
export const STEP_LABEL: Readonly<Record<TutorialStep, string>> = {
  move: "Walk around",
  turn: "Turn to face a new way",
  attack: "Hold Strike for a combo",
  block: "Hold Guard",
  dash: "Dash",
  skills: "Use all four skills",
  awaken: "Awaken",
};
export const STEP_HINT: Readonly<Record<TutorialStep, string>> = {
  move: "Push the stick to walk a few steps.",
  turn: "Walk in another direction to turn.",
  attack: "Hold Strike near the dummy to string hits together.",
  block: "Hold Guard for a moment.",
  dash: "Tap Dash.",
  skills: "Tap each skill, 1 to 4.",
  awaken: "Your meter is full. Tap Awaken.",
};
export const SKILL_NAMES = ["1", "2", "3", "4"] as const;

export interface TutorialRow { id: TutorialStep; label: string; status: "done" | "current" | "todo"; detail: string }
export interface TutorialView { rows: TutorialRow[]; done: boolean; hint: string }

export function tutorialView(step: number, skillMask: number): TutorialView {
  const n = TUTORIAL_STEPS.length;
  const cur = Math.max(0, Math.min(n, Math.floor(step)));
  const bits = [0, 1, 2, 3].filter((i) => (skillMask & (1 << i)) !== 0).length;
  const rows = TUTORIAL_STEPS.map((id, i): TutorialRow => ({
    id, label: STEP_LABEL[id], status: i < cur ? "done" : i === cur ? "current" : "todo",
    detail: id === "skills" && i === cur ? `${bits} of 4` : "",
  }));
  const current = TUTORIAL_STEPS[cur];
  return { rows, done: cur >= n, hint: current ? STEP_HINT[current] : "Practice complete. Try anything on the dummy, or leave from the menu." };
}
