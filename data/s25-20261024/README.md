# S25 engineering samples

See [BENCHMARKS.md](../../docs/BENCHMARKS.md) for conditions and [MODEL.md](../../docs/MODEL.md) for the historical artifact availability gap.

- `measurements.json`: numerical CPU/GPU/cache/long-task observations and explicit failed content checks, selected from the frozen local receipts.
- `long-task-model-calls.csv`: all 12 main-task model calls, including short tool-call generations.
- `followup-model-calls.csv`: all seven same-process audit/refinement calls.
- `*-prompt.txt`: actual submitted English task text, with no credentials or personal connection setup.

No device serials, PIDs, private host paths, credential helpers, system logs, model weights, checkpoints or recordings are included. These observations are not a three-run benchmark for the current upstream model; that file has a different hash. The corpus is intentionally small and does not establish general agent reliability.
