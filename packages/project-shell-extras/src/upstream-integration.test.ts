import assert from "node:assert/strict";
import test from "node:test";

import { Bash } from "just-bash/browser";

import { createProjectShellExtraCommands } from "./index.ts";

test("extra command array runs directly as just-bash browser customCommands", async () => {
  const bash = new Bash({
    cwd: "/project",
    customCommands: [...createProjectShellExtraCommands()],
    files: {
      "/project/a.txt": "alpha\n",
      "/project/data.csv": "name,age\nAlice,30\nBob,20\n",
      "/project/data.yaml": "users:\n  - name: Alice\n  - name: Bob\n",
    },
  });

  const yq = await bash.exec("yq -o json '.users[1].name' data.yaml");
  assert.deepEqual(
    { stdout: yq.stdout, stderr: yq.stderr, exitCode: yq.exitCode },
    { stdout: '"Bob"\n', stderr: "", exitCode: 0 },
  );

  const xan = await bash.exec("xan filter 'age > 20' data.csv");
  assert.deepEqual(
    { stdout: xan.stdout, stderr: xan.stderr, exitCode: xan.exitCode },
    { stdout: "name,age\nAlice,30\n", stderr: "", exitCode: 0 },
  );

  const tar = await bash.exec(
    "tar -czfarchive.tgz a.txt && tar -tzf archive.tgz",
  );
  assert.deepEqual(
    { stdout: tar.stdout, stderr: tar.stderr, exitCode: tar.exitCode },
    { stdout: "a.txt\n", stderr: "", exitCode: 0 },
  );
});
