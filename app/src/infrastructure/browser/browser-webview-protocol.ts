import {
  BROWSER_BARCODE_FORMATS,
  BROWSER_ORIENTATION_LOCKS,
  BROWSER_PERMISSION_NAMES,
  MAX_BROWSER_BARCODE_IMAGE_DATA_URL_LENGTH,
  MAX_BROWSER_CLIPBOARD_TEXT_LENGTH,
  MAX_BROWSER_LOCATION_CACHE_AGE_MS,
  MAX_BROWSER_LOCATION_TIMEOUT_MS,
  MAX_BROWSER_PRINT_HTML_LENGTH,
  MAX_BROWSER_SHARE_FILE_BYTES,
  MAX_BROWSER_SHARE_TEXT_LENGTH,
  MAX_BROWSER_SHARE_URL_LENGTH,
  type BrowserBarcodeFormat,
  type BrowserLocationOptions,
  type BrowserShareData,
} from "./browser-native-web-api-model.ts";
import {
  MAX_BROWSER_INPUT_TEXT_LENGTH,
  MAX_BROWSER_PAGE_TEXT_LENGTH,
  MAX_BROWSER_SEARCHABLE_TEXT_LENGTH,
  MAX_BROWSER_TEXT_MATCHES,
  MAX_BROWSER_TEXT_QUERY_LENGTH,
  MAX_BROWSER_TEXT_SNIPPET_LENGTH,
} from "./browser-page-snapshot.ts";
import {
  PROJECT_H5_PERMISSION_KEYS,
  type ProjectH5Permission,
} from "@/domain/project-h5-manifest";

const CHANNEL = "boltpocket-browser-v1";
const MAX_MESSAGE_LENGTH = 2_900_000;
const REQUEST_ID_PATTERN = /^browser-request-[a-z0-9-]{1,80}$/u;
const NATIVE_REQUEST_ID_PATTERN = /^native-request-[a-z0-9-]{1,80}$/u;
const NATIVE_BRIDGE_TOKEN_PATTERN = /^[a-f0-9]{32}$/u;

export type BrowserNativeWebApiRequest =
  | {
      type: "native-api-request";
      requestId: string;
      operation: "capability-authorize";
      capability: ProjectH5Permission;
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "location-current";
      options: BrowserLocationOptions;
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "location-watch-start";
      watchId: number;
      options: BrowserLocationOptions;
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "location-watch-stop";
      watchId: number;
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "clipboard-read-text";
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "clipboard-write-text";
      text: string;
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "permission-query";
      permission: (typeof BROWSER_PERMISSION_NAMES)[number];
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "share";
      data: BrowserShareData;
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "orientation-lock";
      lock: (typeof BROWSER_ORIENTATION_LOCKS)[number];
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "orientation-unlock";
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "print-html";
      html: string;
    }
  | {
      type: "native-api-request";
      requestId: string;
      operation: "barcode-detect";
      dataUrl: string;
      formats: readonly BrowserBarcodeFormat[];
    };

export type BrowserWebViewMessage =
  | BrowserNativeWebApiRequest
  | {
      type: "response";
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      type: "response";
      requestId: string;
      ok: false;
      error: string;
    }
  | { type: "download-request"; url: string };

function encoded(value: string) {
  return JSON.stringify(value);
}

function encodedValue(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function assertNativeRequestId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !NATIVE_REQUEST_ID_PATTERN.test(value)) {
    throw new Error("网页原生请求编号无效。");
  }
}

function parseLocationOptions(value: unknown): BrowserLocationOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("网页定位参数无效。");
  }
  const options = value as Record<string, unknown>;
  if (
    Object.keys(options).length !== 3 ||
    typeof options.enableHighAccuracy !== "boolean" ||
    !Number.isInteger(options.timeout) ||
    (options.timeout as number) < 0 ||
    (options.timeout as number) > MAX_BROWSER_LOCATION_TIMEOUT_MS ||
    !Number.isInteger(options.maximumAge) ||
    (options.maximumAge as number) < -1 ||
    (options.maximumAge as number) > MAX_BROWSER_LOCATION_CACHE_AGE_MS
  ) {
    throw new Error("网页定位参数无效。");
  }
  return Object.freeze({
    enableHighAccuracy: options.enableHighAccuracy,
    timeout: options.timeout as number,
    maximumAge: options.maximumAge as number,
  });
}

function parseWatchId(value: unknown) {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 2_147_483_647
  ) {
    throw new Error("网页定位监听编号无效。");
  }
  return value as number;
}

function isOneOf<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.some((item) => item === value);
}

function parseShareData(value: unknown): BrowserShareData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("网页分享内容无效。");
  }
  const candidate = value as Record<string, unknown>;
  const allowedKeys = ["title", "text", "url", "file"];
  if (Object.keys(candidate).some((key) => !allowedKeys.includes(key))) {
    throw new Error("网页分享内容无效。");
  }
  const title = candidate.title;
  const text = candidate.text;
  const url = candidate.url;
  if (
    title !== undefined &&
    (typeof title !== "string" || title.length > 240)
  ) {
    throw new Error("网页分享标题无效。");
  }
  if (
    text !== undefined &&
    (typeof text !== "string" || text.length > MAX_BROWSER_SHARE_TEXT_LENGTH)
  ) {
    throw new Error("网页分享文字无效。");
  }
  if (
    url !== undefined &&
    (typeof url !== "string" || url.length > MAX_BROWSER_SHARE_URL_LENGTH)
  ) {
    throw new Error("网页分享地址无效。");
  }
  let file: BrowserShareData["file"];
  if (candidate.file !== undefined) {
    if (
      !candidate.file ||
      typeof candidate.file !== "object" ||
      Array.isArray(candidate.file)
    ) {
      throw new Error("网页分享文件无效。");
    }
    const raw = candidate.file as Record<string, unknown>;
    if (
      Object.keys(raw).length !== 3 ||
      typeof raw.name !== "string" ||
      raw.name.length < 1 ||
      raw.name.length > 128 ||
      /[\\/\u0000-\u001f]/u.test(raw.name) ||
      typeof raw.type !== "string" ||
      raw.type.length > 120 ||
      (raw.type.length > 0 &&
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(raw.type)) ||
      typeof raw.dataBase64 !== "string" ||
      raw.dataBase64.length >
        Math.ceil((MAX_BROWSER_SHARE_FILE_BYTES * 4) / 3) + 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(raw.dataBase64)
    ) {
      throw new Error("网页分享文件无效。");
    }
    file = {
      name: raw.name,
      type: raw.type,
      dataBase64: raw.dataBase64,
    };
  }
  if (!text && !url && !file) throw new Error("网页分享内容为空。");
  return Object.freeze({
    ...(title ? { title } : {}),
    ...(text ? { text } : {}),
    ...(url ? { url } : {}),
    ...(file ? { file: Object.freeze(file) } : {}),
  });
}

function parseBarcodeFormats(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > BROWSER_BARCODE_FORMATS.length ||
    value.some((format) => !isOneOf(BROWSER_BARCODE_FORMATS, format)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("网页条码格式无效。");
  }
  return Object.freeze([...value]) as readonly BrowserBarcodeFormat[];
}

export function createBrowserNativeResponseScript(
  requestId: string,
  response:
    | { ok: true; result: unknown }
    | { ok: false; error: { name: string; message: string } },
) {
  assertNativeRequestId(requestId);
  return `
    (() => {
      const receive = window.__boltpocketResolveNativeRequest;
      if (typeof receive === "function") {
        receive(${encoded(requestId)}, ${encodedValue(response)});
      }
    })();
    true;
  `;
}

export function createBrowserLocationWatchEventScript(
  watchId: number,
  event:
    | { ok: true; position: unknown }
    | { ok: false; error: { name: string; message: string } },
) {
  parseWatchId(watchId);
  return `
    (() => {
      const receive = window.__boltpocketDeliverLocationWatch;
      if (typeof receive === "function") {
        receive(${watchId.toString(10)}, ${encodedValue(event)});
      }
    })();
    true;
  `;
}

function operationEnvelope(requestId: string, body: string) {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error("浏览器请求编号无效。");
  }
  return `
    (() => {
      const requestId = ${encoded(requestId)};
      const send = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify({
        channel: ${encoded(CHANNEL)},
        type: "response",
        requestId,
        ...payload,
      }));
      try {
        const result = (() => { ${body} })();
        send({ ok: true, result });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message.slice(0, 240) : "网页操作失败" });
      }
    })();
    true;
  `;
}

const revisionFunction = `
  const revisionForPage = (controls, pageText) => {
    const source = [
      location.href,
      document.title,
      document.readyState,
      String(pageText || "").slice(0, ${MAX_BROWSER_SEARCHABLE_TEXT_LENGTH.toString(10)}),
      JSON.stringify(controls),
    ].join("\\n");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return "page-" + (hash >>> 0).toString(16);
  };
`;

const pageInspectionFunctions = `
  const clean = (value, limit) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const controlsForPage = () => {
    // Hidden controls may keep an ID from an older snapshot. Clear the owned
    // markers before assigning the current visible controls' IDs.
    for (const element of document.querySelectorAll("[data-boltpocket-agent-control]")) {
      element.removeAttribute("data-boltpocket-agent-control");
    }
    return Array.from(document.querySelectorAll("a[href], button, input, textarea, select, summary, [role='button'], [role='link'], [role='tab'], [role='checkbox'], [role='radio'], [role='switch'], [role='menuitem']"))
    .filter(isVisible)
    .slice(0, 80)
    .map((element, index) => {
      const id = "control-" + (index + 1);
      element.setAttribute("data-boltpocket-agent-control", id);
      const tag = element.tagName.toLowerCase();
      const role = clean(element.getAttribute("role"), 32);
      const declaredType = clean(element.getAttribute("type"), 32).toLowerCase();
      const type = declaredType || (tag === "input" ? "text" : tag === "button" ? "submit" : "");
      const autocomplete = clean(element.getAttribute("autocomplete"), 80).toLowerCase();
      const associatedLabel = clean(
        Array.from(element.labels || []).map((candidate) => candidate.innerText || candidate.textContent || "").join(" "),
        240,
      );
      const label = clean(
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        associatedLabel ||
        element.getAttribute("placeholder") ||
        element.innerText ||
        element.getAttribute("name") ||
        tag,
        240,
      );
      const kind = tag === "a" || role === "link"
        ? "link"
        : tag === "button" || tag === "summary" || ["button", "tab", "checkbox", "radio", "switch", "menuitem"].includes(role)
          ? "button"
          : tag === "input" || tag === "textarea"
            ? "input"
            : tag === "select"
              ? "select"
              : "control";
      const sensitiveSource = [
        type,
        autocomplete,
        clean(element.getAttribute("name"), 120),
        clean(element.getAttribute("id"), 120),
        label,
      ].join(" ").toLowerCase();
      const sensitive = /password|passwd|passcode|one-time-code|otp|cc-|credit.?card|card.?number|cvc|cvv|security.?code|api.?key|access.?token|secret|private.?key|social.?security|密码|验证码|卡号|密钥|令牌|私钥|身份证|社会保障/.test(sensitiveSource);
      const mutatingIntent = /\\b(?:submit|send|save|create|add|delete|remove|destroy|purchase|buy|pay|checkout|order|book|reserve|publish|post|reply|comment|upload|install|sign[ -]?(?:in|out|up)|log[ -]?(?:in|out)|register|subscribe|unsubscribe|follow|unfollow|like|unlike|share|invite|join|leave|accept|approve|reject|archive|restore|confirm)\\b|提交|发送|保存|创建|新增|添加|删除|移除|销毁|购买|支付|结账|下单|预订|预约|发布|回复|评论|上传|安装|登录|退出|注册|订阅|取消订阅|关注|取消关注|点赞|取消点赞|分享|邀请|加入|离开|申请|接受|同意|批准|拒绝|归档|恢复|确认/i.test(label);
      const disabled = Boolean(element.disabled || element.getAttribute("aria-disabled") === "true");
      const readOnly = Boolean(element.readOnly || element.getAttribute("aria-readonly") === "true");
      const form = typeof element.closest === "function" ? element.closest("form") : null;
      let href;
      if (kind === "link") {
        try { href = new URL(element.getAttribute("href"), location.href).href; } catch {}
      }
      const actions = [];
      if (
        !disabled &&
        !sensitive &&
        !readOnly &&
        kind === "input" &&
        (tag === "textarea" || ["text", "search", "email", "url", "tel"].includes(type))
      ) {
        actions.push("type");
      }
      const nativeToggle = tag === "input" && ["checkbox", "radio"].includes(type);
      const buttonLike = kind === "button" || nativeToggle;
      const submitsForm = Boolean(
        form && (
          (tag === "button" && type !== "button" && type !== "reset") ||
          (tag === "input" && ["submit", "image"].includes(type))
        )
      );
      if (
        !disabled &&
        !sensitive &&
        !mutatingIntent &&
        ((kind === "link" && /^https?:/i.test(href || "")) || (buttonLike && !submitsForm))
      ) {
        actions.push("click");
      }
      return {
        id,
        kind,
        label: label || tag,
        actions,
        ...(href ? { href } : {}),
        ...(sensitive ? { sensitive: true } : {}),
        ...(disabled ? { disabled: true } : {}),
      };
    });
  };
  ${revisionFunction}
`;

function assertBrowserTextOffset(offset: number) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > MAX_BROWSER_SEARCHABLE_TEXT_LENGTH
  ) {
    throw new Error("网页文字偏移无效。");
  }
}

function normalizedBrowserTextQuery(query: string) {
  const normalized = query.trim();
  if (
    !normalized ||
    normalized.length > MAX_BROWSER_TEXT_QUERY_LENGTH ||
    normalized.includes("\0")
  ) {
    throw new Error("网页查找文字无效。");
  }
  return normalized;
}

function assertBrowserTargetId(targetId: string) {
  if (!/^control-[1-9]\d{0,2}$/u.test(targetId)) {
    throw new Error("浏览器控件编号无效。");
  }
}

function assertBrowserRevision(revision: string) {
  if (!revision.trim() || revision.length > 240 || revision.includes("\0")) {
    throw new Error("网页版本无效。");
  }
}

function assertBrowserInputText(text: string) {
  if (text.length > MAX_BROWSER_INPUT_TEXT_LENGTH || text.includes("\0")) {
    throw new Error("网页输入文字无效或过长。");
  }
}

export function createBrowserSnapshotScript(requestId: string) {
  return operationEnvelope(
    requestId,
    `
      ${pageInspectionFunctions}
      const controls = controlsForPage();
      const pageText = document.body?.innerText || "";
      return {
        revision: revisionForPage(controls, pageText),
        url: location.href,
        title: clean(document.title, 240),
        text: pageText.slice(0, ${MAX_BROWSER_PAGE_TEXT_LENGTH.toString(10)}),
        controls,
      };
    `,
  );
}

export function createBrowserReadTextScript(requestId: string, offset: number) {
  assertBrowserTextOffset(offset);
  return operationEnvelope(
    requestId,
    `
      ${pageInspectionFunctions}
      const controls = controlsForPage();
      const pageText = document.body?.innerText || "";
      const boundedText = pageText.slice(0, ${MAX_BROWSER_SEARCHABLE_TEXT_LENGTH.toString(10)});
      const offset = ${offset.toString(10)};
      if (offset > boundedText.length) throw new Error("文字偏移超出当前页面范围");
      const text = boundedText.slice(offset, offset + ${MAX_BROWSER_PAGE_TEXT_LENGTH.toString(10)});
      const nextOffset = offset + text.length < boundedText.length ? offset + text.length : null;
      return {
        revision: revisionForPage(controls, pageText),
        url: location.href,
        title: clean(document.title, 240),
        offset,
        text,
        searchedLength: boundedText.length,
        nextOffset,
        truncated: pageText.length > boundedText.length,
      };
    `,
  );
}

export function createBrowserFindTextScript(requestId: string, query: string) {
  const normalizedQuery = normalizedBrowserTextQuery(query);
  return operationEnvelope(
    requestId,
    `
      ${pageInspectionFunctions}
      const controls = controlsForPage();
      const pageText = document.body?.innerText || "";
      const boundedText = pageText.slice(0, ${MAX_BROWSER_SEARCHABLE_TEXT_LENGTH.toString(10)});
      const query = ${encoded(normalizedQuery)};
      const escapedQuery = Array.from(query, (character) =>
        "\\\\^$.*+?()[]{}|".includes(character) ? "\\\\" + character : character
      ).join("");
      const pattern = new RegExp(escapedQuery, "giu");
      const matches = [];
      let totalMatches = 0;
      let match;
      while ((match = pattern.exec(boundedText)) !== null) {
        const offset = match.index;
        const matchedLength = match[0].length;
        totalMatches += 1;
        if (matches.length < ${MAX_BROWSER_TEXT_MATCHES.toString(10)}) {
          const snippetStart = Math.max(0, offset - 120);
          const snippetEnd = Math.min(
            boundedText.length,
            offset + matchedLength + 180,
          );
          matches.push({
            offset,
            snippet: clean(
              boundedText.slice(snippetStart, snippetEnd),
              ${MAX_BROWSER_TEXT_SNIPPET_LENGTH.toString(10)},
            ),
          });
        }
      }
      return {
        revision: revisionForPage(controls, pageText),
        url: location.href,
        title: clean(document.title, 240),
        matches,
        totalMatches,
        searchedLength: boundedText.length,
        truncated: pageText.length > boundedText.length,
      };
    `,
  );
}

export function createBrowserScrollScript(
  requestId: string,
  direction: "up" | "down",
) {
  const factor = direction === "up" ? -0.78 : 0.78;
  return operationEnvelope(
    requestId,
    `
      window.scrollBy({ top: Math.max(320, window.innerHeight) * ${factor}, behavior: "smooth" });
      return { y: Math.round(window.scrollY) };
    `,
  );
}

export function createBrowserClickScript(
  requestId: string,
  targetId: string,
  revision: string,
) {
  assertBrowserTargetId(targetId);
  assertBrowserRevision(revision);
  return operationEnvelope(
    requestId,
    `
      ${pageInspectionFunctions}
      const controls = controlsForPage();
      const pageText = document.body?.innerText || "";
      const revision = revisionForPage(controls, pageText);
      if (revision !== ${encoded(revision)}) throw new Error("网页内容已变化");
      const targetId = ${encoded(targetId)};
      const control = controls.find((candidate) => candidate.id === targetId);
      if (!control || !control.actions.includes("click")) throw new Error("控件不允许点击");
      const element = document.querySelector("[data-boltpocket-agent-control='" + targetId + "']");
      if (!element || typeof element.click !== "function") throw new Error("控件已经变化");
      const activateGuard = window.__boltpocketActivateAgentReadOnlyInteraction;
      if (typeof activateGuard !== "function" || activateGuard() !== true) {
        throw new Error("Agent 只读交互护栏不可用");
      }
      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      if (typeof element.focus === "function") element.focus({ preventScroll: true });
      element.click();
      return {
        action: "click",
        revision,
        url: location.href,
        targetId,
      };
    `,
  );
}

export function createBrowserTypeScript(
  requestId: string,
  targetId: string,
  revision: string,
  text: string,
) {
  assertBrowserTargetId(targetId);
  assertBrowserRevision(revision);
  assertBrowserInputText(text);
  return operationEnvelope(
    requestId,
    `
      ${pageInspectionFunctions}
      const controls = controlsForPage();
      const pageText = document.body?.innerText || "";
      const revision = revisionForPage(controls, pageText);
      if (revision !== ${encoded(revision)}) throw new Error("网页内容已变化");
      const targetId = ${encoded(targetId)};
      const control = controls.find((candidate) => candidate.id === targetId);
      if (!control || !control.actions.includes("type") || control.sensitive) {
        throw new Error("控件不允许输入");
      }
      const element = document.querySelector("[data-boltpocket-agent-control='" + targetId + "']");
      const tag = element?.tagName?.toLowerCase();
      if (!element || (tag !== "input" && tag !== "textarea")) throw new Error("控件已经变化");
      const activateGuard = window.__boltpocketActivateAgentReadOnlyInteraction;
      if (typeof activateGuard !== "function" || activateGuard() !== true) {
        throw new Error("Agent 只读交互护栏不可用");
      }
      const inputText = ${encoded(text)};
      const declaredMaxLength = Number(element.maxLength);
      const limit = Number.isInteger(declaredMaxLength) && declaredMaxLength >= 0
        ? Math.min(declaredMaxLength, ${MAX_BROWSER_INPUT_TEXT_LENGTH.toString(10)})
        : ${MAX_BROWSER_INPUT_TEXT_LENGTH.toString(10)};
      const nextValue = inputText.slice(0, limit);
      const prototype = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (typeof valueSetter !== "function") throw new Error("输入控件不可写");
      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      if (typeof element.focus === "function") element.focus({ preventScroll: true });
      Reflect.apply(valueSetter, element, [nextValue]);
      const inputEvent = typeof InputEvent === "function"
        ? new InputEvent("input", {
            bubbles: true,
            cancelable: false,
            composed: true,
            data: null,
            inputType: "insertReplacementText",
          })
        : new Event("input", { bubbles: true, composed: true });
      element.dispatchEvent(inputEvent);
      return {
        action: "type",
        revision,
        url: location.href,
        targetId,
        inputLength: nextValue.length,
      };
    `,
  );
}

export function createBrowserHighlightScript(
  requestId: string,
  targetId: string,
) {
  assertBrowserTargetId(targetId);
  return operationEnvelope(
    requestId,
    `
      const element = document.querySelector("[data-boltpocket-agent-control='" + ${encoded(targetId)} + "']");
      if (!element) throw new Error("控件已经变化");
      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      const previousOutline = element.style.outline;
      const previousOffset = element.style.outlineOffset;
      element.style.outline = "3px solid #176b55";
      element.style.outlineOffset = "3px";
      window.setTimeout(() => {
        element.style.outline = previousOutline;
        element.style.outlineOffset = previousOffset;
      }, 2800);
      return { targetId: ${encoded(targetId)} };
    `,
  );
}

export const AGENT_READ_ONLY_INTERACTION_GUARD_SCRIPT = `
  (() => {
    if (window.__boltpocketAgentReadOnlyGuardInstalled) return;
    let active = false;
    let releaseTimer;
    let restorers = [];
    const scheduleRelease = window.setTimeout.bind(window);
    const cancelRelease = window.clearTimeout.bind(window);
    const blockedError = () => {
      const error = new Error("Agent 页面交互已阻止高风险外部写入");
      error.name = "SecurityError";
      return error;
    };
    const safeMethod = (value) => ["GET", "HEAD", "OPTIONS"].includes(String(value || "GET").toUpperCase());
    const formMethod = (form, submitter) =>
      submitter?.getAttribute?.("formmethod") ||
      form?.getAttribute?.("method") ||
      form?.method ||
      "GET";
    const replaceDuringInteraction = (target, name, value) => {
      if (!target) return;
      const hadOwn = Object.prototype.hasOwnProperty.call(target, name);
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      const original = target[name];
      try {
        Object.defineProperty(
          target,
          name,
          descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
            ? { ...descriptor, value }
            : {
                configurable: true,
                enumerable: descriptor?.enumerable ?? false,
                value,
                writable: true,
              },
        );
      } catch {
        try { target[name] = value; } catch {}
      }
      if (target[name] !== value) return;
      restorers.push(() => {
        try {
          if (hadOwn && descriptor) Object.defineProperty(target, name, descriptor);
          else delete target[name];
        } catch {
          try { target[name] = original; } catch {}
        }
      });
    };
    const release = () => {
      active = false;
      const current = restorers;
      restorers = [];
      for (const restore of current.reverse()) restore();
      releaseTimer = undefined;
    };
    const installFocusedGuard = () => {
      if (typeof window.fetch === "function") {
        const originalFetch = window.fetch;
        replaceDuringInteraction(window, "fetch", function(input, init) {
          const requestMethod = typeof Request === "function" && input instanceof Request
            ? input.method
            : undefined;
          const method = init && init.method ? init.method : requestMethod;
          if (!safeMethod(method)) throw blockedError();
          return Reflect.apply(originalFetch, this, [input, init]);
        });
      }

      const Xhr = window.XMLHttpRequest;
      if (typeof Xhr === "function") {
        const methods = new WeakMap();
        const originalOpen = Xhr.prototype.open;
        const originalSend = Xhr.prototype.send;
        replaceDuringInteraction(Xhr.prototype, "open", function(method, ...args) {
          methods.set(this, method);
          return Reflect.apply(originalOpen, this, [method, ...args]);
        });
        replaceDuringInteraction(Xhr.prototype, "send", function(...args) {
          if (!safeMethod(methods.get(this))) throw blockedError();
          return Reflect.apply(originalSend, this, args);
        });
      }

      const Form = window.HTMLFormElement;
      if (typeof Form === "function") {
        const originalSubmit = Form.prototype.submit;
        replaceDuringInteraction(Form.prototype, "submit", function(...args) {
          if (!safeMethod(formMethod(this))) throw blockedError();
          return Reflect.apply(originalSubmit, this, args);
        });
        if (typeof Form.prototype.requestSubmit === "function") {
          const originalRequestSubmit = Form.prototype.requestSubmit;
          replaceDuringInteraction(Form.prototype, "requestSubmit", function(...args) {
            if (!safeMethod(formMethod(this, args[0]))) throw blockedError();
            return Reflect.apply(originalRequestSubmit, this, args);
          });
        }
      }

      if (typeof navigator.sendBeacon === "function") {
        const originalSendBeacon = navigator.sendBeacon;
        replaceDuringInteraction(navigator, "sendBeacon", function(...args) {
          throw blockedError();
        });
      }

      const Socket = window.WebSocket;
      if (typeof Socket === "function" && typeof Socket.prototype?.send === "function") {
        const originalSend = Socket.prototype.send;
        replaceDuringInteraction(Socket.prototype, "send", function(...args) {
          throw blockedError();
        });
      }
      const DataChannel = window.RTCDataChannel;
      if (typeof DataChannel === "function" && typeof DataChannel.prototype?.send === "function") {
        const originalSend = DataChannel.prototype.send;
        replaceDuringInteraction(DataChannel.prototype, "send", function(...args) {
          throw blockedError();
        });
      }
      for (const constructorName of ["WebSocket", "WebTransport"]) {
        const Constructor = window[constructorName];
        if (typeof Constructor !== "function") continue;
        replaceDuringInteraction(window, constructorName, new Proxy(Constructor, {
          apply() { throw blockedError(); },
          construct() { throw blockedError(); },
        }));
      }
    };

    if (typeof window.HTMLFormElement === "function") {
      document.addEventListener("submit", (event) => {
        if (!active || safeMethod(formMethod(event.target, event.submitter))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }

    Object.defineProperty(window, "__boltpocketActivateAgentReadOnlyInteraction", {
      configurable: false,
      enumerable: false,
      value: () => {
        if (releaseTimer !== undefined) cancelRelease(releaseTimer);
        release();
        active = true;
        installFocusedGuard();
        releaseTimer = scheduleRelease(release, 0);
        return true;
      },
      writable: false,
    });
    Object.defineProperty(window, "__boltpocketAgentReadOnlyGuardInstalled", {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
  })();
  true;
`;

export const BROWSER_PAGE_BRIDGE_SCRIPT = `
  (() => {
    if (window.__boltpocketBrowserBridgeInstalled) return;
    window.__boltpocketBrowserBridgeInstalled = true;
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("a[download]") : null;
      if (!target) return;
      let url;
      try { url = new URL(target.getAttribute("href"), location.href).href; } catch { return; }
      if (!/^https?:/i.test(url)) return;
      event.preventDefault();
      window.ReactNativeWebView.postMessage(JSON.stringify({
        channel: ${encoded(CHANNEL)},
        type: "download-request",
        url,
      }));
    }, true);
  })();
  true;
`;

export function parseBrowserWebViewMessage(
  value: string,
  nativeBridgeToken?: string,
): BrowserWebViewMessage {
  if (!value || value.length > MAX_MESSAGE_LENGTH) {
    throw new Error("网页消息无效或过长。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("网页消息不是有效 JSON。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("网页消息无效。");
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.channel !== CHANNEL) throw new Error("网页消息来源无效。");
  if (candidate.type === "native-api-request") {
    if (
      !nativeBridgeToken ||
      !NATIVE_BRIDGE_TOKEN_PATTERN.test(nativeBridgeToken) ||
      candidate.bridgeToken !== nativeBridgeToken
    ) {
      throw new Error("网页原生请求来源无效。");
    }
    assertNativeRequestId(candidate.requestId);
    if (
      candidate.operation === "capability-authorize" &&
      isOneOf(PROJECT_H5_PERMISSION_KEYS, candidate.capability)
    ) {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
        capability: candidate.capability,
      };
    }
    if (candidate.operation === "location-current") {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
        options: parseLocationOptions(candidate.options),
      };
    }
    if (candidate.operation === "location-watch-start") {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
        watchId: parseWatchId(candidate.watchId),
        options: parseLocationOptions(candidate.options),
      };
    }
    if (candidate.operation === "location-watch-stop") {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
        watchId: parseWatchId(candidate.watchId),
      };
    }
    if (candidate.operation === "clipboard-read-text") {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
      };
    }
    if (candidate.operation === "clipboard-write-text") {
      if (
        typeof candidate.text !== "string" ||
        candidate.text.length > MAX_BROWSER_CLIPBOARD_TEXT_LENGTH
      ) {
        throw new Error("网页剪贴板内容无效。");
      }
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
        text: candidate.text,
      };
    }
    if (
      candidate.operation === "permission-query" &&
      isOneOf(BROWSER_PERMISSION_NAMES, candidate.permission)
    ) {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
        permission: candidate.permission,
      };
    }
    if (candidate.operation === "share") {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
        data: parseShareData(candidate.data),
      };
    }
    if (
      candidate.operation === "orientation-lock" &&
      isOneOf(BROWSER_ORIENTATION_LOCKS, candidate.lock)
    ) {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
        lock: candidate.lock,
      };
    }
    if (candidate.operation === "orientation-unlock") {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
      };
    }
    if (
      candidate.operation === "print-html" &&
      typeof candidate.html === "string" &&
      candidate.html.length > 0 &&
      candidate.html.length <= MAX_BROWSER_PRINT_HTML_LENGTH
    ) {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
        html: candidate.html,
      };
    }
    if (
      candidate.operation === "barcode-detect" &&
      typeof candidate.dataUrl === "string" &&
      candidate.dataUrl.length <= MAX_BROWSER_BARCODE_IMAGE_DATA_URL_LENGTH &&
      /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/u.test(
        candidate.dataUrl,
      )
    ) {
      return {
        type: "native-api-request",
        requestId: candidate.requestId,
        operation: candidate.operation,
        dataUrl: candidate.dataUrl,
        formats: parseBarcodeFormats(candidate.formats),
      };
    }
    throw new Error("网页原生请求无效。");
  }
  if (candidate.type === "download-request") {
    if (typeof candidate.url !== "string" || candidate.url.length > 2_048) {
      throw new Error("网页下载地址无效。");
    }
    return { type: "download-request", url: candidate.url };
  }
  if (
    candidate.type !== "response" ||
    typeof candidate.requestId !== "string" ||
    !REQUEST_ID_PATTERN.test(candidate.requestId) ||
    typeof candidate.ok !== "boolean"
  ) {
    throw new Error("网页响应无效。");
  }
  if (candidate.ok) {
    return {
      type: "response",
      requestId: candidate.requestId,
      ok: true,
      result: candidate.result,
    };
  }
  return {
    type: "response",
    requestId: candidate.requestId,
    ok: false,
    error:
      typeof candidate.error === "string" && candidate.error.length <= 240
        ? candidate.error
        : "网页操作失败",
  };
}
