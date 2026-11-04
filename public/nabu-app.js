import * as C from './nabu-core.js';
import * as DB from './nabu-store.js';
const $ = (selector, root=document) => root.querySelector(selector);
const E = C.escapeHTML;
const paths = {
 translate:'M4 5h12M10 3v2M6 5c0 6 5 10 10 11M14 5c0 5-4 10-10 12M14 21l4-10 4 10M15.5 17h5',
 library:'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3-1 4 15-3 1z',
 review:'M20 8a8 8 0 1 0 0 8M20 3v5h-5M12 7v5l3 2',
 exchange:'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
 settings:'M9 4h6l1 3 3 1 1 6-3 2-1 3H9l-1-3-3-1-1-6 3-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 arrow:'M4 12h16m-5-5 5 5-5 5', plus:'M12 5v14M5 12h14', check:'m5 12 4 4L19 6',
 copy:'M8 8h12v12H8zM16 8V4H4v12h4', speaker:'M11 5 6 9H3v6h3l5 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
 swap:'M3 8h17m-4-4 4 4-4 4M21 16H4m4-4-4 4 4 4',
 leaf:'M20 3c-9 0-16 3-16 11a6 6 0 0 0 6 6c8 0 10-8 10-17zM5 19 15 9',
 edit:'m15 4 5 5-11 11H4v-5zM13 6l5 5', share:'M16 6 8 10M8 14l8 4M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 archive:'M3 4h18v5H3zM5 9v11h14V9M9 13h6', search:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0M15 15l6 6',
 download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', upload:'M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4',
 close:'m6 6 12 12M18 6 6 18', clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',
 shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6',
 globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18',
 inbox:'M5 4h14l3 12v4H2v-4zM2 15h6l2 3h4l2-3h6', undo:'M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12',
 spark:'m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z',
 logout:'M9 4H4v16h5M13 8l5 4-5 4M8 12h10', lock:'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
 trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
 book:'M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1zM12 5v15'
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name] || paths.spark}"/></svg>`;
const DEFAULTS = {alias:'',sourceLang:'es',targetLang:'en',newLimit:10,consent:false,provider:'public'};
const state = {
 settings:{...DEFAULTS}, cards:[],logs:[],history:[], view:'translate',
 translation:{front:'',back:'',sourceLang:'es',targetLang:'en',context:'',note:'',provider:'',busy:false,error:''},
 filters:{q:'',lang:'',deck:'',status:'',sort:'recent'},
 review:{cardId:null,revealed:false,typed:'',startedAt:0,count:0,undo:null,deck:'',busy:false},
 backend:null,user:null,csrf:'',inbox:[],sent:[],blocks:[],exchangeTab:'inbox',exchangeError:'',
 shareCard:null,shareURL:'',importData:null,editorCard:null,editMode:false,receiving:null,
 toastAction:null,translationEpoch:0,abort:null,limit:60
};
let toastTimer, renderedReviewRevision, refreshTimer;
// Cross-tab notifications are optional; a privacy setting must not stop startup.
let channel = null;
try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('nabu-words-changed'); } catch (error) { console.warn('Cross-tab notifications unavailable.', error); }
const main = $('#main');
const modal = $('#modal');
const langOptions = selected => C.LANGUAGES.map(([code,name])=>`<option value="${code}"${code===selected?' selected':''}>${name}</option>`).join('');
const deckOptions = (selected='', all=true) => (all?'<option value="">All collections</option>':'')+[...new Set(state.cards.filter(c=>!c.archived).map(c=>c.deck))].sort().map(d=>`<option value="${E(d)}"${d===selected?' selected':''}>${E(d)}</option>`).join('');
const activeCards = () => state.cards.filter(c=>!c.archived);
const queue = () => C.dueCards(state.cards,state.logs,Date.now(),state.settings.newLimit).filter(c=>!state.review.deck || c.deck===state.review.deck);
const findCard = id => state.cards.find(c=>c.id===id);
const byId = id => $(`[data-card-id="${id}"]`);
const dueLabel = card => card.archived ? 'Archived' : card.schedule.state==='new' ? 'New word' : card.schedule.due<=Date.now() ? 'Ready to review' : `In ${C.intervalLabel(card.schedule.due-Date.now())}`;
function toast(message, actionLabel='', action=null, error=false) {
 const el=$('#toast');clearTimeout(toastTimer);state.toastAction=action;
 el.innerHTML=`<span>${E(message)}</span>${actionLabel?`<button data-action="toast-action">${E(actionLabel)}</button>`:''}`;
 el.className=`toast${error?' error':''}`;el.hidden=false;toastTimer=setTimeout(()=>{el.hidden=true;state.toastAction=null;},action?12000:6000);
}
function showError(error) {console.error(error);toast(error?.message || 'Something went wrong. Your existing words have not been removed.','',null,true);}
function modalError(message) {let el=$('#modal-error');if(!el){el=document.createElement('div');el.id='modal-error';el.className='error-banner';el.setAttribute('role','alert');$('#modal-body').prepend(el);}el.textContent=message;el.scrollIntoView({block:'nearest'});}
function showModal(title,body) {$('#modal-title').textContent=title;$('#modal-body').innerHTML=body;if(!modal.open)modal.showModal();}
function closeModal() {modal.close();state.receiving=null;}
function navigate(view, push=true) {
 if(!['translate','library','review','exchange','settings'].includes(view))view='translate';
 state.view=view;
 if(push){const u=new URL(location.href);u.searchParams.set('view',view);u.hash='';history.pushState({view},'',u);}
 if(view==='review' && !state.review.cardId)selectReview();
 render();main.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});
 if(view==='exchange' && state.user)refreshExchange().catch(e=>{state.exchangeError=e.message;if(state.view==='exchange')render();});
}
function renderNav() {
 const due=C.dueCards(state.cards,state.logs,Date.now(),state.settings.newLimit).length;
 $('#navigation').innerHTML=[['translate','Translate'],['library','Library'],['review','Review'],['exchange','Exchange']].map(([id,label])=>`<button class="nav-item${state.view===id?' active':''}" data-action="go" data-view="${id}"${state.view===id?' aria-current="page"':''}>${icon(id)}<span>${label}</span>${id==='review'&&due?`<span class="badge">${due}</span>`:id==='exchange'?'<span class="nav-new">WORDS TRAVEL</span>':''}</button>`).join('');
 $('#settings-nav').innerHTML=`${icon('settings')}<span>Settings & data</span>`;
 $('#settings-nav').classList.toggle('active',state.view==='settings');
 $('#avatar').textContent=(state.settings.alias || state.user?.handle || 'N')[0].toUpperCase();
 $('#connection').textContent=navigator.onLine ? state.user ? `@${state.user.handle}` : 'Local-first' : 'Offline';
 $('#connection').classList.toggle('offline',!navigator.onLine);
}
function render() {
 renderNav();
 main.innerHTML=({translate:renderTranslate,library:renderLibrary,review:renderReview,exchange:renderExchange,settings:renderSettings}[state.view])();
}
function pageHeading(kicker,title,description,actions='') {
 return `<div class="page-heading${state.view!=='translate'?' compact':''}"><div><div class="eyebrow">${E(kicker)}</div><h1>${title}</h1><p>${E(description)}</p></div>${actions}</div>`;
}
function renderTranslate() {
 const t=state.translation;
 return `${pageHeading('A LITTLE LANGUAGE, EVERY DAY','Find the words.<br>Keep the meaning.','Your translator, word collection, and daily practice. Finally, in one place.','<div class="heading-aside">Small discoveries. Lasting connections.</div>')}
 <div class="translate-layout"><div><section class="panel translator" aria-label="Translator">
 <div class="translator-languagebar"><div class="language-slot"><span class="lang-dot">${C.languageCode(t.sourceLang)}</span><label class="sr-only" for="source-language">Translate from</label><select id="source-language" class="language-select">${langOptions(t.sourceLang)}</select></div><button class="swap-button" data-action="swap" aria-label="Swap languages">${icon('swap')}</button><div class="language-slot"><label class="sr-only" for="target-language">Translate into</label><select id="target-language" class="language-select">${langOptions(t.targetLang)}</select><span class="lang-dot">${C.languageCode(t.targetLang)}</span></div></div>
 <div class="translation-panes"><div class="source-pane"><label class="pane-label" for="translation-input">WHAT'S ON YOUR MIND?</label><textarea id="translation-input" class="translation-input" dir="auto" lang="${t.sourceLang}" maxlength="2000" spellcheck="true" placeholder="A word. A phrase. A whole new way to say it.">${E(t.front)}</textarea><div class="pane-tools"><div class="result-tools"><button class="icon-button" data-action="speak-source" aria-label="Listen to source text">${icon('speaker')}</button><button class="icon-button" data-action="clear-translation" aria-label="Clear translation">${icon('close')}</button></div><span class="character-count" id="character-count">${t.front.length} / 2,000</span></div></div><div class="target-pane" id="translation-output" aria-live="polite">${renderOutput()}</div></div>
 <div class="translator-toolbar"><div class="provider-note" id="provider-note">${providerLabel()}</div><div class="button-row"><button class="button secondary" data-action="translate-selection" id="selection-button" hidden>Translate selection</button><button class="button primary" data-action="translate" id="translate-button"${t.busy?' disabled':''}>${t.busy?'Translating...':`Translate ${icon('arrow')}`}</button></div></div></section>
 <div class="privacy-note">${state.settings.provider==='workspace'?'<span>Workspace translation sends text to DeepL through your server. Never paste confidential information without approval.</span>':`<div class="consent-row"><input type="checkbox" id="translation-consent"${state.settings.consent?' checked':''}><label for="translation-consent">Allow translation with MyMemory. Text leaves this device when you press Translate; do not enter confidential information. Free-service limits apply.</label></div>`}</div>
 <div class="starter-row"><span>Try a word</span>${C.STARTERS.map((c,i)=>`<button class="starter-chip" data-action="sample" data-index="${i}" lang="${c.sourceLang}" dir="auto">${E(c.front)}</button>`).join('')}</div>
 <section class="recent-section"><div class="section-topline"><h2>Recently discovered</h2><span>Your last ${Math.min(state.history.length,5)} translations</span></div>${renderRecent()}</section></div>
 <aside class="translate-aside">${renderDaily()}<div class="exchange-teaser"><div class="exchange-marks" aria-hidden="true"><span class="word-tile">hola</span><span class="word-tile">hello</span>${icon('exchange')}</div><h3>Good words are<br>better shared.</h3><p>Send a little discovery.<br>Start a new conversation.</p><button class="text-button" data-action="go" data-view="exchange">Explore word exchange ${icon('arrow')}</button></div></aside></div>`;
}
function providerLabel(){const p=state.translation.provider;return `${icon(p==='Built-in example'?'book':'globe')}<span>${E(p || (state.settings.provider==='workspace'?'Workspace translator':'Translation, with room to grow'))}${p==='Built-in example'?' &middot; not a live translation':''}</span>`;}
function renderOutput() {
 const t=state.translation;
 if(t.busy)return `<div class="pane-label">FINDING THE MEANING</div><div class="translation-loading"><span class="spinner" aria-hidden="true"></span><span>Making a connection...</span></div>`;
 if(t.error)return `<div class="pane-label">LET'S TRY THAT AGAIN</div><div class="translation-error" role="alert">${E(t.error)}</div><div class="space-top"><button class="text-button" data-action="add-manual">Add a card manually ${icon('plus')}</button></div>`;
 if(!t.back)return `<div class="pane-label">THE MEANING</div><div class="placeholder-result">${icon('spark')}<p>Your next word<br>is waiting to be found.</p></div><div class="pane-tools"><span class="character-count">Translate. Save. Make it yours.</span></div>`;
 const saved=state.cards.find(c=>C.identity(c)===C.identity(t));
 return `<div class="pane-label">THE MEANING</div><div class="translation-result" dir="auto" lang="${t.targetLang}">${E(t.back)}</div><div class="pane-tools"><div class="result-tools"><button class="icon-button" data-action="speak-target" aria-label="Listen to translation">${icon('speaker')}</button><button class="icon-button" data-action="copy-translation" aria-label="Copy translation">${icon('copy')}</button><button class="icon-button" data-action="edit-translation" aria-label="Edit translation and card details">${icon('edit')}</button></div><button class="button ${saved?'soft':'primary'}" data-action="save-translation"${saved?' disabled':''}>${icon(saved?'check':'plus')}${saved?(saved.archived?'Archived':'Saved'):'Save word'}</button></div>`;
}
function updateOutput(){if(state.view!=='translate')return;$('#translation-output').innerHTML=renderOutput();$('#provider-note').innerHTML=providerLabel();const b=$('#translate-button');b.disabled=state.translation.busy;b.innerHTML=state.translation.busy?'Translating...':`Translate ${icon('arrow')}`;}
function renderRecent(){
 if(!state.history.length)return `<div class="recent-empty">${icon('book')}<span>A small collection starts with one word.<br>Translate something, or try a sample above.</span></div>`;
 return `<div class="recent-list">${state.history.slice(0,5).map((t,i)=>`<button class="recent-row" data-action="recent" data-index="${i}"><span class="lang-dot">${C.languageCode(t.sourceLang)}</span><span class="recent-word" dir="auto">${E(t.front)}</span>${icon('arrow')}<span class="recent-meaning" dir="auto">${E(t.back)}</span>${icon('plus')}</button>`).join('')}</div>`;
}
function renderDaily(){const s=C.statistics(state.cards,state.logs),due=C.dueCards(state.cards,state.logs,Date.now(),state.settings.newLimit).length;
 return `<section class="panel side-card"><div class="side-card-title"><span>Your daily rhythm</span>${icon('leaf')}</div><div class="daily-number">${due}<small>words ready</small></div><p class="daily-sub">${due?'A little practice goes a long way.':s.total?'All caught up. Let your words settle.':'A fresh start, one word at a time.'}</p><div class="week-bars" aria-label="Review activity over the last seven days">${s.week.map((d,i)=>`<div class="week-day" title="${d.day}: ${d.count} reviews"><span class="week-dot${d.count?' complete':''}${i===6?' today':''}"></span><span>${new Date(d.day+'T12:00:00').toLocaleDateString(undefined,{weekday:'narrow'})}</span></div>`).join('')}</div><button class="button ${due?'primary':'soft'} full-width" data-action="go" data-view="review">${due?'Start a little review':'Open your review space'} ${icon('arrow')}</button><div class="side-divider"></div><div class="side-stat"><span>Words in your collection</span><strong>${s.total}</strong></div><div class="side-stat"><span>Cards reviewed today</span><strong>${s.distinctToday}</strong></div><div class="side-stat no-margin"><span>Daily practice streak</span><strong>${s.streak} ${s.streak===1?'day':'days'}</strong></div></section>`;
}
function renderLibrary(){const total=activeCards().length,due=C.dueCards(state.cards,state.logs,Date.now(),state.settings.newLimit).length;
 return `${pageHeading('YOUR PERSONAL WORD COLLECTION','A little more yours.','Every word you save becomes something you can come back to.',`<div class="button-row"><button class="button secondary" data-action="import">${icon('upload')} Import</button><button class="button primary" data-action="add-manual">${icon('plus')} Add word</button></div>`)}
 <div class="stats-line"><span><strong>${total}</strong> saved words</span><span><strong>${due}</strong> ready to review</span><span><strong>${new Set(activeCards().map(c=>c.sourceLang)).size}</strong> languages</span></div>
 <div class="library-toolbar"><div class="search-field">${icon('search')}<label class="sr-only" for="library-search">Search words, meanings, and tags</label><input id="library-search" class="input" type="search" value="${E(state.filters.q)}" placeholder="Find a word, a meaning, a memory..."></div><label class="sr-only" for="filter-language">Filter language</label><select id="filter-language" class="select"><option value="">All languages</option>${langOptions(state.filters.lang)}</select><label class="sr-only" for="filter-deck">Filter collection</label><select id="filter-deck" class="select">${deckOptions(state.filters.deck)}</select><label class="sr-only" for="filter-status">Filter status</label><select id="filter-status" class="select">${[['','All words'],['due','Ready to review'],['new','New words'],['archived','Archived']].map(([v,l])=>`<option value="${v}"${state.filters.status===v?' selected':''}>${l}</option>`).join('')}</select><label class="sr-only" for="filter-sort">Sort cards</label><select id="filter-sort" class="select">${[['recent','Newest first'],['alphabetical','Alphabetical'],['due','Due first']].map(([v,l])=>`<option value="${v}"${state.filters.sort===v?' selected':''}>${l}</option>`).join('')}</select></div>
 <div id="library-results">${renderLibraryResults()}</div>`;
}
function filteredCards(){const f=state.filters;
 let cards=state.cards.filter(c=>(f.status==='archived'?c.archived:!c.archived)&&(!f.lang||c.sourceLang===f.lang)&&(!f.deck||c.deck===f.deck)&&(!f.q||C.searchText([c.front,c.back,c.context,c.deck,...c.tags].join(' ')).includes(C.searchText(f.q)))&&(f.status!=='due'||c.schedule.due<=Date.now())&&(f.status!=='new'||c.schedule.state==='new'));
 return cards.sort(f.sort==='alphabetical'?(a,b)=>a.front.localeCompare(b.front):f.sort==='due'?(a,b)=>a.schedule.due-b.schedule.due:(a,b)=>b.createdAt-a.createdAt);
}
function renderLibraryResults(){const cards=filteredCards();
 if(!cards.length)return `<div class="empty-state">${icon(state.cards.length?'search':'library')}<h2>${state.cards.length?'No words here. Yet.':'Your words belong here.'}</h2><p>${state.cards.length?'Try a different search or filter. Your other words are still in your library.':'Save a translation, add a word yourself, or bring a collection over from Anki.'}</p><div class="button-row">${state.cards.length?'<button class="button secondary" data-action="reset-filters">Clear filters</button>':'<button class="button primary" data-action="go" data-view="translate">Discover your first word</button><button class="button secondary" data-action="add-manual">Add one yourself</button>'}</div></div>`;
 return `<div class="section-topline"><span>${cards.length} ${cards.length===1?'word':'words'}${cards.length>state.limit?` &middot; showing ${state.limit}`:''}</span><button class="text-button" data-action="export-tsv">${icon('download')} Export to Anki</button></div><div class="word-grid">${cards.slice(0,state.limit).map(renderWordCard).join('')}</div>${cards.length>state.limit?'<div class="list-footer"><button class="button secondary" data-action="load-more">Show more words</button></div>':''}`;
}
function renderWordCard(c){return `<article class="panel word-card" data-card-id="${c.id}"><div class="word-card-top"><span class="lang-dot">${C.languageCode(c.sourceLang)}</span><span class="pill ${c.archived?'':c.schedule.state==='new'?'sand':c.schedule.due<=Date.now()?'green':''}">${dueLabel(c)}</span></div><div class="word-card-body"><h2 class="card-word" lang="${c.sourceLang}" dir="auto">${E(c.front)}</h2><p class="card-meaning" lang="${c.targetLang}" dir="auto">${E(c.back)}</p>${c.context?`<p class="card-context" dir="auto">${E(c.context)}</p>`:''}</div><div class="word-card-footer"><span class="card-deck" title="${E(c.deck)}">${E(c.deck)}</span><div class="card-actions"><button class="icon-button" data-action="speak-card" data-id="${c.id}" aria-label="Listen to ${E(c.front)}">${icon('speaker')}</button><button class="icon-button" data-action="edit-card" data-id="${c.id}" aria-label="Edit ${E(c.front)}">${icon('edit')}</button><button class="icon-button" data-action="share-card" data-id="${c.id}" aria-label="Share ${E(c.front)}">${icon('share')}</button><button class="icon-button" data-action="archive-card" data-id="${c.id}" aria-label="${c.archived?'Restore':'Archive'} ${E(c.front)}">${icon(c.archived?'undo':'archive')}</button></div></div></article>`;}
function selectReview(){const c=queue()[0];state.review.cardId=c?.id || null;state.review.revealed=false;state.review.typed='';state.review.startedAt=Date.now();renderedReviewRevision=c?.revision;}
function renderReview(){const r=state.review;let c=findCard(r.cardId);if(!c||c.archived){selectReview();c=findCard(r.cardId);}const qs=queue(), previewAt=Date.now();
 const header=pageHeading('SMALL PRACTICE. REAL PROGRESS.','Make the words stick.','Try to recall the meaning before you turn the card. Be honest with yourself.');
 if(!c){const future=activeCards().filter(c=>(!r.deck||c.deck===r.deck)&&c.schedule.state!=='new'&&c.schedule.due>Date.now()).sort((a,b)=>a.schedule.due-b.schedule.due)[0];const newRemaining=activeCards().filter(c=>c.schedule.state==='new').length;
 return `${header}<div class="review-wrap"><div class="review-topline"><label for="review-deck">Your practice space</label><select id="review-deck" class="select">${deckOptions(r.deck)}</select></div><div class="empty-state">${icon('leaf')}<h2>${r.count?'A little better than before.':activeCards().length?'You are right on time.':'A word is all it takes.'}</h2><p>${r.count?`${r.count} review${r.count===1?'':'s'} completed in this session. `:''}${!activeCards().length?'Save your first word, and your practice starts here.':future?`Your next scheduled word is ready in ${C.intervalLabel(future.schedule.due-Date.now())}.`:newRemaining?'You have reached today\'s new-word limit. You can change it in Settings.':'Nothing is due in this collection right now.'}</p><button class="button primary" data-action="go" data-view="translate">Discover another word ${icon('arrow')}</button></div>${r.undo?'<div class="review-footer"><button class="text-button" data-action="undo-review">Undo last review</button></div>':''}</div>`;
 }
 renderedReviewRevision=c.revision;
 return `${header}<div class="review-wrap"><div class="review-topline"><span><strong>${qs.length}</strong> ready &middot; ${r.count} reviewed this session</span><label class="sr-only" for="review-deck">Review collection</label><select id="review-deck" class="select">${deckOptions(r.deck)}</select></div><section class="panel review-card" aria-label="Review card"><div class="review-language"><span>${E(C.languageName(c.sourceLang))}</span>${icon('arrow')}<span>${E(C.languageName(c.targetLang))}</span></div><h2 class="review-word" lang="${c.sourceLang}" dir="auto">${E(c.front)}</h2>${c.context?`<p class="review-context" dir="auto">${E(c.context)}</p>`:''}<button class="icon-button" data-action="speak-review" aria-label="Listen to this word">${icon('speaker')}</button>${r.revealed?`<div class="review-answer" lang="${c.targetLang}" dir="auto">${E(c.back)}</div>${r.typed?`<p class="typed-comparison">You wrote: <span dir="auto">${E(r.typed)}</span></p>`:''}${c.note?`<p class="review-note" dir="auto">${E(c.note)}</p>`:''}<p class="review-key">How well did you remember?</p>`:`<label class="review-prompt" for="review-typed">Think it, say it, or type it below.</label><input class="input type-answer" id="review-typed" autocomplete="off" dir="auto" lang="${c.targetLang}" value="${E(r.typed)}" placeholder="Your answer (optional)"><button class="button primary review-reveal" data-action="reveal">Show meaning ${icon('arrow')}</button><span class="review-key">Space or Enter to reveal</span>`}</section>${r.revealed?`<div class="rating-row">${[[1,'Again','again'],[2,'Hard','hard'],[3,'Good','good'],[4,'Easy','easy']].map(([rating,label,cls])=>`<button class="rating-button ${cls}" data-action="grade" data-rating="${rating}"${r.busy?' disabled':''}><span>${label}</span><small>${C.intervalLabel(C.scheduleReview(c.schedule,rating,previewAt).due-previewAt)} &middot; ${rating}</small></button>`).join('')}</div>`:''}<div class="review-footer"><span>Scheduled for you &middot; not a test score</span><button class="text-button" data-action="undo-review"${r.undo?'':' disabled'}>${icon('undo')} Undo last review</button></div></div>`;
}
function renderExchange(){return `${pageHeading('LANGUAGE IS MEANT TO BE SHARED','Pass a word along.','A good word can be the beginning of a good conversation.')}
 <div class="exchange-layout"><section class="panel exchange-panel"><span class="pill green">${icon('check')} Link exchange is ready</span><div class="space-top"><h2>A small gift. A new word.</h2><p class="muted">Send a word from your collection. Your friend previews it, makes it their own, and learns it at their pace.</p></div><div class="feature-steps"><div class="feature-step"><span class="step-num">01</span><div><strong>Pick a word that stayed with you.</strong>Share the word, its meaning, and optional context.</div></div><div class="feature-step"><span class="step-num">02</span><div><strong>Send it wherever you already talk.</strong>A link works in a message, email, or group chat.</div></div><div class="feature-step"><span class="step-num">03</span><div><strong>They choose to keep it.</strong>No automatic imports. Their progress stays theirs.</div></div></div><button class="button primary full-width" data-action="pick-share">Choose a word to send ${icon('arrow')}</button><p class="small-print space-top">Anyone with a link can read the shared card. Names on links are unverified. Private notes and review history are never included.</p></section>
 <section class="panel exchange-panel">${state.backend?renderAccountPanel():`<span class="pill sand">Inbox backend not connected</span><div class="space-top"><h2>Your word exchange, with people.</h2><p class="muted">Link sharing works right now, without an account. Direct @handle exchanges need the included Nabu server.</p></div><div class="explain-card space-top">The server adds sign-in, a real inbox, accept / decline controls, and blocking. No pretend friends, generated messages, or fake activity.</div><div class="divider"></div><p class="small-print">This is a static deployment. To enable the inbox, run the included Python backend and open Nabu from that server. Your existing browser library can be moved using a backup.</p><button class="text-button space-top" data-action="check-backend">Check connection again ${icon('review')}</button>`}</section></div>
 ${state.backend&&state.user?renderInbox():''}`;}
function renderAccountPanel(){
 if(state.user)return `<span class="pill green">${icon('shield')} Signed in as @${E(state.user.handle)}</span><div class="space-top"><h2>Real words. Real people.</h2><p class="muted">Send directly to another person's exact handle. Their inbox is private; receiving a word never adds it automatically.</p></div><div class="divider"></div><div class="button-row"><button class="button secondary" data-action="refresh-inbox">${icon('review')} Refresh inbox</button><button class="button secondary" data-action="blocks">Blocked accounts</button><button class="text-button" data-action="logout">Sign out</button></div><p class="small-print space-top">Your library stays on this device, even when you sign out. Accounts enable exchange, not cloud backup or library synchronization.</p>`;
 return `<span class="pill green">${icon('check')} Inbox server connected</span><div class="space-top"><h2>A place for words from friends.</h2><p class="muted">Create a handle to send and receive words directly. Your local library stays private.</p></div><div class="button-row space-top"><button class="button primary" data-action="auth" data-mode="login">Sign in ${icon('arrow')}</button><button class="button secondary" data-action="auth" data-mode="register">Create a handle</button></div><div class="explain-card space-top">No email address required. Keep your password safe: this private-beta build does not have self-service password recovery.</div>`;
}
function renderInbox(){const list=state.exchangeTab==='inbox'?state.inbox:state.sent;
 return `<section class="recent-section"><div class="section-topline"><h2>Your exchange</h2><button class="text-button" data-action="refresh-inbox">${icon('review')} Refresh</button></div>${state.exchangeError?`<div class="error-banner" role="alert">${E(state.exchangeError)}</div>`:''}<div class="inbox-tabs"><button class="button ${state.exchangeTab==='inbox'?'soft':'secondary'}" data-action="exchange-tab" data-tab="inbox">Inbox (${state.inbox.length})</button><button class="button ${state.exchangeTab==='sent'?'soft':'secondary'}" data-action="exchange-tab" data-tab="sent">Sent (${state.sent.length})</button></div>${!list.length?`<div class="empty-state space-top">${icon('inbox')}<h2>${state.exchangeTab==='inbox'?'Nothing sent your way yet.':'Your next word could make someone\'s day.'}</h2><p>Tell a friend your handle: @${E(state.user.handle)}. Only words sent to you appear in your inbox.</p></div>`:`<div class="inbox-list">${list.map(item=>`<article class="inbox-item"><div class="inbox-meta"><span>${state.exchangeTab==='inbox'?'From':'To'} @${E(state.exchangeTab==='inbox'?item.sender:item.recipient)} &middot; verified account</span><span>${E(item.status)}</span></div><div class="inbox-word" dir="auto">${E(item.card.front)}</div><p class="inbox-meaning" dir="auto">${E(item.card.back)}</p>${item.message?`<p class="inbox-message" dir="auto">${E(item.message)}</p>`:''}${state.exchangeTab==='inbox'?`<div class="button-row">${item.status==='pending'?`<button class="button primary" data-action="accept-exchange" data-id="${item.id}">${icon('plus')} Add to my words</button><button class="button secondary" data-action="decline-exchange" data-id="${item.id}">Decline</button>`:''}<button class="text-button" data-action="block-user" data-handle="${E(item.sender)}">Block sender</button></div>`:''}</article>`).join('')}</div>`}</section>`;
}
function renderSettings(){return `${pageHeading('MAKE YOURSELF AT HOME','Your pace. Your space.','A few useful controls. No account required for your own words.')}
 <div class="settings-grid"><section class="panel settings-panel"><h2>Your everyday defaults</h2><p>Keep practice manageable. New-word limits do not hide overdue reviews.</p><form id="settings-form"><div class="form-field"><label for="setting-alias">Display name on shared links</label><input class="input" id="setting-alias" name="alias" value="${E(state.settings.alias)}" maxlength="40" placeholder="How friends know you"><span class="help">Optional and unverified. This is not your account handle.</span></div><div class="form-grid"><div class="form-field"><label for="setting-source">Language you are learning</label><select class="select" id="setting-source" name="sourceLang">${langOptions(state.settings.sourceLang)}</select></div><div class="form-field"><label for="setting-target">Meaning in</label><select class="select" id="setting-target" name="targetLang">${langOptions(state.settings.targetLang)}</select></div></div><div class="form-field"><label for="setting-limit">New words per day</label><input class="input" type="number" id="setting-limit" name="newLimit" min="1" max="100" value="${state.settings.newLimit}" required><span class="help">Start with 5-10. Words already in learning or review follow their own schedules.</span></div><div class="form-field"><label for="setting-provider">Translation service</label><select class="select" name="provider" id="setting-provider"><option value="public"${state.settings.provider==='public'?' selected':''}>MyMemory - public, no API key</option><option value="workspace"${state.settings.provider==='workspace'?' selected':''}${state.backend?.translationEnabled?'':' disabled'}>DeepL - through your Nabu server</option></select><span class="help">Public service requests send text to a third party. Workspace translation requires a server API key and sign-in. Neither option guarantees translation accuracy.</span></div><button class="button primary" type="submit">Save preferences ${icon('check')}</button></form></section>
 <section class="panel settings-panel"><h2>Your words are yours</h2><p>Your library and review history live in this browser. Clearing browser data removes them. Export a backup regularly.</p><div class="button-row"><button class="button primary" data-action="export-backup">${icon('download')} Full backup</button><button class="button secondary" data-action="import">${icon('upload')} Import words</button><button class="button secondary" data-action="export-tsv">Export to Anki</button></div><p class="small-print space-top">A full JSON backup includes cards, schedules, and review history. Anki TSV exports card content only; it does not transfer review schedules.</p><div class="divider"></div><h3>Keep local storage</h3><p class="small-print space-top">Ask your browser not to automatically evict your library. This does not replace a backup, and the browser may decline.</p><button class="text-button space-top" data-action="persist-storage">Request persistent storage ${icon('shield')}</button><div class="divider"></div><h3>Less reaching. More remembering.</h3><div class="shortcut-list space-top"><span>Translate text</span><span><kbd>Ctrl / Cmd</kbd> + <kbd>Enter</kbd></span><span>Find a word</span><span><kbd>Ctrl / Cmd</kbd> + <kbd>K</kbd></span><span>Reveal review answer</span><span><kbd>Space</kbd> / <kbd>Enter</kbd></span><span>Again / Hard / Good / Easy</span><span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></span></div><div class="danger-zone"><h3>Privacy & cleanup</h3><p>History cleanup removes cached translations, not saved cards. Reset removes your entire library from this browser only.</p><div class="button-row"><button class="button secondary" data-action="clear-history">Clear translation history</button><button class="button danger" data-action="reset-data">Reset local data</button>${state.user?'<button class="button danger" data-action="delete-account">Delete exchange account</button>':''}</div></div></section></div><div class="info-banner space-top">${icon('book')}<div><strong>Honest learning signals.</strong>Review intervals use a documented SM-2-inspired policy, not FSRS or a trained personalized model. Ratings record what you report remembering; they are not a proficiency score. Browser voices vary by device and language.</div></div>`;}
async function loadData(renderAfter=true){const data=await DB.snapshot();state.cards=data.cards;state.logs=data.logs;state.history=data.history;if(renderAfter)render();}
async function changed(renderAfter=true){await loadData(renderAfter);channel?.postMessage({changed:true});}
async function saveSettings(){await DB.setMeta('settings',state.settings);}
function invalidateTranslation(){state.translationEpoch++;state.abort?.abort();state.translation.busy=false;state.translation.back='';state.translation.error='';state.translation.provider='';state.translation.context='';state.translation.note='';}
function timeoutFetch(url, options={}, signal, ms=18000){
 const controller=new AbortController();const abort=()=>controller.abort(signal?.reason);if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('Translation took too long.','TimeoutError')),ms);
 return fetch(url,{...options,signal:controller.signal}).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);});
}
function decodeEntities(value){const t=document.createElement('textarea');t.innerHTML=value;return t.value;}
async function translate(){
 const t=state.translation;const front=t.front.trim();
 if(!front){toast('Type a word or phrase first.');$('#translation-input')?.focus();return;}
 if(front.length>C.MAX_TEXT)throw new Error('Keep each translation under 2,000 characters.');
 if(t.sourceLang===t.targetLang)throw new Error('Choose two different languages.');
 if(state.settings.provider==='public'&&!state.settings.consent)throw new Error('Check the privacy notice below the translator before sending text to MyMemory.');
 if(state.settings.provider==='workspace'&&!state.user)throw new Error('Sign in through Exchange before using your workspace translator.');
 state.abort?.abort();state.abort=new AbortController();const signal=state.abort.signal;const epoch=++state.translationEpoch;
 const source=t.sourceLang,target=t.targetLang,provider=state.settings.provider;
 t.busy=true;t.error='';t.back='';t.provider='';updateOutput();
 try{
  const key=[provider,source,target,front.normalize('NFC')].join('\u001f');const cached=await DB.cacheGet(key);let translated=cached;
  if(epoch!==state.translationEpoch)return;
  if(!translated){
   if(!navigator.onLine)throw new Error('You are offline. Saved words and reviews still work. Reconnect for a new translation, or add a card manually.');
   if(provider==='workspace'){
    const response=await api('translate',{method:'POST',body:{text:front,sourceLang:source,targetLang:target},signal});translated=response.translation;
   }else{
    const parts=[];
    for(const chunk of C.chunkText(front)){
     if(!chunk.trim())continue;
     const url=new URL('https://api.mymemory.translated.net/get');url.searchParams.set('q',chunk.trim());url.searchParams.set('langpair',`${source}|${target}`);
     const response=await timeoutFetch(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'},signal);
     if(!response.ok)throw new Error(response.status===429?'The translation service is rate-limited. Try later, or add the meaning manually.':'The translation service is unavailable. Try again or add the meaning manually.');
     const data=await response.json();
     if(Number(data.responseStatus)!==200 || data.quotaFinished)throw new Error(data.quotaFinished?'The public translation quota has been reached. Try later or use a workspace translator.':`Translation failed: ${String(data.responseDetails || 'unsupported language pair or service error').slice(0,200)}`);
     if(typeof data.responseData?.translatedText!=='string'||!data.responseData.translatedText.trim())throw new Error('The service returned an empty translation. Try a shorter phrase.');
     const decoded=decodeEntities(data.responseData.translatedText).trim();
     if(decoded.length>10000)throw new Error('The service returned an unexpectedly large translation.');
     parts.push(decoded);
    }
    translated=parts.join(' ');
   }
   if(typeof translated!=='string'||!translated.trim())throw new Error('No translation was returned.');
   await DB.cachePut(key,translated);
  }
  if(epoch!==state.translationEpoch)return;
  t.front=front;t.back=translated;t.provider=cached?'Saved translation':provider==='workspace'?'DeepL workspace':'MyMemory';t.busy=false;
  await DB.rememberTranslation({front,back:translated,sourceLang:source,targetLang:target,provider:t.provider,context:t.context,note:''});
  await loadData(false);if(state.view==='translate')render();
 }catch(e){
  if(epoch!==state.translationEpoch)return;
  t.error=e.name==='TimeoutError'?'Translation timed out. Your text is still here. Try again.':e.name==='AbortError'?'Translation was interrupted. Try again.':e.message==='Failed to fetch'?'The service could not be reached. Check your connection or add a card manually.':e.message;
  t.busy=false;updateOutput();
 }
}
async function copy(text){
 try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(text);toast('Copied. Ready to send.');}
 catch{showModal('Copy this text',`<p class="modal-intro">Your browser did not allow clipboard access. Select the text and copy it yourself.</p><textarea class="input" rows="5" id="copy-fallback" readonly>${E(text)}</textarea><div class="modal-footer"><button class="button primary" data-action="close-modal">Done</button></div>`);$('#copy-fallback').select();}
}
function speak(value,language){
 if(!value?.trim())return;
 if(!('speechSynthesis' in window))return toast('Speech is not supported in this browser.');
 const voices=speechSynthesis.getVoices(),base=language.split('-')[0].toLowerCase();
 const voice=voices.find(v=>v.lang.toLowerCase()===language.toLowerCase()) || voices.find(v=>v.lang.split('-')[0].toLowerCase()===base);
 if(!voice){toast(`No ${C.languageName(language)} voice is installed on this device.`);return;}
 speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(value.slice(0,2000));utterance.lang=voice.lang;utterance.voice=voice;utterance.rate=.88;utterance.onerror=e=>{if(e.error!=='interrupted'&&e.error!=='canceled')toast('Audio could not play on this device.');};speechSynthesis.speak(utterance);
}
function openEditor(card=null,edit=false,received=null){
 state.editorCard=card?{...card}:null;state.editMode=edit;state.receiving=received;
 const c=card || {front:state.translation.front,back:state.translation.back,sourceLang:state.translation.sourceLang,targetLang:state.translation.targetLang,deck:'My words',context:'',note:'',tags:[]};
 showModal(edit?'Make this word yours':received?'A word came your way':'Keep a little discovery',`${received?`<div class="info-banner">${icon('shield')}<div><strong>${received.verified?`From @${E(received.sender)}`:received.sender?`Shared by ${E(received.sender)}`:'Someone shared a word with you'}</strong>${received.verified?'Sent by a signed-in account.':'The name on a link is unverified. Anyone with the link can read this card.'} Review the meaning before you add it.</div></div>`:'<p class="modal-intro">A useful word, a clear meaning, and a bit of context. Edit the translation before saving when needed.</p>'}
 <form id="card-form"><div class="form-grid"><div class="form-field"><label for="card-source">Word language</label><select class="select" id="card-source" name="sourceLang">${langOptions(c.sourceLang)}</select></div><div class="form-field"><label for="card-target">Meaning language</label><select class="select" id="card-target" name="targetLang">${langOptions(c.targetLang)}</select></div></div><div class="form-field"><label for="card-front">Word or phrase</label><textarea class="input" id="card-front" name="front" maxlength="1000" rows="2" required dir="auto">${E(c.front)}</textarea></div><div class="form-field"><label for="card-back">Meaning</label><textarea class="input" id="card-back" name="back" maxlength="1000" rows="2" required dir="auto">${E(c.back)}</textarea></div><div class="form-field"><label for="card-context">Context in the word's language</label><textarea class="input" id="card-context" name="context" maxlength="1500" rows="2" dir="auto" placeholder="Where did you hear it? How is it used?">${E(c.context)}</textarea><span class="help">Shown on the front of a review card. Avoid giving away the answer.</span></div><div class="form-grid"><div class="form-field"><label for="card-deck">Collection</label><input class="input" id="card-deck" name="deck" list="deck-list" value="${E(c.deck||'My words')}" maxlength="64" required><datalist id="deck-list">${[...new Set(activeCards().map(x=>x.deck))].map(d=>`<option value="${E(d)}">`).join('')}</datalist></div><div class="form-field"><label for="card-tags">Tags, separated by commas</label><input class="input" id="card-tags" name="tags" value="${E((c.tags||[]).join(', '))}" placeholder="travel, work, everyday" maxlength="390"></div></div><div class="form-field"><label for="card-note">Private note</label><textarea class="input" id="card-note" name="note" maxlength="1000" rows="2" dir="auto">${E(c.note)}</textarea><span class="help">Shown after revealing the answer. Never included in shared words.</span></div>${!edit?'<label class="checkbox-row"><input type="checkbox" name="reverse">Also add a reverse card for producing the word. Each direction gets its own review schedule.</label>':'<p class="small-print">Editing keeps the review schedule. For a completely different meaning, add a new card instead.</p>'}<div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button primary" id="card-submit">${edit?'Save changes':'Add to my words'} ${icon('plus')}</button></div></form>`);
}
async function saveCardForm(form){
 const data=new FormData(form);const content=C.cardContent({...Object.fromEntries(data),attribution:state.editorCard?.attribution||''});
 const button=$('#card-submit');button.disabled=true;
 try{
  let result;
  if(state.editMode){await DB.editCard(state.editorCard.id,content,state.editorCard.revision);result={added:1,duplicates:0};}
  else{const inputs=[content];if(data.has('reverse'))inputs.push(C.reverseCard(content));result=await DB.addCards(inputs);}
  const receiving=state.receiving,editing=state.editMode;closeModal();await changed();toast(editing?'Changes saved.':result.added?`${result.added===1?'Word':`${result.added} words`} added to your collection.`:'This word and meaning are already in your library.');
  if(receiving?.id){try{await api(`exchanges/${receiving.id}`,{method:'PATCH',body:{status:'accepted'}});await refreshExchange();}catch{toast('Saved locally. Inbox status could not update; accepting again will not duplicate the card.','',null,true);}}
 }catch(e){button.disabled=false;throw e;}
}
function openShare(card){
 if(!card)throw new Error('Choose a word from your library first.');
 state.shareCard=card;const url=new URL('./',location.href);url.search='';url.hash=`share=${C.encodeShare(card,state.settings.alias)}`;state.shareURL=url.href;
 showModal('A good word travels.',`<p class="modal-intro">Send this little discovery to someone. They can review it before adding it to their own library.</p><div class="share-preview"><span class="pill">${E(C.languageName(card.sourceLang))} &rarr; ${E(C.languageName(card.targetLang))}</span><div class="share-word" dir="auto">${E(card.front)}</div><div class="share-meaning" dir="auto">${E(card.back)}</div>${card.context?`<p dir="auto">${E(card.context)}</p>`:''}</div><label class="field-label" for="share-url">Shareable word link</label><div class="link-box space-top"><input class="input" id="share-url" readonly value="${E(state.shareURL)}"><button class="button primary" data-action="copy-share">${icon('copy')} Copy</button></div>${navigator.share?'<button class="button secondary full-width space-top" data-action="native-share">Share with another app</button>':''}<p class="sender-note">Anyone holding the link can read the card. Private notes and progress are excluded. Link names are not identity-verified.</p>${state.user?`<div class="divider"></div><h3>Send to a Nabu handle</h3><form id="send-form" class="space-top"><div class="form-field"><label for="send-handle">Recipient's exact handle</label><input class="input" id="send-handle" name="recipient" placeholder="friend_name" pattern="[A-Za-z0-9_]{3,24}" minlength="3" maxlength="24" required autocomplete="off"></div><div class="form-field"><label for="send-message">A small note (optional)</label><input class="input" id="send-message" name="message" maxlength="280" placeholder="Thought you would like this one."></div><button class="button primary" type="submit">Send word ${icon('arrow')}</button></form>`:`<p class="small-print space-top">${state.backend?'Sign in under Exchange to send directly to a handle.':'Direct inbox delivery requires the included Nabu backend. Link sharing needs no account.'}</p>`}`);
}
function pickShare(){const cards=activeCards();if(!cards.length){toast('Save a word first, then pass it along.');navigate('translate');return;}
 showModal('Pick a word to pass along',`<p class="modal-intro">Choose a word from your collection. Your private notes stay private.</p><div class="form-field"><label for="pick-share-search">Find a word</label><input class="input" id="pick-share-search" type="search" placeholder="Search your collection"></div><div id="share-picker">${renderSharePicker(cards)}</div>`);
}
function renderSharePicker(cards){return cards.slice(0,60).map(c=>`<button class="recent-row" data-action="share-card" data-id="${c.id}"><span class="lang-dot">${C.languageCode(c.sourceLang)}</span><span class="recent-word" dir="auto">${E(c.front)}</span><span class="recent-meaning" dir="auto">${E(c.back)}</span>${icon('arrow')}</button>`).join('')||'<p class="small-print">No matching words.</p>';}
function download(filename,value,type){const blob=new Blob([value],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function exportBackup(){await loadData(false);download(`nabu-backup-${C.localDay(Date.now())}.json`,C.backup(state.cards,state.logs,state.settings),'application/json');toast('Backup prepared. Keep it somewhere safe.');}
async function exportTSV(){await loadData(false);if(!activeCards().length)throw new Error('There are no active cards to export.');download(`nabu-words-${C.localDay(Date.now())}.tsv`,C.exportTSV(activeCards()),'text/tab-separated-values;charset=utf-8');toast('Anki-compatible TSV prepared. Schedules stay in your full backup.');}
function openImport(){state.importEpoch=(state.importEpoch||0)+1;state.importData=null;showModal('Bring your words along',`<p class="modal-intro">Import a full Nabu JSON backup or a UTF-8 CSV / TSV with word, meaning, optional context, and optional tags. Existing cards are kept; duplicates are skipped.</p><div class="form-grid"><div class="form-field"><label for="import-source">Word language for CSV / TSV</label><select class="select" id="import-source">${langOptions(state.settings.sourceLang)}</select></div><div class="form-field"><label for="import-target">Meaning language for CSV / TSV</label><select class="select" id="import-target">${langOptions(state.settings.targetLang)}</select></div></div><div class="form-field"><label for="import-file">Choose a file (up to 5 MB)</label><input class="input" id="import-file" type="file" accept=".json,.csv,.tsv,.txt"><span class="help">JSON keeps its language metadata. Native .apkg archives are not supported; export notes as plain text from Anki first.</span></div><div id="import-preview"></div>`);}
async function previewImport(file){
 const epoch=(state.importEpoch||0)+1;state.importEpoch=epoch;state.importData=null;$('#import-preview').innerHTML='';$('#modal-error')?.remove();
 if(!file)return;if(file.size>5*1024*1024)throw new Error('The file is larger than 5 MB.');
 const sourceLang=$('#import-source').value,targetLang=$('#import-target').value;
 const raw=await file.text();if(epoch!==state.importEpoch||!modal.open||!$('#import-preview'))return;
 state.importData=C.parseImport(raw,{sourceLang,targetLang,deck:'Imported words'});
 const existing=new Set(state.cards.map(C.identity));let n=0;for(const c of state.importData.cards){const k=C.identity(c);if(!existing.has(k)){n++;existing.add(k);}}
 $('#import-preview').innerHTML=`<div class="import-summary"><strong>${n}</strong> new words to keep.<br>${state.importData.cards.length-n} existing or repeated words will be skipped.</div><p class="small-print">Nothing has been changed yet. Existing review schedules are never overwritten by an import.</p>${state.importData.settings?'<label class="checkbox-row"><input type="checkbox" id="import-preferences">Also restore the display name, language defaults, and new-word limit from this backup.</label>':''}<div class="modal-footer"><button class="button secondary" data-action="close-modal">Cancel</button><button class="button primary" data-action="confirm-import">Import words ${icon('plus')}</button></div>`;
}
async function api(path,{method='GET',body,signal}={}){
 const response=await timeoutFetch(new URL(`./api/${path}`,location.href),{method,credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json',...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&state.csrf?{'X-CSRF-Token':state.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})},signal);
 let data;try{data=await response.json();}catch{throw new Error('The Nabu inbox server is not available at this address.');}
 if(!response.ok){if(response.status===401){state.user=null;state.csrf='';}throw new Error(typeof data.detail==='string'?data.detail:'That request could not be completed. Please try again.');}
 return data;
}
async function checkBackend(){
 try{const config=await api('config');if(config.service!=='nabu')throw new Error('Not Nabu');state.backend=config;const session=await api('session');state.user=session.user;state.csrf=session.csrf||'';}
 catch{state.backend=null;state.user=null;state.csrf='';}
 renderNav();if(state.view==='exchange'||state.view==='settings')render();
}
async function refreshExchange(){
 if(!state.user)return;const data=await api('exchanges');state.inbox=data.inbox;state.sent=data.sent;state.exchangeError='';if(state.view==='exchange')render();
}
function openAuth(mode){showModal(mode==='register'?'Your name in the conversation.':'Welcome back.',`<p class="modal-intro">${mode==='register'?'Choose a handle for word exchange. Your personal word collection stays in this browser.':'Sign in to your word exchange. Your personal library does not sync between devices.'}</p><form id="auth-form" data-mode="${mode}"><div class="form-field"><label for="auth-handle">Handle</label><input class="input" id="auth-handle" name="handle" pattern="[A-Za-z0-9_]{3,24}" minlength="3" maxlength="24" required autocomplete="username" autocapitalize="none" placeholder="your_name"><span class="help">3-24 letters, numbers, or underscores.</span></div><div class="form-field"><label for="auth-password">Password</label><input class="input" id="auth-password" type="password" name="password" minlength="${mode==='register'?12:1}" maxlength="128" required autocomplete="${mode==='register'?'new-password':'current-password'}"><span class="help">${mode==='register'?'Use at least 12 characters. Keep it safe: password recovery is not available in this beta.':'Passwords are case-sensitive.'}</span></div>${mode==='register'&&state.backend?.inviteRequired?'<div class="form-field"><label for="auth-invite">Beta invitation code</label><input class="input" id="auth-invite" name="invite" maxlength="128" required autocomplete="off"></div>':''}<div class="modal-footer"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">${mode==='register'?'Create handle':'Sign in'} ${icon('arrow')}</button></div></form>`);}
async function openBlocks(){const data=await api('blocks');state.blocks=data.blocks;showModal('Your boundaries matter.',`<p class="modal-intro">Blocked accounts cannot send you words. Their past incoming exchanges are hidden from your inbox.</p>${state.blocks.length?state.blocks.map(handle=>`<div class="account-summary"><strong>@${E(handle)}</strong><button class="button secondary" data-action="unblock-user" data-handle="${E(handle)}">Unblock</button></div>`).join(''):'<p class="small-print">You have not blocked anyone.</p>'}`);}
const actions={
 'go':async b=>navigate(b.dataset.view), 'close-modal':async()=>closeModal(),
 'toast-action':async()=>{const fn=state.toastAction;$('#toast').hidden=true;state.toastAction=null;if(fn)await fn();},
 'translate':translate,
 'sample':async b=>{invalidateTranslation();const c=C.STARTERS[Number(b.dataset.index)];Object.assign(state.translation,c,{provider:'Built-in example',busy:false,error:''});render();},
 'recent':async b=>{invalidateTranslation();const c=state.history[Number(b.dataset.index)];Object.assign(state.translation,c,{busy:false,error:''});render();},
 'clear-translation':async()=>{invalidateTranslation();state.translation.front='';render();$('#translation-input').focus();},
 'swap':async()=>{const t=state.translation;const old={...t};invalidateTranslation();t.sourceLang=old.targetLang;t.targetLang=old.sourceLang;t.front=old.back||'';t.back=old.back?old.front:'';t.provider=old.back?'Reversed translation':'';render();},
 'translate-selection':async()=>{const el=$('#translation-input'),selected=el.value.slice(el.selectionStart,el.selectionEnd).trim(),context=el.value;if(!selected)return;invalidateTranslation();state.translation.front=selected;state.translation.context=context.slice(0,1500);render();await translate();},
 'speak-source':async()=>speak(state.translation.front,state.translation.sourceLang),
 'speak-target':async()=>speak(state.translation.back,state.translation.targetLang),
 'speak-card':async b=>{const c=findCard(b.dataset.id);if(c)speak(c.front,c.sourceLang);},
 'speak-review':async()=>{const c=findCard(state.review.cardId);if(c)speak(c.front,c.sourceLang);},
 'copy-translation':async()=>copy(state.translation.back),
 'save-translation':async()=>{const t=state.translation;if(!t.back)return;const result=await DB.addCards([{...t,deck:'My words',tags:[]}]);await changed();toast(result.added?'Word saved. Your next review starts here.':'Already in your library.','Review',()=>navigate('review'));},
 'edit-translation':async()=>openEditor({...state.translation,deck:'My words',tags:[]}),
 'add-manual':async()=>openEditor({front:'',back:'',sourceLang:state.settings.sourceLang,targetLang:state.settings.targetLang,context:'',note:'',deck:'My words',tags:[]}),
 'edit-card':async b=>openEditor(findCard(b.dataset.id),true),
 'archive-card':async b=>{const c=findCard(b.dataset.id);if(!c)return;const archived=!c.archived;await DB.archiveCard(c.id,archived);await changed();toast(archived?'Word moved to your archive.':'Word restored.','Undo',async()=>{await DB.archiveCard(c.id,!archived);await changed();});},
 'share-card':async b=>openShare(findCard(b.dataset.id)), 'pick-share':async()=>pickShare(),
 'copy-share':async()=>copy(state.shareURL),
 'native-share':async()=>{try{await navigator.share({title:'A word from Nabu',text:`${state.shareCard.front} - ${state.shareCard.back}`,url:state.shareURL});}catch(e){if(e.name!=='AbortError')await copy(state.shareURL);}},
 'reset-filters':async()=>{state.filters={q:'',lang:'',deck:'',status:'',sort:'recent'};render();},
 'load-more':async()=>{state.limit+=60;$('#library-results').innerHTML=renderLibraryResults();},
 'reveal':async()=>{if(!state.review.cardId)return;state.review.typed=$('#review-typed')?.value||state.review.typed;state.review.revealed=true;render();},
 'grade':async b=>{const r=state.review;if(!r.revealed||r.busy||!r.cardId)return;r.busy=true;const id=r.cardId,revision=renderedReviewRevision;try{const result=await DB.gradeCard(id,Number(b.dataset.rating),revision,Date.now()-r.startedAt);r.undo=result.log.id;r.count++;await loadData(false);selectReview();channel?.postMessage({changed:true});}catch(e){await loadData(false);selectReview();throw e;}finally{r.busy=false;render();}},
 'undo-review':async()=>{if(!state.review.undo)return;await DB.undoReview(state.review.undo);state.review.undo=null;state.review.count=Math.max(0,state.review.count-1);await loadData(false);selectReview();render();channel?.postMessage({changed:true});toast('Last review undone.');},
 'export-backup':exportBackup,'export-tsv':exportTSV,'import':async()=>openImport(),
 'confirm-import':async b=>{if(!state.importData)return;b.disabled=true;const restore=$('#import-preferences')?.checked;const result=await DB.mergeImport(state.importData);if(restore&&state.importData.settings){Object.assign(state.settings,state.importData.settings);await saveSettings();}closeModal();await changed();toast(`${result.added} words imported. ${result.duplicates} duplicates skipped.`);},
 'persist-storage':async()=>{const persistent=await navigator.storage?.persist?.();toast(persistent?'Persistent storage granted. Keep exporting backups too.':'Your browser did not grant persistent storage. Export backups regularly.');},
 'clear-history':async()=>{await DB.clearTranslationHistory();await changed();toast('Translation history and cache cleared. Saved words are untouched.');},
 'reset-data':async()=>showModal('A completely fresh start?',`<p class="modal-intro">This permanently removes this browser's words, schedules, settings, and translation history. It does not delete your exchange account. Export a backup first.</p><button class="button secondary" data-action="export-backup">${icon('download')} Export backup first</button><form id="reset-form" class="space-top"><div class="form-field"><label for="reset-confirm">Type DELETE to confirm</label><input class="input" id="reset-confirm" name="confirm" pattern="DELETE" required autocomplete="off"></div><div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Keep my words</button><button type="submit" class="button danger">Delete local data</button></div></form>`),
 'check-backend':async()=>{await checkBackend();toast(state.backend?'Inbox server connected.':'No inbox server here. Link sharing is still ready.');},
 'auth':async b=>openAuth(b.dataset.mode),
 'logout':async()=>{await api('logout',{method:'POST',body:{}});state.user=null;state.csrf='';state.inbox=[];state.sent=[];render();toast('Signed out. Your library is still on this device.');},
 'refresh-inbox':refreshExchange,
 'exchange-tab':async b=>{state.exchangeTab=b.dataset.tab;render();},
 'accept-exchange':async b=>{const item=state.inbox.find(x=>x.id===b.dataset.id);if(!item)return;openEditor({...item.card,deck:'From friends',attribution:`@${item.sender}`,tags:[],note:''},false,{id:item.id,sender:item.sender,verified:true});},
 'decline-exchange':async b=>{await api(`exchanges/${b.dataset.id}`,{method:'PATCH',body:{status:'declined'}});await refreshExchange();toast('Word declined. Nothing was added to your library.');},
 'block-user':async b=>{await api('blocks',{method:'POST',body:{handle:b.dataset.handle}});await refreshExchange();toast(`@${b.dataset.handle} can no longer send you words.`);},
 'blocks':openBlocks,
 'unblock-user':async b=>{await api(`blocks/${encodeURIComponent(b.dataset.handle)}`,{method:'DELETE',body:{}});await openBlocks();await refreshExchange();},
 'delete-account':async()=>showModal('Delete your exchange account?',`<p class="modal-intro">This deletes your account, sessions, and exchanges from the server. Your local word library stays on this device. This cannot be undone.</p><form id="delete-account-form"><div class="form-field"><label for="delete-password">Current password</label><input class="input" id="delete-password" name="password" type="password" autocomplete="current-password" required></div><div class="modal-footer"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button danger" type="submit">Delete exchange account</button></div></form>`)
};
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-action]');if(!b||b.disabled)return;const fn=actions[b.dataset.action];if(!fn)return;
 event.preventDefault();try{await fn(b);}catch(e){if(modal.open)modalError(e.message);else showError(e);}
});
document.addEventListener('submit',async event=>{
 const form=event.target;if(!(form instanceof HTMLFormElement))return;event.preventDefault();const button=form.querySelector('[type="submit"]');if(button?.disabled)return;
 try{
  if(form.id==='card-form'){await saveCardForm(form);return;}
  if(button)button.disabled=true;
  const data=Object.fromEntries(new FormData(form));
  if(form.id==='settings-form'){
   if(data.sourceLang===data.targetLang)throw new Error('Choose two different default languages.');
   const limit=Number(data.newLimit);if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Choose between 1 and 100 new words per day.');
   if(data.provider==='workspace'&&!state.backend?.translationEnabled)throw new Error('Your workspace translator is not configured.');
   state.settings={...state.settings,...data,newLimit:limit,alias:C.text(data.alias,'Display name',40)};await saveSettings();
   invalidateTranslation();state.translation.sourceLang=data.sourceLang;state.translation.targetLang=data.targetLang;render();toast('Preferences saved.');
  }
  if(form.id==='reset-form'){
   if(data.confirm!=='DELETE')throw new Error('Type DELETE exactly to confirm.');
   invalidateTranslation();await DB.clearAll();state.settings={...DEFAULTS};state.review={cardId:null,revealed:false,typed:'',startedAt:0,count:0,undo:null,deck:'',busy:false};state.translation={front:'',back:'',sourceLang:'es',targetLang:'en',context:'',note:'',provider:'',busy:false,error:''};closeModal();await changed();toast('Local data removed. Your exchange account was not changed.');
  }
  if(form.id==='auth-form'){
   const result=await api(form.dataset.mode==='register'?'register':'login',{method:'POST',body:data});state.user=result.user;state.csrf=result.csrf;closeModal();await refreshExchange();render();toast(`Welcome, @${state.user.handle}.`);
  }
  if(form.id==='send-form'){
   const card=C.sharePayload(state.shareCard).card;
   await api('exchanges',{method:'POST',body:{recipient:data.recipient,message:data.message,card,requestId:form.dataset.requestId || (form.dataset.requestId=C.uid())}});
   closeModal();await refreshExchange();toast('Word sent. Your friend can choose to keep it.');
  }
  if(form.id==='delete-account-form'){
   await api('account',{method:'DELETE',body:{password:data.password}});state.user=null;state.csrf='';state.inbox=[];state.sent=[];closeModal();render();toast('Exchange account deleted. Your local library is untouched.');
  }
 }catch(e){if(modal.open)modalError(e.message);else showError(e);}finally{if(button)button.disabled=false;}
});
document.addEventListener('input',event=>{
 const el=event.target;
 if(el.id==='translation-input'){invalidateTranslation();state.translation.front=el.value;$('#character-count').textContent=`${el.value.length} / 2,000`;updateOutput();}
 if(el.id==='library-search'){state.filters.q=el.value;state.limit=60;$('#library-results').innerHTML=renderLibraryResults();}
 if(el.id==='review-typed')state.review.typed=el.value;
 if(el.closest('#send-form'))delete el.closest('#send-form').dataset.requestId;
 if(el.id==='pick-share-search')$('#share-picker').innerHTML=renderSharePicker(activeCards().filter(c=>C.searchText(c.front+' '+c.back).includes(C.searchText(el.value))));
});
document.addEventListener('change',async event=>{
 const el=event.target;
 try{
  if(el.id==='source-language'||el.id==='target-language'){invalidateTranslation();state.translation[el.id==='source-language'?'sourceLang':'targetLang']=el.value;render();}
  if(el.id==='translation-consent'){state.settings.consent=el.checked;await saveSettings();}
  if(el.id.startsWith('filter-')){const key={'filter-language':'lang','filter-deck':'deck','filter-status':'status','filter-sort':'sort'}[el.id];if(key){state.filters[key]=el.value;state.limit=60;$('#library-results').innerHTML=renderLibraryResults();}}
  if(el.id==='review-deck'){state.review.deck=el.value;selectReview();render();}
  if(el.id==='import-file')await previewImport(el.files[0]);
  if(el.id==='import-source'||el.id==='import-target'){state.importEpoch=(state.importEpoch||0)+1;state.importData=null;$('#import-preview').innerHTML='';$('#import-file').value='';}
 }catch(e){if(modal.open)modalError(e.message);else showError(e);}
});
document.addEventListener('select',event=>{if(event.target.id==='translation-input'){const el=event.target;const button=$('#selection-button');if(button)button.hidden=!(el.selectionEnd>el.selectionStart);}});
document.addEventListener('keydown',event=>{
 if(event.isComposing||modal.open)return;
 const editing=['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)||event.target.isContentEditable;
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();navigate('library');$('#library-search').focus();return;}
 if((event.metaKey||event.ctrlKey)&&event.key==='Enter'&&state.view==='translate'){event.preventDefault();translate().catch(showError);return;}
 if(state.view!=='review'||event.repeat)return;
 if(!state.review.revealed && ((event.key===' '&&!editing)||event.key==='Enter')){event.preventDefault();actions.reveal().catch(showError);}
 else if(state.review.revealed&&!editing&&['1','2','3','4'].includes(event.key)){event.preventDefault();actions.grade({dataset:{rating:event.key}}).catch(showError);}
});
window.addEventListener('popstate',()=>navigate(new URL(location.href).searchParams.get('view')||'translate',false));
window.addEventListener('online',()=>renderNav());window.addEventListener('offline',()=>renderNav());
window.addEventListener('pagehide',()=>{state.abort?.abort();window.speechSynthesis?.cancel?.();});
channel?.addEventListener('message',async()=>{const id=state.review.cardId,revision=findCard(id)?.revision;await loadData(false);if(state.view==='review'&&findCard(id)?.revision!==revision)selectReview();render();});
async function handleShare(){
 if(!location.hash.startsWith('#share='))return;
 const token=location.hash.slice(7);history.replaceState(history.state,'',location.pathname+location.search);
 try{const payload=C.decodeShare(token);openEditor(payload.card,false,{sender:payload.sender,verified:false});}
 catch(e){toast(e.message,'',null,true);}
}
window.addEventListener('hashchange',handleShare);
async function boot(){
 try{
  window.NabuStartup?.stage('Opening your private library...');
  await DB.openStore();
  window.NabuStartup?.stage('Loading your words and preferences...');
  const saved=await DB.getMeta('settings',{});state.settings={...DEFAULTS};
  if(saved&&typeof saved==='object'){
   state.settings.alias=typeof saved.alias==='string'?saved.alias.slice(0,40):'';
   for(const key of ['sourceLang','targetLang'])if(C.isLanguage(saved[key]))state.settings[key]=saved[key];
   state.settings.newLimit=Number.isInteger(saved.newLimit)?C.clamp(saved.newLimit,1,100):10;
   state.settings.consent=saved.consent===true;state.settings.provider=saved.provider==='workspace'?'workspace':'public';
  }
  state.translation.sourceLang=state.settings.sourceLang;state.translation.targetLang=state.settings.targetLang;
  await loadData(false);navigate(new URL(location.href).searchParams.get('view')||'translate',false);
  window.NabuStartup?.ready();
  await handleShare();
  checkBackend().catch(()=>{});
  // Offline installation never gates the local app or masks a successful boot.
  try { if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./nabu-sw.js', {updateViaCache:'none'}).catch(error=>console.warn('Offline installation unavailable.',error)); } catch (error) { console.warn('Offline installation unavailable.',error); }
  refreshTimer=setInterval(()=>{
   if(document.hidden||modal.open)return;renderNav();
   if(state.view==='review'&&!state.review.cardId&&queue().length){selectReview();render();}
  },15000);
 }catch(e){console.error('Nabu startup failed:',e);if(window.NabuStartup)window.NabuStartup.fail(e);else main.innerHTML=`<div class="fatal"><h1>Your library could not open.</h1><p>${E(e.message)}</p><p>Check that browser storage is allowed, then reload. Nabu has not erased any existing data.</p><a class="button primary" href="./nabu-repair.html">Repair app loading</a></div>`;}
}
boot();
