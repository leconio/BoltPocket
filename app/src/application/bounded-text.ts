export const AGENT_TEXT_LIMITS = Object.freeze({
  /** Ephemeral preview buffers only; the runtime result remains complete. */
  liveResponseCharacters: 12_000,
  liveThinkingCharacters: 8_000,
  storedResponseCharacters: 180_000,
  storedThinkingCharacters: 64_000,
  renderedConversationCharacters: 64_000,
  inlineConversationCharacters: 4_000,
  renderedConversationPreviewCharacters: 2_000,
  renderedDisclosureCharacters: 8_000,
  /** Cheap temporary windows; the completed message keeps the larger limits. */
  renderedLiveResponseCharacters: 1_200,
  renderedLiveDisclosureCharacters: 2_000,
  statusCharacters: 500,
  toolActivityCharacters: 120,
  toolFailureReasonCharacters: 360,
});

const DEFAULT_OMISSION = "\n\n[中间内容已省略，以控制内存占用。]\n\n";
const MAX_CHUNKS_BEFORE_COMPACTION = 128;

function assertLimit(maxCharacters: number, omission: string) {
  if (
    !Number.isSafeInteger(maxCharacters) ||
    maxCharacters < 64 ||
    omission.length >= maxCharacters
  ) {
    throw new Error("Bounded text limit is invalid.");
  }
}

/**
 * Chunked head/tail retention for provider streams. It avoids retaining an
 * unbounded reasoning transcript and avoids copying the full value per token.
 */
export class BoundedTextAccumulator {
  readonly #headLimit: number;
  readonly #maxCharacters: number;
  readonly #omission: string;
  readonly #tailLimit: number;
  #head = "";
  #parts: string[] = [];
  #partsLength = 0;
  #tailParts: string[] = [];
  #tailLength = 0;
  #truncated = false;

  constructor(maxCharacters: number, omission = DEFAULT_OMISSION) {
    assertLimit(maxCharacters, omission);
    const retainedCharacters = maxCharacters - omission.length;
    this.#maxCharacters = maxCharacters;
    this.#omission = omission;
    this.#headLimit = Math.floor(retainedCharacters / 2);
    this.#tailLimit = retainedCharacters - this.#headLimit;
  }

  append(value: string) {
    if (!value) return;
    if (this.#truncated) {
      this.#appendTail(value);
      return;
    }
    this.#parts.push(value);
    this.#partsLength += value.length;
    if (this.#partsLength <= this.#maxCharacters) {
      this.#compactPartsIfNeeded();
      return;
    }

    const combined = this.#parts.join("");
    this.#head = combined.slice(0, this.#headLimit);
    this.#tailParts = [combined.slice(-this.#tailLimit)];
    this.#tailLength = this.#tailParts[0]?.length ?? 0;
    this.#parts = [];
    this.#partsLength = 0;
    this.#truncated = true;
  }

  value() {
    if (!this.#truncated) return this.#parts.join("");
    return `${this.#head}${this.#omission}${this.#tailParts.join("")}`;
  }

  get truncated() {
    return this.#truncated;
  }

  #appendTail(value: string) {
    if (value.length >= this.#tailLimit) {
      this.#tailParts = [value.slice(-this.#tailLimit)];
      this.#tailLength = this.#tailParts[0]?.length ?? 0;
      return;
    }
    this.#tailParts.push(value);
    this.#tailLength += value.length;
    let overflow = this.#tailLength - this.#tailLimit;
    while (overflow > 0) {
      const first = this.#tailParts[0];
      if (first === undefined) break;
      if (first.length <= overflow) {
        overflow -= first.length;
        this.#tailLength -= first.length;
        this.#tailParts.shift();
      } else {
        this.#tailParts[0] = first.slice(overflow);
        this.#tailLength -= overflow;
        overflow = 0;
      }
    }
    if (this.#tailParts.length > MAX_CHUNKS_BEFORE_COMPACTION) {
      this.#tailParts = [this.#tailParts.join("")];
    }
  }

  #compactPartsIfNeeded() {
    if (this.#parts.length <= MAX_CHUNKS_BEFORE_COMPACTION) return;
    this.#parts = [this.#parts.join("")];
  }
}

export function boundText(value: string, maxCharacters: number) {
  if (value.length <= maxCharacters) return value;
  const accumulator = new BoundedTextAccumulator(maxCharacters);
  accumulator.append(value);
  return accumulator.value();
}

/** A cheap latest-output preview used only while a response is streaming. */
export function boundTailText(value: string, maxCharacters: number) {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 4) {
    throw new Error("Bounded tail text limit is invalid.");
  }
  if (value.length <= maxCharacters) return value;
  return `…\n${value.slice(-(maxCharacters - 2))}`;
}
