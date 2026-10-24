import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type {
  SkillBundleFile,
  SkillCapability,
} from "./ports/capability-catalog.ts";
import {
  applyChangeProposal,
  selectChangeProposalHunks,
} from "./change-workflow.ts";
import { buildProjectSkillBundleInstallProposal } from "./project-skill-bundle-install.ts";
import { skillBundleFingerprintInput } from "./skill-bundle.ts";
import { appReducer } from "../domain/app-state-reducer.ts";
import {
  createPersistedAppState,
  decodePersistedAppState,
  restorePersistedAppState,
} from "../infrastructure/persistence/persisted-app-state.ts";
import { seededAppState } from "../testing/app-state-fixtures.ts";

const skillDocument = [
  "---",
  "name: complete-review",
  'title: "Complete review"',
  'description: "Review a complete package."',
  "risk: propose",
  "---",
  "",
  "# Review",
  "",
  "Read references/policy.md.",
  "",
].join("\n");

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function capability(): SkillCapability {
  const binaryBytes = Uint8Array.from([0, 1, 2, 255]);
  const files: SkillBundleFile[] = [
    {
      byteLength: new TextEncoder().encode(skillDocument).byteLength,
      content: skillDocument,
      encoding: "utf8",
      executable: false,
      mimeType: "text/markdown",
      path: "SKILL.md",
      sha256: sha256(skillDocument),
    },
    {
      byteLength: binaryBytes.byteLength,
      content: "AAEC/w==",
      encoding: "base64",
      executable: false,
      mimeType: "application/octet-stream",
      path: "assets/pixel.bin",
      sha256: sha256(binaryBytes),
    },
    {
      byteLength: 9,
      content: "# Policy\n",
      encoding: "utf8",
      executable: false,
      mimeType: "text/markdown",
      path: "references/policy.md",
      sha256: sha256("# Policy\n"),
    },
  ];
  const bundleSha256 = sha256(skillBundleFingerprintInput(files));
  return {
    bundle: {
      complete: true,
      files,
      sha256: bundleSha256,
      totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
    },
    description: { en: "Review", zhCN: "审查" },
    documentationUrl: "https://skills.sh/owner/repo/complete-review",
    id: "complete-review",
    kind: "skill",
    name: { en: "Complete review", zhCN: "完整审查" },
    provider: { en: "owner/repo", zhCN: "owner/repo" },
    requirements: [],
    revision: "abc123",
    risk: "propose",
    sha256: files[0]!.sha256,
    skillDocument,
    source: {
      entryId: "owner/repo/complete-review",
      id: "skills-sh",
      kind: "skills-sh",
      name: "Skills.sh",
    },
  };
}

function proposal() {
  return buildProjectSkillBundleInstallProposal({
    capability: capability(),
    connectorLabel: "Project workspace",
    conversationId: "conversation-launch",
    createdAt: "2026-08-15T12:00:00.000Z",
    locale: "en",
    projectId: "launch",
    proposalId: "install-complete-review",
  });
}

test("a complete Skill package stages and applies every text and binary file atomically", () => {
  const stagedProposal = proposal();
  assert.equal(stagedProposal.hunks.length, 3);
  assert.equal(stagedProposal.capabilityInstall?.fileCount, 3);
  assert.equal(
    stagedProposal.hunks[1]?.binaryFile?.source.kind,
    "third-party-skill",
  );

  const stagedState = appReducer(seededAppState, {
    type: "proposal/capability-created",
    proposal: stagedProposal,
  });
  assert.equal(stagedState.proposals[stagedProposal.id], stagedProposal);

  const applied = applyChangeProposal({
    proposal: stagedProposal,
    resources: seededAppState.resources,
    receiptId: "receipt-complete-review",
    conversationId: "conversation-launch",
    appliedAt: "2026-08-15T12:01:00.000Z",
  });
  const installed = Object.values(applied.resources).filter((resource) =>
    resource.path.startsWith("skills/complete-review/"),
  );
  assert.deepEqual(installed.map((resource) => resource.path).sort(), [
    "skills/complete-review/SKILL.md",
    "skills/complete-review/assets/pixel.bin",
    "skills/complete-review/references/policy.md",
  ]);
  assert.equal(applied.receipt.changes.length, 3);
  assert.equal(
    installed.find((resource) => resource.path.endsWith("pixel.bin"))?.storage
      .kind,
    "project-workspace",
  );
});

test("a complete Skill package cannot apply only a selected subset", () => {
  const stagedProposal = proposal();
  assert.throws(
    () =>
      selectChangeProposalHunks(stagedProposal, [stagedProposal.hunks[0]!.id]),
    /必须一次应用全部文件/u,
  );
});

test("one invalid package file rejects the operation before any file is created", () => {
  const stagedProposal = proposal();
  const invalid = {
    ...stagedProposal,
    hunks: stagedProposal.hunks.map((hunk, index) =>
      index === 1 ? { ...hunk, after: "not-base64" } : hunk,
    ),
  };
  const before = seededAppState.resources;
  assert.throws(
    () =>
      applyChangeProposal({
        proposal: invalid,
        resources: before,
        receiptId: "receipt-invalid-package",
        conversationId: "conversation-launch",
        appliedAt: "2026-08-15T12:01:00.000Z",
      }),
    /二进制项目资源副本无效/u,
  );
  assert.equal(
    Object.values(before).some((resource) =>
      resource.path.startsWith("skills/complete-review/"),
    ),
    false,
  );
});

test("complete Skill package metadata and binary sources survive persistence", () => {
  const stagedProposal = proposal();
  const stagedState = appReducer(seededAppState, {
    type: "proposal/capability-created",
    proposal: stagedProposal,
  });
  const restored = restorePersistedAppState(
    seededAppState,
    decodePersistedAppState(
      JSON.stringify(createPersistedAppState(stagedState)),
    ),
  );
  const restoredProposal = restored.proposals[stagedProposal.id];
  assert.equal(restoredProposal?.kind, "capability");
  assert.deepEqual(
    restoredProposal?.capabilityInstall,
    stagedProposal.capabilityInstall,
  );
  assert.equal(
    restoredProposal?.hunks[1]?.binaryFile?.source.kind,
    "third-party-skill",
  );
});

test("the reducer rejects a package proposal whose declared file count changed", () => {
  const stagedProposal = proposal();
  const invalid = {
    ...stagedProposal,
    capabilityInstall: {
      ...stagedProposal.capabilityInstall!,
      fileCount: 2,
    },
  };
  assert.equal(
    appReducer(seededAppState, {
      type: "proposal/capability-created",
      proposal: invalid,
    }),
    seededAppState,
  );
});
