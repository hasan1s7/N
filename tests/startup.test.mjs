/** Startup/repair regression tests. VM fixtures are not a real browser's storage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
const ROOT=new URL('../',import.meta.url);
const BUILD='nabu-startup-20261104-r2';
const read=name=>fs.readFile(new URL(name,ROOT),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let serial=0;
function mockProperty(t,object,key,value){const previous=Object.getOwnPropertyDescriptor(object,key);Object.defineProperty(object,key,{value,writable:true,configurable:true});t.after(()=>{if(previous)Object.defineProperty(object,key,previous);else delete object[key];});}
const loadStore=()=>import(new URL(`../public/nabu-store.js?startup-test=${++serial}`,import.meta.url));
function fakeDB(){return {closed:0,close(){this.closed++;},objectStoreNames:{contains:()=>true},transaction(){return {objectStore(){return {getAll(){const request={result:[]};queueMicrotask(()=>request.onsuccess?.());return request;},get(){const request={result:undefined};queueMicrotask(()=>request.onsuccess?.());return request;}};}};}};}

test('shipping index has no external JS/CSS startup dependencies',async()=>{
 const html=await read('public/index.html');
 assert.doesNotMatch(html,/<script[^>]+src=/i);
 assert.doesNotMatch(html,/<link[^>]+rel="stylesheet"/i);
 assert.match(html,/data-nabu-build="nabu-startup-20261104-r2"/);
 assert.match(html,/<details class="startup-help">/);
 assert.match(html,/href="\.\/nabu-repair.html"/);
});
test('index and repair exact scripts/styles are authorized by SHA-256 CSP',async()=>{
 for(const name of ['index.html','nabu-repair.html']){
  const html=await read('public/'+name), csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.doesNotMatch(csp,/'unsafe-inline'|'unsafe-eval'/);
  for(const [,source] of html.matchAll(/<(?:script|style)[^>]*>([\s\S]*?)<\/(?:script|style)>/g)){
   const hash=crypto.createHash('sha256').update(source).digest('base64');
   assert.ok(csp.includes(`'sha256-${hash}'`));
  }
 }
});
test('application and independent startup guard parse as classic scripts',async()=>{
 const html=await read('public/index.html');
 for(const [,source] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(source);
});
test('openStore preserves the original database name and version',async t=>{
 const connection=fakeDB();let argumentsUsed;
 mockProperty(t,globalThis,'indexedDB',{open(...args){argumentsUsed=args;const req={result:connection};queueMicrotask(()=>req.onsuccess());return req;}});
 const store=await loadStore();await store.openStore();
 assert.deepEqual(argumentsUsed,['nabu-translate-remember',1]);
 assert.deepEqual(await store.snapshot(),{cards:[],logs:[],history:[]});
 assert.equal(await store.getMeta('settings','fallback'),'fallback');
});
test('simultaneous open calls share one pending request',async t=>{
 let opens=0;const connection=fakeDB();
 mockProperty(t,globalThis,'indexedDB',{open(){opens++;const req={result:connection};queueMicrotask(()=>req.onsuccess());return req;}});
 const store=await loadStore(),first=store.openStore(),second=store.openStore();
 assert.equal(first,second);assert.equal(await first,connection);await store.openStore();assert.equal(opens,1);
});
test('unavailable IndexedDB is a recoverable, explicit error',async t=>{
 mockProperty(t,globalThis,'indexedDB',undefined);
 const store=await loadStore();await assert.rejects(store.openStore(),/storage.*unavailable|access browser storage/i);
});
test('blocked upgrades reject and close a later successful connection',async t=>{
 let req;const connection=fakeDB();
 mockProperty(t,globalThis,'indexedDB',{open(){req={result:connection};queueMicrotask(()=>req.onblocked());return req;}});
 const store=await loadStore();await assert.rejects(store.openStore(),/Another Nabu tab/);
 req.onsuccess();assert.equal(connection.closed,1);
});
test('open timeout rejects without deleting or resetting any database',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let deleted=false,req;const connection=fakeDB();
 mockProperty(t,globalThis,'indexedDB',{open(){return req={result:connection};},deleteDatabase(){deleted=true;}});
 const store=await loadStore();const rejected=assert.rejects(store.openStore(),/not responding/);
 t.mock.timers.tick(8001);await rejected;
 assert.equal(deleted,false);req.onsuccess();assert.equal(connection.closed,1);
});
test('failed open can retry successfully without fallback storage',async t=>{
 let count=0;const connection=fakeDB();
 mockProperty(t,globalThis,'indexedDB',{open(){const req={result:connection,error:new Error('Temporary failure')};queueMicrotask(()=>++count===1?req.onerror():req.onsuccess());return req;}});
 const store=await loadStore();await assert.rejects(store.openStore(),/Temporary failure/);assert.equal(await store.openStore(),connection);
});
test('versionchange closes connection and next open gets a new connection',async t=>{
 const one=fakeDB(),two=fakeDB();let opens=0;
 mockProperty(t,globalThis,'indexedDB',{open(){const req={result:opens++===0?one:two};queueMicrotask(()=>req.onsuccess());return req;}});
 const store=await loadStore();await store.openStore();one.onversionchange();assert.equal(one.closed,1);assert.equal(await store.openStore(),two);
});

async function worker(){
 const handlers={},data=new Map(),events={skip:0,claim:0};
 const caches={async keys(){return [...data.keys()];},async open(name){if(!data.has(name))data.set(name,new Map());const map=data.get(name);return {async put(key,response){map.set(typeof key==='string'?key:key.url,response.clone());},async match(key){const value=map.get(typeof key==='string'?key:key.url);return value?.clone();},async keys(){return [...map.keys()].map(url=>({url}));},async delete(key){return map.delete(typeof key==='string'?key:key.url);}};}};
 const sandbox={URL,Response,AbortController,Set,console,setTimeout,clearTimeout,caches,fetch:async()=>new Response(`<html data-nabu-build="${BUILD}">working app</html>`,{headers:{'content-type':'text/html'}}),self:{location:{href:'https://example.test/nabu/nabu-sw.js'},addEventListener(name,handler){handlers[name]=handler;},async skipWaiting(){events.skip++;},clients:{async claim(){events.claim++;}}}};
 vm.runInNewContext(await read('public/nabu-sw.js'),sandbox);
 return {sandbox,handlers,caches,data,events};
}
async function lifecycle(w,name){let pending;w.handlers[name]({waitUntil(promise){pending=promise;}});await pending;}
function fetchEvent(w,path,mode='navigate',method='GET'){let pending;w.handlers.fetch({request:{url:'https://example.test'+path,mode,method},respondWith(promise){pending=promise;}});return pending;}
test('worker install only accepts the matching self-contained release',async()=>{
 const w=await worker();await lifecycle(w,'install');assert.equal(w.events.skip,1);assert.equal(w.data.size,1);
 const bad=await worker();bad.sandbox.fetch=async()=>new Response('<html>old deployment</html>',{headers:{'content-type':'text/html'}});
 await assert.rejects(lifecycle(bad,'install'),/has not deployed yet/);assert.equal(bad.events.skip,0);
});
test('worker navigation checks the network instead of pinning a stale shell',async()=>{
 const w=await worker();await lifecycle(w,'install');let calls=0;
 w.sandbox.fetch=async()=>{calls++;return new Response(`<html data-nabu-build="${BUILD}">fresh network</html>`,{headers:{'content-type':'text/html'}});};
 assert.match(await (await fetchEvent(w,'/nabu/')).text(),/fresh network/);assert.equal(calls,1);
});
test('worker retains an offline fallback for the self-contained app',async()=>{
 const w=await worker();await lifecycle(w,'install');w.sandbox.fetch=async()=>{throw new Error('Offline');};
 assert.match(await (await fetchEvent(w,'/nabu/index.html?view=review')).text(),/working app/);
});
test('worker does not intercept repair, API, other paths, or translations',async()=>{
 const w=await worker();
 for(const path of ['/nabu/nabu-repair.html','/nabu/api/config','/different/','/nabu/nabu-app.js'])assert.equal(fetchEvent(w,path),undefined);
 assert.equal(fetchEvent(w,'/nabu/','navigate','POST'),undefined);
 assert.equal(fetchEvent(w,'/nabu/','cors'),undefined);
});
test('worker activation prunes only its own shell paths',async()=>{
 const w=await worker();const cache=await w.caches.open('nabu-translate-shell-v1');
 await cache.put('https://example.test/nabu/index.html',new Response('old'));
 await cache.put('https://example.test/another-project/index.html',new Response('other'));
 const other=await w.caches.open('unrelated-cache');await other.put('https://example.test/nabu/test',new Response('untouched'));
 await lifecycle(w,'activate');assert.equal(await cache.match('https://example.test/nabu/index.html'),undefined);
 assert.equal(await (await cache.match('https://example.test/another-project/index.html')).text(),'other');
 assert.equal(await (await other.match('https://example.test/nabu/test')).text(),'untouched');assert.equal(w.events.claim,1);
});
async function repair(){
 const status={textContent:''},unregistered=[],deleted=[],redirects=[];
 const requests=[{url:'https://example.test/nabu/index.html'},{url:'https://example.test/another-project/index.html'}];
 const sandbox={URL,Promise,String,Date,setTimeout,clearTimeout,document:{getElementById(){return status;}},location:{href:'https://example.test/nabu/nabu-repair.html',replace(url){redirects.push(url);}},navigator:{serviceWorker:{async getRegistrations(){return ['/nabu/','/other/','/'].map(path=>({scope:'https://example.test'+path,async unregister(){unregistered.push(path);return true;}}));}}},caches:{async keys(){return ['nabu-translate-shell-v1','another-app-cache'];},async open(name){return {async keys(){return requests;},async delete(request){deleted.push([name,request.url]);return true;}};}}};
 sandbox.window=sandbox;vm.runInNewContext(await read('tools/repair.js'),sandbox);await tick();await tick();
 return {status,unregistered,deleted,redirects};
}
test('repair unregisters only this Nabu path, never the origin root or other apps',async()=>{
 const result=await repair();assert.deepEqual(result.unregistered,['/nabu/']);
});
test('repair removes only Nabu shell requests and then navigates home',async()=>{
 const result=await repair();assert.deepEqual(result.deleted,[['nabu-translate-shell-v1','https://example.test/nabu/index.html']]);
 assert.equal(result.redirects.length,1);assert.match(result.redirects[0],/^https:\/\/example\.test\/nabu\/\?nabu-repaired=/);
});
test('repair and worker do not call database deletion or browser-data reset APIs',async()=>{
 for(const file of ['tools/repair.js','public/nabu-sw.js'])assert.doesNotMatch(await read(file),/deleteDatabase|localStorage\.clear|sessionStorage\.clear|Clear-Site-Data/i);
});
