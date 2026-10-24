export type AgentConfig = {
  runTimeoutMs: number;
};

const AGENT_RUN_TIMEOUT_MS = 600_000;

export function getAgentConfig(): AgentConfig {
  return { runTimeoutMs: AGENT_RUN_TIMEOUT_MS };
}
