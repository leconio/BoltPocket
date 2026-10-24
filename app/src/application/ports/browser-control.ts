import type { ProjectPreviewSnapshot } from "./project-preview";

export type BrowserSurfaceMode = "closed" | "expanded" | "minimized";

export type BrowserControlKind =
  "link" | "button" | "input" | "select" | "control";

export type BrowserPageControlAction = "click" | "type";

export type BrowserPageControl = {
  id: string;
  kind: BrowserControlKind;
  label: string;
  actions: BrowserPageControlAction[];
  href?: string;
  sensitive?: boolean;
  disabled?: boolean;
};

export type BrowserPageSnapshot = {
  revision: string;
  url: string;
  title: string;
  text: string;
  controls: BrowserPageControl[];
};

export type BrowserPageTextChunk = {
  revision: string;
  url: string;
  title: string;
  offset: number;
  text: string;
  totalLength: number;
  nextOffset: number | null;
  truncated: boolean;
};

export type BrowserPageTextMatch = {
  offset: number;
  snippet: string;
};

export type BrowserPageFindResult = {
  revision: string;
  url: string;
  title: string;
  matches: BrowserPageTextMatch[];
  totalMatches: number;
  searchedLength: number;
  truncated: boolean;
};

export type BrowserPageInteractionReceipt = {
  action: BrowserPageControlAction;
  revision: string;
  url: string;
  targetId: string;
  inputLength?: number;
};

export type BrowserDriverStatus = {
  mode: BrowserSurfaceMode;
  url: string | null;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
};

type AgentBrowserScope = {
  projectId: string;
  runId: string;
};

type AgentBrowserTaskTarget = AgentBrowserScope & {
  taskId?: string;
};

export type AgentBrowserControlInput =
  | ({ action: "open"; url: string } & AgentBrowserScope)
  | ({
      action: "preview";
      snapshot: ProjectPreviewSnapshot;
      present: boolean;
    } & AgentBrowserScope)
  | ({ action: "close" } & AgentBrowserTaskTarget)
  | ({ action: "status" } & AgentBrowserTaskTarget)
  | ({ action: "snapshot" } & AgentBrowserTaskTarget)
  | ({
      action: "read_text";
      revision: string;
      offset: number;
    } & AgentBrowserTaskTarget)
  | ({
      action: "find_text";
      revision: string;
      query: string;
    } & AgentBrowserTaskTarget)
  | ({
      action: "wait_for_text";
      query: string;
      condition: "present" | "absent";
      timeoutMs: number;
    } & AgentBrowserTaskTarget)
  | ({ action: "navigate"; url: string } & AgentBrowserTaskTarget)
  | ({
      action: "click";
      revision: string;
      targetId: string;
    } & AgentBrowserTaskTarget)
  | ({
      action: "type";
      revision: string;
      targetId: string;
      text: string;
    } & AgentBrowserTaskTarget)
  | ({
      action: "follow_link";
      revision: string;
      targetId: string;
    } & AgentBrowserTaskTarget)
  | ({
      action: "highlight";
      revision: string;
      targetId: string;
    } & AgentBrowserTaskTarget)
  | ({
      action: "scroll";
      direction: "up" | "down";
    } & AgentBrowserTaskTarget)
  | ({
      action: "back" | "forward" | "reload";
    } & AgentBrowserTaskTarget);

export type AgentBrowserControlResult =
  | ({
      action: "status";
      authorized: boolean;
      managed: boolean;
      taskId: string | null;
    } & BrowserDriverStatus)
  | ({
      action: "open";
      completed: true;
      managed: true;
      taskId: string;
    } & BrowserDriverStatus)
  | ({
      action: "preview";
      completed: true;
      managed: true;
      handedOff: true;
      taskId: string;
      entryPath: string;
      fileCount: number;
    } & BrowserDriverStatus)
  | {
      action: "close";
      completed: true;
      taskId: string;
      url: null;
    }
  | {
      action: "snapshot";
      taskId: string;
      snapshot: BrowserPageSnapshot;
      untrusted: true;
    }
  | {
      action: "read_text";
      taskId: string;
      chunk: BrowserPageTextChunk;
      untrusted: true;
    }
  | {
      action: "find_text";
      taskId: string;
      result: BrowserPageFindResult;
      untrusted: true;
    }
  | {
      action: "wait_for_text";
      taskId: string;
      condition: "present" | "absent";
      matched: boolean;
      timedOut: boolean;
      waitedMs: number;
      result: BrowserPageFindResult;
      untrusted: true;
    }
  | {
      action:
        | "navigate"
        | "click"
        | "type"
        | "follow_link"
        | "highlight"
        | "scroll"
        | "back"
        | "forward"
        | "reload";
      completed: true;
      taskId: string;
      url: string | null;
      targetId?: string;
      inputLength?: number;
    };

export interface AgentBrowserControlPort {
  execute(
    input: AgentBrowserControlInput,
    signal?: AbortSignal,
  ): Promise<AgentBrowserControlResult>;
  closeRun?(projectId: string, runId: string): Promise<void> | void;
}
