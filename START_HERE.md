# Start here

**For your existing GitHub Pages site:** upload the nine files from `nabu-pages.zip` to the folder that contains the published `index.html`. No npm install, build, or API key is required for the static version. Translation still depends on the public service being reachable and within quota.

**For real @handle accounts and an inbox:** use `nabu-full-source.zip`, install `requirements.txt`, run `python server.py`, and open `http://127.0.0.1:8000`. The server and frontend must share an origin. Detailed deployment and privacy notes are in `README.md`.

**What changes visibly:** Translate, Library, Review, Exchange, and Settings/data screens. Mobile navigation, editable flashcards, reverse cards, review keyboard shortcuts, link previews, duplicates, imports, backups, and honest empty/error states are included.

**What is not claimed:** no automatic GitHub deployment; no access to your unseen legacy repo; no trained model; no AnkiWeb or cross-device sync; no live-provider guarantee. `TEST_REPORT.md` distinguishes passing domain/API/UI checks from blocked full-browser verification.

Back up the existing site and any old browser-stored library before replacing its entry page. This app uses a separate local database and does not automatically migrate legacy Nabu data.
