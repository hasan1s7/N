# Nabu MVP validation report

Build date: 2026-11-04.

## Results

| Check group | Result | Scope |
|---|---:|---|
| Pure JavaScript/domain tests | 46 passed | Actual scheduler, validation, UTF-8 chunking, import/export, link codec, statistics |
| Python API/security tests | 25 passed | Actual FastAPI routes and temporary SQLite databases |
| Frontend render/interaction checks | 36 passed | Actual UI code/CSS; in-memory storage; mocked translation; real local inbox through an HTTP bridge |
| Complete origin-based browser suite | BLOCKED | Browser navigation returned ERR_BLOCKED_BY_ADMINISTRATOR before the app loaded |
| Live public translation request | NOT VERIFIED | Network/browser restrictions prevented a live service check |
| Live DeepL translation | NOT VERIFIED | No real provider key supplied; adapter checked with a controlled implementation |
| GitHub deployment | NOT PERFORMED | Existing repository was not accessible through the connection |

**Do not read these numbers as 107 production end-to-end tests.** The groups have different scopes. The frontend harness substitutes an in-memory adapter for IndexedDB and an HTTP bridge for browser-origin requests. It does not verify persistence across browser restarts, service-worker lifecycle/offline reloads, actual browser cookie behavior, or real third-party CORS/network responses.

## Actual domain coverage

Schema limits; mandatory fields; supported language pairs; NFC/case/whitespace identity; meaningful polysemy; reverse-card independence; four-button learning intervals; graduation; lapses and relearning; monotonic review intervals; immutable scheduler inputs; interval/ease bounds; archived/future exclusions; queue priority; distinct daily introductions; overdue reviews outside new-card caps; honest empty statistics; local calendar dates; UTF-8 splitting including Arabic, Chinese, and emoji; versioned share payloads; exclusion of private fields; tampered links; HTML escaping; quoted CSV fields; hashtag content within quoted fields; malformed import failure; Anki TSV round trips; schedule/history backup restore; unsupported algorithms/versions; quoted TSV and tags.

## Actual backend coverage

No anonymous inbox; no secret exposure in config; salted password hashes; hashed server session tokens; cookie flags; case-insensitive handle uniqueness; password length; login and session rotation; generic bad-login errors; Origin/CSRF rejection; content-type and body limits; recipient-specific delivery; send idempotency; exclusive recipient decision authority; blocked forged sender fields and private payload fields; block/unblock; no self-send; logout revocation; account deletion cascades; rate limiting; static-file boundary; configured/unconfigured translation; invite enforcement; HTTPS requirement outside localhost.

## UI coverage with explicit substitutions

The real frontend rendered without invented statistics. User interactions exercised samples, saving, review reveal and typing, rating, undo, keyboard shortcuts, manual/reverse editing, search, share previews, duplicate acceptance, archive/undo, consent, translation success/cache/quota failures, disabled-backend messaging, settings, TSV import, malicious markup display, mobile overflow, and Arabic direction handling.

Regression checks verified that invalid replacement import files remove an earlier import confirmation and that late translation responses do not overwrite newer input. Two local test accounts used the real SQLite server through an HTTP bridge to check registration-driven UI, direct send, inbox rendering, acceptance, blocking, and sign-out while retaining local words.

Screenshots in `test-results/` show this real frontend rendering. Sample words and temporary test handles are demonstration/test data, not a claimed user base or live deployment.

## Required release check on your actual site

Run `tests/browser_smoke.py` in a browser environment that allows local navigation. It covers real IndexedDB persistence, concurrent review rejection, transactional rollback, JSON restore, offline reload and review, native browser sessions, nested-path assets, and the full two-account inbox journey. Translation responses are still controlled in that suite; separately make a small real translation request after consent to verify provider availability/CORS on the published origin.

Validate Safari/iOS and Firefox separately. Neither was available for a cross-browser pass here. Test real installed language voices rather than assuming browser speech availability.

## Reproduction

```bash
node --test tests/core.test.mjs
python -m pytest tests/test_server.py -q
# Start the two local test servers as described in README.md, then:
python tests/browser_smoke.py --chromium /path/to/chromium
```

For the restricted rendering harness, start the private test server at port 8765 with a fresh TEST database, then run `python tests/preview_harness.py`. Use a test database because the harness creates temporary test accounts and exchanges. The five-registrations-per-hour limit is intentionally real; repeated harness runs should use a fresh test database.
