import assert from "node:assert/strict";
import test from "node:test";

import { builtInProjectResourcePack } from "@/domain/builtin-project-resources";

import {
  listProjectResourceDirectory,
  parentProjectResourceDirectory,
} from "./project-resource-file-manager.ts";

test("bundled resource directories behave like a file browser", () => {
  const pack = builtInProjectResourcePack("kenney-ui");
  const root = listProjectResourceDirectory(pack);
  assert.deepEqual(
    root.filter((entry) => entry.kind === "directory").map(({ name }) => name),
    ["fonts", "png"],
  );
  assert.ok(root.some((entry) => entry.path === "catalog.json"));
  const blue = listProjectResourceDirectory(pack, "png/blue");
  assert.ok(
    blue.some(
      (entry) =>
        entry.kind === "file" && entry.name === "button_rectangle_flat.png",
    ),
  );
  assert.equal(parentProjectResourceDirectory("png/blue"), "png");
  assert.equal(parentProjectResourceDirectory("png"), "");
});
