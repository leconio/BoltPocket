import { NativeModule, requireNativeModule } from "expo-modules-core";

type Events = { onNativeEvent: (event: { json: string }) => void };
declare class BoltRuntimeModule extends NativeModule<Events> {
  prepareModelFile(): Promise<string>;
  load(gpuLayers: number): Promise<void>;
  generate(payload: string, maxTokens: number, tag: string): Promise<void>;
  cancel(): void;
  probe(options: string): Promise<void>;
  record(event: string): void;
}
export default requireNativeModule<BoltRuntimeModule>("BoltRuntime");
