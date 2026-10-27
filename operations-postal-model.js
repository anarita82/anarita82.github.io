(function(root){
  'use strict';
  const headers=['성함','우편번호','주소1','주소2','일반전화','휴대전화','이메일','홈페이지 ','생년월일','직함','관계','회사명','회사우편번호','회사주소1','회사주소2','회사전화번호','팩스번호','회사이메일','회사홈페이지','회사창립기념일','부서명','메모'];
  const value=v=>String(v??'').trim();
  function validate(r){
    const errors=[];
    if(!value(r.name)||value(r.name).length>100)errors.push('이름 또는 상호를 100자 이하로 입력해 주세요.');
    if(!/^\d{5}$/.test(value(r.zip)))errors.push('우편번호 5자리를 입력해 주세요.');
    if(!value(r.address)||value(r.address).length>250||value(r.detail).length>250)errors.push('주소를 확인해 주세요. 주소1·주소2는 각각 250자 이하입니다.');
    const mobile=value(r.mobile).replace(/[\s()-]/g,''),phone=value(r.phone).replace(/[\s()-]/g,'');
    if(!mobile&&!phone)errors.push('휴대전화 또는 일반전화 중 하나를 입력해 주세요.');
    if(mobile&&!/^01\d{8,9}$/.test(mobile))errors.push('휴대전화 번호를 확인해 주세요.');
    if(phone&&!/^0\d{8,10}$/.test(phone))errors.push('일반전화 번호를 확인해 주세요.');
    return errors;
  }
  function row(r){const e=validate(r);if(e.length)throw Error(e.join('\n'));const a=Array(22).fill('');[a[0],a[1],a[2],a[3],a[4],a[5]]=[r.name,r.zip,r.address,r.detail,r.phone,r.mobile].map(value);return a;}
  function parse(rows){
    if(!Array.isArray(rows)||!rows.length||rows[0].length!==22||!headers.every((h,i)=>value(rows[0][i])===value(h)))throw Error('제공해 주신 서울마우스 주소록과 같은 22개 열의 파일을 선택해 주세요.');
    if(rows.length>10001)throw Error('주소록은 10,000건 이하로 나누어 불러와 주세요.');
    return rows.slice(1).filter(a=>a.some(v=>value(v))).map(a=>({name:value(a[0]),zip:value(a[1]).replace(/^\d{1,4}$/,m=>m.padStart(5,'0')),address:value(a[2]),detail:value(a[3]),phone:value(a[4]),mobile:value(a[5])}));
  }
  function workbook(XLSX,r){const ws=XLSX.utils.aoa_to_sheet([headers,row(r)]);for(const cell of Object.values(ws))if(cell&&typeof cell==='object'&&'v'in cell){cell.t='s';cell.z='@';delete cell.f;}const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Sheet1');return wb;}
  function filename(record,shipment){return ('서울마우스_우체국_'+shipment.shipped_date+'_'+record.code+'_'+shipment.sequence+'차.xls').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_');}
  const api={headers,validate,row,parse,workbook,filename};if(typeof module==='object'&&module.exports)module.exports=api;else root.smPostalModel=api;
})(typeof window==='object'?window:globalThis);
