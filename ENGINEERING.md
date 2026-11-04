# Nabu MVP: engineering handoff

## Product boundary

The implementation is intentionally not an enterprise course generator. It has four visible screens: Translate, Library, Review, and Exchange, plus Settings/data controls.

The minimum useful loop is operationally small:

```text
Explicit translation request
  -> provider result or actionable failure
  -> user-approved, editable card
  -> persistent local library
  -> due-card selection
  -> recall attempt + self-rating
  -> atomic review event and schedule update
  -> optional word exchange
```

A translation is not automatically a good learning item. Editing, optional source-language context, private notes, and independently scheduled reverse cards are included for that reason. Selection translation gets its own translation request; it does not pretend a sentence's full translation is the meaning of every selected word.

## Module boundaries

| File | Responsibility |
|---|---|
| `public/index.html` | Semantic shell, navigation, accessible dialog and live status region |
| `public/nabu.css` | Responsive visual system, desktop sidebar, mobile navigation, reduced-motion handling |
| `public/nabu-core.js` | Validation, language codes, identity, scheduling, sharing codec, imports/exports, statistics |
| `public/nabu-store.js` | IndexedDB transactions, revision checks, cache/history bounds, backup merges |
| `public/nabu-app.js` | UI state, rendering, event handling, translation adapter, social API client |
| `public/nabu-sw.js` | Versioned shell-only cache; no API or translation caching |
| `server.py` | Same-origin API, SQLite, sessions, exchange authorization, optional DeepL adapter |

The frontend is shipped as native ES modules. There is no CDN script dependency or frontend package install. Browser voices are used only when a suitable voice is installed. The interface never guarantees a voice is available for every selected language.

## Card and event contracts

```javascript
{
  id: "uuid",
  front: "prendre son temps",
  back: "to take one's time",
  sourceLang: "fr", targetLang: "en",
  context: "Tu peux prendre ton temps.",
  note: "Private note, not shared",
  deck: "Everyday", tags: ["conversation"],
  attribution: "",
  createdAt: 1793808000000,
  updatedAt: 1793808000000,
  revision: 0, archived: false,
  schedule: {
    algorithm: "nabu-srs-v1", state: "new", step: 0,
    due: 1793808000000, interval: 0, ease: 2.5,
    reps: 0, lapses: 0, lastReview: null
  }
}
```

All timestamps are epoch milliseconds in the frontend. Long review intervals use elapsed 24-hour days, not midnight cutovers. The daily introduction limit and practice streak use the local calendar date. A daylight-saving boundary can shift a due clock time; it does not reset the new-word accounting to UTC.

Deduplication key:

```text
source language + target language + normalized front + normalized back
```

Normalization is NFC + trimmed/collapsed whitespace + locale-independent lowercase. Context and collection are not part of identity. Distinct meanings can coexist; duplicate imports into another collection do not multiply learning items.

Every review event records `id`, `cardId`, `at`, `rating`, `before`, `afterRevision`, and `durationMs`. `before` makes guarded undo possible. The existing card and event are written in one read-write transaction. An editor or reviewer must present the revision they saw; otherwise the transaction fails without overwriting a newer state.

Undo restores content/scheduling from the prior state but increments the revision instead of rolling the revision backward. This prevents an old editor from accidentally becoming current after an undo.

## Transparent scheduling, not fake ML

For a graduated card with interval I and ease E, the three successful-recall candidates are:

```text
H = max(I + 1, ceil(1.2 I))
G = max(H + 1, ceil(I E))
A = max(G + 1, ceil(1.3 I E))
```

Hard uses H, Good uses G, and Easy uses A, each capped at 36,500 days. Ease changes by -0.15, 0, or +0.15 respectively, bounded to [1.3, 3.5]. Again reduces ease by 0.2, increments the lapse counter, and sets a 10-minute relearning step. After successful relearning, Good uses half the pre-lapse interval, rounded, with a one-day floor; Easy uses 0.8 times that interval with the same floor.

These are engineering defaults, not estimated parameters or proven optimal learning intervals. No recall-probability curve, proficiency score, or learning-gain improvement is claimed. The event log and explicit algorithm field make a later FSRS migration possible, but replay/migration and parameter fitting are not implemented in this release.

The queue is deterministic: due relearning, due learning, due review, then as many new cards as today's remaining introduction budget permits. A shared card never inherits the sender's memory state.

## Translation edge handling

Public translation is explicit, not keystroke telemetry. An epoch counter protects against a late response replacing newer input; aborting alone is not assumed sufficient. Per-request timeouts, UTF-8 byte-aware splitting, response validation, quota handling, and an editable fallback are implemented. Decoded provider strings are rendered as escaped text.

Local translation cache: at most approximately 200 entries, expiring after 30 days. Recent translation history: at most approximately 50 entries. Both can be removed without deleting saved cards. Cache/history retention is local to the browser, not a cloud analytics pipeline.

DeepL keys exist only on the optional server. The adapter has a fixed provider host, not a user-supplied arbitrary URL. It checks response shape and emits bounded, non-secret errors. No provider fallback silently sends text to another service.

## Two distinct exchange mechanisms

### Account-free links

Versioned UTF-8 JSON is base64url-encoded into `#share=`. The fragment is not an API query. The payload limit is 8,000 encoded characters. Decoding validates schema, supported languages, text sizes, and version. Base64 is not encryption or identity verification.

Allowed card fields: `front`, `back`, `sourceLang`, `targetLang`, `context`. The recipient reviews the content and chooses their collection; incoming cards enter a fresh schedule.

### Authenticated inbox

The server owns sender identity, uses exact recipient handles, and verifies recipient ownership for status changes. Each send has a client request UUID and a server-checked payload hash. The unique `(sender_id, request_id)` constraint prevents duplicate delivery, including competing requests. Reusing that key for different content is rejected.

Pending -> accepted/declined is a guarded state transition. Repeating the same decision is idempotent; reversing a completed decision is rejected. Block checks run at send time, and blocking hides the blocked sender's incoming messages. Lists show at most 200 recent exchanges; pending items are prioritized, and a recipient cannot accumulate more than 200 pending items.

The UI saves accepted content locally before marking the exchange accepted. Browser storage and SQLite are not one transaction. If the server update fails, the user is told that the word was saved but status needs retrying. Deduplication makes retry safe. This is not distributed exactly-once synchronization.

## Security and privacy controls included

Password hashes use salted PBKDF2-HMAC-SHA256 with 600,000 iterations. Session tokens are random, hashed in SQLite, HttpOnly, SameSite=Strict, and Secure on HTTPS. Sessions expire after seven days; at most ten recent sessions are retained per account. CSRF tokens and strict Origin checks protect authenticated mutations, and Origin checks also apply to login/registration. Mutating request bodies are bounded at 16 KB and must be JSON.

SQLite uses parameterized statements, foreign keys, WAL, and bounded busy waits. Rate-limit counters are stored transactionally rather than only in process memory. Registration, login, sending, blocking, account deletion, and paid translation have separate limits. Credentials and exchange data are not stored in a service-worker cache. Only `public/` is served as static content.

These controls have tests but are not a security audit. Public abuse response, automated account recovery, logging/alerting policy, consent/legal text, deployment monitoring, and backup/recovery operations remain owner responsibilities before public release.

## Versioning and deployment

The IndexedDB database is `nabu-translate-remember`, schema version 1. It deliberately does not guess at or rewrite a legacy Nabu schema. Full JSON backups are tagged with `app: nabu` and version 1. Unknown versions/algorithms are rejected rather than misinterpreted.

The service-worker shell cache name is versioned. Bump it on every frontend release. It does not force activation midway through an open app, so a page does not mix old and new module versions. Existing tabs must close/reopen to activate a pending update. Never implement an automatic `Clear-Site-Data` reset as an update strategy: it would destroy the local library.

## What this release does not claim

No production deployment was made. No existing repository was patched. No model was fine-tuned. No enterprise efficacy claim is made. No AnkiWeb/cloud library sync is implemented. No public-feed infrastructure is implied by the Exchange screen. Full browser navigation was blocked in the build environment; test scope and provider limitations are disclosed in `TEST_REPORT.md`.
