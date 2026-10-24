import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILT_IN_PROJECT_RESOURCE_PACK_IDS,
  enabledProjectResourcePacks,
  filterSkillsForEnabledProjectResources,
  isBuiltInProjectResourceSkillId,
  isProjectResourcePackEnabled,
  projectResourceCopyPaths,
  projectResourceH5Path,
  projectResourceSkillId,
  searchBuiltInProjectResources,
} from "./builtin-project-resources.ts";

test("built-in project resources are enabled by default and may be disabled per project", () => {
  assert.deepEqual(BUILT_IN_PROJECT_RESOURCE_PACK_IDS, [
    "bootstrap-icons",
    "kenney-ui",
    "kenney-1bit",
  ]);
  assert.equal(
    isProjectResourcePackEnabled({}, "project-a", "kenney-ui"),
    true,
  );
  const settings = { "project-a": { "kenney-ui": false } } as const;
  assert.equal(
    isProjectResourcePackEnabled(settings, "project-a", "kenney-ui"),
    false,
  );
  assert.deepEqual(
    enabledProjectResourcePacks(settings, "project-a").map(({ id }) => id),
    ["bootstrap-icons", "kenney-1bit"],
  );
  assert.equal(
    projectResourceSkillId("bootstrap-icons"),
    "use-bootstrap-icons",
  );
  assert.equal(projectResourceSkillId("kenney-ui"), "use-kenney-ui");
  assert.equal(projectResourceSkillId("kenney-1bit"), "use-kenney-1bit");
  assert.equal(isBuiltInProjectResourceSkillId("use-kenney-ui"), true);
  assert.equal(isBuiltInProjectResourceSkillId("use-h5-resources"), false);
  assert.deepEqual(
    filterSkillsForEnabledProjectResources(
      [
        { id: "build-h5" },
        { id: "use-h5-resources" },
        { id: "use-bootstrap-icons" },
        { id: "use-kenney-ui" },
        { id: "use-kenney-1bit" },
      ],
      ["bootstrap-icons", "kenney-1bit"],
    ).map(({ id }) => id),
    ["build-h5", "use-h5-resources", "use-bootstrap-icons", "use-kenney-1bit"],
  );
});

test("resource copies include pinned transitive files needed at runtime", () => {
  assert.deepEqual(
    projectResourceCopyPaths("bootstrap-icons", ["bootstrap-icons.min.css"]),
    ["bootstrap-icons.min.css", "fonts/bootstrap-icons.woff2"],
  );
  assert.deepEqual(
    projectResourceCopyPaths("kenney-ui", [
      "png/blue/button_rectangle_flat.png",
    ]),
    ["png/blue/button_rectangle_flat.png"],
  );
});

test("resource catalog search returns stable H5 paths and icon classes", () => {
  const icons = searchBuiltInProjectResources({
    packIds: ["bootstrap-icons"],
    query: "qr-code",
    limit: 4,
  });
  assert.equal(icons[0]?.kind, "icon");
  assert.match(JSON.stringify(icons), /bi bi-qr-code/u);

  const sprites = searchBuiltInProjectResources({
    packIds: ["kenney-ui"],
    query: "button_rectangle_flat",
  });
  assert.equal(sprites[0]?.kind, "file");
  assert.equal(
    sprites[0]?.kind === "file" ? sprites[0].h5Path : "",
    projectResourceH5Path("kenney-ui", "png/blue/button_rectangle_flat.png"),
  );
});
