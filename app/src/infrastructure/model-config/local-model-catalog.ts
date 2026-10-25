/** Pinned public artifacts. Never substitute a different revision by filename. */
export const LOCAL_MODELS = [
  {
    id: "bonsai2-local",
    modelId: "Ternary-Bonsai-2-2B-Q2_0",
    name: "Ternary Bonsai 2 · 2B",
    repository: "prism-ml/Ternary-Bonsai-2-2B-gguf",
    revision: "683f7be2629342a50987627b40881e54761a2430",
    filename: "Ternary-Bonsai-2-2B-Q2_0.gguf",
    bytes: 546689504,
    sha256: "c2893fa6f951daee8b7263d5f49b455e57989ef56417a22125b03566dc560650",
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/blob/683f7be2629342a50987627b40881e54761a2430/README.md",
    androidGpuLayers: 0,
    iosGpuLayers: 99,
    sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0,
      presence_penalty: 1.5, repeat_penalty: 1, repeat_last_n: 64 },
  },
  {
    id: "bolt-e4b-local",
    modelId: "Nemotron-3.5-Bolt-E4B-UD-Q4_K_XL",
    name: "Nemotron 3.5 Bolt E4B",
    repository: "unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF",
    revision: "b738967d6da3441a7d1c71fcec15e49e32e16ecd",
    filename: "NVIDIA-Nemotron-3.5-Bolt-E4B-UD-Q4_K_XL.gguf",
    bytes: 5060482240,
    sha256: "84ff34f5834b929043f5ae74799e8d562d4056998f6a5923ceb44831e8ad84d6",
    license: "OpenMDW-1.1",
    licenseUrl: "https://openmdw.ai/license/1-1/",
    androidGpuLayers: 99,
    iosGpuLayers: 99,
    sampling: undefined,
  },
] as const;

export type LocalModel = (typeof LOCAL_MODELS)[number];
export type LocalModelId = LocalModel["id"];
export const DEFAULT_LOCAL_MODEL_ID: LocalModelId = "bonsai2-local";
export function localModelById(id: string): LocalModel {
  const model = LOCAL_MODELS.find((model) => model.id === id);
  if (!model) throw new Error("Unknown local model");
  return model;
}
export function modelDownloadUrl(model: LocalModel) {
  return `https://huggingface.co/${model.repository}/resolve/${model.revision}/${model.filename}?download=true`;
}
export function artifactSpec(model: LocalModel) {
  return JSON.stringify({ key: model.id, bytes: model.bytes, sha256: model.sha256 });
}
