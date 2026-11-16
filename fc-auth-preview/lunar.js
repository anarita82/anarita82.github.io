/*
 * 우리 가족 달력 — 한국 음력/양력 변환 + 공휴일
 * 음력 데이터: 한국천문연구원(KARI) 기준 음력 데이터(2022~2040년)를 사용합니다.
 *   비트 구성: [17..25] 그 해 총일수, [16] 윤달 크기(1=30일), [15..12] 윤달 번호,
 *              [11..0] 1~12월 크기(1=30일, 0=29일)
 */
(function (global) {
  'use strict';

  var DATA = {
    2022: 0x82c60ad5, 2023: 0x830026b5, 2024: 0xc2c404b6, 2025: 0x83006a6e,
    2026: 0x82c60a57, 2027: 0x82c40527, 2028: 0xc2fe56a6, 2029: 0x82c60d93,
    2030: 0x82c405aa, 2031: 0x83003b6a, 2032: 0xc2c6096d, 2033: 0x8300b4af,
    2034: 0x82c404ae, 2035: 0x82c40a4d, 2036: 0xc3016d0d, 2037: 0x82c40d25,
    2038: 0x82c40d52, 2039: 0x83005dd4, 2040: 0xc2c60b6a
  };

  var MIN_YEAR = 2022;
  var MAX_YEAR = 2040;
  var ANCHOR = Date.UTC(2023, 0, 22); // 음력 2023-01-01 = 양력 2023-01-22
  var DAY = 86400000;

  var monthCache = {};
  var holidayCache = {};

  function months(year) {
    if (monthCache[year]) return monthCache[year];
    var v = DATA[year];
    if (v === undefined) return null;
    var leapMonth = (v >> 12) & 0xF;
    var leapBig = (v >> 16) & 1;
    var list = [];
    for (var m = 1; m <= 12; m++) {
      list.push({ month: m, leap: false, days: ((v >> (12 - m)) & 1) ? 30 : 29 });
      if (leapMonth === m) list.push({ month: m, leap: true, days: leapBig ? 30 : 29 });
    }
    monthCache[year] = list;
    return list;
  }

  function yearDays(year) {
    var list = months(year);
    if (!list) return 0;
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i].days;
    return total;
  }

  function leapMonthOf(year) {
    var v = DATA[year];
    if (v === undefined) return 0;
    return (v >> 12) & 0xF;
  }

  /* 음력 2023-01-01로부터의 일수 (음수 가능) */
  function lunarIndex(year, month, day, isLeap) {
    if (!DATA[year]) return null;
    var index = 0;
    var y;
    if (year >= 2023) {
      for (y = 2023; y < year; y++) index += yearDays(y);
    } else {
      for (y = year; y < 2023; y++) index -= yearDays(y);
    }
    var list = months(year);
    for (var i = 0; i < list.length; i++) {
      var mo = list[i];
      if (mo.month === month && mo.leap === !!isLeap) {
        if (day < 1 || day > mo.days) return null;
        return index + day - 1;
      }
      index += mo.days;
    }
    return null;
  }

  /* 음력 → 양력. {y, m, d} 또는 null */
  function toSolar(year, month, day, isLeap) {
    if (year < MIN_YEAR || year > MAX_YEAR) return null;
    var index = lunarIndex(year, month, day, !!isLeap);
    if (index === null) return null;
    var t = new Date(ANCHOR + index * DAY);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  /* 양력 → 음력. {year, month, day, leap} 또는 null */
  function toLunar(sy, sm, sd) {
    if (sy < MIN_YEAR || sy > MAX_YEAR + 1) return null;
    var index = Math.round((Date.UTC(sy, sm - 1, sd) - ANCHOR) / DAY);
    var lunarYear = null;
    var start = 0;
    for (var y = MIN_YEAR; y <= MAX_YEAR; y++) {
      var s = lunarIndex(y, 1, 1, false);
      if (s === null) continue;
      if (index >= s && index < s + yearDays(y)) { lunarYear = y; start = s; break; }
    }
    if (lunarYear === null) return null;
    var rest = index - start;
    var list = months(lunarYear);
    for (var i = 0; i < list.length; i++) {
      var mo = list[i];
      if (rest < mo.days) return { year: lunarYear, month: mo.month, day: rest + 1, leap: mo.leap };
      rest -= mo.days;
    }
    return null;
  }

  /* "음력 10/12" / "음력 윤6/1" */
  function lunarLabel(lunar) {
    if (!lunar) return '';
    return '음력 ' + (lunar.leap ? '윤' : '') + lunar.month + '/' + lunar.day;
  }

  /* ---------------- 공휴일 ---------------- */
  var FIXED = [
    { md: '01-01', name: '신정', sub: false },
    { md: '03-01', name: '삼일절', sub: true },
    { md: '05-05', name: '어린이날', sub: true },
    { md: '06-06', name: '현충일', sub: false },
    { md: '08-15', name: '광복절', sub: true },
    { md: '10-03', name: '개천절', sub: true },
    { md: '10-09', name: '한글날', sub: true },
    { md: '12-25', name: '성탄절', sub: true }
  ];

  /* 법정 공휴일이 아닌 지정 공휴일(확실한 것만) */
  var EXTRA = {
    '2026-06-03': '지방선거일'
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function parseISO(iso) {
    var p = iso.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function shiftISO(iso, n) {
    var d = parseISO(iso);
    return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate() + n);
  }
  function weekdayOf(iso) { return parseISO(iso).getDay(); }

  function holidaysFor(year) {
    if (holidayCache[year]) return holidayCache[year];
    var map = {};
    var order = [];
    var i;

    function add(iso, name) {
      if (map[iso]) return false;
      map[iso] = name;
      order.push(iso);
      return true;
    }

    for (i = 0; i < FIXED.length; i++) add(year + '-' + FIXED[i].md, FIXED[i].name);
    for (var key in EXTRA) {
      if (key.indexOf(year + '-') === 0) add(key, EXTRA[key]);
    }

    /* 음력 명절: 설날·추석은 3일 연휴, 부처님오신날 */
    var groups = [];
    var seol = toSolar(year, 1, 1, false);
    if (seol) {
      var seol3 = [];
      for (i = -1; i <= 1; i++) {
        var d1 = shiftISO(isoOf(seol.y, seol.m, seol.d), i);
        add(d1, i === 0 ? '설날' : '설 연휴');
        seol3.push(d1);
      }
      groups.push(seol3);
    }
    var chuseok = toSolar(year, 8, 15, false);
    if (chuseok) {
      var chu3 = [];
      for (i = -1; i <= 1; i++) {
        var d2 = shiftISO(isoOf(chuseok.y, chuseok.m, chuseok.d), i);
        add(d2, i === 0 ? '추석' : '추석 연휴');
        chu3.push(d2);
      }
      groups.push(chu3);
    }
    var buddha = toSolar(year, 4, 8, false);
    var buddhaISO = null;
    if (buddha) {
      buddhaISO = isoOf(buddha.y, buddha.m, buddha.d);
      add(buddhaISO, '부처님오신날');
    }

    /* 대체공휴일: 토·일과 겹치는 공휴일 → 다음 비공휴일 평일 */
    function nextFreeWeekday(fromISO) {
      var iso = shiftISO(fromISO, 1);
      for (var guard = 0; guard < 20; guard++) {
        var wd = weekdayOf(iso);
        if (wd >= 1 && wd <= 5 && !map[iso]) return iso;
        iso = shiftISO(iso, 1);
      }
      return null;
    }

    var subCandidates = [];
    for (i = 0; i < FIXED.length; i++) {
      if (FIXED[i].sub) subCandidates.push({ iso: year + '-' + FIXED[i].md });
    }
    if (buddhaISO) subCandidates.push({ iso: buddhaISO });
    subCandidates.sort(function (a, b) { return a.iso < b.iso ? -1 : 1; });
    for (i = 0; i < subCandidates.length; i++) {
      var iso0 = subCandidates[i].iso;
      var wd0 = weekdayOf(iso0);
      if (wd0 === 0 || wd0 === 6) {
        var alt = nextFreeWeekday(iso0);
        if (alt) add(alt, '대체공휴일');
      }
    }
    /* 설·추석 연휴가 일요일과 겹치면 연휴 다음 첫 평일이 대체공휴일 */
    for (i = 0; i < groups.length; i++) {
      var group = groups[i];
      var hasSunday = false;
      for (var j = 0; j < group.length; j++) {
        if (weekdayOf(group[j]) === 0) hasSunday = true;
      }
      if (hasSunday) {
        var alt2 = nextFreeWeekday(group[group.length - 1]);
        if (alt2) add(alt2, '대체공휴일');
      }
    }

    holidayCache[year] = map;
    return map;
  }

  function holidayName(y, m, d) {
    var map = holidaysFor(y);
    return map[isoOf(y, m, d)] || null;
  }

  global.FamilyLunar = {
    MIN_YEAR: MIN_YEAR,
    MAX_YEAR: MAX_YEAR,
    months: months,
    yearDays: yearDays,
    leapMonthOf: leapMonthOf,
    toSolar: toSolar,
    toLunar: toLunar,
    lunarLabel: lunarLabel,
    holidaysFor: holidaysFor,
    holidayName: holidayName,
    isoOf: isoOf,
    parseISO: parseISO,
    shiftISO: shiftISO
  };
})(window);
