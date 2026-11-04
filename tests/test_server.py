from __future__ import annotations
import json
import sqlite3
import sys
import uuid
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import create_app, password_hash, password_matches

PASSWORD = 'Correct horse! lamp 42'
WORD = {'front': 'bonjour', 'back': 'hello', 'sourceLang': 'fr', 'targetLang': 'en', 'context': 'Bonjour, mon ami.'}

@pytest.fixture
def env(tmp_path):
    app = create_app(tmp_path / 'test.sqlite3', 'http://testserver', invite='', translation_key='')
    with TestClient(app, headers={'Origin': 'http://testserver'}) as client:
        yield app, client

def register(client, name='alice'):
    result = client.post('/api/register', json={'handle':name, 'password':PASSWORD})
    assert result.status_code == 201, result.text
    client.headers['X-CSRF-Token'] = result.json()['csrf']
    return result

def two_users(env):
    app, alice = env
    register(alice, 'alice')
    bob = TestClient(app, headers={'Origin':'http://testserver'})
    register(bob, 'bob')
    return app, alice, bob

def send(alice, **changes):
    body = {'recipient':'bob','card':WORD,'message':'A useful greeting','requestId':str(uuid.uuid4())}
    body.update(changes)
    return alice.post('/api/exchanges',json=body)

def test_public_config_contains_no_secrets(env):
    app,client=env
    data=client.get('/api/config').json()
    assert data['service']=='nabu'
    assert data['librarySync'] is False
    assert not data['translationEnabled']
    assert 'key' not in json.dumps(data).lower()

def test_no_anonymous_inbox(env):
    assert env[1].get('/api/exchanges').status_code==401

def test_registration_sets_protected_cookie_and_hashed_password(env):
    app,client=env
    result=register(client)
    cookie=result.headers['set-cookie']
    assert 'HttpOnly' in cookie and 'SameSite=strict' in cookie
    with sqlite3.connect(app.state.db_path) as conn:
        stored=conn.execute('SELECT password_hash FROM users').fetchone()[0]
        assert PASSWORD not in stored and stored.startswith('pbkdf2_sha256$600000$')
        raw_token=client.cookies.get('nabu_session')
        token_hash=conn.execute('SELECT token_hash FROM sessions').fetchone()[0]
        assert token_hash != raw_token
    assert client.get('/api/session').json()['user']['handle']=='alice'

def test_duplicate_handles_case_insensitive(env):
    _,client=env
    register(client)
    assert client.post('/api/register',json={'handle':'ALICE','password':PASSWORD}).status_code==409

def test_password_minimum(env):
    assert env[1].post('/api/register',json={'handle':'alice','password':'short'}).status_code==422

def test_login_rotates_session_and_handles_bad_password(env):
    _,client=env
    register(client)
    old=client.cookies.get('nabu_session')
    result=client.post('/api/login',json={'handle':'alice','password':PASSWORD})
    assert result.status_code==200 and client.cookies.get('nabu_session')!=old
    assert client.post('/api/login',json={'handle':'alice','password':'wrong'}).status_code==401
    assert client.post('/api/login',json={'handle':'no_such_person','password':'wrong'}).status_code==401

def test_origin_required_and_cross_origin_rejected(env):
    _,client=env
    body={'handle':'alice','password':PASSWORD}
    assert client.post('/api/register',json=body,headers={'Origin':'https://evil.example'}).status_code==403
    client.headers.pop('Origin')
    assert client.post('/api/register',json=body).status_code==403

def test_csrf_required_for_authenticated_mutations(env):
    _,client=env
    register(client)
    client.headers.pop('X-CSRF-Token')
    assert client.post('/api/logout',json={}).status_code==403

def test_non_json_and_oversized_body_rejected(env):
    _,client=env
    assert client.post('/api/register',content='a=b',headers={'Content-Type':'application/x-www-form-urlencoded'}).status_code==415
    assert client.post('/api/register',content='x'*17000,headers={'Content-Type':'application/json'}).status_code==413

def test_send_delivers_only_to_recipient(env):
    app,alice,bob=two_users(env)
    result=send(alice)
    assert result.status_code==201, result.text
    assert len(alice.get('/api/exchanges').json()['inbox'])==0
    inbox=bob.get('/api/exchanges').json()['inbox']
    assert len(inbox)==1 and inbox[0]['sender']=='alice'
    assert inbox[0]['card']==WORD
    assert inbox[0]['status']=='pending'
    assert len(alice.get('/api/exchanges').json()['sent'])==1

def test_send_idempotency(env):
    _,alice,bob=two_users(env)
    request_id=str(uuid.uuid4())
    first=send(alice,requestId=request_id)
    second=send(alice,requestId=request_id)
    assert first.json()['id']==second.json()['id']
    assert second.json()['duplicate']
    assert len(bob.get('/api/exchanges').json()['inbox'])==1
    assert send(alice,requestId=request_id,message='different').status_code==409

def test_recipient_exclusive_decision_authority(env):
    _,alice,bob=two_users(env)
    item=send(alice).json()['id']
    assert alice.patch(f'/api/exchanges/{item}',json={'status':'accepted'}).status_code==404
    assert bob.patch(f'/api/exchanges/{item}',json={'status':'accepted'}).status_code==200
    assert bob.patch(f'/api/exchanges/{item}',json={'status':'accepted'}).status_code==200
    assert bob.patch(f'/api/exchanges/{item}',json={'status':'declined'}).status_code==409

def test_unknown_sender_identity_cannot_be_injected(env):
    _,alice,bob=two_users(env)
    assert send(alice,sender='admin').status_code==422

def test_private_note_and_scheduler_never_accepted_as_shared_content(env):
    _,alice,bob=two_users(env)
    assert send(alice,card={**WORD,'note':'private'}).status_code==422
    assert send(alice,card={**WORD,'schedule':{'reps':99}}).status_code==422

def test_blocking_prevents_delivery_and_hides_previous_inbox(env):
    _,alice,bob=two_users(env)
    send(alice)
    assert bob.post('/api/blocks',json={'handle':'alice'}).status_code==200
    assert bob.get('/api/blocks').json()['blocks']==['alice']
    assert bob.get('/api/exchanges').json()['inbox']==[]
    assert send(alice).status_code==404
    assert bob.request('DELETE','/api/blocks/alice',json={}).status_code==200
    assert send(alice).status_code==201

def test_self_send_missing_handle_and_invalid_content(env):
    _,client=env
    register(client)
    assert send(client,recipient='alice').status_code==400
    assert send(client,recipient='missing').status_code==404
    assert send(client,card={**WORD,'front':'   '}).status_code==422
    assert send(client,card={**WORD,'targetLang':'fr'}).status_code==422

def test_logout_revokes_session(env):
    _,client=env
    register(client)
    old=client.cookies.get('nabu_session')
    assert client.post('/api/logout',json={}).status_code==200
    client.cookies.set('nabu_session',old)
    assert client.get('/api/exchanges').status_code==401

def test_account_delete_removes_sessions_and_exchanges_not_other_user(env):
    app,alice,bob=two_users(env)
    send(alice)
    assert alice.request('DELETE','/api/account',json={'password':'wrong'}).status_code==403
    assert alice.request('DELETE','/api/account',json={'password':PASSWORD}).status_code==200
    assert alice.get('/api/exchanges').status_code==401
    assert bob.get('/api/exchanges').json()['inbox']==[]
    assert bob.get('/api/session').json()['user']['handle']=='bob'

def test_auth_rate_limit(env):
    _,client=env
    register(client)
    for _ in range(12): assert client.post('/api/login',json={'handle':'alice','password':'bad'}).status_code==401
    response=client.post('/api/login',json={'handle':'alice','password':'bad'})
    assert response.status_code==429 and 'retry-after' in response.headers

def test_static_source_and_db_are_not_public(env):
    _,client=env
    assert client.get('/').status_code==200
    for path in ['/server.py','/.env','/.data/nabu.sqlite3','/requirements.txt']:
        assert client.get(path).status_code==404
    assert 'no-store' in client.get('/api/config').headers['cache-control']
    assert client.get('/').headers['x-frame-options']=='DENY'

def test_workspace_translation_requires_configuration(env):
    _,client=env
    register(client)
    result=client.post('/api/translate',json={'text':'hello','sourceLang':'en','targetLang':'fr'})
    assert result.status_code==503

def test_workspace_translation_adapter_and_privacy(tmp_path):
    app=create_app(tmp_path/'translation.sqlite3','http://testserver',invite='',translation_key='test-secret')
    calls=[]
    app.state.translate=lambda data:(calls.append(data.model_dump()) or 'bonjour')
    with TestClient(app,headers={'Origin':'http://testserver'}) as client:
        register(client)
        result=client.post('/api/translate',json={'text':'hello','sourceLang':'en','targetLang':'fr'})
        assert result.json()['translation']=='bonjour'
        assert calls==[{'text':'hello','sourceLang':'en','targetLang':'fr'}]
        assert 'test-secret' not in client.get('/api/config').text

def test_beta_invite_enforcement(tmp_path):
    app=create_app(tmp_path/'invite.sqlite3','http://testserver',invite='only-friends',translation_key='')
    with TestClient(app,headers={'Origin':'http://testserver'}) as client:
        assert client.post('/api/register',json={'handle':'alice','password':PASSWORD}).status_code==403
        assert client.post('/api/register',json={'handle':'alice','password':PASSWORD,'invite':'only-friends'}).status_code==201

def test_https_and_invitation_are_required_outside_localhost(tmp_path):
    with pytest.raises(RuntimeError,match='HTTPS'):
        create_app(tmp_path/'a.sqlite3','http://example.com',invite='yes')
    with pytest.raises(RuntimeError,match='INVITE'):
        create_app(tmp_path/'b.sqlite3','https://example.com',invite='')

def test_password_hashes_are_salted_and_verified():
    a=password_hash(PASSWORD);b=password_hash(PASSWORD)
    assert a!=b
    assert password_matches(PASSWORD,a)
    assert not password_matches('wrong',a)
    assert not password_matches(PASSWORD,'broken')

@pytest.mark.parametrize('path',['/','/nabu-repair.html'])
def test_standalone_page_hashes_match_server_policy(env,path):
    import re,hashlib,base64
    response=env[1].get(path)
    assert response.status_code==200
    policy=response.headers['content-security-policy']
    assert "'unsafe-inline'" not in policy
    for source in re.findall(r'<(?:script|style)[^>]*>(.*?)</(?:script|style)>',response.text,re.S):
        digest=base64.b64encode(hashlib.sha256(source.encode()).digest()).decode()
        assert "'sha256-"+digest+"'" in policy
    assert response.headers['cache-control']=='no-cache'

def test_worker_file_revalidates_instead_of_pinning_old_release(env):
    response=env[1].get('/nabu-sw.js')
    assert response.status_code==200
    assert response.headers['cache-control']=='no-cache'
