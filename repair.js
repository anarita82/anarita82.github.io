/* 서울마우스 — 택배 접수 신청 · 수리 진행 조회
   Firebase(Cloud Firestore) REST + 익명 로그인. 별도 서버 없이 GitHub Pages에서 동작합니다. */
(function () {
  'use strict';

  var API_KEY = 'AIzaSyCutf-64Bl3sXtm-xZtr5vRZUqwpkNI6NY';
  var PROJECT = 'family-calendar-woo';
  var DOCS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
  var AUTH_KEY = 'seoulmouse.repair.auth.v1';
  var COLLECTION = 'seoulmouse_repairs';
  var SITE = 'https://anarita82.github.io/';
  var OPEN_CHAT = 'https://open.kakao.com/o/sFZ6mCSi';
  var TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /* 고객에게 보이는 5단계.
     예전 데이터는 수리 완료를 done 으로 저장했으므로 repaired 로 읽어 줍니다. */
  var STATUS = {
    received: { label: '접수·발송', step: 0 },
    arrived: { label: '매장 도착', step: 1 },
    repairing: { label: '수리 진행', step: 2 },
    repaired: { label: '수리 완료', step: 3 },
    shipped: { label: '발송 완료', step: 4 }
  };
  var LEGACY_STATUS = { done: 'repaired' };
  var STEPS = [
    { key: 'received', title: '접수·발송', desc: '접수 완료 및 고객님 택배 발송' },
    { key: 'arrived', title: '매장 도착', desc: '매장 수령·도착 등록 완료 · 수리 대기 중' },
    { key: 'repairing', title: '수리 진행', desc: '담당 수리 작업 중입니다' },
    { key: 'repaired', title: '수리 완료', desc: '점검 완료 · 입금/반송 준비' },
    { key: 'shipped', title: '발송 완료', desc: '우체국 택배 발송 완료 · 송장번호 확인' }
  ];

  function normalizeStatus(value) {
    var key = String(value || '');
    return LEGACY_STATUS[key] || key;
  }

  var state = { auth: null, submitting: false, lastTicket: '' };

  /* ---------------- 공통 유틸 ---------------- */
  function $(id) { return document.getElementById(id); }
  function onlyDigits(value) { return String(value || '').replace(/[^0-9]/g, ''); }

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
    el._t = setTimeout(function () { el.classList.remove('is-on'); }, 2200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
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

  function showError(el, message) {
    if (!el) return;
    if (!message) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = message;
    el.hidden = false;
  }

  function formatKoreanDate(iso) {
    if (!iso) return '-';
    var d = iso instanceof Date ? iso : new Date(iso);
    if (isNaN(d.getTime())) return '-';
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + '(' + days[d.getDay()] + ')';
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayYmd() { return ymd(new Date()); }
  function addDays(ymdText, days) {
    var parts = String(ymdText).split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + Number(days));
    return ymd(d);
  }

  /* ---------------- 인증(익명 로그인) ---------------- */
  function readAuth() {
    try {
      var raw = localStorage.getItem(AUTH_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveAuth(data) {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(data)); } catch (e) { /* 저장 불가 시 세션만 사용 */ }
  }

  function signInAnonymously() {
    return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || !body.idToken) throw new Error('auth_failed');
        state.auth = { token: body.idToken, refresh: body.refreshToken, exp: Date.now() + (Number(body.expiresIn) || 3600) * 1000 };
        saveAuth(state.auth);
        return state.auth.token;
      });
    });
  }

  function refreshAuth(saved) {
    return fetch('https://securetoken.googleapis.com/v1/token?key=' + API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(saved.refresh)
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || !body.id_token) throw new Error('refresh_failed');
        state.auth = { token: body.id_token, refresh: body.refresh_token, exp: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
        saveAuth(state.auth);
        return state.auth.token;
      });
    });
  }

  function getToken() {
    if (state.auth && state.auth.token && state.auth.exp > Date.now() + 60000) return Promise.resolve(state.auth.token);
    var saved = readAuth();
    if (saved && saved.token && saved.exp > Date.now() + 60000) { state.auth = saved; return Promise.resolve(saved.token); }
    if (saved && saved.refresh) {
      return refreshAuth(saved).catch(function () { return signInAnonymously(); });
    }
    return signInAnonymously();
  }

  /* ---------------- Firestore REST ---------------- */
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

  function firestore(method, path, body, params) {
    return getToken().then(function (token) {
      var url = DOCS + path;
      if (params) {
        var qs = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
        url += '?' + qs;
      }
      return fetch(url, {
        method: method,
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
          return { ok: res.ok, status: res.status, data: data };
        });
      });
    });
  }

  /* ---------------- 주소 검색 (다음/카카오 우편번호 서비스) ----------------
     별도 API 키가 필요 없는 무료 서비스입니다. 우편번호와 기본주소를 채우고 고객은 상세주소만 입력합니다.
     저장은 기존 address 한 필드에만 하므로 Firestore 규칙(hasOnly 화이트리스트)을 바꾸지 않습니다.
     포맷: "(12345) 기본주소 상세주소" — 관리자 화면의 우체국 사전접수가 이 앞자리 우편번호를 그대로 뽑아 씁니다. */
  var POSTCODE_SRC = [
    'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js',
    'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
  ];
  var ADDR_HELP = '주소 검색을 누르면 우편번호와 기본주소가 자동으로 들어갑니다. 상세주소만 입력하시면 됩니다. 수리한 마우스를 받으실 주소입니다.';
  var ADDR_HELP_MANUAL = '직접 입력하실 때는 우편번호 5자리부터 적어 주세요. (예: 05203 서울특별시 강동구 고덕로83길 6 101동 1001호)';
  var ADDR_PLACEHOLDER = '🔍 주소 검색을 눌러 주세요';
  var ADDR_PLACEHOLDER_MANUAL = '예: 05203 서울특별시 강동구 고덕로83길 6';
  var postcodePromise = null;
  var addr = { open: false, manual: false };

  function loadPostcode() {
    if (window.daum && window.daum.Postcode) return Promise.resolve(window.daum.Postcode);
    if (postcodePromise) return postcodePromise;
    /* t1.daumcdn.net은 2026-11-30 종료 안내가 있어 새 주소(t1.kakaocdn.net)를 먼저 쓰고, 실패하면 옛 주소로 한 번 더 시도합니다. */
    postcodePromise = injectPostcodeScript(POSTCODE_SRC[0]).catch(function () {
      return injectPostcodeScript(POSTCODE_SRC[1]);
    });
    postcodePromise.catch(function () { postcodePromise = null; });
    return postcodePromise;
  }

  function injectPostcodeScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = function () {
        if (window.daum && window.daum.Postcode) resolve(window.daum.Postcode);
        else reject(new Error('postcode_unavailable'));
      };
      script.onerror = function () { reject(new Error('postcode_network')); };
      document.head.appendChild(script);
    });
  }

  /* 우편번호 서비스는 embed 할 때 같은 출처의 about:blank 문서를 한 장 만들고 그 안에 실제 프레임을 넣습니다.
     그 안쪽 프레임이 인라인으로 계산되면 300×150 기본 크기에 머물러 검색창이 잘리므로 크기를 다시 잡아 줍니다.
     (라이브러리 구조가 바뀌면 조용히 넣지 않고 넘어갑니다.) */
  function sizeEmbeddedFrame(host) {
    var apply = function () {
      var outer = host.querySelector('iframe');
      var doc = outer && outer.contentDocument;
      var inner = doc && doc.querySelector('iframe');
      if (!inner) return false;
      inner.style.display = 'block';
      inner.style.width = '100%';
      inner.style.height = '100%';
      return true;
    };
    if (apply()) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (apply() || tries >= 20) clearInterval(timer);
    }, 100);
  }

  function composeAddress() {
    var base = $('f-addr-base') ? $('f-addr-base').value : '';
    var detail = $('f-addr-detail') ? $('f-addr-detail').value : '';
    return (String(base) + ' ' + String(detail)).replace(/\s+/g, ' ').trim();
  }

  function closeAddressLayer() {
    var layer = $('addr-layer');
    var frame = $('addr-frame');
    if (frame) frame.innerHTML = '';
    if (layer) { layer.hidden = true; layer.classList.remove('is-open'); }
    document.body.classList.remove('rp-addr-open');
    addr.open = false;
    var button = $('addr-search');
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  /* 검색 결과를 기본주소 칸에 넣고 상세주소 칸으로 넘깁니다. */
  function applySearchAddress(data) {
    var info = data || {};
    var base = info.userSelectedType === 'J'
      ? (info.jibunAddress || info.autoJibunAddress || info.address || '')
      : (info.roadAddress || info.autoRoadAddress || info.address || '');
    var zone = String(info.zonecode || '').trim();
    var text = ((zone ? '(' + zone + ') ' : '') + String(base)).replace(/\s+/g, ' ').trim();
    var baseInput = $('f-addr-base');
    if (baseInput && text) baseInput.value = text;
    addr.manual = false;
    baseInput && (baseInput.readOnly = true);
    var alt = $('addr-manual');
    if (alt) alt.textContent = '주소 검색 창이 안 열리면 직접 입력';
    var help = $('addr-help');
    if (help) help.textContent = ADDR_HELP;
    closeAddressLayer();
    var detail = $('f-addr-detail');
    if (detail) {
      detail.focus({ preventScroll: true });
      detail.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    toast(text ? '주소를 채웠습니다. 상세주소를 입력해 주세요' : '주소를 찾지 못했습니다. 직접 입력해 주세요');
    /* 규칙상 address는 120자까지라, 넘으면 조용히 잘라 저장하지 않고 직접 입력으로 넘겨 고쳐 쓰게 합니다. */
    if (composeAddress().length > 120) enableAddressManual('주소가 120자를 넘습니다. 직접 입력에서 줄여 주세요.');
  }

  function enableAddressManual(message) {
    var base = $('f-addr-base');
    if (!base) return;
    addr.manual = true;
    base.readOnly = false;
    base.placeholder = ADDR_PLACEHOLDER_MANUAL;
    var alt = $('addr-manual');
    if (alt) alt.textContent = '주소 검색 다시 쓰기';
    var help = $('addr-help');
    if (help) help.textContent = ADDR_HELP_MANUAL;
    if (message) toast(message);
    base.focus({ preventScroll: true });
  }

  function openAddressSearch() {
    if (addr.open) { closeAddressLayer(); return; }
    if (addr.manual) {
      /* 직접 입력 중이면 이미 입력한 내용을 지우지 않고 검색으로 되돌립니다. */
      addr.manual = false;
      var back = $('f-addr-base');
      if (back) { back.readOnly = true; back.placeholder = ADDR_PLACEHOLDER; }
      var backAlt = $('addr-manual');
      if (backAlt) backAlt.textContent = '주소 검색 창이 안 열리면 직접 입력';
      var backHelp = $('addr-help');
      if (backHelp) backHelp.textContent = ADDR_HELP;
    }
    var layer = $('addr-layer');
    var frame = $('addr-frame');
    var button = $('addr-search');
    if (!layer || !frame) return;
    if (button) { button.disabled = true; button.textContent = '불러오는 중…'; }
    loadPostcode().then(function (Postcode) {
      if (button) { button.disabled = false; button.textContent = '🔍 주소 검색'; }
      frame.innerHTML = '';
      layer.hidden = false;
      layer.classList.add('is-open');
      document.body.classList.add('rp-addr-open');
      addr.open = true;
      if (button) button.setAttribute('aria-expanded', 'true');
      new Postcode({
        oncomplete: applySearchAddress,
        onclose: function () { closeAddressLayer(); },
        width: '100%',
        height: '100%',
        animation: false
      }).embed(frame);
      sizeEmbeddedFrame(frame);
      var close = $('addr-close');
      if (close) close.focus({ preventScroll: true });
    }).catch(function () {
      if (button) { button.disabled = false; button.textContent = '🔍 주소 검색'; }
      enableAddressManual('주소 검색을 불러오지 못했습니다. 주소를 직접 입력해 주세요.');
    });
  }

  function resetAddress() {
    closeAddressLayer();
    var base = $('f-addr-base');
    if (base) { base.value = ''; base.readOnly = true; base.placeholder = ADDR_PLACEHOLDER; }
    var detail = $('f-addr-detail');
    if (detail) detail.value = '';
    addr.manual = false;
    var alt = $('addr-manual');
    if (alt) alt.textContent = '주소 검색 창이 안 열리면 직접 입력';
    var help = $('addr-help');
    if (help) help.textContent = ADDR_HELP;
  }

  /* ---------------- 접수번호 ---------------- */
  function randomCode() {
    var out = '';
    var bytes = new Uint8Array(4);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < 4; j++) out += TICKET_ALPHABET.charAt(bytes[j] % TICKET_ALPHABET.length);
    return out;
  }

  function makeTicketNo() {
    var d = new Date();
    var stamp = String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate());
    return 'SM-' + stamp + '-' + randomCode();
  }

  function normalizeTicket(value) {
    var text = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (text.indexOf('SM') === 0) text = text.slice(2);
    if (text.length > 10) text = text.slice(0, 10);
    if (text.length <= 6) return text ? 'SM-' + text : '';
    return 'SM-' + text.slice(0, 6) + '-' + text.slice(6);
  }

  /* ---------------- 접수 신청 ---------------- */
  var symptoms = {
    double: '더블클릭',
    wheel: '휠 불량',
    cable: '케이블',
    other: '기타'
  };

  function toggleCarrierEtc(on) {
    var wrap = $('f-carrier-etc-wrap');
    if (!wrap) return;
    wrap.hidden = !on;
    var input = $('f-carrier-etc');
    if (!input) return;
    if (!on) { input.value = ''; return; }
    if (document.activeElement === $('f-carrier')) setTimeout(function () { input.focus({ preventScroll: true }); }, 40);
  }

  function readCarrier() {
    var picked = $('f-carrier').value;
    if (picked !== 'etc') return picked;
    var etc = $('f-carrier-etc') ? $('f-carrier-etc').value.trim().replace(/\s+/g, ' ').slice(0, 20) : '';
    return etc || 'etc';
  }

  function readIntakeForm() {
    var symptomsChecked = Array.prototype.slice.call(document.querySelectorAll('input[name="symptom"]:checked')).map(function (el) { return el.value; });
    return {
      name: $('f-name').value.trim(),
      phone: onlyDigits($('f-phone').value),
      kakao: $('f-kakao').value.trim(),
      address: composeAddress(),
      model: $('f-model').value.trim(),
      qty: Number(onlyDigits($('f-qty').value) || 0),
      symptoms: symptomsChecked,
      symptomNote: $('f-symptom-note').value.trim(),
      carrier: readCarrier(),
      trackingNo: onlyDigits($('f-tracking').value),
      agree: $('f-agree').checked
    };
  }

  function validateIntake(data) {
    if (!data.name) return '성함을 입력해 주세요.';
    if (data.name.length > 30) return '성함은 30자 이내로 입력해 주세요.';
    if (!/^0[0-9]{8,10}$/.test(data.phone)) return '연락처를 정확히 입력해 주세요. (예: 010-1234-5678)';
    if (!data.address) return '회송 받으실 주소를 입력해 주세요. 「🔍 주소 검색」을 누르면 우편번호·주소가 자동으로 들어갑니다.';
    if (data.address.length > 120) return '주소는 120자 이내로 입력해 주세요. 상세주소가 길면 줄여 주세요.';
    if (!data.model) return '마우스 모델을 입력해 주세요.';
    if (data.model.length > 40) return '모델명은 40자 이내로 입력해 주세요.';
    if (!(data.qty >= 1 && data.qty <= 20)) return '수량은 1~20 사이로 입력해 주세요.';
    if (!data.symptoms.length) return '고장 증상을 하나 이상 선택해 주세요.';
    if (data.symptomNote.length > 300) return '증상 메모는 300자 이내로 입력해 주세요.';
    if (!data.agree) return '개인정보 수집·이용에 동의해 주세요.';
    return '';
  }

  function buildTicket(data, ticketNo) {
    var now = new Date();
    return {
      ticketNo: ticketNo,
      status: 'received',
      name: data.name,
      phone: data.phone,
      phone4: data.phone.slice(-4),
      kakao: data.kakao,
      address: data.address,
      model: data.model,
      qty: data.qty,
      symptoms: data.symptoms,
      symptomNote: data.symptomNote,
      carrier: data.carrier,
      trackingNo: data.trackingNo,
      createdAt: now.toISOString(),
      source: 'repair.html'
    };
  }

  function submitIntake(event) {
    event.preventDefault();
    if (state.submitting) return;
    var data = readIntakeForm();
    var problem = validateIntake(data);
    showError($('intake-error'), problem);
    if (problem) {
      var first = document.querySelector('#intake-form input:invalid, #intake-form textarea:invalid');
      if (first && first.focus) first.focus();
      return;
    }
    state.submitting = true;
    var button = $('intake-submit');
    var original = button.textContent;
    button.disabled = true;
    button.textContent = '접수 중…';

    createTicket(data, 0).then(function (ticketNo) {
      state.lastTicket = ticketNo;
      showIntakeDone(ticketNo, data);
      toast('접수번호 ' + ticketNo + ' 발급 완료');
    }).catch(function (err) {
      var message = err && err.message === 'offline'
        ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
        : '접수 저장에 실패했습니다. 잠시 후 다시 시도하시거나 오픈카톡으로 알려 주세요.';
      showError($('intake-error'), message);
    }).then(function () {
      state.submitting = false;
      button.disabled = false;
      button.textContent = original;
    });
  }

  function createTicket(data, attempt) {
    var ticketNo = makeTicketNo();
    var doc = { fields: toFields(buildTicket(data, ticketNo)) };
    return firestore('POST', '/' + COLLECTION, doc, { documentId: ticketNo }).then(function (res) {
      if (res.ok) return ticketNo;
      if (res.status === 409 && attempt < 4) return createTicket(data, attempt + 1);
      var reason = res.data && res.data.error ? res.data.error.status : '';
      if (reason === 'UNAVAILABLE' || reason === 'INTERNAL' || !navigator.onLine) throw new Error('offline');
      throw new Error(reason || 'save_failed');
    }, function () { throw new Error('offline'); });
  }

  function showIntakeDone(ticketNo, data) {
    $('intake-form').hidden = true;
    var done = $('intake-done');
    done.hidden = false;
    $('done-ticket').textContent = ticketNo;
    var link = SITE + 'repair.html?code=' + encodeURIComponent(ticketNo);
    $('done-lookup-link').setAttribute('href', 'repair.html?code=' + encodeURIComponent(ticketNo));
    $('done-kakao').setAttribute('href', OPEN_CHAT);
    try { localStorage.setItem('seoulmouse.repair.lastTicket', ticketNo); } catch (e) { /* 무시 */ }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    done.focus && done.focus();
  }

  function resetIntake() {
    $('intake-form').reset();
    $('f-qty').value = '1';
    resetAddress();
    toggleCarrierEtc(false);
    $('intake-form').hidden = false;
    $('intake-done').hidden = true;
    showError($('intake-error'), '');
    $('f-name').focus();
  }

  /* ---------------- 진행 조회 ---------------- */
  function lookupTicket(ticketNo, phone4) {
    return firestore('GET', '/' + COLLECTION + '/' + encodeURIComponent(ticketNo)).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(res.data && res.data.error ? res.data.error.status : 'lookup_failed');
      return fromFields(res.data.fields || {});
    });
  }

  function submitLookup(event) {
    if (event) event.preventDefault();
    var ticketNo = normalizeTicket($('l-ticket').value);
    var phone4 = onlyDigits($('l-phone4').value);
    showError($('lookup-error'), '');
    if (!/^SM-[0-9]{6}-[A-Z0-9]{4}$/.test(ticketNo)) { showError($('lookup-error'), '접수번호를 정확히 입력해 주세요. (예: SM-261119-A7K2)'); $('l-ticket').focus(); return; }
    if (phone4.length !== 4) { showError($('lookup-error'), '연락처 뒤 4자리를 입력해 주세요.'); $('l-phone4').focus(); return; }
    var button = $('lookup-submit');
    button.disabled = true;
    button.textContent = '조회 중…';
    lookupTicket(ticketNo, phone4).then(function (ticket) {
      if (!ticket) { showError($('lookup-error'), '해당 접수번호의 접수를 찾을 수 없습니다. 번호를 다시 확인해 주세요.'); return; }
      if (String(ticket.phone4) !== phone4) { showError($('lookup-error'), '연락처 뒤 4자리가 접수 내용과 다릅니다.'); return; }
      renderTicket(ticket);
      try { localStorage.setItem('seoulmouse.repair.lastTicket', ticket.ticketNo); } catch (e) { /* 무시 */ }
    }).catch(function () {
      showError($('lookup-error'), '조회에 실패했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
    }).then(function () {
      button.disabled = false;
      button.textContent = '진행 상황 조회';
    });
  }

  function renderTicket(ticket) {
    var box = $('lookup-result');
    var key = normalizeStatus(ticket.status);
    var status = STATUS[key] || STATUS.received;
    var step = status.step;
    var symptomText = (ticket.symptoms || []).map(function (k) { return symptoms[k] || k; }).join(' · ') || '미기재';
    var dates = stepDates(ticket);
    var percent = Math.round(((step + 1) / STEPS.length) * 100);
    var html = '';

    html += '<div class="rp-card">';
    html += '<div class="rp-ticket-head"><strong>' + escapeHtml(ticket.ticketNo) + '</strong><span class="rp-status-chip rp-status-' + key + '">' + status.label + '</span></div>';
    html += '<p class="rp-ticket-sub">' + escapeHtml(ticket.model || '') + ' · ' + (ticket.qty || 1) + '개 · ' + escapeHtml(ticket.name || '') + '님</p>';
    html += '<div class="rp-progress" role="img" aria-label="5단계 중 ' + (step + 1) + '단계 진행 중"><span style="width:' + percent + '%"></span></div>';
    html += '<p class="rp-progress-label">' + (step + 1) + ' / ' + STEPS.length + ' 단계 · ' + status.label + '</p>';
    html += '<ol class="rp-track" aria-label="수리 진행 5단계">';
    STEPS.forEach(function (item, index) {
      var cls = index < step ? 'is-done' : (index === step ? 'is-current' : 'is-todo');
      var when = dates[item.key] ? formatKoreanDate(dates[item.key]) : '';
      var mark = index < step ? '✓' : String(index + 1);
      html += '<li class="' + cls + '">';
      html += '<span class="rp-track-dot" aria-hidden="true">' + mark + '</span>';
      html += '<div class="rp-track-body">';
      html += '<p class="rp-track-title">' + item.title + '<span class="rp-visually-hidden">' + (index < step ? ' 완료' : (index === step ? ' 진행 중' : ' 예정')) + '</span></p>';
      html += '<p class="rp-track-desc">' + item.desc + (item.key === 'arrived' && index <= step ? ' <span class="rp-muted">(예상 ' + escapeHtml(ticket.expectedDays || '15~20일') + ')</span>' : '') + '</p>';
      if (when) html += '<p class="rp-track-date">' + when + '</p>';
      if (item.key === 'arrived' && index <= step && ticket.expectedFrom && ticket.expectedTo) {
        html += '<p class="rp-track-date">완료 예정 ' + formatKoreanDate(ticket.expectedFrom) + ' ~ ' + formatKoreanDate(ticket.expectedTo) + '</p>';
      }
      html += '</div></li>';
    });
    html += '</ol>';
    html += '<dl class="rp-kv">';
    html += '<dt>접수일</dt><dd>' + formatKoreanDate(ticket.createdAt) + '</dd>';
    html += '<dt>증상</dt><dd>' + escapeHtml(symptomText) + (ticket.symptomNote ? '<br><span class="rp-muted">' + escapeHtml(ticket.symptomNote) + '</span>' : '') + '</dd>';
    if (ticket.arrivedAt) {
      html += '<dt>택배 도착일</dt><dd>' + formatKoreanDate(ticket.arrivedAt) + '</dd>';
      html += '<dt>예상 수리기간</dt><dd>' + escapeHtml(ticket.expectedDays || '15~20일') + ' <span class="rp-muted">(도착일 기준)</span></dd>';
    }
    if (ticket.expectedFrom && ticket.expectedTo) {
      html += '<dt>완료 예정</dt><dd><strong>' + formatKoreanDate(ticket.expectedFrom) + ' ~ ' + formatKoreanDate(ticket.expectedTo) + '</strong></dd>';
    }
    if (ticket.trackingNo || ticket.carrier) {
      html += '<dt>보내신 택배</dt><dd>' + escapeHtml(carrierName(ticket.carrier) || '택배사 미기재') + (ticket.trackingNo ? ' ' + escapeHtml(ticket.trackingNo) : '') + '</dd>';
    }
    var fee = Number(ticket.repairFee || ticket.quote || 0);
    if (key === 'repaired' || key === 'shipped') {
      if (fee) html += '<dt>수리 금액</dt><dd><strong>' + fee.toLocaleString('ko-KR') + '원</strong>' + (ticket.paid ? ' <span class="rp-muted">(입금 확인)</span>' : '') + '</dd>';
      if (ticket.asNote) html += '<dt>AS 안내</dt><dd>' + escapeHtml(ticket.asNote) + '</dd>';
    }
    html += '</dl>';
    if (ticket.ownerMemo) {
      html += '<div class="rp-owner-note"><b>사장님 안내</b>' + escapeHtml(ticket.ownerMemo).replace(/\n/g, '<br>') + '</div>';
    }
    if (ticket.returnCarrier || ticket.returnTrackingNo || key === 'shipped') {
      var returnCarrier = carrierName(ticket.returnCarrier || 'post') || '우체국택배';
      var trackingNo = ticket.returnTrackingNo ? String(ticket.returnTrackingNo) : '';
      var returnTracking = trackingNo ? '송장번호 ' + escapeHtml(trackingNo) : '사전접수 후 송장번호를 알려드립니다';
      html += '<div class="rp-shipping"><b>반송 정보</b>' + escapeHtml(returnCarrier) + ' · ' + returnTracking;
      if (trackingNo) html += '<br><a href="' + trackingUrl(ticket.returnCarrier, trackingNo) + '" target="_blank" rel="noopener noreferrer">배송 조회하기 →</a>';
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="rp-card"><p class="rp-fineprint">진행 상황은 사장님이 상태를 바꿀 때마다 바로 반영됩니다. 궁금한 점은 오픈카톡(<a href="' + OPEN_CHAT + '" target="_blank" rel="noopener noreferrer">1:1 상담</a>)이나 전화 010-3100-4361로 문의해 주세요.</p></div>';

    box.innerHTML = html;
    box.hidden = false;
    $('lookup-empty').hidden = true;
    $('lookup-form').classList.add('is-compact');
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* 단계별 날짜 — statusHistory(관리자가 상태를 바꾼 시각)를 우선 쓰고, 없으면 저장된 날짜를 씁니다. */
  function stepDates(ticket) {
    var map = {};
    if (ticket.createdAt) map.received = ticket.createdAt;
    if (ticket.arrivedAt) map.arrived = ticket.arrivedAt;
    (ticket.statusHistory || []).forEach(function (row) {
      if (!row || !row.status) return;
      var key = normalizeStatus(row.status);
      map[key] = row.at || map[key];
    });
    return map;
  }

  /* 우체국택배만 인터넷우체국 배송조회로 바로 연결합니다. */
  function trackingUrl(carrier, trackingNo) {
    var name = carrierName(carrier || 'post');
    if (String(trackingNo || '').length === 13 || /우체국/.test(name)) {
      return 'https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=' + encodeURIComponent(trackingNo);
    }
    return 'https://search.naver.com/search.naver?query=' + encodeURIComponent(name + ' ' + trackingNo + ' 배송조회');
  }

  var CARRIERS = {
    cj: 'CJ대한통운', post: '우체국택배', lotte: '롯데택배', hanjin: '한진택배',
    logen: '로젠택배', kyungdong: '경동택배', daesin: '대신택배',
    gs: 'GS25 편의점택배', cu: 'CU 편의점택배', etc: '기타 택배'
  };

  /* 직접입력한 택배사 이름은 코드가 아니라 이름 그대로 저장됩니다. */
  function carrierName(code) {
    var key = String(code || '').trim();
    if (!key) return '';
    return CARRIERS[key] || key;
  }

  function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------- 탭 ---------------- */
  function selectTab(name, options) {
    var isLookup = name === 'lookup';
    document.querySelectorAll('.rp-tab').forEach(function (tab) {
      var on = tab.getAttribute('data-tab') === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('panel-intake').hidden = isLookup;
    $('panel-lookup').hidden = !isLookup;
    if (isLookup) {
      $('lookup-form').hidden = false;
      if (options && options.reset) {
        $('lookup-result').hidden = true;
        $('lookup-result').innerHTML = '';
        $('lookup-empty').hidden = false;
      }
      if (window.location.hash !== '#lookup') {
        var codeValue = normalizeTicket($('l-ticket').value);
        history.replaceState(null, '', 'repair.html' + (codeValue ? '?code=' + encodeURIComponent(codeValue) : '') + '#lookup');
      }
      setTimeout(function () { ($('l-ticket').value ? $('l-phone4') : $('l-ticket')).focus({ preventScroll: true }); }, 60);
    } else {
      if (window.location.hash === '#lookup') history.replaceState(null, '', 'repair.html');
    }
  }

  /* ---------------- 시작 ---------------- */
  function init() {
    document.querySelectorAll('.rp-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { selectTab(tab.getAttribute('data-tab')); });
      tab.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          var next = tab.getAttribute('data-tab') === 'intake' ? 'lookup' : 'intake';
          selectTab(next);
          document.querySelector('.rp-tab[data-tab="' + next + '"]').focus();
        }
      });
    });

    $('intake-form').addEventListener('submit', submitIntake);
    $('lookup-form').addEventListener('submit', submitLookup);
    $('f-phone').addEventListener('input', function () {
      var digits = onlyDigits(this.value).slice(0, 11);
      var out = digits;
      if (digits.length > 6) out = digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
      else if (digits.length > 3) out = digits.slice(0, 3) + '-' + digits.slice(3);
      this.value = out;
    });
    $('f-tracking').addEventListener('input', function () { this.value = onlyDigits(this.value).slice(0, 20); });
    $('f-carrier').addEventListener('change', function () { toggleCarrierEtc(this.value === 'etc'); });
    $('l-phone4').addEventListener('input', function () { this.value = onlyDigits(this.value).slice(0, 4); });
    $('l-ticket').addEventListener('input', function () {
      var pos = this.selectionStart;
      var before = this.value.length;
      this.value = normalizeTicket(this.value);
      var diff = this.value.length - before;
      try { this.setSelectionRange(pos + diff, pos + diff); } catch (e) { /* 무시 */ }
    });

    $('addr-search').addEventListener('click', function (event) { event.preventDefault(); openAddressSearch(); });
    $('addr-close').addEventListener('click', function () { closeAddressLayer(); $('addr-search').focus({ preventScroll: true }); });
    $('addr-manual').addEventListener('click', function () {
      if (addr.manual) { openAddressSearch(); return; }
      enableAddressManual('');
    });
    $('f-addr-base').addEventListener('click', function () { if (!addr.manual) openAddressSearch(); });
    $('f-addr-base').addEventListener('keydown', function (event) {
      if (!addr.manual && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openAddressSearch(); }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && addr.open) { closeAddressLayer(); $('addr-search').focus({ preventScroll: true }); }
    });

    $('copy-ticket').addEventListener('click', function () {
      var text = $('done-ticket').textContent.trim();
      copyText(text).then(function (ok) {
        toast(ok ? '접수번호를 복사했습니다' : '복사가 안 되면 번호를 길게 눌러 복사해 주세요');
      });
    });
    $('done-again').addEventListener('click', resetIntake);
    $('done-kakao').setAttribute('href', OPEN_CHAT);

    var params = new URLSearchParams(window.location.search);
    var code = normalizeTicket(params.get('code') || '');
    var saved = '';
    try { saved = localStorage.getItem('seoulmouse.repair.lastTicket') || ''; } catch (e) { saved = ''; }
    if (code) {
      $('l-ticket').value = code;
      selectTab('lookup');
    } else if (window.location.hash === '#lookup') {
      if (saved) $('l-ticket').value = saved;
      selectTab('lookup');
    } else if (saved) {
      $('l-ticket').value = saved;
    }

    if (saved && window.location.hash !== '#lookup') {
      var hint = document.createElement('p');
      hint.className = 'rp-hint rp-recent';
      hint.innerHTML = '최근 접수번호 <strong>' + escapeHtml(saved) + '</strong> — <button type="button" class="rp-textlink">진행 조회하기</button>';
      hint.querySelector('button').addEventListener('click', function () {
        $('l-ticket').value = saved;
        selectTab('lookup');
      });
      $('panel-intake').insertBefore(hint, $('panel-intake').firstChild);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
