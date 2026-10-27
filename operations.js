const $ = (selector) => document.querySelector(selector);
let csrf = '';
let setupRequired = false;
let serverToday = '';
let receipts = [];
let selected = null;
let filter = 'all';
let photoId = null;
let photoBusy = false;
let photoGeneration = 0;
let photoPreviewUrl = null;
let selectedPhotoFile = null;
let shipmentKey = '';
let ocrGeneration = 0;
let backupGeneration = 0;
let receiptTrash = false;
let receiptLoadGeneration = 0;
let receiptDeleteBusy = false;
let receiptDeleteTarget = null;
let paymentTarget=null,paymentKey='',paymentGeneration=0,paymentVoidTarget=null,paymentBusy=false;
const won = (value) => Number(value).toLocaleString('ko-KR') + '원';
const shareController = window.smShare.createController({
  load:id=>api(`/api/shipments/${id}/invoice`),
  isActive:()=>!$('#workspace').hidden,
  onSent:async id=>{await api(`/api/shipments/${id}/sent`,{confirmed:true}); await refresh(); notice('실제 발송 완료 확인을 저장했습니다.');},
});

async function api(path, data) {
  return cloudApi(path, data);
}

function notice(message) {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function start() {
  $('#auth').hidden = false;
  $('#workspace').hidden = true;
  try {
    const session = await api('/api/session');
    csrf = session.csrf || '';
    setupRequired = session.setup_required;
    serverToday = session.today;
    $('#workspace').hidden = !session.authenticated;
    $('#auth').hidden = session.authenticated;
    $('#logout').hidden = !session.authenticated;
    $('#auth-title').textContent = setupRequired ? '관리자 계정 만들기' : '관리자 로그인';
    $('#auth-submit').textContent = setupRequired ? '관리자 계정 만들기' : '로그인';
    $('#password-confirm-label').hidden = !setupRequired;
    $('#password-confirm').required = setupRequired;
    $('#setup-hint').hidden = !setupRequired;
    $('#password').autocomplete = setupRequired ? 'new-password' : 'current-password';
    $('#password').minLength = setupRequired ? 12 : 1;
    if (session.authenticated) await refresh();
  } catch (error) { notice(error.message); }
}

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#auth-error').textContent = '';
  if (setupRequired && $('#password').value !== $('#password-confirm').value) {
    $('#auth-error').textContent = '비밀번호가 일치하지 않습니다.';
    return;
  }
  $('#auth-submit').disabled = true;
  try {
    await api(setupRequired ? '/api/setup' : '/api/login', { username: $('#username').value, password: $('#password').value });
    $('#password').value = ''; $('#password-confirm').value = '';
    await start();
  } catch (error) { $('#auth-error').textContent = error.message; }
  finally { $('#auth-submit').disabled = false; }
});

function clearPrivateView() {
  window.smPostal?.clear();
  window.smMonthly?.clear();
  paymentGeneration++; paymentTarget=null;paymentVoidTarget=null;paymentKey="";
  receiptLoadGeneration++;
  receiptTrash = false;
  backupGeneration++;
  shareController.reset();
  resetReceiptOcr();
  receipts = []; selected = null; render();
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  document.querySelectorAll('form').forEach(form => form.reset());
  for (const id of ['detail-code','detail-customer','detail-date','detail-model','detail-quantity','detail-state','detail-note','shipment-list','payment-list','payment-summary','payment-customer','payment-current','payment-void-description','shipment-customer','ocr-text']) $('#'+id).textContent = '';
  for (const id of ['detail-photo-image','full-photo','photo-preview']) $('#'+id).removeAttribute('src');
  $('#detail-photo').removeAttribute('href');
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = null; selectedPhotoFile = null; photoGeneration++; photoId = null; smPhotoUrls.clear();
  $('#workspace').hidden = true; $('#auth').hidden = false; $('#logout').hidden = true;
}
smClient?.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') clearPrivateView();
});
$('#logout').addEventListener('click', async () => {
  try {
    await api('/api/logout', {}); clearPrivateView(); notice(''); await start();
  }
  catch (error) { notice(error.message); }
});

async function refresh() {
  const version = ++receiptLoadGeneration;
  const rows = await api(receiptTrash ? '/api/receipts/trash' : '/api/receipts');
  if (version !== receiptLoadGeneration || $('#workspace').hidden) return;
  receipts = rows;
  if (!receipts.some((record) => record.id === selected)) selected = receipts[0]?.id || null;
  render();
  window.smMonthly?.refresh();
}

$('#receipt-trash').addEventListener('click', async () => {
  if ($('#workspace').hidden || receiptDeleteBusy) return;
  receiptTrash = !receiptTrash;
  selected = null; receipts = []; shareController.reset(); render();
  try { await refresh(); notice(receiptTrash ? '삭제 내역입니다. 필요한 입고를 선택해 복구할 수 있습니다.' : ''); }
  catch (error) { notice(error.message); }
});
$('#delete-receipt').addEventListener('click', async () => {
  const record = receipts.find(item => item.id === selected);
  if (!record || receiptDeleteBusy || $('#workspace').hidden) return;
  const restore = receiptTrash;
  receiptDeleteTarget = {id:record.id,restore};
  $('#receipt-delete-form').reset();
  $('#receipt-delete-title').textContent = restore ? '입고 복구 확인' : '입고 삭제 확인';
  $('#receipt-delete-description').textContent = record.customer + ' · ' + record.code + '\n입고 ' + record.quantity + '개 · 출고 기록 ' + record.shipments.length + '건\n' + (restore ? '입고와 연결된 출고 기록을 원래 목록으로 복구합니다.' : '목록과 업무 합계에서 제외합니다. 송장 사진과 출고 기록은 보관되며 삭제 내역에서 복구할 수 있습니다.');
  $('#receipt-delete-submit').textContent = restore ? '입고 복구' : '삭제 내역으로 이동';
  $('#receipt-delete-error').textContent = '';
  $('#receipt-delete-dialog').showModal();
});
$('#receipt-delete-dialog').addEventListener('close',()=>{receiptDeleteTarget=null;});
$('#receipt-delete-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!receiptDeleteTarget || receiptDeleteBusy || $('#workspace').hidden || !$('#receipt-delete-confirmed').checked) return;
  const {id,restore} = receiptDeleteTarget;
  receiptDeleteBusy = true; $('#delete-receipt').disabled = true;
  $('#receipt-delete-submit').disabled = true;
  try {
    await api('/api/receipts/' + id + '/deleted', {deleted:!restore,confirmed:true});
    shareController.reset();
    $('#receipt-delete-dialog').close();
    await refresh();
    if (!$('#workspace').hidden) notice(restore ? '입고를 복구했습니다.' : '입고를 삭제 내역으로 이동했습니다. 필요하면 복구할 수 있습니다.');
  } catch (error) { $('#receipt-delete-error').textContent = error.message; }
  finally { receiptDeleteBusy = false; $('#delete-receipt').disabled = false; $('#receipt-delete-submit').disabled = false; }
});

function render() {
  $('#receipt-trash').textContent = receiptTrash ? '입고 목록으로' : '삭제 내역 보기';
  $('#receipt-trash').setAttribute('aria-pressed', String(receiptTrash));
  $('#list-title').textContent = receiptTrash ? '삭제 내역 · 복구 가능' : '입고 목록';
  $('#new-receipt').disabled = receiptTrash;
  const metrics = document.querySelector('#operations-records .metrics');
  if (metrics) metrics.hidden = receiptTrash;
  $('#metric-orders').textContent = receipts.length;
  $('#metric-pending').textContent = receipts.reduce((sum, record) => sum + record.remaining, 0) + '개';
  $('#metric-shipped').textContent = receipts.reduce((sum, record) => sum + record.shipped, 0) + '개';
  $('#metric-total').textContent = won(receipts.reduce((sum, record) => sum + record.total, 0));
  $('#metric-paid').textContent=won(receipts.reduce((n,r)=>n+Number(r.paid||0),0));
  $('#metric-outstanding').textContent=won(receipts.reduce((n,r)=>n+Math.max(0,Number(r.balance||0)),0));
  $('#metric-credit').textContent=won(receipts.reduce((n,r)=>n+Math.max(0,-Number(r.balance||0)),0));
  const query = $('#search').value.trim().toLowerCase();
  const visible = receipts.filter((record) => (record.customer + record.code).toLowerCase().includes(query)
    && (filter === 'all' || (filter === 'pending' ? record.remaining > 0 : record.remaining === 0)));
  $('#receipt-items').replaceChildren();
  if (!visible.length) $('#receipt-items').append(element('p', '해당 입고 내역이 없습니다.', 'empty'));
  visible.forEach((record) => {
    const button = element('button', undefined, 'receipt-item' + (record.id === selected ? ' selected' : ''));
    button.append(element('small', record.received_date + ' · ' + record.code), element('strong', record.customer));
    const foot = element('span', undefined, 'item-foot');
    foot.append(element('span', record.model + ' · 입고 ' + record.quantity), element('span', record.remaining ? '미출고 ' + record.remaining : '출고 완료'));
    button.append(foot);
    button.setAttribute('aria-pressed', String(record.id === selected));
    button.addEventListener('click', () => { selected = record.id; render(); });
    $('#receipt-items').append(button);
  });
  const record = receipts.find((item) => item.id === selected);
  $('#empty-detail').hidden = Boolean(record);
  $('#detail-body').hidden = !record;
  if (!record) return;
  renderPayments(record);
  $('#detail-code').textContent = record.code;
  $('#detail-customer').textContent = record.customer;
  $('#detail-date').textContent = record.received_date;
  $('#detail-model').textContent = record.model;
  $('#detail-quantity').textContent = `${record.quantity}개 / ${record.shipped}개 / ${record.remaining}개`;
  $('#detail-state').textContent = receiptTrash ? '삭제됨' : record.remaining === 0 ? '출고 완료' : record.shipped ? '일부 출고' : '입고';
  $('#delete-receipt').textContent = receiptTrash ? '입고 복구' : '입고 삭제';
  $('#delete-receipt').disabled = receiptDeleteBusy;
  $('#trash-hint').textContent = receiptTrash ? '출고 기록과 송장 사진은 보관되어 있습니다. 복구 후 다시 사용할 수 있습니다.' : '삭제 후 삭제 내역에서 복구할 수 있습니다.';
  $('#detail-state').className = 'status' + (record.remaining === 0 ? ' complete' : '');
  $('#detail-note').textContent = record.note;
  $('#detail-photo').hidden = !record.photo_id;
  if (record.photo_id) {
    $('#detail-photo-image').removeAttribute('src'); $('#detail-photo').removeAttribute('href');
    privatePhotoUrl(record.photo_id).then(url => {
      if (selected !== record.id || $('#workspace').hidden) return;
      $('#detail-photo').href = url; $('#detail-photo-image').src = url;
    }).catch(error => notice(error.message));
  } else { $('#detail-photo-image').removeAttribute('src'); $('#detail-photo').removeAttribute('href'); }
  $('#new-shipment').disabled = receiptTrash || record.remaining === 0;
  $('#shipment-list').replaceChildren();
  if (!record.shipments.length) $('#shipment-list').append(element('p', '출고 내역 없음', 'muted'));
  record.shipments.forEach((shipment) => renderShipment(record, shipment));
}

function renderShipment(record, shipment) {
  const row = element('article', undefined, 'ship-row');
  const heading = element('div', undefined, 'ship-row-head');
  heading.append(element('span', `${shipment.sequence}차 출고 · ${shipment.shipped_date}`), element('strong', won(shipment.total)));
  row.append(heading, element('p', `출고 ${shipment.quantity}개 · 기본 수리 ${shipment.repaired}개 · 케이블 ${shipment.cables}개 · 휠 롤러 ${shipment.rollers}개`, 'muted'));
  if (receiptTrash) { $('#shipment-list').append(row); return; }
  const actions = element('div', undefined, 'ship-actions');
  const pdf = element('button', '입금 요청서 PDF 받기');
  pdf.addEventListener('click', async () => {
    pdf.disabled = true; pdf.textContent = 'PDF 만드는 중…';
    try {
      const fresh = await api(`/api/shipments/${shipment.id}/invoice`);
      if ($('#workspace').hidden) return;
      await window.smInvoice.download(fresh.record,fresh.shipment,() => !$('#workspace').hidden);
      notice('PDF 다운로드를 요청했습니다. 기기의 다운로드 목록을 확인해 주세요. 자동 발송되지는 않습니다.');
    } catch (error) { notice(error.message || 'PDF를 만들지 못했습니다. 다시 시도해 주세요.'); }
    finally { pdf.disabled = false; pdf.textContent = '입금 요청서 PDF 받기'; }
  });
  const copy = element('button', '입금 요청 문구 복사');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`[서울마우스 수리비 입금 요청]\n\n거래처: ${record.customer}\n접수번호: ${record.code}\n입고 ${record.quantity}개 / 이번 출고 ${shipment.quantity}개 (${shipment.sequence}차)\n\n기본 수리: ${shipment.repaired}개 × ${won(shipment.base_price)} = ${won(shipment.repaired * shipment.base_price)}\n케이블 교체: ${shipment.cables}개 × ${won(shipment.cable_price)} = ${won(shipment.cables * shipment.cable_price)}\n휠 롤러 교체: ${shipment.rollers}개 × ${won(shipment.roller_price)} = ${won(shipment.rollers * shipment.roller_price)}\n\n입금 요청 금액: ${won(shipment.total)}\n왕복 택배비: 매장 부담.\n입금계좌: 카카오뱅크 3333-16-0017681 유상균\n\n수리비 입금 부탁드립니다. 감사합니다.`);
      notice('입금 요청 문구가 복사되었습니다. 자동으로 발송되지는 않습니다.');
    } catch { notice('문구 복사에 실패했습니다. 브라우저 권한을 확인해 주세요.'); }
  });
  const share = element('button', 'PDF 발송 준비');
  share.addEventListener('click',()=>shareController.open(shipment.id));
  const postal = element('button', '우체국 등록파일 (.xls)');
  postal.addEventListener('click', async () => {
    postal.disabled=true;
    try { const fresh=await api(`/api/shipments/${shipment.id}/invoice`);window.smPostal.open(fresh.record,fresh.shipment,()=>!$('#workspace').hidden); }
    catch(error){notice(error.message);}
    finally{postal.disabled=false;}
  });
  actions.append(pdf, share, copy, postal);
  if (shipment.sent) actions.append(element('span', '발송 확인됨', 'sent-label'));
  else {
    const sent = element('button', '발송 완료 표시');
    sent.addEventListener('click', async () => {
      if (!confirm('고객에게 직접 PDF 또는 입금 요청 문구를 보냈나요? 실제 발송을 확인한 경우에만 표시합니다.')) return;
      try { await api(`/api/shipments/${shipment.id}/sent`, { confirmed: true }); await refresh(); }
      catch (error) { notice(error.message); }
    });
    actions.append(sent);
  }
  row.append(actions); $('#shipment-list').append(row);
}

$('#search').addEventListener('input', render);
$('#detail-photo').addEventListener('click', async event => {
  event.preventDefault();
  const record = receipts.find(item => item.id === selected);
  if (!record?.photo_id) return;
  try {
    const url = await privatePhotoUrl(record.photo_id);
    if (selected !== record.id || $('#workspace').hidden) return;
    $('#full-photo').src = url;
    $('#photo-dialog').showModal();
  } catch (error) { notice(error.message); }
});
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  render();
}));
$('#refresh').addEventListener('click', () => refresh().catch((error) => notice(error.message)));
$('#backup').addEventListener('click', async () => {
  if (!confirm('입고·출고·입금 전체 내역을 이 기기에 저장할까요? 상호·메모 등 고객 정보가 포함된 암호화되지 않은 파일입니다. 공용 기기에는 저장하지 마세요. 송장 사진 원본은 포함되지 않으며 자동 복원은 지원하지 않습니다. 다른 관리자의 등록이 없는 시간에 진행해 주세요.')) return;
  const generation = ++backupGeneration;
  const active = () => generation === backupGeneration && !$('#workspace').hidden;
  $('#backup').disabled = true;
  notice('전체 입고·출고·입금 내역을 확인하고 있습니다.');
  try {
    const data = await window.smBackup.collect({load:()=>api('/api/backup'),authorize:async()=>(await api('/api/session')).authenticated,isActive:active});
    if (!active()) return;
    window.smBackup.download(data);
    notice(`백업 다운로드를 요청했습니다. 입고 ${data.counts.receipts}건 · 출고 ${data.counts.shipments}건 · 입금 ${data.counts.payments}건. 송장 사진 원본은 제외됩니다. 파일을 안전한 개인 저장 공간에 보관해 주세요.`);
  } catch (error) { if (active()) notice(error.message || '백업에 실패했습니다. 다시 시도해 주세요.'); }
  finally { $('#backup').disabled = false; }
});
function renderPayments(record) {
  const paid=Number(record.paid||0),balance=Number(record.balance??record.total);
  $('#new-payment').disabled=receiptTrash||paymentBusy;
  $('#payment-summary').textContent=`청구 ${won(record.total)} · 입금 ${won(paid)} · `+(balance<0?`선입금·초과입금 ${won(-balance)}`:`미수금 ${won(balance)}`);
  $('#payment-list').replaceChildren();
  const rows=record.payments||[];
  if(!rows.length)$('#payment-list').append(element('p','입금 기록 없음','muted'));
  for(const p of rows){
    const article=element('article',undefined,'ship-row');
    const head=element('div',undefined,'ship-row-head');head.append(element('span',p.paid_date+(p.voided_at?' · 취소됨':'')),element('strong',won(p.amount)));article.append(head);
    if(p.note)article.append(element('p',p.note,'muted'));
    if(p.voided_at)article.append(element('p','취소 사유: '+p.void_reason,'muted'));
    else if(!receiptTrash){const cancel=element('button','입금 기록 취소','secondary');cancel.disabled=paymentBusy;cancel.addEventListener('click',()=>{
      paymentVoidTarget={id:p.id,receiptId:record.id};$('#payment-void-form').reset();$('#payment-void-description').textContent=record.customer+' · '+p.paid_date+' · '+won(p.amount);$('#payment-void-error').textContent='';$('#payment-void-dialog').showModal();
    });article.append(cancel);}
    $('#payment-list').append(article);
  }
}
$('#new-payment').addEventListener('click',()=>{
  const r=receipts.find(r=>r.id===selected);if(!r||receiptTrash||paymentBusy||$('#workspace').hidden)return;
  paymentTarget=r.id;paymentKey=crypto.randomUUID();$('#payment-form').reset();$('#paid-date').value=serverToday;$('#paid-date').max=serverToday;
  $('#payment-customer').textContent=r.customer+' · '+r.code;$('#payment-current').textContent=$('#payment-summary').textContent;$('#payment-error').textContent='';$('#payment-dialog').showModal();
});
$('#payment-dialog').addEventListener('close',()=>{paymentTarget=null;paymentKey='';});
$('#payment-void-dialog').addEventListener('close',()=>{paymentVoidTarget=null;});
$('#payment-form').addEventListener('submit',async event=>{
  event.preventDefault();if(paymentBusy||!paymentTarget||$('#workspace').hidden||!$('#payment-confirmed').checked)return;
  const amount=Number($('#paid-amount').value);if(!Number.isSafeInteger(amount)||amount<1||amount>1000000000){$('#payment-error').textContent='입금액을 확인해 주세요.';return;}
  const generation=paymentGeneration;paymentBusy=true;$('#save-payment').disabled=true;
  try{
    await api('/api/payments',{receipt_id:paymentTarget,paid_date:$('#paid-date').value,amount,note:$('#payment-note').value,request_key:paymentKey,confirmed:true});
    if(generation!==paymentGeneration||$('#workspace').hidden)return;
    $('#payment-dialog').close();await refresh();notice('입금 기록을 저장했습니다. 미수금과 선입금·초과입금을 확인해 주세요.');
  }catch(e){if(generation===paymentGeneration)$('#payment-error').textContent=e.message;}
  finally{paymentBusy=false;$('#save-payment').disabled=false;if(!$('#workspace').hidden)render();}
});
$('#payment-void-form').addEventListener('submit',async event=>{
  event.preventDefault();if(paymentBusy||!paymentVoidTarget||$('#workspace').hidden||!$('#payment-void-confirmed').checked)return;
  const reason=$('#payment-void-reason').value.trim();if(!reason)return;
  const generation=paymentGeneration;paymentBusy=true;$('#void-payment').disabled=true;
  try{await api('/api/payments/'+paymentVoidTarget.id+'/void',{reason,confirmed:true});if(generation!==paymentGeneration||$('#workspace').hidden)return;$('#payment-void-dialog').close();await refresh();notice('입금 기록을 취소하고 사유를 보관했습니다.');}
  catch(e){if(generation===paymentGeneration)$('#payment-void-error').textContent=e.message;}
  finally{paymentBusy=false;$('#void-payment').disabled=false;if(!$('#workspace').hidden)render();}
});
$('#export-excel').addEventListener('click',async()=>{
  if($('#workspace').hidden)return;
  const generation=++backupGeneration;const active=()=>generation===backupGeneration&&!$('#workspace').hidden;
  $('#export-excel').disabled=true;notice('서버의 전체 입고·출고·입금을 조회하여 엑셀을 만들고 있습니다.');
  try{
    if(!(await api('/api/session')).authenticated)throw Error('관리자 로그인이 필요합니다.');
    const data=await api('/api/backup');if(!active())return;
    if(!(await api('/api/session')).authenticated||!active())return;
    await window.smExcel.download(data,active);
    if(active())notice(`엑셀 다운로드를 요청했습니다. 입고 ${data.receipts.length}건 · 출고 ${data.shipments.length}건 · 입금 ${data.payments.length}건. 엑셀 수정은 서버에 반영되지 않으며 사진 원본은 제외됩니다.`);
  }catch(e){if(active())notice(e.message||'엑셀 생성에 실패했습니다.');}
  finally{$('#export-excel').disabled=false;}
});

document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $('#' + button.dataset.close).close()));

$('#new-receipt').addEventListener('click', () => {
  $('#receipt-form').reset();
  $('#ocr-assistance').open = false;
  resetReceiptOcr();
  photoGeneration++; photoId = null; photoBusy = false; selectedPhotoFile = null;
  $('#save-receipt').disabled = false;
  $('#received-date').value = serverToday;
  $('#receipt-error').textContent = '';
  $('#photo-preview').hidden = true; $('#photo-preview').removeAttribute('src'); $('#photo-placeholder').hidden = false;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  $('#ocr-text').textContent = '인식 내용 없음';
  $('#ocr-status').textContent = '사진 미등록 · JPG / PNG / WebP · 최대 12MB';
  $('#detected-dates').textContent = '송장 날짜(참고): 없음';
  $('#other-model-label').hidden = true; $('#other-model').required = false;
  $('#receipt-dialog').showModal();
});

$('#model').addEventListener('change', () => {
  $('#other-model-label').hidden = $('#model').value !== 'other';
  $('#other-model').required = $('#model').value === 'other';
});

$('#take-photo').addEventListener('click',()=>$('#camera-photo').click());
$('#camera-photo').addEventListener('change',()=>selectReceiptPhoto($('#camera-photo').files[0]));
$('#photo').addEventListener('change',()=>selectReceiptPhoto($('#photo').files[0]));
async function selectReceiptPhoto(file) {
  if (!file || !$('#receipt-dialog').open || $('#workspace').hidden) return;
  resetReceiptOcr();
  const generation = ++photoGeneration;
  selectedPhotoFile = file;
  $('#camera-photo').value = ''; $('#photo').value = '';
  photoId = null;
  photoBusy = false; $('#save-receipt').disabled = false;
  $('#photo-preview').hidden = true; $('#photo-preview').removeAttribute('src'); $('#photo-placeholder').hidden = false;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = null;
  $('#receipt-error').textContent = '';
  $('#ocr-status').textContent = '사진 미등록 · JPG / PNG / WebP · 최대 12MB';
  $('#receipt-confirmed').checked = false;
  if (!file) return;
  if (file.size > 12_000_000) { $('#receipt-error').textContent = '사진은 12MB 이하로 올려 주세요.'; return; }
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { $('#receipt-error').textContent = 'JPG·PNG·WebP 사진을 선택해 주세요.'; return; }
  $('#read-photo').disabled = false;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = URL.createObjectURL(file);
  $('#photo-preview').src = photoPreviewUrl; $('#photo-preview').hidden = false; $('#photo-placeholder').hidden = true;
  $('#receipt-error').textContent = '';
  $('#ocr-status').textContent = '비공개 서버에 사진 저장 중…';
  photoBusy = true; $('#save-receipt').disabled = true;
  try {
    const path = await uploadPrivatePhoto(file);
    if (generation !== photoGeneration || !$('#receipt-dialog').open || $('#workspace').hidden) return;
    photoId = path;
    $('#ocr-status').textContent = '사진 비공개 저장 완료 · 입고 정보를 직접 확인해 주세요.';
  } catch (error) {
    if (generation === photoGeneration) { $('#receipt-error').textContent = error.message; $('#ocr-status').textContent = '사진 등록 실패'; }
  } finally {
    if (generation === photoGeneration) { photoBusy = false; $('#save-receipt').disabled = false; }
  }
}

function resetReceiptOcr() {
  ocrGeneration++;
  window.smOcr?.cancel();
  $('#ocr-progress').hidden = true; $('#ocr-progress').value = 0;
  $('#cancel-ocr').hidden = true; $('#read-photo').disabled = true;
  $('#ocr-read-status').textContent = ''; $('#ocr-text').textContent = '인식 내용 없음';
  $('#ocr-suggestions').hidden = true; $('#ocr-customer').replaceChildren();
  $('#detected-dates').textContent = '송장 날짜(참고): 없음';
}
$('#receipt-dialog').addEventListener('close',()=>{
  resetReceiptOcr(); photoGeneration++; photoBusy = false; photoId = null; selectedPhotoFile = null;
  $('#photo').value = ''; $('#camera-photo').value = ''; $('#photo-preview').removeAttribute('src'); $('#photo-preview').hidden = true;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = null;
});
$('#cancel-ocr').addEventListener('click',()=>{
  resetReceiptOcr();
  $('#read-photo').disabled = !selectedPhotoFile;
  $('#ocr-read-status').textContent = '문자 인식을 중지했습니다. 직접 입력할 수 있습니다.';
});
$('#read-photo').addEventListener('click',async()=>{
  const file=selectedPhotoFile;
  if (!file) return;
  const generation=++ocrGeneration;
  $('#read-photo').disabled = true; $('#cancel-ocr').hidden = false;
  $('#ocr-progress').hidden = false; $('#ocr-progress').value = 0;
  $('#ocr-suggestions').hidden = true; $('#ocr-customer').replaceChildren();
  $('#ocr-text').textContent = '인식 중';
  $('#detected-dates').textContent = '송장 날짜(참고): 확인 중';
  const current=()=>generation===ocrGeneration && $('#receipt-dialog').open && !$('#workspace').hidden;
  try {
    const result=await window.smOcr.recognize(file,(status,progress)=>{
      if (!current()) return;
      const reading=status==='recognizing text';
      $('#ocr-read-status').textContent = reading ? `송장 방향 비교·글자 읽는 중 ${Math.round(progress*100)}%` : status.startsWith('방향') ? status : '한글 인식 도구 준비 중';
      $('#ocr-progress').value = progress;
    });
    if (!current()) return;
    $('#ocr-text').textContent = result.text || '읽어낸 글자가 없습니다.';
    $('#ocr-read-status').textContent = result.text.trim() ? `${result.rotation ?? 0}도 방향 보정 · 인식 점수 ${Math.round(result.confidence)}/100 (정확도 보장 아님) · 가려진 글자와 입고처를 직접 확인해 주세요.` : '글자를 찾지 못했습니다. 송장 부분을 정면으로 다시 찍거나 직접 입력해 주세요.';
    for (const item of result.senders) {
      const option=element('option',item.value+' ('+item.source+')'); option.value=item.value;
      $('#ocr-customer').append(option);
    }
    $('#ocr-suggestions').hidden = !result.senders.length;
    $('#detected-dates').textContent = '송장 날짜 후보: '+(result.dates.join(', ') || '없음')+' · 발송일일 수 있으므로 실제 입고일을 확인해 주세요.';
  } catch(error) {
    if (current()) { $('#ocr-read-status').textContent = error.message || '문자 인식에 실패했습니다. 직접 입력해 주세요.'; $('#ocr-text').textContent = '인식 내용 없음'; }
  } finally {
    if (current()) { $('#read-photo').disabled = false; $('#cancel-ocr').hidden = true; $('#ocr-progress').hidden = true; }
  }
});
$('#apply-ocr-customer').addEventListener('click',()=>{
  const candidate=$('#ocr-customer').value;
  if (!candidate) return;
  $('#customer').value = candidate; $('#receipt-confirmed').checked = false;
  $('#customer').focus();
});
$('#receipt-form').addEventListener('input',event=>{
  if (event.target.id!=='receipt-confirmed') $('#receipt-confirmed').checked = false;
});

$('#receipt-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (photoBusy) return;
  if (selectedPhotoFile && !photoId) { $('#receipt-error').textContent = '사진을 다시 촬영하거나 선택해 주세요.'; return; }
  $('#save-receipt').disabled = true;
  try {
    const receipt = await api('/api/receipts', {
      customer: $('#customer').value, received_date: $('#received-date').value,
      quantity: Number($('#received-quantity').value), model: $('#model').value === 'other' ? $('#other-model').value : 'G102',
      photo_id: photoId, confirmed: $('#receipt-confirmed').checked,
      note: window.smReceiptVoice ? window.smReceiptVoice.composeNote($('#receipt-address').value, $('#receipt-note').value) : $('#receipt-note').value,
    });
    selected = receipt.id;
    $('#receipt-dialog').close(); await refresh(); notice('입고 내역을 저장했습니다.');
  } catch (error) { $('#receipt-error').textContent = error.message; }
  finally { $('#save-receipt').disabled = false; }
});

$('#new-shipment').addEventListener('click', () => {
  const record = receipts.find((item) => item.id === selected);
  if (!record || !record.remaining) return;
  $('#shipment-form').reset();
  $('#shipment-customer').textContent = record.customer + ' · 미출고 ' + record.remaining + '개';
  $('#shipped-date').value = serverToday;
  $('#shipped-quantity').value = record.remaining; $('#shipped-quantity').max = record.remaining;
  $('#repaired').value = record.remaining;
  $('#base-price').value = record.model === 'G102' ? 7000 : '';
  $('#shipment-error').textContent = '';
  shipmentKey = crypto.randomUUID();
  updateTotal(); $('#shipment-dialog').showModal();
});

function updateTotal() {
  const repaired = Number($('#repaired').value);
  $('#base-count').textContent = repaired + '개';
  $('#shipment-total').textContent = won(repaired * Number($('#base-price').value)
    + Number($('#cables').value) * Number($('#cable-price').value)
    + Number($('#rollers').value) * Number($('#roller-price').value));
}
$('#shipment-form').addEventListener('input', updateTotal);
$('#shipment-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#save-shipment').disabled = true;
  let savedShipment=null;
  const sourceRecord=receipts.find(item=>item.id===selected);
  try {
    savedShipment=await api('/api/shipments', {
      receipt_id: selected, request_key: shipmentKey, shipped_date: $('#shipped-date').value,
      quantity: Number($('#shipped-quantity').value), repaired: Number($('#repaired').value),
      cables: Number($('#cables').value), rollers: Number($('#rollers').value),
      base_price: Number($('#base-price').value), cable_price: Number($('#cable-price').value), roller_price: Number($('#roller-price').value),
      confirmed: $('#shipment-confirmed').checked,
    });
    $('#shipment-dialog').close();
    notice('출고를 저장했습니다. 받는 분을 확인해 우체국 .xls 파일을 받을 수 있습니다.');
    try{await refresh();}catch(error){notice('출고는 저장됐습니다. 목록 갱신에 실패했습니다. 다시 출고 등록하지 말고 새로고침해 주세요.');}
    if(sourceRecord&&savedShipment&&!$('#workspace').hidden)window.smPostal.open(sourceRecord,savedShipment,()=>!$('#workspace').hidden);
  } catch (error) { if(savedShipment)notice('출고는 저장됐습니다. 파일은 출고 내역의 우체국 등록파일 버튼에서 다시 받을 수 있습니다.');else $('#shipment-error').textContent = error.message; }
  finally { $('#save-shipment').disabled = false; }
});

window.smMonthly = window.smMonthlyUI.create({
  load:()=>api('/api/backup'),
  isActive:()=>!$('#workspace').hidden,
  openReceipt:async id=>{
    receiptTrash=false;await refresh();
    if($('#workspace').hidden)throw Error('관리자 로그인이 필요합니다.');
    if(!receipts.some(r=>r.id===id))throw Error('접수를 찾을 수 없습니다. 월정산을 새로고침해 주세요.');
    selected=id;render();
  },
});
start();

