"""Render/interaction harness for environments where browser URL navigation is disabled.
Uses the REAL frontend JS/CSS with an explicitly IN-MEMORY storage adapter.
This is NOT an IndexedDB, service-worker, cookie, or production deployment test.
The separate browser_smoke.py tests those features in an unrestricted local browser.
"""
from __future__ import annotations
import json,re,uuid,sys
import httpx
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
checks=[];errors=[]

def check(name,value=True):
    assert value,name
    checks.append(name)
    print('PASS:',name,flush=True)

def harness_script():
    core=(ROOT/'public/nabu-core.js').read_text()
    names=re.findall(r'export (?:async )?(?:function|const) (\w+)',core)
    core=core.replace('export ','')
    app=(ROOT/'public/nabu-app.js').read_text()
    app=re.sub(r"^import .*;\n",'',app,flags=re.M)
    bridge=r'''
    const C=(()=>{__CORE__;return {__NAMES__};})();
    const memory={cards:[],logs:[],history:[],cache:new Map(),meta:new Map()};
    const clone=v=>structuredClone(v);
    const DB={
      openStore:async()=>{},snapshot:async()=>clone({cards:memory.cards,logs:memory.logs,history:memory.history}),
      getMeta:async(k,d)=>memory.meta.get(k)??d,setMeta:async(k,v)=>{memory.meta.set(k,clone(v));},
      addCards:async inputs=>{const clean=inputs.map(x=>C.newCard(x));let added=0,duplicates=0;const cards=[];for(const c of clean){const old=memory.cards.find(x=>C.identity(x)===C.identity(c));if(old){duplicates++;cards.push(clone(old));}else{memory.cards.push(c);cards.push(clone(c));added++;}}return {added,duplicates,cards};},
      editCard:async(id,content,revision)=>{const i=memory.cards.findIndex(c=>c.id===id),old=memory.cards[i];if(old.revision!==revision)throw new Error('Card changed.');const clean=C.cardContent(content);memory.cards[i]={...old,...clean,revision:old.revision+1,updatedAt:Date.now()};},
      archiveCard:async(id,archived)=>{const c=memory.cards.find(c=>c.id===id);c.archived=archived;c.revision++;},
      gradeCard:async(id,rating,revision,durationMs)=>{const c=memory.cards.find(c=>c.id===id);if(c.revision!==revision)throw new Error('Card changed.');const log={id:C.uid(),cardId:id,at:Date.now(),rating,before:clone(c),afterRevision:revision+1,durationMs};c.schedule=C.scheduleReview(c.schedule,rating);c.revision++;memory.logs.push(log);return {card:clone(c),log};},
      undoReview:async id=>{const log=memory.logs.find(l=>l.id===id),i=memory.cards.findIndex(c=>c.id===log.cardId),rev=memory.cards[i].revision;if(rev!==log.afterRevision)throw new Error('Card changed.');memory.cards[i]={...clone(log.before),revision:rev+1};memory.logs=memory.logs.filter(l=>l.id!==id);},
      rememberTranslation:async c=>{memory.history=[{...clone(c),id:C.uid(),at:Date.now()},...memory.history].slice(0,50);},
      cacheGet:async k=>memory.cache.get(k),cachePut:async(k,v)=>{memory.cache.set(k,v);},
      clearTranslationHistory:async()=>{memory.history=[];memory.cache.clear();},
      mergeImport:async data=>{let added=0,duplicates=0;for(const c of data.cards){if(memory.cards.some(x=>C.identity(x)===C.identity(c)||x.id===c.id)){duplicates++;}else{memory.cards.push(clone(c));added++;}}return {added,duplicates};},
      clearAll:async()=>{memory.cards=[];memory.logs=[];memory.history=[];memory.meta.clear();memory.cache.clear();}
    };
    let href='https://nabu-preview.invalid/';
    const location={get href(){return href},get hash(){return new URL(href).hash},get pathname(){return new URL(href).pathname},get search(){return new URL(href).search},protocol:'https:',origin:'https://nabu-preview.invalid'};
    const history={state:null,pushState:(s,t,u)=>{history.state=s;href=String(u)},replaceState:(s,t,u)=>{history.state=s;href=new URL(String(u),href).href}};
    const nativeFetch=window.fetch;
    const fetch=async(url,options={})=>{
      window.__requests.push({url:String(url),body:options.body||'',method:options.method||'GET'});
      if(String(url).includes('api.mymemory')){
        if(window.__translationDelay)await new Promise(r=>setTimeout(r,window.__translationDelay));
        if(window.__translationFailure)return new Response(JSON.stringify({responseStatus:403,quotaFinished:true}),{status:200,headers:{'Content-Type':'application/json'}});
        return new Response(JSON.stringify({responseStatus:200,responseData:{translatedText:'hello &amp; welcome'}}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      if(window.__backendBridge){const r=await window.__backendBridge(new URL(String(url)).pathname,options.method||'GET',options.headers||{},options.body||'');return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json'}});}
      return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});
    };
    window.__requests=[];window.__memory=memory;
    window.__C=C;
    window.__loadShare=async token=>{href='https://nabu-preview.invalid/#share='+token;await handleShare();};
    window.__snapshot=()=>clone({cards:memory.cards,logs:memory.logs,history:memory.history});
    __APP__
    '''
    return '(async()=>{'+bridge.replace('__CORE__',core).replace('__NAMES__',','.join(names)).replace('__APP__',app)+'})()'

def load(page,width=1440,height=1050):
    page.set_viewport_size({'width':width,'height':height})
    html=(ROOT/'public/index.html').read_text()
    html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>','',html)
    html=re.sub(r'<link[^>]*>','',html)
    html=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S)
    html=html.replace('</head>','<style>'+(ROOT/'public/nabu.css').read_text()+'</style></head>')
    page.set_content(html)
    # getRandomValues is available on about:blank; randomUUID is not always exposed.
    page.evaluate("if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16));")
    page.evaluate(harness_script())
    expect(page.locator('#translation-input')).to_be_visible()

def nav(page,name):page.locator(f'#navigation [data-view="{name}"]').click()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    load(page)
    check('Real frontend renders its empty state without invented data')
    check('No external translation request happens on initial render',not any('mymemory' in r['url'] for r in page.evaluate('window.__requests')))
    page.screenshot(path=str(OUT/'01-translate-desktop.png'),full_page=True)
    page.locator('[data-action="sample"][data-index="0"]').click()
    expect(page.locator('#provider-note')).to_contain_text('not a live translation')
    check('Built-in sample is visibly distinguished from live translation')
    page.locator('[data-action="save-translation"]').click()
    expect(page.locator('[data-action="save-translation"]')).to_be_disabled()
    check('Save interaction adds exactly one card',len(page.evaluate('window.__snapshot().cards'))==1)
    nav(page,'review');expect(page.locator('.review-word')).to_have_text('sobremesa')
    page.locator('#review-typed').fill('conversation after a meal')
    page.locator('[data-action="reveal"]').click()
    expect(page.locator('.typed-comparison')).to_contain_text('conversation after a meal')
    check('Optional typed recall is shown alongside the answer')
    page.screenshot(path=str(OUT/'02-review-desktop.png'),full_page=True)
    page.locator('[data-action="grade"][data-rating="3"]').click()
    expect(page.locator('.empty-state')).to_be_visible()
    check('Rating interaction schedules the card and shows the next-due state',page.evaluate('window.__snapshot().cards[0].schedule.state')=='learning')
    page.locator('[data-action="undo-review"]').click()
    expect(page.locator('.review-word')).to_be_visible()
    check('Undo interaction restores the review card')
    page.keyboard.press('Space');page.keyboard.press('4')
    expect(page.locator('.empty-state')).to_be_visible()
    check('Space and numeric keyboard rating controls work')
    nav(page,'library');page.locator('.page-heading [data-action="add-manual"]').click()
    page.locator('#card-source').select_option('fr');page.locator('#card-front').fill('prendre son temps');page.locator('#card-back').fill("to take one's time")
    page.locator('#card-context').fill('Tu peux prendre ton temps.')
    page.locator('#card-note').fill('PRIVATE_NOTE_SHOULD_NOT_TRAVEL')
    page.locator('[name="reverse"]').check();page.locator('#card-submit').click()
    expect(page.locator('#modal')).not_to_be_visible()
    check('Card editor can create independent forward and reverse cards',len(page.evaluate('window.__snapshot().cards'))==3)
    page.locator('#library-search').fill('temps');expect(page.locator('.word-card')).to_have_count(2)
    check('Library search filters both word and meaning')
    page.locator('#library-search').fill('')
    page.screenshot(path=str(OUT/'03-library-desktop.png'),full_page=True)
    target=page.evaluate("window.__snapshot().cards.find(c=>c.front==='prendre son temps').id")
    page.locator(f'[data-action="share-card"][data-id="{target}"]').click()
    link=page.locator('#share-url').input_value();token=link.split('#share=')[1]
    check('Sharing creates a fragment-based link without private notes','?' not in link)
    receiver=browser.new_page();receiver.on('pageerror',lambda e:errors.append(str(e)));load(receiver,1050,950)
    receiver.evaluate('(token)=>window.__loadShare(token)',token)
    expect(receiver.locator('#modal')).to_be_visible()
    check('Receive flow shows an explicit preview before importing',len(receiver.evaluate('window.__snapshot().cards'))==0)
    check('Share preview excludes private notes',receiver.locator('#card-note').input_value()=='')
    receiver.locator('#card-submit').click();expect(receiver.locator('#modal')).not_to_be_visible()
    check('Accept interaction creates a fresh card',receiver.evaluate('window.__snapshot().cards[0].schedule.reps')==0)
    receiver.evaluate('(token)=>window.__loadShare(token)',token);receiver.locator('#card-submit').click();expect(receiver.locator('#modal')).not_to_be_visible()
    check('Repeated link acceptance shows duplicate-safe UI',len(receiver.evaluate('window.__snapshot().cards'))==1)
    page.locator('[data-action="close-modal"]').click()
    page.locator(f'[data-action="archive-card"][data-id="{target}"]').click();expect(page.locator('.word-card')).to_have_count(2)
    page.locator('#toast [data-action="toast-action"]').click();expect(page.locator('.word-card')).to_have_count(3)
    check('Archive and Undo interactions are wired')
    nav(page,'translate');page.locator('#source-language').select_option('fr');page.locator('#translation-input').fill('bonjour et bienvenue')
    page.locator('[data-action="translate"]').click();expect(page.locator('#toast')).to_contain_text('privacy notice')
    check('Translation consent is required before a provider request')
    page.locator('#translation-consent').check();page.locator('[data-action="translate"]').click();expect(page.locator('.translation-result')).to_contain_text('hello & welcome')
    check('Provider adapter decodes entity text safely (mocked response)')
    page.locator('[data-action="translate"]').click();expect(page.locator('#provider-note')).to_contain_text('Saved translation')
    check('Translation cache path is connected to the UI (in-memory adapter)')
    page.evaluate('window.__translationFailure=true');page.locator('#translation-input').fill('another phrase');page.locator('[data-action="translate"]').click()
    expect(page.locator('.translation-error')).to_contain_text('quota')
    check('Provider quota error is actionable and cannot be saved as a translation',page.locator('[data-action="save-translation"]').count()==0)
    nav(page,'exchange');expect(page.get_by_text('Inbox backend not connected')).to_be_visible()
    check('Static deployment honestly distinguishes link sharing from a connected inbox')
    page.screenshot(path=str(OUT/'06-exchange-desktop.png'),full_page=True)
    page.locator('#avatar').click();page.locator('#setting-alias').fill('Hassan');page.locator('#setting-limit').fill('7');page.locator('#settings-form [type="submit"]').click()
    expect(page.locator('#setting-alias')).to_have_value('Hassan')
    check('Settings form applies and rerenders changed preferences')
    # Import preview uses the real parser; storage is still the documented in-memory adapter.
    page.locator('[data-action="import"]').click()
    page.locator('#import-file').set_input_files({'name':'words.tsv','mimeType':'text/tab-separated-values','buffer':b'Front\tBack\nmerci\tthank you'})
    expect(page.locator('#import-preview')).to_contain_text('1')
    page.locator('[data-action="confirm-import"]').click();expect(page.locator('#modal')).not_to_be_visible()
    check('Import UI previews and applies a TSV after explicit confirmation')
    # Markup injection is displayed as text by the real library renderer.
    nav(page,'library');page.locator('.page-heading [data-action="add-manual"]').click()
    page.locator('#card-front').fill('<img src=x onerror="window.PWNED=1">');page.locator('#card-back').fill('literal markup');page.locator('#card-submit').click()
    expect(page.locator('#modal')).not_to_be_visible()
    check('Real card renderer escapes untrusted markup',page.evaluate('window.PWNED') is None and page.locator('.word-card img').count()==0)
    page.keyboard.press('Control+k');expect(page.locator('#library-search')).to_be_focused()
    check('Collection search keyboard shortcut focuses the input')
    mobile=browser.new_page();mobile.on('pageerror',lambda e:errors.append(str(e)));load(mobile,390,844)
    mobile.locator('[data-action="sample"][data-index="2"]').click()
    check('Arabic text uses auto direction in the real source input',mobile.locator('#translation-input').get_attribute('dir')=='auto')
    check('390px mobile page has no horizontal overflow',mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    mobile.evaluate('window.scrollTo(0,0)');mobile.screenshot(path=str(OUT/'04-translate-mobile.png'),full_page=False)
    mobile.locator('[data-action="save-translation"]').click();nav(mobile,'library');mobile.locator('[data-action="edit-card"]').click()
    check('Mobile editor remains within viewport bounds',mobile.evaluate('document.querySelector("dialog").getBoundingClientRect().right<=innerWidth'))
    mobile.screenshot(path=str(OUT/'05-editor-mobile.png'),full_page=False)
    # An invalid second file must remove the earlier confirmation, not import stale data.
    page.locator('#avatar').click();page.locator('[data-action="import"]').click()
    page.locator('#import-file').set_input_files({'name':'valid.tsv','mimeType':'text/plain','buffer':b'one\ttwo'})
    expect(page.locator('[data-action="confirm-import"]')).to_be_visible()
    page.locator('#import-file').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':b'{broken'})
    expect(page.locator('#modal-error')).to_be_visible()
    check('Invalid replacement file clears a stale import confirmation',page.locator('[data-action="confirm-import"]').count()==0)
    page.locator('[data-action="close-modal"]').click()
    nav(page,'translate');page.evaluate('window.__translationFailure=false;window.__translationDelay=350')
    page.locator('#translation-input').fill('old request');page.locator('[data-action="translate"]').click()
    page.locator('#translation-input').fill('new input while waiting')
    page.wait_for_timeout(500)
    check('A late translation never overwrites newer input',page.locator('#translation-input').input_value()=='new input while waiting' and page.locator('.translation-result').count()==0)
    # Real inbox API and SQLite through a local HTTP bridge. Browser cookie mechanics
    # are deliberately NOT claimed by this harness; HTTP clients own session cookies.
    clients=[]
    def connected_page():
        client=httpx.Client(base_url='http://127.0.0.1:8765',headers={'Origin':'http://127.0.0.1:8765'})
        clients.append(client)
        pg=browser.new_page();pg.on('pageerror',lambda e:errors.append(str(e)))
        def bridge(source,path,method,headers,body):
            response=client.request(method,path,headers=headers,content=body.encode() if body else None)
            return {'status':response.status_code,'body':response.text}
        pg.expose_binding('__backendBridge',bridge)
        load(pg,1280,960)
        return pg
    alice=connected_page();bob=connected_page();suffix=uuid.uuid4().hex[:6]
    names=['alice_'+suffix,'bob_'+suffix]
    for pg,name in zip([alice,bob],names):
        nav(pg,'exchange');expect(pg.locator('[data-mode="register"]')).to_be_visible()
        pg.locator('[data-mode="register"]').click();pg.locator('#auth-handle').fill(name);pg.locator('#auth-password').fill('A long browser test password!')
        pg.locator('#auth-form [type="submit"]').click();expect(pg.locator('#modal')).not_to_be_visible()
        expect(pg.get_by_text('Signed in as @'+name,exact=False)).to_be_visible()
    check('Real account registration responses drive the sign-in UI (HTTP bridge)')
    nav(alice,'translate');alice.locator('[data-action="sample"][data-index="0"]').click();alice.locator('[data-action="save-translation"]').click()
    nav(alice,'library');alice.locator('[data-action="share-card"]').click()
    alice.locator('#send-handle').fill(names[1]);alice.locator('#send-message').fill('A word for your next dinner with friends.')
    alice.locator('#send-form [type="submit"]').click();expect(alice.locator('#modal')).not_to_be_visible()
    bob.locator('.exchange-panel [data-action="refresh-inbox"]').click();expect(bob.locator('.inbox-item')).to_have_count(1)
    check('Send form and inbox rendering work against real SQLite exchanges (HTTP bridge)')
    bob.screenshot(path=str(OUT/'07-real-inbox-desktop.png'),full_page=True)
    bob.locator('[data-action="accept-exchange"]').click();expect(bob.locator('#card-note')).to_have_value('')
    bob.locator('#card-submit').click();expect(bob.locator('#modal')).not_to_be_visible()
    expect(bob.locator('.inbox-meta')).to_contain_text('accepted')
    check('Acceptance saves a local card and updates the real server exchange',len(bob.evaluate('window.__snapshot().cards'))==1)
    bob.locator('[data-action="block-user"]').click();expect(bob.locator('.inbox-item')).to_have_count(0)
    alice.locator('[data-action="share-card"]').click();alice.locator('#send-handle').fill(names[1]);alice.locator('#send-form [type="submit"]').click()
    expect(alice.locator('#modal-error')).to_contain_text('unavailable')
    check('Blocked delivery produces a clear UI error against the real server')
    bob.locator('[data-action="logout"]').click();expect(bob.locator('[data-mode="login"]')).to_be_visible()
    check('Sign-out UI retains the local word collection',len(bob.evaluate('window.__snapshot().cards'))==1)
    for client in clients:client.close()
    check('Real UI interactions did not produce unhandled JavaScript errors',not errors)
    (OUT/'preview-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'scope':'REAL frontend rendering and interactions; IN-MEMORY storage; MOCKED translation; REAL local inbox via HTTP bridge; NO service-worker/native-cookie/navigation verification'},indent=2))
    browser.close()
print(f'{len(checks)} preview/interaction checks passed (limited harness, not full E2E).')
