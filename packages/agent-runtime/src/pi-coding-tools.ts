import type { ToolDef } from "@earendil-works/pi-coding-agent/core/tools";

import type { RuntimeTool, ToolRisk } from "./contracts.ts";

export {
  createAllToolDefinitions,
  type BashOperations,
  type EditOperations,
  type FindOperations,
  type GrepOperations,
  type LsOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent/core/tools";

type PiContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type PiCodingToolAdapterOptions = {
  risk: ToolRisk;
};

function mobileTextContent(content: readonly PiContentBlock[]): string {
  return content
    .map((block) =>
      block.type === "text"
        ? block.text
        : `[Image result ${block.mimeType} is not exposed through the text-only mobile tool bridge.]`,
    )
    .join("\n");
}

/**
 * Thin host adapter for upstream Pi Coding Agent ToolDefinitions.
 *
 * Parameter schemas, argument preparation, execution, output formatting,
 * truncation, edit matching, and unified-patch generation remain upstream.
 * The app supplies only capability operations and its risk classification.
 */
export function adaptPiCodingToolDefinition(
  definition: ToolDef,
  options: PiCodingToolAdapterOptions,
): RuntimeTool {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    risk: options.risk,
    parameters: definition.parameters,
    prepareArguments: definition.prepareArguments,
    executionMode: definition.executionMode,
    execute: async (parameters, context) => {
      const result = await definition.execute(
        context.toolCallId,
        parameters,
        context.signal,
        (update) =>
          context.update(
            mobileTextContent(update.content as PiContentBlock[]),
            update.details,
          ),
        undefined as never,
      );
      return {
        content: mobileTextContent(result.content as PiContentBlock[]),
        details: result.details,
      };
    },
  };
}
