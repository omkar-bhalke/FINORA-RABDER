import test from 'node:test';
import assert from 'node:assert/strict';
import {dueSlot,summarize} from '../dist/report.js';
test('Kolkata report time uses the preceding 24 hours',()=>{
 const now=Date.parse('2026-11-25T15:30:40Z'),slot=dueSlot(now,'Asia/Kolkata','21:00');
 assert.equal(slot.day,'2026-11-25');assert.equal(slot.end-slot.start,86400000);
 assert.equal(slot.end,Date.parse('2026-11-25T15:30:00Z'));
 assert.equal(dueSlot(now-60000,'Asia/Kolkata','21:00'),null);
});
test('invalid schedules fail closed',()=>{assert.equal(dueSlot(10,'Mars','21:00'),null);assert.equal(dueSlot(10,'UTC','29:00'),null)});
test('summary adds integer minor units',()=>{assert.deepEqual(summarize([{amount:234,credit:false},{amount:90,credit:true}]),{income:90,expenses:234,count:2});assert.throws(()=>summarize([{amount:-5,credit:true}]))});
test('detail scope controls merchant and balance disclosure',async()=>{
 const {details}=await import('../dist/report.js');
 const rows=[{amount:12000,credit:false,title:'Private shop',category:'Food',time:10}];
 assert.doesNotMatch(details(rows,{opening:100000},[],'UTC',['categories']),/Private shop|opening/i);
 assert.match(details(rows,{opening:100000},[],'UTC',['balances','transactions']),/Private shop/);
 assert.match(details(rows,{},[],'UTC',['balances']),/unavailable/);
});
