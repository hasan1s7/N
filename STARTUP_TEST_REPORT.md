# Startup repair validation

Build: `nabu-startup-20261104-r2`.

| Check | Result | What actually ran |
| --- | ---: | --- |
| Existing domain suite | 46 passed | Real core functions: scheduling, validation, imports/exports, links, statistics |
| Startup / repair / worker unit suite | 18 passed | Actual store, worker and repair code against explicit request/cache/browser-API fixtures |
| Exact standalone HTML browser checks | 14 passed | Chromium executes the generated HTML, embedded runtime, styles and exact CSP hashes |
| API suite including CSP regression checks | 28 passed | Real FastAPI TestClient, temporary SQLite and response headers |
| Live GitHub Pages navigation | Not verified | Website was inaccessible from the tools; the GitHub file read returned 404 |
| Real hosted IndexedDB / offline-worker lifecycle | Blocked | Chromium normal navigation returns ERR_BLOCKED_BY_ADMINISTRATOR before page load |

Do not combine these numbers into a claim of production end-to-end coverage.

## New coverage

The standalone entry page has no external JavaScript or stylesheet dependency. Its actual inline scripts execute under the actual SHA-256 policy. Syntax failure, an absent application bundle, denied storage, a nonresponding database, and a throwing BroadcastChannel constructor all receive explicit handling. Healthy startup and an existing saved-card fixture reach the real translator UI through the actual compiled storage adapter.

The browser's denied-storage test uses real IndexedDB access on about:blank, where storage is unavailable. Healthy-startup tests substitute only a small asynchronous IndexedDB request interface. They do not prove disk persistence, browser-restart retention, concurrent transactions or cross-browser support. Screenshots show the actual generated UI in this isolated test, not the user's deployed site.

Storage unit checks confirm the original database name/version, one in-flight open request, blocked-upgrade rejection, a bounded opening timeout, closing late connections, retry after failure, and reopening after versionchange. No fallback library or database deletion is introduced.

Worker unit checks cover install build matching, network-first navigation, cached offline fallback, exclusion of repair/API/other paths, and app-path-specific cache cleanup. Repair unit checks confirm exact-scope unregistration, cache filtering, and navigation back to the app. These are VM simulations, not a real registered service worker lifecycle.

Server tests verify the generated index and repair scripts/styles are authorized by the HTTP CSP as well as the HTML meta policy. HTML and the worker are revalidated rather than pinned by a long-lived server cache header.

## Reproduction

```bash
node --test tests/core.test.mjs tests/startup.test.mjs
python -m pytest tests/test_server.py -q
python tests/startup_browser.py
```

`tests/browser_smoke.py` remains available for a browser environment that permits hosted navigation. Its full origin-based checks have not been newly certified here. Existing baseline test reports/screenshots are historical and are not evidence that this patch was deployed.

The full source contains raw logs in `startup-test-results/`. The Pages patch includes only the three deployable files.
