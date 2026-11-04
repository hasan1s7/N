/** Nabu's portable, dependency-free domain layer. All stored timestamps are epoch ms. */
export const VERSION = 1;
export const DAY = 86400000;
export const MINUTE = 60000;
export const MAX_TEXT = 2000;
export const LANGUAGES = Object.freeze([
  ['en', 'English', 'EN'], ['ar', 'Arabic', 'AR'], ['zh-CN', 'Chinese', 'ZH'],
  ['fr', 'French', 'FR'], ['ru', 'Russian', 'RU'], ['es', 'Spanish', 'ES'],
  ['de', 'German', 'DE'], ['it', 'Italian', 'IT'], ['ja', 'Japanese', 'JA'],
  ['ko', 'Korean', 'KO'], ['pt', 'Portuguese', 'PT'], ['tr', 'Turkish', 'TR']
]);
export const languageName = code => LANGUAGES.find(l => l[0] === code)?.[1] || code;
export const languageCode = code => LANGUAGES.find(l => l[0] === code)?.[2] || code;
export const isLanguage = code => LANGUAGES.some(l => l[0] === code);
export const uid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure randomness is unavailable. Open Nabu on its HTTPS website.');
  const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
};
export const normalize = text => String(text).normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
export const searchText = text => normalize(text).normalize('NFD').replace(/\p{M}/gu, '');
export const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function text(value, name, max, required = false) {
  if (typeof value !== 'string') { if (!required && value == null) return ''; throw new Error(`${name} must be text.`); }
  const result = value.normalize('NFC').trim();
  if (required && !result) throw new Error(`${name} is required.`);
  if (result.length > max) throw new Error(`${name} must be ${max} characters or fewer.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(result)) throw new Error(`${name} contains unsupported control characters.`);
  return result;
}
export function cardContent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid card.');
  if (!isLanguage(input.sourceLang) || !isLanguage(input.targetLang)) throw new Error('Choose supported source and translation languages.');
  if (input.sourceLang === input.targetLang) throw new Error('The two card languages must be different.');
  const rawTags = Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(',');
  if (rawTags.length > 12) throw new Error('Use no more than 12 tags.');
  return {
    front: text(input.front, 'Word or phrase', 1000, true),
    back: text(input.back, 'Meaning', 1000, true),
    sourceLang: input.sourceLang, targetLang: input.targetLang,
    context: text(input.context, 'Context', 1500), note: text(input.note, 'Note', 1000),
    deck: text(input.deck || 'My words', 'Collection', 64, true),
    tags: [...new Set(rawTags.map(t => text(t, 'Tag', 32)).filter(Boolean))],
    attribution: text(input.attribution, 'Attribution', 80)
  };
}
// Meaning is part of identity: a polysemous word can have several legitimate cards.
// Collection is not part of identity, so importing into another deck does not duplicate it.
export const identity = c => [c.sourceLang, c.targetLang, normalize(c.front), normalize(c.back)].join('\u001f');
export function newCard(input, now = Date.now()) {
  return { ...cardContent(input), id: uid(), createdAt: now, updatedAt: now, revision: 0,
    archived: false, schedule: { algorithm: 'nabu-srs-v1', state: 'new', step: 0, due: now,
      interval: 0, ease: 2.5, reps: 0, lapses: 0, lastReview: null } };
}
export function reverseCard(card, now = Date.now()) {
  return newCard({ ...card, front: card.back, back: card.front, sourceLang: card.targetLang,
    targetLang: card.sourceLang, context: '', note: card.note }, now);
}
/**
 * Explicit SM-2-inspired policy, NOT FSRS and NOT an exact Anki scheduler.
 * Learning: Again 1m; Hard 5m; Good 10m then 1d; Easy 4d.
 * Review: Hard 1.2x; Good ease*x; Easy 1.3*ease*x; lapse -> 10m relearning.
 * No efficacy estimate is inferred from these intervals. See ENGINEERING.md.
 */
export function scheduleReview(schedule, rating, now = Date.now()) {
  if (![1, 2, 3, 4].includes(rating)) throw new Error('Rating must be Again, Hard, Good, or Easy.');
  if (!Number.isFinite(now)) throw new Error('Invalid review time.');
  const s = { ...schedule, reps: schedule.reps + 1, lastReview: now };
  let delay;
  if (schedule.state === 'new' || schedule.state === 'learning') {
    s.state = 'learning';
    if (rating === 1) { s.step = 0; delay = MINUTE; }
    if (rating === 2) { delay = 5 * MINUTE; }
    if (rating === 3 && schedule.step < 1) { s.step = 1; delay = 10 * MINUTE; }
    else if (rating === 3) { s.state = 'review'; s.interval = 1; delay = DAY; }
    if (rating === 4) { s.state = 'review'; s.interval = 4; delay = 4 * DAY; }
  } else if (schedule.state === 'relearning') {
    if (rating === 1) { delay = MINUTE; }
    else if (rating === 2) { delay = 5 * MINUTE; }
    else { s.state = 'review'; s.interval = Math.max(1, Math.round(schedule.interval * (rating === 4 ? 0.8 : 0.5))); delay = s.interval * DAY; }
  } else if (schedule.state === 'review') {
    if (rating === 1) {
      s.state = 'relearning'; s.step = 0; s.lapses += 1;
      s.ease = Math.max(1.3, s.ease - 0.2); delay = 10 * MINUTE;
    } else {
      // Strict ordering avoids identical Hard/Good/Easy previews on young cards.
      const hard = Math.max(schedule.interval + 1, Math.ceil(schedule.interval * 1.2));
      const good = Math.max(hard + 1, Math.ceil(schedule.interval * schedule.ease));
      const easy = Math.max(good + 1, Math.ceil(schedule.interval * schedule.ease * 1.3));
      s.interval = Math.min(36500, {2:hard, 3:good, 4:easy}[rating]);
      s.ease = clamp(s.ease + ({2:-0.15, 3:0, 4:0.15}[rating]), 1.3, 3.5);
      delay = s.interval * DAY;
    }
  } else throw new Error('Unsupported scheduler state.');
  s.due = now + delay;
  return s;
}
export function intervalLabel(ms) {
  if (ms < MINUTE) return '<1m';
  if (ms < 60 * MINUTE) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.round(ms / (60 * MINUTE))}h`;
  if (ms < 365 * DAY) return `${Math.round(ms / DAY)}d`;
  return `${(ms / (365 * DAY)).toFixed(1)}y`;
}
export function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function dueCards(cards, logs = [], now = Date.now(), newLimit = 10) {
  const today = localDay(now);
  const introduced = new Set(logs.filter(l => localDay(l.at) === today && l.before?.schedule?.state === 'new').map(l => l.cardId));
  const remaining = Math.max(0, newLimit - introduced.size);
  const active = cards.filter(c => !c.archived && c.schedule.due <= now);
  const rank = { relearning:0, learning:1, review:2 };
  const reviews = active.filter(c => c.schedule.state !== 'new').sort((a,b) =>
    (rank[a.schedule.state] - rank[b.schedule.state]) || a.schedule.due - b.schedule.due || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const fresh = active.filter(c => c.schedule.state === 'new').sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, remaining);
  return [...reviews, ...fresh];
}
export function statistics(cards, logs, now = Date.now()) {
  const active = cards.filter(c => !c.archived);
  const todayLogs = logs.filter(l => localDay(l.at) === localDay(now));
  const counts = new Map();
  for (const l of logs) counts.set(localDay(l.at), (counts.get(localDay(l.at)) || 0) + 1);
  const week = [];
  for (let i=6; i>=0; i--) { const d = new Date(now); d.setDate(d.getDate()-i); week.push({day:localDay(d.getTime()), count:counts.get(localDay(d.getTime())) || 0}); }
  let streak = 0;
  const d = new Date(now);
  if (!counts.has(localDay(now))) d.setDate(d.getDate()-1);
  for (let i=0; i<36500 && counts.has(localDay(d.getTime())); i++) { streak++; d.setDate(d.getDate()-1); }
  return { total:active.length, reviewedToday:todayLogs.length, distinctToday:new Set(todayLogs.map(l=>l.cardId)).size,
    streak, week, reviewTotal:logs.length, recallRate:logs.length ? Math.round(logs.filter(l=>l.rating > 1).length/logs.length*100) : null };
}
export function chunkText(value, maxBytes = 480) {
  if (maxBytes < 4) throw new Error('Chunk size must allow a UTF-8 character.');
  const chunks = []; let chunk = '';
  const size = x => new TextEncoder().encode(x).length;
  // Prefer whitespace/sentence boundaries without dropping or duplicating a character.
  const tokens = value.match(/\S+\s*|\s+/gu) || [];
  for (const token of tokens) {
    if (size(token) <= maxBytes) {
      if (size(chunk + token) > maxBytes) { if (chunk) chunks.push(chunk); chunk = ''; }
      chunk += token;
    } else {
      if (chunk) chunks.push(chunk); chunk = '';
      for (const char of token) {
        if (size(chunk + char) > maxBytes) { chunks.push(chunk); chunk = ''; }
        chunk += char;
      }
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
export function sharePayload(card, sender = '') {
  const c = cardContent(card);
  return { v:1, type:'nabu-word', sender:text(sender, 'Sender name', 40),
    card:{front:c.front,back:c.back,sourceLang:c.sourceLang,targetLang:c.targetLang,context:c.context} };
}
export function encodeShare(card, sender) {
  const bytes = new TextEncoder().encode(JSON.stringify(sharePayload(card, sender)));
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if (token.length > 8000) throw new Error('This card is too long for a share link. Shorten the phrase or context.');
  return token;
}
export function decodeShare(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,8000}$/.test(token)) throw new Error('This word link is invalid or too long.');
  let payload;
  try { const binary = atob(token.replace(/-/g,'+').replace(/_/g,'/')); payload = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))); }
  catch { throw new Error('This word link is damaged. Ask your friend to send it again.'); }
  if (payload?.v !== 1 || payload?.type !== 'nabu-word') throw new Error('This word link uses an unsupported version.');
  const sender = text(payload.sender, 'Sender name', 40);
  const c = cardContent({ ...payload.card, deck:'From friends', note:'', tags:[], attribution:sender ? `${sender} (unverified link)` : 'Shared link' });
  return { sender, card:c };
}
const finite = (n, min, max, fallback) => Number.isFinite(n) && n >= min && n <= max ? n : fallback;
export function restoreCard(raw, now = Date.now()) {
  const fresh = newCard(raw, now);
  const s = raw.schedule;
  if (!s) return fresh;
  if (s.algorithm !== 'nabu-srs-v1') throw new Error('Unsupported review algorithm in backup.');
  if (!['new','learning','review','relearning'].includes(s.state)) throw new Error('Invalid review state in backup.');
  const since = Date.UTC(2000,0,1), until = Date.UTC(2200,0,1);
  const numeric = { due:[since,until], interval:[0,36500], ease:[1.3,3.5], reps:[0,1000000], lapses:[0,1000000], step:[0,1] };
  for (const [k,[min,max]] of Object.entries(numeric)) {
    if (!Number.isFinite(s[k]) || s[k] < min || s[k] > max) throw new Error(`Invalid ${k} in backup.`);
  }
  for (const k of ['reps','lapses','step']) if (!Number.isInteger(s[k])) throw new Error(`Invalid ${k} in backup.`);
  if (s.lapses > s.reps) throw new Error('Invalid lapse count in backup.');
  if (s.lastReview !== null && (!Number.isFinite(s.lastReview) || s.lastReview < since || s.lastReview > until)) throw new Error('Invalid last review in backup.');
  return {...fresh, id:/^[a-zA-Z0-9-]{1,80}$/.test(raw.id) ? raw.id : fresh.id,
    createdAt:finite(raw.createdAt,since,until,now), updatedAt:finite(raw.updatedAt,since,until,now),
    revision:Math.floor(finite(raw.revision,0,1000000,0)), archived:raw.archived === true,
    schedule:{algorithm:'nabu-srs-v1',state:s.state,step:s.step,due:s.due,interval:s.interval,ease:s.ease,reps:s.reps,lapses:s.lapses,lastReview:s.lastReview} };
}
export function exportTSV(cards) {
  const clean = s => {const value=String(s || '').replace(/[\t\r\n]+/g,' ');return value.includes('"') ? '"'+value.replace(/"/g,'""')+'"' : value;};
  // Four mappable Anki fields; metadata comments are understood by Anki.
  return '#separator:Tab\n#html:false\n#columns:Front\tBack\tContext\tTags\n' + cards.filter(c=>!c.archived).map(c=>[c.front,c.back,c.context,c.tags.map(t=>t.replace(/\s+/gu,'_')).join(' ')].map(clean).join('\t')).join('\n');
}
export function parseDelimited(input) {
  const str = input.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  const lines = str.split('\n');
  while (lines.length && (!lines[0].trim() || /^#(?:separator|html|columns|notetype|deck|tags):/i.test(lines[0]))) lines.shift();
  const body = lines.join('\n'); let delimiter=',', scanningQuote=false;
  for(let i=0;i<body.length;i++){const ch=body[i];if(ch==='"'){if(scanningQuote&&body[i+1]==='"')i++;else scanningQuote=!scanningQuote;}else if(!scanningQuote&&ch==='\t'){delimiter='\t';break;}else if(!scanningQuote&&ch==='\n')break;}
  const rows = []; let row = [], field = '', quoted = false;
  for (let i=0;i<body.length;i++) {
    const c = body[i];
    if (c === '"') { if (quoted && body[i+1] === '"') {field += '"';i++;} else if (quoted || !field) quoted = !quoted; else field += c; }
    else if (c === delimiter && !quoted) {row.push(field);field='';}
    else if (c === '\n' && !quoted) {row.push(field); if(row.some(f=>f.trim()))rows.push(row); row=[];field='';}
    else field += c;
  }
  if (quoted) throw new Error('An import field has an unclosed quote.');
  row.push(field); if(row.some(f=>f.trim()))rows.push(row);
  return rows;
}
export function parseImport(input, defaults, now = Date.now()) {
  if (typeof input !== 'string' || new TextEncoder().encode(input).length > 5 * 1024 * 1024) throw new Error('Choose a backup smaller than 5 MB.');
  const trimmed = input.replace(/^\uFEFF/,'').trim();
  let cards, logs = [], settings = null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let value; try {value=JSON.parse(trimmed);} catch {throw new Error('The JSON file is not valid.');}
    if (Array.isArray(value)) cards = value.map(c=>newCard({...defaults,...c},now));
    else {
      if (value.app !== 'nabu' || value.version !== VERSION || !Array.isArray(value.cards)) throw new Error('Unsupported Nabu backup.');
      cards = value.cards.map(c=>restoreCard(c,now));
      if (Array.isArray(value.logs)) {
        if (value.logs.length > 100000) throw new Error('The backup has too many review events.');
        const ids = new Set(cards.map(c=>c.id));
        logs = value.logs.filter(l=>l && ids.has(l.cardId) && Number.isFinite(l.at) && l.at>=Date.UTC(2000,0,1) && l.at<=Date.UTC(2200,0,1) && [1,2,3,4].includes(l.rating)).map(l=>({
          id:/^[a-zA-Z0-9-]{1,80}$/.test(l.id) ? l.id : uid(), cardId:l.cardId, at:l.at, rating:l.rating,
          before:l.before ? restoreCard(l.before,now) : null,
          afterRevision:Math.floor(finite(l.afterRevision,0,1000000,0)), durationMs:finite(l.durationMs,0,DAY,0)
        }));
      }
      // Never restore network endpoints, tokens, or account settings from a file.
      if (value.settings && typeof value.settings === 'object') settings = {
        alias:text(value.settings.alias,'Display name',40), newLimit:Math.round(finite(value.settings.newLimit,1,100,10)),
        sourceLang:isLanguage(value.settings.sourceLang) ? value.settings.sourceLang : defaults.sourceLang,
        targetLang:isLanguage(value.settings.targetLang) ? value.settings.targetLang : defaults.targetLang
      };
    }
  } else {
    let rows = parseDelimited(trimmed);
    if (normalize(rows[0]?.[0] || '') === 'front' && normalize(rows[0]?.[1] || '') === 'back') rows = rows.slice(1);
    cards = rows.map((r,i)=>{
      if(r.length < 2) throw new Error(`Row ${i+1} needs a word and a meaning.`);
      try {return newCard({...defaults,front:r[0],back:r[1],context:r[2] || '',tags:(r[3] || '').split(/[, ]+/)},now);}
      catch(e){throw new Error(`Row ${i+1}: ${e.message}`);}
    });
  }
  if (!cards.length) throw new Error('There are no cards in this file.');
  if (cards.length > 10000) throw new Error('Import no more than 10,000 cards at a time.');
  const ids = new Set(); for(const c of cards){if(ids.has(c.id))throw new Error('Duplicate card IDs in backup.');ids.add(c.id);}
  return {cards,logs,settings};
}
export function backup(cards, logs, settings, now=Date.now()) {
  return JSON.stringify({app:'nabu',version:VERSION,exportedAt:new Date(now).toISOString(),cards,logs,
    settings:{alias:settings.alias,newLimit:settings.newLimit,sourceLang:settings.sourceLang,targetLang:settings.targetLang}},null,2);
}
export const STARTERS = Object.freeze([
  {front:'sobremesa',back:'conversation at the table after a meal',sourceLang:'es',targetLang:'en',context:'La sobremesa se alarg\u00f3 hasta las cinco.',note:'A cultural noun; the English explanation is not a one-word equivalent.'},
  {front:'prendre son temps',back:"to take one's time",sourceLang:'fr',targetLang:'en',context:'Tu peux prendre ton temps.'},
  {front:'\u0635\u0628\u0627\u062d \u0627\u0644\u062e\u064a\u0631',back:'good morning',sourceLang:'ar',targetLang:'en',context:''},
  {front:'\u4f60\u597d',back:'hello',sourceLang:'zh-CN',targetLang:'en',context:''},
  {front:'\u0441\u043f\u0430\u0441\u0438\u0431\u043e',back:'thank you',sourceLang:'ru',targetLang:'en',context:''}
]);
