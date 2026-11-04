import {cardContent,newCard,identity,scheduleReview,uid,VERSION} from './nabu-core.js';
const NAME = 'nabu-translate-remember';
// Fail explicitly rather than leaving the loading screen waiting forever.
// No fallback database: an unavailable library must not look like an empty one.
const OPEN_TIMEOUT = 8000;
const REQUEST_TIMEOUT = 10000;
const request = req => new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{
    try { req.transaction?.abort(); } catch {}
    reject(new Error('Browser storage did not respond. Close other Nabu tabs and reload. Do not clear site data.'));
  },REQUEST_TIMEOUT);
  req.onsuccess=()=>{clearTimeout(timer);resolve(req.result);};
  req.onerror=()=>{clearTimeout(timer);reject(req.error || new Error('The browser could not read your library.'));};
});
const finished = tx => new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{try{tx.abort();}catch{}reject(new Error('Saving timed out. The database transaction was cancelled; retry the operation.'));},15000);
  tx.oncomplete=()=>{clearTimeout(timer);resolve();};
  tx.onabort=()=>{clearTimeout(timer);reject(tx.error || new Error('The database operation was cancelled.'));};
  tx.onerror=()=>{};
});
let db, opening;
export function openStore() {
  if (db) return Promise.resolve(db);
  if (opening) return opening;
  opening = new Promise((resolve,reject)=>{
    let req, settled=false;
    const settle=(error,value)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      if(error)reject(error);else resolve(value);
    };
    const timer=setTimeout(()=>settle(new Error('Your browser is not responding to the library request. Close other Nabu tabs and reopen this page. Your saved words have not been reset.')),OPEN_TIMEOUT);
    try {
      if (!globalThis.indexedDB) throw new Error('Browser storage is unavailable. Allow site storage and open Nabu in a regular browser tab. Your existing words have not been erased.');
      req=indexedDB.open(NAME,VERSION);
      req.onupgradeneeded=()=>{
        if(settled){try{req.transaction.abort();}catch{}return;}
        try{
          const d=req.result;
          if (!d.objectStoreNames.contains('cards')) {const s=d.createObjectStore('cards',{keyPath:'id'});s.createIndex('identity','identity',{unique:true});}
          if (!d.objectStoreNames.contains('logs')) {const s=d.createObjectStore('logs',{keyPath:'id'});s.createIndex('cardId','cardId');}
          for(const n of ['meta','cache','history']) if(!d.objectStoreNames.contains(n))d.createObjectStore(n,{keyPath:'id'});
        }catch(error){try{req.transaction.abort();}catch{}settle(error);}
      };
      req.onsuccess=()=>{
        const connection=req.result;
        if(settled){connection.close();return;}
        db=connection;
        connection.onversionchange=()=>{connection.close();if(db===connection)db=null;};
        connection.onclose=()=>{if(db===connection)db=null;};
        settle(null,connection);
      };
      req.onerror=()=>settle(req.error || new Error('Your browser could not open the local library.'));
      req.onblocked=()=>settle(new Error('Another Nabu tab is blocking the library upgrade. Close all other Nabu tabs, then reload. Do not clear site data.'));
    }catch(error){settle(new Error('Nabu cannot access browser storage. Allow site storage and use a regular browser tab. '+(error.message || '')));}
  });
  // Clear both successful and failed in-flight attempts, without creating an
  // unhandled rejected promise. A closed connection can then be reopened.
  opening.then(()=>{opening=null;},()=>{opening=null;});
  return opening;
}
function tx(names,mode='readonly') {if(!db)throw new Error('Storage is not ready.');return db.transaction(names,mode);}
async function all(name) {return request(tx([name]).objectStore(name).getAll());}
export async function snapshot(){const t=tx(['cards','logs','history']);const [cards,logs,history]=await Promise.all(['cards','logs','history'].map(n=>request(t.objectStore(n).getAll())));return {cards,logs,history:history.sort((a,b)=>b.at-a.at)};}
export async function getMeta(id,fallback=null){return (await request(tx(['meta']).objectStore('meta').get(id)))?.value ?? fallback;}
export async function setMeta(id,value){const t=tx(['meta'],'readwrite');const done=finished(t);t.objectStore('meta').put({id,value});await done;}
export async function addCards(inputs) {
  const t=tx(['cards'],'readwrite'), done=finished(t), store=t.objectStore('cards');
  let added=0, duplicates=0;const results=[];
  try {
    for(const input of inputs){
      const c=newCard(input);const key=identity(c);
      const existing=await request(store.index('identity').get(key));
      if(existing){duplicates++;results.push(existing);}
      else{store.add({...c,identity:key});added++;results.push(c);}
    }
    await done;return {added,duplicates,cards:results};
  }catch(e){try{t.abort();}catch{}await done.catch(()=>{});throw e;}
}
export async function editCard(id,content,revision) {
  const clean=cardContent(content), t=tx(['cards'],'readwrite'), done=finished(t), s=t.objectStore('cards');
  try {
    const old=await request(s.get(id));
    if(!old)throw new Error('This card was removed.');
    if(old.revision!==revision)throw new Error('This card changed in another tab. Reopen it before editing.');
    const key=identity(clean), duplicate=await request(s.index('identity').get(key));
    if(duplicate && duplicate.id!==id)throw new Error('That word and meaning are already in your library.');
    const next={...old,...clean,identity:key,updatedAt:Date.now(),revision:old.revision+1};s.put(next);await done;return next;
  }catch(e){try{t.abort();}catch{}await done.catch(()=>{});throw e;}
}
export async function archiveCard(id,archived) {
  const t=tx(['cards'],'readwrite'), done=finished(t),s=t.objectStore('cards');
  const card=await request(s.get(id));if(card)s.put({...card,archived,revision:card.revision+1,updatedAt:Date.now()});await done;
}
export async function gradeCard(id,rating,revision,durationMs=0,now=Date.now()) {
  const t=tx(['cards','logs'],'readwrite'),done=finished(t),s=t.objectStore('cards');
  try {
    const old=await request(s.get(id));
    if(!old || old.archived)throw new Error('This card is no longer available.');
    if(old.revision!==revision)throw new Error('This card changed in another tab. Your answer was not saved; reload the review.');
    const next={...old,schedule:scheduleReview(old.schedule,rating,now),updatedAt:now,revision:old.revision+1};
    const log={id:uid(),cardId:id,at:now,rating,before:old,afterRevision:next.revision,durationMs:Math.max(0,Math.min(86400000,durationMs))};
    s.put(next);t.objectStore('logs').add(log);await done;return {card:next,log};
  }catch(e){try{t.abort();}catch{}await done.catch(()=>{});throw e;}
}
export async function undoReview(logId) {
  const t=tx(['cards','logs'],'readwrite'),done=finished(t),cs=t.objectStore('cards'),ls=t.objectStore('logs');
  try {
    const log=await request(ls.get(logId));if(!log?.before)throw new Error('This review can no longer be undone.');
    const card=await request(cs.get(log.cardId));
    if(!card || card.revision!==log.afterRevision)throw new Error('This card has changed since that review. Undo would overwrite newer work.');
    // Keep revisions monotonic so a stale editor cannot become current again after undo.
    cs.put({...log.before,revision:card.revision+1,updatedAt:Date.now()});ls.delete(logId);await done;
  }catch(e){try{t.abort();}catch{}await done.catch(()=>{});throw e;}
}
export async function rememberTranslation(item) {
  const t=tx(['history'],'readwrite'),done=finished(t),s=t.objectStore('history');
  const entries=await request(s.getAll());
  const id=[item.sourceLang,item.targetLang,item.front].join('\u001f');
  s.put({...item,id,at:Date.now()});
  for(const old of entries.sort((a,b)=>b.at-a.at).slice(49))if(old.id!==id)s.delete(old.id);
  await done;
}
export async function cacheGet(id) {
  const entry=await request(tx(['cache']).objectStore('cache').get(id));
  return entry && Date.now()-entry.at<30*86400000 ? entry.value : null;
}
export async function cachePut(id,value) {
  const t=tx(['cache'],'readwrite'),done=finished(t),s=t.objectStore('cache');
  const entries=await request(s.getAll());s.put({id,value,at:Date.now()});
  for(const old of entries.sort((a,b)=>b.at-a.at).slice(199))if(old.id!==id)s.delete(old.id);
  await done;
}
export async function clearTranslationHistory() {const t=tx(['cache','history'],'readwrite'),done=finished(t);t.objectStore('cache').clear();t.objectStore('history').clear();await done;}
export async function mergeImport(data) {
  const t=tx(['cards','logs'],'readwrite'),done=finished(t),cs=t.objectStore('cards'),ls=t.objectStore('logs');
  let added=0,duplicates=0;const accepted=new Set();
  try {
    for(const c of data.cards){
      const key=identity(c),existing=await request(cs.index('identity').get(key));
      if(existing || await request(cs.get(c.id))){duplicates++;continue;}
      cs.add({...c,identity:key});accepted.add(c.id);added++;
    }
    // Only attach history for newly imported cards. Never rewrite an existing learner's schedule.
    for(const l of data.logs)if(accepted.has(l.cardId) && !(await request(ls.get(l.id))))ls.add(l);
    await done;return {added,duplicates};
  }catch(e){try{t.abort();}catch{}await done.catch(()=>{});throw e;}
}
export async function clearAll() {const names=['cards','logs','meta','cache','history'];const t=tx(names,'readwrite'),done=finished(t);for(const n of names)t.objectStore(n).clear();await done;}
