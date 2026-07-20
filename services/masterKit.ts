import JSZip from 'jszip';
import type { MarketingAsset, Sticker } from '../types';
import { loadRunCheckpoint } from './runPersistence';

export type FinalStage = 'sticker_generation'|'quality_control'|'marketing_assets'|'listing_copy'|'volume_packaging'|'master_kit'|'ready_for_download';
export interface StoredKit { id:string; runId:string; kind:'volume'|'master'; filename:string; blob:Blob; bytes:number; sha256:string; createdAt:string }
export interface MasterKitReconciliation {
  runId:string|null; status:'no_checkpoint'|'pending'|'ready'|'busy'|'error'; nextStage:FinalStage|null;
  summary:string[]; completedStickers:number; targetStickers:number; completedAssets:number; volumeZipCount:number;
  masterKit?:StoredKit; error?:string;
}

const DB='stickeros-finalization', VERSION=1, LEASE_MS=120000;
const openDb=()=>new Promise<IDBDatabase>((resolve,reject)=>{
  const r=indexedDB.open(DB,VERSION);
  r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('kits')){const s=db.createObjectStore('kits',{keyPath:'id'});s.createIndex('runId','runId',{unique:false});}};
  r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
});
const done=(t:IDBTransaction)=>new Promise<void>((resolve,reject)=>{t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});
const request=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const sha=async(b:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
const slug=(s:string)=>s.replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,80)||'Sticker_Bundle';

const list=async(runId:string)=>{
  const db=await openDb(),t=db.transaction('kits','readonly');
  const rows=await request<StoredKit[]>(t.objectStore('kits').index('runId').getAll(runId));await done(t);db.close();return rows.filter(x=>x.blob?.size);
};
const store=async(item:Omit<StoredKit,'bytes'|'sha256'|'createdAt'>)=>{
  const row:StoredKit={...item,bytes:item.blob.size,sha256:await sha(item.blob),createdAt:new Date().toISOString()};
  const db=await openDb(),t=db.transaction('kits','readwrite');t.objectStore('kits').put(row);await done(t);db.close();return row;
};
const valid=(s:Sticker[],target:number)=>s.filter(x=>x.status==='completed'&&x.blob?.size).slice(0,target);
const assets=(a:MarketingAsset[])=>a.filter(x=>x.status==='completed'&&x.url);
const hasCover=(a:MarketingAsset[])=>a.some(x=>x.id==='cover_a'&&x.status==='completed'&&x.url);

export const deriveNextMasterKitStage=(meta:{targetCount:number;qualityReport:unknown;rawListing?:string},stickers:Sticker[],marketing:MarketingAsset[],kits:StoredKit[]):FinalStage=>{
  const count=valid(stickers,meta.targetCount).length;
  if(count<meta.targetCount&&!meta.rawListing)return 'sticker_generation';
  if(!meta.qualityReport)return 'quality_control';
  if(!hasCover(marketing))return 'marketing_assets';
  if(!meta.rawListing?.trim())return 'listing_copy';
  if(kits.filter(x=>x.kind==='volume').length<Math.ceil(count/20))return 'volume_packaging';
  return kits.some(x=>x.kind==='master')?'ready_for_download':'master_kit';
};

const volume=async(batch:Sticker[],name:string,n:number,start:number)=>{
  const z=new JSZip(),rows=['number,filename,bytes'];
  batch.forEach((x,i)=>{if(!x.blob)return;const num=String(start+i+1).padStart(3,'0'),file=`${num}_${slug(x.prompt.match(/SUBJECT:\s*([^|]+)/i)?.[1]||`sticker_${num}`).slice(0,50)}.png`;z.file(file,x.blob);rows.push(`${num},"${file}",${x.blob.size}`);});
  z.file(`MANIFEST_Vol${n}.csv`,rows.join('\n'));if(n===1)z.file('START_HERE.txt',`Digital ${name} sticker files. Unzip every volume. No physical item is shipped.`);
  return z.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
};
const readAsset=async(a:MarketingAsset)=>{const r=await fetch(a.url!);if(!r.ok)throw new Error(`Cannot read ${a.id||a.title}`);return r.blob();};
const summary=(meta:any,s:Sticker[],a:MarketingAsset[],k:StoredKit[],stage:FinalStage)=>{
  const c=valid(s,meta.targetCount).length,v=k.filter(x=>x.kind==='volume').length;
  return [`stickers: ${c}/${meta.targetCount} valid`,`QA: ${meta.qualityReport?'complete':'missing'}`,`volume ZIPs: ${v}/${Math.ceil(c/20)} valid`,`marketing assets: ${assets(a).length}${hasCover(a)?' (main cover ready)':' (main cover missing)'}`,`listing copy: ${meta.rawListing?.trim()?'complete':'missing'}`,`Master Kit: ${k.some(x=>x.kind==='master')?'ready':'missing'}`,`next stage: ${stage}`];
};
const lease=(runId:string)=>{
  const key=`stickeros-finalize:${runId}`,token=`${Date.now()}-${Math.random()}`;
  try{const old=JSON.parse(localStorage.getItem(key)||'{}');if(old.expiresAt>Date.now())return null;localStorage.setItem(key,JSON.stringify({token,expiresAt:Date.now()+LEASE_MS}));return token;}catch{return token;}
};
const release=(runId:string,token:string)=>{try{const key=`stickeros-finalize:${runId}`,x=JSON.parse(localStorage.getItem(key)||'{}');if(x.token===token)localStorage.removeItem(key);}catch{}};

export const reconcileMasterKit=async():Promise<MasterKitReconciliation>=>{
  const cp=await loadRunCheckpoint();
  if(!cp)return{runId:null,status:'no_checkpoint',nextStage:null,summary:[],completedStickers:0,targetStickers:0,completedAssets:0,volumeZipCount:0};
  let kits=await list(cp.meta.id),stage=deriveNextMasterKitStage(cp.meta,cp.stickers,cp.marketingAssets,kits);
  const base={runId:cp.meta.id,nextStage:stage,summary:summary(cp.meta,cp.stickers,cp.marketingAssets,kits,stage),completedStickers:valid(cp.stickers,cp.meta.targetCount).length,targetStickers:cp.meta.targetCount,completedAssets:assets(cp.marketingAssets).length,volumeZipCount:kits.filter(x=>x.kind==='volume').length};
  const ready=kits.find(x=>x.kind==='master');if(stage==='ready_for_download'&&ready)return{...base,status:'ready',masterKit:ready};
  if(stage!=='volume_packaging'&&stage!=='master_kit')return{...base,status:'pending'};
  const token=lease(cp.meta.id);if(!token)return{...base,status:'busy'};
  try{
    const completed=valid(cp.stickers,cp.meta.targetCount),need=Math.ceil(completed.length/20);
    let vols=kits.filter(x=>x.kind==='volume');
    if(vols.length<need){vols=[];for(let i=0;i<need;i++){const blob=await volume(completed.slice(i*20,i*20+20),cp.meta.currentNiche.name,i+1,i*20);vols.push(await store({id:`${cp.meta.id}:volume:${i+1}`,runId:cp.meta.id,kind:'volume',filename:`StickerPack_Vol${i+1}_${slug(cp.meta.currentNiche.name)}.zip`,blob}));}}
    const z=new JSZip(),folder=z.folder('1_Sticker_Packs');vols.forEach(x=>folder?.file(x.filename,x.blob));
    const af=z.folder('2_Listing_Assets');for(const a of assets(cp.marketingAssets)){const b=await readAsset(a),ext=a.format==='video'?(a.mimeType?.includes('mp4')?'mp4':'webm'):(b.type.includes('png')?'png':'jpg');af?.file(`${slug(a.title)}.${ext}`,b);}
    z.file('3_SEO_Listing_Copy.txt',cp.meta.rawListing||'');z.file('4_PRODUCTION_QA_REPORT.json',JSON.stringify({quality:cp.meta.qualityReport,preflight:cp.meta.preflight,metrics:cp.meta.metrics},null,2));z.file('5_PERFORMANCE_TRACKER.csv','date,listing_url,impressions,clicks,favorites,orders,revenue,notes\n');z.file('6_API_USAGE_REPORT.json',JSON.stringify(cp.meta.metrics,null,2));
    if(completed.length<cp.meta.targetCount)z.file('RECOVERY_NOTICE.txt',`${completed.length}/${cp.meta.targetCount} completed PNGs were packaged.`);
    const blob=await z.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}}),check=await JSZip.loadAsync(blob);
    if(!check.file('3_SEO_Listing_Copy.txt')||!check.file('4_PRODUCTION_QA_REPORT.json'))throw new Error('Master Kit validation failed.');
    const master=await store({id:`${cp.meta.id}:master`,runId:cp.meta.id,kind:'master',filename:`COMPLETE_KIT_${slug(cp.meta.currentNiche.name)}.zip`,blob});
    kits=[...vols,master];stage='ready_for_download';
    return{...base,status:'ready',nextStage:stage,summary:summary(cp.meta,cp.stickers,cp.marketingAssets,kits,stage),volumeZipCount:vols.length,masterKit:master};
  }catch(e){const error=e instanceof Error?e.message:String(e);return{...base,status:'error',nextStage:'master_kit',error,summary:[...base.summary,`finalization error: ${error}`]};}
  finally{release(cp.meta.id,token);}
};

export const downloadMasterKit=(kit:StoredKit)=>{const u=URL.createObjectURL(kit.blob),a=document.createElement('a');a.href=u;a.download=kit.filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
