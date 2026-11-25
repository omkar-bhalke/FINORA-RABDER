import {db,need} from './firebase.js';
import {dueSlot,summarize,rupees} from './report.js';
import {DateTime} from 'luxon';
import {FieldPath,type QueryDocumentSnapshot} from 'firebase-admin/firestore';
import {setTimeout as delay} from 'node:timers/promises';

async function send(pref:QueryDocumentSnapshot,now:number){
  if(pref.id!=='daily')return;
  const user=pref.ref.parent.parent;
  if(!user || user.parent.path!=='users')return;
  const p=pref.data();
  if(!p.consent || !p.enabled)return;
  const slot=dueSlot(now,p.zone,p.time);
  if(!slot)return;
  const history=user.collection('reportHistory').doc(slot.day);
  const permit=user.collection('integrations').doc('recipient');
  const version=need('META_GRAPH_VERSION'), token=need('META_ACCESS_TOKEN'),phoneId=need('META_PHONE_NUMBER_ID'),template=need('META_TEMPLATE');
  const rows=await user.collection('transactions').where('time','>=',slot.start).where('time','<',slot.end).get();
  const summary=summarize(rows.docs.map(d=>d.data()));
  const period=[slot.start,slot.end].map(t=>DateTime.fromMillis(t,{zone:p.zone}).toFormat('dd LLL yyyy HH:mm ZZZZ')).join(' – ');
  const claim=await db.runTransaction(async t=>{
    const [previous,latest,verified]=await t.getAll(history,pref.ref,permit);
    const current=latest.data(),v=verified.data(),h=previous.data();
    if(!current?.enabled||!current.consent||current.recipient!==p.recipient||current.zone!==p.zone||current.time!==p.time)return false;
    // Only trusted operations may approve a production account. Test accounts have no permit.
    if(v?.productionApproved!==true || v?.verified!==true || v?.recipient!==current.recipient)return false;
    if(h && (h.state!=='retryable'||h.retryAt>now||h.attempts>=3))return false;
    t.set(history,{state:'sending',start:slot.start,end:slot.end,attempts:(h?.attempts??0)+1,updatedAt:now});
    return true;
  });
  if(!claim)return;
  const payload={messaging_product:'whatsapp',to:p.recipient.slice(1),type:'template',template:{name:template,language:{code:process.env.META_TEMPLATE_LANGUAGE||'en'},components:[{type:'body',parameters:[period,rupees(summary.income),rupees(summary.expenses),String(summary.count)].map(text=>({type:'text',text}))}]}};
  try{
    const response=await fetch('https://graph.facebook.com/'+version+'/'+phoneId+'/messages',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
    if(!response.ok){
      const state=response.status===429?'retryable':response.status>=500?'unknown':'rejected';
      await history.update({state,httpStatus:response.status,retryAt:Date.now()+120000});return;
    }
    const message=(await response.json()).messages?.[0]?.id;
    if(!message)throw Error('No acknowledgment');
    const batch=db.batch();
    batch.update(history,{state:'accepted',message,updatedAt:Date.now()});
    batch.set(db.collection('outboundMessages').doc(message),{path:history.path});
    await batch.commit();
  }catch{await history.update({state:'unknown',updatedAt:Date.now()})}
}
async function tick(){
  if(process.env.LIVE_REPORTS!=='true')return;
  const base=db.collectionGroup('reportPreferences').where('enabled','==',true).orderBy(FieldPath.documentId()).limit(100);
  let cursor:QueryDocumentSnapshot|undefined;
  for(;;){
    const page=await (cursor?base.startAfter(cursor):base).get();
    for(const doc of page.docs){try{await send(doc,Date.now())}catch{console.error('report_processing_failed')}}
    if(page.size<100)return;
    cursor=page.docs[page.size-1];
  }
}
for(;;){try{await tick()}catch{console.error('scheduler_tick_failed')}await delay(30000)}
