/* Mostafa OS service worker: opens without internet + shows the push notifications.
   Page = network first (so updates land fast), cached copy when offline. */
const CACHE='mos-v14';
const CORE=['./','./index.html','./plan.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!=='mos-meta'&&k.indexOf('mos-quran')!==0).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  /* the Quran text: downloaded once, then kept in the phone's storage (its own cache, survives app updates) and read from there */
  if(u.origin===location.origin&&/\/quran\.json$/.test(u.pathname)){
    e.respondWith((async()=>{const c=await caches.open('mos-quran-v1');const hit=await c.match(r,{ignoreSearch:true});if(hit)return hit;
      const res=await fetch(r);if(res.ok)await c.put(r,res.clone());return res;})());
    return;}
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
  /* Android: each reminder has its own vibration rhythm, so you know it without looking */
  const VIB={fajr:[400,150,400,150,800],dhuhr:[300,120,300],asr:[300,120,300],maghrib:[300,120,300],isha:[300,120,300],wake:[100,80,100,80,100,80,500],train:[60,60,60,60,400],walk:[600],breakfast:[80,40,80,40,80],leave:[200,100,600],focus:[60,300,60],home:[400,200,200],moti:[50,50,50,50,50,50,50],story:[700,200,100],read:[150,150,150],review:[100,400,100],wind:[500,300,300,300,150],sleep:[1000],away:[100,600,100,600,100],dhikr:[200,200,200,200,200],azkar_m:[250,150,250],azkar_e:[250,150,250],friday:[300,120,300]};
  const opts={body:d.body||'افتح يومك',icon:'icon-192.png',badge:'icon-192.png',tag:d.tag||('mos-'+(d.k||'n')),renotify:true,
    vibrate:VIB[d.k]||[200,100,200],lang:'ar',dir:'rtl',data:{go:d.go||'day',k:d.k||'',body:d.body||'',at:Date.now()},requireInteraction:d.k==='wake'||d.k==='fajr'};
  e.waitUntil((async()=>{
    await self.registration.showNotification(title,opts);
    try{const c=await caches.open('mos-meta');await c.put('./__lastpush',new Response(JSON.stringify({t:Date.now(),k:d.k||''})));}catch(x){}
    try{const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});all.forEach(c=>c.postMessage({type:'mos-cue',k:d.k||'',body:d.body||''}));}catch(x){}
  })());
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const nd=e.notification.data||{};const go=nd.go||'day';
  const url=new URL('./?go='+encodeURIComponent(go),self.registration.scope).href;
  e.waitUntil((async()=>{
    try{const m=await caches.open('mos-meta');await m.put('./__cue',new Response(JSON.stringify({k:nd.k||'',body:nd.body||'',t:Date.now()})));}catch(x){}
    const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of all){if(c.url.startsWith(self.registration.scope)){try{await c.focus();}catch(x){}c.postMessage({type:'mos-go',go,k:nd.k||'',body:nd.body||''});return;}}
    await self.clients.openWindow(url);
  })());
});
/* subscription rotated by the browser: keep it working and tell the app so it can show a fresh code */
self.addEventListener('pushsubscriptionchange',e=>{
  e.waitUntil((async()=>{try{const old=e.oldSubscription;const key=old&&old.options&&old.options.applicationServerKey;
    if(key){await self.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});}
    const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});all.forEach(c=>c.postMessage({type:'mos-subchanged'}));}catch(x){}})());
});
