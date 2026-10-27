'use strict';
(function(root){
 function report(data,month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('조회할 월을 확인해 주세요.');
  if(!data||!['receipts','shipments','payments'].every(k=>Array.isArray(data[k])))throw Error('입고·출고·입금 자료를 모두 조회해야 합니다.');
  const next=month.endsWith('-12')?`${Number(month.slice(0,4))+1}-01-01`:`${month.slice(0,5)}${String(Number(month.slice(5))+1).padStart(2,'0')}-01`;
  const start=month+'-01',rows=new Map(),seen={shipments:new Set(),payments:new Set()};
  const integer=(n,min=0)=>{if(!((typeof n==='number'||typeof n==='string'&&/^\d+$/.test(n))&&Number.isSafeInteger(Number(n))&&Number(n)>=min))throw Error('정산 자료의 수량·금액을 확인해 주세요.');return Number(n);};
  const date=d=>{if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('정산 자료의 날짜를 확인해 주세요.');return d;};
  for(const r of data.receipts){if(!r.id||rows.has(r.id))throw Error('입고 번호가 중복되거나 누락됐습니다.');date(r.received_date);rows.set(r.id,{id:r.id,code:r.code,customer:r.customer,deleted:!!r.deleted_at,received:r.received_date>=start&&r.received_date<next?integer(r.quantity,1):0,shipped:0,opening:0,billed:0,paid:0,closing:0,outstanding:0,credit:0});}
  for(const k of ['shipments','payments'])for(const item of data[k]){
   const row=rows.get(item.receipt_id);if(!item.id||seen[k].has(item.id)||!row)throw Error('출고·입금 자료의 연결을 확인해 주세요.');seen[k].add(item.id);
   const d=date(item[k==='shipments'?'shipped_date':'paid_date']);const amount=integer(item[k==='shipments'?'total':'amount'],k==='payments'?1:0);
   if(row.deleted||k==='payments'&&item.voided_at)continue;
   const sign=k==='shipments'?1:-1;
   if(d<start)row.opening+=sign*amount;
   if(d<next)row.closing+=sign*amount;
   if(d>=start&&d<next){if(k==='shipments'){row.billed+=amount;row.shipped+=integer(item.quantity,1);}else row.paid+=amount;}
  }
  const totals={received:0,shipped:0,billed:0,paid:0,outstanding:0,credit:0,opening:0,closing:0};
  const result=[];
  for(const row of rows.values()){
   if(row.deleted)continue;row.outstanding=Math.max(0,row.closing);row.credit=Math.max(0,-row.closing);
   if(!Object.entries(row).filter(([k])=>k in totals).every(([,v])=>Number.isSafeInteger(v)))throw Error('정산 합계의 숫자 범위를 확인해 주세요.');
   for(const k of Object.keys(totals))totals[k]+=row[k];
   if(row.received||row.shipped||row.billed||row.paid||row.opening||row.closing)result.push(row);
  }
  if(!Object.values(totals).every(Number.isSafeInteger))throw Error('정산 합계가 처리 범위를 넘었습니다.');
  result.sort((a,b)=>b.outstanding-a.outstanding||String(a.customer).localeCompare(String(b.customer),'ko')||String(a.code).localeCompare(String(b.code)));
  return {month,start,next,totals,rows:result,exported_at:data.exported_at};
 }
 root.smMonthlyModel={report};
})(typeof window==='undefined'?globalThis:window);
