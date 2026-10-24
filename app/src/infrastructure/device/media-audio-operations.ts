import type { AudioPlayer } from "expo-audio";

import type { AgentDeviceCapabilityInput } from "@/application/ports/device-capabilities";

type Player = Pick<
  AudioPlayer,
  | "playing"
  | "paused"
  | "isLoaded"
  | "isBuffering"
  | "currentTime"
  | "duration"
  | "loop"
  | "volume"
  | "play"
  | "pause"
  | "seekTo"
  | "setActiveForLockScreen"
  | "clearLockScreenControls"
  | "remove"
>;

export type MediaAudioDependencies = Readonly<{
  platform: string;
  resolvePlatform?: () => Promise<string>;
  createId: () => string;
  hash: (value: string) => Promise<string>;
  requestNotificationPermission: () => Promise<Readonly<{ granted: boolean }>>;
  configure: () => Promise<void>;
  createPlayer: (url: string) => Player | Promise<Player>;
}>;

const DEFAULT_DEPENDENCIES: MediaAudioDependencies = {
  platform: "native",
  resolvePlatform: async () => (await import("react-native")).Platform.OS,
  createId: () => runtimeId(),
  hash: async (value) => {
    const Crypto = await import("expo-crypto");
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  },
  requestNotificationPermission: async () =>
    (await import("expo-audio")).requestNotificationPermissionsAsync(),
  configure: async () =>
    (await import("expo-audio")).setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
      allowsRecording: false,
      allowsBackgroundRecording: false,
      shouldRouteThroughEarpiece: false,
    }),
  createPlayer: async (url) =>
    (await import("expo-audio")).createAudioPlayer(url, {
      keepAudioSessionActive: true,
      updateInterval: 500,
    }),
};

type Playback = Readonly<{
  id: string;
  player: Player;
  source: AudioSource;
}>;

type AudioSource = Readonly<{
  url: string;
  scheme: string;
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
}>;

export class MediaAudioOperations {
  readonly #dependencies: MediaAudioDependencies;
  #playback: Playback | null = null;

  constructor(dependencies: MediaAudioDependencies = DEFAULT_DEPENDENCIES) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentDeviceCapabilityInput, signal?: AbortSignal) {
    switch (input.action) {
      case "audio_play":
        return this.#play(input, signal);
      case "audio_pause":
        return this.#control(input, "pause", signal);
      case "audio_resume":
        return this.#control(input, "resume", signal);
      case "audio_seek":
        return this.#control(input, "seek", signal);
      case "audio_status":
        return this.#status(input.playbackId);
      case "audio_stop":
        return this.#control(input, "stop", signal);
      default:
        throw new Error("不是音频播放动作。");
    }
  }

  async #play(input: AgentDeviceCapabilityInput, signal?: AbortSignal) {
    const platform = await resolvedPlatform(this.#dependencies);
    assertSupportedPlatform(platform);
    const source = parseAudioSource(input);
    if (platform === "android") {
      const permission =
        await this.#dependencies.requestNotificationPermission();
      if (!permission.granted) {
        throw new Error(
          "未获得通知权限；为保证始终显示媒体通知，本次不会静默播放音频。",
        );
      }
    }
    await this.#dependencies.configure();
    assertNotAborted(signal);
    this.#disposeCurrent();
    const player = await this.#dependencies.createPlayer(source.url);
    try {
      player.loop = input.loop ?? false;
      player.volume = boundedNumber(input.volume, 0, 1, 1, "volume");
      if (input.positionSeconds !== undefined) {
        await player.seekTo(
          boundedNumber(input.positionSeconds, 0, 86_400, 0, "positionSeconds"),
        );
      }
      player.setActiveForLockScreen(true, {
        title: source.title,
        ...(source.artist ? { artist: source.artist } : {}),
        ...(source.album ? { albumTitle: source.album } : {}),
        ...(source.artworkUrl ? { artworkUrl: source.artworkUrl } : {}),
      });
      const playbackId = `audio-${this.#dependencies.createId()}`;
      const patch = await this.#patch("audio.play", null, {
        playbackId,
        scheme: source.scheme,
        title: source.title,
        artist: source.artist ?? "",
        album: source.album ?? "",
        loop: player.loop,
        volume: player.volume,
        positionSeconds: input.positionSeconds ?? 0,
        mediaNotification: true,
      });
      assertNotAborted(signal);
      player.play();
      this.#playback = { id: playbackId, player, source };
      return this.#mutationResult("audio_play", patch, {
        ...this.#status(playbackId),
        mediaNotification: true,
        mediaChannel: platform === "android",
        recovery: { action: "audio_stop", playbackId },
      });
    } catch (error) {
      player.pause();
      player.clearLockScreenControls();
      player.setActiveForLockScreen(false);
      player.remove();
      throw error;
    }
  }

  async #control(
    input: AgentDeviceCapabilityInput,
    operation: "pause" | "resume" | "seek" | "stop",
    signal?: AbortSignal,
  ) {
    const playback = this.#requiredPlayback(input.playbackId);
    const before = this.#plainStatus(playback);
    const position =
      operation === "seek"
        ? boundedNumber(
            input.positionSeconds,
            0,
            86_400,
            0,
            "positionSeconds",
            true,
          )
        : undefined;
    const after = {
      ...before,
      ...(operation === "pause" ? { playing: false, paused: true } : {}),
      ...(operation === "resume" ? { playing: true, paused: false } : {}),
      ...(operation === "seek" ? { currentTime: position } : {}),
      ...(operation === "stop"
        ? { playing: false, paused: false, stopped: true }
        : {}),
    };
    const patch = await this.#patch(`audio.${operation}`, before, after);
    assertNotAborted(signal);
    if (operation === "pause") playback.player.pause();
    if (operation === "resume") playback.player.play();
    if (operation === "seek") await playback.player.seekTo(position!);
    if (operation === "stop") this.#disposeCurrent();
    return this.#mutationResult(`audio_${operation}`, patch, {
      ...(operation === "stop"
        ? { playbackId: playback.id, stopped: true, mediaNotification: false }
        : this.#status(playback.id)),
      recovery:
        operation === "pause"
          ? { action: "audio_resume", playbackId: playback.id }
          : operation === "resume"
            ? { action: "audio_pause", playbackId: playback.id }
            : operation === "seek"
              ? {
                  action: "audio_seek",
                  playbackId: playback.id,
                  positionSeconds: before.currentTime,
                }
              : { available: false },
    });
  }

  #status(playbackId?: string) {
    const playback = this.#requiredPlayback(playbackId);
    return Object.freeze({
      ...this.#plainStatus(playback),
      title: playback.source.title,
      ...(playback.source.artist ? { artist: playback.source.artist } : {}),
      ...(playback.source.album ? { album: playback.source.album } : {}),
      mediaNotification: true,
    });
  }

  #plainStatus(playback: Playback) {
    const { player } = playback;
    return Object.freeze({
      playbackId: playback.id,
      playing: player.playing,
      paused: player.paused,
      loaded: player.isLoaded,
      buffering: player.isBuffering,
      currentTime: finiteNumber(player.currentTime),
      duration: finiteNumber(player.duration),
      loop: player.loop,
      volume: finiteNumber(player.volume),
    });
  }

  #requiredPlayback(playbackId?: string) {
    const playback = this.#playback;
    if (!playback) throw new Error("当前没有活动的音频播放。");
    if (playbackId && playbackId !== playback.id) {
      throw new Error(
        "playbackId 已失效；请先调用 audio_status 获取当前播放。",
      );
    }
    return playback;
  }

  #disposeCurrent() {
    const current = this.#playback;
    if (!current) return;
    current.player.pause();
    current.player.clearLockScreenControls();
    current.player.setActiveForLockScreen(false);
    current.player.remove();
    this.#playback = null;
  }

  async #patch(operation: string, before: unknown, after: unknown) {
    const text = canonicalJson({ operation, before, after });
    return Object.freeze({
      text,
      sha256: await this.#dependencies.hash(text),
    });
  }

  #mutationResult(
    action: string,
    patch: Readonly<{ text: string; sha256: string }>,
    result: unknown,
  ) {
    return Object.freeze({
      result,
      patch,
      receipt: {
        id: `receipt-${this.#dependencies.createId()}`,
        action,
        patchSha256: patch.sha256,
        appliedAt: new Date().toISOString(),
      },
    });
  }
}

export function audioDataDescription(input: AgentDeviceCapabilityInput) {
  if (input.action === "audio_play") {
    const source = parseAudioSource(input);
    return `播放 ${source.scheme}: 音频“${source.title}”，并显示系统媒体通知与锁屏控制`;
  }
  return `控制当前系统媒体播放：${input.action}`;
}

function parseAudioSource(input: AgentDeviceCapabilityInput): AudioSource {
  const url = input.url?.trim() ?? "";
  if (
    !url ||
    url !== input.url ||
    url.length > 2_048 ||
    /[\u0000-\u001f\u007f]/u.test(url)
  ) {
    throw new Error("音频地址无效。");
  }
  const match = /^([a-z][a-z0-9+.-]*):/iu.exec(url);
  if (!match) throw new Error("音频地址必须包含 URI scheme。");
  const scheme = match[1]!.toLowerCase();
  if (["about", "blob", "data", "javascript", "boltpocket"].includes(scheme)) {
    throw new Error(`不能播放 ${scheme}: 音频地址。`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error("音频地址格式无效。", { cause: error });
  }
  if (parsed.username || parsed.password) {
    throw new Error("音频地址不能携带内嵌账号或密码。");
  }
  const title = boundedText(
    input.title ?? "BoltPocket 音频",
    160,
    "音频标题无效。",
    true,
  );
  return Object.freeze({
    url,
    scheme,
    title,
    ...(input.artist === undefined
      ? {}
      : { artist: boundedText(input.artist, 160, "音频艺术家信息过长。") }),
    ...(input.album === undefined
      ? {}
      : { album: boundedText(input.album, 160, "音频专辑信息过长。") }),
    ...(input.artworkUrl === undefined
      ? {}
      : {
          artworkUrl: validatedArtworkUrl(input.artworkUrl),
        }),
  });
}

function validatedArtworkUrl(value: string) {
  if (value.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("媒体封面地址无效。");
  }
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) throw new Error("credentials");
  } catch (error) {
    throw new Error("媒体封面地址无效。", { cause: error });
  }
  return value;
}

function boundedText(
  value: string,
  maximum: number,
  message: string,
  required = false,
) {
  if (
    value.length > maximum ||
    /[\u0000\u007f]/u.test(value) ||
    (required && !value.trim())
  ) {
    throw new Error(message);
  }
  return value;
}

function boundedNumber(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
  field: string,
  required = false,
) {
  if (required && value === undefined) throw new Error(`${field} 不能为空。`);
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${field} 必须在 ${minimum} 到 ${maximum} 之间。`);
  }
  return resolved;
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function assertSupportedPlatform(platform: string) {
  if (!["android", "ios"].includes(platform)) {
    throw new Error("当前平台不支持原生音频播放。");
  }
}

async function resolvedPlatform(dependencies: MediaAudioDependencies) {
  return dependencies.resolvePlatform
    ? dependencies.resolvePlatform()
    : dependencies.platform;
}

let runtimeIdSequence = 0;

function runtimeId() {
  runtimeIdSequence += 1;
  return `${Date.now().toString(36)}-${runtimeIdSequence.toString(36)}`;
}

function assertNotAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("音频操作已取消。");
  error.name = "AbortError";
  throw error;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
