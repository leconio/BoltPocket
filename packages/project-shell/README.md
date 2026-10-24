# @boltpocket/project-shell

React Native-safe, project-scoped Bash execution for BoltPocket. The package wraps
the published `just-bash/browser` runtime; it never invokes a system shell,
Node subprocess, host `eval`, or a connector write.

## Execution model

`ProjectShell` takes an asynchronous text filesystem, snapshots only its
configured `root`, executes against a fresh `just-bash` `InMemoryFs`, and then
returns a deterministic list of created, modified, and deleted text files.
The supplied filesystem's `writeFile` is never called. The application turns
the returned changes into one unified Diff/recovery-point proposal.

```ts
const shell = new ProjectShell({
  fileSystem,
  root: "/project",
  fetch: projectScopedReadFetch, // optional; enables curl
  javaScriptRuntime, // optional; enables finite js-exec
  commands: projectConnectorCommands, // text-only app/SSH adapters
  runtimeCommands: auditedExtraCommands, // low-level repository adapters
});

const result = await shell.execute({
  command: "sed -i 's/old/new/' notes.txt",
  cwd: "/project",
  signal,
});
```

`root` defaults to `/` for generic package use. Mobile must explicitly pass
`/project`. Reads, writes, traversal, redirection, custom-command filesystem
access, and `js-exec` changes are then constrained to that subtree. Symbolic
link creation is disabled. Binary file changes are rejected because BoltPocket's
review contract is a text Diff; binary data can still flow through a bounded
pipeline, such as `gzip | base64`.

## Commands and capabilities

The pinned browser build exposes 79 commands:

- Files/navigation: `cat`, `cp`, `file`, `find`, `ln`, `ls`, `mkdir`, `mv`,
  `readlink`, `rm`, `rmdir`, `stat`, `touch`, `tree`, `pwd`, `du`, `basename`,
  `dirname`.
- Text/data: `awk`, `base64`, `column`, `comm`, `cut`, `diff`, `expand`,
  `fold`, `grep`/`egrep`/`fgrep`, `head`, `join`, `jq`, `md5sum`, `nl`, `od`,
  `paste`, `printf`, `rev`, `rg`, `sed`, `sha1sum`, `sha256sum`, `sort`,
  `split`, `strings`, `tac`, `tail`, `tee`, `tr`, `unexpand`, `uniq`, `wc`,
  `xargs`.
- Shell/utilities: `alias`, `bash`, `sh`, `chmod`, `clear`, `date`, `echo`,
  `env`, `expr`, `false`, `help`, `history`, `hostname`,
  `html-to-markdown`, `printenv`, `seq`, `sleep`, `time`, `timeout`, `true`,
  `unalias`, `which`, `whoami`.
- Compression: `gzip`, `gunzip`, `zcat`, backed on React Native by the local
  bounded `fflate` zlib shim.

These are registered command names. Shell builtins such as `cd` and `export`
are supplied separately by just-bash's AST interpreter. Pipelines,
redirections, variables, command/arithmetic expansion, functions, `if`/`case`,
and bounded `for`/`while`/`until` loops are supported.

`getCommandCapabilities()` is the source of truth for UI and agents:

| Capability                                                 | Behavior                                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 79 browser commands                                        | Available by default                                                                                                                      |
| `curl`                                                     | Stubbed until an explicit project-scoped `fetch` is injected; only GET/HEAD pass this port                                                |
| `js-exec`                                                  | Stubbed until `javaScriptRuntime` is injected; accepts piped `input.stdin` plus explicit `--input-file PATH` snapshots under fixed limits |
| `node`, `python`, `python3`, `sqlite3`, `tar`, `xan`, `yq` | Accurate unavailable stubs when no adapter supplies the name                                                                              |
| App/SSH `commands`                                         | Receive the repository's text filesystem facade and optional read-only fetch                                                              |
| Audited `runtimeCommands`                                  | Receive just-bash's scoped binary VFS, `lstat`/`readdir`, and bounded nested `ctx.exec`                                                   |

`runtimeCommands` is a repository-owned low-level port for audited packages
such as project-shell extras. Every entry must explicitly set `trusted: false`.
The array is validated and snapshotted at construction; neither low-level nor
app commands may replace browser/network commands or `js-exec`, and duplicate
names are rejected. Both command paths operate only on the per-execution
overlay. Connector-facing commands should continue to use the narrower
`commands` record.

The `javaScriptRuntime` implementation must be a separately isolated native
runtime. It must not evaluate source in the host Hermes realm or expose a
system shell, implicit network, imports, `require`, or native bridges.
The command never copies the whole project implicitly. Use
`js-exec --input-file PATH ... -c CODE` to select bounded text inputs; the
final expression result is emitted even when the script does not call
`console.log`.

## Mobile limits

Defaults are intentionally below just-bash's hardened preset: 64 KiB command
text, 4 MiB aggregate output, 10,000 project entries, 16 MiB project text,
15 seconds wall time, 5,000 commands/loop iterations, 32 MiB live execution
budget, 16 MiB JavaScript memory, and a 512 KiB JavaScript stack. Public limit
overrides may reduce these values but cannot raise the mobile maximums.

## Expo / Metro

The published browser bundle retains a static `node:zlib` import. Expo Metro
must resolve that import, only when it originates under just-bash, to:

```text
@boltpocket/project-shell/node-zlib-shim
```

The shim exports the `constants`, `gzipSync`, and `gunzipSync` subset used by
just-bash. Gunzip uses small streaming input slices, a trailer pre-check, and a
cumulative output limit so compressed expansion is rejected before returning
an oversized result. The package also installs its explicit `buffer` dependency
before just-bash evaluates; it does not assume Hermes provides `Buffer`,
`btoa`, or `atob`.

## Verification

From the repository root:

```sh
pnpm --filter @boltpocket/project-shell lint
pnpm --filter @boltpocket/project-shell typecheck
pnpm --filter @boltpocket/project-shell test
```

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for upstream attribution.
