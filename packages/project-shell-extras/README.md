# @boltpocket/project-shell-extras

React Native/Hermes-safe custom commands that fill the four default-command
gaps in `just-bash/browser` 3.2.0. They run inside the existing virtual project
filesystem. Nothing in this package starts a subprocess, reads Node's real
filesystem, downloads code, creates a Worker, or loads WebAssembly.

```ts
import { Bash } from "just-bash/browser";
import { createProjectShellExtraCommands } from "@boltpocket/project-shell-extras";

const bash = new Bash({
  fs,
  customCommands: createProjectShellExtraCommands({ sqlite }),
});
```

All commands are registered with `trusted: false`. Limits are resolved once at
construction, every project path goes through the injected virtual filesystem,
and writes remain in that filesystem's overlay for the ordinary unified Diff.
Register these command objects directly in `BashOptions.customCommands`; a
text-only command wrapper cannot provide the binary filesystem methods needed
by `tar`/`sqlite3` or the nested `ctx.exec` call used by `yq`.

`tar` archive writes are binary overlay changes. They can be used within a
conversation command pipeline, but a host that only reviews text patches must
not apply a resulting binary archive to the external project as a text Diff.

## Actual support

| Command   | Mobile-safe support                                                                                                                                                                                                                                                                                           | Deliberate differences from just-bash 3.2.0                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tar`     | Deterministic USTAR create/list/extract; stdin/stdout archives; gzip create and bounded streaming decode; `-C`, `-v`, `-O`, `-k`, strip-components, excludes                                                                                                                                                  | Rejects bzip2, xz, zstd, PAX/GNU extensions, links, devices, sparse files, append/update and absolute members. Extraction validates every member before its first write.                                                                                                                                                                                                           |
| `yq`      | YAML, JSON, XML, INI, CSV and TOML input/output; common flags; front matter; slurp; in-place overlay writes                                                                                                                                                                                                   | Delegates query evaluation to the registered `jq` through argv-safe `ctx.exec`. Direct invocation without `ctx.exec` supports only identity and simple paths. One input file per invocation, matching the upstream implementation. XML entities/DOCTYPE are rejected.                                                                                                              |
| `xan`     | `agg`, `behead`, `cat`, `count`, `dedup`, `drop`, `enum`, `explode`, `filter`, `fixlengths`, `flatten`, `fmt`, `frequency`, `from`, `groupby`, `head`, `headers`, `implode`, `rename`, `reverse`, `sample`, `search`, `select`, `shuffle`, `slice`, `sort`, `stats`, `tail`, `to`, `top`, `transpose`, `view` | `filter` accepts bounded `COLUMN OP VALUE` comparisons; the full Moonblade-dependent `map`/`transform` family and commands that produce multiple files fail explicitly. Search uses a work-limited regex subset: literals, `.`, `.*`, `^`, `$`. Sampling/shuffling default to a fixed seed for deterministic output. Aggregation arguments are columns, not arbitrary expressions. |
| `sqlite3` | CLI-shaped bounded read-only queries and result formatting                                                                                                                                                                                                                                                    | Requires an injected native adapter. The sql.js Worker/WASM implementation is not bundled. SQL mutations are unavailable because a binary database change cannot produce the required unified text Diff. Dot commands and interactive mode are unavailable.                                                                                                                        |

## SQLite adapter contract

The adapter receives database bytes and must operate on an isolated temporary
native database. It must enforce the supplied deadline, row/column/cell/output
and database-size limits before data crosses the bridge. It must disable loadable
extensions, `ATTACH`, unsafe pragmas and custom functions with side effects. It
must open the database read-only and must not write the project filesystem,
temporary input bytes, or connector itself. It returns `changed: false`; any
mutation claim or returned database payload is rejected at the JS trust boundary.

An absent adapter produces exit code 127. Mutation SQL produces exit code 126
before adapter execution. This prevents the UI from presenting a fake SQLite
feature or bypassing the normal text Diff/recovery flow.

The JavaScript-side read-only classifier deliberately accepts only statements
starting with `SELECT`, `VALUES`, or `EXPLAIN`. `WITH` and `PRAGMA` are rejected
even when they might be read-only; the native adapter must independently parse
and enforce read-only execution rather than relying on this preflight check.

## Default bounds

- 4 MiB command input and 1 MiB text/binary output
- 8 MiB archive/database input, 16 MiB total extracted tar data
- 2,048 archive members and 4,096 traversed project entries
- 10,000 CSV rows, 200,000 CSV cells, 64 KiB per cell
- 1,000 SQL rows, 128 columns, 64 KiB per cell, 3 second deadline
- 64 structured-data depth and 100,000 nodes

Hosts can lower these limits. Invalid, zero, negative, fractional, or unsafe
integer limits are rejected at construction.

## Attribution

Command behavior and selected implementation structure are adapted from
[Vercel Labs just-bash 3.2.0](https://github.com/vercel-labs/just-bash/tree/1e06ce63c4f4e34b110283f419988b044135f779),
Apache-2.0. See `NOTICE` for dependency attribution.
