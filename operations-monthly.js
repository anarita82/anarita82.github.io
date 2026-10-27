'use strict';
window.smMonthlyUI={create({load,isActive,openReceipt}){
 const q=id=>document.getElementById(id),panel=q('monthly-panel'),records=q('operations-records');
 let snapshot=null,generation=0;
 const won=n=>n.toLocaleString('ko-KR')+'원';
 const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 const clear=()=>{generation++;snapshot=null;q('monthly-rows').replaceChildren();q('monthly-metrics').replaceChildren();q('monthly-status').textContent='';q('monthly-search').value='';q('monthly-unpaid').checked=false;panel.hidden=true;records.hidden=false;q('view-records').setAttribute('aria-pressed','true');q('view-monthly').setAttribute('aria-pressed','false');q('monthly-refresh').disabled=false;};
 function showRecords(){panel.hidden=true;records.hidden=false;q('view-records').setAttribute('aria-pressed','true');q('view-monthly').setAttribute('aria-pressed','false');}
 function draw(){
  if(!snapshot||!isActive())return;
  try{
   const report=window.smMonthlyModel.report(snapshot,q('monthly-month').value),t=report.totals;
   q('monthly-metrics').replaceChildren();
   for(const [label,value] of [['월 입고 수량',t.received+'개'],['월 출고 수량',t.shipped+'개'],['월 청구액',won(t.billed)],['월 입금액',won(t.paid)],['월말 기준 미수금',won(t.outstanding)],['월말 기준 선입금·초과입금',won(t.credit)]]){const e=node('div','');e.append(node('span',label),node('strong',value));q('monthly-metrics').append(e);}
   const term=q('monthly-search').value.trim().toLocaleLowerCase('ko');
   const rows=report.rows.filter(r=>(!q('monthly-unpaid').checked||r.outstanding>0)&&(`${r.customer} ${r.code}`).toLocaleLowerCase('ko').includes(term));
   q('monthly-rows').replaceChildren();
   for(const r of rows){const tr=node('tr','');const name=node('td','');name.append(node('strong',r.customer||''),node('small',r.code||''));tr.append(name);for(const key of ['opening','billed','paid','outstanding','credit']){const td=node('td',won(r[key]));td.className='monthly-number';tr.append(td);}const td=node('td',''),b=node('button','입금·내역 관리');b.type='button';b.className='secondary';b.addEventListener('click',async()=>{b.disabled=true;try{await openReceipt(r.id);if(isActive()){showRecords();q('detail-customer').scrollIntoView({block:'start',behavior:'smooth'});q('new-payment').focus({preventScroll:true});}}catch(e){q('monthly-status').textContent=e.message;}finally{b.disabled=false;}});td.append(b);tr.append(td);q('monthly-rows').append(tr);}
   if(!rows.length){const td=node('td',report.rows.length?'조건에 맞는 접수가 없습니다.':'이 달의 입출고·입금 및 이월 잔액이 없습니다.');td.colSpan=7;const tr=node('tr','');tr.append(td);q('monthly-rows').append(tr);}
   const time=new Date(snapshot.exported_at);if(!Number.isFinite(time.getTime()))throw Error('조회 시점을 확인할 수 없습니다.');
   q('monthly-status').textContent=report.month+' · '+rows.length+'건 표시 / 전체 '+report.rows.length+'건 · 조회 '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(time)+' · 위 합계는 검색·미수금 필터와 관계없는 월 전체 합계입니다.';
  }catch(e){q('monthly-rows').replaceChildren();q('monthly-metrics').replaceChildren();q('monthly-status').textContent=e.message;}
 }
 async function refresh(){
  if(!isActive()||panel.hidden)return;
  const token=++generation;snapshot=null;q('monthly-rows').replaceChildren();q('monthly-metrics').replaceChildren();q('monthly-status').textContent='월정산 자료를 조회하고 있습니다…';q('monthly-refresh').disabled=true;
  try{const data=await load();if(token!==generation||!isActive())return;snapshot=data;draw();}catch(e){if(token===generation&&isActive())q('monthly-status').textContent=e.message;}finally{if(token===generation)q('monthly-refresh').disabled=false;}
 }
 q('view-monthly').addEventListener('click',()=>{if(!isActive())return;panel.hidden=false;records.hidden=true;q('view-records').setAttribute('aria-pressed','false');q('view-monthly').setAttribute('aria-pressed','true');if(!q('monthly-month').value)q('monthly-month').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);refresh();});
 q('view-records').addEventListener('click',showRecords);
 q('monthly-refresh').addEventListener('click',refresh);
 q('monthly-month').addEventListener('change',draw);q('monthly-search').addEventListener('input',draw);q('monthly-unpaid').addEventListener('change',draw);
 return {clear,refresh};
}};

