# TabDone privacy policy

Last updated: November 26, 2026

TabDone is an open-source browser extension that closes completed tabs using
rules you define. It processes data on your device. The extension does not send
that data to the developer or to third parties, and has no accounts, analytics,
advertising, remote code, or backend service.

## Data used and why

- **Open tabs:** Tab URLs and tab state, such as selection, loading and pinning,
  are used to match rules, group related tabs, find exact duplicate tabs, show
  status and decide which tabs may close. Temporary URLs can include query strings and fragments even though
  rule matching and grouping ignore them. TabDone does not use Chrome's browsing
  history API.
- **Website content:** On sites you permit, TabDone inspects page elements,
  attributes and visible non-editable text to create CSS selectors and detect the
  completion text you choose. Selected text and selectors become part of a rule.
- **Edit activity:** Input/change events set a temporary flag that protects a page
  from closing. TabDone does not read form-field values or record keystrokes.
- **Your settings:** Rule names, URL patterns, selectors, completion text, closing
  preferences and enabled/paused settings provide the configuration you request.

Do not choose sensitive page content as completion text. URLs, selectors and
selected text can contain personal or confidential information. TabDone does not
access browser cookies or password storage, but cannot determine whether text or
URLs you choose contain sensitive information.

## Storage and retention

Saved settings and rules use Chrome's local extension storage, not Chrome Sync.
They remain until you change/delete them or uninstall the extension. Temporary
tab observations, queued closures, picker results and editor drafts use session
storage, which is cleared when the browser session ends. Matching and edit flags
also use memory in the page's extension script; reloading a page resets its edit flag.

Saving, deleting or cancelling a rule removes that editor's current draft. Other
temporary data can remain until the browser session ends. Pausing or disabling
a rule does not delete saved rules or revoke previously granted site permissions.
The extension relies on your browser and device's storage protections; it does not
add its own encryption. Anyone with access to your browser profile or device may
be able to access locally stored data.

## Your controls

Use **Manage rules** to inspect, edit or delete saved rules, and the global switch
to pause automatic closing. Revoke site access in Chrome's extension details.
Uninstalling TabDone removes its extension storage from that browser profile;
separate device/profile backups are outside the extension's control.

## Sharing and limited use

The extension does not transmit, sell or share the data it handles. Data is used
only for its user-facing tab-management features, not for advertising, profiling,
creditworthiness or lending. The developer does not receive or read your tab data,
rules or page content through the extension. TabDone's use of user data complies
with the Chrome Web Store User Data Policy, including its Limited Use requirements.

Google's store/browser services and GitHub's website operate under their own
privacy policies. If you voluntarily submit a support issue, GitHub and project
maintainers receive what you post; this is separate from extension data processing.

## Questions

Contact the maintainers through the
[TabDone issue tracker](https://github.com/kvidzibo/tabdone/issues).
Issues are public: do not include private URLs, page content, credentials or other
sensitive information. Policy updates will be published on this page.
