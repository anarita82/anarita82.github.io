'use strict';
window.smBackup = (() => {
  const receiptFields = ['id','code','customer','received_date','quantity','model','photo_path','note','created_at','deleted_at','deleted_by'];
  const shipmentFields = ['id','receipt_id','sequence','shipped_date','quantity','repaired','cables','rollers','base_price','cable_price','roller_price','total','sent_at','created_at'];
  const paymentFields = ['id','receipt_id','paid_date','amount','note','request_key','created_by','created_at','voided_at','voided_by','void_reason'];
  const pick = (row, fields) => Object.fromEntries(fields.map(key => [key,row[key] ?? null]));
  function build(data, now = new Date()) {
    if (!Array.isArray(data.receipts) || !Array.isArray(data.shipments)) throw new Error('백업 자료 형식을 확인할 수 없습니다.');
    const ids = new Set(), parents = new Map(), shipmentIds = new Set(), sequences = new Set(), counts = new Map();
    for (const r of data.receipts) {
      if (!r.id || ids.has(r.id) || !Number.isSafeInteger(r.quantity) || r.quantity < 1) throw new Error('입고 자료가 중복되거나 올바르지 않습니다. 다시 시도해 주세요.');
      ids.add(r.id); parents.set(r.id,r);
    }
    for (const s of data.shipments) {
      const r = parents.get(s.receipt_id);
      const key = s.receipt_id + ':' + s.sequence;
      if (!s.id || shipmentIds.has(s.id) || sequences.has(key) || !r) throw new Error('입고·출고 연결이 일치하지 않습니다. 다시 시도해 주세요.');
      window.smInvoice.check(r,s);
      shipmentIds.add(s.id); sequences.add(key);
      counts.set(r.id,(counts.get(r.id) || 0) + s.quantity);
      if (counts.get(r.id) > r.quantity) throw new Error('출고 수량을 확인해 주세요.');
    }
    const paymentIds=new Set();
    for(const p of data.payments || []) {
      if(!p.id || paymentIds.has(p.id) || !parents.has(p.receipt_id) || !Number.isSafeInteger(Number(p.amount)) || Number(p.amount)<1) throw new Error('입금 자료의 연결이나 금액을 확인해 주세요.');
      paymentIds.add(p.id);
    }
    return {
      format:'seoulmouse-operations-export', version:2, exported_at:data.exported_at || now.toISOString(),
      scope:'입고·출고·입금 업무 내역. 송장 사진 원본, 로그인 계정 및 서버 설정 제외. 자동 복원 미지원.',
      consistency:'관리자 권한으로 단일 서버 질의 시점의 입고·출고·입금 자료를 조회했습니다.',
      counts:{receipts:data.receipts.length,shipments:data.shipments.length,payments:(data.payments || []).length},
      receipts:data.receipts.map(row=>pick(row,receiptFields)),
      shipments:data.shipments.map(row=>pick(row,shipmentFields)),
      payments:(data.payments || []).map(row=>pick(row,paymentFields)),
    };
  }
  async function collect({load, authorize, isActive}) {
    if (!isActive() || !(await authorize())) throw new Error('승인된 관리자 로그인이 필요합니다.');
    const data = await load();
    if (!isActive() || !(await authorize()) || !isActive()) throw new Error('로그인이 종료되어 백업을 취소했습니다.');
    return build(data);
  }
  function download(data) {
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = '서울마우스_업무내역_' + data.exported_at.replace(/[:.]/g,'-') + '.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  return {build,collect,download};
})();

