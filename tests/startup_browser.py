"""Browser checks of the EXACT standalone HTML and its CSP. No network navigation.
Chromium policy blocks all URLs in this runtime. Successful boot uses a minimal
IndexedDB request fixture, NOT a claim about real persistent storage. The denied
storage case uses the browser's real storage implementation on about:blank.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
import json,re,base64,hashlib
root=Path(__file__).resolve().parents[1]
html=(root/'public/index.html').read_text()
out=root/'startup-test-results';out.mkdir(exist_ok=True)
results=[]
def check(name,condition=True):
 assert condition,name
 results.append(name);print('PASS',name,flush=True)
# This fixture substitutes ONLY IndexedDB's asynchronous request boundary.
# Core, store adapter, runtime, markup, CSS and CSP remain the shipping artifact.
fixture=r'''(() => {
 const records = {cards:[],logs:[],history:[],meta:[]};
 if (window.seedExisting) records.cards.push({id:'existing-word',front:'bonjour',back:'hello',sourceLang:'fr',targetLang:'en',context:'',note:'private note',deck:'My words',tags:[],attribution:'',createdAt:1,updatedAt:1,revision:0,archived:false,schedule:{algorithm:'nabu-srs-v1',state:'new',step:0,due:1,interval:0,ease:2.5,reps:0,lapses:0,lastReview:null}});
 function request(result) { const r={result};setTimeout(()=>r.onsuccess&&r.onsuccess(),0);return r; }
 const database={close(){},transaction(names){return {objectStore(name){return {get(id){return request(records[name].find(x=>x.id===id));},getAll(){return request(records[name].slice());}};}};}};
 Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){const r={result:database};if(!window.hangStorage)setTimeout(()=>r.onsuccess&&r.onsuccess(),0);return r;},deleteDatabase(){throw Error('Database deletion is forbidden in this test');}}});
})()'''
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 # Test 1: exact CSP + unmodified full bundle + actual denied browser storage.
 page=b.new_page(viewport={'width':1440,'height':1000})
 errors=[];console=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda m:console.append(m.text))
 page.set_content(html)
 expect(page.locator('#startup-error')).to_be_visible(timeout=15000)
 check('Real denied storage produces an actionable error, not an endless loader')
 check('Repair control exists on storage failure',page.locator('a[href="./nabu-repair.html"]').count()==1)
 check('Actual standalone scripts execute under the exact CSP hashes',not any('violates the following Content Security Policy' in x for x in console))
 check('No uncaught parse or top-level error in the standalone bundle',not errors)
 page.screenshot(path=str(out/'storage-error-desktop.png'),full_page=True)
 page.close()
 # Test 2: healthy request interface with compiled storage module (not mock DB).
 page=b.new_page(viewport={'width':1440,'height':1050})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.evaluate(fixture)
 page.set_content(html)
 expect(page.locator('#translation-input')).to_be_visible()
 check('Standalone HTML boots with no external JS or CSS dependencies')
 check('Independent guard records readiness',page.evaluate('window.__nabuReady === true'))
 check('Startup helper disappears after successful render',page.locator('.startup-help').count()==0)
 check('No remote script elements',page.locator('script[src]').count()==0)
 page.screenshot(path=str(out/'fixed-desktop.png'),full_page=True)
 page.set_viewport_size({'width':390,'height':844})
 page.screenshot(path=str(out/'fixed-mobile.png'),full_page=True)
 check('Mobile layout has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
 # Navigation uses native URL/history, so about:blank cannot be used to pretend
 # this is a genuine hosted-navigation test. Initial views use a URL fixture.
 page.close()
 # Existing database contents flow through the actual compiled store adapter.
 page=b.new_page()
 page.evaluate('window.seedExisting=true')
 page.evaluate(fixture)
 page.set_content(html)
 expect(page.locator('#translation-input')).to_be_visible()
 check('Existing stored card is retained and counted for review',page.locator('#navigation [data-view="review"] .badge').inner_text()=='1')
 page.close()
 # Optional API constructor may throw in privacy-restricted environments.
 page=b.new_page();page.evaluate(fixture)
 page.evaluate("() => { window.BroadcastChannel=class {constructor(){throw new DOMException('Blocked','SecurityError')}}; }")
 page.set_content(html)
 expect(page.locator('#translation-input')).to_be_visible()
 check('Blocked BroadcastChannel does not prevent startup')
 page.close()
 # Real storage timeout path from the compiled adapter.
 page=b.new_page();page.evaluate('window.hangStorage=true');page.evaluate(fixture)
 page.set_content(html)
 expect(page.locator('#startup-error')).to_contain_text('not responding',timeout=11000)
 check('Nonresponding database becomes a clear error within the open timeout')
 page.close()
 # Inline parse error is caught by the separate guard, not just boot().
 # The CSP hashes are adjusted only to authorize the intentional broken fixture.
 broken='const intentionallyBroken = ;'
 orig=re.search(r'<script id="nabu-application">(.*?)</script>',html,re.S).group(1)
 def sig(x): return 'sha256-'+base64.b64encode(hashlib.sha256(x.encode()).digest()).decode()
 bad=html.replace(orig,broken).replace(sig(orig),sig(broken))
 page=b.new_page();page.set_content(bad)
 expect(page.locator('#startup-error')).to_be_visible()
 check('Guard reports a top-level application syntax failure')
 page.close()
 # Module/bundle absent: the guard's global watchdog still reports failure.
 absent=html.replace(orig,'')
 page=b.new_page();page.clock.install();page.set_content(absent)
 page.clock.fast_forward(12500)
 expect(page.locator('#startup-error')).to_contain_text('Startup took too long')
 check('Guard handles an absent or blocked application bundle')
 b.close()
(out/'bundle-browser-results.json').write_text(json.dumps({'checks':results,'count':len(results),'scope':'Real exact HTML/CSP rendering; in-memory IndexedDB request fixture for healthy startup; real denied storage on about:blank. No hosted-navigation or persistence claim.'},indent=2))
print('TOTAL',len(results))
