# Third-party notices

`@boltpocket/project-shell` depends on, but does not claim authorship of, these
upstream projects:

## just-bash 3.2.0

- Project: <https://github.com/vercel-labs/just-bash>
- Pinned source revision audited for this integration:
  `1e06ce63c4f4e34b110283f419988b044135f779`
- License: Apache License 2.0
- License text: <https://www.apache.org/licenses/LICENSE-2.0>

The command behavior, parser, interpreter, in-memory filesystem, and browser
command implementations are provided by just-bash. BoltPocket supplies a scoped
wrapper and React Native capability boundaries around the published browser
entry point.

## fflate 0.8.3

- Project: <https://github.com/101arrowz/fflate>
- License: MIT
- Copyright (c) 2026 Arjun Barrett

fflate powers the local React Native `node:zlib` compatibility subset.

## buffer 6.0.3

- Project: <https://github.com/feross/buffer>
- License: MIT
- Copyright (c) Feross Aboukhadijeh and other contributors

buffer supplies the explicit browser-compatible byte/base64 API for Hermes
paths where just-bash references `Buffer`.

The full MIT license texts for fflate and buffer are distributed in their
installed packages. All upstream projects remain subject to their own license
terms.
