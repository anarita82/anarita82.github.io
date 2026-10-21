'use strict';
window.smShare = (() => {
  const MAX_AGE = 5*60*1000;
  const won = value => Number(value).toLocaleString('ko-KR')+'원';
  function requestText(record,shipment) {
    window.smInvoice.check(record,shipment);
    return `[서울마우스 수리비 입금 요청]\n\n거래처: ${record.customer}\n접수번호: ${record.code}\n입고 ${record.quantity}개 / 이번 출고 ${shipment.quantity}개 (${shipment.sequence}차)\n\n기본 수리: ${shipment.repaired}개 × ${won(shipment.base_price)} = ${won(shipment.repaired*shipment.base_price)}\n케이블 교체: ${shipment.cables}개 × ${won(shipment.cable_price)} = ${won(shipment.cables*shipment.cable_price)}\n휠 롤러 교체: ${shipment.rollers}개 × ${won(shipment.roller_price)} = ${won(shipment.rollers*shipment.roller_price)}\n\n입금 요청 금액: ${won(shipment.total)}\n왕복 택배비: 매장 부담.\n입금계좌: 카카오뱅크 3333-16-0017681 유상균\n\n수리비 입금 부탁드립니다. 감사합니다.`;
  }
  async function prepare(record,shipment) {
    const text=requestText(record,shipment);
    const doc=await window.smInvoice.build(record,shipment);
    const name=window.smInvoice.filename(record,shipment);
    const file=new File([doc.output('blob')],name,{type:'application/pdf'});
    return {doc,file,text,record,shipment,createdAt:Date.now(),title:'서울마우스 수리비 입금 요청서'};
  }
  function shareData(prepared) { return {files:[prepared.file],title:prepared.title,text:prepared.text}; }
  function canShare(prepared,environment=navigator) {
    try { return typeof environment.share==='function' && typeof environment.canShare==='function' && environment.canShare(shareData(prepared)); }
    catch { return false; }
  }
  function assertReady(prepared,confirmed,active) {
    if (!prepared || !active) throw new Error('로그인 상태와 발송 준비 내역을 다시 확인해 주세요.');
    if (!confirmed) throw new Error('거래처·출고 수량·입금 요청 금액을 먼저 확인해 주세요.');
    if (Date.now()-prepared.createdAt>MAX_AGE) throw new Error('준비 시간이 지났습니다. 다시 준비한 뒤 내용을 확인해 주세요.');
  }
  // The share call must happen directly within the user's click, with no preceding await.
  function sharePrepared(prepared,confirmed,active,environment=navigator) {
    assertReady(prepared,confirmed,active);
    if (!canShare(prepared,environment)) throw new Error('이 브라우저에서는 PDF 파일 공유를 지원하지 않습니다. PDF를 내려받아 직접 첨부해 주세요.');
    return environment.share(shareData(prepared));
  }
  function createController({load,isActive,onSent,environment=navigator}) {
    const $=id=>document.getElementById(id);
    const dialog=$('share-dialog');
    let generation=0,prepared=null,shipmentId=null,busy=false;
    function controls() {
      const ready=Boolean(prepared && isActive() && $('share-confirmed').checked && !busy);
      $('share-native').disabled=!ready || !canShare(prepared,environment);
      $('share-download').disabled=!ready; $('share-copy').disabled=!ready;
      $('share-mark-sent').disabled=!ready || Boolean(prepared?.shipment.sent_at || prepared?.shipment.sent);
    }
    function clear() {
      generation++; prepared=null; shipmentId=null; busy=false;
      $('share-confirmed').checked=false;
      for (const id of ['share-customer','share-code','share-quantity','share-total','share-message','share-support','share-status']) $(id).textContent='';
      $('share-preview').hidden=true; controls();
    }
    async function open(id) {
      clear(); shipmentId=id;
      const job=generation;
      if (!dialog.open) dialog.showModal();
      $('share-status').textContent='저장된 출고 내역 확인 및 PDF 준비 중…';
      try {
        const fresh=await load(id);
        if (job!==generation || !dialog.open || !isActive()) return;
        const result=await prepare(fresh.record,fresh.shipment);
        if (job!==generation || !dialog.open || !isActive()) return;
        prepared=result;
        $('share-customer').textContent=result.record.customer;
        $('share-code').textContent=result.record.code+' / '+result.shipment.sequence+'차 출고';
        $('share-quantity').textContent='입고 '+result.record.quantity+'개 / 이번 출고 '+result.shipment.quantity+'개';
        $('share-total').textContent=won(result.shipment.total);
        $('share-message').textContent=result.text;
        $('share-preview').hidden=false;
        $('share-support').textContent=canShare(prepared,environment)
          ? '공유할 앱과 받는 사람은 기기의 공유창에서 선택합니다.'
          : '이 브라우저에서는 PDF 파일 공유를 지원하지 않습니다. PDF를 내려받아 직접 첨부해 주세요.';
        $('share-status').textContent='발송 전 거래처·수량·금액을 확인해 주세요.';
        controls();
      } catch(error) {
        if (job===generation && dialog.open && isActive()) $('share-status').textContent=error.message || '발송 준비를 하지 못했습니다. 다시 시도해 주세요.';
      }
    }
    $('share-confirmed').addEventListener('change',controls);
    $('share-refresh').addEventListener('click',()=>{if (shipmentId && !busy) open(shipmentId);});
    $('share-native').addEventListener('click',()=>{
      const job=generation;
      try {
        const sharing=sharePrepared(prepared,$('share-confirmed').checked,isActive(),environment);
        busy=true; controls(); $('share-status').textContent='기기의 공유창에서 받는 사람을 확인해 주세요.';
        Promise.resolve(sharing).then(()=>{
          if (job===generation && dialog.open && isActive()) $('share-status').textContent='공유창 처리가 끝났습니다. 실제 전송 결과를 확인한 뒤 발송 완료로 표시해 주세요.';
        }).catch(error=>{
          if (job!==generation || !dialog.open || !isActive()) return;
          $('share-status').textContent=error.name==='AbortError'
            ? '공유를 취소했거나 공유할 앱을 선택하지 않았습니다. 발송 완료로 표시하지 않았습니다.'
            : '공유하지 못했습니다. PDF를 내려받아 직접 첨부해 주세요. 발송 완료로 표시하지 않았습니다.';
        }).finally(()=>{if (job===generation) {busy=false; controls();}});
      } catch(error) { $('share-status').textContent=error.message; }
    });
    $('share-download').addEventListener('click',async()=>{
      const job=generation;
      try {
        assertReady(prepared,$('share-confirmed').checked,isActive());
        const current=prepared; busy=true; controls();
        await current.doc.save(current.file.name,{returnPromise:true});
        if (job===generation && dialog.open && isActive()) $('share-status').textContent='PDF 다운로드를 요청했습니다. 파일을 직접 첨부해 주세요. 발송 완료로 표시하지 않았습니다.';
      } catch(error) { if (job===generation) $('share-status').textContent=error.message || 'PDF를 내려받지 못했습니다.'; }
      finally {if (job===generation) {busy=false; controls();}}
    });
    $('share-copy').addEventListener('click',async()=>{
      const job=generation;
      try {
        assertReady(prepared,$('share-confirmed').checked,isActive());
        await environment.clipboard.writeText(prepared.text);
        if (job===generation && dialog.open && isActive()) $('share-status').textContent='입금 요청 문구를 복사했습니다. 실제 발송은 하지 않았습니다.';
      } catch(error) { if (job===generation) $('share-status').textContent=error.message || '문구를 복사하지 못했습니다.'; }
    });
    $('share-mark-sent').addEventListener('click',async()=>{
      if (!prepared || !isActive() || busy || !$('share-confirmed').checked) return;
      if (!confirm('고객에게 PDF 또는 입금 요청 문구를 실제로 전송했나요? 공유창을 열었거나 파일만 내려받은 경우에는 취소해 주세요.')) return;
      const job=generation,id=shipmentId; busy=true; controls();
      try { await onSent(id); if (job===generation && dialog.open) dialog.close(); }
      catch(error) { if (job===generation) $('share-status').textContent=error.message || '발송 확인을 저장하지 못했습니다.'; }
      finally {if (job===generation) {busy=false; controls();}}
    });
    dialog.addEventListener('close',clear);
    function reset() { if (dialog.open) dialog.close(); clear(); }
    return {open,reset};
  }
  return {requestText,prepare,canShare,assertReady,sharePrepared,createController};
})();
