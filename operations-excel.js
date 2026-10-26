'use strict';
window.smExcel=(()=>{
 const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 function setCell(doc,index,address,value){
  const c=index.get(address);
  if(!c)throw Error('엑셀 양식의 셀이 누락되었습니다: '+address);
  const f=c.getElementsByTagNameNS(ns,'f')[0];
  Array.from(c.children).filter(n=>n.localName!=='f').forEach(n=>n.remove());
  if(typeof value==='number'){
   if(!Number.isFinite(value))throw Error('숫자 자료를 확인해 주세요.');
   c.removeAttribute('t');const v=doc.createElementNS(ns,'v');v.textContent=String(value);c.append(v);
  } else if(f){
   c.setAttribute('t','str');const v=doc.createElementNS(ns,'v');v.textContent=String(value??'');c.append(v);
  } else {
   c.setAttribute('t','inlineStr');const is=doc.createElementNS(ns,'is'),t=doc.createElementNS(ns,'t');t.setAttribute('xml:space','preserve');t.textContent=String(value??'');is.append(t);c.append(is);
  }
 }
 async function create(data,isActive=()=>true){
  if(!window.JSZip||!window.smLedgerModel)throw Error('엑셀 도구를 불러오지 못했습니다. 새로고침해 주세요.');
  const values=window.smLedgerModel.cells(data);
  if(!isActive())throw Error('로그인이 종료되어 엑셀 생성을 취소했습니다.');
  const response=await fetch('operations-ledger-template.xlsx',{cache:'no-store'});
  if(!response.ok)throw Error('엑셀 양식을 불러오지 못했습니다.');
  const zip=await window.JSZip.loadAsync(await response.arrayBuffer());
  const workbook=new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'),'application/xml');
  const sheetIds=Array.from(workbook.getElementsByTagNameNS(ns,'sheet')).map(n=>n.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
  const relationships=new DOMParser().parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'),'application/xml');
  const rels=new Map(Array.from(relationships.getElementsByTagName('Relationship')).map(n=>[n.getAttribute('Id'),n.getAttribute('Target')]));
  if(sheetIds.length!==4)throw Error('엑셀 양식의 시트 구성을 확인해 주세요.');
  for(let i=0;i<4;i++){
   const target=rels.get(sheetIds[i]);const path=target.startsWith('/')?target.slice(1):'xl/'+target;
   const doc=new DOMParser().parseFromString(await zip.file(path).async('string'),'application/xml');
   if(doc.getElementsByTagName('parsererror').length)throw Error('엑셀 양식이 손상되었습니다.');
   const index=new Map(Array.from(doc.getElementsByTagNameNS(ns,'c')).map(c=>[c.getAttribute('r'),c]));
   for(const [address,value] of Object.entries(values.sheets[i]))setCell(doc,index,address,value);
   zip.file(path,new XMLSerializer().serializeToString(doc));
  }
  let calc=workbook.getElementsByTagNameNS(ns,'calcPr')[0];if(!calc){calc=workbook.createElementNS(ns,'calcPr');workbook.documentElement.append(calc);}
  calc.setAttribute('calcMode','auto');calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');
  zip.file('xl/workbook.xml',new XMLSerializer().serializeToString(workbook));
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  if(!isActive())throw Error('로그인이 종료되어 엑셀 생성을 취소했습니다.');
  return {blob,totals:values.totals};
 }
 async function download(data,isActive){
  const result=await create(data,isActive);if(!isActive())return;
  const url=URL.createObjectURL(result.blob),a=document.createElement('a');a.href=url;a.download='서울마우스_입출고정산_'+data.exported_at.slice(0,10)+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);return result.totals;
 }
 return {create,download};
})();
