---
name: build-h5
description: Create, modify, and preview mobile-friendly HTML5 pages, apps, data visualizations, and mini games in the current project. Use when the user asks for H5, HTML/CSS/JavaScript, a web demo, interactive prototype, form, dashboard, Canvas experience, browser game such as Snake, or to open or preview a project web page. Use the app's fixed offline Preact, Hooks, and HTM runtime directly for standard apps and Phaser for games. Vanilla is only a static fallback; never add remote scripts yourself.
---

# Build H5 projects

## Workflow

1. Call `project_context_read` first, then use `ls`, `find`, and `read` to confirm existing entry points and project constraints. Read the `use-h5-resources` Skill only when the product actually needs bundled icons, fonts, or game sprites; then use `project_resource_catalog` to find exact paths before copying only the required files with `project_resource_copy`. Do not browse resource packs merely because they are enabled when text, CSS, or a project SVG is sufficient.
2. Prefer an existing app directory. A project may contain multiple H5 apps. When creating one, derive a short ASCII slug from its name and use a dedicated `/project/apps/<slug>/` directory. A new project may not have `/project/apps` yet, so avoid collisions by running `find` from the always-present `/project` root with the pattern `apps/*/boltpocket.h5.json`; never use the possibly absent `/project/apps` directory itself as the search root. Never create or overwrite `/project/index.html`.
3. Choose one primary profile from the table below. Standard apps use `preact-htm`, which already includes Preact, Hooks, and HTM. Games use `phaser`. Use the `vanilla` fallback only for purely static content or when a state framework is explicitly unnecessary. Use at most one primary profile and one add-on.
4. Create `boltpocket.h5.json`, `index.html`, `styles/app.css`, and `scripts/app.js`. JavaScript must live in local files. Do not use inline scripts, inline event handlers, custom Import Maps, remote `<script>` elements, dynamically executed downloads, `eval`, `new Function`, npm, Node, bundlers, or floating versions.
5. Use the upstream `write` tool to create or fully rewrite text files and the upstream `edit` tool for precise changes to existing files. Change no more than 10 files in one run. For a more complex app, deliver a working skeleton first and expand it incrementally. Put every change in the same reviewable Diff. Files cannot be deleted.
6. Build a mobile-first, touch-friendly, accessible interface that respects safe areas. Bound the DOM, listeners, timers, animation loops, and logs. Pause unnecessary work when the page is hidden, the preview is collapsed, or the game ends.
7. Use `read` to check the manifest, entry point, and important references, then call `preview_project` with `/project/apps/<slug>/index.html`. If native capabilities are required, set `present=true` so the user can directly verify interactions that may invoke an operating-system permission or picker. Never attempt to grant permission on the user's behalf.
8. When the manifest `permissions` array is empty, read the `operate-browser` Skill and follow its boundaries to run one minimal core-path smoke test with the preview's returned `taskId`. If any permission is declared, skip automated interaction and hand the preview to the user. Never close a preview handed to the user.
9. Use tool results to fix missing files, letter case, relative paths, manifest issues, and smoke-test failures. When complete, the entry point appears automatically under H5 apps on the project home page. In the final response, state the entry point, selected profile, main interactions, declared permissions, preview and smoke-test status, and actual limitations.

## Profile selection

| Requirement                                            | `profile`    | Rule                                            |
| ------------------------------------------------------ | ------------ | ----------------------------------------------- |
| Standard apps, forms, lists, multiple views, state     | `preact-htm` | Default; use Preact, Hooks, and HTM             |
| Canvas games, sprites, physics, audio, multiple scenes | `phaser`     | Prefer the bundled Phaser even for simple games |
| Static content or explicitly no state framework        | `vanilla`    | Fallback only; use DOM, Canvas, or SVG          |

- For rich data charts, add the single `echarts` add-on to `vanilla` or `preact-htm`.
- Do not combine `phaser` with `echarts`.
- Do not use React, Vue, Lit, Three.js, Tailwind Play CDN, or an unregistered framework. If the user explicitly requests a runtime that is not in the manifest, explain the limitation and continue with the closest bundled profile. Do not insert another CDN URL.

## File layout and manifest

```text
/project/apps/<slug>/
├── boltpocket.h5.json
├── index.html
├── styles/app.css
├── scripts/app.js
├── scripts/<feature>.js
├── data/<name>.json
├── assets/<name>.svg
└── assets/vendor/<pack-id>/<copied-file>
```

`boltpocket.h5.json` must use exactly this structure, with no extra fields:

```json
{
  "schema": 3,
  "title": "App name",
  "description": "Optional one-line description",
  "entry": "index.html",
  "profile": "preact-htm",
  "addons": [],
  "resources": [],
  "permissions": [
    {
      "id": "location",
      "purpose": "Show nearby stores",
      "mode": "once",
      "recipients": ["map-api"]
    }
  ],
  "network": [
    {
      "id": "map-api",
      "origin": "https://map.example.com",
      "purpose": "Find nearby stores"
    }
  ]
}
```

- `profile` must be `vanilla`, `preact-htm`, or `phaser`.
- `addons` must be empty or contain only `echarts`.
- `resources` may contain only `bootstrap-icons`, `kenney-ui`, and `kenney-1bit` packs that are enabled for the current project, copied with `project_resource_copy`, and actually referenced. Preview does not fabricate missing resources; a declared pack without a project copy fails validation.
- `permissions` declares only capabilities that are actually needed. Every item includes an `id`, a concrete user-facing `purpose`, and the fixed `mode`. Allowed IDs are `location`, `camera`, `microphone`, `fileSelection`, `motionSensors`, `clipboardRead`, `clipboardWrite`, `sharing`, `fullscreenMedia`, `autoplayMedia`, `screenWakeLock`, `vibration`, `pictureInPicture`, `airPlay`, `protectedMedia`, `screenOrientation`, `printing`, and `barcodeDetection`.
- The mode must be `once` for `location`, `camera`, `microphone`, `fileSelection`, `clipboardRead`, `clipboardWrite`, `sharing`, `printing`, and `barcodeDetection`; every other capability uses `session`.
- `network` is required; use an empty array for an offline app. Each item declares one canonical, exact HTTPS or WSS origin without a path, query, credentials, or wildcard, plus a concrete purpose. Declare every external API, WebSocket, image, font, stylesheet, and media origin individually. Remote scripts remain prohibited.
- When `network` is non-empty, every permission must include `recipients`: reference each matching `network.id` that receives capability data, or use an empty array when the data stays in the mini app. Offline mini apps may omit the field. Never reference an undeclared recipient.
- Undeclared capabilities and capabilities disabled in Browser Settings are denied. The host also obtains explicit consent bound to this mini-app and exact content hash. Session grants expire when the preview is hidden, closed, or replaced; the operating system may still show its own permission prompt or picker.
- `index.html` contains only semantic structure, style entry points, and local script entry points. Every project-file reference uses `./` or `../` and stays inside the current app directory.
- Keep a typical app to 4–9 files. Do not create empty files or excessively small modules.

## Bundled runtime usage

Frameworks ship with the app in one fixed ZIP. On first use, the ZIP is verified and extracted once as an app-wide, read-only copy shared by all project H5 apps. No components are downloaded at runtime. Project code uses only the stable entry points below and never includes framework URLs, versions, hashes, or runtime paths.

When maintaining the offline ZIP, retain the multi-source download strategy: Preact, Hooks, HTM, and ECharts fall back through `npmmirror → jsDelivr → UNPKG`; Phaser falls back through `BootCDN → Staticfile → jsDelivr → UNPKG`. Bytes and SHA-256 must match pinned values before an artifact enters the ZIP. This is only a pre-release app build strategy. Agent-generated project code must not include these CDN URLs or implement a remote loader.

### Vanilla fallback

Use a local module in HTML only when no framework is needed or an explicit fallback is required:

```html
<script type="module" src="./scripts/app.js"></script>
```

Bind interactions with `addEventListener`; do not use inline handlers such as `onclick`.

### Preact + Hooks + HTM

The app injects fixed UMD runtimes in order. A local module reads their public objects from `globalThis`:

```js
const { h, render } = globalThis.preact;
const { useEffect, useState } = globalThis.preactHooks;
const html = globalThis.htm.bind(h);
```

Components must clean up timers, subscriptions, media tracks, and animation loops. Do not import Preact again or construct remote module URLs.

### ECharts

After declaring `"addons": ["echarts"]`, use the global `echarts` object. Give the container an explicit height. Call `chart.resize()` when its size changes and `chart.dispose()` when the page is hidden or unmounted.

### Phaser

After declaring `"profile": "phaser"`, use the global `Phaser` object. Prefer automatic Canvas/WebGL selection, pause scenes on hidden pages, and destroy unused game instances. Search enabled bundled resource packs for images and follow the `use-h5-resources` Skill to declare and reference them. If no asset fits, use project SVG/CSS or an exact HTTPS media origin declared in the manifest and accepted by the user.

## Browser capabilities

Use only standard Web APIs. Feature-detect each capability and provide a fallback for denial or absence. Do not access, guess, or wrap internal JavaScript objects from the host app.

- DOM, Canvas, SVG, touch, pointer, keyboard, native ES Modules, same-directory `fetch()`, Web Audio, and page-lifetime state are supported.
- Only exact HTTPS/WSS origins declared in `network` and accepted by the user before loading may access the network, and they remain subject to CORS and CSP. There is no cross-origin proxy. Remote JavaScript, WebAssembly, and other executable code are not available network resources.
- Use IndexedDB, Cache Storage, Web Crypto, Media Session, and OPFS only as feature-detected enhancements. Startup, offline recovery, and core data must not depend on them. Site data is not guaranteed to persist after project preview closes. Web Workers, Shared Workers, and Service Workers are unavailable.
- Preview is isolated from the regular browser and does not share cookies, logins, or credentials. Only ordinary web pages use the app-wide cookie store.

### User-authorized capabilities

- Give every capability an accurate manifest purpose. Do not build a substitute permission dialog or treat one tap as consent to unrelated capabilities; the host owns and binds consent.
- Use `navigator.mediaDevices.getUserMedia()` for camera and microphone access. Request it only after a user action, and stop every `MediaStreamTrack` when finished, hidden, or leaving the page.
- Use `navigator.geolocation` for location, set a reasonable `timeout`, call `clearWatch()` promptly, and never request background location.
- Use `<input type="file">` for files. Read only files explicitly selected by the user and never access arbitrary directories.
- On iOS, call motion and orientation `requestPermission()` methods from a user click flow.
- Use `navigator.clipboard.readText()` and `writeText()` only in response to user actions. Never poll the clipboard.
- Use `navigator.share()` for sharing, `screen.orientation` for orientation, `window.print()` for printing, and `navigator.wakeLock` for keeping the screen awake. Feature-detect each capability and restore state on exit.
- Calling `navigator.permissions.query()` only reads status; an actual capability call may still raise `NotAllowedError`.

### QR codes and barcodes

Use the standard `BarcodeDetector`; do not call a host bridge directly. Live scanning declares both `camera` and `barcodeDetection`.

1. Detect `BarcodeDetector`, call `getSupportedFormats()`, and use only returned formats.
2. On both iOS and Android, the host may provide a consent-gated `BarcodeDetector` compatibility layer. Use only formats actually returned by `getSupportedFormats()` and never probe the internal bridge.
3. Limit live scans to roughly 4–8 per second and never run concurrent `detect()` calls. Stop scanning and the camera after success, when hidden, or on exit.
4. Cross-origin images must permit CORS before pixels can be read safely. Provide image selection or manual entry as a fallback.

## Preview and distribution boundaries

- H5 apps are private, source-visible content inside the user's current project. Do not build a remote mini-app marketplace, third-party directory, remote manifest, hidden download entry point, or executable-code sharing across projects.
- Project H5 apps on both iOS and Android call only standard Web APIs; after user consent the host may implement an API through an internal compatibility layer. Never access that bridge, feature-detect every capability, and handle absence.
- The app's runtime registry and offline ZIP ship with an app version and cannot be added, replaced, or upgraded remotely by a server. CDN failover is only used to build the ZIP before release. The installed app verifies and reuses one global offline copy.
- Preview is a read-only static snapshot created by the app. It does not provide Node, npm, a server process, an arbitrary file system, background jobs, or a build service.
- Form submission, iframes, plugins, external top-level navigation, pop-ups, and downloads are prohibited. Do not embed passwords, tokens, private keys, `.env` data, project memories, or Skill content.
- Do not depend on WebAuthn, payments, Bluetooth, NFC, USB, Serial, HID, screen capture, Push, background notifications, background location, PWA installation, or directory writes.
- A single file is limited to 1 MiB, a project to 512 files, and a project snapshot to 8 MiB. Shared frameworks do not count; bundled resources copied into the project count at their actual byte size.

## Mini-game acceptance

For a Canvas game such as Snake, support both touch/swipe and keyboard controls, prevent immediate reversal, show the score and a restart action, and handle boundaries, self-collision, food placement, and pause correctly. Scale Canvas by device pixel ratio, prevent gestures over the game surface from scrolling the page, and keep controls usable at 320pt width.
