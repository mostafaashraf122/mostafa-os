/* Mostafa OS · notification sender (runs inside the GitHub Action).
   Reads the MOS_PUSH secret (the code you copied from the app), works out every reminder that falls
   in this run's 3-hour window, waits for each one and sends it as a Web Push to your phone. */
'use strict';
const webpush=require('web-push');
const Plan=require('../plan.js');

const WIN=3*3600e3, LEAD=10*60e3, STALE=20*60e3;
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));

function readSecret(){
  const raw=(process.env.MOS_PUSH||'').trim();
  if(!raw){console.log('::warning::MOS_PUSH secret is missing. Open the app → المزيد → الإشعارات, copy the code, and add it as a repository secret named MOS_PUSH.');process.exit(0);}
  let j;try{j=JSON.parse(Buffer.from(raw.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));}catch(e){console.log('::error::MOS_PUSH is not a valid code. Copy it again from the app.');process.exit(1);}
  if(!j||!j.sub||!j.pub||!j.priv){console.log('::error::MOS_PUSH is incomplete. Copy it again from the app.');process.exit(1);}
  return j;}

async function send(cfg,ev){
  const payload=JSON.stringify({title:ev.title,body:ev.body,go:ev.go,k:ev.k,tag:'mos-'+ev.k});
  try{const r=await webpush.sendNotification(cfg.sub,payload,{TTL:ev.k==='fajr'||ev.cat==='prayer'?1800:3600,urgency:'high',topic:('mos'+ev.k).replace(/[^a-z0-9]/gi,'').slice(0,32)});
    log('sent',ev.k,'→',r.statusCode);return true;}
  catch(e){const sc=e.statusCode;log('failed',ev.k,sc||'',(e.body||e.message||'').toString().slice(0,200));
    if(sc===404||sc===410){console.log('::error::The phone subscription expired. Open Mostafa OS on your phone → المزيد → الإشعارات → copy the new code and update the MOS_PUSH secret.');process.exit(1);}
    return false;}}

(async()=>{
  const S=readSecret();
  webpush.setVapidDetails(S.mail||'mailto:mostafa-os@users.noreply.github.com',S.pub,S.priv);
  const cfg=Object.assign({},S.cfg||{});

  if(String(process.env.TEST)==='true'){
    const ok=await send(S,{k:'test',cat:'test',title:'✅ Mostafa OS',body:'الإشعارات شغالة. هتوصلك تنبيهات الصلاة والصحيان والتركيز في مواعيدها.',go:'day'});
    if(!ok)process.exitCode=1;
    return;}

  const now=Date.now();
  const k=Math.floor((now+LEAD)/WIN);const start=k*WIN-LEAD,end=start+WIN;
  const list=Plan.events(start,end,cfg);
  log('window',new Date(start).toISOString(),'→',new Date(end).toISOString(),'·',list.length,'reminder(s)');
  list.forEach(e=>log('  ',new Date(e.at).toISOString().slice(11,16),'UTC',e.k));
  for(const ev of list){
    const wait=ev.at-Date.now();
    if(wait< -STALE){log('skip (too late)',ev.k);continue;}
    if(wait>0){log('waiting',Math.round(wait/60000),'min for',ev.k);await sleep(wait);}
    await send(S,ev);
  }
  log('done');
})();
