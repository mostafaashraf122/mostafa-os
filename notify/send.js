/* Mostafa OS · notification sender (runs inside the GitHub Action).
   - Reads the MOS_PUSH secret (keys you copied once from the app).
   - Reads your latest settings that the app syncs on its own (encrypted, branch "push-config"),
     so a new wake-up time, city or phone subscription takes effect within minutes, no re-copying.
   - Gets the official prayer times from the internet (Aladhan), falls back to the built-in calculation.
   - Sends each reminder in this run's 3-hour window at its exact minute as a Web Push. */
'use strict';
const crypto=require('crypto');
const webpush=require('web-push');
const Plan=require('../plan.js');

const WIN=3*3600e3, LEAD=10*60e3, STALE=20*60e3, RELOAD=10*60e3;
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
const b64u=s=>Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'),'base64');

function readSecret(){
  const raw=(process.env.MOS_PUSH||'').trim();
  if(!raw){console.log('::warning::MOS_PUSH secret is missing. Open the app → المزيد → الإشعارات, copy the code, and add it as a repository secret named MOS_PUSH.');process.exit(0);}
  let j;try{j=JSON.parse(b64u(raw).toString('utf8'));}catch(e){console.log('::error::MOS_PUSH is not a valid code. Copy it again from the app.');process.exit(1);}
  if(!j||!j.pub||!j.priv){console.log('::error::MOS_PUSH is incomplete. Copy it again from the app.');process.exit(1);}
  return j;}

async function getJSON(url,headers,ms){const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),ms||10000);
  try{const r=await fetch(url,{headers:Object.assign({'User-Agent':'mostafa-os'},headers||{}),signal:ctl.signal});if(!r.ok)return {status:r.status};return {status:r.status,json:await r.json()};}
  catch(e){return {status:0,error:e.message};}finally{clearTimeout(t);}}

/* the settings the app synced (encrypted with the key that only lives in your phone + this secret) */
async function remoteConfig(S){
  if(!S.ek||!S.repo)return null;
  const h={Accept:'application/vnd.github+json'};if(process.env.GH_TOKEN)h.Authorization='Bearer '+process.env.GH_TOKEN;
  const r=await getJSON('https://api.github.com/repos/'+S.repo+'/contents/config.enc?ref='+(S.branch||'push-config')+'&t='+Date.now(),h);
  if(!r.json||!r.json.content){log('no synced settings yet (',r.status,')');return null;}
  try{const txt=Buffer.from(r.json.content,'base64').toString('utf8').trim();const [v,iv,ct]=txt.split('.');if(v!=='v2')throw new Error('format');
    const buf=b64u(ct),key=b64u(S.ek);const d=crypto.createDecipheriv('aes-256-gcm',key,b64u(iv));d.setAuthTag(buf.subarray(buf.length-16));
    const j=JSON.parse(Buffer.concat([d.update(buf.subarray(0,buf.length-16)),d.final()]).toString('utf8'));
    log('synced settings from',new Date(j.t).toISOString());return j;}
  catch(e){log('could not read synced settings:',e.message);return null;}}

/* official prayer times for a day (minutes of the local day) */
const PT_CACHE={};
async function onlineTimes(cfg,y,m,d){const key=Plan.pkey(y,m,d);const id=[cfg.lat,cfg.lng,cfg.m,key].join('|');if(id in PT_CACHE)return PT_CACHE[id];
  const method=cfg.m==='eg'?5:4;
  const r=await getJSON('https://api.aladhan.com/v1/timings/'+String(d).padStart(2,'0')+'-'+String(m).padStart(2,'0')+'-'+y+'?latitude='+cfg.lat+'&longitude='+cfg.lng+'&method='+method+(cfg.tz?'&timezonestring='+encodeURIComponent(cfg.tz):''),null,8000);
  let out=null;
  try{const t=r.json.data.timings;const mm=s=>{const a=String(s).match(/(\d{1,2}):(\d{2})/);return +a[1]*60+ +a[2];};
    out={fajr:mm(t.Fajr),sunrise:mm(t.Sunrise),dhuhr:mm(t.Dhuhr),asr:mm(t.Asr),maghrib:mm(t.Maghrib),isha:mm(t.Isha)};}catch(e){}
  PT_CACHE[id]=out;return out;}

async function buildState(S){
  const R=await remoteConfig(S);
  const sub=(R&&R.sub)||S.sub;
  const cfg=Object.assign({},Plan.DEF,S.cfg||{},(R&&R.cfg)||{});cfg.times=Object.assign({},cfg.times||{});
  /* make sure today and tomorrow have official times */
  for(const off of [-1,0,1]){const p=Plan.partsIn(Date.now()+off*864e5,cfg.tz);const k=Plan.pkey(p.year,p.month,p.day);
    if(!cfg.times[k]){const t=await onlineTimes(cfg,p.year,p.month,p.day);if(t)cfg.times[k]=t;}}
  return {sub,cfg};}

async function send(sub,ev){
  if(!sub){log('no phone subscription yet');return false;}
  const payload=JSON.stringify({title:ev.title,body:ev.body,go:ev.go,k:ev.k,tag:'mos-'+ev.k});
  try{const r=await webpush.sendNotification(sub,payload,{TTL:ev.k==='fajr'||ev.cat==='prayer'?1800:3600,urgency:'high',topic:('mos'+ev.k).replace(/[^a-z0-9]/gi,'').slice(0,32)});
    log('sent',ev.k,'→',r.statusCode);return true;}
  catch(e){const sc=e.statusCode;log('failed',ev.k,sc||'',(e.body||e.message||'').toString().slice(0,200));
    if(sc===404||sc===410)console.log('::warning::The phone subscription expired. Open Mostafa OS on your phone once — it re-subscribes and syncs on its own.');
    return false;}}

(async()=>{
  const S=readSecret();
  webpush.setVapidDetails(S.mail||'mailto:mostafa-os@users.noreply.github.com',S.pub,S.priv);
  let st=await buildState(S);

  if(String(process.env.TEST)==='true'){
    const ok=await send(st.sub,{k:'test',cat:'test',title:'✅ Mostafa OS',body:'الإشعارات شغالة. هتوصلك تنبيهات الصلاة والصحيان والتركيز في مواعيدها.',go:'day'});
    if(!ok)process.exitCode=1;
    return;}

  const k=Math.floor((Date.now()+LEAD)/WIN);const start=k*WIN-LEAD,end=start+WIN;
  log('window',new Date(start).toISOString(),'→',new Date(end).toISOString());
  const sent=new Set();let loaded=Date.now(),shown=false;
  while(Date.now()<end){
    if(Date.now()-loaded>=RELOAD){st=await buildState(S);loaded=Date.now();}
    const list=Plan.events(start,end,st.cfg).filter(e=>!sent.has(e.k+'@'+e.date));
    if(!shown){list.forEach(e=>log('  ',new Date(e.at).toISOString().slice(11,16),'UTC',e.k));shown=true;}
    const next=list[0];
    if(!next){await sleep(Math.min(end-Date.now(),RELOAD));continue;}
    const wait=next.at-Date.now();
    if(wait< -STALE){log('skip (too late)',next.k);sent.add(next.k+'@'+next.date);continue;}
    if(wait>15000){await sleep(Math.min(wait,RELOAD-(Date.now()-loaded)));continue;}
    await send(st.sub,next);sent.add(next.k+'@'+next.date);
  }
  log('done');
})();
