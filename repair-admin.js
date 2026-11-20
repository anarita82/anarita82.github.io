/* 서울마우스 — 수리·재고 관리 (repair-admin.html)
   PIN → Firebase 이메일 인증 → Firestore 접수·수리·정산 + 부품 재고·입출고 관리
   데이터: seoulmouse_repairs(접수) · seoulmouse_parts(부품) · seoulmouse_part_logs(입출고) */
(function () {
  'use strict';

  var API_KEY = 'AIzaSyCutf-64Bl3sXtm-xZtr5vRZUqwpkNI6NY';
  var PROJECT = 'family-calendar-woo';
  var DOCS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
  var TICKETS = 'seoulmouse_repairs';
  var PARTS = 'seoulmouse_parts';
  var LOGS = 'seoulmouse_part_logs';
  var ADMIN_EMAIL = 'repair-admin@anarita82.github.io';
  var PIN_SALT = 'seoulmouse-repair-admin-v1';
  var PIN_ITERATIONS = 120000;
  var SESSION_KEY = 'seoulmouse.repair.admin.v1';
  var PIN_MARK = 'seoulmouse.repair.pinChangedAt';
  var SITE = 'https://anarita82.github.io/';
  var EPOST_PARCEL = 'https://parcel.epost.go.kr/';
  var OWNER_SENDER = '서울마우스(유상균) 010-3100-4361';
  var DEFAULT_AS_NOTE = '이전 수리에 케이블을 교체하지 않은 제품이 케이블 단선으로 고장 나면 AS 접수 시 케이블 교체 비용 2,000원이 발생합니다.';
  var DEFAULT_RETURN_CARRIER = 'post';

  /* 고객 화면과 같은 5단계. 예전 데이터의 done 은 repaired 로 읽습니다. */
  var STATUS = {
    received: { label: '접수·발송', step: 0, chip: 'received' },
    arrived: { label: '매장 도착', step: 1, chip: 'arrived' },
    repairing: { label: '수리 진행', step: 2, chip: 'repairing' },
    repaired: { label: '수리 완료', step: 3, chip: 'repaired' },
    shipped: { label: '발송 완료', step: 4, chip: 'shipped' }
  };
  var LEGACY_STATUS = { done: 'repaired' };
  var STATUS_ORDER = ['received', 'arrived', 'repairing', 'repaired', 'shipped'];
  var PART_CATEGORIES = ['스위치', '인코더', '휠롤러', '케이블', '피트', '기타'];
  var SYMPTOM_NAMES = { double: '더블클릭', wheel: '휠 불량', cable: '케이블', other: '기타' };

  /* 택배는 여러 브랜드에서 오므로 주요 택배사·편의점택배를 모두 둡니다.
     기타(직접입력)는 코드 대신 고객이 적은 이름이 carrier 에 그대로 저장됩니다. */
  var CARRIERS = {
    post: '우체국택배', cj: 'CJ대한통운', lotte: '롯데택배', hanjin: '한진택배',
    logen: '로젠택배', kyungdong: '경동택배', daesin: '대신택배',
    gs: 'GS25 편의점택배', cu: 'CU 편의점택배', etc: '기타 택배'
  };
  var CARRIER_ORDER = ['cj', 'post', 'lotte', 'hanjin', 'logen', 'kyungdong', 'daesin', 'gs', 'cu', 'etc'];
  /* 반송은 우체국 사전접수 후 창구에서 보내는 방식만 씁니다 — 기본값을 우체국택배로 고정합니다. */
  var RETURN_CARRIER_ORDER = ['post', 'cj', 'lotte', 'hanjin', 'logen', 'kyungdong', 'daesin', 'gs', 'cu', 'etc'];

  var state = {
    token: '', exp: 0,
    tickets: [], parts: [], logs: [],
    filter: 'all', search: '',
    openForm: '', openMessage: '',
    tab: 'repair',
    partForm: '', partEdit: '',
    busy: false
  };

  /* ---------------- 유틸 ---------------- */
  function $(id) { return document.getElementById(id); }
  function onlyDigits(v) { return String(v || '').replace(/[^0-9]/g, ''); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function todayYmd() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowIso() { return new Date().toISOString(); }
  function won(value) { return Number(value || 0).toLocaleString('ko-KR') + '원'; }

  function ymdToDate(text) {
    var p = String(text || '').split('-');
    if (p.length !== 3) return null;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  function addDays(text, days) {
    var d = ymdToDate(text);
    if (!d) return '';
    d.setDate(d.getDate() + Number(days));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function koreanDate(text) {
    var d = typeof text === 'string' && text.indexOf('T') > -1 ? new Date(text) : ymdToDate(text);
    if (!d || isNaN(d.getTime())) return '-';
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + days[d.getDay()] + ')';
  }
  function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(text) {
    var el = document.querySelector('.rp-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'rp-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('is-on');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('is-on'); }, 2600);
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.className = 'rp-copy-src';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, area.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
  function formatPhone(value) {
    var d = onlyDigits(value);
    if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    return d;
  }

  /* 택배사 코드 → 이름. 직접입력한 이름이나 옛 데이터는 적힌 그대로 보여 줍니다. */
  function carrierName(code) {
    var key = String(code || '').trim();
    if (!key) return '';
    return CARRIERS[key] || key;
  }

  function carrierOptions(order, selected, allowEmpty) {
    var current = String(selected || '').trim();
    var html = allowEmpty ? '<option value=""' + (current ? '' : ' selected') + '>선택 안 함</option>' : '';
    html += order.map(function (key) {
      return '<option value="' + key + '"' + (current === key ? ' selected' : '') + '>' + CARRIERS[key] + '</option>';
    }).join('');
    /* 목록에 없는 직접입력 이름도 고칠 수 있게 앞에 한 칸 둡니다. */
    if (current && !CARRIERS[current]) {
      html = '<option value="' + escapeHtml(current) + '" selected>' + escapeHtml(current) + '</option>' + html;
    }
    return html;
  }

  function normalizeStatus(value) {
    var key = String(value || '');
    return LEGACY_STATUS[key] || key;
  }

  /* 인터넷우체국 「창구소포 간편사전접수」에 그대로 붙여넣을 정보 */
  function postalInfoText(ticket) {
    var address = String(ticket.address || '').replace(/\s+/g, ' ').trim();
    var zip = (address.match(/^\(?(\d{5})\)?/) || [])[1] || '';
    var rest = zip ? address.replace(/^\(?(\d{5}\)?)\s*/, '') : address;
    var lines = [
      '받는분 성명: ' + (ticket.name || ''),
      '받는분 연락처: ' + (formatPhone(ticket.phone) || '')
    ];
    if (zip) lines.push('받는분 우편번호: ' + zip);
    lines.push('받는분 주소: ' + rest);
    lines.push('품명: ' + productLine(ticket));
    lines.push('보내는분: ' + OWNER_SENDER);
    if (ticket.ticketNo) lines.push('참고 접수번호: ' + ticket.ticketNo);
    return lines.join('\n');
  }

  function apiCode(res) {
    return res && res.data && res.data.error ? (res.data.error.status || res.data.error.message || '') : '';
  }

  function showError(el, message) {
    if (!el) return;
    if (!message) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = message;
    el.hidden = false;
  }

  /* ---------------- PIN → 비밀번호 ---------------- */
  function derivePassword(pin) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(PIN_SALT), iterations: PIN_ITERATIONS, hash: 'SHA-256' }, key, 256);
    }).then(function (bits) {
      var bytes = new Uint8Array(bits);
      var text = '';
      for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
      return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    });
  }

  function authFetch(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function signIn(pin) {
    return derivePassword(pin).then(function (password) {
      return authFetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY, {
        email: ADMIN_EMAIL, password: password, returnSecureToken: true
      });
    }).then(function (res) {
      if (!res.ok) {
        var code = res.data && res.data.error ? res.data.error.message : '';
        if (code === 'INVALID_LOGIN_CREDENTIALS' || code === 'EMAIL_NOT_FOUND' || code === 'INVALID_PASSWORD') throw new Error('wrong_pin');
        if (code === 'TOO_MANY_ATTEMPTS_TRY_LATER') throw new Error('too_many');
        throw new Error('auth_failed');
      }
      state.token = res.data.idToken;
      state.exp = Date.now() + (Number(res.data.expiresIn) || 3600) * 1000;
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: state.token, exp: state.exp })); } catch (e) { /* 무시 */ }
      return true;
    });
  }

  function restore() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      if (!saved.token || saved.exp < Date.now() + 30000) return false;
      state.token = saved.token;
      state.exp = saved.exp;
      return true;
    } catch (e) { return false; }
  }

  function clearSession() {
    state.token = '';
    state.exp = 0;
    state.tickets = [];
    state.parts = [];
    state.logs = [];
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* 무시 */ }
  }

  /* ---------------- Firestore 값 변환 ---------------- */
  function toValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') return { integerValue: String(Math.round(value)) };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
    return { mapValue: { fields: toFields(value) } };
  }
  function toFields(obj) {
    var fields = {};
    Object.keys(obj).forEach(function (key) {
      if (obj[key] === undefined) return;
      fields[key] = toValue(obj[key]);
    });
    return fields;
  }
  function fromValue(value) {
    if (!value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('booleanValue' in value) return value.booleanValue;
    if ('nullValue' in value) return null;
    if ('timestampValue' in value) return value.timestampValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromValue);
    if ('mapValue' in value) return fromFields(value.mapValue.fields || {});
    return null;
  }
  function fromFields(fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (key) { out[key] = fromValue(fields[key]); });
    return out;
  }

  function fsFetch(method, path, body, params) {
    if (!state.token) return Promise.reject(new Error('no_session'));
    var url = DOCS + path;
    if (params) {
      var pairs = [];
      Object.keys(params).forEach(function (key) {
        var value = params[key];
        if (Array.isArray(value)) value.forEach(function (item) { pairs.push([key, item]); });
        else pairs.push([key, value]);
      });
      if (pairs.length) {
        url += '?' + pairs.map(function (pair) {
          return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]);
        }).join('&');
      }
    }
    return fetch(url, {
      method: method,
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
        if (res.status === 401 || res.status === 403) throw new Error('session');
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function docName(collection, id) {
    return 'projects/' + PROJECT + '/databases/(default)/documents/' + collection + '/' + id;
  }

  /* 여러 문서를 한 번에(원자적으로) 저장합니다 — 접수 + 부품 재고 + 입출고 이력. */
  function commit(writes) {
    if (!writes.length) return Promise.resolve({ ok: true, status: 200, data: {} });
    return fsFetch('POST', ':commit', { writes: writes });
  }

  function writeUpdate(collection, id, fields, mask) {
    var write = {
      update: { name: docName(collection, id), fields: toFields(fields) },
      currentDocument: { exists: true }
    };
    if (mask) write.updateMask = { fieldPaths: mask };
    return write;
  }

  /* 필드 일부만 바꾸고 수량은 서버에서 증감시킵니다(동시 저장 충돌 방지).
     updateMask 가 비면 문서가 통째로 교체되므로, 항상 한 필드는 함께 씁니다. */
  function writeIncrement(collection, id, fields, field, delta) {
    var safeFields = {};
    Object.keys(fields || {}).forEach(function (key) { if (key !== field) safeFields[key] = fields[key]; });
    if (!Object.keys(safeFields).length) safeFields.updatedAt = nowIso();
    return {
      update: { name: docName(collection, id), fields: toFields(safeFields) },
      updateMask: { fieldPaths: Object.keys(safeFields) },
      updateTransforms: [{ fieldPath: field, increment: { integerValue: String(delta) } }],
      currentDocument: { exists: true }
    };
  }

  function writeCreate(collection, id, fields) {
    return { update: { name: docName(collection, id), fields: toFields(fields) } };
  }

  function newLogId() {
    return 'log_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function logWrite(entry) {
    return writeCreate(LOGS, newLogId(), entry);
  }

  /* ---------------- 불러오기 ---------------- */
  function runQuery(collection, orderBy, limit) {
    var query = { from: [{ collectionId: collection }], limit: limit || 300 };
    if (orderBy) query.orderBy = [{ field: { fieldPath: orderBy.field }, direction: orderBy.direction || 'DESCENDING' }];
    return fsFetch('POST', ':runQuery', { structuredQuery: query }).then(function (res) {
      if (!res.ok) throw new Error('load_failed');
      var rows = Array.isArray(res.data) ? res.data : [];
      return rows.filter(function (row) { return row && row.document; }).map(function (row) {
        var doc = row.document;
        var item = fromFields(doc.fields || {});
        item._id = String(doc.name || '').split('/').pop();
        return item;
      });
    });
  }

  function loadTickets() {
    return runQuery(TICKETS, { field: 'createdAt', direction: 'DESCENDING' }, 300).then(function (rows) {
      state.tickets = rows.sort(function (a, b) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
      return state.tickets;
    });
  }

  function loadParts() {
    return runQuery(PARTS, null, 500).then(function (rows) {
      rows.sort(function (a, b) {
        var ca = PART_CATEGORIES.indexOf(a.category), cb = PART_CATEGORIES.indexOf(b.category);
        if (ca !== cb) return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb);
        return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
      });
      state.parts = rows;
      return state.parts;
    });
  }

  function loadLogs() {
    return runQuery(LOGS, { field: 'at', direction: 'DESCENDING' }, 40).then(function (rows) {
      state.logs = rows;
      return state.logs;
    });
  }

  /* ---------------- 부품 ---------------- */
  function findPart(id) {
    for (var i = 0; i < state.parts.length; i++) if (state.parts[i]._id === id) return state.parts[i];
    return null;
  }
  function partQty(part) { return Number(part && part.qty) || 0; }
  function partMin(part) { return Number(part && part.minQty) || 0; }
  function isLow(part) { return partQty(part) <= partMin(part); }
  function lowParts() { return state.parts.filter(isLow); }

  /* 선택한 사용 부품 → 이름·단가 스냅샷과 원가 합계 */
  function priceUsedParts(rows, fallbackList) {
    var map = {};
    var order = [];
    (fallbackList || []).forEach(function (item) { map[item.partId] = { partId: item.partId, name: item.name || '', qty: 0, unitCost: Number(item.unitCost) || 0 }; });
    (rows || []).forEach(function (row) {
      if (!row || !row.partId) return;
      var qty = Number(row.qty) || 0;
      if (qty <= 0) return;
      if (!map[row.partId]) { map[row.partId] = { partId: row.partId, name: '', qty: 0, unitCost: 0 }; order.push(row.partId); }
      map[row.partId].qty += qty;
    });
    var list = [];
    Object.keys(map).forEach(function (id) {
      var entry = map[id];
      if (!entry.qty) return;
      var part = findPart(id);
      var name = part ? part.name : (entry.name || '삭제된 부품');
      var unitCost = part ? (Number(part.unitCost) || 0) : entry.unitCost;
      list.push({ partId: id, name: name, qty: entry.qty, unitCost: unitCost });
    });
    var cost = list.reduce(function (sum, item) { return sum + item.qty * item.unitCost; }, 0);
    return { list: list, cost: cost };
  }

  function qtyMap(list) {
    var map = {};
    (list || []).forEach(function (item) { if (item && item.partId) map[item.partId] = (map[item.partId] || 0) + (Number(item.qty) || 0); });
    return map;
  }

  function categoryOptions(selected) {
    var current = String(selected || '기타');
    return PART_CATEGORIES.map(function (name) {
      return '<option value="' + name + '"' + (current === name ? ' selected' : '') + '>' + name + '</option>';
    }).join('');
  }

  /* ---------------- 접수 저장(상태·정산·부품 차감) ---------------- */
  function saveTicket(ticket, fields, options) {
    options = options || {};
    if (state.busy) return;
    var writes = [];
    var stockChanges = [];

    if (options.nextParts) {
      var priced = priceUsedParts(options.nextParts, ticket.usedParts);
      fields.usedParts = priced.list;
      fields.partsCost = priced.cost;
      var previous = qtyMap(ticket.usedParts);
      var next = qtyMap(priced.list);
      var ids = Object.keys(previous);
      Object.keys(next).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var delta = (next[id] || 0) - (previous[id] || 0);
        if (!delta) continue;
        var part = findPart(id);
        if (!part) continue;
        if (delta > 0 && partQty(part) < delta) {
          toast(part.name + ' 재고가 부족합니다. 현재 ' + partQty(part) + '개 — ② 부품·재고 관리에서 입고를 먼저 등록하세요.');
          return;
        }
        stockChanges.push({ part: part, delta: delta });
      }
    }

    fields.updatedAt = nowIso();
    writes.push(writeUpdate(TICKETS, ticket._id, fields, Object.keys(fields)));
    stockChanges.forEach(function (change) {
      var part = change.part;
      writes.push(writeIncrement(PARTS, part._id, { updatedAt: nowIso() }, 'qty', -change.delta));
      writes.push(logWrite({
        partId: part._id,
        partName: part.name,
        type: 'repair',
        qty: -change.delta,
        unitCost: Number(part.unitCost) || 0,
        ticketNo: ticket.ticketNo || ticket._id,
        reason: change.delta > 0 ? '수리 사용' : '수리 사용 취소',
        at: nowIso()
      }));
    });

    state.busy = true;
    commit(writes).then(function (res) {
      if (!res.ok) throw new Error('save_failed:' + apiCode(res));
      Object.keys(fields).forEach(function (key) { ticket[key] = fields[key]; });
      stockChanges.forEach(function (change) { change.part.qty = partQty(change.part) - change.delta; });
      state.openForm = '';
      if (options.openMessage) state.openMessage = ticket._id + ':' + options.openMessage;
      else if (options.closeMessage) state.openMessage = '';
      state.busy = false;
      loadLogs().catch(function () { return []; }).then(function () {
        renderAll();
        if (options.message) toast(options.message);
      });
    }).catch(function (err) {
      state.busy = false;
      if (err && err.message === 'session') { lock('PIN 세션이 만료되었습니다. 다시 열어 주세요.'); return; }
      toast('저장하지 못했습니다. ' + (err && err.message && err.message.indexOf('save_failed:') === 0 ? '(' + err.message.slice(12) + ') ' : '') + '다시 시도해 주세요.');
    });
  }

  function expectedRange(daysText, arrivedAt) {
    var nums = String(daysText || '').match(/[0-9]+/g) || [];
    var from = nums.length ? Number(nums[0]) : 15;
    var to = nums.length > 1 ? Number(nums[1]) : from;
    if (!from) from = 15;
    if (!to) to = from;
    if (to < from) { var t = to; to = from; from = t; }
    return { from: addDays(arrivedAt, from), to: addDays(arrivedAt, to), fromDays: from, toDays: to };
  }

  function applyStatus(ticket, status, extra, nextParts) {
    var fields = { status: status };
    Object.keys(extra || {}).forEach(function (key) { if (extra[key] !== undefined) fields[key] = extra[key]; });
    fields.updatedAt = nowIso();
    var history = Array.isArray(ticket.statusHistory) ? ticket.statusHistory.slice(-8) : [];
    history.push({ status: status, at: fields.updatedAt });
    fields.statusHistory = history;
    saveTicket(ticket, fields, {
      nextParts: nextParts,
      openMessage: (status === 'arrived' || status === 'repairing' || status === 'repaired' || status === 'shipped') ? status : '',
      message: STATUS[status].label + ' 처리 완료 · 카톡 문구가 준비되었습니다'
    });
  }

  function togglePaid(ticket) {
    var paid = !ticket.paid;
    saveTicket(ticket, { paid: paid, paidAt: paid ? todayYmd() : '', updatedAt: nowIso() }, {
      message: paid ? '입금 완료로 표시했습니다' : '입금 대기로 되돌렸습니다'
    });
  }

  /* ---------------- 카톡 문구 ---------------- */
  function lookupLink(ticket) {
    return SITE + 'repair.html?code=' + encodeURIComponent(ticket.ticketNo);
  }

  function productLine(ticket) {
    return (ticket.model || '마우스') + ' ' + (ticket.qty || 1) + '개';
  }

  function messageFor(ticket, kind) {
    kind = normalizeStatus(kind);
    var name = ticket.name || '고객';
    var link = lookupLink(ticket);
    var range = ticket.expectedFrom && ticket.expectedTo
      ? koreanDate(ticket.expectedFrom) + ' ~ ' + koreanDate(ticket.expectedTo)
      : (function () {
        var r = expectedRange(ticket.expectedDays || '15~20일', ticket.arrivedAt || todayYmd());
        return koreanDate(r.from) + ' ~ ' + koreanDate(r.to);
      })();
    var lines = [];

    if (kind === 'arrived') {
      lines = [
        '[서울마우스] 택배 도착했습니다',
        '',
        name + '님, 보내주신 ' + productLine(ticket) + ', ' + koreanDate(ticket.arrivedAt || todayYmd()) + ' 도착했습니다.',
        '',
        '· 접수번호: ' + ticket.ticketNo,
        '· 예상 수리기간: ' + (ticket.expectedDays || '15~20일') + ' (도착일 기준)',
        '· 완료 예정: ' + range,
        '',
        '진행 상황은 아래 주소에서 확인하실 수 있습니다.',
        link,
        '',
        '수리가 끝나면 반송 송장번호와 함께 다시 연락드리겠습니다.',
        '서울마우스 · 010-3100-4361'
      ];
    } else if (kind === 'repairing') {
      lines = [
        '[서울마우스] 수리 진행 중입니다',
        '',
        name + '님, ' + productLine(ticket) + ' 수리를 시작했습니다.',
        '',
        '· 접수번호: ' + ticket.ticketNo,
        '· 진행 상태: 수리 진행',
        '· 완료 예정: ' + range
      ];
      if (ticket.ownerMemo) lines.push('· 안내: ' + ticket.ownerMemo);
      lines.push('', '진행 상황: ' + link, '', '완료되면 다시 연락드리겠습니다.', '서울마우스 · 010-3100-4361');
    } else if (kind === 'repaired') {
      var fee = Number(ticket.repairFee || ticket.quote || 0);
      lines = [
        '[서울마우스] 수리 완료 안내',
        '',
        name + '님, ' + productLine(ticket) + ' 수리가 완료되었습니다.',
        '',
        '· 접수번호: ' + ticket.ticketNo
      ];
      if (fee) lines.push('· 수리 금액: ' + won(fee));
      if (ticket.ownerMemo) lines.push('· 수리 내용: ' + ticket.ownerMemo);
      lines.push('', ticket.asNote || DEFAULT_AS_NOTE);
      lines.push('', '반송은 우체국택배로 사전접수 후 보내드립니다. 송장번호는 발송한 뒤 다시 알려드리겠습니다.', '서울마우스 · 010-3100-4361');
    } else if (kind === 'shipped') {
      var returnCarrier = carrierName(ticket.returnCarrier || DEFAULT_RETURN_CARRIER) || '우체국택배';
      var returnTracking = onlyDigits(ticket.returnTrackingNo || '');
      lines = [
        '[서울마우스] 반송 발송했습니다',
        '',
        name + '님, 수리한 ' + productLine(ticket) + ', ' + returnCarrier + '로 발송했습니다.',
        '',
        '· 접수번호: ' + ticket.ticketNo,
        '· 택배사: ' + returnCarrier + (returnTracking ? '' : ' (사전접수)'),
        '· 송장번호: ' + (returnTracking || '사전접수 완료 — 창구 접수 후 번호를 알려드리겠습니다'),
        '',
        '보통 1~2일 안에 도착합니다. 받으신 뒤 이상이 있으면 연락 주세요.',
        ticket.asNote || DEFAULT_AS_NOTE,
        '',
        '진행 상황: ' + link,
        '서울마우스 · 010-3100-4361'
      ];
    } else {
      lines = [
        '[서울마우스] 접수 확인',
        '',
        name + '님, 접수가 정상적으로 등록되었습니다.',
        '',
        '· 접수번호: ' + ticket.ticketNo,
        '· 제품: ' + productLine(ticket),
        '· 회송 주소: ' + (ticket.address || '-'),
        '',
        '택배를 보내실 때 박스 안에 접수번호를 적은 메모를 함께 넣어 주세요.',
        '보내실 곳: 서울특별시 송파구 풍납동 78-83 지층 제노PC방 / 서울마우스 / 유상균',
        '',
        '서울마우스 · 010-3100-4361'
      ];
    }
    return lines.join('\n');
  }

  /* ---------------- 접수 화면 ---------------- */
  function counts() {
    var out = { all: state.tickets.length, received: 0, arrived: 0, repairing: 0, repaired: 0, shipped: 0 };
    state.tickets.forEach(function (t) {
      var key = normalizeStatus(t.status);
      if (out[key] !== undefined) out[key] += 1;
    });
    return out;
  }

  function matchSearch(ticket) {
    var q = state.search.trim().toLowerCase();
    if (!q) return true;
    var haystack = [ticket.name, ticket.ticketNo, ticket.trackingNo, ticket.returnTrackingNo, ticket.phone, ticket.model].join(' ').toLowerCase();
    return haystack.indexOf(q) > -1;
  }

  function visibleTickets() {
    return state.tickets.filter(function (t) {
      if (state.filter !== 'all' && normalizeStatus(t.status) !== state.filter) return false;
      return matchSearch(t);
    });
  }

  function renderTickets() {
    var c = counts();
    Object.keys(c).forEach(function (key) {
      var el = document.querySelector('[data-count="' + key + '"]');
      if (el) el.textContent = String(c[key]);
    });
    document.querySelectorAll('.rp-filter').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-status') === state.filter ? 'true' : 'false');
    });
    var pending = (c.received || 0) + (c.arrived || 0) + (c.repairing || 0);
    var low = lowParts().length;
    $('summary').textContent = '전체 ' + c.all + '건 · 진행 중 ' + pending + '건 · 입금 대기 '
      + state.tickets.filter(function (t) { var s = normalizeStatus(t.status); return (s === 'repaired' || s === 'shipped') && !t.paid; }).length + '건'
      + ' · 부족 부품 ' + low + '종 · 마지막 갱신 '
      + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    var list = visibleTickets();
    var box = $('ticket-list');
    if (!list.length) {
      box.innerHTML = '<p class="rp-ticket rp-ticket-empty">' + (state.tickets.length ? '조건에 맞는 접수가 없습니다.' : '아직 접수된 건이 없습니다. 고객이 접수하면 여기에 표시됩니다.') + '</p>';
      return;
    }
    box.innerHTML = list.map(cardHtml).join('');
  }

  function cardHtml(ticket) {
    var key = normalizeStatus(ticket.status);
    var status = STATUS[key] || STATUS.received;
    var symptoms = (ticket.symptoms || []).map(function (sym) { return SYMPTOM_NAMES[sym] || sym; }).join(' · ');
    var arrivedLine = ticket.arrivedAt ? ' · 도착 ' + koreanDate(ticket.arrivedAt) : '';
    var expectedLine = ticket.expectedFrom && ticket.expectedTo ? '<br>완료 예정 <b>' + koreanDate(ticket.expectedFrom) + ' ~ ' + koreanDate(ticket.expectedTo) + '</b>' : '';
    var html = '';
    html += '<article class="rp-ticket st-' + status.chip + '" data-id="' + escapeHtml(ticket._id) + '">';
    html += '<div class="rp-ticket-top"><span class="rp-ticket-no-sm">' + escapeHtml(ticket.ticketNo) + '</span>';
    html += '<span class="rp-status-chip rp-status-' + status.chip + '">' + status.label + '</span></div>';
    html += '<p class="rp-ticket-meta"><b>' + escapeHtml(ticket.name || '') + '</b> · ' + escapeHtml(formatPhone(ticket.phone)) + (ticket.kakao ? ' · 카톡 ' + escapeHtml(ticket.kakao) : '') + '<br>';
    html += '<b>' + escapeHtml(ticket.model || '') + '</b> ' + (ticket.qty || 1) + '개 · <span class="rp-sym">' + escapeHtml(symptoms || '증상 미기재') + '</span>';
    if (ticket.symptomNote) html += '<br>' + escapeHtml(ticket.symptomNote);
    html += '<br>' + escapeHtml(ticket.address || '');
    var incomingCarrier = carrierName(ticket.carrier);
    if (ticket.trackingNo || incomingCarrier) html += '<br>보내신 택배 ' + escapeHtml(incomingCarrier || '택배사 미기재') + (ticket.trackingNo ? ' ' + escapeHtml(ticket.trackingNo) : '');
    html += '<br>접수 ' + koreanDate(ticket.createdAt) + arrivedLine + expectedLine;
    if (ticket.returnCarrier || ticket.returnTrackingNo || key === 'shipped') {
      var returnLabel = carrierName(ticket.returnCarrier || DEFAULT_RETURN_CARRIER) || '우체국택배';
      html += '<br>반송 ' + escapeHtml(returnLabel) + (ticket.returnTrackingNo ? ' ' + escapeHtml(ticket.returnTrackingNo) : ' <span class="rp-muted">사전접수 · 송장번호 미등록</span>');
    }
    html += '</p>';

    html += settleHtml(ticket);

    html += '<div class="rp-ticket-actions">';
    if (key === 'received') html += actionBtn(ticket, 'arrived', '📦 매장 도착');
    if (key === 'arrived') html += actionBtn(ticket, 'repairing', '🔧 수리 시작');
    if (key === 'repairing') html += actionBtn(ticket, 'repaired', '✅ 수리 완료');
    if (key === 'repaired') html += actionBtn(ticket, 'shipped', '📮 반송 발송');
    if (key === 'repaired' || key === 'shipped') {
      html += '<button class="rp-act rp-act-postal" type="button" data-action="postal" data-id="' + escapeHtml(ticket._id) + '">📋 우체국 사전접수</button>';
      html += '<button class="rp-act' + (ticket.paid ? '' : ' rp-act-primary') + '" type="button" data-paid-toggle="' + escapeHtml(ticket._id) + '">' + (ticket.paid ? '↩️ 입금 대기로' : '💰 입금 완료') + '</button>';
    }
    html += actionBtn(ticket, 'message', '📋 카톡 문구');
    html += '<button class="rp-act" type="button" data-edit="' + escapeHtml(ticket._id) + '">✏️ 수정</button>';
    html += '</div>';

    html += formHtml(ticket);
    html += messageHtml(ticket);
    html += '<div class="rp-inline-form" data-edit-form="' + escapeHtml(ticket._id) + '"' + (state.openForm === 'edit:' + ticket._id ? '' : ' hidden') + '>';
    html += editFormHtml(ticket);
    html += '</div>';
    html += '</article>';
    return html;
  }

  function settleHtml(ticket) {
    var key = normalizeStatus(ticket.status);
    var fee = Number(ticket.repairFee || ticket.quote || 0);
    var cost = Number(ticket.partsCost || 0);
    var used = Array.isArray(ticket.usedParts) ? ticket.usedParts : [];
    var show = fee || cost || used.length || ticket.paid || key === 'repaired' || key === 'shipped';
    if (!show) return '';
    var html = '<div class="rp-settle">';
    html += '<span>수리비 <b>' + (fee ? won(fee) : '미정') + '</b></span>';
    if (cost) html += '<span>부품 원가 <b>' + won(cost) + '</b></span>';
    if (fee) html += '<span>수리비−부품원가 <b>' + won(fee - cost) + '</b></span>';
    if (key === 'repaired' || key === 'shipped' || ticket.paid) {
      html += '<span>' + (ticket.paid ? '<span class="rp-pay-done">입금 완료' + (ticket.paidAt ? ' · ' + escapeHtml(ticket.paidAt) : '') + '</span>' : '<span class="rp-pay-wait">입금 대기</span>') + '</span>';
    }
    if (used.length) {
      html += '<span class="rp-settle-parts">사용 부품: ' + used.map(function (item) {
        return escapeHtml(item.name || '부품') + ' ' + (item.qty || 1) + '개';
      }).join(' · ') + '</span>';
    }
    html += '</div>';
    return html;
  }

  function actionBtn(ticket, kind, label) {
    return '<button class="rp-act rp-act-primary" type="button" data-action="' + kind + '" data-id="' + escapeHtml(ticket._id) + '">' + label + '</button>';
  }

  function formHtml(ticket) {
    var kind = state.openForm && state.openForm.indexOf(ticket._id + ':') === 0 ? state.openForm.split(':')[1] : '';
    if (!kind) return '';
    if (kind === 'postal') return postalHtml(ticket);
    var id = escapeHtml(ticket._id);
    var html = '<div class="rp-inline-form">';
    if (kind === 'arrived') {
      html += '<div class="rp-field-row">';
      html += '<div class="rp-field"><label>도착일</label><input type="date" data-field="arrivedAt" value="' + escapeHtml(ticket.arrivedAt || todayYmd()) + '"></div>';
      html += '<div class="rp-field"><label>예상 수리기간</label><input type="text" data-field="expectedDays" value="' + escapeHtml(ticket.expectedDays || '15~20일') + '" placeholder="15~20일"></div>';
      html += '</div>';
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-confirm="arrived" data-id="' + id + '">도착 처리 + 문구 만들기</button><button class="rp-act" type="button" data-cancel="1" data-id="' + id + '">취소</button></div>';
    } else if (kind === 'repairing') {
      html += '<div class="rp-field"><label>고객 안내 메모 (선택)</label><input type="text" data-field="ownerMemo" value="' + escapeHtml(ticket.ownerMemo || '') + '" placeholder="예: 휠 인코더 교체 진행 중"></div>';
      html += partsPickerHtml(ticket);
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-confirm="repairing" data-id="' + id + '">수리 진행 처리</button><button class="rp-act" type="button" data-cancel="1" data-id="' + id + '">취소</button></div>';
    } else if (kind === 'repaired') {
      html += '<div class="rp-field-row">';
      html += '<div class="rp-field"><label>수리비 청구액 (원)</label><input type="number" inputmode="numeric" min="0" step="1000" data-field="repairFee" value="' + escapeHtml(ticket.repairFee || ticket.quote || '') + '" placeholder="7000"></div>';
      html += '<div class="rp-field"><label>입금 상태</label><label class="rp-check"><input type="checkbox" data-field="paid"' + (ticket.paid ? ' checked' : '') + '><span>입금 완료</span></label></div>';
      html += '</div>';
      html += '<div class="rp-field"><label>수리 내용 메모</label><input type="text" data-field="ownerMemo" value="' + escapeHtml(ticket.ownerMemo || '') + '" placeholder="예: 좌우 스위치·휠 인코더 교체"></div>';
      html += partsPickerHtml(ticket);
      html += '<div class="rp-field"><label>AS 안내 문구</label><textarea rows="2" data-field="asNote">' + escapeHtml(ticket.asNote || DEFAULT_AS_NOTE) + '</textarea></div>';
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-confirm="repaired" data-id="' + id + '">수리 완료 처리</button><button class="rp-act" type="button" data-cancel="1" data-id="' + id + '">취소</button></div>';
    } else if (kind === 'shipped') {
      html += '<div class="rp-field-row">';
      html += '<div class="rp-field"><label>반송 택배사</label><select data-field="returnCarrier">' + carrierOptions(RETURN_CARRIER_ORDER, ticket.returnCarrier || DEFAULT_RETURN_CARRIER) + '</select></div>';
      html += '<div class="rp-field"><label>반송 송장번호 <span class="rp-opt">선택</span></label><input type="text" inputmode="numeric" data-field="returnTrackingNo" value="' + escapeHtml(ticket.returnTrackingNo || '') + '" placeholder="사전접수만 했으면 비워 두세요"></div>';
      html += '</div>';
      html += '<p class="rp-postal-note">우체국택배로 사전접수하고 창구에서 보내는 방식이면 송장번호를 몰라도 그대로 발송 처리하면 됩니다. 번호는 나중에 ✏️ 수정에서 넣으면 됩니다.</p>';
      html += '<div class="rp-field"><label>고객 안내 메모 (선택)</label><input type="text" data-field="ownerMemo" value="' + escapeHtml(ticket.ownerMemo || '') + '" placeholder="예: 받으신 뒤 휠 감도 확인 부탁드립니다"></div>';
      html += '<div class="rp-postal-copy">';
      html += '<button class="rp-act rp-act-copy" type="button" data-copy-postal="' + id + '">📋 우체국 사전접수용 정보 복사</button>';
      html += '<a class="rp-act" href="' + EPOST_PARCEL + '" target="_blank" rel="noopener noreferrer">인터넷우체국 열기</a>';
      html += '</div>';
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-confirm="shipped" data-id="' + id + '">발송 처리 + 문구 만들기</button><button class="rp-act" type="button" data-cancel="1" data-id="' + id + '">취소</button></div>';
    }
    html += '</div>';
    return html;
  }

  /* ---------------- 사용 부품 고르기 ---------------- */
  function partsPickerHtml(ticket) {
    var rows = (ticket.usedParts || []).map(function (item) { return { partId: item.partId, qty: item.qty }; });
    var html = '<div class="rp-parts" data-parts="' + escapeHtml(ticket._id) + '">';
    html += '<div class="rp-parts-head"><b>사용 부품 · 저장하면 재고에서 차감</b>';
    html += '<button class="rp-act" type="button" data-add-part="' + escapeHtml(ticket._id) + '">+ 부품 추가</button></div>';
    html += '<div class="rp-parts-rows">' + rows.map(partRowHtml).join('') + '</div>';
    html += '<p class="rp-parts-empty">사용한 부품이 없으면 비워 두세요. 저장하면 부품 재고가 줄고 입출고 이력에 접수번호와 함께 남습니다.</p>';
    if (!state.parts.length) html += '<p class="rp-parts-empty">등록된 부품이 없습니다. ② 부품·재고 관리 탭에서 먼저 부품을 등록하세요.</p>';
    html += '<p class="rp-parts-sum">부품 원가 합계 <b>' + won(priceUsedParts(rows, ticket.usedParts).cost) + '</b></p>';
    html += '</div>';
    return html;
  }

  function partRowHtml(row) {
    row = row || {};
    var options = '<option value="">부품 선택</option>' + state.parts.map(function (part) {
      return '<option value="' + escapeHtml(part._id) + '"' + (part._id === row.partId ? ' selected' : '') + '>'
        + escapeHtml((part.category || '기타') + ' · ' + part.name) + ' (재고 ' + partQty(part) + ')</option>';
    }).join('');
    if (row.partId && !findPart(row.partId)) {
      options = '<option value="' + escapeHtml(row.partId) + '" selected>삭제된 부품</option>' + options;
    }
    return '<div class="rp-part-row"><select data-part-select aria-label="부품">' + options + '</select>'
      + '<input type="number" inputmode="numeric" min="1" step="1" value="' + (Number(row.qty) || 1) + '" data-part-qty aria-label="사용 수량">'
      + '<button class="rp-row-del" type="button" data-remove-part aria-label="부품 줄 삭제">✕</button></div>';
  }

  function readPartRows(box) {
    if (!box) return [];
    return Array.prototype.slice.call(box.querySelectorAll('.rp-part-row')).map(function (row) {
      var select = row.querySelector('[data-part-select]');
      var qtyInput = row.querySelector('[data-part-qty]');
      return {
        partId: select ? select.value : '',
        qty: onlyDigits(qtyInput ? qtyInput.value : '') ? Number(onlyDigits(qtyInput.value)) : 0
      };
    }).filter(function (row) { return row.partId && row.qty > 0; });
  }

  function refreshPartsSum(box) {
    if (!box) return;
    var cell = box.querySelector('.rp-parts-sum b');
    if (!cell) return;
    cell.textContent = won(priceUsedParts(readPartRows(box), []).cost);
  }

  function postalHtml(ticket) {
    var html = '<div class="rp-postal">';
    html += '<h4>📋 우체국 사전접수용 정보</h4>';
    html += '<p class="rp-postal-note">아래 내용을 복사해 인터넷우체국 「창구소포 간편사전접수」에 넣으세요. 사전접수 후 우체국 창구나 Eco우체통에 넣으면 되고, 요금도 할인됩니다.</p>';
    html += '<textarea data-postal-text rows="8" spellcheck="false">' + escapeHtml(postalInfoText(ticket)) + '</textarea>';
    html += '<div class="rp-postal-copy">';
    html += '<button class="rp-act rp-act-copy" type="button" data-copy-postal="' + escapeHtml(ticket._id) + '">📋 복사</button>';
    html += '<a class="rp-act" href="' + EPOST_PARCEL + '" target="_blank" rel="noopener noreferrer">인터넷우체국 열기</a>';
    html += '<button class="rp-act" type="button" data-cancel="1" data-id="' + escapeHtml(ticket._id) + '">닫기</button>';
    html += '</div></div>';
    return html;
  }

  function messageHtml(ticket) {
    var kind = state.openMessage && state.openMessage.indexOf(ticket._id + ':') === 0 ? state.openMessage.split(':')[1] : '';
    if (!kind || kind === 'form') return '';
    var text = messageFor(ticket, kind);
    var html = '<div class="rp-msg" data-msg="' + escapeHtml(ticket._id) + '">';
    html += '<textarea data-msg-text rows="10" spellcheck="false">' + escapeHtml(text) + '</textarea>';
    html += '<div class="rp-msg-actions">';
    html += '<button class="rp-act rp-act-copy" type="button" data-copy-msg="' + escapeHtml(ticket._id) + '">📋 카톡 문구 복사</button>';
    html += '<a class="rp-act" href="https://open.kakao.com/o/sFZ6mCSi" target="_blank" rel="noopener noreferrer">오픈카톡 열기</a>';
    html += '<button class="rp-act" type="button" data-cancel-msg="1" data-id="' + escapeHtml(ticket._id) + '">닫기</button>';
    html += '</div></div>';
    return html;
  }

  function editFormHtml(ticket) {
    var key = normalizeStatus(ticket.status);
    var html = '<div class="rp-field-row">';
    html += '<div class="rp-field"><label>상태</label><select data-edit-field="status">' + STATUS_ORDER.map(function (name) {
      return '<option value="' + name + '"' + (key === name ? ' selected' : '') + '>' + STATUS[name].label + '</option>';
    }).join('') + '</select></div>';
    html += '<div class="rp-field"><label>연락처</label><input type="tel" data-edit-field="phone" value="' + escapeHtml(ticket.phone || '') + '"></div>';
    html += '</div>';
    html += '<div class="rp-field"><label>회송 주소</label><textarea rows="2" data-edit-field="address">' + escapeHtml(ticket.address || '') + '</textarea></div>';
    html += '<div class="rp-field-row">';
    html += '<div class="rp-field"><label>보내신 택배사</label><select data-edit-field="carrier">' + carrierOptions(CARRIER_ORDER, ticket.carrier, true) + '</select></div>';
    html += '<div class="rp-field"><label>보내신 송장번호</label><input type="text" inputmode="numeric" data-edit-field="trackingNo" value="' + escapeHtml(ticket.trackingNo || '') + '"></div>';
    html += '</div>';
    html += '<div class="rp-field-row">';
    html += '<div class="rp-field"><label>도착일</label><input type="date" data-edit-field="arrivedAt" value="' + escapeHtml(ticket.arrivedAt || '') + '"></div>';
    html += '<div class="rp-field"><label>예상 수리기간</label><input type="text" data-edit-field="expectedDays" value="' + escapeHtml(ticket.expectedDays || '15~20일') + '"></div>';
    html += '</div>';
    html += '<div class="rp-field"><label>사장님 안내 메모 (고객에게 보임)</label><textarea rows="2" data-edit-field="ownerMemo">' + escapeHtml(ticket.ownerMemo || '') + '</textarea></div>';
    html += '<div class="rp-field-row">';
    html += '<div class="rp-field"><label>수리비 청구액 (원)</label><input type="number" inputmode="numeric" data-edit-field="repairFee" value="' + escapeHtml(ticket.repairFee || ticket.quote || '') + '"></div>';
    html += '<div class="rp-field"><label>입금 상태</label><label class="rp-check"><input type="checkbox" data-edit-field="paid"' + (ticket.paid ? ' checked' : '') + '><span>입금 완료</span></label></div>';
    html += '</div>';
    html += partsPickerHtml(ticket);
    html += '<div class="rp-field"><label>AS 안내 문구</label><textarea rows="2" data-edit-field="asNote">' + escapeHtml(ticket.asNote || DEFAULT_AS_NOTE) + '</textarea></div>';
    html += '<div class="rp-field-row">';
    html += '<div class="rp-field"><label>반송 택배사</label><select data-edit-field="returnCarrier">' + carrierOptions(RETURN_CARRIER_ORDER, ticket.returnCarrier || DEFAULT_RETURN_CARRIER) + '</select></div>';
    html += '<div class="rp-field"><label>반송 송장번호</label><input type="text" inputmode="numeric" data-edit-field="returnTrackingNo" value="' + escapeHtml(ticket.returnTrackingNo || '') + '" placeholder="사전접수만 했으면 비워 두세요"></div>';
    html += '</div>';
    html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-save-edit="' + escapeHtml(ticket._id) + '">저장</button>';
    html += '<button class="rp-act" type="button" data-cancel-edit="1" data-id="' + escapeHtml(ticket._id) + '">취소</button>';
    html += '<button class="rp-act" type="button" data-delete="' + escapeHtml(ticket._id) + '">삭제</button></div>';
    return html;
  }

  /* ---------------- 부품 화면 ---------------- */
  function renderParts() {
    var low = lowParts();
    var badge = $('parts-badge');
    if (badge) {
      badge.textContent = String(low.length);
      badge.hidden = !low.length;
    }
    var lowBox = $('parts-low');
    if (lowBox) {
      if (low.length) {
        lowBox.hidden = false;
        lowBox.innerHTML = '<b>안전재고 이하 부품 ' + low.length + '종</b><span>' + low.map(function (part) {
          return escapeHtml(part.name) + ' (' + partQty(part) + '/' + partMin(part) + ')';
        }).join(' · ') + '</span>';
      } else {
        lowBox.hidden = true;
        lowBox.innerHTML = '';
      }
    }
    var totalValue = state.parts.reduce(function (sum, part) { return sum + partQty(part) * (Number(part.unitCost) || 0); }, 0);
    var summary = $('parts-summary');
    if (summary) {
      summary.textContent = '부품 ' + state.parts.length + '종 · 재고 평가액 ' + won(totalValue)
        + (low.length ? ' · 부족 ' + low.length + '종' : ' · 부족 없음');
    }
    var box = $('part-list');
    if (!box) return;
    if (!state.parts.length) {
      box.innerHTML = '<p class="rp-ticket rp-ticket-empty">등록된 부품이 없습니다. + 부품 등록으로 스위치·인코더·휠롤러·케이블·피트를 등록하세요.</p>';
    } else {
      box.innerHTML = state.parts.map(partCardHtml).join('');
    }
    renderLogs();
  }

  function partCardHtml(part) {
    var low = isLow(part);
    var html = '<article class="rp-part' + (low ? ' is-low' : '') + '" data-part-id="' + escapeHtml(part._id) + '">';
    html += '<div class="rp-part-top">';
    html += '<span class="rp-part-cat">' + escapeHtml(part.category || '기타') + '</span>';
    html += '<span class="rp-part-name">' + escapeHtml(part.name || '') + '</span>';
    if (low) html += '<span class="rp-part-low-tag">부족</span>';
    html += '<span class="rp-part-qty">' + partQty(part) + '개</span>';
    html += '</div>';
    html += '<p class="rp-part-meta">매입 단가 <b>' + won(part.unitCost) + '</b> · 안전재고 <b>' + partMin(part) + '개</b>';
    if (part.spec) html += '<br>' + escapeHtml(part.spec);
    html += '</p>';
    html += '<div class="rp-part-actions">';
    html += '<button class="rp-act rp-act-primary" type="button" data-part-in="' + escapeHtml(part._id) + '">+ 입고</button>';
    html += '<button class="rp-act" type="button" data-part-adjust="' + escapeHtml(part._id) + '">± 수량 조정</button>';
    html += '<button class="rp-act" type="button" data-part-edit="' + escapeHtml(part._id) + '">✏️ 수정</button>';
    html += '<button class="rp-act" type="button" data-part-del="' + escapeHtml(part._id) + '">삭제</button>';
    html += '</div>';
    html += partFormHtml(part);
    html += '</article>';
    return html;
  }

  function partFormHtml(part) {
    var kind = state.partForm && state.partForm.indexOf(part._id + ':') === 0 ? state.partForm.split(':')[1] : '';
    if (!kind) return '';
    var id = escapeHtml(part._id);
    var html = '<div class="rp-part-form">';
    if (kind === 'in') {
      html += '<div class="rp-field-row">';
      html += '<div class="rp-field"><label>입고 수량</label><input type="number" inputmode="numeric" min="1" step="1" data-part-field="qty" value="1"></div>';
      html += '<div class="rp-field"><label>매입 단가 (원)</label><input type="number" inputmode="numeric" min="0" step="100" data-part-field="unitCost" value="' + (Number(part.unitCost) || '') + '"></div>';
      html += '</div>';
      html += '<div class="rp-field"><label>메모 (선택)</label><input type="text" data-part-field="reason" placeholder="예: 11월 정기 발주"></div>';
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-part-in-confirm="' + id + '">입고 저장</button><button class="rp-act" type="button" data-part-cancel="' + id + '">취소</button></div>';
    } else if (kind === 'adjust') {
      html += '<div class="rp-field"><label>조정 수량 (+ 입고 / − 차감)</label><input type="number" inputmode="numeric" step="1" data-part-field="delta" value="" placeholder="예: -2 또는 3"></div>';
      html += '<div class="rp-field"><label>사유 (필수)</label><input type="text" data-part-field="reason" placeholder="예: 재고 실사 / 파손 폐기"></div>';
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-part-adjust-confirm="' + id + '">조정 저장</button><button class="rp-act" type="button" data-part-cancel="' + id + '">취소</button></div>';
    } else if (kind === 'edit') {
      html += '<div class="rp-field"><label>품명</label><input type="text" data-part-field="name" value="' + escapeHtml(part.name || '') + '"></div>';
      html += '<div class="rp-field-row">';
      html += '<div class="rp-field"><label>카테고리</label><select data-part-field="category">' + categoryOptions(part.category) + '</select></div>';
      html += '<div class="rp-field"><label>매입 단가 (원)</label><input type="number" inputmode="numeric" min="0" step="100" data-part-field="unitCost" value="' + (Number(part.unitCost) || '') + '"></div>';
      html += '</div>';
      html += '<div class="rp-field-row">';
      html += '<div class="rp-field"><label>규격 / 메모</label><input type="text" data-part-field="spec" value="' + escapeHtml(part.spec || '') + '"></div>';
      html += '<div class="rp-field"><label>안전재고 기준</label><input type="number" inputmode="numeric" min="0" step="1" data-part-field="minQty" value="' + partMin(part) + '"></div>';
      html += '</div>';
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-part-save="' + id + '">저장</button><button class="rp-act" type="button" data-part-cancel="' + id + '">취소</button></div>';
    }
    html += '</div>';
    return html;
  }

  function renderLogs() {
    var box = $('part-logs');
    if (!box) return;
    if (!state.logs.length) {
      box.innerHTML = '<p class="rp-fineprint">입출고 이력이 아직 없습니다.</p>';
      return;
    }
    box.innerHTML = state.logs.map(function (log) {
      var type = String(log.type || '');
      var cls = type === 'in' ? 'is-in' : (type === 'adjust' ? 'is-adjust' : 'is-out');
      var label = type === 'in' ? '입고' : (type === 'adjust' ? '조정' : '수리 차감');
      var qty = Number(log.qty) || 0;
      var qtyText = (qty > 0 ? '+' : '') + qty;
      var when = log.at ? new Date(log.at) : null;
      var whenText = when && !isNaN(when.getTime())
        ? (when.getMonth() + 1) + '/' + when.getDate() + ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes())
        : '-';
      var tail = [];
      if (log.partName) tail.push(escapeHtml(log.partName));
      if (log.ticketNo) tail.push(escapeHtml(log.ticketNo));
      if (log.reason) tail.push(escapeHtml(log.reason));
      return '<div class="rp-log"><span class="rp-log-type ' + cls + '">' + label + '</span>'
        + '<span>' + tail.join(' · ') + '</span>'
        + '<span class="rp-log-qty">' + qtyText + '개</span></div>';
    }).join('') + '<p class="rp-fineprint">최근 40건 · 입출고는 저장 즉시 재고에 반영됩니다.</p>';
  }

  /* ---------------- 이벤트 ---------------- */
  function findTicket(id) {
    return state.tickets.filter(function (t) { return t._id === id; })[0];
  }

  function readForm(id) {
    var card = document.querySelector('.rp-ticket[data-id="' + id + '"] .rp-inline-form:not([data-edit-form])');
    var out = {};
    if (!card) return out;
    card.querySelectorAll('[data-field]').forEach(function (el) {
      if (el.type === 'checkbox') out[el.getAttribute('data-field')] = el.checked;
      else out[el.getAttribute('data-field')] = el.value;
    });
    return out;
  }

  function partsBoxOf(id) {
    return document.querySelector('.rp-parts[data-parts="' + id + '"]');
  }

  function bindList() {
    var box = $('ticket-list');

    box.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.matches('[data-part-select], [data-part-qty]')) refreshPartsSum(target.closest('.rp-parts'));
    });

    box.addEventListener('click', function (event) {
      try {
        var btn = event.target.closest('button');
        if (!btn) return;

        if (btn.hasAttribute('data-add-part')) {
          var pickId = btn.getAttribute('data-add-part');
          var partsBox = partsBoxOf(pickId);
          if (!partsBox) return;
          if (!state.parts.length) { toast('먼저 ② 부품·재고 관리 탭에서 부품을 등록하세요.'); return; }
          var rows = partsBox.querySelector('.rp-parts-rows');
          if (rows) rows.insertAdjacentHTML('beforeend', partRowHtml({ partId: '', qty: 1 }));
          refreshPartsSum(partsBox);
          return;
        }
        if (btn.hasAttribute('data-remove-part')) {
          var row = btn.closest('.rp-part-row');
          var holder = btn.closest('.rp-parts');
          if (row && row.parentNode) row.parentNode.removeChild(row);
          refreshPartsSum(holder);
          return;
        }

        var id = btn.getAttribute('data-id') || btn.getAttribute('data-save-edit') || btn.getAttribute('data-delete')
          || btn.getAttribute('data-edit') || btn.getAttribute('data-copy-msg') || btn.getAttribute('data-copy-postal')
          || btn.getAttribute('data-paid-toggle');
        var ticket = id ? findTicket(id) : null;
        if (!ticket) return;

        if (btn.hasAttribute('data-paid-toggle')) { togglePaid(ticket); return; }

        if (btn.hasAttribute('data-action')) {
          var kind = btn.getAttribute('data-action');
          if (kind === 'message') {
            state.openForm = '';
            state.openMessage = ticket._id + ':' + (normalizeStatus(ticket.status) || 'received');
            renderTickets();
            return;
          }
          state.openMessage = '';
          state.openForm = ticket._id + ':' + kind;
          renderTickets();
          return;
        }
        if (btn.hasAttribute('data-cancel')) { state.openForm = ''; renderTickets(); return; }
        if (btn.hasAttribute('data-cancel-msg')) { state.openMessage = ''; renderTickets(); return; }
        if (btn.hasAttribute('data-edit')) { state.openMessage = ''; state.openForm = 'edit:' + btn.getAttribute('data-edit'); renderTickets(); return; }
        if (btn.hasAttribute('data-cancel-edit')) { state.openForm = ''; renderTickets(); return; }

        if (btn.hasAttribute('data-copy-msg')) {
          var area = document.querySelector('.rp-msg[data-msg="' + btn.getAttribute('data-copy-msg') + '"] textarea');
          if (!area) return;
          copyText(area.value).then(function (ok) {
            if (ok) { toast('카톡 문구를 복사했습니다. 카톡방에 붙여넣으세요.'); return; }
            area.focus();
            area.select();
            toast('복사가 안 되면 선택된 문구를 길게 눌러 복사해 주세요');
          });
          return;
        }
        if (btn.hasAttribute('data-copy-postal')) {
          var postalBox = document.querySelector('.rp-postal textarea[data-postal-text]');
          var postalText = postalBox && postalBox.value ? postalBox.value : postalInfoText(ticket);
          copyText(postalText).then(function (ok) {
            if (ok) { toast('사전접수 정보를 복사했습니다. 인터넷우체국에 붙여넣으세요.'); return; }
            if (postalBox) {
              postalBox.focus();
              postalBox.select();
              toast('복사가 안 되면 선택된 내용을 길게 눌러 복사해 주세요');
              return;
            }
            toast('복사가 안 되면 📋 우체국 사전접수 칸을 열어 내용을 길게 눌러 복사해 주세요');
          });
          return;
        }
        if (btn.hasAttribute('data-confirm')) {
          var kindName = btn.getAttribute('data-confirm');
          var values = readForm(ticket._id);
          var extra = {};
          var nextParts = readPartRows(partsBoxOf(ticket._id));
          if (kindName === 'arrived') {
            var arrivedAt = values.arrivedAt || todayYmd();
            var days = (values.expectedDays || '15~20일').trim();
            var range = expectedRange(days, arrivedAt);
            extra.arrivedAt = arrivedAt;
            extra.expectedDays = days;
            extra.expectedFrom = range.from;
            extra.expectedTo = range.to;
          } else if (kindName === 'repairing') {
            if (values.ownerMemo) extra.ownerMemo = values.ownerMemo;
          } else if (kindName === 'repaired') {
            var fee = Number(onlyDigits(values.repairFee || ''));
            extra.repairFee = fee;
            extra.quote = fee;
            if (values.ownerMemo) extra.ownerMemo = values.ownerMemo;
            extra.asNote = values.asNote || DEFAULT_AS_NOTE;
            extra.paid = !!values.paid;
            extra.paidAt = values.paid ? (ticket.paidAt || todayYmd()) : '';
          } else if (kindName === 'shipped') {
            extra.returnCarrier = values.returnCarrier || DEFAULT_RETURN_CARRIER;
            extra.returnTrackingNo = onlyDigits(values.returnTrackingNo || '');
            if (values.ownerMemo) extra.ownerMemo = values.ownerMemo;
          }
          applyStatus(ticket, kindName, extra, nextParts);
          return;
        }
        if (btn.hasAttribute('data-save-edit')) {
          var editForm = document.querySelector('.rp-ticket[data-id="' + ticket._id + '"] [data-edit-form]');
          if (!editForm) return;
          var patch = {};
          editForm.querySelectorAll('[data-edit-field]').forEach(function (el) {
            var field = el.getAttribute('data-edit-field');
            if (el.type === 'checkbox') { patch[field] = el.checked; return; }
            var raw = el.value;
            if (field === 'repairFee' || field === 'quote') patch[field] = raw === '' ? 0 : Number(onlyDigits(raw));
            else if (field === 'phone') patch[field] = onlyDigits(raw);
            else if (field === 'trackingNo' || field === 'returnTrackingNo') patch[field] = onlyDigits(raw);
            else patch[field] = raw;
          });
          if (patch.repairFee !== undefined) patch.quote = patch.repairFee;
          if (patch.paid !== undefined) patch.paidAt = patch.paid ? (ticket.paidAt || todayYmd()) : '';
          if (patch.arrivedAt) {
            var recomputed = expectedRange(patch.expectedDays || '15~20일', patch.arrivedAt);
            patch.expectedFrom = recomputed.from;
            patch.expectedTo = recomputed.to;
          }
          var changedStatus = patch.status && patch.status !== normalizeStatus(ticket.status);
          if (changedStatus) {
            var history = Array.isArray(ticket.statusHistory) ? ticket.statusHistory.slice(-8) : [];
            history.push({ status: patch.status, at: nowIso() });
            patch.statusHistory = history;
          }
          saveTicket(ticket, patch, {
            nextParts: readPartRows(partsBoxOf(ticket._id)),
            message: '수정했습니다'
          });
          return;
        }
        if (btn.hasAttribute('data-delete')) {
          var used = Array.isArray(ticket.usedParts) ? ticket.usedParts.length : 0;
          var question = '접수 ' + ticket.ticketNo + ' 를 삭제할까요? 되돌릴 수 없습니다.'
            + (used ? '\n사용 부품 ' + used + '종은 재고로 다시 돌려놓습니다.' : '');
          if (!confirm(question)) return;
          deleteTicket(ticket);
          return;
        }
      } catch (err) {
        toast('처리 중 오류가 생겼습니다. 새로고침 후 다시 시도해 주세요.');
      }
    });
  }

  function deleteTicket(ticket) {
    if (state.busy) return;
    var writes = [];
    (ticket.usedParts || []).forEach(function (item) {
      var part = findPart(item.partId);
      if (!part || !(Number(item.qty) > 0)) return;
      writes.push(writeIncrement(PARTS, part._id, { updatedAt: nowIso() }, 'qty', Number(item.qty)));
      writes.push(logWrite({
        partId: part._id,
        partName: part.name,
        type: 'adjust',
        qty: Number(item.qty),
        unitCost: Number(part.unitCost) || 0,
        ticketNo: ticket.ticketNo || ticket._id,
        reason: '접수 삭제로 재고 복원',
        at: nowIso()
      }));
    });
    writes.push({ delete: docName(TICKETS, ticket._id) });
    state.busy = true;
    commit(writes).then(function (res) {
      if (!res.ok) throw new Error('delete_failed:' + apiCode(res));
      (ticket.usedParts || []).forEach(function (item) {
        var part = findPart(item.partId);
        if (part) part.qty = partQty(part) + (Number(item.qty) || 0);
      });
      state.tickets = state.tickets.filter(function (t) { return t._id !== ticket._id; });
      state.openForm = '';
      state.openMessage = '';
      state.busy = false;
      loadLogs().catch(function () { return []; }).then(function () {
        renderAll();
        toast('삭제했습니다');
      });
    }).catch(function (err) {
      state.busy = false;
      if (err && err.message === 'session') { lock('PIN 세션이 만료되었습니다. 다시 열어 주세요.'); return; }
      toast('삭제하지 못했습니다. 다시 시도해 주세요.');
    });
  }

  /* ---------------- 부품 이벤트 ---------------- */
  function readPartForm(partId) {
    var box = document.querySelector('.rp-part[data-part-id="' + partId + '"] .rp-part-form');
    var out = {};
    if (!box) return out;
    box.querySelectorAll('[data-part-field]').forEach(function (el) { out[el.getAttribute('data-part-field')] = el.value; });
    return out;
  }

  function savePartCreate() {
    var box = $('part-create');
    if (!box) return;
    var values = {};
    box.querySelectorAll('[data-new-field]').forEach(function (el) { values[el.getAttribute('data-new-field')] = el.value; });
    var name = String(values.name || '').trim();
    if (!name) { toast('품명을 입력해 주세요.'); return; }
    if (name.length > 40) { toast('품명은 40자 이내로 입력해 주세요.'); return; }
    var id = 'part_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    var qty = Number(onlyDigits(values.qty || '')) || 0;
    var unitCost = Number(onlyDigits(values.unitCost || '')) || 0;
    var minQty = Number(onlyDigits(values.minQty || '')) || 0;
    var fields = {
      name: name,
      category: PART_CATEGORIES.indexOf(values.category) >= 0 ? values.category : '기타',
      spec: String(values.spec || '').trim().slice(0, 60),
      unitCost: unitCost,
      qty: qty,
      minQty: minQty,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    var writes = [writeCreate(PARTS, id, fields)];
    if (qty > 0) {
      writes.push(logWrite({
        partId: id, partName: name, type: 'in', qty: qty, unitCost: unitCost,
        ticketNo: '', reason: '신규 등록', at: nowIso()
      }));
    }
    runPartWrites(writes, '부품을 등록했습니다', function () {
      var created = { _id: id };
      Object.keys(fields).forEach(function (key) { created[key] = fields[key]; });
      state.parts.push(created);
      state.partForm = '';
      $('part-create').hidden = true;
      $('part-create').innerHTML = '';
    });
  }

  function runPartWrites(writes, message, onLocal) {
    if (state.busy) return;
    state.busy = true;
    commit(writes).then(function (res) {
      if (!res.ok) throw new Error('save_failed:' + apiCode(res));
      state.busy = false;
      if (onLocal) onLocal();
      loadParts().catch(function () { return []; }).then(function () {
        return loadLogs().catch(function () { return []; });
      }).then(function () {
        renderAll();
        toast(message);
      });
    }).catch(function (err) {
      state.busy = false;
      if (err && err.message === 'session') { lock('PIN 세션이 만료되었습니다. 다시 열어 주세요.'); return; }
      toast('저장하지 못했습니다. ' + (err && err.message && err.message.indexOf('save_failed:') === 0 ? '(' + err.message.slice(12) + ') ' : '') + '다시 시도해 주세요.');
    });
  }

  function stockIn(part) {
    var values = readPartForm(part._id);
    var qty = Number(onlyDigits(values.qty || '')) || 0;
    if (qty <= 0) { toast('입고 수량을 입력해 주세요.'); return; }
    var unitCost = onlyDigits(values.unitCost || '') ? Number(onlyDigits(values.unitCost)) : (Number(part.unitCost) || 0);
    var writes = [
      writeIncrement(PARTS, part._id, { unitCost: unitCost, updatedAt: nowIso() }, 'qty', qty),
      logWrite({
        partId: part._id, partName: part.name, type: 'in', qty: qty, unitCost: unitCost,
        ticketNo: '', reason: String(values.reason || '').trim() || '입고', at: nowIso()
      })
    ];
    runPartWrites(writes, part.name + ' ' + qty + '개 입고', function () {
      part.qty = partQty(part) + qty;
      part.unitCost = unitCost;
      state.partForm = '';
    });
  }

  function stockAdjust(part) {
    var values = readPartForm(part._id);
    var delta = Number(String(values.delta || '').replace(/[^0-9-]/g, ''));
    if (!delta) { toast('조정 수량을 입력해 주세요. (예: -2, 3)'); return; }
    var reason = String(values.reason || '').trim();
    if (!reason) { toast('조정 사유를 적어 주세요.'); return; }
    if (partQty(part) + delta < 0) { toast('재고보다 많이 차감할 수 없습니다. 현재 ' + partQty(part) + '개입니다.'); return; }
    var writes = [
      writeIncrement(PARTS, part._id, { updatedAt: nowIso() }, 'qty', delta),
      logWrite({
        partId: part._id, partName: part.name, type: 'adjust', qty: delta, unitCost: Number(part.unitCost) || 0,
        ticketNo: '', reason: reason, at: nowIso()
      })
    ];
    runPartWrites(writes, part.name + ' 수량 조정 저장', function () {
      part.qty = partQty(part) + delta;
      state.partForm = '';
    });
  }

  function savePartEdit(part) {
    var values = readPartForm(part._id);
    var name = String(values.name || '').trim();
    if (!name) { toast('품명을 입력해 주세요.'); return; }
    var fields = {
      name: name,
      category: PART_CATEGORIES.indexOf(values.category) >= 0 ? values.category : '기타',
      spec: String(values.spec || '').trim().slice(0, 60),
      unitCost: Number(onlyDigits(values.unitCost || '')) || 0,
      minQty: Number(onlyDigits(values.minQty || '')) || 0,
      updatedAt: nowIso()
    };
    runPartWrites([writeUpdate(PARTS, part._id, fields, Object.keys(fields))], '부품 정보를 수정했습니다', function () {
      Object.keys(fields).forEach(function (key) { part[key] = fields[key]; });
      state.partForm = '';
    });
  }

  function deletePart(part) {
    if (!confirm('부품 ' + part.name + ' 을(를) 삭제할까요?\n입출고 이력은 남고, 접수에 기록된 사용 부품은 그대로 보입니다.')) return;
    if (state.busy) return;
    state.busy = true;
    commit([{ delete: docName(PARTS, part._id) }]).then(function (res) {
      if (!res.ok) throw new Error('delete_failed');
      state.busy = false;
      state.parts = state.parts.filter(function (p) { return p._id !== part._id; });
      state.partForm = '';
      renderAll();
      toast('부품을 삭제했습니다');
    }).catch(function (err) {
      state.busy = false;
      if (err && err.message === 'session') { lock('PIN 세션이 만료되었습니다. 다시 열어 주세요.'); return; }
      toast('삭제하지 못했습니다.');
    });
  }

  function newPartFormHtml() {
    var html = '<div class="rp-field"><label>품명</label><input type="text" data-new-field="name" placeholder="예: 옴론 D2FC-F-7N (좌우 스위치)" maxlength="40"></div>';
    html += '<div class="rp-field-row">';
    html += '<div class="rp-field"><label>카테고리</label><select data-new-field="category">' + categoryOptions('스위치') + '</select></div>';
    html += '<div class="rp-field"><label>매입 단가 (원)</label><input type="number" inputmode="numeric" min="0" step="100" data-new-field="unitCost" value="" placeholder="1200"></div>';
    html += '</div>';
    html += '<div class="rp-field"><label>규격 / 메모</label><input type="text" data-new-field="spec" placeholder="예: 3핀 / 5천만회" maxlength="60"></div>';
    html += '<div class="rp-field-row">';
    html += '<div class="rp-field"><label>현재 수량</label><input type="number" inputmode="numeric" min="0" step="1" data-new-field="qty" value="0"></div>';
    html += '<div class="rp-field"><label>안전재고 기준</label><input type="number" inputmode="numeric" min="0" step="1" data-new-field="minQty" value="5"></div>';
    html += '</div>';
    html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" id="part-create-save">등록</button><button class="rp-act" type="button" id="part-create-cancel">취소</button></div>';
    return html;
  }

  function bindParts() {
    $('part-add').addEventListener('click', function () {
      var box = $('part-create');
      if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
      box.innerHTML = newPartFormHtml();
      box.hidden = false;
      $('part-create-save').addEventListener('click', savePartCreate);
      $('part-create-cancel').addEventListener('click', function () { box.hidden = true; box.innerHTML = ''; });
      var first = box.querySelector('[data-new-field="name"]');
      if (first) first.focus({ preventScroll: true });
    });

    $('parts-reload').addEventListener('click', function () {
      refresh().then(function () { toast('새로고침했습니다'); });
    });

    var box = $('part-list');
    box.addEventListener('click', function (event) {
      try {
        var btn = event.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-part-in') || btn.getAttribute('data-part-adjust') || btn.getAttribute('data-part-edit')
          || btn.getAttribute('data-part-del') || btn.getAttribute('data-part-in-confirm') || btn.getAttribute('data-part-adjust-confirm')
          || btn.getAttribute('data-part-save') || btn.getAttribute('data-part-cancel');
        var part = id ? findPart(id) : null;
        if (!part) return;

        if (btn.hasAttribute('data-part-in')) { state.partForm = part._id + ':in'; renderParts(); return; }
        if (btn.hasAttribute('data-part-adjust')) { state.partForm = part._id + ':adjust'; renderParts(); return; }
        if (btn.hasAttribute('data-part-edit')) { state.partForm = part._id + ':edit'; renderParts(); return; }
        if (btn.hasAttribute('data-part-cancel')) { state.partForm = ''; renderParts(); return; }
        if (btn.hasAttribute('data-part-in-confirm')) { stockIn(part); return; }
        if (btn.hasAttribute('data-part-adjust-confirm')) { stockAdjust(part); return; }
        if (btn.hasAttribute('data-part-save')) { savePartEdit(part); return; }
        if (btn.hasAttribute('data-part-del')) { deletePart(part); return; }
      } catch (err) {
        toast('처리 중 오류가 생겼습니다. 새로고침 후 다시 시도해 주세요.');
      }
    });
  }

  /* ---------------- 탭 ---------------- */
  function selectTab(name) {
    state.tab = name === 'parts' ? 'parts' : 'repair';
    document.querySelectorAll('.rp-apptab').forEach(function (tab) {
      tab.setAttribute('aria-selected', tab.getAttribute('data-tab') === state.tab ? 'true' : 'false');
    });
    $('pane-repair').hidden = state.tab !== 'repair';
    $('pane-parts').hidden = state.tab !== 'parts';
  }

  function renderAll() {
    renderTickets();
    renderParts();
  }

  /* ---------------- 잠금·새로고침 ---------------- */
  function lock(message) {
    clearSession();
    $('dashboard').hidden = true;
    $('gate').hidden = false;
    setGateBusy(false);
    showError($('gate-error'), message || '');
  }

  function setGateBusy(busy) {
    var btn = $('gate-submit');
    btn.disabled = busy;
    btn.textContent = busy ? '확인 중…' : '열기';
  }

  function openDashboard() {
    $('gate').hidden = true;
    $('dashboard').hidden = false;
    showError($('gate-error'), '');
    selectTab(state.tab);
    refresh();
    var mark = '';
    try { mark = localStorage.getItem(PIN_MARK) || ''; } catch (e) { mark = ''; }
    $('pin-state').textContent = mark
      ? 'PIN 변경일 ' + new Date(mark).toLocaleDateString('ko-KR') + ' · 잊지 않도록 따로 적어 두세요.'
      : '아직 PIN을 바꾸지 않았습니다. 기본 PIN 대신 새 PIN으로 바꿔 주세요.';
  }

  function refresh() {
    return Promise.all([loadTickets(), loadParts(), loadLogs()]).then(function () {
      renderAll();
      showError($('gate-error'), '');
    }).catch(function (err) {
      if (err && err.message === 'session') { lock('PIN 세션이 만료되었습니다. 다시 열어 주세요.'); return; }
      $('summary').textContent = '데이터를 불러오지 못했습니다. 새로고침을 눌러 주세요.';
    });
  }

  function init() {
    $('gate-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var pin = onlyDigits($('pin-input').value);
      if (pin.length < 4) { showError($('gate-error'), 'PIN은 숫자 4자리 이상입니다.'); return; }
      showError($('gate-error'), '');
      setGateBusy(true);
      signIn(pin).then(function () {
        $('pin-input').value = '';
        openDashboard();
      }).catch(function (err) {
        var message = err.message === 'wrong_pin' ? 'PIN이 맞지 않습니다.'
          : err.message === 'too_many' ? '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
          : '로그인에 실패했습니다. 네트워크를 확인해 주세요.';
        showError($('gate-error'), message);
      }).then(function () { setGateBusy(false); });
    });

    document.querySelectorAll('.rp-apptab').forEach(function (tab) {
      tab.addEventListener('click', function () { selectTab(tab.getAttribute('data-tab')); });
    });

    $('filters').addEventListener('click', function (event) {
      var btn = event.target.closest('.rp-filter');
      if (!btn) return;
      state.filter = btn.getAttribute('data-status');
      renderTickets();
    });

    $('search').addEventListener('input', function () { state.search = this.value; renderTickets(); });
    $('reload').addEventListener('click', function () { refresh().then(function () { toast('새로고침했습니다'); }); });
    $('signout').addEventListener('click', function () { lock(''); toast('로그아웃했습니다'); });

    $('pin-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var a = onlyDigits($('pin-new').value);
      var b = onlyDigits($('pin-new2').value);
      showError($('pin-error'), '');
      if (a.length < 4) { showError($('pin-error'), '새 PIN은 숫자 4자리 이상으로 정해 주세요.'); return; }
      if (a !== b) { showError($('pin-error'), '두 PIN이 서로 다릅니다.'); return; }
      if (a === '1234') { showError($('pin-error'), '기본 PIN 대신 다른 번호로 정해 주세요.'); return; }
      var btn = $('pin-submit');
      btn.disabled = true;
      derivePassword(a).then(function (password) {
        return authFetch('https://identitytoolkit.googleapis.com/v1/accounts:update?key=' + API_KEY, { idToken: state.token, password: password, returnSecureToken: true });
      }).then(function (res) {
        if (!res.ok) {
          var code = res.data && res.data.error ? res.data.error.message : '';
          throw new Error(code === 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' ? 'relogin' : ('change_failed:' + code));
        }
        if (res.data.idToken) {
          state.token = res.data.idToken;
          state.exp = Date.now() + (Number(res.data.expiresIn) || 3600) * 1000;
          try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: state.token, exp: state.exp })); } catch (e) { /* 무시 */ }
        }
        try { localStorage.setItem(PIN_MARK, nowIso()); } catch (e) { /* 무시 */ }
        $('pin-new').value = '';
        $('pin-new2').value = '';
        openDashboard();
        toast('PIN을 바꿨습니다. 새 PIN ' + a + ' 로 기억해 두세요.');
      }).catch(function (err) {
        var message = err.message === 'relogin'
          ? '보안을 위해 다시 로그인한 뒤 PIN을 바꿔 주세요.'
          : 'PIN을 바꾸지 못했습니다. ' + (err.message && err.message.indexOf('change_failed:') === 0 ? '(' + err.message.slice(14) + ') ' : '') + '잠시 후 다시 시도해 주세요.';
        showError($('pin-error'), message);
      }).then(function () { btn.disabled = false; });
    });

    bindList();
    bindParts();

    if (restore()) openDashboard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
