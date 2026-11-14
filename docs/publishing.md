# Publish to Chrome Web Store

Pushing a `v<version>` tag runs CI, then uploads the tested ZIP and submits it
for review. Google publishes it automatically after approval, using the listing's
existing visibility. Ordinary pushes and pull requests never publish.

## One-time setup

1. Register in the [Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole),
   pay the registration fee, and enable two-step verification on your Google account.
2. Upload the first ZIP manually (`npm ci && npm run zip`). Complete the listing,
   screenshots, privacy disclosures/policy URL, distribution, and reviewer instructions.
   Use the [prepared listing and reviewer text](store-listing.md) and
   [privacy policy](privacy.md); confirm the policy URL is public before submitting.
   The API cannot create a listing. Publish this initial version through the dashboard.
3. In a Google Cloud project, enable **Chrome Web Store API** and
   **IAM Service Account Credentials API**. Create a dedicated service account.
   Grant it **Service Account Token Creator** (`roles/iam.serviceAccountTokenCreator`)
   on **itself**, not on the whole project. No project-wide Editor/Owner role is needed.
4. Add its email under **Account** in the Web Store dashboard to authorize API access.
   This grants access to your publisher's items; treat it as a publishing credential.
5. Create a JSON key for that service account. In this GitHub repository, create an
   environment named **chrome-web-store** under **Settings → Environments**:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Secret | `CWS_SERVICE_ACCOUNT_KEY` | Entire service-account JSON key, preferably minified |
   | Variable | `CWS_PUBLISHER_ID` | Publisher ID from the Web Store dashboard's Publisher settings |
   | Variable | `CWS_EXTENSION_ID` | Store item's 32-character extension ID, not the unpacked development ID |

   Restrict the environment's deployment rules to **tags matching `v*`**, with no
   branch rule. Use a repository tag ruleset to restrict creation, updates, and
   deletion of `v*` tags to trusted releasers. The workflow also requires the tagged
   commit to be on `main`. For fully automatic submission, do not require an
   environment reviewer; enable one if you want a manual approval gate.

Keep the key out of source, chat, logs, and build artifacts. Store it only as the
environment secret, securely remove the downloaded copy after setup, and rotate
or revoke it in Google Cloud if exposed. Authentication creates a short-lived
access token without writing a credentials file into the checkout.

See Google's [service-account setup](https://developer.chrome.com/docs/webstore/service-accounts)
and [API guide](https://developer.chrome.com/docs/webstore/using-api).

## Release an update

1. In a feature-branch PR, bump `package.json` and `public/manifest.json` to the same
   new stable version, then run `npm install --package-lock-only` to sync the lockfile.
   Use three numeric components (for example, `0.1.2`), each no greater than 65535;
   no prerelease suffixes or leading zeroes. The version must exceed the uploaded
   store version. Run `npm run check` and `npm run test:e2e` and merge the reviewed PR.
2. Tag that merged commit and push the tag. For example, if its version is `0.1.2`:
   ```sh
   git fetch origin main
   git tag -a v0.1.2 origin/main -m "TabDone 0.1.2"
   git push origin v0.1.2
   ```
3. Check the **CI** run. It checks the tag/version and main ancestry, runs unit and
   browser tests, builds `tabdone-<version>.zip`, and uploads that artifact. The
   separate publishing job downloads that exact artifact, verifies its manifest
   version, authenticates, uploads it, and submits it for review. Publishing jobs
   are serialized and do not cancel an active submission job.

A green publishing job means the submission was accepted, **not** that Google has
approved it or made it available. Check the developer dashboard for review status.
Store-installed copies receive updates through Chrome; unpacked copies do not.
There is no GitHub Release creation or npm publishing in this workflow.

## Failed or interrupted submissions

Uploads are polled for up to 30 status checks; HTTP requests have a 60-second
limit and the publishing job has a 10-minute limit. Failed, unknown, or timed-out
uploads never proceed to publication. Store validation warnings also block submission.

Check the dashboard before retrying: a timeout may occur after Google accepted a
request. If the upload succeeded but submission failed, resolve the listing or
policy issue and submit the uploaded version from the dashboard. Do not blindly
re-upload the same version or move an existing release tag. For a new package,
release a higher version through another PR and tag. If another version is under
review, let it finish or explicitly manage that submission in the dashboard.
Changing listing visibility also requires a manual publication before API
publishing can resume.

No live submission is needed for local validation: `npm test` exercises the
publisher with intercepted HTTP responses, including failed and asynchronous uploads.
Live authentication and store approval can only be verified after account setup.
