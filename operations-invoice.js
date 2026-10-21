'use strict';
window.smInvoice = (() => {
  let assetsPromise;
  const money = value => Number(value).toLocaleString('ko-KR') + '원';
  function check(record, shipment) {
    const whole = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
    if (!record || !shipment || record.id !== shipment.receipt_id
      || typeof record.customer !== 'string' || !record.customer.trim() || record.customer.length > 80
      || typeof record.model !== 'string' || !record.model.trim() || record.model.length > 50
      || typeof record.code !== 'string' || !/^SM-\d{8}-[A-Z0-9]{8}$/.test(record.code)
      || !/^\d{4}-\d{2}-\d{2}$/.test(record.received_date) || !/^\d{4}-\d{2}-\d{2}$/.test(shipment.shipped_date)
      || !whole(record.quantity, 10000) || !record.quantity || !whole(shipment.quantity, record.quantity) || !shipment.quantity
      || !whole(shipment.sequence,10000) || !shipment.sequence || !whole(shipment.repaired,shipment.quantity)
      || !whole(shipment.cables,shipment.repaired) || !whole(shipment.rollers,shipment.repaired)
      || !['base_price','cable_price','roller_price'].every(key => whole(shipment[key],1000000))) {
      throw new Error('요청서 자료가 올바르지 않습니다. 새로고침 후 다시 확인해 주세요.');
    }
    const total = shipment.repaired*shipment.base_price + shipment.cables*shipment.cable_price + shipment.rollers*shipment.roller_price;
    if (!Number.isSafeInteger(Number(shipment.total)) || Number(shipment.total) !== total) {
      throw new Error('서버 합계와 항목 금액이 일치하지 않아 PDF 생성을 중단했습니다.');
    }
    return total;
  }
  function filename(record, shipment) {
    const customer = record.customer.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').trim().slice(0,80);
    return `${customer}_${shipment.shipped_date}_${shipment.sequence}차_수리비입금요청서.pdf`;
  }
  async function assets() {
    if (!assetsPromise) assetsPromise = (async () => {
      const load = async path => {
        const response = await fetch(path, { signal:AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error('PDF 글꼴 또는 로고를 불러오지 못했습니다. 다시 시도해 주세요.');
        return new Uint8Array(await response.arrayBuffer());
      };
      const font = await load('NanumGothic-Regular.ttf');
      const logo = await load('seoulmouse-192.png');
      let binary='';
      for (let offset=0; offset<font.length; offset+=8192) binary+=String.fromCharCode(...font.subarray(offset,offset+8192));
      return { font:btoa(binary), logo };
    })().catch(error => { assetsPromise = null; throw error; });
    return assetsPromise;
  }
  async function build(record, shipment, suppliedAssets) {
    const total = check(record,shipment);
    if (!window.jspdf?.jsPDF) throw new Error('PDF 도구를 불러오지 못했습니다. 새로고침해 주세요.');
    const resources = suppliedAssets || await assets();
    const doc = new window.jspdf.jsPDF({ unit:'pt', format:'a4', compress:true, putOnlyUsedFonts:true });
    doc.addFileToVFS('NanumGothic-Regular.ttf',resources.font);
    doc.addFont('NanumGothic-Regular.ttf','SM','normal');
    doc.setFont('SM','normal');
    const left=44, right=551, width=right-left;
    const ink='#202226', muted='#626975', red='#c91938';
    function text(value,x,y,size=10,color=ink,align='left',maxWidth) {
      doc.setTextColor(color); doc.setFontSize(size);
      if (maxWidth) {
        while (doc.getTextWidth(String(value))>maxWidth && size>7) { size-=0.25; doc.setFontSize(size); }
      }
      doc.text(String(value),x,y,{align});
    }
    function line(y) { doc.setDrawColor('#d9dde3'); doc.setLineWidth(0.7); doc.line(left,y,right,y); }
    function wrapped(value,y,size,maxWidth) {
      doc.setFontSize(size); doc.setTextColor(ink);
      const lines=doc.splitTextToSize(value,maxWidth);
      doc.text(lines,left,y,{lineHeightFactor:1.45});
      return y+lines.length*size*1.45;
    }
    doc.addImage(resources.logo,'PNG',left,38,46,46);
    text('서울마우스',left+61,58,18);
    text('MOUSE REPAIR SPECIALIST',left+61,78,8,muted);
    text(shipment.shipped_date,right,57,9,muted,'right');
    doc.setDrawColor(red); doc.setLineWidth(2); doc.line(left,106,right,106);
    text('수리비 입금 요청서',left,148,24);
    text(`접수번호 ${record.code} / ${shipment.sequence}차 출고`,left,173,9,muted);
    const afterCustomer = wrapped(record.customer+' 귀중',209,15,width);
    text(`입고일 ${record.received_date} / 입고 ${record.quantity}개 / 이번 출고 ${shipment.quantity}개`,left,afterCustomer+12,10);
    const afterModel = wrapped('모델: '+record.model,afterCustomer+34,10,width);
    const tableY=Math.max(294,afterModel+15);
    doc.setFillColor('#eef1f5'); doc.rect(left,tableY,width,30,'F');
    text('수리 항목',left+12,tableY+20);
    text('수량',328,tableY+20,10,ink,'right');
    text('단가',430,tableY+20,10,ink,'right');
    text('금액',right-12,tableY+20,10,ink,'right');
    const items=[['기본 수리',shipment.repaired,shipment.base_price],['케이블 교체',shipment.cables,shipment.cable_price],['휠 롤러 교체',shipment.rollers,shipment.roller_price]];
    items.forEach(([label,count,price],index)=>{
      const y=tableY+60+index*44;
      text(label,left+12,y);
      text(count+'개',328,y,10,ink,'right',60);
      text(money(price),430,y,10,ink,'right',90);
      text(money(count*price),right-12,y,10,ink,'right',98);
      line(y+18);
    });
    const totalY=tableY+190;
    doc.setFillColor('#fff0f3'); doc.rect(left,totalY,width,52,'F');
    text('입금 요청 금액',left+14,totalY+33,12);
    text(money(total),right-14,totalY+35,22,red,'right',300);
    const accountY=totalY+86;
    text('입금계좌',left,accountY,10,muted);
    text('카카오뱅크 3333-16-0017681 / 예금주 유상균',left,accountY+24,11);
    text('왕복 택배비: 매장 부담.',left,accountY+57);
    text('본 문서는 입금 요청 내역이며, 입금 완료 영수증이나 세금계산서가 아닙니다.',left,accountY+81,8.5,muted);
    text('수리비 입금 부탁드립니다. 감사합니다.',left,accountY+104,10);
    line(747);
    text('서울마우스(제노PC방) / 유상균 / 사업자등록번호 133-09-78081',left,769,8,muted);
    text('서울특별시 송파구 풍납동 78-83 지층 / 010-3100-4361',left,787,8,muted);
    text('1 / 1',right,787,8,muted,'right');
    doc.setProperties({title:'서울마우스 수리비 입금 요청서',author:'서울마우스',subject:'수리비 입금 요청',creator:'서울마우스 입출고 관리'});
    return doc;
  }
  async function download(record,shipment,canDownload=()=>true) {
    const doc=await build(record,shipment);
    if (!canDownload()) throw new Error('로그인이 종료되어 PDF 다운로드를 중단했습니다.');
    await doc.save(filename(record,shipment),{returnPromise:true});
  }
  return {check,filename,build,download};
})();
