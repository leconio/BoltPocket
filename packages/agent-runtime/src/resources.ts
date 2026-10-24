import { formatSkillsForSystemPrompt } from "@earendil-works/pi-agent-core";

import type { RuntimeSkill } from "./contracts.ts";

/** Use Pi's upstream Agent Skills prompt formatter without exposing Pi types. */
export function formatRuntimeSkillsForSystemPrompt(
  skills: readonly RuntimeSkill[],
) {
  return formatSkillsForSystemPrompt([...skills]);
}
