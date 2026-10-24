import { requireOptionalNativeModule } from "expo-modules-core";

import {
  createQuickJsExecutor,
  type QuickJsExecutionInput,
  type QuickJsNativeAdapter,
} from "./executor.ts";

export type {
  QuickJsAvailability,
  QuickJsExecutionInput,
  QuickJsExecutionResult,
  QuickJsExecutor,
  QuickJsNativeAdapter,
} from "./executor.ts";
export { createQuickJsExecutor, QUICK_JS_LIMITS } from "./executor.ts";

const nativeAdapter =
  requireOptionalNativeModule<QuickJsNativeAdapter>("BoltPocketQuickJs");

export const BoltPocketQuickJs = createQuickJsExecutor(nativeAdapter);
export const availability = BoltPocketQuickJs.availability;
export const quickJsAvailability = availability;
export const isAvailable = BoltPocketQuickJs.isAvailable;

export function execute(input: QuickJsExecutionInput) {
  return BoltPocketQuickJs.execute(input);
}
