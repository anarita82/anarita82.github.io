/*!
 * 생활 계산기 — 계산 코어 (순수 함수)
 * 브라우저에서는 window.CalcCore, Node/테스트에서는 module.exports 로 노출됩니다.
 * 모든 계산은 입력값만으로 수행하며 서버로 전송하지 않습니다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CalcCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 공통 숫자·날짜 도우미 ---------------- */

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v === null || v === undefined) return 0;
    var s = String(v).replace(/[,\s₩원%]/g, '');
    if (s === '' || s === '-' || s === '.') return 0;
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }

  function round(n, d) {
    var m = Math.pow(10, d || 0);
    return Math.round((n + Number.EPSILON) * m) / m;
  }

  /** 10원 미만 절사 (보험료 고지 방식) */
  function floor10(n) {
    return Math.floor(n / 10) * 10;
  }

  function comma(n, d) {
    var v = round(num(n), d || 0);
    var neg = v < 0;
    var parts = Math.abs(v).toFixed(d || 0).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }

  function won(n) {
    return comma(Math.round(num(n))) + '원';
  }

  /* ---------------- 1. 디데이 ---------------- */

  function parseDate(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s).trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }

  function utc(p) { return Date.UTC(p.y, p.m - 1, p.d); }
  function fromUTC(t) {
    var dt = new Date(t);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(p) { return p ? p.y + '-' + pad2(p.m) + '-' + pad2(p.d) : ''; }
  function fmtDateKo(p) { return p ? p.y + '년 ' + p.m + '월 ' + p.d + '일' : ''; }

  function dayDiff(a, b) {
    var pa = typeof a === 'string' ? parseDate(a) : a;
    var pb = typeof b === 'string' ? parseDate(b) : b;
    if (!pa || !pb) return null;
    return Math.round((utc(pb) - utc(pa)) / 86400000);
  }

  function addDays(p, n) {
    var pp = typeof p === 'string' ? parseDate(p) : p;
    if (!pp) return null;
    return fromUTC(utc(pp) + n * 86400000);
  }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function addMonths(p, n) {
    var pp = typeof p === 'string' ? parseDate(p) : p;
    if (!pp) return null;
    var total = (pp.y * 12 + (pp.m - 1)) + n;
    var y = Math.floor(total / 12);
    var m = total - y * 12 + 1;
    return { y: y, m: m, d: Math.min(pp.d, daysInMonth(y, m)) };
  }

  function addYears(p, n) {
    var pp = typeof p === 'string' ? parseDate(p) : p;
    if (!pp) return null;
    var y = pp.y + n;
    return { y: y, m: pp.m, d: Math.min(pp.d, daysInMonth(y, pp.m)) };
  }

  function weekdayKo(p) {
    var pp = typeof p === 'string' ? parseDate(p) : p;
    if (!pp) return '';
    return ['일', '월', '화', '수', '목', '금', '토'][new Date(utc(pp)).getUTCDay()];
  }

  /**
   * 기준일 → 목표일 디데이.
   * @returns {{diff:number, dayNumber:number, label:string, dday:string}}
   */
  function dday(baseStr, targetStr) {
    var diff = dayDiff(baseStr, targetStr);
    if (diff === null) return null;
    var dday;
    if (diff === 0) dday = 'D-DAY';
    else if (diff > 0) dday = 'D-' + diff;
    else dday = 'D+' + Math.abs(diff);
    return {
      diff: diff,
      dayNumber: diff + 1, // 당일을 1일째로 볼 때
      label: diff === 0 ? '당일' : (diff > 0 ? diff + '일 남음' : Math.abs(diff) + '일 지남'),
      dday: dday
    };
  }

  /** 시작일 기준 기념일(당일 포함 100일째 = 시작일 + 99일) */
  function anniversaries(startStr) {
    var s = parseDate(startStr);
    if (!s) return null;
    return {
      d100: addDays(s, 99),
      d200: addDays(s, 199),
      d365: addDays(s, 364),
      d1000: addDays(s, 999),
      y1: addYears(s, 1)
    };
  }

  /* ---------------- 2. 퍼센트 ---------------- */

  function percentOf(a, b) { return num(a) * num(b) / 100; }
  function percentRatio(a, b) { return num(b) === 0 ? null : (num(a) / num(b)) * 100; }
  function percentChange(from, to) {
    var f = num(from);
    if (f === 0) return null;
    return ((num(to) - f) / f) * 100;
  }
  function discount(price, rate) {
    var p = num(price), r = num(rate);
    var off = p * r / 100;
    return { price: p, rate: r, off: off, final: p - off };
  }
  function discountRate(original, sale) {
    var o = num(original);
    if (o === 0) return null;
    return ((o - num(sale)) / o) * 100;
  }

  /* ---------------- 3. 글자 수 ---------------- */

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }

  /** EUC-KR 바이트 추정: ASCII 1, 한글·한자·전각 2, 그 외(이모지 등) 3 */
  function euckrBytes(str) {
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c >= 0xd800 && c <= 0xdbff) { bytes += 3; i++; }
      else if (c >= 0xac00 && c <= 0xd7a3) bytes += 2;
      else bytes += 2;
    }
    return bytes;
  }

  function textStats(text) {
    var t = String(text == null ? '' : text);
    var lines = t === '' ? 0 : t.split(/\r\n|\r|\n/).length;
    var words = t.trim() === '' ? 0 : t.trim().split(/\s+/).filter(Boolean).length;
    var noSpace = t.replace(/\s/g, '');
    return {
      chars: Array.from(t).length,
      charsNoSpace: Array.from(noSpace).length,
      charsNoNewline: Array.from(t.replace(/[\r\n]/g, '')).length,
      words: words,
      lines: lines,
      bytesUtf8: utf8Bytes(t),
      bytesEuckr: euckrBytes(t),
      manuscript: Math.ceil(Array.from(noSpace).length / 200),
      manuscriptWithSpace: Math.ceil(Array.from(t).length / 200)
    };
  }

  /* ---------------- 4. 만나이 ---------------- */

  function age(birthStr, refStr) {
    var b = parseDate(birthStr);
    var r = parseDate(refStr) || parseDate(fmtDate(new Date()));
    if (!b || !r) return null;
    if (utc(b) > utc(r)) return null;
    var full = r.y - b.y;
    var passed = (r.m > b.m) || (r.m === b.m && r.d >= b.d);
    if (!passed) full -= 1;
    var next = { y: r.y, m: b.m, d: Math.min(b.d, daysInMonth(r.y, b.m)) };
    if (utc(next) < utc(r)) next = { y: r.y + 1, m: b.m, d: Math.min(b.d, daysInMonth(r.y + 1, b.m)) };
    // 2월 29일생: 다음 생일은 3월 1일이 아니라 2월 28일로 처리(위 daysInMonth 클램프)
    var daysToBirthday = dayDiff(r, next);
    return {
      man: full,
      year: r.y - b.y,
      counting: r.y - b.y + 1,
      zodiac: zodiac(b.y),
      nextBirthday: next,
      daysToBirthday: daysToBirthday,
      birthdayToday: r.m === b.m && r.d === b.d,
      weekday: weekdayKo(b)
    };
  }

  var ZODIAC = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
  function zodiac(year) {
    return ZODIAC[((num(year) - 4) % 12 + 12) % 12] + '띠';
  }

  /* ---------------- 5. 연봉 실수령액 (2026) ---------------- */

  var RATES_2026 = {
    pension: 0.0475,      // 국민연금 근로자 4.75% (총 9.5%)
    health: 0.03595,      // 건강보험 근로자 3.595% (총 7.19%)
    ltcOnHealth: 0.1314,  // 장기요양 = 건강보험료 × 13.14% (근로자 부담분 기준)
    employment: 0.009,    // 고용보험(실업급여) 근로자 0.9%
    pensionMin: 410000,   // 기준소득월액 하한 (2026.7~2027.6)
    pensionMax: 6590000,  // 기준소득월액 상한
    minWage: 10320,       // 2026 최저임금
    mealNonTax: 200000    // 식대 비과세 한도(월)
  };

  function insurance2026(monthlyTaxable) {
    var base = Math.max(0, num(monthlyTaxable));
    var pBase = Math.min(Math.max(base, RATES_2026.pensionMin), RATES_2026.pensionMax);
    var pension = floor10(pBase * RATES_2026.pension);
    var health = floor10(base * RATES_2026.health);
    var ltc = floor10(health * RATES_2026.ltcOnHealth);
    var emp = floor10(base * RATES_2026.employment);
    return {
      pension: pension,
      health: health,
      ltc: ltc,
      employment: emp,
      total: pension + health + ltc + emp,
      pensionBase: pBase
    };
  }

  var TAX_BRACKETS = [
    { upTo: 14000000, rate: 0.06, sub: 0 },
    { upTo: 50000000, rate: 0.15, sub: 1260000 },
    { upTo: 88000000, rate: 0.24, sub: 5760000 },
    { upTo: 150000000, rate: 0.35, sub: 15440000 },
    { upTo: 300000000, rate: 0.38, sub: 19940000 },
    { upTo: 500000000, rate: 0.40, sub: 25940000 },
    { upTo: 1000000000, rate: 0.42, sub: 35940000 },
    { upTo: Infinity, rate: 0.45, sub: 65940000 }
  ];

  function earnedIncomeDeduction(gross) {
    var g = Math.max(0, num(gross));
    if (g <= 5000000) return Math.min(g * 0.7, 3500000);
    if (g <= 15000000) return 3500000 + (g - 5000000) * 0.4;
    if (g <= 45000000) return 7500000 + (g - 15000000) * 0.15;
    if (g <= 100000000) return 12000000 + (g - 45000000) * 0.05;
    return 14750000 + (g - 100000000) * 0.02;
  }

  function earnedTaxCreditLimit(gross) {
    var g = num(gross);
    if (g <= 33000000) return 740000;
    if (g <= 70000000) return Math.max(660000, 740000 - (g - 33000000) * 0.008);
    if (g <= 120000000) return Math.max(500000, 660000 - (g - 70000000) * 0.5);
    return Math.max(200000, 500000 - (g - 120000000) * 0.5);
  }

  function earnedTaxCredit(tax) {
    var t = num(tax);
    if (t <= 1300000) return t * 0.55;
    return 715000 + (t - 1300000) * 0.3;
  }

  function incomeTaxAnnual(taxableBase) {
    var b = Math.max(0, num(taxableBase));
    for (var i = 0; i < TAX_BRACKETS.length; i++) {
      var br = TAX_BRACKETS[i];
      if (b <= br.upTo) return Math.max(0, b * br.rate - br.sub);
    }
    return 0;
  }

  /**
   * 연봉 → 월 실수령액 추정
   * @param {object} o {annual, monthlyNonTax, dependents}
   */
  function salaryNet(o) {
    o = o || {};
    var annual = Math.max(0, num(o.annual));
    var nonTax = Math.min(Math.max(0, num(o.monthlyNonTax)), RATES_2026.mealNonTax * 2);
    var dependents = Math.max(1, Math.round(num(o.dependents) || 1));
    var monthlyGross = annual / 12;
    var monthlyTaxable = Math.max(0, monthlyGross - nonTax);
    var ins = insurance2026(monthlyTaxable);

    var annualTaxable = monthlyTaxable * 12;
    var earnDed = earnedIncomeDeduction(annualTaxable);
    var earnIncome = Math.max(0, annualTaxable - earnDed);
    var basicDed = 1500000 * dependents;
    var insDed = ins.total * 12;
    var taxBase = Math.max(0, earnIncome - basicDed - insDed);
    var calculated = incomeTaxAnnual(taxBase);
    var credit = Math.min(earnedTaxCredit(calculated), earnedTaxCreditLimit(annualTaxable));
    var incomeTaxYear = Math.max(0, calculated - credit);
    var localTaxYear = incomeTaxYear * 0.1;

    var incomeTaxMonth = Math.round(incomeTaxYear / 12);
    var localTaxMonth = Math.round(localTaxYear / 12);
    var totalDeduction = ins.total + incomeTaxMonth + localTaxMonth;
    var net = monthlyGross - totalDeduction;

    return {
      annual: annual,
      monthlyGross: monthlyGross,
      monthlyNonTax: nonTax,
      monthlyTaxable: monthlyTaxable,
      dependents: dependents,
      insurance: ins,
      taxBase: taxBase,
      calculatedTax: calculated,
      taxCredit: credit,
      incomeTaxYear: incomeTaxYear,
      localTaxYear: localTaxYear,
      incomeTaxMonth: incomeTaxMonth,
      localTaxMonth: localTaxMonth,
      totalDeduction: totalDeduction,
      net: net,
      annualNet: net * 12,
      netRate: monthlyGross > 0 ? (net / monthlyGross) * 100 : 0,
      employer: {
        pension: ins.pension,
        health: ins.health,
        ltc: ins.ltc,
        employment: Math.round(ins.employment + monthlyTaxable * 0.0025), // 실업급여 0.9% + 고용안정 0.25%(150인 미만)
        total: ins.pension + ins.health + ins.ltc + Math.round(ins.employment + monthlyTaxable * 0.0025)
      }
    };
  }

  /* ---------------- 6. 시급·주휴수당 ---------------- */

  function hourlyPay(o) {
    o = o || {};
    var wage = Math.max(0, num(o.hourly));
    var hoursPerDay = Math.max(0, num(o.hoursPerDay));
    var daysPerWeek = Math.max(0, num(o.daysPerWeek));
    var weekHours = hoursPerDay * daysPerWeek;
    var eligible = weekHours >= 15;
    var holidayHours = 0;
    if (eligible) holidayHours = weekHours >= 40 ? 8 : 8 * (weekHours / 40);
    var holidayPay = wage * holidayHours;
    var weekWorkPay = wage * weekHours;
    var weekPay = weekWorkPay + holidayPay;
    var WEEKS = 365 / 7 / 12; // 4.3452주
    // 급여 실무와 같이 월 소정근로시간을 시간 단위로 반올림한다 (주 40시간 → 209시간)
    var monthHours = Math.round((weekHours + holidayHours) * WEEKS);
    var monthPay = monthHours * wage;
    return {
      hourly: wage,
      weekHours: weekHours,
      eligible: eligible,
      holidayHours: holidayHours,
      holidayPay: holidayPay,
      weekWorkPay: weekWorkPay,
      weekPay: weekPay,
      monthPay: monthPay,
      monthHours: monthHours,
      yearPay: monthPay * 12,
      dailyPay: wage * hoursPerDay,
      isBelowMin: wage > 0 && wage < RATES_2026.minWage,
      minWage: RATES_2026.minWage,
      minMonthPay: RATES_2026.minWage * 209
    };
  }

  /* ---------------- 7. 퇴직금 ---------------- */

  function severance(o) {
    o = o || {};
    var start = parseDate(o.start);
    var end = parseDate(o.end);
    if (!start || !end || utc(end) < utc(start)) return null;
    var days = dayDiff(start, end) + 1; // 재직일수(입·퇴사일 포함)
    var start3 = addDays(addMonths(end, -3), 1);
    var days3m = dayDiff(start3, end) + 1;
    var monthly = Math.max(0, num(o.monthlyWage));
    var bonus = Math.max(0, num(o.bonus3m)); // 최근 3개월 상여·연차수당 등
    var wage3m = monthly * 3 + bonus;
    var dailyAvg = days3m > 0 ? wage3m / days3m : 0;
    var amount = dailyAvg * 30 * (days / 365);
    return {
      days: days,
      years: days / 365,
      start3m: start3,
      days3m: days3m,
      wage3m: wage3m,
      dailyAvg: dailyAvg,
      amount: amount,
      eligible: days >= 365,
      monthlyEquivalent: dailyAvg * 30
    };
  }

  /* ---------------- 8. 대출 이자 ---------------- */

  function loanEqualPayment(o) {
    var P = Math.max(0, num(o.principal));
    var annualRate = Math.max(0, num(o.rate));
    var n = Math.max(1, Math.round(num(o.months)));
    var i = annualRate / 100 / 12;
    var pay = i === 0 ? P / n : P * i / (1 - Math.pow(1 + i, -n));
    pay = Math.round(pay);
    var balance = P, totalInterest = 0, first = null, last = null, rows = [];
    for (var k = 1; k <= n; k++) {
      var interest = Math.round(balance * i);
      var principal = k === n ? balance : Math.min(pay - interest, balance);
      var payment = principal + interest;
      if (k === 1) first = { interest: interest, principal: principal, payment: payment };
      last = { interest: interest, principal: principal, payment: payment };
      totalInterest += interest;
      balance -= principal;
      if (rows.length < 12 || k === n) rows.push({ no: k, payment: payment, interest: interest, principal: principal, balance: Math.max(0, balance) });
    }
    return {
      method: 'equal-payment',
      monthlyPayment: pay,
      firstPayment: first,
      lastPayment: last,
      totalInterest: totalInterest,
      totalPayment: P + totalInterest,
      rows: rows,
      months: n
    };
  }

  function loanEqualPrincipal(o) {
    var P = Math.max(0, num(o.principal));
    var annualRate = Math.max(0, num(o.rate));
    var n = Math.max(1, Math.round(num(o.months)));
    var i = annualRate / 100 / 12;
    var principalPart = P / n;
    var balance = P, totalInterest = 0, first = null, last = null, rows = [];
    for (var k = 1; k <= n; k++) {
      var interest = Math.round(balance * i);
      var principal = k === n ? balance : principalPart;
      var payment = Math.round(principal) + interest;
      if (k === 1) first = { interest: interest, principal: Math.round(principal), payment: payment };
      last = { interest: interest, principal: Math.round(principal), payment: payment };
      totalInterest += interest;
      balance -= principal;
      if (rows.length < 12 || k === n) rows.push({ no: k, payment: payment, interest: interest, principal: Math.round(principal), balance: Math.max(0, balance) });
    }
    return {
      method: 'equal-principal',
      monthlyPayment: first ? first.payment : 0,
      firstPayment: first,
      lastPayment: last,
      totalInterest: totalInterest,
      totalPayment: P + totalInterest,
      rows: rows,
      months: n
    };
  }

  function loanBullet(o) {
    var P = Math.max(0, num(o.principal));
    var annualRate = Math.max(0, num(o.rate));
    var n = Math.max(1, Math.round(num(o.months)));
    var i = annualRate / 100 / 12;
    var monthlyInterest = Math.round(P * i);
    var totalInterest = monthlyInterest * n;
    return {
      method: 'bullet',
      monthlyPayment: monthlyInterest,
      firstPayment: { interest: monthlyInterest, principal: 0, payment: monthlyInterest },
      lastPayment: { interest: monthlyInterest, principal: P, payment: P + monthlyInterest },
      totalInterest: totalInterest,
      totalPayment: P + totalInterest,
      rows: [],
      months: n
    };
  }

  function loanCompare(o) {
    return {
      equalPayment: loanEqualPayment(o),
      equalPrincipal: loanEqualPrincipal(o),
      bullet: loanBullet(o)
    };
  }

  /* ---------------- 9. 부가세 ---------------- */

  function vatFromSupply(supply, rate) {
    var s = Math.max(0, num(supply));
    var r = rate === undefined ? 10 : num(rate);
    var vat = Math.round(s * r / 100);
    return { supply: s, vat: vat, total: s + vat, rate: r };
  }

  function vatFromTotal(total, rate) {
    var t = Math.max(0, num(total));
    var r = rate === undefined ? 10 : num(rate);
    var supply = Math.round(t / (1 + r / 100));
    return { supply: supply, vat: t - supply, total: t, rate: r };
  }

  /* ---------------- 10. 평수 ---------------- */

  var SQM_PER_PYEONG = 400 / 121; // 3.3057851239...

  function sqmToPyeong(sqm) { return num(sqm) / SQM_PER_PYEONG; }
  function pyeongToSqm(pyeong) { return num(pyeong) * SQM_PER_PYEONG; }

  /* ---------------- 11. 물타기(평단가) ---------------- */

  function avgPrice(o) {
    o = o || {};
    var p1 = Math.max(0, num(o.price1)), q1 = Math.max(0, num(o.qty1));
    var p2 = Math.max(0, num(o.price2)), q2 = Math.max(0, num(o.qty2));
    var amount1 = p1 * q1, amount2 = p2 * q2;
    var qty = q1 + q2, amount = amount1 + amount2;
    var avg = qty > 0 ? amount / qty : 0;
    var target = Math.max(0, num(o.target));
    return {
      price1: p1, qty1: q1, amount1: amount1,
      price2: p2, qty2: q2, amount2: amount2,
      qty: qty, amount: amount, avg: avg,
      target: target,
      targetReturn: avg > 0 && target > 0 ? ((target - avg) / avg) * 100 : null,
      targetProfit: target > 0 ? (target - avg) * qty : null,
      breakEvenRate: p1 > 0 ? ((avg - p1) / p1) * 100 : null,
      /** 목표 평단가를 만들기 위해 필요한 추가 수량(현재가가 p2일 때) */
      qtyForTargetAvg: (function () {
        var t = Math.max(0, num(o.targetAvg));
        if (!(t > 0) || q1 === 0) return null;
        if (p2 >= t) return null; // 추가 매수로는 내릴 수 없음
        return (p1 - t) * q1 / (t - p2);
      })()
    };
  }

  return {
    num: num, round: round, floor10: floor10, comma: comma, won: won,
    parseDate: parseDate, fmtDate: fmtDate, fmtDateKo: fmtDateKo, dayDiff: dayDiff,
    addDays: addDays, addMonths: addMonths, addYears: addYears, weekdayKo: weekdayKo,
    dday: dday, anniversaries: anniversaries,
    percentOf: percentOf, percentRatio: percentRatio, percentChange: percentChange,
    discount: discount, discountRate: discountRate,
    textStats: textStats, utf8Bytes: utf8Bytes, euckrBytes: euckrBytes,
    age: age, zodiac: zodiac,
    RATES_2026: RATES_2026, insurance2026: insurance2026, salaryNet: salaryNet,
    earnedIncomeDeduction: earnedIncomeDeduction, incomeTaxAnnual: incomeTaxAnnual,
    hourlyPay: hourlyPay, severance: severance,
    loanEqualPayment: loanEqualPayment, loanEqualPrincipal: loanEqualPrincipal,
    loanBullet: loanBullet, loanCompare: loanCompare,
    vatFromSupply: vatFromSupply, vatFromTotal: vatFromTotal,
    SQM_PER_PYEONG: SQM_PER_PYEONG, sqmToPyeong: sqmToPyeong, pyeongToSqm: pyeongToSqm,
    avgPrice: avgPrice
  };
});
