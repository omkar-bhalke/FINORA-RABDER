import {DateTime} from 'luxon';

export function dueSlot(now: number, zone: string, clock: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const local=DateTime.fromMillis(now,{zone});
  if (!local.isValid) return null;
  const [hour,minute]=clock.split(':').map(Number);
  const scheduled=local.set({hour,minute,second:0,millisecond:0});
  const lag=now-scheduled.toMillis();
  if(lag<0 || lag>=15*60_000) return null;
  return {day:scheduled.toISODate()!,end:scheduled.toMillis(),start:scheduled.toMillis()-86400000};
}

export function summarize(rows: Record<string,unknown>[]) {
  let income=0, expenses=0;
  for(const row of rows){
    if(typeof row.amount!=='number'||!Number.isSafeInteger(row.amount)||row.amount<=0||typeof row.credit!=='boolean') throw Error('Invalid ledger entry');
    if(row.credit) income+=row.amount; else expenses+=row.amount;
  }
  return {income,expenses,count:rows.length};
}
export const rupees=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(n/100);
