# TabDone

A Chrome/Chromium extension that closes finished tabs using rules you define.
Pick a completion element, match its visible text, and close the page and related
tabs after you leave the browser. It can also close duplicate tabs.
No GitHub-specific logic, accounts, or backend.

## Install

Requires Chrome/Chromium 121+. Building requires Node.js 22+; ZIP packaging
and publisher tests also require the `zip` and `unzip` command-line tools.

1. Build from source with Node.js 22+:
   ```sh
   npm ci
   npm run build
   ```
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
   and select `dist/`.
3. Pin TabDone to the toolbar.

`npm run zip` creates `tabdone-<version>.zip`. Unzip it before **Load unpacked**.
The [CI workflow](https://github.com/kvidzibo/tabdone/actions/workflows/ci.yml)
also provides a downloadable build artifact after successful runs.
A Chrome Web Store listing is not configured yet. Once configured, release tags
can submit updates automatically; see [Publishing](docs/publishing.md) and the
[store submission materials](docs/store-listing.md).
Unpacked installations still require manual updates.

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
Only one tab needs to detect completion.

## When tabs close

Tabs close only after you leave the browser for another app; switching tabs or
browser windows closes nothing. TabDone sweeps immediately when Chrome reports
the focus loss, and otherwise checks every 30 seconds whether any browser window
has focus. Chromium on Linux/X11 does not report it, so closing there can take up
to 30 seconds. Sweeps repeat while the browser stays unfocused.

The badge shows the current group count: gray while watching, purple when done,
and **Ⅱ** when paused. Counts include protected tabs. The popup has a global pause;
**Manage rules** lets you edit, disable, or delete rules.

## Duplicate tabs

**Close duplicate tabs** is on by default; turn it off in **Manage rules** → **Settings**.
When you leave the browser, HTTP(S) tabs with exactly the same URL, including query and
fragment, are reduced to one: a pinned or selected copy if any, otherwise the most
recently used. Pinned and selected tabs always stay open, as do edited pages on watched
sites; edits elsewhere cannot be detected. Incognito and normal tabs are never compared.
It needs no rule or site access. The global pause stops it too.

To exclude pages, create a rule with **Rule type** → **Keep duplicates open** and a URL
pattern. It needs no completion element or site access.

## Safety and limitations

- Pinned tabs and selected tabs in **every** window stay open, even after you
  leave the browser.
- Detected input/change events protect a document until reload; this is
  conservative, not a guarantee that every website's unsaved work is detected.
- For rules, missing permissions, unavailable content scripts, and unknown state leave
  tabs open. URLs and eligibility are checked again before closing.
- Completion and queued tabs survive service-worker suspension, but not a browser
  restart. Navigation, rule or pause changes, or permission removal clear stale state.
  A completed group is armed at the first sweep; only tabs present then are queued.
- Top-level HTTP(S) pages only. No browser-internal pages, iframes, or shadow-DOM
  selection. Pickers may use positional selectors when stable attributes are absent.
- Site markup can change; test selectors carefully. A broad selector or close
  scope can close unintended tabs. A page merged elsewhere must update before
  TabDone can observe it. There is no API polling.

## Privacy and permissions

Data is processed on-device; the extension sends none of it to the developer or
third parties. Rules contain URL patterns, selectors, and selected text. Session-only
state contains full tab URLs and unfinished editor drafts. URLs and selected text
can contain sensitive information; choose completion indicators carefully.
See the [privacy policy](docs/privacy.md) for data use, retention and controls.

- **tabs**: inspect URLs, count/group tabs, and close eligible tabs.
- **scripting**: install the picker and completion observer.
- **storage**: save rules locally and temporary state for worker restarts.
- **alarms**: check every 30 seconds whether the browser has lost focus.
- **Optional site access**: requested only when picking, testing, or enabling a rule.
  Chrome grants access for the selected scheme/host across paths and ports;
  TabDone's rule matching still respects the exact origin, including port.

Remove site access via Chrome's extension details. Disabling/deleting a rule stops
watching it but does not revoke a previously granted site permission.
The extension does not access browser cookies, password storage or form-field
values. It has no remote code, analytics or external assets.

## Development

```sh
npm run check       # TypeScript, URL/group and publisher tests, production build
npm run test:e2e    # Real extension in isolated Chromium
npm run zip
```

The Linux browser test requires `chromium`, `xvfb-run`, `dbus-run-session`,
`xdotool`, and ImageMagick's `import` and `display`. Override `CHROMIUM_PATH` if needed.
It uses a temporary profile, private display/D-Bus, and a local fixture server;
it never touches your browser profile. Screenshots go to `/tmp/tabdone-screenshots`
(or `TABDONE_SCREENSHOTS`). Tests switch focus to another X window and cover
picker/save, dynamic matching, grouped closing, active/pinned/edited tabs,
navigation, pause, worker restarts, the 30-second check, and duplicate closing.

MIT licensed.
