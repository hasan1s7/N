# Startup repair release

For the current three-file GitHub Pages patch, read **STARTUP_FIX.md** and **STARTUP_TEST_REPORT.md** first. The source entry page is generated with `python tools/build_standalone.py`. The original MVP notes below remain useful for features and API setup.

---

# Nabu: translate, remember, exchange

A self-contained, local-first MVP. No frontend framework, no npm install, no build step.

**The product loop:** translate a word or phrase -> save an editable card -> review it on a schedule -> send a word to someone else.

This is a new, upload-ready implementation, **not a verified patch of the existing repository**. The GitHub connection did not expose `hasan1s7/nabu`, so no existing repository files were read, changed, or deployed. The database has its own name and does not overwrite legacy Nabu storage. Back up your old site and its data before replacing its entry page.

## Choose the version you need

| Capability | Static website / GitHub Pages | Included Python server |
|---|---|---|
| Translation via MyMemory | Yes; explicit consent and external service availability required | Yes |
| Cards, collections, tags, reverse cards, scheduled reviews | Local browser storage | Local browser storage |
| Link-based word exchange | Yes, between people using the published site | Yes |
| Accounts and direct @handle inbox | No | Yes |
| Accept, decline, block, sign out, delete account | No accounts | Yes |
| Translation through a server-held DeepL key | No | Optional configuration |
| Cross-device library synchronization | No | No |

Accounts do not back up your library. They enable word exchange. Signing out leaves this device's library intact.

## 1. GitHub Pages: the smallest deployment

Unzip **nabu-pages.zip**, and place its files in the directory your Pages site publishes, alongside/replacing its existing `index.html`. For a repository publishing its root, that means:

```text
index.html
nabu-app.js
nabu-core.js
nabu-store.js
nabu.css
nabu-sw.js
nabu-icon.svg
nabu.webmanifest
.nojekyll
```

Upload the files, not the ZIP. There is no build command and no secret to configure. Relative paths support both a domain root and a project URL such as `/nabu/`.

The asset names are prefixed to avoid unnecessarily overwriting unseen `app.js`, `style.css`, or other files from your existing project. Only the main entry page intentionally replaces `index.html`.

If the previous site is still visible, first check the Pages deployment completed. Then perform a hard refresh. An older service worker can keep an old app alive: unregister that old worker in browser developer tools and reload. **Do not clear all site data unless you have exported your library.**

For a local static preview from the full-source directory:

```bash
python -m http.server 8080 --directory public
```

Open `http://127.0.0.1:8080`. Serve the files over HTTP/HTTPS; do not rely on double-clicking the module-based index file. Shares pointing to localhost are only useful on your own device. Publish the site before exchanging links with friends.

## 2. Full app: accounts and a direct word inbox

Requires Python 3.11 or later. Tested here with Python 3.13.5.

```bash
python -m venv .venv
# macOS / Linux:
. .venv/bin/activate
# Windows PowerShell instead: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

Open **`http://127.0.0.1:8000`**, exactly. The default expected request origin uses `127.0.0.1`, not `localhost`.

From Exchange, create two test handles in separate browser profiles. Save a word, click Share, enter the recipient's exact handle, and send it. The recipient refreshes their inbox and chooses whether to accept. A received word starts a new local schedule, not the sender's schedule.

The server serves the frontend and `/api/` from the same origin. **Do not point the Pages app at an unrelated cookie-based API domain.** This build deliberately avoids cross-origin account/session complexity. Host the included frontend and backend together for direct inbox functionality.

### Server configuration

`.env.example` is a reference template, not an automatically loaded file. Export variables in your shell or hosting platform:

```bash
export NABU_ORIGIN="https://nabu.example.com"
export NABU_HOST="0.0.0.0"
export NABU_INVITE_CODE="replace-with-a-long-private-beta-invite"
export NABU_DB="/persistent-data/nabu.sqlite3"
# Optional:
export DEEPL_API_KEY="your-server-only-key"
export NABU_TRANSLATION_DAILY_CHARS="50000"
python server.py
```

Non-local deployments require an HTTPS origin and an invitation code. Configure HTTPS at your reverse proxy or host. The SQLite directory must persist across restarts and releases. Never put the database under `public/`. Back it up with SQLite's backup API; copying a live WAL database file alone is not a reliable backup.

`Dockerfile` is included. Mount persistent storage at `/data`, set the origin/invitation variables, and place the container behind HTTPS. The image runs as a non-root user.

The default launch does not trust forwarded IP headers. Behind a proxy, configure only that proxy's trusted address when launching Uvicorn; otherwise users share the proxy's rate limit. Do not blindly trust arbitrary internet-supplied forwarding headers.

This is an **invite-only beta backend**, not an audited public social platform. Before a public launch, add operational monitoring, tested backups/recovery, password recovery, abuse reporting/moderation, and an appropriate privacy/data-retention policy. There is no public directory, user feed, contact scraping, or automatic messaging.

## Translation behavior

Twelve selectable language codes are included: Arabic, Chinese, English, French, Russian, Spanish, German, Italian, Japanese, Korean, Portuguese, and Turkish. Source language is explicit; automatic detection is not implemented.

MyMemory requests happen only after the user consents and presses Translate. The app chunks text into at most 480 UTF-8 bytes per request, below the provider's documented 500-byte limit. The UI accepts 2,000 characters, caches results locally, handles quota/service errors, and cancels stale UI updates. Very long unspaced text may be split within a sentence, so translation quality can suffer. Card sides are capped at 1,000 characters; select a shorter phrase or edit a long translation before saving.

The public provider documents usage limits, including 5,000 characters per day for anonymous use. Treat it as a beta integration, not an enterprise service commitment. Text leaves the device when translating; do not submit confidential material. No translation is uploaded through MyMemory's contribution endpoint.

With `DEEPL_API_KEY` configured, sign in and select the workspace provider in Settings. The key remains server-side. Requests are authenticated, rate-limited, and subject to per-user and global character caps. Failed requests conservatively consume local quota. Provider pricing, language availability, and terms can change.

The built-in example chips work without a service and are explicitly marked **not a live translation**. They are not disguised API results.

**External MyMemory and DeepL requests could not be verified live in this execution environment.** Translation adapter success/failure handling was checked using controlled responses; validate the live service on your deployment before inviting users.

## Review behavior

This uses `nabu-srs-v1`, a small, explicit **SM-2-inspired policy**, not FSRS, not an exact Anki scheduler, and not a trained/fine-tuned ML model.

- New: Again = 1 minute; Hard = 5 minutes; Good = 10 minutes; Easy = 4 days.
- Learning: a subsequent Good graduates to 1 day. Again restarts the short learning step.
- Review: Hard, Good, and Easy extend the prior interval with distinct factors. Again enters relearning.
- Relearning: successful recall graduates to a reduced interval; another lapse returns sooner.

Every rating records an event and updates the card in the same IndexedDB transaction. Revisions reject concurrent stale writes. Undo is guarded against overwriting newer work. Reverse cards are independent objects. New-word limits count distinct introductions on the local calendar day and do not cap overdue reviews.

The app displays practice activity and scheduled workload, not invented mastery or workplace competence. See `ENGINEERING.md` for equations and schemas.

## Data portability and privacy

A full JSON export includes cards, schedules, private notes, settings, and review history. Keep it secure. Import validates the file before writing, merges atomically, skips duplicates, and does not overwrite existing schedules. Anki-compatible TSV export carries content only; it does not preserve schedules. Native `.apkg` archives, audio attachments, cloze note types, and AnkiWeb sync are not implemented.

CSV/TSV import expects front, back, optional context, optional tags in that order. Choose the language pair before importing. Do not export Anki GUIDs or special columns into this simple four-column import. HTML is displayed as text, not executed. Export quotes are escaped, tabs/newlines in fields become spaces, and spaces within Anki tags become underscores. For maximum fidelity, use the JSON backup.

Shared links include only word, meaning, language pair, context, and an optional unverified display name. They exclude private notes, tags, collection names, and review history. Links are readable by anyone who holds them, are not encrypted, cannot be revoked, and can be forwarded. The app previews them before adding anything.

A server exchange uses an authenticated sender and a bounded card payload. Blocking prevents delivery and hides prior incoming exchanges from that sender. Acceptance changes the server exchange status; saving to the local device happens first so a network error does not lose the word. Retrying acceptance is duplicate-safe.

The service worker caches only the app shell, not API responses or third-party requests. The intended offline behavior is saved-card review and cached translation access after a first successful load. **Origin-based service-worker/IndexedDB behavior was not end-to-end verified here because browser URL navigation is restricted.** The full browser test suite is provided to run on your deployment.

## Tests

```bash
# Pure JavaScript tests, Node 20+:
node --test tests/core.test.mjs

# Real SQLite/API/security tests:
pip install -r requirements-dev.txt
python -m pytest tests/test_server.py -q
```

The unrestricted browser suite needs a local Chromium installation and both servers:

```bash
# Terminal 1, full-source root:
python -m http.server 8766 --directory .

# Terminal 2, fresh TEST database, not a real user database:
NABU_ORIGIN=http://127.0.0.1:8765 PORT=8765 NABU_DB=/tmp/nabu-browser-test.sqlite3 python server.py

# Terminal 3:
python tests/browser_smoke.py --chromium /path/to/chromium
```

`tests/preview_harness.py` exists for restricted browser environments. It renders the real frontend and exercises its interactions with an in-memory local-storage adapter, mocked translation, and the real local inbox through an HTTP bridge. It is **not** a substitute for IndexedDB, service-worker, native cookie, or live-provider tests.

See `TEST_REPORT.md` for exactly what passed and what was blocked.

## References checked for implementation

- MyMemory request format and byte limit: https://mymemory.translated.net/doc/spec.php
- MyMemory service quotas: https://mymemory.translated.net/doc/usagelimits.php
- Anki text imports, quoting, and headers: https://docs.ankiweb.net/manual/importing/text-files
- Original SM-2 description: https://super-memory.org/archive/english/ol/sm2.htm
- DeepL translation API: https://developers.deepl.com/api-reference/translate/request-translation
- FastAPI lifespan/testing: https://fastapi.tiangolo.com/advanced/events/ and https://fastapi.tiangolo.com/advanced/testing-events/
