# Chrome Web Store submission materials

Prepared for TabDone 0.3.0. Review these statements before certifying or submitting
in the developer dashboard. Nothing in this document submits or publishes an item.
See [Publishing](publishing.md) for account setup and subsequent automated updates.

## Listing fields

- **Name:** TabDone
- **Short description:** Close finished tabs using URL patterns and a completion element you choose.
- **Language:** English
- **Suggested category:** Productivity / tab or workflow management (choose the closest available category).
- **Website:** https://github.com/kvidzibo/tabdone
- **Support:** https://github.com/kvidzibo/tabdone/issues
- **Privacy policy:** https://github.com/kvidzibo/tabdone/blob/main/docs/privacy.md

The privacy URL becomes usable after this document and the policy are merged.
Open it signed out and confirm it is publicly readable before submitting.
Set your developer contact email and any required trader/distribution declarations
in the dashboard yourself; they are not supplied by this repository.

### Detailed description

TabDone automatically closes finished tabs using rules you define. Choose a page
element that signals completion, match its visible text, and let TabDone clear
eligible tabs after you leave the browser. No service-specific integration is required.

Create a rule on a page, pick its completion indicator, and test the match before
saving. URL patterns let one rule cover similar pages. Optionally close tabs at
the same URL and its subpages, with an explicit close scope you control.

Features:
- Pick a completion element directly on the page, or edit its CSS selector.
- Match exact, case-sensitive text with normalized whitespace.
- See watching/done status and matching-tab counts in the toolbar popup.
- Pause globally, disable individual rules, or edit and delete them at any time.
- Close duplicate tabs with exactly the same URL (on by default; can be turned off or limited by rules).
- Keep pinned tabs, selected tabs in every window, and pages with detected edits open.

Tabs close only when no Chrome window TabDone can see has focus, for example after
you switch to another application; focusing another Chrome profile or an incognito
window without TabDone access also counts. Tabs never close while you browse. On some
Linux systems this can take up to 30 seconds. Selected tabs stay open.
Edit detection is conservative, not a guarantee that every site's unsaved work
will be recognized. Test rules carefully: broad selectors or close scopes can
close unintended tabs, and changing website markup can require rule updates.

TabDone reads open-tab URLs, selected page content and edit-event flags locally
to provide these features. Saved rules stay in local extension storage; temporary
tab state and drafts stay in session storage. The extension transmits none of
this data to the developer or third parties. No account, analytics or backend is
required. Site access is requested when you pick, test or enable a rule.

Requires Chrome/Chromium 121 or newer. Supports top-level HTTP(S) pages, not browser
internal pages, iframe contents or shadow-DOM selection. A site's completion
indicator must update on the page; TabDone does not poll service APIs.

## Privacy practices

### Single purpose

Automatically close completed browser tabs and optionally related tabs, using
user-defined URL patterns and visible page-completion indicators, and close
duplicate tabs showing exactly the same URL.

### Permission justifications

**tabs:** Read URLs and state of open tabs to match user-defined rules, count and
group related tabs, find tabs with exactly the same URL, and check
selection/pinning/last use before closing eligible tabs.
TabDone does not request the history permission or store a browsing-history log.

**alarms:** Check every 30 seconds whether any browser window has focus, because
some platforms do not report the browser losing focus. Tabs close only while it is unfocused.

**scripting:** Inject the bundled element picker and completion observer into
permitted sites. They locate selected page elements, match visible text and detect
edit events needed for safe automatic tab closing. All code ships in the extension.

**storage:** Save rule configuration and pause settings in local extension storage.
Use session storage for temporary tab-completion state, pending closures, picker
results and editor drafts so service-worker suspension does not lose that state.
No Chrome Sync storage is used.

**Optional host access (`http://*/*`, `https://*/*`):** Users can define rules for
arbitrary HTTP(S) sites, so the manifest declares these optional host patterns.
Access is requested at runtime for the chosen scheme and host, not all sites at
once. Chrome's grant covers that host's paths and ports; TabDone's rule matching
still checks the exact origin, including port. Permission enables the picker,
completion observer and edit protection. Users can revoke it in Chrome settings.

**Remote code:** No. Executable JavaScript, styles and icons are bundled locally.

### Data-use disclosures

Do not choose “no user data” solely because there is no server. Google's
[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
requires disclosure of local processing too. Review the dashboard's current labels
and disclose these handled categories:

- **Web history:** URLs of currently open tabs used for matching, grouping and
  duplicate detection; no Chrome history API access or persistent browsing-history log.
- **Website content:** Page elements/attributes and visible text used for picking
  and matching, with selectors and chosen completion text saved in rules.
- **User activity:** Input/change event detection used only to flag edited pages;
  no keystroke log or form-field values.

Data stays on-device and is used only for the stated tab-management purpose.
There is no sale/transfer to third parties, unrelated use, or use for creditworthiness
or lending. Confirm the dashboard certifications only after reviewing the
[privacy policy](privacy.md) and actual package behavior. Sensitive information
could occur in chosen URLs/text; do not claim that such content is impossible.

## Reviewer test instructions

No account, subscription, backend or credentials are required.

1. Open `https://github.com/kvidzibo/tabdone` in an unpinned tab, signed out of GitHub.
   Scroll to the README's **TabDone** heading (below the file list).
2. Open TabDone's toolbar popup and choose **New rule for this page**.
3. Name the rule **TabDone demo** and keep the exact URL pattern
   `https://github.com/kvidzibo/tabdone`. Uncheck **Also close tabs at the same URL and its subpages**.
4. Choose **Pick element**, approve access to `https://github.com/*`, and click
   the README heading's **TabDone** text. The editor should receive a generated
   CSS selector and the visible text `TabDone`.
5. Choose **Test on page**. Expect one visible text match and “completion detected”.
6. Choose **Save rule**, keeping the editor selected. The source page is complete
   and in the background. Switch to another application for up to 30 seconds;
   the repository tab should close and the editor stays open.
7. Open the same repository URL again and keep it selected. The popup should show
   **Done — closes after you switch tabs and leave the browser** once the README loads. Switch to a
   different tab, then to another application; the repository tab should close.
8. Open `https://github.com/kvidzibo/tabdone/issues` twice in two tabs, select a third
   tab, then switch to another application. One issues tab should close.
   **Manage rules** → **Settings** → **Close duplicate tabs** turns this off.
9. Pause TabDone using the popup's global switch. Open the repository page again,
   switch to another tab and then another application; it should remain open.
   Delete the demo rule under **Manage rules** before resuming if you no longer want this behavior.

This is a deliberately simple demonstration: the static README heading acts as
an already-complete indicator. Normal rules target changing completion statuses.
The public repository is hosted by GitHub, not an extension backend. If its markup
changes, pick the README heading again and use the actual displayed text.
Store screenshots use a separate clearly labelled sample review page with fictitious
data; that page is not part of the installed extension.

## Upload checklist

- Upload `tabdone-0.3.0.zip`, with `manifest.json` at the ZIP root; do not zip the repository.
- Use the existing `public/icons/128.png` store icon.
- Supply at least one actual-use screenshot at **1280×800** or **640×400**, with no
  added padding. Prepared screenshots are handed off separately, not committed.
- Copy the listing, permission explanations and reviewer instructions above.
- Verify the public privacy URL, developer contact details and distribution choices.
- Review the completed dashboard and submit only when ready; approval is Google's decision.

Official references: [Listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing),
[image requirements](https://developer.chrome.com/docs/webstore/images),
and [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).
