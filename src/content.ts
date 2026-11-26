import { defaults, matchesPattern, normalizedText, pageUrl, validateRule, type Rule, type Settings } from "./core";

// This lives in the isolated content-script world, including across executeScript reinjections.
const world = globalThis as typeof globalThis & { __tabDoneContent?: { reannounce(): void } };
if (window === window.top) {
  if (world.__tabDoneContent) world.__tabDoneContent.reannounce();
  else start();
}

function start(): void {
  let settings: Pick<Settings, "enabled" | "rules"> = { enabled: false, rules: [] };
  let settingsLoaded = false;
  let settingsRevision = 0;
  let dirty = false;
  let picking = false;
  // A pick must not complete an old rule before the new settings have been saved.
  let awaitingSettings = false;
  let lastReport = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pickerHost: HTMLDivElement | undefined;
  let highlight: HTMLDivElement | undefined;
  let hovered: Element | null = null;

  function send(message: object): void {
    try {
      chrome.runtime.sendMessage(message, () => { void chrome.runtime.lastError; });
    } catch { /* An unloaded extension must not interfere with the page. */ }
  }

  function readSettings(value: unknown): Pick<Settings, "enabled" | "rules"> {
    if (value === undefined) return { ...defaults, rules: [...defaults.rules] };
    if (!value || typeof value !== "object") return { enabled: false, rules: [] };
    const candidate = value as Partial<Settings>;
    if (typeof candidate.enabled !== "boolean" || !Array.isArray(candidate.rules))
      return { enabled: false, rules: [] };
    const rules: Rule[] = [];
    for (const rule of candidate.rules) {
      try { const valid = validateRule(rule); if (valid.type === "close") rules.push(valid); }
      catch { /* Invalid stored rules never complete. */ }
    }
    return { enabled: candidate.enabled, rules };
  }

  function parent(element: Element): Element | null {
    return element.parentElement ?? (element.getRootNode() instanceof ShadowRoot
      ? (element.getRootNode() as ShadowRoot).host : null);
  }

  function isVisible(element: Element, requireBox = true): boolean {
    if (!element.isConnected || element.ownerDocument !== document) return false;
    for (let current: Element | null = element; current; current = parent(current)) {
      const style = getComputedStyle(current);
      if (current.hasAttribute("hidden") || style.display === "none" ||
          style.visibility === "hidden" || style.visibility === "collapse" ||
          style.contentVisibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    // Deliberately not an intersection/viewport test: off-screen content can be visible.
    return !requireBox || Array.from(element.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
  }

  function isEditable(element: Element): boolean {
    return element.matches("input, textarea, select") ||
      (element instanceof HTMLElement && element.isContentEditable);
  }

  function elementText(element: Element): string {
    // Never read form values, including default textarea contents or editable text.
    function textOf(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof Element) || isEditable(node) || node.matches("script, style, template")) return "";
      if (node.localName === "br") {
        return isVisible(node, false) ? " " : "";
      }
      const display = getComputedStyle(node).display;
      // display:contents has no own box but can contain visible text.
      if (!isVisible(node, display !== "contents")) return "";
      const text = Array.from(node.childNodes, textOf).join("");
      const boundary = display !== "contents" && display !== "inline" && !display.startsWith("inline-");
      return boundary ? ` ${text} ` : text;
    }
    return normalizedText(textOf(element));
  }

  function matchCount(rule: Rule): number {
    // querySelectorAll throws on invalid selectors; callers fail closed.
    const elements = document.querySelectorAll(rule.selector);
    const expected = normalizedText(rule.text);
    let count = 0;
    for (const element of elements) {
      if (element === pickerHost || isEditable(element)) continue;
      if (isVisible(element) && elementText(element) === expected) count++;
    }
    return count;
  }

  function report(force = false): void {
    const url = location.href;
    const readyRuleIds: string[] = [];
    if (settingsLoaded && settings.enabled && !dirty && !picking && !awaitingSettings) {
      for (const rule of settings.rules) {
        if (!rule.enabled || !matchesPattern(rule.pattern, url)) continue;
        try { if (matchCount(rule) > 0) readyRuleIds.push(rule.id); } catch { /* Fail closed. */ }
      }
    }
    const message = { type: "observe", url, readyRuleIds, dirty };
    const signature = JSON.stringify(message);
    if (force || signature !== lastReport) {
      lastReport = signature;
      send(message);
    }
  }

  function schedule(force = false): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; report(force); }, 150);
  }

  world.__tabDoneContent = { reannounce: () => report(true) };

  function markDirty(event: Event): void {
    if (event.composedPath().some(node => node instanceof Element && isEditable(node))) {
      dirty = true;
      // Persist across SPA URL changes and BFCache restoration; only a new document resets it.
      report();
    }
  }
  window.addEventListener("input", markDirty, true);
  window.addEventListener("change", markDirty, true);

  function unique(selector: string, element: Element): boolean {
    if (selector.length > 2000) return false;
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch { return false; }
  }

  function stableSelector(element: Element): string {
    const escape = (value: string) => CSS.escape(value);
    function candidates(node: Element): string[] {
      const result: string[] = [];
      if (node.id) result.push(`#${escape(node.id)}`);
      for (const attribute of ["data-testid", "aria-label"]) {
        const value = node.getAttribute(attribute);
        if (value !== null) result.push(`[${attribute}="${escape(value)}"]`);
      }
      const tag = escape(node.localName);
      const classes = Array.from(node.classList).map(name => `.${escape(name)}`);
      result.push(...classes, ...(classes.length ? [classes.join(""), tag + classes.join("")] : []), tag);
      return result;
    }
    for (const selector of candidates(element)) if (unique(selector, element)) return selector;
    let path = "";
    for (let node: Element | null = element; node; node = node.parentElement) {
      const siblings = node.parentElement ? Array.from(node.parentElement.children) : [node];
      const segment = `${escape(node.localName)}:nth-child(${siblings.indexOf(node) + 1})`;
      path = path ? `${segment} > ${path}` : segment;
      if (unique(path, element)) return path;
      const ancestor = node.parentElement;
      if (ancestor) {
        for (const anchor of candidates(ancestor)) {
          const selector = `${anchor} > ${path}`;
          if (unique(selector, element)) return selector;
        }
      }
    }
    throw new Error("Could not create a unique selector for this element.");
  }

  function moveHighlight(): void {
    if (!highlight || !hovered) return;
    const rect = hovered.getBoundingClientRect();
    Object.assign(highlight.style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }

  function hover(event: MouseEvent): void {
    hovered = document.elementFromPoint(event.clientX, event.clientY);
    moveHighlight();
  }

  function suppress(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  const suppressedEvents = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "contextmenu", "auxclick"];
  function finishPicker(): void {
    picking = false;
    awaitingSettings = true;
    window.removeEventListener("pointermove", hover, true);
    window.removeEventListener("mousemove", hover, true);
    window.removeEventListener("click", select, true);
    window.removeEventListener("keydown", key, true);
    for (const name of suppressedEvents) window.removeEventListener(name, suppress, true);
    pickerHost?.remove();
    pickerHost = undefined;
    highlight = undefined;
    hovered = null;
    report();
  }

  function cancel(error?: string): void {
    finishPicker();
    awaitingSettings = false;
    send(error ? { type: "pickCancelled", url: location.href, error } : { type: "pickCancelled", url: location.href });
    report(true);
  }

  function key(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    suppress(event);
    cancel();
  }

  function select(event: MouseEvent): void {
    suppress(event);
    // Resolve at click time as well, so DOM changes cannot select a stale hover target.
    hovered = document.elementFromPoint(event.clientX, event.clientY);
    try {
      const element = hovered;
      if (!element || element === pickerHost || !isVisible(element))
        throw new Error("Select a visible page element.");
      if (isEditable(element)) throw new Error("Choose a completion indicator, not an editable field.");
      pageUrl(location.href);
      const selector = stableSelector(element);
      const text = elementText(element);
      if (text.length > 2000) throw new Error("Selected text exceeds 2000 characters. Choose a smaller element.");
      const url = location.href;
      finishPicker();
      send({ type: "picked", url, selector, text });
    } catch (error) {
      cancel(error instanceof Error ? error.message : "Could not select this element.");
    }
  }

  function beginPicker(): void {
    if (picking) { report(true); return; }
    picking = true;
    awaitingSettings = true;
    report(true);
    try {
      const host = document.createElement("div");
      pickerHost = host;
      host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
      const shadow = host.attachShadow({ mode: "closed" });
      const box = document.createElement("div");
      highlight = box;
      box.style.cssText = "position:fixed;box-sizing:border-box;border:2px solid #1677ff;background:rgba(22,119,255,.12);pointer-events:none;";
      const hint = document.createElement("div");
      hint.textContent = "TabDone: click to select; Esc to cancel";
      hint.style.cssText = "position:fixed;top:12px;left:12px;padding:10px 14px;border-radius:6px;background:#162033;color:white;font:14px sans-serif;pointer-events:none;";
      shadow.append(box, hint);
      (document.documentElement ?? document).appendChild(host);
      window.addEventListener("pointermove", hover, true);
      window.addEventListener("mousemove", hover, true);
      window.addEventListener("click", select, true);
      window.addEventListener("keydown", key, true);
      for (const name of suppressedEvents) window.addEventListener(name, suppress, { capture: true, passive: false });
    } catch { cancel("Could not start the element picker."); }
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
    if (!message || typeof message !== "object") return;
    const request = message as { type?: string; rule?: unknown; expectedUrl?: unknown; preview?: boolean };
    if (request.type === "pick") {
      respond({ ok: true });
      beginPicker();
    } else if (request.type === "endPick") {
      if (picking) finishPicker();
      awaitingSettings = false;
      report(true);
      respond({ ok: true });
    } else if (request.type === "inspect") {
      const response = { url: location.href, dirty, matches: false, count: 0, error: undefined as string | undefined };
      try {
        pageUrl(response.url);
        if (request.expectedUrl !== undefined && request.expectedUrl !== response.url)
          throw new Error("The page URL changed. Inspect the current page again.");
        if (picking || (awaitingSettings && !request.preview)) throw new Error("Completion is paused until picker settings are saved.");
        const rule = validateRule(request.rule);
        // Validate the selector even when the URL does not match.
        const count = matchCount(rule);
        if (matchesPattern(rule.pattern, response.url)) {
          response.count = count;
          response.matches = count > 0;
        }
      } catch (error) {
        response.error = error instanceof DOMException ? "Invalid selector or unavailable page element."
          : error instanceof Error ? error.message : "Could not inspect this page.";
      }
      respond(response);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    settingsRevision++;
    settings = readSettings(changes.settings.newValue);
    settingsLoaded = true;
    awaitingSettings = picking;
    report(true);
  });
  const initialRevision = settingsRevision;
  try {
    chrome.storage.local.get("settings", result => {
      const failed = chrome.runtime.lastError;
      if (initialRevision !== settingsRevision) return;
      settings = failed ? { enabled: false, rules: [] } : readSettings(result.settings);
      settingsLoaded = true;
      report(true);
    });
  } catch { settingsLoaded = true; report(true); }

  const observer = new MutationObserver(records => {
    if (records.some(record => record.target !== pickerHost &&
        !(record.type === "childList" && [...record.addedNodes, ...record.removedNodes].every(node => node === pickerHost))))
      schedule();
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  setInterval(() => { if (picking) moveHighlight(); report(); }, 1000);
  window.addEventListener("pageshow", () => report());
  report(true);
}
