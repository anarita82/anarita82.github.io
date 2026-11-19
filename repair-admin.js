/* 서울마우스 — 택배 접수 관리자 (repair-admin.html)
   PIN → Firebase 이메일 인증 → Firestore 목록·상태 변경·카톡 안내 문구 생성 */
(function () {
  'use strict';

  var API_KEY = 'AIzaSyCutf-64Bl3sXtm-xZtr5vRZUqwpkNI6NY';
  var PROJECT = 'family-calendar-woo';
  var DOCS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
  var COLLECTION = 'seoulmouse_repairs';
  var ADMIN_EMAIL = 'repair-admin@anarita82.github.io';
  var PIN_SALT = 'seoulmouse-repair-admin-v1';
  var PIN_ITERATIONS = 120000;
  var SESSION_KEY = 'seoulmouse.repair.admin.v1';
  var PIN_MARK = 'seoulmouse.repair.pinChangedAt';
  var SITE = 'https://anarita82.github.io/';

  var STATUS = {
    received: { label: '접수 대기', step: 0, chip: 'received' },
    arrived: { label: '택배 도착', step: 1, chip: 'arrived' },
    repairing: { label: '수리 중', step: 2, chip: 'repairing' },
    done: { label: '수리 완료', step: 3, chip: 'done' },
    shipped: { label: '반송 발송', step: 4, chip: 'shipped' }
  };
  var SYMPTOM_NAMES = { double: '더블클릭', wheel: '휠 불량', cable: '케이블', other: '기타' };
  var CARRIERS = { cj: 'CJ대한통운', post: '우체국택배', hanjin: '한진택배', lotte: '롯데택배', logen: '로젠택배', kyungdong: '경동택배', etc: '기타' };
  var DEFAULT_AS_NOTE = '이전 수리에 케이블을 교체하지 않은 제품이 케이블 단선으로 고장 나면 AS 접수 시 케이블 교체 비용 2,000원이 발생합니다.';

  var state = { token: '', exp: 0, tickets: [], filter: 'all', search: '', openForm: '', openMessage: '', busy: false };

  /* ---------------- 유틸 ---------------- */
  function $(id) { return document.getElementById(id); }
  function onlyDigits(v) { return String(v || '').replace(/[^0-9]/g, ''); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function todayYmd() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

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
    el._t = setTimeout(function () { el.classList.remove('is-on'); }, 2400);
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
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* 무시 */ }
  }

  /* ---------------- Firestore ---------------- */
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

  function loadTickets() {
    var query = {
      structuredQuery: {
        from: [{ collectionId: COLLECTION }],
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
        limit: 300
      }
    };
    return fsFetch('POST', ':runQuery', query).then(function (res) {
      if (!res.ok) throw new Error('load_failed');
      var rows = Array.isArray(res.data) ? res.data : [];
      state.tickets = rows.filter(function (row) { return row && row.document; }).map(function (row) {
        var doc = row.document;
        var ticket = fromFields(doc.fields || {});
        ticket._id = String(doc.name || '').split('/').pop();
        return ticket;
      });
      state.tickets.sort(function (a, b) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
      return state.tickets;
    });
  }

  function patchTicket(id, fields) {
    var payload = { fields: toFields(fields) };
    return fsFetch('PATCH', '/' + COLLECTION + '/' + encodeURIComponent(id), payload, { 'updateMask.fieldPaths': Object.keys(fields) });
  }

  function deleteTicket(id) {
    return fsFetch('DELETE', '/' + COLLECTION + '/' + encodeURIComponent(id));
  }

  /* ---------------- 상태 처리 ---------------- */
  function expectedRange(daysText, arrivedAt) {
    var nums = String(daysText || '').match(/[0-9]+/g) || [];
    var from = nums.length ? Number(nums[0]) : 15;
    var to = nums.length > 1 ? Number(nums[1]) : from;
    if (!from) from = 15;
    if (!to) to = from;
    if (to < from) { var t = to; to = from; from = t; }
    return { from: addDays(arrivedAt, from), to: addDays(arrivedAt, to), fromDays: from, toDays: to };
  }

  function applyStatus(ticket, status, extra) {
    var fields = { status: status, updatedAt: new Date().toISOString() };
    Object.keys(extra || {}).forEach(function (key) { fields[key] = extra[key]; });
    var history = Array.isArray(ticket.statusHistory) ? ticket.statusHistory.slice(-8) : [];
    history.push({ status: status, at: new Date().toISOString() });
    fields.statusHistory = history;
    if (state.busy) return;
    state.busy = true;
    patchTicket(ticket._id, fields).then(function (res) {
      if (!res.ok) throw new Error('save_failed:' + apiCode(res));
      Object.keys(fields).forEach(function (key) { ticket[key] = fields[key]; });
      state.openForm = '';
      state.openMessage = status === 'done' || status === 'shipped' || status === 'arrived' || status === 'repairing' ? ticket._id + ':' + status : '';
      render();
      toast(STATUS[status].label + ' 처리 완료 · 카톡 문구가 준비되었습니다');
    }).catch(function (err) {
      if (err && err.message === 'session') { lock('PIN 세션이 만료되었습니다. 다시 열어 주세요.'); return; }
      toast('저장하지 못했습니다. ' + (err && err.message && err.message.indexOf('save_failed:') === 0 ? '(' + err.message.slice(12) + ') ' : '') + '다시 시도해 주세요.');
    }).then(function () { state.busy = false; });
  }

  /* ---------------- 카톡 문구 ---------------- */
  function lookupLink(ticket) {
    return SITE + 'repair.html?code=' + encodeURIComponent(ticket.ticketNo);
  }

  function productLine(ticket) {
    return (ticket.model || '마우스') + ' ' + (ticket.qty || 1) + '개';
  }

  function messageFor(ticket, kind) {
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
        '· 진행 상태: 수리 중',
        '· 완료 예정: ' + range
      ];
      if (ticket.ownerMemo) lines.push('· 안내: ' + ticket.ownerMemo);
      lines.push('', '진행 상황: ' + link, '', '완료되면 다시 연락드리겠습니다.', '서울마우스 · 010-3100-4361');
    } else if (kind === 'done') {
      lines = [
        '[서울마우스] 수리 완료 안내',
        '',
        name + '님, ' + productLine(ticket) + ' 수리가 완료되었습니다.',
        '',
        '· 접수번호: ' + ticket.ticketNo
      ];
      if (ticket.quote) lines.push('· 수리 금액: ' + Number(ticket.quote).toLocaleString('ko-KR') + '원');
      if (ticket.ownerMemo) lines.push('· 수리 내용: ' + ticket.ownerMemo);
      lines.push('', ticket.asNote || DEFAULT_AS_NOTE);
      lines.push('', '반송 송장번호는 발송 후 다시 알려드리겠습니다.', '서울마우스 · 010-3100-4361');
    } else if (kind === 'shipped') {
      lines = [
        '[서울마우스] 반송 발송했습니다',
        '',
        name + '님, 수리한 ' + productLine(ticket) + ', 오늘 발송했습니다.',
        '',
        '· 접수번호: ' + ticket.ticketNo,
        '· 택배사: ' + (CARRIERS[ticket.returnCarrier] || '택배'),
        '· 송장번호: ' + (ticket.returnTrackingNo || '송장번호 확인 중'),
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

  /* ---------------- 화면 ---------------- */
  function counts() {
    var out = { all: state.tickets.length, received: 0, arrived: 0, repairing: 0, done: 0, shipped: 0 };
    state.tickets.forEach(function (t) { if (out[t.status] !== undefined) out[t.status] += 1; });
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
      if (state.filter !== 'all' && t.status !== state.filter) return false;
      return matchSearch(t);
    });
  }

  function render() {
    var c = counts();
    Object.keys(c).forEach(function (key) {
      var el = document.querySelector('[data-count="' + key + '"]');
      if (el) el.textContent = String(c[key]);
    });
    document.querySelectorAll('.rp-filter').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-status') === state.filter ? 'true' : 'false');
    });
    var pending = (c.received || 0) + (c.arrived || 0) + (c.repairing || 0);
    $('summary').textContent = '전체 ' + c.all + '건 · 진행 중 ' + pending + '건 · 마지막 갱신 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    var list = visibleTickets();
    var box = $('ticket-list');
    if (!list.length) {
      box.innerHTML = '<p class="rp-ticket rp-ticket-empty">' + (state.tickets.length ? '조건에 맞는 접수가 없습니다.' : '아직 접수된 건이 없습니다. 고객이 접수하면 여기에 표시됩니다.') + '</p>';
      return;
    }
    box.innerHTML = list.map(cardHtml).join('');
  }

  function cardHtml(ticket) {
    var status = STATUS[ticket.status] || STATUS.received;
    var symptoms = (ticket.symptoms || []).map(function (key) { return SYMPTOM_NAMES[key] || key; }).join(' · ');
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
    if (ticket.trackingNo) html += '<br>보내신 송장 ' + escapeHtml(CARRIERS[ticket.carrier] || '') + ' ' + escapeHtml(ticket.trackingNo);
    html += '<br>접수 ' + koreanDate(ticket.createdAt) + arrivedLine + expectedLine;
    if (ticket.quote) html += ' · 금액 <b>' + Number(ticket.quote).toLocaleString('ko-KR') + '원</b>';
    if (ticket.returnTrackingNo) html += '<br>반송 ' + escapeHtml(CARRIERS[ticket.returnCarrier] || '') + ' ' + escapeHtml(ticket.returnTrackingNo);
    html += '</p>';

    html += '<div class="rp-ticket-actions">';
    if (ticket.status === 'received') html += actionBtn(ticket, 'arrived', '📦 택배 도착');
    if (ticket.status === 'arrived') html += actionBtn(ticket, 'repairing', '🔧 수리 시작');
    if (ticket.status === 'repairing') html += actionBtn(ticket, 'done', '✅ 수리 완료');
    if (ticket.status === 'done') html += actionBtn(ticket, 'shipped', '📮 반송 발송');
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

  function actionBtn(ticket, kind, label) {
    return '<button class="rp-act rp-act-primary" type="button" data-action="' + kind + '" data-id="' + escapeHtml(ticket._id) + '">' + label + '</button>';
  }

  function formHtml(ticket) {
    var kind = state.openForm && state.openForm.indexOf(ticket._id + ':') === 0 ? state.openForm.split(':')[1] : '';
    if (!kind) return '';
    var html = '<div class="rp-inline-form">';
    if (kind === 'arrived') {
      html += '<div class="rp-field-row">';
      html += '<div class="rp-field"><label>도착일</label><input type="date" data-field="arrivedAt" value="' + escapeHtml(ticket.arrivedAt || todayYmd()) + '"></div>';
      html += '<div class="rp-field"><label>예상 수리기간</label><input type="text" data-field="expectedDays" value="' + escapeHtml(ticket.expectedDays || '15~20일') + '" placeholder="15~20일"></div>';
      html += '</div>';
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-confirm="arrived" data-id="' + escapeHtml(ticket._id) + '">도착 처리 + 문구 만들기</button><button class="rp-act" type="button" data-cancel="1" data-id="' + escapeHtml(ticket._id) + '">취소</button></div>';
    } else if (kind === 'repairing') {
      html += '<div class="rp-field"><label>고객 안내 메모 (선택)</label><input type="text" data-field="ownerMemo" value="' + escapeHtml(ticket.ownerMemo || '') + '" placeholder="예: 휠 인코더 교체 진행 중"></div>';
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-confirm="repairing" data-id="' + escapeHtml(ticket._id) + '">수리 중 처리</button><button class="rp-act" type="button" data-cancel="1" data-id="' + escapeHtml(ticket._id) + '">취소</button></div>';
    } else if (kind === 'done') {
      html += '<div class="rp-field-row">';
      html += '<div class="rp-field"><label>수리 금액 (원)</label><input type="number" inputmode="numeric" min="0" step="1000" data-field="quote" value="' + escapeHtml(ticket.quote || '') + '" placeholder="7000"></div>';
      html += '<div class="rp-field"><label>수리 내용 메모</label><input type="text" data-field="ownerMemo" value="' + escapeHtml(ticket.ownerMemo || '') + '" placeholder="예: 좌우 스위치·휠 인코더 교체"></div>';
      html += '</div>';
      html += '<div class="rp-field"><label>AS 안내 문구</label><textarea rows="2" data-field="asNote">' + escapeHtml(ticket.asNote || DEFAULT_AS_NOTE) + '</textarea></div>';
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-confirm="done" data-id="' + escapeHtml(ticket._id) + '">수리 완료 처리</button><button class="rp-act" type="button" data-cancel="1" data-id="' + escapeHtml(ticket._id) + '">취소</button></div>';
    } else if (kind === 'shipped') {
      html += '<div class="rp-field-row">';
      html += '<div class="rp-field"><label>반송 택배사</label><select data-field="returnCarrier">' + Object.keys(CARRIERS).map(function (key) {
        return '<option value="' + key + '"' + (ticket.returnCarrier === key ? ' selected' : '') + '>' + CARRIERS[key] + '</option>';
      }).join('') + '</select></div>';
      html += '<div class="rp-field"><label>반송 송장번호</label><input type="text" inputmode="numeric" data-field="returnTrackingNo" value="' + escapeHtml(ticket.returnTrackingNo || '') + '" placeholder="숫자만"></div>';
      html += '</div>';
      html += '<div class="rp-field"><label>고객 안내 메모 (선택)</label><input type="text" data-field="ownerMemo" value="' + escapeHtml(ticket.ownerMemo || '') + '" placeholder="예: 받으신 뒤 휠 감도 확인 부탁드립니다"></div>';
      html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-confirm="shipped" data-id="' + escapeHtml(ticket._id) + '">발송 처리 + 문구 만들기</button><button class="rp-act" type="button" data-cancel="1" data-id="' + escapeHtml(ticket._id) + '">취소</button></div>';
    }
    html += '</div>';
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
    var html = '<div class="rp-field-row">';
    html += '<div class="rp-field"><label>상태</label><select data-edit-field="status">' + Object.keys(STATUS).map(function (key) {
      return '<option value="' + key + '"' + (ticket.status === key ? ' selected' : '') + '>' + STATUS[key].label + '</option>';
    }).join('') + '</select></div>';
    html += '<div class="rp-field"><label>연락처</label><input type="tel" data-edit-field="phone" value="' + escapeHtml(ticket.phone || '') + '"></div>';
    html += '</div>';
    html += '<div class="rp-field"><label>회송 주소</label><textarea rows="2" data-edit-field="address">' + escapeHtml(ticket.address || '') + '</textarea></div>';
    html += '<div class="rp-field-row">';
    html += '<div class="rp-field"><label>도착일</label><input type="date" data-edit-field="arrivedAt" value="' + escapeHtml(ticket.arrivedAt || '') + '"></div>';
    html += '<div class="rp-field"><label>예상 수리기간</label><input type="text" data-edit-field="expectedDays" value="' + escapeHtml(ticket.expectedDays || '15~20일') + '"></div>';
    html += '</div>';
    html += '<div class="rp-field"><label>사장님 안내 메모 (고객에게 보임)</label><textarea rows="2" data-edit-field="ownerMemo">' + escapeHtml(ticket.ownerMemo || '') + '</textarea></div>';
    html += '<div class="rp-field-row">';
    html += '<div class="rp-field"><label>수리 금액</label><input type="number" inputmode="numeric" data-edit-field="quote" value="' + escapeHtml(ticket.quote || '') + '"></div>';
    html += '<div class="rp-field"><label>반송 송장번호</label><input type="text" data-edit-field="returnTrackingNo" value="' + escapeHtml(ticket.returnTrackingNo || '') + '"></div>';
    html += '</div>';
    html += '<div class="rp-inline-form-actions"><button class="rp-act rp-act-primary" type="button" data-save-edit="' + escapeHtml(ticket._id) + '">저장</button>';
    html += '<button class="rp-act" type="button" data-cancel-edit="1" data-id="' + escapeHtml(ticket._id) + '">취소</button>';
    html += '<button class="rp-act" type="button" data-delete="' + escapeHtml(ticket._id) + '">삭제</button></div>';
    return html;
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
      out[el.getAttribute('data-field')] = el.value;
    });
    return out;
  }

  function bindList() {
    var box = $('ticket-list');
    box.addEventListener('click', function (event) {
      try {
      var btn = event.target.closest('button');
      if (!btn) return;
      var id = btn.getAttribute('data-id') || btn.getAttribute('data-save-edit') || btn.getAttribute('data-delete') || btn.getAttribute('data-edit') || btn.getAttribute('data-copy-msg');
      var ticket = id ? findTicket(id) : null;

      if (btn.hasAttribute('data-action')) {
        var kind = btn.getAttribute('data-action');
        if (kind === 'message') {
          state.openForm = '';
          state.openMessage = ticket._id + ':' + (ticket.status === 'received' ? 'received' : ticket.status);
          render();
          return;
        }
        state.openMessage = '';
        state.openForm = ticket._id + ':' + kind;
        render();
        return;
      }
      if (btn.hasAttribute('data-cancel')) { state.openForm = ''; render(); return; }
      if (btn.hasAttribute('data-cancel-msg')) { state.openMessage = ''; render(); return; }
      if (btn.hasAttribute('data-edit')) { state.openMessage = ''; state.openForm = 'edit:' + btn.getAttribute('data-edit'); render(); return; }
      if (btn.hasAttribute('data-cancel-edit')) { state.openForm = ''; render(); return; }
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
      if (btn.hasAttribute('data-confirm')) {
        var kindName = btn.getAttribute('data-confirm');
        var values = readForm(ticket._id);
        var extra = {};
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
        } else if (kindName === 'done') {
          if (values.quote) extra.quote = Number(onlyDigits(values.quote));
          if (values.ownerMemo) extra.ownerMemo = values.ownerMemo;
          extra.asNote = values.asNote || DEFAULT_AS_NOTE;
        } else if (kindName === 'shipped') {
          extra.returnCarrier = values.returnCarrier || 'cj';
          extra.returnTrackingNo = onlyDigits(values.returnTrackingNo || '');
          if (!extra.returnTrackingNo) { toast('반송 송장번호를 입력해 주세요.'); return; }
          if (values.ownerMemo) extra.ownerMemo = values.ownerMemo;
        }
        applyStatus(ticket, kindName, extra);
        return;
      }
      if (btn.hasAttribute('data-save-edit')) {
        var card = document.querySelector('.rp-ticket[data-id="' + ticket._id + '"] [data-edit-form]');
        if (!card) return;
        var patch = {};
        card.querySelectorAll('[data-edit-field]').forEach(function (el) {
          var key = el.getAttribute('data-edit-field');
          var raw = el.value;
          if (key === 'quote') patch[key] = raw === '' ? 0 : Number(onlyDigits(raw));
          else if (key === 'phone') patch[key] = onlyDigits(raw);
          else patch[key] = raw;
        });
        if (patch.arrivedAt) {
          var r = expectedRange(patch.expectedDays || '15~20일', patch.arrivedAt);
          patch.expectedFrom = r.from;
          patch.expectedTo = r.to;
        }
        patch.updatedAt = new Date().toISOString();
        state.busy = true;
        patchTicket(ticket._id, patch).then(function (res) {
          if (!res.ok) throw new Error(apiCode(res));
          Object.keys(patch).forEach(function (key) { ticket[key] = patch[key]; });
          state.openForm = '';
          render();
          toast('수정했습니다');
        }).catch(function (err) { toast('저장하지 못했습니다. ' + (err && err.message ? '[' + err.message + ']' : '')); }).then(function () { state.busy = false; });
        return;
      }
      if (btn.hasAttribute('data-delete')) {
        if (!confirm('접수 ' + ticket.ticketNo + ' 를 삭제할까요? 되돌릴 수 없습니다.')) return;
        deleteTicket(ticket._id).then(function (res) {
          if (!res.ok) throw new Error('delete_failed');
          state.tickets = state.tickets.filter(function (t) { return t._id !== ticket._id; });
          state.openForm = '';
          render();
          toast('삭제했습니다');
        }).catch(function () { toast('삭제하지 못했습니다.'); });
      }
      } catch (err) {
        toast('처리 중 오류가 생겼습니다. 새로고침 후 다시 시도해 주세요.');
      }
    });
  }

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
    refresh();
    var mark = '';
    try { mark = localStorage.getItem(PIN_MARK) || ''; } catch (e) { mark = ''; }
    $('pin-state').textContent = mark
      ? 'PIN 변경일 ' + new Date(mark).toLocaleDateString('ko-KR') + ' · 잊지 않도록 따로 적어 두세요.'
      : '아직 PIN을 바꾸지 않았습니다. 기본 PIN 대신 새 PIN으로 바꿔 주세요.';
  }

  function refresh() {
    return loadTickets().then(function () {
      render();
      showError($('gate-error'), '');
    }).catch(function (err) {
      if (err && err.message === 'session') { lock('PIN 세션이 만료되었습니다. 다시 열어 주세요.'); return; }
      $('summary').textContent = '접수를 불러오지 못했습니다. 새로고침을 눌러 주세요.';
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

    $('filters').addEventListener('click', function (event) {
      var btn = event.target.closest('.rp-filter');
      if (!btn) return;
      state.filter = btn.getAttribute('data-status');
      render();
    });

    $('search').addEventListener('input', function () { state.search = this.value; render(); });
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
        try { localStorage.setItem(PIN_MARK, new Date().toISOString()); } catch (e) { /* 무시 */ }
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

    if (restore()) openDashboard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
