---
name: use-bootstrap-icons
description: Use bundled Bootstrap Icons font icons in a project H5 app. Use when the user needs semantic interface icons such as navigation, status, button, QR-code, or camera symbols. Do not use them for game sprites or illustrations. Search for the exact className returned by the catalog; never guess an icon name or write a font code point manually.
---

# Use Bootstrap Icons

## Resource pack

- Pack ID: `bootstrap-icons`
- Pinned version: 1.13.1
- License: MIT
- Contents: 2,078 indexed font icons, CSS, WOFF2, and license
- Project path: `./assets/vendor/bootstrap-icons/`

Use this pack only when it appears in the current project's `resourcePacks`, and add `bootstrap-icons` to `boltpocket.h5.json.resources`.

## Find and reference icons

1. Call `project_resource_catalog` with `action: "search"`, `packId: "bootstrap-icons"`, and a short English semantic term such as `camera`, `qr-code`, `folder`, `arrow`, or `check`.
2. Use only the `className` in a result. If similar results are ambiguous, compare names or search with another term.
3. Call `project_resource_copy` with the current H5 `appRoot`, `packId: "bootstrap-icons"`, and `paths: ["bootstrap-icons.min.css"]`. The tool also copies the WOFF2 dependency used by the CSS.
4. Include the project stylesheet once in the `<head>` of `index.html`:

```html
<link
  rel="stylesheet"
  href="./assets/vendor/bootstrap-icons/bootstrap-icons.min.css"
/>
```

5. Use the class returned by the catalog:

```html
<button type="button" aria-label="Scan QR code">
  <i class="bi bi-qr-code-scan" aria-hidden="true"></i>
</button>
```

Style icons only with `font-size`, `line-height`, and `color`. Do not read or hand-write Unicode font code points, encode WOFF2 yourself, or invent a `bi-*` name that does not exist.

## Interface rules

- Give decorative icons `aria-hidden="true"`. Icon-only buttons require an `aria-label`, and important actions should usually include visible text.
- Icons inherit the current text color and must retain sufficient contrast on light and dark backgrounds.
- Touch targets must be at least 44 × 44 CSS px. Do not scale the entire button merely to enlarge an icon.
- Bootstrap Icons suit functional symbols, not game characters, brand illustrations, or large backgrounds. Use a more suitable pack or project SVG/CSS for those cases.

Finally, call `preview_project` and confirm that the CSS and font do not return 404, icons do not render as empty boxes, and controls have accessible names.
