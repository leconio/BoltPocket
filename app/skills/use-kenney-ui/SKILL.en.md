---
name: use-kenney-ui
description: Use the Kenney UI Pack's bundled button skins, control icons, sliders, input fields, stars, and Kenney Future fonts in a project H5 app or mini game. Use for game-like interfaces, game menus, or HUD controls. Prefer CSS and Bootstrap Icons for a standard app interface.
---

# Use Kenney UI Pack

## Resource pack

- Pack ID: `kenney-ui`
- Pinned version: 2.0
- License: CC0-1.0
- Contents: scanned and curated Blue/Default and Extra/Default PNG files, plus Kenney Future and Kenney Future Narrow fonts
- Project path: `./assets/vendor/kenney-ui/`

Use this pack only when it appears in the current project's `resourcePacks`, and add `kenney-ui` to `boltpocket.h5.json.resources`.

## Find assets

Call `project_resource_catalog` with `action: "search"`, `packId: "kenney-ui"`, and an English file concept. Common searches include `button_rectangle`, `button_round`, `arrow`, `check`, `input`, `slide`, `star`, and `future`. Always use the exact path, width, and height returned by a result; do not infer sibling file names from an example.

After selecting assets, call `project_resource_copy` to copy only the PNG or font paths actually used into the current H5 `appRoot`. Do not copy the entire pack.

Keep one consistent style suffix, such as `flat`, `depth_flat`, or `line`, across a set of controls. Do not mix styles arbitrarily. Scanned image dimensions are the basis for layout, but a responsive interface still scales assets to available space.

## Button skins

A PNG provides appearance only. Preserve semantic elements, text, and focus states for real interactions:

```css
.game-button {
  min-width: 144px;
  min-height: 48px;
  border: 0;
  background: url("../assets/vendor/kenney-ui/png/blue/button_rectangle_flat.png")
    center / 100% 100% no-repeat;
  color: #10233f;
}

.game-button:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 3px;
}
```

```html
<button class="game-button" type="button">Start game</button>
```

Do not bake button text into an image or replace `<button>`, `<input>`, or a checkbox with a plain image. Preserve the source aspect ratio when stretching is visible, or draw the background with CSS instead.

## Fonts

Reference fonts from `styles/app.css`:

```css
@font-face {
  font-family: "Kenney Future";
  src: url("../assets/vendor/kenney-ui/fonts/kenney-future.ttf")
    format("truetype");
  font-display: swap;
}
```

Keep the system font for body text to preserve readability. Prefer Kenney fonts for short headings, scores, and game buttons. Provide a system-font fallback and verify fallback glyphs for every language the page supports.

Finally, call `preview_project` and check every PNG, font, touch target, focus style, and narrow-screen scale.
