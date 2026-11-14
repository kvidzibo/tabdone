# TabDone

A Chrome/Chromium extension that closes finished tabs using rules you define.
Pick a completion element, match its visible text, and close the page and related
tabs when you switch tabs. No GitHub-specific logic, accounts, or backend.

## Install

Requires Chrome/Chromium 120+.

1. Build from source with Node.js 22+:
   ```sh
   npm ci
   npm run build
   ```
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
   and select `dist/`.
3. Pin TabDone to the toolbar.

`npm run zip` creates `tabdone-0.1.0.zip`. Unzip it before **Load unpacked**.
The [CI workflow](https://github.com/kvidzibo/tabdone/actions/workflows/ci.yml)
also provides a downloadable build artifact after successful runs.
There is no Chrome Web Store release or automatic update mechanism yet.

## Create a rule

1. On a representative page, open TabDone → **New rule for this page**.
2. Enter a name and URL pattern, e.g. `https://github.com/**/pull/**`.
   Sites are exact; `*` matches within one path segment, `**` crosses segments.
3. Choose **Pick element**, grant site access, and click the completion badge.
   Escape cancels. Check the generated CSS selector and exact text.
4. **Test on page**, check **Close scope**, then **Save rule**.

A rule created on `/owner/repo/pull/118` defaults to that path's depth:
on PR 119 it groups `/owner/repo/pull/119`, not PR 118.
Its subpages (`/commits`, `/changes`, etc.) belong to the same group,
but `/pull/1180` does not. Queries and fragments are ignored for grouping.
If creating a rule on a subpage, choose the intended parent in **Close scope**.
Choosing the site root groups the entire site—use with care.
Disable related closing to close only the completed tab.

A visible element must match the normalized, case-sensitive text.
Only one tab needs to detect completion. Active sources wait until you switch
tabs; completion in a background tab is immediately eligible.
Opening the editor itself leaves the source tab; saving an already-complete
rule can therefore close that background page.

The badge shows the current group count: gray while watching, purple when done,
and **Ⅱ** when paused. Counts include protected tabs. The popup has a global pause;
**Manage rules** lets you edit, disable, or delete rules.

## Safety and limitations

- Pinned tabs and selected tabs in **every** window stay open. Switching apps or
  focusing another browser window does not close its selected tab.
- Detected input/change events protect a document until reload; this is
  conservative, not a guarantee that every website's unsaved work is detected.
- Missing permissions, unavailable content scripts, and unknown state leave tabs
  open. URLs and eligibility are checked again before closing.
- Completion and queued tabs survive service-worker suspension, but not a browser
  restart. Navigation, settings changes, or permission removal clear stale state.
  Only tabs already present when a group is armed are queued.
- Top-level HTTP(S) pages only. No browser-internal pages, iframes, or shadow-DOM
  selection. Pickers may use positional selectors when stable attributes are absent.
- Site markup can change; test selectors carefully. A broad selector or close
  scope can close unintended tabs. A page merged elsewhere must update before
  TabDone can observe it. There is no API polling.

## Privacy and permissions

Everything stays in local extension storage; nothing is transmitted.
Rules contain URL patterns, selectors, and selected text. Session-only state
contains tab URLs and unfinished editor drafts. Do not select sensitive text.

- **tabs**: inspect URLs, count/group tabs, and close eligible tabs.
- **scripting**: install the picker and completion observer.
- **storage**: save rules locally and temporary state for worker restarts.
- **Optional site access**: requested only when picking, testing, or enabling a rule.
  Chrome grants access for the selected scheme/host across paths and ports;
  TabDone's rule matching still respects the exact origin, including port.

Remove site access via Chrome's extension details. Disabling/deleting a rule stops
watching it but does not revoke a previously granted site permission.
No cookies, form values, API tokens, remote code, analytics, or external assets.

## Development

```sh
npm run check       # TypeScript, URL/group tests, production build
npm run test:e2e    # Real extension in isolated Chromium
npm run zip
```

The Linux browser test requires `chromium`, `xvfb-run`, `dbus-run-session`,
`xdotool`, and ImageMagick's `import`. Override `CHROMIUM_PATH` if needed.
It uses a temporary profile, private display/D-Bus, and a local fixture server;
it never touches your browser profile. Screenshots go to `/tmp/tabdone-screenshots`
(or `TABDONE_SCREENSHOTS`). Tests cover picker/save, dynamic matching, grouped
closing, active/pinned/edited tabs, navigation, pause, and worker restarts.

MIT licensed.
