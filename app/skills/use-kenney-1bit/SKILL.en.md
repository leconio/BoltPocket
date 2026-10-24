---
name: use-kenney-1bit
description: Use the Kenney 1-Bit Pack's bundled 16px sprite sheets and Tilemap samples in a project H5 pixel game. Use when the user requests pixel characters, terrain, a platformer, maze, map, Phaser sprites, or retro game art. The upstream pack has no semantic label for each frame, so visually verify specific frames in preview and never invent their meaning.
---

# Use Kenney 1-Bit Pack

## Resource pack

- Pack ID: `kenney-1bit`
- Pinned version: 1.2
- License: CC0-1.0
- Base tile: 16 × 16 px
- Layout: 49 columns × 22 rows, 1,078 frames total
- Project path: `./assets/vendor/kenney-1bit/`

Use this pack only when it appears in the current project's `resourcePacks`, and add `kenney-1bit` to `boltpocket.h5.json.resources`.

## Select a sprite sheet

Use `list_files` or `search` in `project_resource_catalog` for `tilesheets`, `packed`, `transparent`, `colored`, or `monochrome`. Always use the exact path and dimensions returned by the catalog.

After selecting a sheet, call `project_resource_copy` to copy its exact path into the current H5 `appRoot`. Copy only sheets or map files the game actually uses.

- A packed sheet without spacing is 784 × 352 px. Each frame is 16 × 16, at `column * 16, row * 16`.
- A sheet with 1px spacing is 832 × 373 px, with `margin: 0` and `spacing: 1`. Coordinates are `column * 17, row * 17`.
- Frame numbers use `row * 49 + column`.

The upstream pack provides no per-frame semantic names or authoritative frame labels. This Skill guarantees only the slicing rules; it cannot guarantee that a frame number represents a character, food, or wall. First create a small sprite preview grid and inspect it visually, then put verified frame numbers into the game. Never record a guess as a catalog fact.

## Phaser

Prefer the packed transparent color sheet:

```js
const sheet = new URL(
  "../assets/vendor/kenney-1bit/tilesheets/colored-transparent_packed.png",
  import.meta.url,
).href;

// scene.preload
this.load.spritesheet("tiles", sheet, {
  frameWidth: 16,
  frameHeight: 16,
});
```

For the spaced sheet, also pass `margin: 0, spacing: 1`. Load a texture once and reuse frames; do not reload textures, create images, or rebuild animations for every frame.

## Canvas

Slicing formula for a packed sheet:

```js
const column = frame % 49;
const row = Math.floor(frame / 49);
context.imageSmoothingEnabled = false;
context.drawImage(sheet, column * 16, row * 16, 16, 16, x, y, 32, 32);
```

Set `image-rendering: pixelated` in CSS and scale by integer multiples. Avoid half-pixel coordinates that blur the image.

## Tilemap boundaries

Files under `tilemaps/*.tmx` are example maps, and `tilemaps/tileset_colored.tsx` is Tiled metadata. Confirm exact names with the catalog first. The H5 runtime has no general TMX parser. For a simple project, prefer a controlled JSON object or array inside the project. If an example must be parsed, read its XML text and implement only the fields needed for the task; never add a remote parser script.

Finally, call `preview_project` and check texture loading, slice alignment, transparent backgrounds, pixel scaling, and whether the game pauses when the page is hidden.
