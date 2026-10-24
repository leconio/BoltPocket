---
name: use-h5-resources
description: Find and copy the app's bundled offline font icons, game UI sprites, pixel sprite sheets, and sample Tilemaps for a project H5 app. Use when the user requests icons, fonts, button skins, game art, character or scene sprites, Tilemaps, offline resources, or images for an H5 app or mini game. Always obtain exact names through project_resource_catalog before copying files into the current H5 app with project_resource_copy. Never guess or reference hidden paths.
---

# Use bundled H5 resources

## Choose a resource pack

Read only the pack-level Skill that is actually needed:

| Requirement                                             | Pack ID           | Skill                 |
| ------------------------------------------------------- | ----------------- | --------------------- |
| Standard UI icons, status symbols, accessible buttons   | `bootstrap-icons` | `use-bootstrap-icons` |
| Game button skins, checkboxes, sliders, game fonts      | `kenney-ui`       | `use-kenney-ui`       |
| 16px sprite sheets, Tilemap samples, Phaser pixel games | `kenney-1bit`     | `use-kenney-1bit`     |

Prefer Bootstrap Icons for standard apps, Kenney UI only for game-like interfaces, and Kenney 1-Bit only for pixel games or map scenes. Select the smallest set of packs that completes the task.

## Shared resource-pack contract

1. Call `project_context_read` and use only packs enabled in the current project's `resourcePacks`.
2. Read the matching pack-level Skill, then call `project_resource_catalog`. Use `list_packs` to confirm a pack. When the purpose is known, use `search` with an English keyword and the matching `packId`; when browsing, use `list_files`, `offset`, and `limit`.
3. The catalog is the only source of truth for paths, types, byte sizes, SHA-256, image dimensions, and icon names. Never guess icon classes, file names, dimensions, formats, or sprite semantics.
4. Call `project_resource_copy` with `/project/apps/<slug>`, the pack ID, and only the catalog paths that are needed. The tool includes known dependencies and copies exact bytes to `assets/vendor/<pack-id>/`. Do not Base64-encode binaries yourself or create binary files with `write`.
5. Add a pack ID to `resources` in the H5 app's `boltpocket.h5.json` only after the pack has been copied and is actually used. Do not declare packs that were not copied or are unused.
6. Reference only project paths returned by the copy operation. Use `ls` or `find` to confirm copies exist, then use `read` to check the manifest and text references.
7. Call `preview_project` to verify actual loading. Check for 404s, font fallback, image dimensions, and sprite slicing. Fix errors and preview again.
8. If a pack is disabled or has no suitable asset, draw with project SVG/CSS or explain the limitation to the user. Never download remote scripts, fabricate file paths, or bypass project switches.

The app keeps one verified source copy of each pack. Selected files are copied into a project when used. Project copies participate in the same Diff, recovery point, and persistence flow, can travel with the project, and cannot be overwritten as text by the Agent.

## Manifest and paths

Example manifest:

```json
{
  "schema": 3,
  "title": "Pixel game",
  "entry": "index.html",
  "profile": "phaser",
  "addons": [],
  "resources": ["bootstrap-icons", "kenney-1bit"],
  "permissions": [],
  "network": []
}
```

The copy destination is fixed at `assets/vendor/<pack-id>/` under the H5 app root. Resolve each path from the referencing file:

- In `index.html`, use `./assets/vendor/<pack-id>/<path>`.
- In `styles/app.css`, use `../assets/vendor/<pack-id>/<path>`.
- In `scripts/app.js`, use `new URL("../assets/vendor/<pack-id>/<path>", import.meta.url).href`.

## Boundaries

- These packs ship with the signed app and are not updated over the network at runtime. Every file has a pinned SHA-256 and is verified when first extracted.
- Bootstrap Icons uses the MIT license; both Kenney packs use CC0-1.0. Retain the app's third-party license records and do not claim that the user or Agent created the assets.
- Copied resources are fixed binary files in the current project. They are visible through `ls`, `find`, and the file manager; the seven text tools cannot overwrite them.
- The upstream Kenney 1-Bit pack has no semantic label for each frame. Rely only on verified sprite-sheet dimensions and slicing rules. Visually confirm a chosen frame in preview and never present a guess as catalog fact.
