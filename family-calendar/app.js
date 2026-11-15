/* 우리 가족 달력 — 테스트 버전 (localStorage 저장) */
(function () {
  'use strict';

  var L = window.FamilyLunar;

  var MEMBERS = [
    { id: 'dad', name: '아빠', color: '#3b82f6', bg: '#e8f1fe' },
    { id: 'mom', name: '엄마', color: '#ec4899', bg: '#fdeaf3' },
    { id: 'grandma', name: '외할머니', color: '#f59e0b', bg: '#fef3e2' },
    { id: 'first', name: '첫째', color: '#10b981', bg: '#e6f7f0' },
    { id: 'second', name: '둘째', color: '#8b5cf6', bg: '#f0e9fe' },
    { id: 'third', name: '막내', color: '#06b6d4', bg: '#e2f6fa' }
  ];

  var CATEGORIES = [
    { id: 'birthday', label: '생일', emoji: '🎂', color: '#ec4899' },
    { id: 'memorial', label: '제사', emoji: '🕯️', color: '#a855f7' },
    { id: 'school', label: '학교', emoji: '🏫', color: '#3b82f6' },
    { id: 'hospital', label: '병원', emoji: '🏥', color: '#10b981' },
    { id: 'etc', label: '여행·기타', emoji: '✈️', color: '#f59e0b' }
  ];

  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var STORE_KEY = 'family-calendar.events.v1';
  var NAV_MIN_YEAR = 2024;
  var NAV_MAX_YEAR = 2037;

  /* ---------------- 저장소 ---------------- */
  var events = [];
  var state = {
    year: 0,
    month: 0,
    selected: '',
    member: 'all',
    editingId: null,
    repeat: 'none'
  };

  function loadEvents() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (Array.isArray(data)) return data.filter(isEventLike);
      }
    } catch (err) { /* 저장소를 못 읽으면 샘플로 시작 */ }
    return seedSamples();
  }

  function isEventLike(ev) {
    return ev && typeof ev === 'object' && typeof ev.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.date || '');
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(events));
      return true;
    } catch (err) {
      return false;
    }
  }

  function seedSamples() {
    var seeds = [
      { title: '[샘플] 아빠 생일', category: 'birthday', repeat: 'yearly-solar', date: '2026-12-05', members: ['dad'], memo: '케이크 미리 주문하기' },
      { title: '[샘플] 엄마 생일', category: 'birthday', repeat: 'yearly-lunar', lunar: { month: 10, day: 12 }, members: ['mom'], memo: '음력 10월 12일 · 가족 저녁 식사' },
      { title: '[샘플] 외할머니 생신', category: 'birthday', repeat: 'yearly-lunar', lunar: { month: 10, day: 20 }, members: ['grandma'], memo: '음력 10월 20일 · 외식 준비', time: '12:00' },
      { title: '[샘플] 제사 준비', category: 'memorial', repeat: 'yearly-lunar', lunar: { month: 11, day: 3 }, members: ['mom'], memo: '음력 11월 3일 · 오후 7시, 제수 장보기' },
      { title: '[샘플] 학교 체험학습', category: 'school', repeat: 'none', date: '2026-11-19', members: ['second', 'third'], memo: '도시락과 물병 챙기기' },
      { title: '[샘플] 치과 정기검진', category: 'hospital', repeat: 'none', date: '2026-11-25', time: '16:30', members: ['first'], memo: '보호자 동반' },
      { title: '[샘플] 독감 예방접종', category: 'hospital', repeat: 'none', date: '2026-12-02', time: '10:00', members: ['third'] },
      { title: '[샘플] 중간고사', category: 'school', repeat: 'none', date: '2026-12-16', members: ['first'], memo: '시험 범위 확인' },
      { title: '[샘플] 가족여행 출발', category: 'etc', repeat: 'none', date: '2026-12-28', time: '09:30', members: ['dad', 'mom', 'grandma', 'first', 'second', 'third'], memo: '공항 2시간 전 도착' }
    ];

    return seeds.map(function (s) {
      var date = s.date;
      var lunar = null;
      if (s.lunar) {
        var sol = L.toSolar(2026, s.lunar.month, s.lunar.day, false);
        if (!sol) return null;
        date = iso(sol.y, sol.m, sol.d);
        lunar = { month: s.lunar.month, day: s.lunar.day, leap: false };
      }
      return {
        id: uid(),
        title: s.title,
        date: date,
        time: s.time || null,
        members: s.members.slice(),
        category: s.category,
        memo: s.memo || '',
        repeat: s.repeat,
        lunar: lunar
      };
    }).filter(Boolean);
  }

  function uid() {
    return 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------- 날짜 도구 ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function isoOfDate(dt) { return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
  function parseISO(s) { return L.parseISO(s); }
  function todayISO() { return isoOfDate(new Date()); }
  function dayDiff(a, b) {
    var A = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var B = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((B - A) / 86400000);
  }
  function memberById(id) {
    for (var i = 0; i < MEMBERS.length; i++) if (MEMBERS[i].id === id) return MEMBERS[i];
    return null;
  }
  function categoryById(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
    return CATEGORIES[CATEGORIES.length - 1];
  }

  /* ---------------- 반복 일정 계산 ---------------- */
  function lunarOccurrence(year, lunar) {
    if (!lunar) return null;
    var tries = [];
    if (lunar.leap) {
      tries.push([lunar.month, lunar.day, true]);
      if (lunar.day === 30) tries.push([lunar.month, 29, true]);
    }
    tries.push([lunar.month, lunar.day, false]);
    if (lunar.day === 30) tries.push([lunar.month, 29, false]);
    for (var i = 0; i < tries.length; i++) {
      var sol = L.toSolar(year, tries[i][0], tries[i][1], tries[i][2]);
      if (sol) return iso(sol.y, sol.m, sol.d);
    }
    return null;
  }

  function occurrenceForYear(ev, year) {
    var base = parseISO(ev.date);
    if (ev.repeat === 'none') {
      return base.getFullYear() === year ? ev.date : null;
    }
    if (ev.repeat === 'yearly-lunar' && ev.lunar) {
      return lunarOccurrence(year, ev.lunar);
    }
    var d = new Date(year, base.getMonth(), base.getDate());
    if (d.getDate() !== base.getDate()) d = new Date(year, base.getMonth() + 1, 0); // 2/29 → 말일
    return isoOfDate(d);
  }

  function eventsOn(dateISO) {
    var y = Number(dateISO.slice(0, 4));
    return events.filter(function (ev) {
      if (!passesMemberFilter(ev)) return false;
      return occurrenceForYear(ev, y) === dateISO;
    }).sort(compareEvents);
  }

  function compareEvents(a, b) {
    var ta = a.time || '00:00';
    var tb = b.time || '00:00';
    if (ta === tb) return a.title.localeCompare(b.title, 'ko');
    return ta < tb ? -1 : 1;
  }

  function passesMemberFilter(ev) {
    if (state.member === 'all') return true;
    return (ev.members || []).indexOf(state.member) !== -1;
  }

  function lunarTextFor(ev, year) {
    if (ev.repeat !== 'yearly-lunar' || !ev.lunar) return '';
    return L.lunarLabel(ev.lunar);
  }

  /* ---------------- 렌더 ---------------- */
  var el = {};

  function init() {
    el.memberFilter = document.getElementById('memberFilter');
    el.calTitle = document.getElementById('calTitle');
    el.calSub = document.getElementById('calSub');
    el.grid = document.getElementById('grid');
    el.legend = document.getElementById('legend');
    el.dayCard = document.getElementById('dayCard');
    el.ddayList = document.getElementById('ddayList');
    el.modal = document.getElementById('modal');
    el.form = document.getElementById('eventForm');
    el.fTitle = document.getElementById('fTitle');
    el.fDate = document.getElementById('fDate');
    el.fAllDay = document.getElementById('fAllDay');
    el.fTime = document.getElementById('fTime');
    el.fMembers = document.getElementById('fMembers');
    el.fCategories = document.getElementById('fCategories');
    el.fMemo = document.getElementById('fMemo');
    el.fRepeat = document.getElementById('fRepeat');
    el.dateLunarHint = document.getElementById('dateLunarHint');
    el.repeatHint = document.getElementById('repeatHint');
    el.formError = document.getElementById('formError');
    el.modalTitle = document.getElementById('modalTitle');
    el.deleteBtn = document.getElementById('deleteBtn');

    events = loadEvents();
    var today = new Date();
    state.year = today.getFullYear();
    state.month = today.getMonth();
    state.selected = todayISO();

    bind();
    renderAll();
  }

  function bind() {
    document.getElementById('prevMonth').addEventListener('click', function () { shiftMonth(-1); });
    document.getElementById('nextMonth').addEventListener('click', function () { shiftMonth(1); });
    document.getElementById('todayBtn').addEventListener('click', goToday);
    document.getElementById('addBtn').addEventListener('click', function () { openModal(null, state.selected); });
    document.getElementById('resetBtn').addEventListener('click', resetData);
    document.getElementById('modalClose').addEventListener('click', closeModal);
    var backdrop = el.modal.querySelector('[data-close]');
    if (backdrop) backdrop.addEventListener('click', closeModal);
    el.form.addEventListener('submit', function (e) { e.preventDefault(); saveEvent(); });
    el.deleteBtn.addEventListener('click', deleteEvent);
    el.fAllDay.addEventListener('change', syncTimeField);
    el.fDate.addEventListener('change', updateDateHint);
    el.fRepeat.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-repeat]');
      if (!btn) return;
      setRepeat(btn.getAttribute('data-repeat'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.modal.hidden) closeModal();
    });
  }

  function shiftMonth(delta) {
    var d = new Date(state.year, state.month + delta, 1);
    if (d.getFullYear() < NAV_MIN_YEAR || d.getFullYear() > NAV_MAX_YEAR) return;
    state.year = d.getFullYear();
    state.month = d.getMonth();
    renderCalendar();
  }

  function goToday() {
    var today = new Date();
    state.year = today.getFullYear();
    state.month = today.getMonth();
    state.selected = todayISO();
    renderAll();
  }

  function selectDate(dateISO, scrollToCalendar) {
    state.selected = dateISO;
    var dt = parseISO(dateISO);
    state.year = dt.getFullYear();
    state.month = dt.getMonth();
    renderAll();
    if (scrollToCalendar) {
      var card = document.querySelector('.calendar');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderAll() {
    renderFilters();
    renderCalendar();
    renderDayCard();
    renderDDay();
  }

  function renderFilters() {
    el.memberFilter.innerHTML = '';
    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'chip' + (state.member === 'all' ? ' is-active' : '');
    all.setAttribute('aria-pressed', String(state.member === 'all'));
    if (state.member === 'all') all.style.background = '#4f46e5';
    var dot = document.createElement('span');
    dot.className = 'chip__dot';
    all.appendChild(dot);
    all.appendChild(document.createTextNode('전체'));
    all.addEventListener('click', function () { setMember('all'); });
    el.memberFilter.appendChild(all);

    MEMBERS.forEach(function (mb) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip' + (state.member === mb.id ? ' is-active' : '');
      btn.setAttribute('aria-pressed', String(state.member === mb.id));
      if (state.member === mb.id) btn.style.background = mb.color;
      var d = document.createElement('span');
      d.className = 'chip__dot';
      d.style.background = mb.color;
      if (state.member === mb.id) d.style.background = '#fff';
      btn.appendChild(d);
      btn.appendChild(document.createTextNode(mb.name));
      btn.addEventListener('click', function () { setMember(mb.id); });
      el.memberFilter.appendChild(btn);
    });
  }

  function setMember(id) {
    state.member = id;
    renderAll();
  }

  function renderLegend() {
    el.legend.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      var wrap = document.createElement('span');
      var i = document.createElement('i');
      i.style.background = cat.color;
      wrap.appendChild(i);
      wrap.appendChild(document.createTextNode(cat.emoji + ' ' + cat.label));
      el.legend.appendChild(wrap);
    });
  }

  function renderCalendar() {
    var y = state.year;
    var m = state.month;
    el.calTitle.textContent = y + '년 ' + (m + 1) + '월';

    var first = new Date(y, m, 1);
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var lunarFirst = L.toLunar(y, m + 1, 1);
    var lunarLast = L.toLunar(y, m + 1, daysInMonth);
    if (lunarFirst && lunarLast) {
      el.calSub.textContent = '음력 ' + lunarShort(lunarFirst) + ' ~ ' + lunarShort(lunarLast);
    } else {
      el.calSub.textContent = '';
    }

    renderLegend();

    el.grid.innerHTML = '';
    var weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
    var start = new Date(y, m, 1 - first.getDay());
    var today = todayISO();

    for (var i = 0; i < weeks * 7; i++) {
      var dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var dateISO = isoOfDate(dt);
      var inMonth = dt.getMonth() === m;
      var wd = dt.getDay();

      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day';
      if (!inMonth) cell.className += ' day--out';
      if (wd === 0) cell.className += ' day--sun';
      if (wd === 6) cell.className += ' day--sat';

      var holiday = L.holidayName(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
      if (holiday) cell.className += ' day--hol';
      if (dateISO === today) cell.className += ' day--today';
      if (dateISO === state.selected) cell.className += ' day--selected';
      cell.setAttribute('data-date', dateISO);

      var num = document.createElement('span');
      num.className = 'day__num';
      num.textContent = String(dt.getDate());
      cell.appendChild(num);

      if (holiday) {
        var hl = document.createElement('span');
        hl.className = 'day__hol';
        hl.textContent = holiday;
        cell.appendChild(hl);
      }

      var dayEvents = eventsOn(dateISO);
      if (dayEvents.length) {
        var cats = [];
        dayEvents.forEach(function (ev) {
          var c = categoryById(ev.category);
          if (cats.indexOf(c.color) === -1) cats.push(c.color);
        });
        var dots = document.createElement('span');
        dots.className = 'dots';
        cats.slice(0, 3).forEach(function (color) {
          var d = document.createElement('span');
          d.className = 'dot';
          d.style.background = color;
          dots.appendChild(d);
        });
        if (cats.length > 3) {
          var more = document.createElement('span');
          more.className = 'dots__more';
          more.textContent = '+' + (cats.length - 3);
          dots.appendChild(more);
        }
        cell.appendChild(dots);
      }

      (function (targetISO, inMonthFlag) {
        cell.addEventListener('click', function () {
          if (!inMonthFlag) {
            var d2 = parseISO(targetISO);
            state.year = d2.getFullYear();
            state.month = d2.getMonth();
            state.selected = targetISO;
            renderAll();
          } else {
            state.selected = targetISO;
            renderCalendar();
            renderDayCard();
          }
        });
      })(dateISO, inMonth);

      el.grid.appendChild(cell);
    }
  }

  function lunarShort(lunar) {
    return (lunar.leap ? '윤' : '') + lunar.month + '.' + lunar.day;
  }

  function renderDayCard() {
    var dateISO = state.selected;
    var dt = parseISO(dateISO);
    var y = dt.getFullYear();
    var m = dt.getMonth() + 1;
    var d = dt.getDate();
    var wd = dt.getDay();

    el.dayCard.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'day-head';

    var dateWrap = document.createElement('div');
    dateWrap.className = 'day-head__date';
    var strong = document.createElement('strong');
    strong.textContent = m + '월 ' + d + '일';
    dateWrap.appendChild(strong);
    var dow = document.createElement('span');
    dow.className = 'day-head__dow' + (wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : '');
    dow.textContent = '(' + WEEKDAYS[wd] + ')';
    dateWrap.appendChild(dow);
    var lunar = L.toLunar(y, m, d);
    if (lunar) {
      var lunarEl = document.createElement('span');
      lunarEl.className = 'day-head__lunar';
      lunarEl.textContent = L.lunarLabel(lunar);
      dateWrap.appendChild(lunarEl);
    }
    head.appendChild(dateWrap);

    var holiday = L.holidayName(y, m, d);
    if (holiday) {
      var badge = document.createElement('span');
      badge.className = 'day-badge';
      badge.textContent = '🎉 ' + holiday;
      head.appendChild(badge);
    }
    el.dayCard.appendChild(head);

    var dayEvents = eventsOn(dateISO);
    if (!dayEvents.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.innerHTML = '이 날은 일정이 없어요.<br><b>＋ 일정 추가</b>로 등록해 보세요.';
      el.dayCard.appendChild(empty);
      return;
    }

    var list = document.createElement('ul');
    list.className = 'event-list';
    dayEvents.forEach(function (ev) {
      list.appendChild(buildEventItem(ev, y));
    });
    el.dayCard.appendChild(list);
  }

  function buildEventItem(ev, year) {
    var cat = categoryById(ev.category);
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'event';
    btn.style.setProperty('--cat', cat.color);

    var body = document.createElement('div');
    body.className = 'event__body';

    var title = document.createElement('div');
    title.className = 'event__title';
    var catEl = document.createElement('span');
    catEl.className = 'event__cat';
    catEl.textContent = cat.emoji;
    title.appendChild(catEl);
    title.appendChild(document.createTextNode(ev.title));
    body.appendChild(title);

    var meta = document.createElement('div');
    meta.className = 'event__meta';
    var timeEl = document.createElement('span');
    timeEl.className = 'event__time';
    timeEl.textContent = ev.time ? ev.time : '종일';
    meta.appendChild(timeEl);

    var lunarText = lunarTextFor(ev, year);
    if (lunarText) {
      var lEl = document.createElement('span');
      lEl.className = 'event__lunar';
      lEl.textContent = lunarText;
      meta.appendChild(lEl);
    }    if (ev.repeat === 'yearly-solar') {
      var rEl = document.createElement('span');
      rEl.className = 'event__repeat';
      rEl.textContent = '매년';
      meta.appendChild(rEl);
    }

    var badges = document.createElement('span');
    badges.className = 'mbadges';
    (ev.members || []).forEach(function (id) {
      var mb = memberById(id);
      if (!mb) return;
      var b = document.createElement('span');
      b.className = 'mbadge';
      b.style.setProperty('--mbg', mb.bg);
      b.style.setProperty('--mfg', mb.color);
      var dot = document.createElement('i');
      b.appendChild(dot);
      b.appendChild(document.createTextNode(mb.name));
      badges.appendChild(b);
    });
    meta.appendChild(badges);
    body.appendChild(meta);

    if (ev.memo) {
      var memo = document.createElement('div');
      memo.className = 'event__memo';
      memo.textContent = ev.memo;
      body.appendChild(memo);
    }

    btn.appendChild(body);
    btn.addEventListener('click', function () { openModal(ev, null); });
    li.appendChild(btn);
    return li;
  }

  function renderDDay() {
    var today = new Date();
    var limit = 6;
    var items = [];

    events.forEach(function (ev) {
      if (!passesMemberFilter(ev)) return;
      [today.getFullYear(), today.getFullYear() + 1].forEach(function (y) {
        var d = occurrenceForYear(ev, y);
        if (!d) return;
        var diff = dayDiff(today, parseISO(d));
        if (diff >= 0 && diff <= 365) items.push({ ev: ev, date: d, diff: diff });
      });
    });

    items.sort(function (a, b) {
      if (a.diff !== b.diff) return a.diff - b.diff;
      var ta = a.ev.time || '00:00';
      var tb = b.ev.time || '00:00';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    var seen = {};
    items = items.filter(function (it) {
      var key = it.ev.id + '|' + it.date;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, limit);

    el.ddayList.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '1년 안에 다가오는 일정이 없어요.';
      el.ddayList.appendChild(empty);
      return;
    }

    items.forEach(function (it) {
      var ev = it.ev;
      var cat = categoryById(ev.category);
      var dt = parseISO(it.date);
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dday';

      var badge = document.createElement('span');
      badge.className = 'dday__badge' + (it.diff === 0 ? ' is-today' : it.diff <= 7 ? ' is-soon' : '');
      badge.textContent = it.diff === 0 ? 'D-DAY' : 'D-' + it.diff;
      btn.appendChild(badge);

      var body = document.createElement('div');
      body.className = 'dday__body';

      var title = document.createElement('div');
      title.className = 'dday__title';
      title.textContent = cat.emoji + ' ' + ev.title;
      body.appendChild(title);

      var meta = document.createElement('div');
      meta.className = 'dday__meta';
      var when = document.createElement('span');
      when.textContent = (dt.getMonth() + 1) + '.' + dt.getDate() + ' (' + WEEKDAYS[dt.getDay()] + ')';
      meta.appendChild(when);
      if (ev.time) {
        var t = document.createElement('span');
        t.textContent = ev.time;
        meta.appendChild(t);
      }
      var lunarText = lunarTextFor(ev, dt.getFullYear());
      if (lunarText) {
        var l = document.createElement('span');
        l.className = 'event__lunar';
        l.textContent = lunarText;
        meta.appendChild(l);
      }
      var names = (ev.members || []).map(function (id) {
        var mb = memberById(id);
        return mb ? mb.name : '';
      }).filter(Boolean);
      if (names.length) {
        var n = document.createElement('span');
        n.textContent = names.length > 3 ? names.slice(0, 3).join('·') + ' 외 ' + (names.length - 3) : names.join('·');
        meta.appendChild(n);
      }
      body.appendChild(meta);
      btn.appendChild(body);

      btn.addEventListener('click', function () { selectDate(it.date, true); });
      li.appendChild(btn);
      el.ddayList.appendChild(li);
    });
  }

  /* ---------------- 모달 ---------------- */
  function openModal(ev, presetDate) {
    state.editingId = ev ? ev.id : null;
    el.modalTitle.textContent = ev ? '일정 수정' : '일정 추가';
    el.deleteBtn.hidden = !ev;
    el.formError.hidden = true;

    el.fTitle.value = ev ? ev.title : '';
    el.fDate.value = ev ? ev.date : (presetDate || state.selected);
    el.fMemo.value = ev ? (ev.memo || '') : '';

    if (ev && ev.time) {
      el.fAllDay.checked = false;
      el.fTime.value = ev.time;
    } else {
      el.fAllDay.checked = true;
      el.fTime.value = '18:00';
    }
    syncTimeField();

    var memberIds = ev ? (ev.members || []) : [];
    el.fMembers.innerHTML = '';
    MEMBERS.forEach(function (mb) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick' + (memberIds.indexOf(mb.id) !== -1 ? ' is-on' : '');
      b.setAttribute('data-id', mb.id);
      b.style.setProperty('--c', mb.color);
      b.style.setProperty('--bgc', mb.bg);
      b.style.setProperty('--fgc', mb.color);
      var i = document.createElement('i');
      b.appendChild(i);
      b.appendChild(document.createTextNode(mb.name));
      b.addEventListener('click', function () { b.classList.toggle('is-on'); });
      el.fMembers.appendChild(b);
    });

    var catId = ev ? ev.category : 'etc';
    el.fCategories.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick pick--cat' + (cat.id === catId ? ' is-on' : '');
      b.setAttribute('data-id', cat.id);
      b.style.setProperty('--c', cat.color);
      b.style.setProperty('--bgc', cat.color + '1f');
      b.style.setProperty('--fgc', cat.color);
      b.textContent = cat.emoji + ' ' + cat.label;
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(el.fCategories.children, function (child) {
          child.classList.remove('is-on');
        });
        b.classList.add('is-on');
      });
      el.fCategories.appendChild(b);
    });

    setRepeat(ev ? ev.repeat : 'none');
    updateDateHint();

    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
    state.editingId = null;
  }

  function syncTimeField() {
    el.fTime.disabled = el.fAllDay.checked;
  }

  function setRepeat(value) {
    state.repeat = value || 'none';
    Array.prototype.forEach.call(el.fRepeat.children, function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-repeat') === state.repeat);
    });
    updateRepeatHint();
  }

  function currentCategory() {
    var on = el.fCategories.querySelector('.pick.is-on');
    return on ? on.getAttribute('data-id') : 'etc';
  }

  function currentMembers() {
    return Array.prototype.map.call(el.fMembers.querySelectorAll('.pick.is-on'), function (b) {
      return b.getAttribute('data-id');
    });
  }

  function updateDateHint() {
    var val = el.fDate.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      el.dateLunarHint.textContent = '';
      updateRepeatHint();
      return;
    }
    var p = val.split('-').map(Number);
    var lunar = L.toLunar(p[0], p[1], p[2]);
    var holiday = L.holidayName(p[0], p[1], p[2]);
    var parts = [];
    if (lunar) parts.push(L.lunarLabel(lunar) + (lunar.leap ? ' (윤달)' : ''));
    else parts.push('음력 변환 범위(2022~2040) 밖이에요');
    if (holiday) parts.push('🎉 ' + holiday);
    el.dateLunarHint.textContent = parts.join(' · ');
    updateRepeatHint();
  }

  function updateRepeatHint() {
    if (state.repeat === 'yearly-lunar') {
      var val = el.fDate.value;
      var p = val && /^\d{4}-\d{2}-\d{2}$/.test(val) ? val.split('-').map(Number) : null;
      var lunar = p ? L.toLunar(p[0], p[1], p[2]) : null;
      if (lunar) {
        var sol = L.toSolar(p[0], lunar.month, lunar.day, false);
        el.repeatHint.textContent = '음력 ' + (lunar.leap ? '윤' : '') + lunar.month + '월 ' + lunar.day + '일로 저장돼요. 해마다 그 해의 양력 날짜로 자동 계산해요 (예: ' + p[0] + '년 → ' + (sol ? sol.m + '월 ' + sol.d + '일' : '계산 불가') + ').' + (lunar.leap ? ' 윤달이 없는 해에는 같은 달의 같은 날로 계산해요.' : '');
      } else {
        el.repeatHint.textContent = '선택한 날짜의 음력을 계산할 수 없어요. 2022~2040년 사이 날짜를 골라 주세요.';
      }
    } else if (state.repeat === 'yearly-solar') {
      el.repeatHint.textContent = '같은 양력 월·일로 매년 반복돼요.';
    } else {
      el.repeatHint.textContent = '반복하지 않아요.';
    }
  }

  function showFormError(msg) {
    el.formError.textContent = msg;
    el.formError.hidden = false;
  }

  function saveEvent() {
    var title = el.fTitle.value.trim();
    var date = el.fDate.value;
    if (!title) {
      showFormError('제목을 입력해 주세요.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      showFormError('날짜를 선택해 주세요.');
      return;
    }
    var memberIds = currentMembers();
    if (!memberIds.length) {
      showFormError('담당 가족을 한 명 이상 선택해 주세요.');
      return;
    }

    var lunar = null;
    if (state.repeat === 'yearly-lunar') {
      var p = date.split('-').map(Number);
      var l = L.toLunar(p[0], p[1], p[2]);
      if (!l) {
        showFormError('이 날짜의 음력을 계산할 수 없어요. 2022~2040년 사이 날짜를 골라 주세요.');
        return;
      }
      lunar = { month: l.month, day: l.day, leap: !!l.leap };
    }

    var time = el.fAllDay.checked ? null : (el.fTime.value || null);
    var payload = {
      title: title,
      date: date,
      time: time,
      members: memberIds,
      category: currentCategory(),
      memo: el.fMemo.value.trim(),
      repeat: state.repeat,
      lunar: lunar
    };

    if (state.editingId) {
      var idx = -1;
      for (var i = 0; i < events.length; i++) if (events[i].id === state.editingId) idx = i;
      if (idx >= 0) events[idx] = Object.assign({}, events[idx], payload);
    } else {
      payload.id = uid();
      events.push(payload);
    }

    var saved = persist();
    state.selected = date;
    var dt = parseISO(date);
    state.year = dt.getFullYear();
    state.month = dt.getMonth();
    closeModal();
    renderAll();
    if (!saved) {
      window.alert('이 브라우저에 저장하지 못했어요. 저장 공간을 확인해 주세요.');
    }
  }

  function deleteEvent() {
    if (!state.editingId) return;
    var target = null;
    for (var i = 0; i < events.length; i++) if (events[i].id === state.editingId) target = events[i];
    if (!target) return;
    if (!window.confirm('"' + target.title + '" 일정을 삭제할까요?')) return;
    events = events.filter(function (ev) { return ev.id !== state.editingId; });
    persist();
    closeModal();
    renderAll();
  }

  function resetData() {
    if (!window.confirm('테스트 데이터를 초기화할까요?\n저장된 일정이 모두 지워지고 샘플 일정으로 돌아갑니다.')) return;
    events = seedSamples();
    persist();
    var today = new Date();
    state.year = today.getFullYear();
    state.month = today.getMonth();
    state.selected = todayISO();
    state.member = 'all';
    renderAll();
  }

  /* ---------------- PWA ---------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () { /* 오프라인 캐시는 없어도 동작 */ });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    registerSW();
  });

  window.FamilyCalendar = {
    get events() { return events; },
    occurrenceForYear: occurrenceForYear,
    eventsOn: eventsOn,
    seedSamples: seedSamples
  };
})();
