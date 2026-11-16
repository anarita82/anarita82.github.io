/* 🎤 말로 입력 — 한국어 자연어 → 일정/근무 칸 채우기 (가족·매장 공용)
   - Web Speech API(SpeechRecognition / webkitSpeechRecognition, ko-KR)로 말을 글자로 받고
   - "내일 오후 3시 첫째 치과", "11월 27일부터 30일까지 오사카 가족여행" 같은 문장을 해석합니다.
   - 실명은 코드에 넣지 않습니다. 이름은 앱이 쓰는 이름(아빠·엄마·첫째…)이나 사용자가 추가한 이름만 씁니다.
*/
(function () {
  'use strict';

  var KOR_NUM = {
    '한': 1, '하나': 1, '일': 1, '두': 2, '둘': 2, '이': 2, '세': 3, '셋': 3, '삼': 3,
    '네': 4, '넷': 4, '사': 4, '다섯': 5, '오': 5, '여섯': 6, '육': 6, '륙': 6,
    '일곱': 7, '칠': 7, '여덟': 8, '팔': 8, '아홉': 9, '구': 9, '열': 10, '십': 10,
    '열한': 11, '십일': 11, '열두': 12, '십이': 12
  };
  var NUM_RE = '(\\d{1,2}|열한|열두|십일|십이|한|하나|일|두|둘|이|세|셋|삼|네|넷|사|다섯|오|여섯|육|륙|일곱|칠|여덟|팔|아홉|구|열|십)';
  var MER_RE = '(오전|오후|아침|점심|저녁|밤|낮|새벽)';

  var FILLERS = {
    '일정': 1, '등록': 1, '추가': 1, '좀': 1, '그': 1, '이': 1, '저': 1, '요': 1,
    '부터': 1, '까지': 1, '부터는': 1, '에서는': 1, '에게': 1, '하고': 1, '이랑': 1, '랑': 1,
    '은': 1, '는': 1, '이/가': 1, '을': 1, '를': 1, '에': 1, '서': 1, '도': 1, '와': 1, '과': 1,
    '오전': 1, '오후': 1, '아침': 1, '점심': 1, '저녁': 1, '밤': 1, '낮': 1, '새벽': 1,
    '시': 1, '분': 1, '반': 1, '때': 1, '쯤': 1, '음력': 1, '양력': 1, '요일': 1
  };

  var CATEGORY_WORDS = [
    { id: 'birthday', words: ['생일', '생신', '환갑', '돌잔치'] },
    { id: 'memorial', words: ['제사', '기제', '차례', '성묘'] },
    { id: 'school', words: ['학교', '학원', '시험', '체험학습', '학부모', '상담', '방학', '개학', '운동회', '수학여행', '현장학습', '입학', '졸업'] },
    { id: 'hospital', words: ['병원', '치과', '의원', '진료', '검진', '예방접종', '접종', '약국', '한의원', '안과', '이비인후과', '소아과', '피부과', '정형외과'] }
  ];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function isoOfDate(d) { return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function parseISO(s) {
    var p = String(s || '').split('-').map(Number);
    if (p.length !== 3 || isNaN(p[0])) return new Date();
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function numOf(s) {
    if (s == null) return null;
    var t = String(s).trim();
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    return KOR_NUM[t] == null ? null : KOR_NUM[t];
  }
  function addDays(base, n) {
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
    return d;
  }
  function validDate(y, m, d) {
    if (!y || !m || !d) return false;
    if (m < 1 || m > 12) return false;
    return d >= 1 && d <= daysInMonth(y, m);
  }

  /* 1~6시에 오전/오후 표시가 없으면 오후로 보는 생활어 기준 */
  function applyMer(h, mer) {
    if (h == null || isNaN(h)) return null;
    var hour = h;
    if (mer === '오후' || mer === '저녁' || mer === '밤' || mer === '낮') {
      if (hour < 12) hour += 12;
    } else if (mer === '오전' || mer === '아침' || mer === '새벽') {
      if (hour === 12) hour = 0;
    } else {
      if (hour >= 1 && hour <= 6) hour += 12;
    }
    if (hour === 24) hour = 0;
    return hour % 24;
  }
  function hhmm(h, m) {
    if (h == null) return '';
    return pad2(h) + ':' + pad2(m || 0);
  }

  /* ---------------- 해석 ---------------- */
  function parse(text, ctx) {
    ctx = ctx || {};
    var today = ctx.today ? parseISO(ctx.today) : new Date();
    var raw = String(text || '').replace(/\s+/g, ' ').trim();
    var work = ' ' + raw + ' ';

    var out = {
      transcript: raw,
      date: '',
      endDate: '',
      time: '',
      endTime: '',
      members: [],
      category: '',
      title: '',
      lunar: false,
      hasTime: false,
      hasRange: false,
      notes: []
    };
    if (!raw) return out;

    var lunarMonth = 0, lunarDay = 0;

    /* 음력 */
    if (/음력/.test(work)) {
      out.lunar = true;
      work = work.replace(/음력/g, ' ');
    }

    /* 요일 */
    var wdMatch = work.match(new RegExp('(이번\\s*주|다음\\s*주|담주|이번주|다음주|이번\\s*달|이번달)?\\s*([일월화수목금토])\\s*요일'));
    var weekdayDate = '';
    if (wdMatch) {
      var mapWd = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
      var nextWeek = /다음\s*주|다음주|담주/.test(wdMatch[1] || '');
      var delta = (mapWd[wdMatch[2]] - today.getDay() + 7) % 7;
      if (nextWeek) delta += 7;
      weekdayDate = isoOfDate(addDays(today, delta));
      work = work.replace(wdMatch[0], ' ');
    }

    /* 상대 날짜 */
    var relMap = { '오늘': 0, '금일': 0, '내일': 1, '명일': 1, '모레': 2, '글피': 3, '어제': -1, '어저께': -1 };
    var relDate = '';
    Object.keys(relMap).forEach(function (k) {
      var re = new RegExp('\\s' + k + '(?![가-힣])');
      if (re.test(work)) {
        relDate = isoOfDate(addDays(today, relMap[k]));
        work = work.replace(new RegExp(k, 'g'), ' ');
      }
    });

    /* ISO 범위 2026-11-27 ~ 2026-11-30 */
    var isoRange = work.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:부터|에서|~|∼|～|—|-)\s*(\d{4}-)?(\d{1,2})-(\d{1,2})(?:\s*까지)?/);
    var rangeStart = '', rangeEnd = '';

    /* 월·일 범위: 11월 27일부터 30일까지 / 27일~30일 / 11/27~11/30 */
    var mdRange = work.match(new RegExp('(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일\\s*(?:부터|에서|~|∼|～|—|-|부터는)\\s*(?:(\\d{1,2})\\s*월\\s*)?(\\d{1,2})\\s*일?(?:\\s*까지)?'));
    var dRange = !mdRange && work.match(/(\d{1,2})\s*일\s*(?:부터|에서|~|∼|～|—|-)\s*(\d{1,2})\s*일?(?:\s*까지)?/);
    var slashRange = !mdRange && !dRange && work.match(/(\d{1,2})\/(\d{1,2})\s*(?:부터|~|∼|～|—|-)\s*(\d{1,2})\/(\d{1,2})(?:\s*까지)?/);

    var y0 = today.getFullYear();

    if (isoRange) {
      var sy = parseInt(isoRange[1], 10), sm = parseInt(isoRange[2], 10), sd = parseInt(isoRange[3], 10);
      var ey = isoRange[4] ? parseInt(isoRange[4], 10) : sy;
      var em = parseInt(isoRange[5], 10), ed = parseInt(isoRange[6], 10);
      if (validDate(sy, sm, sd) && validDate(ey, em, ed)) {
        rangeStart = iso(sy, sm, sd);
        rangeEnd = iso(ey, em, ed);
      }
      work = work.replace(isoRange[0], ' ');
    } else if (mdRange) {
      var m1 = parseInt(mdRange[1], 10), d1 = parseInt(mdRange[2], 10);
      var m2 = mdRange[3] ? parseInt(mdRange[3], 10) : m1;
      var d2 = parseInt(mdRange[4], 10);
      var yearBase = out.lunar ? y0 : (m1 < today.getMonth() + 1 ? y0 + 1 : y0);
      if (validDate(yearBase, m1, d1)) rangeStart = iso(yearBase, m1, d1);
      var yearEnd = yearBase;
      if (m2 < (m1 || 1)) yearEnd += 1;
      if (validDate(yearEnd, m2, d2)) rangeEnd = iso(yearEnd, m2, d2);
      lunarMonth = m1; lunarDay = d1;
      work = work.replace(mdRange[0], ' ');
    } else if (dRange) {
      var dd1 = parseInt(dRange[1], 10), dd2 = parseInt(dRange[2], 10);
      var yy = y0, mm = today.getMonth() + 1;
      if (dd1 < today.getDate()) { mm += 1; if (mm > 12) { mm = 1; yy += 1; } }
      if (validDate(yy, mm, dd1)) rangeStart = iso(yy, mm, dd1);
      if (dd2 >= dd1 && validDate(yy, mm, dd2)) rangeEnd = iso(yy, mm, dd2);
      lunarDay = dd1;
      work = work.replace(dRange[0], ' ');
    } else if (slashRange) {
      var qm1 = parseInt(slashRange[1], 10), qd1 = parseInt(slashRange[2], 10);
      var qm2 = parseInt(slashRange[3], 10), qd2 = parseInt(slashRange[4], 10);
      var qy = qm1 < today.getMonth() + 1 ? y0 + 1 : y0;
      if (validDate(qy, qm1, qd1)) rangeStart = iso(qy, qm1, qd1);
      if (validDate(qy, qm2, qd2)) rangeEnd = iso(qy, qm2, qd2);
      work = work.replace(slashRange[0], ' ');
    }

    /* 단일 날짜: 2026년 11월 27일 / 11월 27일 / 11/27 / 27일 */
    if (!rangeStart) {
      var full = work.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
      var md = !full && work.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
      var slash = !full && !md && work.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/);
      var dayOnly = !full && !md && !slash && work.match(/(?:^|\s)(\d{1,2})\s*일(?:\s|$)/);
      if (full) {
        var fy = parseInt(full[1], 10), fm = parseInt(full[2], 10), fd = parseInt(full[3], 10);
        if (validDate(fy, fm, fd)) { rangeStart = iso(fy, fm, fd); rangeEnd = rangeStart; }
        lunarMonth = fm; lunarDay = fd;
        work = work.replace(full[0], ' ');
      } else if (md) {
        var mm2 = parseInt(md[1], 10), dd3 = parseInt(md[2], 10);
        var mdy = (out.lunar || mm2 >= today.getMonth() + 1) ? y0 : y0 + 1;
        if (validDate(mdy, mm2, dd3)) { rangeStart = iso(mdy, mm2, dd3); rangeEnd = rangeStart; }
        lunarMonth = mm2; lunarDay = dd3;
        work = work.replace(md[0], ' ');
      } else if (slash) {
        var sm2 = parseInt(slash[1], 10), sd2 = parseInt(slash[2], 10);
        var sy2 = sm2 >= today.getMonth() + 1 ? y0 : y0 + 1;
        if (validDate(sy2, sm2, sd2)) { rangeStart = iso(sy2, sm2, sd2); rangeEnd = rangeStart; }
        work = work.replace(slash[0], ' ');
      } else if (dayOnly) {
        var od = parseInt(dayOnly[1], 10);
        var oy = y0, om = today.getMonth() + 1;
        if (od < today.getDate()) { om += 1; if (om > 12) { om = 1; oy += 1; } }
        if (validDate(oy, om, od)) { rangeStart = iso(oy, om, od); rangeEnd = rangeStart; }
        lunarDay = od;
        work = work.replace(dayOnly[0], ' ');
      }
    }

    /* 시간 범위: 오전 9시부터 오후 6시까지 / 9시~18시 / 9:00-18:00 */
    var startH = null, startM = 0, endH = null, endM = 0, merStart = '', merEnd = '';
    var tr = work.match(new RegExp(MER_RE + '?\\s*' + NUM_RE + '\\s*시\\s*(?:반|(\\d{1,2})\\s*분)?\\s*(?:부터|에서|~|∼|～|—|-)\\s*' + MER_RE + '?\\s*' + NUM_RE + '\\s*시\\s*(?:반|(\\d{1,2})\\s*분)?(?:\\s*까지)?'));
    var tr24 = !tr && work.match(/(\d{1,2}):(\d{2})\s*(?:부터|에서|~|∼|～|—|-)\s*(\d{1,2}):(\d{2})(?:\s*까지)?/);

    if (tr) {
      merStart = tr[1] || '';
      startH = numOf(tr[2]);
      startM = tr[3] ? parseInt(tr[3], 10) : (/반/.test(tr[0].slice(0, tr[0].indexOf('시'))) ? 30 : 0);
      merEnd = tr[4] || '';
      endH = numOf(tr[5]);
      endM = tr[6] ? parseInt(tr[6], 10) : (/반/.test(tr[0].slice(tr[0].indexOf('~') >= 0 ? tr[0].indexOf('~') : 0)) ? 30 : 0);
      work = work.replace(tr[0], ' ');
    } else if (tr24) {
      startH = parseInt(tr24[1], 10);
      startM = parseInt(tr24[2], 10);
      endH = parseInt(tr24[3], 10);
      endM = parseInt(tr24[4], 10);
      merStart = '24';
      merEnd = '24';
      work = work.replace(tr24[0], ' ');
    }

    if (startH != null && endH != null) {
      var sh = merStart === '24' ? startH : applyMer(startH, merStart);
      var eh = merEnd === '24' ? endH : applyMer(endH, merEnd);
      /* 오후 9시부터 6시까지 → 끝 시간이 앞서면 오후로 보정 */
      if (eh <= sh && eh <= 12) eh += 12;
      out.time = hhmm(sh, startM);
      out.endTime = hhmm(eh, endM);
      out.hasTime = true;
      out.hasRange = true;

    /* 단일 시간: 오후 3시 / 15시 / 3시 30분 / 15:00 */
    } else {
      var t1 = work.match(new RegExp(MER_RE + '?\\s*' + NUM_RE + '\\s*시\\s*(?:반|(\\d{1,2})\\s*분)?'));
      var t24 = !t1 && work.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
      if (t1) {
        var mer1 = t1[1] || '';
        var h1 = numOf(t1[2]);
        var m1v = t1[3] ? parseInt(t1[3], 10) : (/반/.test(t1[0]) ? 30 : 0);
        var hh = applyMer(h1, mer1);
        if (hh != null) {
          out.time = hhmm(hh, m1v);
          out.hasTime = true;
        }
        work = work.replace(t1[0], ' ');
      } else if (t24) {
        out.time = hhmm(parseInt(t24[1], 10), parseInt(t24[2], 10));
        out.hasTime = true;
        work = work.replace(t24[0], ' ');
      }
    }

    /* 담당(이름) — 앱에 있는 이름 + 흔한 호칭 */
    var members = Array.isArray(ctx.members) ? ctx.members : [];
    var alias = [
      { words: ['큰아들', '장남'], match: '첫째' },
      { words: ['작은아들', '차남'], match: '둘째' },
      { words: ['막내딸', '막내아들', '막둥이'], match: '막내' },
      { words: ['할머니', '외할머니'], match: '외할머니' },
      { words: ['와이프', '아내', '부인'], match: '엄마' },
      { words: ['남편'], match: '아빠' }
    ];
    var picked = [];
    members.forEach(function (m) {
      if (!m || !m.name) return;
      var name = String(m.name);
      if (raw.indexOf(name) !== -1) {
        picked.push(m.id);
        work = work.split(name).join(' ');
      }
    });
    alias.forEach(function (a) {
      a.words.forEach(function (w) {
        if (raw.indexOf(w) === -1) return;
        members.forEach(function (m) {
          if (!m || m.name !== a.match) return;
          if (picked.indexOf(m.id) === -1) picked.push(m.id);
          work = work.split(w).join(' ');
        });
      });
    });
    out.members = picked;

    /* 분류 */
    CATEGORY_WORDS.forEach(function (cat) {
      if (out.category) return;
      for (var i = 0; i < cat.words.length; i++) {
        if (raw.indexOf(cat.words[i]) !== -1) { out.category = cat.id; break; }
      }
    });

    /* 날짜 확정 */
    out.date = rangeStart || weekdayDate || relDate || '';
    if (rangeStart && rangeEnd && rangeEnd !== rangeStart) {
      out.endDate = rangeEnd;
      out.hasRange = true;
    }
    if (!out.date && (weekdayDate || relDate)) out.date = weekdayDate || relDate;
    if (out.date && out.endDate && out.endDate < out.date) {
      var tmp = out.endDate; out.endDate = out.date; out.date = tmp;
    }

    /* 음력 → 양력 변환 (앱의 음력 모듈 사용) */
    if (out.lunar && lunarMonth && lunarDay && window.FamilyLunar) {
      var targetYear = out.date ? Number(out.date.slice(0, 4)) : today.getFullYear();
      var sol = null;
      try { sol = window.FamilyLunar.toSolar(targetYear, lunarMonth, lunarDay, false); } catch (e) { sol = null; }
      /* 이번 해 음력 날짜가 이미 지났으면 다음 해 같은 음력 날짜로 */
      if (sol && iso(sol.y, sol.m, sol.d) < isoOfDate(today)) {
        var sol2 = null;
        try { sol2 = window.FamilyLunar.toSolar(targetYear + 1, lunarMonth, lunarDay, false); } catch (e) { sol2 = null; }
        if (sol2) sol = sol2;
      }
      if (sol) {
        out.date = iso(sol.y, sol.m, sol.d);
        out.endDate = out.date;
      }
      out.lunarMonth = lunarMonth;
      out.lunarDay = lunarDay;
      var label = '음력 ' + lunarMonth + '월 ' + lunarDay + '일';
      out.notes.push(label + (out.date ? ' → ' + out.date : ''));
    }
    if (out.lunar && !out.date) out.notes.push('음력 날짜를 알아듣지 못했어요. 날짜를 직접 골라 주세요.');

    /* 제목: 남은 말 */
    var tokens = work.replace(/[,.!?·"'“”‘’()\[\]]/g, ' ').split(/\s+/);
    var kept = [];
    tokens.forEach(function (t) {
      var w = t.replace(/^[~\-]+|[~\-]+$/g, '');
      if (!w) return;
      if (FILLERS[w]) return;
      if (/^\d{1,2}$/.test(w)) return;
      if (/^(부터|까지|로|으로|에서|에는|에도|만|쯤)$/.test(w)) return;
      kept.push(w);
    });
    out.title = kept.join(' ').trim();

    return out;
  }

  /* ---------------- 음성 인식 ---------------- */
  var active = null;
  var pendingNative = null;

  /* 안드로이드 앱(WebView)은 Web Speech API가 없어 네이티브 음성인식(AndroidApp.startVoiceInput)을 씁니다. */
  function hasNative() {
    return !!(window.AndroidApp && typeof window.AndroidApp.startVoiceInput === 'function');
  }

  function supported() {
    return hasNative() || !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function stop() {
    if (active) {
      try { active.stop(); } catch (e) { /* 무시 */ }
      active = null;
    }
    if (pendingNative) {
      var p = pendingNative;
      pendingNative = null;
      if (p.btn) {
        p.btn.classList.remove('is-listening');
        p.btn.textContent = (p.opts && p.opts.idleLabel) || '🎤 말로 입력하기';
      }
    }
  }

  function resetBtn(btn, opts) {
    if (!btn) return;
    btn.classList.remove('is-listening');
    btn.textContent = (opts && opts.idleLabel) || '🎤 말로 입력하기';
  }

  /* 네이티브 음성인식 시작 — 결과는 window.onAndroidVoiceResult 로 돌아옵니다. */
  function startNative(btn, opts) {
    pendingNative = { btn: btn, opts: opts };
    btn.classList.add('is-listening');
    btn.textContent = '🎙️ 듣는 중…';
    if (opts.statusEl) {
      opts.statusEl.hidden = false;
      opts.statusEl.textContent = '말씀하세요… (마이크 창에서 말한 뒤 확인을 누르세요)';
    }
    try {
      window.AndroidApp.startVoiceInput();
    } catch (e) {
      pendingNative = null;
      resetBtn(btn, opts);
      if (opts.statusEl) {
        opts.statusEl.hidden = false;
        opts.statusEl.textContent = '음성 인식을 열지 못했어요. 다시 눌러 주세요.';
      }
    }
  }

  function finishNative(text, errorText) {
    var p = pendingNative;
    pendingNative = null;
    var btn = p && p.btn;
    var opts = (p && p.opts) || {};
    resetBtn(btn, opts);
    var status = opts.statusEl;
    if (errorText) {
      if (status) { status.hidden = false; status.textContent = errorText; }
      return;
    }
    var t = String(text == null ? '' : text).trim();
    if (!t) {
      if (status) { status.hidden = false; status.textContent = '말소리를 듣지 못했어요. 다시 눌러 말씀해 주세요.'; }
      return;
    }
    if (status) { status.hidden = false; status.textContent = '말한 내용: ' + t; }
    if (typeof opts.onText === 'function') opts.onText(t);
  }

  /* 안드로이드 앱이 결과·오류를 돌려줄 때 부르는 함수 */
  window.onAndroidVoiceResult = function (text) {
    finishNative(text);
  };
  window.onAndroidVoiceError = function (message) {
    var msg = String(message == null ? '' : message);
    if (msg === 'cancelled' || msg === 'cancel') finishNative('', '음성 입력을 취소했어요. 다시 누르면 말할 수 있어요.');
    else if (msg === 'permission') finishNative('', '마이크 권한이 필요해요. 설정 → 애플리케이션 → 우리 가족 달력 → 권한에서 마이크를 허용해 주세요.');
    else if (msg === 'no-recognizer') finishNative('', '이 폰에서 쓸 수 있는 음성인식 앱을 찾지 못했어요. Google 앱을 설치하거나 키보드의 마이크 버튼을 눌러 주세요.');
    else if (msg === 'empty') finishNative('', '말소리를 듣지 못했어요. 다시 눌러 말씀해 주세요.');
    else finishNative('', '음성을 듣지 못했어요. 다시 눌러 말씀해 주세요.');
  };

  /* 버튼 하나에 인식 기능을 붙입니다. */
  function attach(btn, opts) {
    if (!btn) return null;
    opts = opts || {};
    btn.addEventListener('click', function () {
      var status = opts.statusEl;
      /* 1) 안드로이드 앱: 네이티브 음성인식 */
      if (hasNative()) {
        if (pendingNative) {
          if (status) {
            status.hidden = false;
            status.textContent = '이미 듣고 있어요. 마이크 창에서 말한 뒤 확인을 눌러 주세요.';
          }
          return;
        }
        if (active) { stop(); }
        startNative(btn, opts);
        return;
      }
      /* 2) 웹 브라우저: Web Speech API */
      if (!supported()) {
        if (status) {
          status.hidden = false;
          status.textContent = '이 환경에서는 음성 입력을 쓸 수 없어요. 키보드의 마이크 버튼으로 말하거나, 안드로이드 앱 1.2 이상으로 업데이트해 주세요.';
        }
        if (typeof opts.onUnsupported === 'function') opts.onUnsupported();
        return;
      }
      if (active) {
        stop();
        btn.classList.remove('is-listening');
        btn.textContent = opts.idleLabel || '🎤 말로 입력하기';
        return;
      }
      var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      var rec = new Rec();
      rec.lang = 'ko-KR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      active = rec;
      btn.classList.add('is-listening');
      btn.textContent = '🎙️ 듣는 중… (누르면 멈춤)';
      if (status) { status.hidden = false; status.textContent = '말씀하세요…'; }

      var finalText = '';
      rec.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t;
          else interim += t;
        }
        if (status) status.textContent = (finalText + interim).trim() || '듣는 중…';
      };
      rec.onerror = function (ev) {
        btn.classList.remove('is-listening');
        btn.textContent = opts.idleLabel || '🎤 말로 입력하기';
        active = null;
        var msg = '음성을 듣지 못했어요. 다시 눌러 말씀해 주세요.';
        if (ev && ev.error === 'not-allowed') msg = '마이크가 막혀 있어요. 주소창 왼쪽 자물쇠(ⓘ) → 권한 → 마이크 → 허용으로 바꾼 뒤 다시 눌러 주세요. (안드로이드 앱은 앱 설정 → 권한 → 마이크)';
        else if (ev && ev.error === 'no-speech') msg = '말소리를 듣지 못했어요. 다시 눌러 주세요.';
        else if (ev && ev.error === 'network') msg = '음성 인식 서버에 연결하지 못했어요. 인터넷을 확인해 주세요.';
        else if (ev && ev.error === 'service-not-allowed') msg = '이 브라우저에서 음성 인식 서비스가 막혀 있어요. 크롬에서 열거나 안드로이드 앱 1.2 이상을 써 주세요.';
        if (status) { status.hidden = false; status.textContent = msg; }
      };
      rec.onend = function () {
        btn.classList.remove('is-listening');
        btn.textContent = opts.idleLabel || '🎤 말로 입력하기';
        active = null;
        var text = finalText.trim();
        if (!text) {
          if (status && !status.textContent) { status.hidden = false; status.textContent = '말소리를 듣지 못했어요. 다시 눌러 주세요.'; }
          return;
        }
        if (status) status.textContent = '말한 내용: ' + text;
        if (typeof opts.onText === 'function') opts.onText(text);
      };
      try { rec.start(); } catch (e) {
        active = null;
        btn.classList.remove('is-listening');
        btn.textContent = opts.idleLabel || '🎤 말로 입력하기';
        if (status) { status.hidden = false; status.textContent = '음성 인식을 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요.'; }
      }
    });
    return btn;
  }

  window.CalendarVoice = {
    supported: supported,
    hasNative: hasNative,
    stop: stop,
    attach: attach,
    parse: parse
  };
})();
