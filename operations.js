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
let shipmentKey = '';
const won = (value) => Number(value).toLocaleString('ko-KR') + '원';

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

$('#logout').addEventListener('click', async () => {
  try {
    await api('/api/logout', {}); receipts = []; selected = null; render();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    document.querySelectorAll('form').forEach(form => form.reset());
    $('#detail-photo-image').removeAttribute('src'); $('#detail-photo').removeAttribute('href');
    $('#full-photo').removeAttribute('src');
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    photoGeneration++; photoId = null; notice(''); await start();
  }
  catch (error) { notice(error.message); }
});

async function refresh() {
  receipts = await api('/api/receipts');
  if (!receipts.some((record) => record.id === selected)) selected = receipts[0]?.id || null;
  render();
}

function render() {
  $('#metric-orders').textContent = receipts.length;
  $('#metric-pending').textContent = receipts.reduce((sum, record) => sum + record.remaining, 0) + '개';
  $('#metric-shipped').textContent = receipts.reduce((sum, record) => sum + record.shipped, 0) + '개';
  $('#metric-total').textContent = won(receipts.reduce((sum, record) => sum + record.total, 0));
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
  $('#detail-code').textContent = record.code;
  $('#detail-customer').textContent = record.customer;
  $('#detail-date').textContent = record.received_date;
  $('#detail-model').textContent = record.model;
  $('#detail-quantity').textContent = `${record.quantity}개 / ${record.shipped}개 / ${record.remaining}개`;
  $('#detail-state').textContent = record.remaining === 0 ? '출고 완료' : record.shipped ? '일부 출고' : '입고';
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
  $('#new-shipment').disabled = record.remaining === 0;
  $('#shipment-list').replaceChildren();
  if (!record.shipments.length) $('#shipment-list').append(element('p', '출고 내역 없음', 'muted'));
  record.shipments.forEach((shipment) => renderShipment(record, shipment));
}

function renderShipment(record, shipment) {
  const row = element('article', undefined, 'ship-row');
  const heading = element('div', undefined, 'ship-row-head');
  heading.append(element('span', `${shipment.sequence}차 출고 · ${shipment.shipped_date}`), element('strong', won(shipment.total)));
  row.append(heading, element('p', `출고 ${shipment.quantity}개 · 기본 수리 ${shipment.repaired}개 · 케이블 ${shipment.cables}개 · 휠 롤러 ${shipment.rollers}개`, 'muted'));
  const actions = element('div', undefined, 'ship-actions');
  const pdf = element('button', '요청서 준비 중');
  pdf.disabled = true;
  const copy = element('button', '입금 요청 문구 복사');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`[서울마우스 수리비 입금 요청]\n\n거래처: ${record.customer}\n접수번호: ${record.code}\n입고 ${record.quantity}개 / 이번 출고 ${shipment.quantity}개 (${shipment.sequence}차)\n\n기본 수리: ${shipment.repaired}개 × ${won(shipment.base_price)} = ${won(shipment.repaired * shipment.base_price)}\n케이블 교체: ${shipment.cables}개 × ${won(shipment.cable_price)} = ${won(shipment.cables * shipment.cable_price)}\n휠 롤러 교체: ${shipment.rollers}개 × ${won(shipment.roller_price)} = ${won(shipment.rollers * shipment.roller_price)}\n\n입금 요청 금액: ${won(shipment.total)}\n왕복 택배비: 매장 부담.\n입금계좌: 카카오뱅크 3333-16-0017681 유상균\n\n수리비 입금 부탁드립니다. 감사합니다.`);
      notice('입금 요청 문구가 복사되었습니다. 자동으로 발송되지는 않습니다.');
    } catch { notice('문구 복사에 실패했습니다. 브라우저 권한을 확인해 주세요.'); }
  });
  actions.append(pdf, copy);
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
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $('#' + button.dataset.close).close()));

$('#new-receipt').addEventListener('click', () => {
  $('#receipt-form').reset();
  photoGeneration++; photoId = null; photoBusy = false;
  $('#save-receipt').disabled = false;
  $('#received-date').value = serverToday;
  $('#receipt-error').textContent = '';
  $('#photo-preview').hidden = true; $('#photo-preview').removeAttribute('src'); $('#photo-placeholder').hidden = false;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  $('#ocr-text').textContent = '자동 문자 인식은 준비 중입니다. 입고처·날짜·수량을 직접 확인해 주세요.';
  $('#ocr-status').textContent = '사진 미등록 · JPG / PNG / WebP · 최대 12MB';
  $('#detected-dates').textContent = '송장 날짜(참고): 없음';
  $('#other-model-label').hidden = true; $('#other-model').required = false;
  $('#receipt-dialog').showModal();
});

$('#model').addEventListener('change', () => {
  $('#other-model-label').hidden = $('#model').value !== 'other';
  $('#other-model').required = $('#model').value === 'other';
});

$('#photo').addEventListener('change', async () => {
  const generation = ++photoGeneration;
  const file = $('#photo').files[0];
  photoId = null;
  $('#receipt-confirmed').checked = false;
  if (!file) return;
  if (file.size > 12_000_000) { $('#receipt-error').textContent = '사진은 12MB 이하로 올려 주세요.'; return; }
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = URL.createObjectURL(file);
  $('#photo-preview').src = photoPreviewUrl; $('#photo-preview').hidden = false; $('#photo-placeholder').hidden = true;
  $('#receipt-error').textContent = '';
  $('#ocr-status').textContent = '비공개 서버에 사진 저장 중…';
  photoBusy = true; $('#save-receipt').disabled = true;
  try {
    const path = await uploadPrivatePhoto(file);
    if (generation !== photoGeneration) return;
    photoId = path;
    $('#ocr-status').textContent = '사진 비공개 저장 완료 · 입고 정보를 직접 확인해 주세요.';
  } catch (error) {
    if (generation === photoGeneration) { $('#receipt-error').textContent = error.message; $('#ocr-status').textContent = '사진 등록 실패'; }
  } finally {
    if (generation === photoGeneration) { photoBusy = false; $('#save-receipt').disabled = false; }
  }
});

$('#receipt-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (photoBusy) return;
  if ($('#photo').files.length && !photoId) { $('#receipt-error').textContent = '사진을 다시 등록하거나 파일 선택을 해제해 주세요.'; return; }
  $('#save-receipt').disabled = true;
  try {
    const receipt = await api('/api/receipts', {
      customer: $('#customer').value, received_date: $('#received-date').value,
      quantity: Number($('#received-quantity').value), model: $('#model').value === 'other' ? $('#other-model').value : 'G102',
      photo_id: photoId, confirmed: $('#receipt-confirmed').checked, note: $('#receipt-note').value,
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
  try {
    await api('/api/shipments', {
      receipt_id: selected, request_key: shipmentKey, shipped_date: $('#shipped-date').value,
      quantity: Number($('#shipped-quantity').value), repaired: Number($('#repaired').value),
      cables: Number($('#cables').value), rollers: Number($('#rollers').value),
      base_price: Number($('#base-price').value), cable_price: Number($('#cable-price').value), roller_price: Number($('#roller-price').value),
      confirmed: $('#shipment-confirmed').checked,
    });
    $('#shipment-dialog').close(); await refresh(); notice('출고를 저장했습니다. 입금 요청 문구를 복사할 수 있습니다.');
  } catch (error) { $('#shipment-error').textContent = error.message; }
  finally { $('#save-shipment').disabled = false; }
});

start();
