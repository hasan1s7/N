# Nabu startup repair - 2026-11-04

## Deploy to the existing GitHub Pages site

Extract `nabu-startup-repair.zip`. Upload all three extracted files into the SAME published folder as the current `index.html`:

```text
index.html          replace
nabu-sw.js          replace
nabu-repair.html    add
```

Do not upload the ZIP itself, and do not create another enclosing folder. Keep the other existing files; deleting them is unnecessary. Keep a copy of the old code before replacing it.

After the Pages deployment finishes, close other Nabu tabs. Open this address once in the SAME browser/profile where you use Nabu:

```text
https://hasan1s7.github.io/nabu/nabu-repair.html
```

The repair refreshes the offline app files and opens Nabu. It does not call IndexedDB deletion, reset the library, clear localStorage, or sign out accounts. Do not use the browser's Clear site data operation as a substitute for this repair.

If the repair URL is 404, the new file is not in the published folder or that deployment has not finished. If a storage restriction remains, the new entry page displays a specific error rather than waiting forever. Allow site storage and close other Nabu tabs; do not erase the word database.

## What changed

The entry page now embeds the application code, domain functions, storage adapter, styles, and favicon. It no longer requires separate JavaScript module fetches to start. Exact SHA-256 content-security-policy hashes authorize the embedded code; unsafe-inline and unsafe-eval are not enabled.

An independent startup guard handles pre-boot script failures and a 12-second startup deadline. Database opening has an 8-second deadline, and individual requests have bounded waits. Blocked upgrades and storage-access failures report actionable messages. Optional cross-tab notifications and offline registration cannot prevent the initial app from opening.

The database name remains `nabu-translate-remember`, at version 1. No new empty fallback database is used. Cards, schedules, review logs, history and settings remain in the original store.

The new offline worker checks the network for navigation, caches the self-contained entry page for offline fallback, and never intercepts the repair page or API. Repair unregisters workers only at this app's exact scope and removes only this Nabu path's app-shell cache entries. Other app scopes and unrelated cache names are left alone.

## Important limits

The screenshot confirms that the original loading shell remained visible, but does not establish its precise cause. The live site could not be reached from this environment, and the GitHub connection returned 404 for the existing repository file. No live deployment was performed.

The environment blocks normal browser URL navigation. Test results therefore distinguish real rendering/CSP execution, request fixtures, and unit tests from full hosted persistence and service-worker lifecycle verification. See `STARTUP_TEST_REPORT.md`.

## Source development / optional inbox server

Use `nabu-startup-fixed-source.zip` for source, tests and the optional backend. Edit `public/nabu-app.js`, `public/nabu-core.js`, `public/nabu-store.js` and `public/nabu.css`, then regenerate the entry page:

```bash
python tools/build_standalone.py
node --test tests/core.test.mjs tests/startup.test.mjs
python -m pytest tests/test_server.py -q
python tests/startup_browser.py
```

The backend has also been updated to send CSP headers matching the embedded scripts. Deploying only the three-file Pages patch onto an unmodified version of the optional Python server would leave its old CSP header in place; use the updated full source for that server.
