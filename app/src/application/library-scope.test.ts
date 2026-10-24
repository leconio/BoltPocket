import assert from "node:assert/strict";
import test from "node:test";

import { projects } from "../testing/app-state-fixtures.ts";
import { resolveLibraryProject } from "./library-scope.ts";

const projectRecord = Object.fromEntries(
  projects.map((project) => [project.id, project]),
);

test("library scope is global unless its route explicitly names a project", () => {
  assert.equal(resolveLibraryProject(projectRecord, undefined), undefined);
  assert.equal(resolveLibraryProject(projectRecord, "missing"), undefined);
  assert.equal(resolveLibraryProject(projectRecord, "launch")?.id, "launch");
});
