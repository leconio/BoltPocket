import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { ChatScreen } from "./chat-screen";
import {
  useAppActions,
  useAppStateSelector,
  createAppStateFieldsSelector,
} from "@/providers/app-provider";
import {
  prepareLocalModelFile,
  recordLocalEvent,
  setLocalFixtureTag,
  subscribeLocalMetrics,
  type NativeMetrics,
} from "@/infrastructure/agent/native-bolt-runtime";
import { useAppPalette } from "@/theme/tokens";
import { useKeepAwake } from "expo-keep-awake";
import NativeBolt from "@boltpocket/expo-bolt-runtime";

const select = createAppStateFieldsSelector(
  "activeConversationId",
  "isHydrating",
);
const demo = [
  "Plan a relaxed Saturday in Shenzhen, starting at Futian Checkpoint. I like coffee and the coast. Reply in English in under 80 words.",
  "What if it rains in the afternoon? Keep the coffee stop and adjust the plan in three short English bullets.",
  "Give me a checklist of exactly five things to bring, in English.",
];
const bench =
  "In English, give three brief benefits and one limitation of running a language model locally on a phone. Use at most 60 words.";
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export function LocalChatScreen() {
  useKeepAwake("boltpocket-chat");
  const state = useAppStateSelector(select);
  const actions = useAppActions();
  const palette = useAppPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{
    demo?: string;
    bench?: string;
    cache?: string;
    probe?: string;
  }>();
  const started = useRef("");
  const [metrics, setMetrics] = useState<NativeMetrics>();
  useEffect(() => subscribeLocalMetrics(setMetrics), []);
  useEffect(() => {
    void prepareLocalModelFile().catch((error: unknown) =>
      recordLocalEvent({ type: "model_file_error", message: String(error) }),
    );
  }, []);
  useEffect(() => {
    const fixture = params.probe
      ? `probe-${params.probe}`
      : params.bench
        ? "bench"
        : params.demo
          ? "demo"
          : "";
    if (state.isHydrating || !fixture || started.current === fixture) return;
    started.current = fixture;
    let nativeError: string | undefined;
    const errors = NativeBolt.addListener("onNativeEvent", ({ json }) => {
      const event = JSON.parse(json) as { type: string; message?: string };
      if (event.type === "error" || event.type === "kernel_error") {
        nativeError = event.message ?? "Native inference failed";
      }
    });
    const checkNativeError = () => {
      if (nativeError) throw new Error(nativeError);
    };
    void (async () => {
      await pause(2500);
      if (params.probe) {
        actions.dispatch({
          type: "chat/new",
          conversationId: `bolt-probe-${Date.now()}`,
        });
        if (
          params.probe === "short" ||
          params.probe.startsWith("long-") ||
          params.probe === "decode"
        ) {
          await NativeBolt.load(99);
          checkNativeError();
          const sub = NativeBolt.addListener("onNativeEvent", ({ json }) => {
            const event = JSON.parse(json) as {
              type: string;
              tag?: string;
              text?: string;
            };
            if (event.type === "done" && event.tag === "gpu-short") {
              recordLocalEvent({
                type: "model_probe_result",
                answer: event.text,
                ...(params.probe === "decode" ? {} : { expected_number: 4 }),
              });
            }
          });
          try {
            const repeats = params.probe.startsWith("long-")
              ? Number(params.probe.slice(5))
              : 0;
            if (!Number.isInteger(repeats) || repeats < 0 || repeats > 2048)
              throw new Error("Invalid probe length");
            const content =
              params.probe === "decode"
                ? "In English, explain three benefits and one limitation of running a language model on a phone. Use about 80 words."
                : `${repeats ? `Read this reference text and then answer only the number 4.\n<reference>${"blue green red ".repeat(repeats)}</reference>\n` : ""}Reply with the number: 2 + 2 =`;
            await NativeBolt.generate(
              JSON.stringify({
                messages: [{ role: "user", content }],
                cache_prompt: false,
              }),
              params.probe === "decode" ? 96 : 16,
              "gpu-short",
            );
            checkNativeError();
          } finally {
            sub.remove();
          }
        } else {
          await NativeBolt.probe(params.probe);
        }
      } else if (params.bench) {
        for (let i = 0; i < 4; i++) {
          actions.dispatch({
            type: "chat/new",
            conversationId: `bolt-bench-${Date.now()}-${i}`,
          });
          await pause(300);
          setLocalFixtureTag(
            i ? `bench-${i}` : "warmup",
            params.cache !== "off",
          );
          await actions.sendMessage(i ? bench : "Reply only: Ready.");
          checkNativeError();
          await pause(2000);
        }
      } else {
        actions.dispatch({
          type: "chat/new",
          conversationId: `bolt-demo-${Date.now()}`,
        });
        await pause(300);
        for (let i = 0; i < demo.length; i++) {
          setLocalFixtureTag(`demo-${i + 1}`);
          await actions.sendMessage(demo[i]!);
          checkNativeError();
          await pause(3000);
        }
      }
      checkNativeError();
      recordLocalEvent({
        type: "fixture_finished",
        mode: params.probe ? "probe" : params.bench ? "bench" : "demo",
        timestamp: Date.now(),
      });
    })()
      .catch((error: unknown) =>
        recordLocalEvent({
          type: "fixture_error",
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => errors.remove());
  }, [
    actions,
    params.bench,
    params.cache,
    params.demo,
    params.probe,
    state.isHydrating,
  ]);
  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <ChatScreen
        conversationId={state.activeConversationId}
        onBack={() => router.push("/conversations")}
        headerAccessory={
          <Text style={[styles.metrics, { color: palette.textTertiary }]}>
            {metrics
              ? `${metrics.decode_tok_s?.toFixed(1)} tok/s · TTFT ${((metrics.submit_to_visible_ms ?? metrics.visible_ttft_ms ?? metrics.ttft_ms ?? 0) / 1000).toFixed(2)}s · ${metrics.android_pss_mib != null ? `PSS ${(metrics.android_pss_mib / 1024).toFixed(2)}` : `RSS ${((metrics.peak_memory_mib ?? 0) / 1024).toFixed(2)}`} GiB`
              : "Nemotron 3.5 Bolt E4B · On-device inference"}
          </Text>
        }
      />
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  metrics: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    textAlign: "center",
    fontSize: 10,
  },
});
