'use strict';
(function(root){
 const CAPACITY=1000;
 const integer=(v,min=0)=>(typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v))&&Number.isSafeInteger(Number(v))&&Number(v)>=min;
 function normalize(data){
  if(!data || !['receipts','shipments','payments'].every(k=>Array.isArray(data[k]))) throw Error('입고·출고·입금 자료를 모두 조회해야 합니다.');
  for(const k of ['receipts','shipments','payments']) if(data[k].length>CAPACITY) throw Error('엑셀은 각 대장 1,000건까지 지원합니다. 자료를 누락하지 않도록 내보내기를 중단했습니다. 전체 내역 백업을 사용해 주세요.');
  const ids=new Map(), codes=new Set(),shipmentIds=new Set(),paymentIds=new Set();
  for(const r of data.receipts){
   if(!r.id||ids.has(r.id)||!r.code||codes.has(r.code)||!integer(r.quantity,1))throw Error('입고 번호나 수량을 확인해 주세요.');
   ids.set(r.id,r);codes.add(r.code);
  }
  for(const s of data.shipments){
   if(!s.id||shipmentIds.has(s.id)||!ids.has(s.receipt_id)||!['quantity','repaired','cables','rollers','base_price','cable_price','roller_price','total'].every(k=>integer(s[k])) || Number(s.quantity)<1 || s.repaired>s.quantity || s.cables>s.repaired || s.rollers>s.repaired)throw Error('출고 연결 또는 수량을 확인해 주세요.');
   if(Number(s.total)!==s.repaired*s.base_price+s.cables*s.cable_price+s.rollers*s.roller_price)throw Error('저장된 수리비와 계산 결과가 일치하지 않습니다.');
   shipmentIds.add(s.id);
  }
  for(const p of data.payments){
   if(!p.id||paymentIds.has(p.id)||!ids.has(p.receipt_id)||!integer(p.amount,1))throw Error('입금 번호·연결·금액을 확인해 주세요.');
   paymentIds.add(p.id);
  }
  const summarize=r=>{
   const shipments=data.shipments.filter(s=>s.receipt_id===r.id),payments=data.payments.filter(p=>p.receipt_id===r.id&&!p.voided_at);
   const shipped=shipments.reduce((n,s)=>n+Number(s.quantity),0),billed=shipments.reduce((n,s)=>n+Number(s.total),0),paid=payments.reduce((n,p)=>n+Number(p.amount),0);
   if(shipped>r.quantity)throw Error('입고 수량보다 출고 수량이 많습니다.');
   const balance=billed-paid;
   return {shipped,billed,paid,balance,remaining:r.quantity-shipped,status:balance<0?'선입금·초과입금':billed===0?'청구 전':balance===0?'정산 완료':paid===0?'미입금':'부분 입금'};
  };
  const totals={orders:0,received:0,shipped:0,pending:0,billed:0,paid:0,outstanding:0,credit:0};
  for(const r of data.receipts){const v=summarize(r);if(!r.deleted_at){totals.orders++;totals.received+=Number(r.quantity);totals.shipped+=v.shipped;totals.pending+=v.remaining;totals.billed+=v.billed;totals.paid+=v.paid;totals.outstanding+=Math.max(0,v.balance);totals.credit+=Math.max(0,-v.balance);}}
  if(!Object.values(totals).every(Number.isSafeInteger))throw Error('금액이 엑셀 정수 처리 범위를 넘었습니다.');
  return {data,ids,summarize,totals};
 }
 function serial(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('날짜 형식이 올바르지 않습니다.');
  const time=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)throw Error('날짜를 확인해 주세요.');
  return time/86400000+25569;
 }
 function cells(data){
  const n=normalize(data), sheets=[{}, {}, {}, {}];
  const instant=new Date(data.exported_at);if(!Number.isFinite(instant.getTime()))throw Error('조회 시점을 확인할 수 없습니다.');
  const year=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(instant));
  sheets[0].A3='조회 시점: '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(instant);
  sheets[0].B4=year;
  ['received','shipped','pending','billed','paid','outstanding','credit'].forEach((k,i)=>sheets[0]['B'+(7+i)]=n.totals[k]);
  data.receipts.forEach((r,i)=>{
   const row=i+7,v=n.summarize(r), values=[r.code,serial(r.received_date),r.customer,r.note||'',r.model,Number(r.quantity),v.shipped,v.remaining,v.billed,v.paid,v.balance,v.status,r.deleted_at?'삭제':'정상',r.id];
   values.forEach((x,j)=>sheets[1][String.fromCharCode(65+j)+row]=x);
  });
  data.shipments.forEach((s,i)=>{
   const row=i+7,r=n.ids.get(s.receipt_id),values=[r.code,serial(s.shipped_date),Number(s.sequence),Number(s.quantity),Number(s.repaired),Number(s.base_price),Number(s.cables),Number(s.cable_price),Number(s.rollers),Number(s.roller_price),Number(s.total),s.sent_at?'발송 확인':'미표시',r.deleted_at?'삭제':'정상',s.id];
   values.forEach((x,j)=>sheets[2][String.fromCharCode(65+j)+row]=x);
  });
  data.payments.forEach((p,i)=>{
   const row=i+7,r=n.ids.get(p.receipt_id),values=[r.code,serial(p.paid_date),Number(p.amount),p.note||'',p.voided_at?'취소':'정상',p.void_reason||'',r.deleted_at?'삭제':'정상',p.id];
   values.forEach((x,j)=>sheets[3][String.fromCharCode(65+j)+row]=x);
  });
  for(let month=1;month<=12;month++){
   const row=16+month,start=`${year}-${String(month).padStart(2,'0')}-01`,next=month===12?`${year+1}-01-01`:`${year}-${String(month+1).padStart(2,'0')}-01`;
   const active=id=>!n.ids.get(id).deleted_at, within=d=>d>=start&&d<next;
   const rs=data.receipts.filter(r=>!r.deleted_at&&within(r.received_date));
   const ss=data.shipments.filter(s=>active(s.receipt_id)&&within(s.shipped_date));
   const ps=data.payments.filter(p=>active(p.receipt_id)&&!p.voided_at&&within(p.paid_date));
   const cumulative=data.shipments.filter(s=>active(s.receipt_id)&&s.shipped_date<next).reduce((a,s)=>a+Number(s.total),0)-data.payments.filter(p=>active(p.receipt_id)&&!p.voided_at&&p.paid_date<next).reduce((a,p)=>a+Number(p.amount),0);
   [serial(start),rs.reduce((a,r)=>a+Number(r.quantity),0),ss.reduce((a,s)=>a+Number(s.quantity),0),ss.reduce((a,s)=>a+Number(s.total),0),ps.reduce((a,p)=>a+Number(p.amount),0),cumulative].forEach((x,j)=>sheets[0][String.fromCharCode(65+j)+row]=x);
  }
  return {sheets,totals:n.totals};
 }
 root.smLedgerModel={CAPACITY,normalize,serial,cells};
})(typeof window==='undefined'?globalThis:window);
