/* Mostafa OS service worker: opens without internet + shows the push notifications.
   Page = network first (so updates land fast), cached copy when offline. */
const CACHE='mos-v12';
const CORE=['./','./index.html','./plan.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  if(u.origin===location.origin){
    e.respondWith((async()=>{const c=await caches.open(CACHE);
      try{const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),4000);const res=await fetch(r,{signal:ctl.signal});clearTimeout(t);
        if(res.ok)c.put(r.mode==='navigate'?'./index.html':r,res.clone());return res;}
      catch(err){return (await c.match(r.mode==='navigate'?'./index.html':r,{ignoreSearch:true}))||(await c.match('./index.html'))||Response.error();}})());
    return;}
  if(/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)){
    e.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(r);const net=fetch(r).then(res=>{if(res.ok||res.type==='opaque')c.put(r,res.clone());return res;}).catch(()=>hit);return hit||net;}));}
});

/* ---------- push notifications (sent on schedule by the GitHub Action) ---------- */
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{};}catch(x){d={body:e.data?e.data.text():''};}
  const title=d.title||'Mostafa OS';
  const opts={body:d.body||'افتح يومك',icon:'icon-192.png',badge:'icon-192.png',tag:d.tag||('mos-'+(d.k||'n')),renotify:true,
    lang:'ar',dir:'rtl',data:{go:d.go||'day',k:d.k||'',at:Date.now()},requireInteraction:d.k==='wake'||d.k==='fajr'};
  e.waitUntil((async()=>{
    await self.registration.showNotification(title,opts);
    try{const c=await caches.open('mos-meta');await c.put('./__lastpush',new Response(JSON.stringify({t:Date.now(),k:d.k||''})));}catch(x){}
  })());
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const go=(e.notification.data&&e.notification.data.go)||'day';
  const url=new URL('./?go='+encodeURIComponent(go),self.registration.scope).href;
  e.waitUntil((async()=>{
    const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of all){if(c.url.startsWith(self.registration.scope)){try{await c.focus();}catch(x){}c.postMessage({type:'mos-go',go});return;}}
    await self.clients.openWindow(url);
  })());
});
/* subscription rotated by the browser: keep it working and tell the app so it can show a fresh code */
self.addEventListener('pushsubscriptionchange',e=>{
  e.waitUntil((async()=>{try{const old=e.oldSubscription;const key=old&&old.options&&old.options.applicationServerKey;
    if(key){await self.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});}
    const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});all.forEach(c=>c.postMessage({type:'mos-subchanged'}));}catch(x){}})());
});
