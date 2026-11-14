export interface Rule {
  id: string;
  name: string;
  pattern: string;
  selector: string;
  text: string;
  baseDepth: number;
  closeRelated: boolean;
  enabled: boolean;
}
export interface Settings { enabled: boolean; rules: Rule[] }
export const defaults: Settings = { enabled: true, rules: [] };
export function normalizedText(text: string): string { return text.replace(/\s+/g, " ").trim(); }

export function pageUrl(raw: string): URL {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Use an HTTP or HTTPS page URL without credentials.");
  return url;
}
export function patternParts(pattern: string): { origin: string; path: string } {
  const match = /^(https?:\/\/[^/?#*]+)(\/[^?#]*)$/.exec(pattern);
  if (!match) throw new Error("Use an exact site and a path pattern, e.g. https://example.com/**");
  const url = pageUrl(match[1]);
  return { origin: url.origin, path: match[2] };
}
export function hostPermission(pattern: string): string {
  const url = new URL(patternParts(pattern).origin);
  // Chrome match patterns cover all ports on the chosen host.
  return `${url.protocol}//${url.hostname}/*`;
}
export function matchesPattern(pattern: string, raw: string): boolean {
  try {
    const { origin, path } = patternParts(pattern);
    const url = pageUrl(raw);
    if (url.origin !== origin) return false;
    let source = "";
    for (let i = 0; i < path.length; i++) {
      if (path[i] === "*") {
        if (path[i + 1] === "*") { source += ".*"; i++; }
        else source += "[^/]*";
      } else source += path[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${source}$`).test(url.pathname);
  } catch { return false; }
}
export function pathSegments(raw: string): string[] {
  return pageUrl(raw).pathname.split("/").filter(Boolean);
}
export function groupUrl(raw: string, depth: number): string | null {
  try {
    const url = pageUrl(raw);
    const parts = pathSegments(raw);
    if (!Number.isInteger(depth) || depth < 0 || parts.length < depth) return null;
    return url.origin + (depth ? "/" + parts.slice(0, depth).join("/") : "/");
  } catch { return null; }
}
export function inGroup(raw: string, base: string): boolean {
  try {
    const url = pageUrl(raw);
    const root = pageUrl(base);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const prefix = root.pathname.replace(/\/+$/, "") || "/";
    return url.origin === root.origin && (path === prefix || (prefix === "/" ? true : path.startsWith(prefix + "/")));
  } catch { return false; }
}
export function validateRule(value: unknown): Rule {
  const r = value as Rule;
  if (!r || typeof r !== "object" || typeof r.id !== "string" || !r.id ||
      typeof r.name !== "string" || !r.name.trim() || r.name.length > 100 ||
      typeof r.pattern !== "string" || r.pattern.length > 2000 ||
      typeof r.selector !== "string" || !r.selector.trim() || r.selector.length > 2000 ||
      typeof r.text !== "string" || r.text.length > 2000 ||
      !Number.isInteger(r.baseDepth) || r.baseDepth < 0 || r.baseDepth > 100 ||
      typeof r.closeRelated !== "boolean" || typeof r.enabled !== "boolean")
    throw new Error("Complete the rule name, URL pattern, and completion selector.");
  patternParts(r.pattern);
  return { id:r.id, name:r.name.trim(), pattern:r.pattern, selector:r.selector, text:normalizedText(r.text),
    baseDepth:r.baseDepth, closeRelated:r.closeRelated, enabled:r.enabled };
}
