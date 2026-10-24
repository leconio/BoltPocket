export const DEFAULT_MAX_RUN_RESOURCES = 8;
export const DEFAULT_MAX_RUN_CHARACTERS = 200_000;

export class ResourceReadBudget {
  readonly #readLengths = new Map<string, number>();
  readonly #maxResources: number;
  readonly #maxCharacters: number;
  #characters = 0;

  constructor(input?: { maxResources?: number; maxCharacters?: number }) {
    this.#maxResources = input?.maxResources ?? DEFAULT_MAX_RUN_RESOURCES;
    this.#maxCharacters = input?.maxCharacters ?? DEFAULT_MAX_RUN_CHARACTERS;
  }

  register(resourceId: string, characters: number) {
    if (this.#readLengths.has(resourceId)) return;
    if (this.#readLengths.size >= this.#maxResources) {
      throw new Error(
        `本轮最多读取 ${this.#maxResources} 个资源，请缩小任务范围后重试。`,
      );
    }
    if (this.#characters + characters > this.#maxCharacters) {
      throw new Error(
        `本轮资源正文超过 ${this.#maxCharacters} 字符，请缩小任务范围后重试。`,
      );
    }
    this.#readLengths.set(resourceId, characters);
    this.#characters += characters;
  }

  has(resourceId: string) {
    return this.#readLengths.has(resourceId);
  }

  get resourceCount() {
    return this.#readLengths.size;
  }

  get characterCount() {
    return this.#characters;
  }
}
