"""Optional Nabu private-beta backend: accounts, word exchange, and a server-held translator key.
Run: python server.py. The app and API MUST share one origin. See README.md before public use.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ROOT = Path(__file__).resolve().parent
LANGUAGES = {'en', 'ar', 'zh-CN', 'fr', 'ru', 'es', 'de', 'it', 'ja', 'ko', 'pt', 'tr'}
COOKIE = 'nabu_session'
SESSION_SECONDS = 7 * 86400
ITERATIONS = 600_000
SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS exchanges (
 id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 card_json TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
 created_at INTEGER NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 UNIQUE(sender_id,request_id), CHECK(sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS exchange_recipient ON exchanges(recipient_id,created_at DESC);
CREATE INDEX IF NOT EXISTS exchange_sender ON exchanges(sender_id,created_at DESC);
CREATE TABLE IF NOT EXISTS blocks (
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(owner_id,blocked_id), CHECK(owner_id <> blocked_id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
 bucket TEXT NOT NULL, subject TEXT NOT NULL, used INTEGER NOT NULL,
 expires INTEGER NOT NULL, PRIMARY KEY(bucket,subject)
);
PRAGMA user_version=1;
"""


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, ITERATIONS)
    return f'pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}'


def password_matches(password: str, stored: str) -> bool:
    try:
        name, iterations, salt, expected = stored.split('$')
        count = int(iterations)
        if name != 'pbkdf2_sha256' or count != ITERATIONS:
            return False
        digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), count)
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


def clean(value: str) -> str:
    value = value.strip()
    if re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', value):
        raise ValueError('Unsupported control characters.')
    return value


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Credentials(Model):
    handle: str = Field(min_length=3, max_length=24, pattern=r'^[A-Za-z0-9_]+$')
    password: str = Field(min_length=1, max_length=128)
    invite: str = Field(default='', max_length=128)

    @field_validator('handle')
    @classmethod
    def normalize_handle(cls, value: str) -> str:
        return value.lower()


class Word(Model):
    front: str = Field(min_length=1, max_length=1000)
    back: str = Field(min_length=1, max_length=1000)
    sourceLang: str
    targetLang: str
    context: str = Field(default='', max_length=1500)

    @field_validator('front', 'back', 'context')
    @classmethod
    def clean_text(cls, value: str) -> str:
        return clean(value)

    @model_validator(mode='after')
    def valid_word(self):
        if not self.front or not self.back:
            raise ValueError('Word and meaning cannot be blank.')
        if self.sourceLang not in LANGUAGES or self.targetLang not in LANGUAGES:
            raise ValueError('Unsupported language.')
        if self.sourceLang == self.targetLang:
            raise ValueError('Choose different languages.')
        return self


class Exchange(Model):
    recipient: str = Field(min_length=3, max_length=24, pattern=r'^[A-Za-z0-9_]+$')
    card: Word
    message: str = Field(default='', max_length=280)
    requestId: uuid.UUID

    @field_validator('recipient')
    @classmethod
    def normalize_handle(cls, value: str) -> str:
        return value.lower()

    @field_validator('message')
    @classmethod
    def clean_message(cls, value: str) -> str:
        return clean(value)


class Decision(Model):
    status: Literal['accepted', 'declined']


class Handle(Model):
    handle: str = Field(min_length=3, max_length=24, pattern=r'^[A-Za-z0-9_]+$')


class DeleteAccount(Model):
    password: str = Field(min_length=1, max_length=128)


class Translation(Model):
    text: str = Field(min_length=1, max_length=2000)
    sourceLang: str
    targetLang: str

    @model_validator(mode='after')
    def valid(self):
        self.text = clean(self.text)
        if not self.text or self.sourceLang not in LANGUAGES or self.targetLang not in LANGUAGES or self.sourceLang == self.targetLang:
            raise ValueError('Choose nonempty text and two supported, different languages.')
        return self


class GuardMiddleware:
    """Same-origin mutations, bounded request bodies, no API caching, and browser security headers."""
    def __init__(self, app, origin: str):
        self.app = app
        self.origin = origin
        # The standalone pages carry exact script/style hashes. A conflicting
        # header would block those scripts even when the HTML meta permits them.
        self.page_policies = {}
        for name in ('index.html', 'nabu-repair.html'):
            page = (ROOT / 'public' / name).read_text()
            match = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)">', page)
            if not match:
                raise RuntimeError('Missing CSP in ' + name + '; rebuild with tools/build_standalone.py')
            self.page_policies[name] = (match.group(1) + "; frame-ancestors 'none'").encode('ascii')

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        api = scope['path'].startswith('/api/')
        headers = dict(scope.get('headers', []))
        mutation = scope['method'] in {'POST', 'PATCH', 'DELETE', 'PUT'}

        async def secure_send(message):
            if message['type'] == 'http.response.start':
                values = list(message.get('headers', []))
                values += [(b'x-content-type-options', b'nosniff'), (b'referrer-policy', b'no-referrer'),
                           (b'x-frame-options', b'DENY'), (b'permissions-policy', b'camera=(), microphone=(), geolocation=()')]
                if api:
                    values += [(b'cache-control', b'no-store')]
                else:
                    page_name = 'nabu-repair.html' if scope['path'] == '/nabu-repair.html' else 'index.html'
                    values += [(b'content-security-policy', self.page_policies[page_name])]
                    if scope['path'] in ('/', '/index.html', '/nabu-repair.html', '/nabu-sw.js'):
                        values += [(b'cache-control', b'no-cache')]
                if self.origin.startswith('https://'):
                    values += [(b'strict-transport-security', b'max-age=31536000')]
                message['headers'] = values
            await send(message)

        async def reject(code: int, detail: str):
            await JSONResponse({'detail': detail}, status_code=code)(scope, receive, secure_send)

        if api and mutation:
            origin = headers.get(b'origin', b'').decode('latin-1')
            if origin != self.origin:
                return await reject(403, 'Request origin is not allowed. Open Nabu at its configured address.')
            if headers.get(b'content-type', b'').split(b';')[0].strip().lower() != b'application/json':
                return await reject(415, 'Send a JSON request.')
            length = headers.get(b'content-length', b'0')
            if not length.isdigit() or int(length) > 16384:
                return await reject(413, 'Request is too large.')
            chunks, total = [], 0
            while True:
                message = await receive()
                if message['type'] == 'http.disconnect':
                    return
                chunk = message.get('body', b'')
                total += len(chunk)
                if total > 16384:
                    return await reject(413, 'Request is too large.')
                chunks.append(chunk)
                if not message.get('more_body', False):
                    break
            replayed = False

            async def bounded_receive():
                nonlocal replayed
                if not replayed:
                    replayed = True
                    return {'type': 'http.request', 'body': b''.join(chunks), 'more_body': False}
                return await receive()

            return await self.app(scope, bounded_receive, secure_send)
        return await self.app(scope, receive, secure_send)


def create_app(database: str | Path | None = None, origin: str | None = None,
               invite: str | None = None, translation_key: str | None = None) -> FastAPI:
    db_path = Path(database or os.environ.get('NABU_DB', ROOT / '.data' / 'nabu.sqlite3'))
    origin = (origin or os.environ.get('NABU_ORIGIN', 'http://127.0.0.1:8000')).rstrip('/')
    parsed = urlparse(origin)
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise RuntimeError('NABU_ORIGIN must be one complete origin, such as https://nabu.example.com (no path).')
    if parsed.scheme != 'https' and parsed.hostname not in {'127.0.0.1', 'localhost', '::1', 'testserver'}:
        raise RuntimeError('Non-local deployments require an HTTPS NABU_ORIGIN.')
    invite = os.environ.get('NABU_INVITE_CODE', '') if invite is None else invite
    if parsed.hostname not in {'127.0.0.1', 'localhost', '::1', 'testserver'} and not invite:
        raise RuntimeError('Set NABU_INVITE_CODE before exposing this private-beta server.')
    translation_key = os.environ.get('DEEPL_API_KEY', '') if translation_key is None else translation_key
    daily_char_limit = int(os.environ.get('NABU_TRANSLATION_DAILY_CHARS', '50000'))
    if daily_char_limit < 1:
        raise RuntimeError('NABU_TRANSLATION_DAILY_CHARS must be positive.')
    dummy_hash = password_hash('a-nonexistent-user-password')

    @contextmanager
    def connection():
        conn = sqlite3.connect(db_path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA busy_timeout=10000')
        try:
            yield conn
        finally:
            conn.close()

    @asynccontextmanager
    async def lifespan(app):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with connection() as conn:
            version = conn.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1):
                raise RuntimeError('Unsupported database version. Back up the database before upgrading.')
            conn.executescript(SCHEMA)
        yield

    app = FastAPI(title='Nabu word exchange', version='1.0.0', lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(GuardMiddleware, origin=origin)
    app.state.db_path = db_path

    def rate(bucket: str, subject: str, maximum: int, window: int, weight: int = 1):
        now = int(time.time())
        with connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            conn.execute('DELETE FROM rate_limits WHERE expires <= ?', (now,))
            row = conn.execute('SELECT used,expires FROM rate_limits WHERE bucket=? AND subject=?', (bucket, subject)).fetchone()
            if row and row['used'] + weight > maximum:
                conn.rollback()
                raise HTTPException(429, 'Too many requests. Take a break and try again later.', headers={'Retry-After': str(max(1, row['expires'] - now))})
            if not row and weight > maximum:
                conn.rollback()
                raise HTTPException(429, 'This request exceeds the configured usage limit.')
            if row:
                conn.execute('UPDATE rate_limits SET used=used+? WHERE bucket=? AND subject=?', (weight, bucket, subject))
            else:
                conn.execute('INSERT INTO rate_limits VALUES(?,?,?,?)', (bucket, subject, weight, now + window))
            conn.commit()

    def ip_key(request: Request) -> str:
        # Forwarded headers are not trusted by the provided uvicorn launch command.
        return hashlib.sha256((request.client.host if request.client else 'unknown').encode()).hexdigest()

    def session_for(request: Request):
        token = request.cookies.get(COOKIE, '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token):
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with connection() as conn:
            return conn.execute('SELECT s.*,u.handle FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?', (digest, int(time.time()))).fetchone()

    def authenticated(request: Request):
        session = session_for(request)
        if not session:
            raise HTTPException(401, 'Sign in to your word exchange first.')
        if request.method not in {'GET', 'HEAD'}:
            supplied = request.headers.get('x-csrf-token', '')
            if not hmac.compare_digest(supplied, session['csrf']):
                raise HTTPException(403, 'Your session changed. Reload Nabu and try again.')
        return session

    def issue_session(conn, user_id, handle, response: Response):
        now = int(time.time())
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode()).hexdigest()
        conn.execute('DELETE FROM sessions WHERE expires<=?', (now,))
        conn.execute('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 9)', (user_id, user_id))
        conn.execute('INSERT INTO sessions VALUES(?,?,?,?,?)', (digest, user_id, csrf, now, now + SESSION_SECONDS))
        response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
                            secure=origin.startswith('https://'), samesite='strict', path='/')
        return {'user': {'handle': handle}, 'csrf': csrf}

    @app.get('/api/config')
    def config():
        return {'service': 'nabu', 'version': 1, 'inviteRequired': bool(invite),
                'translationEnabled': bool(translation_key), 'librarySync': False}

    @app.get('/api/session')
    def session(request: Request):
        row = session_for(request)
        return {'user': {'handle': row['handle']} if row else None, 'csrf': row['csrf'] if row else ''}

    @app.post('/api/register', status_code=201)
    def register(data: Credentials, request: Request, response: Response):
        rate('register-ip', ip_key(request), 5, 3600)
        rate('register-global', 'all', 100, 86400)
        if invite and not hmac.compare_digest(data.invite, invite):
            raise HTTPException(403, 'A valid beta invitation code is required.')
        if len(data.password) < 12:
            raise HTTPException(422, 'Choose a password of at least 12 characters.')
        hashed = password_hash(data.password)
        with connection() as conn:
            try:
                conn.execute('BEGIN IMMEDIATE')
                user_id = str(uuid.uuid4())
                conn.execute('INSERT INTO users VALUES(?,?,?,?)', (user_id, data.handle, hashed, int(time.time())))
                result = issue_session(conn, user_id, data.handle, response)
                conn.commit()
                return result
            except sqlite3.IntegrityError:
                conn.rollback()
                raise HTTPException(409, 'That handle is already taken.')

    @app.post('/api/login')
    def login(data: Credentials, request: Request, response: Response):
        rate('login-ip', ip_key(request), 30, 900)
        rate('login-handle', data.handle, 12, 900)
        with connection() as conn:
            user = conn.execute('SELECT * FROM users WHERE handle=?', (data.handle,)).fetchone()
            matched = password_matches(data.password, user['password_hash'] if user else dummy_hash)
            if not user or not matched:
                raise HTTPException(401, 'The handle or password is incorrect.')
            conn.execute('BEGIN IMMEDIATE')
            result = issue_session(conn, user['id'], user['handle'], response)
            conn.commit()
            return result

    @app.post('/api/logout')
    def logout(response: Response, user=Depends(authenticated)):
        with connection() as conn:
            conn.execute('DELETE FROM sessions WHERE token_hash=?', (user['token_hash'],))
        response.delete_cookie(COOKIE, path='/', secure=origin.startswith('https://'), httponly=True, samesite='strict')
        return {'ok': True}

    def exchange_output(row):
        return {'id': row['id'], 'sender': row['sender'], 'recipient': row['recipient'],
                'card': json.loads(row['card_json']), 'message': row['message'],
                'status': row['status'], 'createdAt': row['created_at'] * 1000}

    @app.get('/api/exchanges')
    def exchanges(user=Depends(authenticated)):
        with connection() as conn:
            query = 'SELECT e.*,s.handle sender,r.handle recipient FROM exchanges e JOIN users s ON s.id=e.sender_id JOIN users r ON r.id=e.recipient_id '
            inbox = conn.execute(query + "WHERE e.recipient_id=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.owner_id=? AND b.blocked_id=e.sender_id) ORDER BY (e.status='pending') DESC,e.created_at DESC,e.id DESC LIMIT 200", (user['user_id'], user['user_id'])).fetchall()
            sent = conn.execute(query + 'WHERE e.sender_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 200', (user['user_id'],)).fetchall()
            return {'inbox': [exchange_output(r) for r in inbox], 'sent': [exchange_output(r) for r in sent]}

    @app.post('/api/exchanges', status_code=201)
    def send_word(data: Exchange, user=Depends(authenticated)):
        content_hash = hashlib.sha256(json.dumps({'recipient': data.recipient, 'message': data.message, 'card': data.card.model_dump()}, sort_keys=True).encode()).hexdigest()
        with connection() as conn:
            existing = conn.execute('SELECT * FROM exchanges WHERE sender_id=? AND request_id=?', (user['user_id'], str(data.requestId))).fetchone()
            if existing:
                if existing['request_hash'] != content_hash:
                    raise HTTPException(409, 'That send request was already used for a different word.')
                return {'id': existing['id'], 'status': existing['status'], 'duplicate': True}
        rate('send-hour', user['user_id'], 30, 3600)
        rate('send-day', user['user_id'], 100, 86400)
        with connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            recipient = conn.execute('SELECT id FROM users WHERE handle=?', (data.recipient,)).fetchone()
            if not recipient:
                raise HTTPException(404, 'That recipient is unavailable. Check the exact handle.')
            if recipient['id'] == user['user_id']:
                raise HTTPException(400, 'Choose someone else to send this word to.')
            blocked = conn.execute('SELECT 1 FROM blocks WHERE (owner_id=? AND blocked_id=?) OR (owner_id=? AND blocked_id=?)', (recipient['id'], user['user_id'], user['user_id'], recipient['id'])).fetchone()
            if blocked:
                raise HTTPException(404, 'That recipient is unavailable. Check the exact handle.')
            count = conn.execute("SELECT COUNT(*) FROM exchanges WHERE recipient_id=? AND status='pending'", (recipient['id'],)).fetchone()[0]
            if count >= 200:
                raise HTTPException(429, "This recipient's inbox is full. Try again after they review some words.")
            exchange_id = str(uuid.uuid4())
            try:
                conn.execute('INSERT INTO exchanges(id,sender_id,recipient_id,card_json,message,created_at,request_id,request_hash) VALUES(?,?,?,?,?,?,?,?)',
                             (exchange_id, user['user_id'], recipient['id'], data.card.model_dump_json(), data.message, int(time.time()), str(data.requestId), content_hash))
                conn.commit()
            except sqlite3.IntegrityError:
                conn.rollback()
                existing = conn.execute('SELECT id,status,request_hash FROM exchanges WHERE sender_id=? AND request_id=?', (user['user_id'], str(data.requestId))).fetchone()
                if existing and existing['request_hash'] == content_hash:
                    return {'id': existing['id'], 'status': existing['status'], 'duplicate': True}
                raise HTTPException(409, 'This send request could not be applied. Refresh and try again.')
        return {'id': exchange_id, 'status': 'pending', 'duplicate': False}

    @app.patch('/api/exchanges/{exchange_id}')
    def decide(exchange_id: uuid.UUID, data: Decision, user=Depends(authenticated)):
        with connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT status FROM exchanges WHERE id=? AND recipient_id=?', (str(exchange_id), user['user_id'])).fetchone()
            if not row:
                raise HTTPException(404, 'This exchange was not found in your inbox.')
            if row['status'] != 'pending' and row['status'] != data.status:
                raise HTTPException(409, 'This word has already been accepted or declined.')
            conn.execute('UPDATE exchanges SET status=? WHERE id=? AND recipient_id=?', (data.status, str(exchange_id), user['user_id']))
            conn.commit()
        return {'id': str(exchange_id), 'status': data.status}

    @app.get('/api/blocks')
    def blocks(user=Depends(authenticated)):
        with connection() as conn:
            rows = conn.execute('SELECT u.handle FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.owner_id=? ORDER BY u.handle', (user['user_id'],)).fetchall()
            return {'blocks': [r['handle'] for r in rows]}

    @app.post('/api/blocks')
    def block(data: Handle, user=Depends(authenticated)):
        rate('block', user['user_id'], 40, 3600)
        with connection() as conn:
            target = conn.execute('SELECT id FROM users WHERE handle=?', (data.handle.lower(),)).fetchone()
            if not target:
                raise HTTPException(404, 'This account was not found.')
            if target['id'] == user['user_id']:
                raise HTTPException(400, 'You cannot block your own account.')
            conn.execute('INSERT OR IGNORE INTO blocks VALUES(?,?)', (user['user_id'], target['id']))
        return {'ok': True}

    @app.delete('/api/blocks/{handle}')
    def unblock(handle: str, user=Depends(authenticated)):
        with connection() as conn:
            conn.execute('DELETE FROM blocks WHERE owner_id=? AND blocked_id IN(SELECT id FROM users WHERE handle=?)', (user['user_id'], handle.lower()))
        return {'ok': True}

    @app.delete('/api/account')
    def delete_account(data: DeleteAccount, response: Response, user=Depends(authenticated)):
        rate('delete-account', user['user_id'], 5, 3600)
        with connection() as conn:
            account = conn.execute('SELECT password_hash FROM users WHERE id=?', (user['user_id'],)).fetchone()
            if not account or not password_matches(data.password, account['password_hash']):
                raise HTTPException(403, 'The password is incorrect.')
            conn.execute('DELETE FROM users WHERE id=?', (user['user_id'],))
        response.delete_cookie(COOKIE, path='/', secure=origin.startswith('https://'), httponly=True, samesite='strict')
        return {'ok': True}

    def deepl(data: Translation):
        endpoint = 'https://api-free.deepl.com/v2/translate' if translation_key.endswith(':fx') else 'https://api.deepl.com/v2/translate'
        source = data.sourceLang.upper().split('-')[0]
        target = data.targetLang.upper().split('-')[0]
        try:
            result = httpx.post(endpoint, headers={'Authorization': f'DeepL-Auth-Key {translation_key}'},
                                json={'text': [data.text], 'source_lang': source, 'target_lang': target}, timeout=15)
            if result.status_code in {429, 456}:
                raise HTTPException(429, 'The workspace translation quota or rate limit was reached.')
            if result.status_code in {401, 403}:
                raise HTTPException(503, 'The workspace translation key needs attention. Contact the server owner.')
            if result.status_code != 200:
                raise HTTPException(502, 'The workspace translation service could not translate that request.')
            value = result.json()['translations'][0]['text']
            if not isinstance(value, str) or not value.strip() or len(value) > 10000:
                raise ValueError('Unexpected translation')
            return value
        except HTTPException:
            raise
        except (httpx.HTTPError, KeyError, ValueError, IndexError, TypeError):
            raise HTTPException(502, 'The workspace translator is temporarily unavailable. Try again later.')

    app.state.translate = deepl

    @app.post('/api/translate')
    def translate(data: Translation, user=Depends(authenticated)):
        if not translation_key:
            raise HTTPException(503, 'The server owner has not configured DEEPL_API_KEY.')
        rate('translate-hour', user['user_id'], 60, 3600)
        rate('translate-user-chars', user['user_id'], 20000, 86400, len(data.text))
        rate('translate-global-chars', 'all', daily_char_limit, 86400, len(data.text))
        return {'translation': app.state.translate(data), 'provider': 'DeepL'}

    # Only public/ is exposed. Database, source, tests, and environment files are not served.
    app.mount('/', StaticFiles(directory=ROOT / 'public', html=True), name='public')
    return app


app = create_app()

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host=os.environ.get('NABU_HOST', '127.0.0.1'),
                port=int(os.environ.get('PORT', '8000')), proxy_headers=False)
