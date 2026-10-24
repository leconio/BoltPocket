# Agent Runtime

Repository-owned Agent contracts plus the Pi Agent Core adapter. The adapter
accepts a model stream function, validated tools, and a write-risk policy so the
mobile UI and connectors do not depend on Pi types.

Live behavior is delegated to upstream `AgentHarness + Session`, including
queues, cancellation, Skills, Prompt Templates, compaction, and branch
navigation. The optional persistence port stores the complete validated Session
tree in application-owned encrypted storage. Durable snapshots replace image
blocks with an omission marker so live images work without retaining attachment
bytes across restarts.

Pi Core exposes compaction and retry primitives while Pi Coding Agent schedules
them in its Node host. The mobile host follows that upstream policy with the
pinned implementations: provider-request retries, assistant-error
classification and exponential backoff, threshold compaction, and one overflow
compact-and-retry attempt. A mobile safety guard only replays turns that emitted
no text and executed no tool; partial answers and tool-bearing turns fail once
instead of risking duplicated work. Skills carry their complete project-owned
instructions rather than a description placeholder.

The OpenAI-compatible stream adapter normalizes a bare provider origin to
`/v1`, supports streamed text and tool calls, and applies bounded mobile request
timeouts and retry delays. Before events reach Pi Agent Core, adjacent text,
thinking, and tool-call deltas are concatenated at a one-second mobile cadence;
boundary and final events remain immediate, and the complete upstream message
is unchanged. Optional diagnostics report counts and timings only, never model
content. Model configuration is loaded on device through an application-owned
secure-storage port. API keys must never be placed in source code or
`EXPO_PUBLIC_` values.

The same adapter exposes the pinned Pi `openai-codex-responses` implementation
for the app's personal Codex provider. It accepts only the official ChatGPT
Codex API root and forces Streamable SSE on mobile; the app-owned OAuth fetch
wrapper supplies refreshed account-scoped credentials. The runtime never owns,
persists, or redirects those credentials.

Custom model descriptors may opt into Pi's upstream reasoning capability and
OpenAI-compatible `reasoning_effort`. Session `thinkingLevel` remains owned by
Pi Core, and provider thinking deltas are emitted separately from answer text;
the mobile application decides how to display and persist them.
