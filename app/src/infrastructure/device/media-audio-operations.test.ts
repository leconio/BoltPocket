import assert from "node:assert/strict";
import test from "node:test";

import {
  MediaAudioOperations,
  type MediaAudioDependencies,
} from "./media-audio-operations.ts";

function fixture(notificationGranted = true) {
  let created = 0;
  let configured = 0;
  let lockScreenActive = false;
  let removed = false;
  let sequence = 0;
  const player = {
    playing: false,
    paused: false,
    isLoaded: true,
    isBuffering: false,
    currentTime: 0,
    duration: 180,
    loop: false,
    volume: 1,
    play() {
      this.playing = true;
      this.paused = false;
    },
    pause() {
      this.playing = false;
      this.paused = true;
    },
    async seekTo(seconds: number) {
      this.currentTime = seconds;
    },
    setActiveForLockScreen(active: boolean) {
      lockScreenActive = active;
    },
    clearLockScreenControls() {
      lockScreenActive = false;
    },
    remove() {
      removed = true;
    },
  };
  const dependencies: MediaAudioDependencies = {
    platform: "android",
    createId: () => `id-${++sequence}`,
    hash: async () => "b".repeat(64),
    requestNotificationPermission: async () => ({
      granted: notificationGranted,
    }),
    configure: async () => {
      configured += 1;
    },
    createPlayer: () => {
      created += 1;
      return player;
    },
  };
  return {
    dependencies,
    player,
    created: () => created,
    configured: () => configured,
    lockScreenActive: () => lockScreenActive,
    removed: () => removed,
  };
}

test("Android audio refuses silent playback when media notifications are denied", async () => {
  const { dependencies, created } = fixture(false);
  const operations = new MediaAudioOperations(dependencies);
  await assert.rejects(
    operations.execute({
      action: "audio_play",
      purpose: "Play the requested track",
      url: "https://example.com/song.mp3",
      title: "Song",
    }),
    /不会静默播放/u,
  );
  assert.equal(created(), 0);
});

test("audio playback accepts dynamic URI schemes and enables media controls", async () => {
  const state = fixture();
  const operations = new MediaAudioOperations(state.dependencies);
  const result = (await operations.execute({
    action: "audio_play",
    purpose: "Play the requested stream",
    url: "customaudio://station/live",
    title: "Live station",
    volume: 0.5,
  })) as unknown as {
    result: { playbackId: string; mediaChannel: boolean };
    patch: { sha256: string };
  };
  assert.equal(state.configured(), 1);
  assert.equal(state.created(), 1);
  assert.equal(state.player.playing, true);
  assert.equal(state.player.volume, 0.5);
  assert.equal(state.lockScreenActive(), true);
  assert.equal(result.result.mediaChannel, true);
  assert.equal(result.patch.sha256, "b".repeat(64));

  await operations.execute({
    action: "audio_pause",
    purpose: "Pause playback",
    playbackId: result.result.playbackId,
  });
  assert.equal(state.player.paused, true);
  await operations.execute({
    action: "audio_stop",
    purpose: "Stop playback",
    playbackId: result.result.playbackId,
  });
  assert.equal(state.lockScreenActive(), false);
  assert.equal(state.removed(), true);
});
