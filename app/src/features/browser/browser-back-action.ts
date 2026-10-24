export type BrowserBackAction =
  "exit-fullscreen" | "navigate-back" | "minimize";

export function resolveBrowserBackAction({
  canGoBack,
  fullscreen,
}: Readonly<{
  canGoBack: boolean;
  fullscreen: boolean;
}>): BrowserBackAction {
  if (fullscreen) return "exit-fullscreen";
  if (canGoBack) return "navigate-back";
  return "minimize";
}
