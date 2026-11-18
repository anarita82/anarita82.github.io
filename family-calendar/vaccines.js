/* 🏥 국가 검진·예방접종 — 아이 예방접종 + 성인 건강검진·암검진
   - 질병관리청 표준예방접종일정표(2026)와 국민건강보험공단 국가건강검진·국가암검진(2026) 기준으로
     생년월일·성별만 넣으면 지금·앞으로 챙길 일정을 계산해 달력에 한 번에 담아 줍니다.
   - 만 18세 이하 = 아이 일정, 만 19세 이상 = 성인 일정으로 자동으로 나뉩니다.
   - 실명·생년월일은 코드에 넣지 않습니다. 사용자가 넣은 값은 이 기기(localStorage)에만 저장합니다.
   - 계산값은 안내용입니다. 접종·검진 전에 의료기관·국민건강보험공단(1577-1000)에 확인하세요.
*/
(function () {
  'use strict';

  var LS_KEY = 'family-calendar.health.profiles.v1';
  var ADULT_AGE = 19;
  var SOURCE_NOTE = '질병관리청 표준예방접종일정표·국민건강보험공단 국가건강검진(2026) 기준, 접종·검진 전 의료기관 확인';

  /* ---------------- 날짜 도구 ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(dt) { return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()); }
  function parseISO(s) {
    var p = String(s || '').split('-').map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
    var dt = new Date(p[0], p[1] - 1, p[2]);
    if (isNaN(dt.getTime())) return null;
    return dt;
  }
  function isYMD(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !!parseISO(s); }
  function todayISO() { return isoOf(new Date()); }
  function addDaysISO(s, n) {
    var d = parseISO(s);
    if (!d) return s;
    return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }
  function addMonthsISO(s, m) {
    var d = parseISO(s);
    if (!d) return s;
    var y = d.getFullYear(), mo = d.getMonth() + m, day = d.getDate();
    var last = new Date(y, mo + 1, 0).getDate();
    return isoOf(new Date(y, mo, Math.min(day, last)));
  }
  function daysDiff(a, b) {
    var A = parseISO(a), B = parseISO(b);
    if (!A || !B) return 0;
    return Math.round((B - A) / 86400000);
  }
  function ageYears(birth, at) {
    var b = parseISO(birth), t = parseISO(at);
    if (!b || !t) return null;
    var y = t.getFullYear() - b.getFullYear();
    var m = t.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < b.getDate())) y -= 1;
    return y;
  }
  function yearOf(s) { return Number(String(s || '').slice(0, 4)) || 0; }
  function isEvenYear(y) { return y % 2 === 0; }
  /* 올해 안에서 제안 날짜 — 오늘 + n일, 12월 20일을 넘지 않게 */
  function thisYearDue(today, n) {
    var y = yearOf(today);
    var d = addDaysISO(today, n);
    var cap = y + '-12-20';
    return d > cap ? cap : d;
  }

  /* ---------------- 기기 저장 (아이·가족 생년월일) ---------------- */
  function loadProfiles() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; }
  }
  function saveProfile(name, birth, sex) {
    if (!name || !isYMD(birth) || !sex) return;
    var all = loadProfiles();
    all[name] = { birth: birth, sex: sex, at: Date.now() };
    var keys = Object.keys(all);
    if (keys.length > 12) {
      keys.sort(function (a, b) { return (all[b].at || 0) - (all[a].at || 0); });
      keys.slice(12).forEach(function (k) { delete all[k]; });
    }
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch (e) { /* 저장 못 해도 계산은 계속 */ }
  }

  /* ---------------- 아이 예방접종 (질병관리청 표준일정 2026) ----------------
     m = 출생 후 개월 수, win = 권장 시기 설명, note = 무료 여부·주의 */
  var CHILD_DOSES = [
    { key: 'bcg', label: 'BCG(결핵) 1회', m: 0, win: '출생 후 4주 이내', note: '피내용 무료 · 경피용은 본인 부담' },
    { key: 'hepb1', label: 'B형간염 1차', m: 0, win: '출생 시(12시간 이내)', note: '출생 직후 병원에서 접종' },
    { key: 'hepb2', label: 'B형간염 2차', m: 1, win: '생후 1개월', note: '1차와 1개월 간격' },
    { key: 'hepb3', label: 'B형간염 3차', m: 6, win: '생후 6개월', note: '3차까지 마치면 기본 접종 완료' },
    { key: 'dtap1', label: 'DTaP 1차', m: 2, win: '생후 2개월', note: '디프테리아·파상풍·백일해 · 혼합백신 가능' },
    { key: 'dtap2', label: 'DTaP 2차', m: 4, win: '생후 4개월', note: '1차 후 2개월' },
    { key: 'dtap3', label: 'DTaP 3차', m: 6, win: '생후 6개월', note: '2차 후 2개월' },
    { key: 'dtap4', label: 'DTaP 4차', m: 15, win: '생후 15~18개월', note: '3차 후 6개월 이상' },
    { key: 'dtap5', label: 'DTaP 5차', m: 48, win: '만 4~6세', note: '초등 입학 전에 마치면 좋아요' },
    { key: 'tdap6', label: 'Tdap 6차', m: 132, win: '만 11~12세', note: '초6~중1 · 무료(파상풍·디프테리아·백일해)' },
    { key: 'ipv1', label: '폴리오(IPV) 1차', m: 2, win: '생후 2개월', note: 'DTaP와 같은 날 접종 가능' },
    { key: 'ipv2', label: '폴리오(IPV) 2차', m: 4, win: '생후 4개월', note: '1차 후 2개월' },
    { key: 'ipv3', label: '폴리오(IPV) 3차', m: 6, win: '생후 6~18개월', note: '2차 후 2개월' },
    { key: 'ipv4', label: '폴리오(IPV) 4차', m: 48, win: '만 4~6세', note: '3차 후 6개월 이상' },
    { key: 'hib1', label: 'Hib 1차', m: 2, win: '생후 2개월', note: 'b형헤모필루스인플루엔자 · 생후 59개월까지 무료' },
    { key: 'hib2', label: 'Hib 2차', m: 4, win: '생후 4개월', note: '1차 후 2개월' },
    { key: 'hib3', label: 'Hib 3차', m: 6, win: '생후 6개월', note: '2차 후 2개월' },
    { key: 'hib4', label: 'Hib 4차', m: 12, win: '생후 12~15개월', note: '3차 후 6개월 이상' },
    { key: 'pcv1', label: '폐렴구균 1차', m: 2, win: '생후 2개월', note: '생후 59개월까지 무료' },
    { key: 'pcv2', label: '폐렴구균 2차', m: 4, win: '생후 4개월', note: '1차 후 2개월' },
    { key: 'pcv3', label: '폐렴구균 3차', m: 6, win: '생후 6개월', note: '2차 후 2개월' },
    { key: 'pcv4', label: '폐렴구균 4차', m: 12, win: '생후 12~15개월', note: '3차 후 6개월 이상' },
    { key: 'rv1', label: '로타바이러스 1차', m: 2, win: '생후 2개월(14주 6일 이내)', note: 'RV1 2회 / RV5 3회 · 1차는 생후 14주 6일까지' },
    { key: 'rv2', label: '로타바이러스 2차', m: 4, win: '생후 4개월', note: 'RV5는 3차까지 · 생후 8개월 0일까지' },
    { key: 'rv3', label: '로타바이러스 3차', m: 6, win: '생후 6개월', note: 'RV5만 3차 · RV1은 2회로 완료' },
    { key: 'mmr1', label: 'MMR 1차', m: 12, win: '생후 12~15개월', note: '홍역·유행성이하선염·풍진' },
    { key: 'mmr2', label: 'MMR 2차', m: 48, win: '만 4~6세', note: '1차 후 최소 1개월, 보통 만 4세 이후' },
    { key: 'var1', label: '수두 1회', m: 12, win: '생후 12~15개월', note: '1회 접종으로 완료' },
    { key: 'hepa1', label: 'A형간염 1차', m: 12, win: '생후 12~23개월', note: '2차는 6~12개월 뒤' },
    { key: 'hepa2', label: 'A형간염 2차', m: 18, win: '1차 후 6~12개월', note: '2차까지 마치면 완료' },
    { key: 'jev1', label: '일본뇌염 1차', m: 12, win: '생후 12~23개월', note: '불활성화 백신 5회 일정' },
    { key: 'jev2', label: '일본뇌염 2차', m: 13, win: '1차 후 7~30일', note: '불활성화 백신' },
    { key: 'jev3', label: '일본뇌염 3차', m: 24, win: '2차 후 12개월(생후 24~35개월)', note: '불활성화 백신' },
    { key: 'jev4', label: '일본뇌염 4차', m: 72, win: '만 6세', note: '3차 후 6년' },
    { key: 'jev5', label: '일본뇌염 5차', m: 144, win: '만 12세', note: '마지막 5차 · 무료' },
    { key: 'hpv1', label: 'HPV(사람유두종바이러스) 1차', m: 144, win: '만 12세', note: '', hpv: true },
    { key: 'hpv2', label: 'HPV 2차', m: 150, win: '1차 후 6개월', note: '', hpv: true }
  ];

  function hpvNote(profile) {
    var by = yearOf(profile.birth);
    if (profile.sex === 'f') {
      return '여아는 만 12~17세 무료(2026년 기준 2008~2014년생, HPV 2·4가) · 2차는 6~12개월 뒤 · 9가는 본인 부담';
    }
    if (by >= 2014) {
      var startYear = 2026 + (by - 2014);
      return '남아는 ' + startYear + '년부터 무료(2014년생 시작, 해마다 1살씩 확대 · HPV 4가 2회)';
    }
    return '남아 무료 지원은 2014년생부터예요 · 이 아이는 무료 대상이 아니에요(원하면 본인 부담)';
  }

  /* ---------------- 인플루엔자 (2026-2027절기: 생후 6개월~14세 무료) ---------------- */
  function fluSeason(today) {
    var d = parseISO(today) || new Date();
    var y = d.getFullYear(), m = d.getMonth() + 1;
    var inSeason = (m >= 9 || m <= 4);
    var startYear = (m >= 9) ? y : (m <= 4 ? y - 1 : y);
    return {
      startYear: startYear,
      inSeason: inSeason,
      start: startYear + '-09-28',
      end: (startYear + 1) + '-04-30',
      label: startYear + '-' + (startYear + 1) + '절기'
    };
  }
  function fluAgeOK(birth, seasonStartYear) {
    var age = ageYears(birth, seasonStartYear + '-09-01');
    return age !== null && age >= 0 && age <= 14;
  }
  function childFluItems(profile, today) {
    var out = [];
    var s = fluSeason(today);
    var due;
    if (s.inSeason) {
      due = addDaysISO(today, 7);
      if (due > s.end) due = s.end;
    } else {
      due = s.start;
    }
    if (fluAgeOK(profile.birth, s.startYear)) {
      out.push({
        key: 'flu-' + s.startYear,
        label: '인플루엔자(독감) ' + s.label,
        due: due,
        win: s.start + ' ~ ' + s.end + ' · 매년 가을',
        note: '2026-2027절기 기준 생후 6개월~14세 무료(2012.1.1 이후 출생) · 9세 미만 첫 접종은 4주 뒤 2차'
      });
    }
    var next = s.startYear + 1;
    if (next !== s.startYear && fluAgeOK(profile.birth, next)) {
      out.push({
        key: 'flu-' + next,
        label: '인플루엔자(독감) ' + next + '-' + (next + 1) + '절기',
        due: next + '-09-28',
        win: next + '-09-28 ~ ' + (next + 1) + '-04-30 · 매년 가을',
        note: '해마다 가을에 한 번 · 무료 나이는 그해 공고를 확인하세요'
      });
    }
    return out;
  }

  /* ---------------- 아이 일정 ---------------- */
  function childItems(profile, today) {
    var list = [];
    CHILD_DOSES.forEach(function (d) {
      list.push({
        key: d.key,
        label: d.label,
        due: addMonthsISO(profile.birth, d.m),
        win: d.win,
        note: d.hpv ? hpvNote(profile) : d.note,
        optional: false
      });
    });
    return list.concat(childFluItems(profile, today));
  }

  /* ---------------- 성인 일정 (만 19세 이상) ---------------- */
  function adultItems(profile, today) {
    var out = [];
    var age = ageYears(profile.birth, today);
    var by = yearOf(profile.birth);
    var ty = yearOf(today);
    var female = profile.sex === 'f';
    var matchNow = isEvenYear(by) === isEvenYear(ty);
    var nextYear = matchNow ? ty : ty + 1;
    var parity = isEvenYear(by) ? '짝수년생' : '홀수년생';
    var parityDue = matchNow ? thisYearDue(today, 21) : nextYear + '-06-01';
    var parityNote = matchNow
      ? ty + '년은 ' + (isEvenYear(ty) ? '짝수' : '홀수') + '년생 차례라 올해 대상이에요'
      : '올해는 ' + parity + ' 차례가 아니에요 · ' + nextYear + '년에 받아요';
    var push = function (o) { out.push(o); };

    if (age >= 20) {
      push({
        key: 'checkup', label: '일반건강검진', due: parityDue,
        win: '만 20세 이상 · 2년마다',
        note: '출생연도 ' + parity + ' → ' + (isEvenYear(by) ? '짝수' : '홀수') + ' 해 · ' + parityNote + ' · 직장 사무직·지역가입자 2년마다(비사무직은 매년) · 공단 1577-1000'
      });
    }
    if (age >= 40) {
      push({
        key: 'stomach', label: '위암 검진', due: parityDue,
        win: '만 40세 이상 · 2년마다',
        note: '위내시경 또는 위장조영검사 · ' + parityNote
      });
      push({
        key: 'liver', label: '간암 검진(고위험군)', due: thisYearDue(today, 21),
        win: '만 40세 이상 고위험군 · 6개월마다',
        note: 'B형·C형간염 바이러스 보유, 간경변 등 고위험군만 · 복부초음파+혈청 AFP · 해당 없으면 체크 해제',
        optional: true
      });
    }
    if (age >= 50) {
      push({
        key: 'colon', label: '대장암 검진', due: thisYearDue(today, 21),
        win: '만 50세 이상 · 매년',
        note: '분변잠혈검사(무료) · 이상 소견이면 대장내시경 · 출생연도와 무관하게 매년'
      });
    }
    if (female && age >= 20) {
      push({
        key: 'cervix', label: '자궁경부암 검진', due: parityDue,
        win: '만 20세 이상 여성 · 2년마다',
        note: '자궁경부세포검사 · 전액 무료 · ' + parityNote
      });
    }
    if (female && age >= 40) {
      push({
        key: 'breast', label: '유방암 검진', due: parityDue,
        win: '만 40세 이상 여성 · 2년마다',
        note: '유방촬영술 · ' + parityNote
      });
    }
    if (age >= 54 && age <= 74) {
      push({
        key: 'lung', label: '폐암 검진(고위험군)', due: parityDue,
        win: '만 54~74세 고위험군 · 2년마다',
        note: '30갑년 이상 흡연력(하루 1갑×30년) 고위험군 · 저선량 흉부 CT · 해당 없으면 체크 해제',
        optional: true
      });
    }

    /* 예방접종 */
    var s = fluSeason(today);
    var fluDue = s.inSeason ? addDaysISO(today, 7) : s.start;
    if (fluDue > s.end) fluDue = s.end;
    if (age >= 65) {
      push({
        key: 'flu-' + s.startYear, label: '인플루엔자(독감) ' + s.label, due: fluDue,
        win: '만 65세 이상 무료 · 매년 가을(' + s.start + ' ~ ' + s.end + ')',
        note: '어르신 무료 접종 · 9~12월에 맞으면 좋아요'
      });
      push({
        key: 'pneumo', label: '폐렴구균(PPSV23) 1회', due: thisYearDue(today, 21),
        win: '만 65세 이상 · 1회 무료',
        note: '폐렴구균 23가 · 65세 이상 1회 무료(이미 맞았으면 체크 해제)'
      });
    } else {
      push({
        key: 'flu-' + s.startYear, label: '인플루엔자(독감) ' + s.label, due: fluDue,
        win: '매년 가을(' + s.start + ' ~ ' + s.end + ')',
        note: '성인은 본인 부담(일부 직장·지자체 지원) · 만 65세부터 무료',
        optional: true
      });
    }
    if (age >= 50) {
      push({
        key: 'shingles', label: '대상포진 예방접종', due: thisYearDue(today, 21),
        win: '만 50세 이상 권장 · 2회(2~6개월 간격)',
        note: '유료(지자체 지원 여부 확인) · 2회 접종 후 완료 · 원할 때만 체크',
        optional: true
      });
    }
    push({
      key: 'tdap', label: 'Tdap/Td (파상풍·디프테리아·백일해)', due: thisYearDue(today, 21),
      win: '성인 10년마다',
      note: '마지막 접종일을 모르면 의료기관에 확인 · 임신부는 매 임신마다 권장 · 원할 때만 체크',
      optional: true
    });
    return out;
  }

  /* ---------------- 묶음 계산 ---------------- */
  function bucketOf(due, today) {
    var diff = daysDiff(today, due);   /* due - today */
    if (diff < -90) return 'past';
    if (diff > 90) return 'future';
    return 'now';
  }
  function build(profile, today) {
    var t = isYMD(today) ? today : todayISO();
    var age = ageYears(profile.birth, t);
    var mode = (age !== null && age >= ADULT_AGE) ? 'adult' : 'child';
    var raw = mode === 'adult' ? adultItems(profile, t) : childItems(profile, t);
    var items = raw.map(function (it) {
      var b = bucketOf(it.due, t);
      return {
        key: it.key,
        label: it.label,
        due: it.due,
        win: it.win,
        note: it.note,
        optional: !!it.optional,
        bucket: b,
        checked: (b !== 'past') && !it.optional
      };
    });
    return { mode: mode, age: age, today: t, items: items };
  }

  /* ---------------- 화면 ---------------- */
  var UI = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmtMD(iso) {
    if (!isYMD(iso)) return iso || '';
    var p = iso.split('-');
    return Number(p[1]) + '/' + Number(p[2]);
  }

  function makeUI() {
    var ui = {
      cfg: null,
      modal: $('vacModal'),
      kids: $('vacKids'),
      name: $('vacName'),
      birth: $('vacBirth'),
      sexBtns: $('vacSex'),
      summary: $('vacSummary'),
      body: $('vacBody'),
      saveBtn: $('vacSaveBtn'),
      remind: $('vacRemind'),
      err: $('vacError'),
      note: $('vacNote'),
      result: null,
      profile: { name: '', birth: '', sex: '' },
      memberId: '',
      model: null,
      expandedPast: false,
      saving: false
    };
    return ui;
  }

  function showError(msg) {
    if (!UI || !UI.err) return;
    UI.err.textContent = msg || '';
    UI.err.hidden = !msg;
  }

  function renderKids() {
    var cfg = UI.cfg || {};
    var members = Array.isArray(cfg.members) ? cfg.members : [];
    UI.kids.innerHTML = '';
    members.forEach(function (m) {
      var b = el('button', 'pick vac-kid');
      b.type = 'button';
      b.setAttribute('data-id', m.id);
      if (m.color) b.style.setProperty('--c', m.color);
      if (m.bg) b.style.setProperty('--bgc', m.bg);
      b.appendChild(el('span', 'vac-kid__dot'));
      b.appendChild(document.createTextNode(m.name));
      b.addEventListener('click', function () { pickMember(m); });
      UI.kids.appendChild(b);
    });
    var direct = el('button', 'pick vac-kid vac-kid--me');
    direct.type = 'button';
    direct.setAttribute('data-id', '');
    direct.textContent = '✏️ 직접 입력';
    direct.addEventListener('click', function () {
      UI.memberId = '';
      UI.profile.name = '';
      UI.profile.birth = '';
      UI.profile.sex = '';
      UI.name.value = '';
      UI.birth.value = '';
      paintSex();
      paintKidActive();
      UI.model = null;
      renderResult();
      UI.name.focus();
    });
    UI.kids.appendChild(direct);
    paintKidActive();
  }

  function paintKidActive() {
    if (!UI.kids) return;
    Array.prototype.forEach.call(UI.kids.children, function (b) {
      b.classList.toggle('is-on', (b.getAttribute('data-id') || '') === (UI.memberId || ''));
    });
  }

  function paintSex() {
    if (!UI.sexBtns) return;
    Array.prototype.forEach.call(UI.sexBtns.children, function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-sex') === UI.profile.sex);
    });
  }

  function pickMember(m) {
    UI.memberId = m.id;
    UI.profile.name = m.name;
    UI.name.value = m.name;
    var saved = loadProfiles()[m.name];
    var birth = m.birth || (saved && saved.birth) || '';
    var sex = (saved && saved.sex) || '';
    UI.profile.birth = birth;
    UI.profile.sex = sex;
    UI.birth.value = birth;
    paintSex();
    paintKidActive();
    showError('');
    rebuild();
    if (!birth) UI.birth.focus();
  }

  function rebuild() {
    var today = (UI.cfg && isYMD(UI.cfg.today)) ? UI.cfg.today : todayISO();
    var name = (UI.name.value || '').trim();
    var birth = UI.birth.value;
    var sex = UI.profile.sex;
    UI.profile.name = name;
    UI.profile.birth = birth;
    if (!isYMD(birth)) {
      UI.model = null;
      renderResult();
      return;
    }
    if (daysDiff(birth, today) < 0) {
      showError('생년월일이 오늘보다 나중이에요. 다시 골라 주세요.');
      UI.model = null;
      renderResult();
      return;
    }
    if (!sex) {
      UI.model = null;
      renderResult();
      return;
    }
    showError('');
    saveProfile(name, birth, sex);
    UI.model = build({ name: name, birth: birth, sex: sex }, today);
    renderResult();
  }

  function renderResult() {
    if (!UI.body) return;
    UI.body.innerHTML = '';
    var m = UI.model;
    UI.saveBtn.disabled = true;
    UI.saveBtn.textContent = '선택한 0건 달력에 추가';
    if (!m) {
      UI.summary.textContent = '';
      UI.summary.hidden = true;
      var hint = el('p', 'vac-empty');
      hint.textContent = '생년월일과 성별을 넣으면 나라 기준 일정을 계산해 드려요.';
      UI.body.appendChild(hint);
      if (UI.note) UI.note.hidden = false;
      return;
    }
    UI.summary.hidden = false;
    var modeText = m.mode === 'adult' ? '성인 일정(만 19세 이상)' : '아이 일정(만 18세 이하)';
    UI.summary.innerHTML = '';
    UI.summary.appendChild(el('b', '', (UI.profile.name || '이름 없음')));
    UI.summary.appendChild(document.createTextNode(' · 만 ' + m.age + '세 · ' + modeText));
    if (UI.cfg && UI.cfg.members && UI.cfg.members.length && UI.memberId) {
      UI.summary.appendChild(document.createTextNode(' · 가족 달력 담당으로 넣어요'));
    }

    var groups = [
      { key: 'now', title: m.mode === 'adult' ? '🔴 지금 챙길 검진·접종' : '🔴 지금 챙길 접종', open: true },
      { key: 'future', title: m.mode === 'adult' ? '⏳ 앞으로 챙길 검진·접종' : '⏳ 앞으로 맞을 접종', open: true },
      { key: 'past', title: '🕘 지난 일정 · 보완 확인용', open: false }
    ];
    groups.forEach(function (g) {
      var list = m.items.filter(function (i) { return i.bucket === g.key; });
      if (!list.length) return;
      UI.body.appendChild(groupNode(g, list));
    });
    if (!m.items.length) {
      UI.body.appendChild(el('p', 'vac-empty', '계산된 일정이 없어요.'));
    }
    if (UI.note) UI.note.hidden = false;
    updateSaveBtn();
  }

  function groupNode(g, list) {
    var wrap = el('section', 'vac-group vac-group--' + g.key);
    var head = el('div', 'vac-group__head');
    var open = g.key === 'past' ? UI.expandedPast : true;
    var t = el('button', 'vac-group__title');
    t.type = 'button';
    t.appendChild(document.createTextNode(g.title));
    t.appendChild(el('span', 'vac-group__n', String(list.length) + '건'));
    if (g.key === 'past') {
      t.appendChild(el('span', 'vac-group__chev', open ? '▾' : '▸'));
      t.addEventListener('click', function () {
        UI.expandedPast = !UI.expandedPast;
        renderResult();
      });
    }
    head.appendChild(t);
    if (g.key !== 'past') {
      var all = el('button', 'vac-group__all', '전체 해제');
      all.type = 'button';
      all.addEventListener('click', function () {
        var on = list.some(function (i) { return i.checked; });
        list.forEach(function (i) { i.checked = !on; });
        renderResult();
      });
      head.appendChild(all);
    }
    wrap.appendChild(head);
    if (open) {
      var ul = el('ul', 'vac-list');
      list.forEach(function (item) { ul.appendChild(itemNode(item)); });
      wrap.appendChild(ul);
    }
    return wrap;
  }

  function itemNode(item) {
    var li = el('li', 'vac-item' + (item.checked ? ' is-on' : '') + (item.optional ? ' is-opt' : ''));
    var lab = el('label', 'vac-item__main');
    var ck = document.createElement('input');
    ck.type = 'checkbox';
    ck.className = 'vac-item__ck';
    ck.checked = !!item.checked;
    ck.addEventListener('change', function () {
      item.checked = ck.checked;
      li.classList.toggle('is-on', ck.checked);
      updateSaveBtn();
    });
    lab.appendChild(ck);
    var body = el('span', 'vac-item__body');
    var top = el('span', 'vac-item__label', item.label);
    if (item.optional) top.appendChild(el('em', 'vac-badge', '선택'));
    if (item.bucket === 'past') top.appendChild(el('em', 'vac-badge vac-badge--past', '지남'));
    body.appendChild(top);
    body.appendChild(el('span', 'vac-item__win', item.win));
    if (item.note) body.appendChild(el('span', 'vac-item__note', item.note));
    lab.appendChild(body);
    li.appendChild(lab);

    var row = el('div', 'vac-item__daterow');
    var dt = document.createElement('input');
    dt.type = 'date';
    dt.className = 'vac-item__date';
    dt.value = item.due;
    dt.addEventListener('change', function () {
      if (isYMD(dt.value)) item.due = dt.value;
      else dt.value = item.due;
    });
    row.appendChild(el('span', 'vac-item__dlabel', '날짜'));
    row.appendChild(dt);
    li.appendChild(row);
    return li;
  }

  function updateSaveBtn() {
    var m = UI.model;
    var n = m ? m.items.filter(function (i) { return i.checked; }).length : 0;
    UI.saveBtn.disabled = !n || UI.saving;
    UI.saveBtn.textContent = '선택한 ' + n + '건 달력에 추가';
  }

  function memoSuffix() {
    return ' · ' + SOURCE_NOTE;
  }

  function doSave() {
    if (!UI.model || UI.saving) return;
    var picked = UI.model.items.filter(function (i) { return i.checked; });
    if (!picked.length) return;
    var name = (UI.profile.name || '').trim();
    var today = UI.model.today;
    var remind = UI.remind && UI.remind.checked ? 1440 : null;
    var list = picked.map(function (i) {
      var date = isYMD(i.due) ? i.due : today;
      return {
        key: i.key,
        title: (name ? name + ' ' : '') + (i.label.length > 46 ? i.label.slice(0, 46) : i.label),
        date: date,
        memo: i.win + ' · ' + (i.note || '') + memoSuffix(),
        remind: remind,
        memberId: UI.memberId || '',
        childName: name
      };
    });
    var meta = {
      name: name,
      birth: UI.profile.birth,
      sex: UI.profile.sex,
      mode: UI.model.mode,
      memberId: UI.memberId || '',
      count: list.length
    };
    if (!UI.cfg || typeof UI.cfg.onSave !== 'function') {
      showError('달력에 넣을 수 없어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    UI.saving = true;
    updateSaveBtn();
    showError('');
    Promise.resolve(UI.cfg.onSave(list, meta)).then(function (res) {
      UI.saving = false;
      var n = (res && res.count) || list.length;
      close();
      if (typeof UI.cfg.onSaved === 'function') UI.cfg.onSaved(n, meta);
    }).catch(function (err) {
      UI.saving = false;
      updateSaveBtn();
      var msg = (err && (err.message || err.code)) || '저장하지 못했어요.';
      if (typeof UI.cfg.onError === 'function') {
        msg = UI.cfg.onError(err) || msg;
      }
      showError(msg);
    });
  }

  function open(cfg) {
    if (!UI) UI = makeUI();
    if (!UI.modal) return;
    UI.cfg = cfg || {};
    UI.saving = false;
    UI.expandedPast = false;
    UI.model = null;
    UI.memberId = '';
    UI.profile = { name: '', birth: '', sex: '' };
    UI.name.value = '';
    UI.birth.value = '';
    paintSex();
    showError('');
    renderKids();
    renderResult();

    var pre = UI.cfg.prefill || null;
    if (pre && pre.name) {
      var hit = null;
      (UI.cfg.members || []).forEach(function (m) { if (m.name === pre.name) hit = m; });
      if (hit) pickMember(hit);
      else {
        UI.profile.name = pre.name;
        UI.name.value = pre.name;
      }
    }
    UI.modal.hidden = false;
    var sheet = UI.modal.querySelector('.modal__sheet');
    if (sheet) sheet.scrollTop = 0;
  }

  function close() {
    if (!UI || !UI.modal) return;
    UI.modal.hidden = true;
    showError('');
  }

  function bind() {
    if (!UI) UI = makeUI();
    if (!UI.modal || UI.modal.getAttribute('data-bound')) return;
    UI.modal.setAttribute('data-bound', '1');
    var closeBtn = $('vacClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    var back = UI.modal.querySelector('[data-close]');
    if (back) back.addEventListener('click', close);
    if (UI.name) UI.name.addEventListener('input', function () {
      UI.profile.name = UI.name.value;
      var match = null;
      (UI.cfg && UI.cfg.members || []).forEach(function (m) { if (m.name === UI.name.value.trim()) match = m; });
      UI.memberId = match ? match.id : '';
      paintKidActive();
      rebuild();
    });
    if (UI.birth) UI.birth.addEventListener('change', function () {
      UI.profile.birth = UI.birth.value;
      rebuild();
    });
    if (UI.sexBtns) {
      Array.prototype.forEach.call(UI.sexBtns.children, function (b) {
        b.addEventListener('click', function () {
          UI.profile.sex = b.getAttribute('data-sex');
          paintSex();
          rebuild();
        });
      });
    }
    if (UI.saveBtn) UI.saveBtn.addEventListener('click', doSave);
  }

  window.FamilyHealth = {
    open: function (cfg) { bind(); open(cfg); },
    close: close,
    build: build,
    todayISO: todayISO,
    ageYears: ageYears
  };
})();
