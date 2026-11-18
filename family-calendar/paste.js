/* 📋 문자·카톡 붙여넣기 → 일정 칸 자동 채우기
   - 학교 안내 문자, 병원 예약 문자, 가족 카톡을 그대로 붙여넣으면
     날짜·시간·제목·메모·담당 가족을 뽑아 일정 입력 칸에 채워 줍니다.
   - 카톡 "대화 내용 복사"의 머리말(보낸 날짜·전송 시각)은 일정 시간으로 쓰지 않고 걸러 냅니다.
   - 실명은 코드에 넣지 않습니다. 이름은 앱이 쓰는 구성원 이름(ctx.members)만 씁니다.
*/
(function () {
  'use strict';

  var KOR_NUM = {
    '한': 1, '하나': 1, '일': 1, '두': 2, '둘': 2, '이': 2, '세': 3, '셋': 3, '삼': 3,
    '네': 4, '넷': 4, '사': 4, '다섯': 5, '오': 5, '여섯': 6, '육': 6, '일곱': 7, '칠': 7,
    '여덟': 8, '팔': 8, '아홉': 9, '구': 9, '열': 10, '십': 10, '열한': 11, '십일': 11, '열두': 12, '십이': 12
  };
  var NUM_SRC = '(\\d{1,2}|열한|열두|십일|십이|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|십)';
  var MER_SRC = '(오전|오후|아침|점심|저녁|밤|낮|새벽)';
  var WD = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

  /* ---------------- 기본 날짜 도구 ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function d2iso(dt) { return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
  function parseISO(s) {
    var p = String(s || '').split('-').map(Number);
    if (p.length !== 3 || isNaN(p[0]) || isNaN(p[1]) || isNaN(p[2])) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function addDays(dt, n) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n); }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function validYMD(y, m, d) {
    if (!y || !m || !d) return false;
    if (m < 1 || m > 12) return false;
    return d >= 1 && d <= daysInMonth(y, m);
  }
  function numOf(s) {
    if (s == null) return null;
    var t = String(s).trim();
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    return KOR_NUM[t] == null ? null : KOR_NUM[t];
  }
  function hhmm(h, m) { return pad2(h % 24) + ':' + pad2(m || 0); }

  /* ---------------- 카톡·문자 머리말 정리 ---------------- */
  /* 카톡 날짜 구분선: --------------- 2026년 11월 18일 수요일 --------------- */
  var KAKAO_DIVIDER = /^[\s\-=_·]*\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일\s*[월화수목금토일]?요?일?[\s\-=_·]*$/;
  /* PC 카톡 복사: 2026년 11월 18일 오전 10:23, 홍길동 : 안녕하세요 */
  var KAKAO_PC = /^\s*\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일\s*(?:[월화수목금토일]요일)?\s*(?:오전|오후)?\s*\d{1,2}:\d{2}\s*,?\s*([^:\n]{0,20}?)\s*:\s*/;
  /* 모바일 카톡 복사: [홍길동] [오전 10:23] 안녕하세요 */
  var KAKAO_MOBILE = /^\s*(?:\[[^\]]{1,20}\]\s*)?\[\s*(?:오전|오후)\s*\d{1,2}:\d{2}\s*\]\s*/;
  /* 문자 머리말: 2026-11-18 10:23  /  11.18 10:23 */
  var SMS_STAMP = /^\s*(\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}|\d{1,2}[.\-\/]\d{1,2})\s*(?:\([월화수목금토일]\))?\s*(?:오전|오후)?\s*\d{1,2}:\d{2}\s*,?\s*/;
  /* 보낸사람: 홍길동 */
  var SENDER_LINE = /^\s*(?:보낸\s*사람|보낸이|발신자|from)\s*[:：]\s*(.{1,30})$/i;

  var NOISE_WORDS = /(무료\s*수신\s*거부|수신\s*거부|수신거부|발신\s*번호|고객\s*센터|고객센터|본\s*(?:문자|메시지|메일)는|스팸\s*차단|^0?80[-\s]?\d{3,4}[-\s]?\d{4})/;

  function cleanLine(line) {
    var s = String(line == null ? '' : line).replace(/\u00a0/g, ' ');
    if (!s.trim()) return '';
    if (KAKAO_DIVIDER.test(s)) return '';
    s = s.replace(KAKAO_PC, '');
    s = s.replace(KAKAO_MOBILE, '');
    if (SENDER_LINE.test(s)) return '';
    s = s.replace(SMS_STAMP, '');
    s = s.replace(/^\s*\[(?:Web발신|web발신|WEB발신|국제발신|스팸|광고|ad|AD|통합발신)\]\s*/g, '');
    s = s.replace(/^\s*\((?:광고|AD|ad)\)\s*/g, '');
    s = s.replace(/^\s*\[(?:광고|AD|ad)\]\s*/g, '');
    /* 광고·수신거부 꼬리 */
    s = s.replace(/[\[(]?\s*무료\s*수신\s*거부[^)\]]*[)\]]?\s*\d[\d\-\s]*$/g, '');
    s = s.replace(/[\[(]?\s*수신\s*거부[^)\]]*[)\]]?\s*\d[\d\-\s]*$/g, '');
    s = s.replace(/\s*수신\s*거부\s*\d[\d\-\s]*$/g, '');
    s = String(s).replace(/\s+/g, ' ').trim();
    if (NOISE_WORDS.test(s)) return '';
    return s;
  }

  /* 붙여넣은 글에서 머리말·꼬리말을 걷어내고 본문 줄만 남깁니다. */
  function clean(text) {
    var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    try { if (src.normalize) src = src.normalize('NFC'); } catch (e) { /* 무시 */ }
    var lines = [];
    src.split('\n').forEach(function (raw) {
      var s = cleanLine(raw);
      if (!s) return;
      if (NOISE_WORDS.test(s) && s.length <= 40) return;
      lines.push(s);
    });
    return { text: src.trim(), lines: lines, body: lines.join('\n').trim() };
  }

  /* ---------------- 찾은 표현 수집 도구 ---------------- */
  function scan(re, text, accept) {
    var out = [], m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      if (!accept || accept(m, m.index, text)) out.push({ m: m, index: m.index, len: m[0].length });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    re.lastIndex = 0;
    return out;
  }

  var RE_YMD = /(\d{4})\s*(?:년|[.\-\/])\s*(\d{1,2})\s*(?:월|[.\-\/])\s*(\d{1,2})\s*일?(?:\s*\(([월화수목금토일])\))?/g;
  var RE_MD = /(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\(([월화수목금토일])\))?/g;
  var RE_MD2 = /(\d{1,2})\s*([.\/])\s*(\d{1,2})(?:\s*\(([월화수목금토일])\))?/g;
  var RE_DAY = /(\d{1,2})\s*일(?:\s*\(([월화수목금토일])\))?/g;
  var RE_WEEKDAY = /(이번\s*주|다음\s*주|담\s*주|이번주|다음주|차주|이번\s*달|다음\s*달)?\s*(일|월|화|수|목|금|토)\s*(?:요일|욜)/g;
  var RE_REL = /(오늘|금일|내일|명일|모레|글피|어제|어저께|당일)/g;
  var RE_THISWD = /(이번|다음|담)\s*(?:주\s*)?(일|월|화|수|목|금|토)(?![요일])/g;

  function upcomingYear(mo, d, today) {
    var y = today.getFullYear();
    var tm = today.getMonth() + 1, td = today.getDate();
    if (mo < tm || (mo === tm && d < td)) y += 1;
    return y;
  }

  function rawDateSpans(text, today) {
    var found = [];

    scan(RE_YMD, text).forEach(function (hit) {
      var y = parseInt(hit.m[1], 10), mo = parseInt(hit.m[2], 10), d = parseInt(hit.m[3], 10);
      if (!validYMD(y, mo, d)) return;
      found.push({ index: hit.index, len: hit.len, iso: iso(y, mo, d), y: y, m: mo, d: d });
    });
    scan(RE_MD, text).forEach(function (hit) {
      var mo = parseInt(hit.m[1], 10), d = parseInt(hit.m[2], 10);
      var y = upcomingYear(mo, d, today);
      if (!validYMD(y, mo, d)) return;
      found.push({ index: hit.index, len: hit.len, iso: iso(y, mo, d), y: y, m: mo, d: d });
    });
    scan(RE_MD2, text, function (m, idx, all) {
      var before = idx > 0 ? all.charAt(idx - 1) : '';
      var after = all.charAt(idx + m[0].length);
      if (/[\d.:\/\-]/.test(before)) return false;
      if (/\d/.test(after)) return false;
      if (/[만천억%％점원]/.test(after)) return false;
      var mo = parseInt(m[1], 10), d = parseInt(m[3], 10);
      return validYMD(2000, mo, d);
    }).forEach(function (hit) {
      var mo = parseInt(hit.m[1], 10), d = parseInt(hit.m[3], 10);
      var y = upcomingYear(mo, d, today);
      if (!validYMD(y, mo, d)) return;
      found.push({ index: hit.index, len: hit.len, iso: iso(y, mo, d), y: y, m: mo, d: d });
    });
    scan(RE_DAY, text, function (m, idx, all) {
      var before = idx > 0 ? all.charAt(idx - 1) : ' ';
      var after = all.charAt(idx + m[0].length);
      if (/\d/.test(before)) return false;
      if (/^\s*(?:전|후|째|간|동안|분|시간|회|차|군데|번|명|개|잔)/.test(after)) return false;
      return true;
    }).forEach(function (hit) {
      var d = parseInt(hit.m[1], 10);
      var y = today.getFullYear(), mo = today.getMonth() + 1;
      if (d < today.getDate()) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
      if (!validYMD(y, mo, d)) return;
      found.push({ index: hit.index, len: hit.len, iso: iso(y, mo, d), y: y, m: mo, d: d, dayOnly: true });
    });

    /* 요일 */
    scan(RE_WEEKDAY, text).forEach(function (hit) {
      var qual = (hit.m[1] || '').replace(/\s/g, '');
      var wd = WD[hit.m[2]];
      if (wd == null) return;
      var delta = (wd - today.getDay() + 7) % 7;
      if (/다음|담|차주/.test(qual)) delta += 7;
      found.push({ index: hit.index, len: hit.len, iso: d2iso(addDays(today, delta)), weekday: wd });
    });
    scan(RE_THISWD, text).forEach(function (hit) {
      var wd = WD[hit.m[2]];
      if (wd == null) return;
      var delta = (wd - today.getDay() + 7) % 7;
      if (/다음|담/.test(hit.m[1])) delta += 7;
      found.push({ index: hit.index, len: hit.len, iso: d2iso(addDays(today, delta)), weekday: wd });
    });
    /* 상대 날짜 */
    var relMap = { '오늘': 0, '금일': 0, '당일': 0, '내일': 1, '명일': 1, '모레': 2, '글피': 3, '어제': -1, '어저께': -1 };
    scan(RE_REL, text, function (m, idx, all) {
      var after = all.charAt(idx + m[0].length);
      if (/^[가-힣]/.test(after) && !/^[은는이가을를에의도만쯤]/.test(after)) return false;
      return true;
    }).forEach(function (hit) {
      var word = hit.m[1];
      if (relMap[word] == null) return;
      found.push({ index: hit.index, len: hit.len, iso: d2iso(addDays(today, relMap[word])) });
    });

    /* 겹치는 결과 정리 (긴 것 우선) */
    found.sort(function (a, b) { return a.index - b.index || b.len - a.len; });
    var kept = [];
    found.forEach(function (f) {
      if (!f.iso) return;
      if (kept.some(function (k) { return f.index < k.index + k.len && k.index < f.index + f.len; })) return;
      kept.push(f);
    });
    return kept;
  }

  /* "11월 27일 ~ 30일", "11/27~11/30", "27일부터 30일까지" → 기간 일정 하나로 */
  function dateSpans(text, today) {
    var list = rawDateSpans(text, today);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var b = list[i + 1];
      var merged = false;
      if (b) {
        var gap = text.slice(a.index + a.len, b.index);
        var after = text.slice(b.index + b.len, b.index + b.len + 6);
        var connector = /[~∼～—–\-]/.test(gap) || /부터|에서/.test(gap);
        var gapOk = /^[\s]*(?:부터|에서)?[\s]*(?:[~∼～—–\-][\s]*)?$/.test(gap);
        var tillOk = /^[\s]*(?:까지|부터|[~∼～—–\-])/.test(after);
        if (connector && gapOk && (tillOk || b.dayOnly)) {
          var endIso = b.iso;
          if (b.dayOnly) {
            var ey = a.y || today.getFullYear(), emo = a.m || (today.getMonth() + 1), ed = b.d;
            if (ed < a.d) { emo += 1; if (emo > 12) { emo = 1; ey += 1; } }
            if (!validYMD(ey, emo, ed)) { out.push(a); continue; }
            endIso = iso(ey, emo, ed);
          }
          if (endIso >= a.iso) {
            out.push({ index: a.index, len: b.index + b.len - a.index, iso: a.iso, endIso: endIso, y: a.y, m: a.m, d: a.d, range: true });
            i += 1;
            merged = true;
          }
        }
      }
      if (!merged && !a.dayOnly) out.push(a);
      /* 홀로 남은 "27일"은 오탐이 많아 날짜로 쓰지 않습니다. 단, 본문에 다른 날짜가 하나도 없으면 씁니다. */
      else if (!merged && a.dayOnly && list.length === 1) out.push(a);
    }
    return out;
  }

  /* ---------------- 시간 찾기 ---------------- */
  var RE_T_MER = new RegExp(MER_SRC + '\\s*' + NUM_SRC + '\\s*시\\s*(?:(\\d{1,2})\\s*분|(반))?', 'g');
  var RE_T_BARE = new RegExp('(^|[^\\d:])' + NUM_SRC + '\\s*시\\s*(?:(\\d{1,2})\\s*분|(반))?(?!\\s*(?:간|마다))', 'g');
  var RE_T_HHMM = /(^|[^\d:])(\d{1,2}):(\d{2})(?!\d)/g;

  function applyMer(h, mer) {
    if (h == null || isNaN(h)) return null;
    var hour = h;
    if (mer === '오후' || mer === '저녁' || mer === '밤' || mer === '낮' || mer === '점심') {
      if (hour < 12) hour += 12;
    } else if (mer === '오전' || mer === '아침' || mer === '새벽') {
      if (hour === 12) hour = 0;
    } else if (hour >= 1 && hour <= 6) {
      hour += 12; /* "3시" → 오후 3시 (생활어 기준) */
    }
    if (hour === 24) hour = 0;
    return hour % 24;
  }

  function rawTimeSpans(text) {
    var out = [];
    scan(RE_T_MER, text).forEach(function (hit) {
      var h = numOf(hit.m[2]);
      var mi = hit.m[3] ? parseInt(hit.m[3], 10) : (hit.m[4] ? 30 : 0);
      if (h == null || h > 24 || mi > 59) return;
      out.push({ index: hit.index, len: hit.len, time: hhmm(applyMer(h, hit.m[1]), mi) });
    });
    scan(RE_T_BARE, text).forEach(function (hit) {
      if (out.some(function (o) { return hit.index < o.index + o.len && o.index < hit.index + hit.len; })) return;
      var h = numOf(hit.m[2]);
      var mi = hit.m[3] ? parseInt(hit.m[3], 10) : (hit.m[4] ? 30 : 0);
      if (h == null || h > 24 || mi > 59) return;
      var start = hit.index + (hit.m[1] || '').length;
      out.push({ index: start, len: hit.len - (hit.m[1] || '').length, time: hhmm(applyMer(h, ''), mi) });
    });
    scan(RE_T_HHMM, text).forEach(function (hit) {
      if (out.some(function (o) { return hit.index < o.index + o.len && o.index < hit.index + hit.len; })) return;
      var h = parseInt(hit.m[2], 10), mi = parseInt(hit.m[3], 10);
      if (h > 24 || mi > 59) return;
      var start = hit.index + (hit.m[1] || '').length;
      out.push({ index: start, len: hit.len - (hit.m[1] || '').length, time: hhmm(h, mi) });
    });
    out.sort(function (a, b) { return a.index - b.index; });
    var kept = [];
    out.forEach(function (t) {
      if (kept.some(function (k) { return t.index < k.index + k.len && k.index < t.index + t.len; })) return;
      kept.push(t);
    });
    return kept;
  }

  /* 시간 범위: "오후 2시~4시", "14:00-16:00" */
  function timeSpans(text) {
    var list = rawTimeSpans(text);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i], b = list[i + 1], merged = false;
      if (b) {
        var gap = text.slice(a.index + a.len, b.index);
        var after = text.slice(b.index + b.len, b.index + b.len + 6);
        var connector = /[~∼～—–\-]/.test(gap) || /부터|에서/.test(gap);
        if (connector && /^[\s]*(?:부터|에서)?[\s]*[~∼～—–\-]?[\s]*$/.test(gap) && /^[\s]*(?:까지|부터|[~∼～—–\-])/.test(after)) {
          out.push({ index: a.index, len: b.index + b.len - a.index, time: a.time, endTime: b.time });
          i += 1;
          merged = true;
        }
      }
      if (!merged) out.push(a);
    }
    return out;
  }

  /* ---------------- 담당 가족 ---------------- */
  var ALIAS = [
    { words: ['큰아들', '장남', '첫째아들', '첫째딸'], id: 'first', name: '첫째' },
    { words: ['작은아들', '차남', '둘째아들', '둘째딸'], id: 'second', name: '둘째' },
    { words: ['막내딸', '막내아들', '막둥이', '막내'], id: 'third', name: '막내' },
    { words: ['외할머니', '할머니', '외조모'], id: 'grandma', name: '외할머니' },
    { words: ['와이프', '아내', '부인'], id: 'mom', name: '엄마' },
    { words: ['남편'], id: 'dad', name: '아빠' }
  ];

  function findMembers(text, members) {
    var list = Array.isArray(members) ? members : [];
    var picked = [];
    var byId = {};
    var byName = {};
    list.forEach(function (m) {
      if (!m || !m.id) return;
      byId[m.id] = m;
      if (m.name) byName[String(m.name)] = m;
    });
    function push(m) { if (m && picked.indexOf(m.id) === -1) picked.push(m.id); }

    /* 1) 앱에 저장된 실제 이름 */
    list.forEach(function (m) {
      if (!m || !m.name) return;
      if (text.indexOf(String(m.name)) !== -1) push(m);
    });
    /* 2) 흔한 호칭 → 구성원 */
    ALIAS.forEach(function (a) {
      a.words.forEach(function (w) {
        if (text.indexOf(w) === -1) return;
        if (byId[a.id]) push(byId[a.id]);
        else if (byName[a.name]) push(byName[a.name]);
      });
    });
    return picked;
  }

  /* ---------------- 분류 ---------------- */
  var CATEGORY_WORDS = [
    { id: 'birthday', words: ['생일', '생신', '환갑', '돌잔치', '백일'] },
    { id: 'memorial', words: ['제사', '기제', '차례', '성묘', '탈상'] },
    { id: 'school', words: ['학교', '학원', '시험', '체험학습', '학부모', '상담', '방학', '개학', '운동회', '수학여행', '현장학습', '입학', '졸업', '담임', '학급', '반장', '급식', '돌봄', '방과후', '동아리', '수련회', '발표회', '공개수업', '교내', '중간고사', '기말고사', '모의고사', '숙제', '준비물', '교복'] },
    { id: 'hospital', words: ['병원', '치과', '의원', '진료', '검진', '예방접종', '접종', '약국', '한의원', '안과', '이비인후과', '소아과', '피부과', '정형외과', '산부인과', '내과', '수술', '재활'] }
  ];
  function findCategory(text) {
    for (var i = 0; i < CATEGORY_WORDS.length; i++) {
      var c = CATEGORY_WORDS[i];
      for (var j = 0; j < c.words.length; j++) {
        if (text.indexOf(c.words[j]) !== -1) return c.id;
      }
    }
    return '';
  }

  /* ---------------- 제목 뽑기 ---------------- */
  var GREETING = /^(?:안녕하세요|안녕하십니까|수고하십니다|수고하셨습니다|수고많으십니다|반갑습니다|부모님|학부모님|어머님|아버님|보호자님|사랑하는|여보|자기야)[\s,.!~ㅋㅎ]*$/;
  var GREET_START = /^(?:안녕하세요|안녕하십니까|수고하십니다|수고하셨습니다|수고많으십니다|학부모님|어머님|아버님|보호자님|부모님|여보|자기야|사장님|선생님|쌤|혹시|근데|그런데|그리고|저기)[\s,.!~]*/;
  var ADDRESS = /(?:어머님|아버님|학부모님|보호자님|부모님)[,\s]*/g;
  var TAIL_VERB = /(?:[\s,.!~]*(?:해요|해|하자|가자|가야돼|가야해|가야지|해야돼|해야해|해야지|부탁해요|부탁해|부탁드려요|부탁드립니다|부탁합니다|알려줘|알려주세요|확인해줘|확인해주세요|체크해줘|챙겨줘|챙겨주세요|드립니다|드려요|입니다|합니다|있습니다|있어요|예정입니다|예정이에요|바랍니다|안내드립니다|안내드려요|알려드립니다|알려드려요|공지합니다|공지드립니다|주세요|주십시오|주시기\s*바랍니다|주시면\s*감사하겠습니다|감사합니다|고맙습니다|참고\s*바랍니다|참고하세요|참고해주세요|만나|만나요|보자|봐요))+$/;
  var KEY_WORDS = /(신청|접수|모집|참석|방문|준비물|상담|예약|검진|접종|회의|설명회|공개수업|체험|수학여행|현장학습|소집|훈련|발표|시험|제출|동의서|조사|투표|선거|행사|축제|공연|운동회|개학|방학|졸업|입학|면접|면담|간담회|워크숍|세미나|교육|안내|알림|요청|부탁|약속|모임|식사|저녁|점심|회식|데리러|픽업|마중|배웅|송별|찾으러|퇴원|입원|수술|검사|결과|납부|회비|준비|작성|회신)/;

  var PARTICLES = /(?:^|\s)(?:부터는|까지는|부터|까지|에서|에는|에도|으로|로|에|쯤|경|의|와|과)(?=\s|$)/g;

  function stripTokens(line, today) {
    var spans = dateSpans(line, today).concat(timeSpans(line));
    spans.sort(function (a, b) { return b.index - a.index; });
    var s = String(line || '');
    spans.forEach(function (sp) {
      s = s.slice(0, sp.index) + ' ' + s.slice(sp.index + sp.len);
    });
    s = s.replace(/\(\s*\)/g, ' ');
    s = s.replace(/[\[\(]\s*(?:오전|오후)\s*[\]\)]/g, ' ');
    s = s.replace(/(?:문의|연락|전화|☎|TEL)\s*[:：]?\s*[\d\-()\s]{7,}/gi, ' ');
    s = s.replace(/(?:문의|연락|전화)\s*(?:바랍니다|주세요|주십시오)/g, ' ');
    s = s.replace(/[\s]*[~∼～—–][\s]*/g, ' ');
    s = s.replace(/[ \t]{2,}/g, ' ');
    s = s.replace(PARTICLES, ' ');
    s = s.replace(/[ \t]{2,}/g, ' ').trim();
    return s;
  }

  function cleanTitle(raw) {
    var s = String(raw || '');
    /* [ ] 안의 이름표·안내 표시는 제목에서 뺍니다 */
    s = s.replace(/^\[[^\]]{1,24}\]\s*/, '');
    s = s.replace(/^\([^)]{1,24}\)\s*/, '');
    s = s.replace(/^[\s\-–—·•*▶▷■□●○◆◇※①-⑩>»"'"'`]+/, '');
    s = s.replace(/[\s\-–—·•*※"'"'`]+$/, '');
    s = s.replace(ADDRESS, ' ');
    var before;
    do {
      before = s;
      s = s.replace(GREET_START, '');
      s = s.replace(/^[\s,.!~·:\-–—]+/, '');
    } while (s !== before && s.length > 2);
    before = '';
    while (s !== before) {
      before = s;
      s = s.replace(TAIL_VERB, '');
      s = s.replace(/[\s,.!~·:]+$/, '');
    }
    s = s.replace(/\s{2,}/g, ' ').trim();
    s = s.replace(/(?:에서|으로|까지|부터|에는)\s*$/, '');
    s = s.replace(/[\s,.!~·:]+$/, '');
    return s;
  }

  /* 긴 줄은 문장 단위로 잘라 제목 후보를 만듭니다. */
  function segmentsOf(lines) {
    var segs = [];
    lines.forEach(function (line, li) {
      String(line).split(/[.!?。！？]+(?=\s|$)/).forEach(function (part) {
        var s = part.trim();
        if (s) segs.push({ text: s, line: li });
      });
    });
    return segs;
  }

  function scoreLine(line, hasDate) {
    var score = 0;
    var len = line.length;
    if (!line) return -99;
    if (GREETING.test(line)) return -99;
    if (/^(?:알림|안내|공지|공지사항|필독|참고|안내문)$/.test(line)) return -5;
    if (/(?:드림|올림)$/.test(line)) score -= 6;
    if (KEY_WORDS.test(line)) score += 2;
    if (CATEGORY_WORDS.some(function (c) { return c.words.some(function (w) { return line.indexOf(w) !== -1; }); })) score += 4;
    if (hasDate) score += 3;
    if (len >= 6 && len <= 42) score += 2;
    else if (len > 60) score -= 2;
    else if (len < 4) score -= 3;
    if (/^[\d\s\-\.,()\/~]+$/.test(line)) score -= 6;
    if (/^(?:문의|연락|전화|☎|※)/.test(line)) score -= 3;
    if (/https?:\/\//.test(line)) score -= 3;
    if (/^(?:첨부|붙임|별첨)/.test(line)) score -= 2;
    return score;
  }

  function fitTitle(s, max) {
    max = max || 40;
    if (s.length <= max) return s;
    var cut = s.slice(0, max);
    var sp = cut.lastIndexOf(' ');
    if (sp > max * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/[\s,·\-~]+$/, '');
  }

  function buildTitle(lines, today) {
    var segs = segmentsOf(lines.length ? lines : ['']);
    var best = null, bestScore = -100;
    segs.forEach(function (seg, i) {
      var stripped = stripTokens(seg.text, today);
      var cleaned = cleanTitle(stripped);
      var score = scoreLine(cleaned || seg.text, true) - i * 0.2;
      if (score > bestScore) { bestScore = score; best = { cleaned: cleaned, raw: seg.text, score: score }; }
    });
    var pick = best && best.cleaned ? best.cleaned : '';
    if (!pick) pick = cleanTitle(stripTokens(lines[0] || '', today));
    return fitTitle(pick, 40);
  }

  /* ---------------- 메모(원문) ---------------- */
  function buildMemo(raw) {
    var keep = String(raw || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (keep.length > 600) keep = keep.slice(0, 600).replace(/\s+\S*$/, '') + ' …';
    return keep;
  }

  /* ---------------- 메인 ---------------- */
  function parse(text, ctx) {
    ctx = ctx || {};
    var today = ctx.today ? (parseISO(ctx.today) || new Date()) : new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var out = {
      raw: raw.trim(),
      date: '', endDate: '', time: '', endTime: '', hasTime: false,
      members: [], category: '', title: '', memo: '', notes: [], candidates: []
    };
    if (!raw.trim()) return out;

    var c = clean(raw);
    out.cleaned = c.body;
    if (!c.body) return out;
    var flat = c.body.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();

    var dates = dateSpans(flat, today);
    var times = timeSpans(flat);

    var withTime = dates.map(function (d) {
      var near = null, bestGap = 999;
      times.forEach(function (t) {
        var gap = t.index - (d.index + d.len);
        if (gap >= -3 && gap <= 45 && gap < bestGap) { bestGap = gap; near = t; }
      });
      if (!near && times.length === 1) near = times[0];
      return {
        iso: d.iso, endIso: d.endIso || '',
        time: near ? near.time : '', endTime: near ? (near.endTime || '') : '',
        hasTime: !!near
      };
    });

    var primary = withTime[0] || null;
    if (primary) {
      out.date = primary.iso;
      out.endDate = primary.endIso || '';
      out.time = primary.time;
      out.endTime = primary.endTime;
      out.hasTime = !!primary.hasTime;
    }

    out.candidates = withTime.slice(0, 8).map(function (x) {
      return { date: x.iso, endDate: x.endIso, time: x.time, endTime: x.endTime, hasTime: x.hasTime };
    });

    out.members = findMembers(c.body + ' ' + raw, ctx.members);
    out.category = findCategory(flat);
    out.title = buildTitle(c.lines, today);
    out.memo = buildMemo(raw);

    if (!out.date) out.notes.push('날짜를 찾지 못했어요 · 날짜 칸을 직접 골라 주세요');
    if (out.date && !out.hasTime) out.notes.push('시간이 없어 종일 일정으로 채웠어요');
    if (!out.members.length) out.notes.push('담당 가족을 찾지 못했어요 · 직접 골라 주세요');
    if (dates.length > 1) out.notes.push('날짜가 ' + dates.length + '개 보여요 · 다른 날짜를 눌러 바꿀 수 있어요');

    return out;
  }

  /* ---------------- 붙여넣기 UI ---------------- */
  function attachUI(opts) {
    opts = opts || {};
    var entry = opts.entry, box = opts.box, area = opts.area;
    var runBtn = opts.runBtn, clearBtn = opts.clearBtn, clipBtn = opts.clipBtn;
    var statusEl = opts.statusEl;
    if (!entry || !box || !area) return null;
    var timer = null;
    var lastParsed = null;

    function setStatus(msg) {
      if (!statusEl) return;
      if (!msg) { statusEl.hidden = true; statusEl.textContent = ''; return; }
      statusEl.hidden = false;
      statusEl.textContent = msg;
    }
    function openBox(focus) {
      box.hidden = false;
      entry.setAttribute('aria-expanded', 'true');
      if (focus) setTimeout(function () { try { area.focus(); } catch (e) { /* 무시 */ } }, 90);
    }
    function closeBox() {
      box.hidden = true;
      entry.setAttribute('aria-expanded', 'false');
      setStatus('');
    }
    function fill(text) {
      var parsed = parse(text, typeof opts.getCtx === 'function' ? opts.getCtx() : {});
      lastParsed = parsed;
      if (!String(text || '').trim()) { setStatus(''); return parsed; }
      if (typeof opts.onFill === 'function') opts.onFill(parsed);
      var bits = [];
      if (parsed.date) {
        bits.push('📅 ' + parsed.date.replace(/-/g, '.') + (parsed.endDate && parsed.endDate !== parsed.date ? '~' + parsed.endDate.slice(5).replace('-', '.') : ''));
      }
      if (parsed.hasTime) {
        bits.push('⏰ ' + parsed.time + (opts.showEndTime && parsed.endTime ? '~' + parsed.endTime : ''));
      }
      if (parsed.members && parsed.members.length && typeof opts.memberName === 'function') {
        var names = parsed.members.map(opts.memberName).filter(Boolean);
        if (names.length) bits.push('👥 ' + names.join('·'));
      }
      if (parsed.title) bits.push('✏️ ' + parsed.title);
      var msg = bits.length ? '이렇게 채웠어요 → ' + bits.join(' · ') : '알아본 내용이 없어요';
      if (parsed.notes && parsed.notes.length) msg += '\n· ' + parsed.notes.join('\n· ');
      setStatus(msg);
      if (typeof opts.onStatus === 'function') opts.onStatus(parsed);
      return parsed;
    }
    function runNow() {
      if (timer) { clearTimeout(timer); timer = null; }
      return fill(area.value);
    }
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fill(area.value); }, 420);
    }
    function readClipboard() {
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
        setStatus('입력칸을 길게 눌러 [붙여넣기]를 눌러 주세요');
        try { area.focus(); } catch (e) { /* 무시 */ }
        return;
      }
      navigator.clipboard.readText().then(function (t) {
        if (!t || !t.trim()) {
          setStatus('클립보드가 비어 있어요 · 복사한 문자를 입력칸에 붙여넣어 주세요');
          try { area.focus(); } catch (e) { /* 무시 */ }
          return;
        }
        area.value = t;
        runNow();
      }, function () {
        setStatus('클립보드를 읽지 못했어요 · 입력칸을 길게 눌러 붙여넣어 주세요');
        try { area.focus(); } catch (e) { /* 무시 */ }
      });
    }

    entry.addEventListener('click', function () {
      if (!box.hidden) { closeBox(); return; }
      openBox(false);
      if (!area.value.trim() && opts.tryClipboard) readClipboard();
    });
    if (clipBtn) clipBtn.addEventListener('click', readClipboard);
    area.addEventListener('input', schedule);
    area.addEventListener('paste', function () { setTimeout(runNow, 60); });
    /* change(입력칸을 떠날 때)마다 다시 채우면 칸이 새로 그려져 방금 고른 날짜 후보가 풀리므로 input·paste만 씁니다. */
    if (runBtn) runBtn.addEventListener('click', runNow);
    if (clearBtn) clearBtn.addEventListener('click', function () {
      area.value = '';
      setStatus('');
      lastParsed = null;
      try { area.focus(); } catch (e) { /* 무시 */ }
    });

    return {
      open: function () { openBox(true); },
      close: closeBox,
      run: runNow,
      setText: function (t, autoRun) { area.value = t; if (autoRun !== false) runNow(); },
      last: function () { return lastParsed; }
    };
  }

  window.CalendarPaste = {
    parse: parse,
    clean: clean,
    attachUI: attachUI,
    version: '2026-11-18a'
  };
})();
