'use strict';
/* 마이피씨방 1.0 — 정적 대시보드 (GitHub Pages) */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('ko-KR');
const onTxt = n => n == null || !isFinite(n) ? '—' : (Math.round(n * 10) / 10).toFixed(1);
const pctTxt = n => n == null || !isFinite(n) ? '—' : (Math.round(n * 10) / 10).toFixed(1) + '%';
const KST = 'Asia/Seoul';
function kstDate(d = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
}
function kstHour(d) {
  return Number(new Intl.DateTimeFormat('en-GB', {timeZone: KST, hour: '2-digit', hour12: false}).format(d));
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return new Intl.DateTimeFormat('ko-KR', {timeZone: KST, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(d);
}
function fmtClock(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return new Intl.DateTimeFormat('ko-KR', {timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false}).format(d);
}
const ago = iso => {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return m + '분 전';
  const h = Math.round(m / 60);
  if (h < 24) return h + '시간 전';
  return Math.round(h / 24) + '일 전';
};

const S = {
  stores: [], live: null, history: null, method: 'icmp', view: 'today',
  month: kstDate().slice(0, 7), day: kstDate(), settings: {hourly: null, coupon: null}
};

async function getJSON(path, bust) {
  const r = await fetch(path + (bust ? '?t=' + Date.now() : ''), {cache: bust ? 'no-store' : 'default'});
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}

/* ── 매장 ─────────────────────────────────────────────────────── */
function storeById(id) {
  return S.stores.find(s => s.id === id) || S.stores.find(s => s.legacy === Number(id)) ||
    {id: String(id), name: '매장 ' + id, short: '매장 ' + id, color: '#64748b', pcs: 0};
}
function keyOf(id) { return String(storeById(id).id); }
function legacyMap() {
  const m = {};
  S.stores.forEach(s => { if (s.legacy != null) m[String(s.legacy)] = s.id; });
  return m;
}
function localStores() {
  try { return JSON.parse(localStorage.getItem('mypcbang.localStores') || '[]'); } catch (e) { return []; }
}

/* ── 자료 합치기 ──────────────────────────────────────────────── */
/* dayMap[day][storeId] = {samples, pct, on, method} */
function dayMap(method) {
  const lm = legacyMap();
  const map = {};
  const put = (day, sid, row) => {
    const id = keyOf(lm[String(sid)] || sid);
    (map[day] = map[day] || {});
    if (!map[day][id] || (map[day][id].samples || 0) < (row.samples || 0)) map[day][id] = row;
  };
  if (S.history) {
    S.history.days.forEach(d => {
      if (d.method !== method) return;
      put(d.day, d.store, {...d});
    });
  }
  if (S.live && S.live.days) {
    S.live.days.forEach(d => {
      if ((d.method || 'icmp') !== method) return;
      put(d.day, d.store, {...d});
    });
  }
  return map;
}
/* hourMap[storeId][hour] = {pct, on, samples} for one day */
function hourMap(day, method) {
  const lm = legacyMap();
  const out = {};
  const put = (row) => {
    const id = keyOf(lm[String(row.store)] || row.store);
    (out[id] = out[id] || {})[row.hour] = {pct: row.pct, on: row.on, samples: row.samples};
  };
  if (S.history) S.history.hourly.forEach(r => { if (r.day === day && r.method === method) put(r); });
  if (S.live && S.live.hourly) S.live.hourly.forEach(r => { if (r.day === day && (r.method || 'icmp') === method) put(r); });
  return out;
}
function latestOf(method) {
  const out = {};
  if (S.live && S.live.stores) {
    Object.entries(S.live.stores).forEach(([id, v]) => {
      if ((v.method || 'icmp') === method) out[keyOf(id)] = v;
    });
  }
  if (!Object.keys(out).length && S.history) {
    const map = dayMap(method);
    const days = Object.keys(map).sort();
    const last = days[days.length - 1];
    if (last) Object.entries(map[last]).forEach(([id, v]) => out[id] = {...v, t: null, day: last});
  }
  return out;
}

/* ── 화면 ────────────────────────────────────────────────────── */
function renderStatus() {
  const el = $('#status');
  el.className = 'status';
  if (!S.live || !S.live.updated_at) {
    el.textContent = '자동 측정 첫 기록을 기다리는 중입니다 · 지난 기록(11/10까지)은 그대로 볼 수 있습니다';
    el.classList.add('warn');
    return;
  }
  const min = Math.round((Date.now() - Date.parse(S.live.updated_at)) / 60000);
  const base = '마지막 측정 ' + fmtTime(S.live.updated_at) + ' (' + ago(S.live.updated_at) + ')';
  if (min > 40) {
    el.textContent = base + ' · 측정이 지연되고 있습니다';
    el.classList.add('bad');
  } else {
    el.textContent = base + ' · 10분마다 자동 측정';
  }
}

function renderCards() {
  const latest = latestOf(S.method);
  const dm = dayMap(S.method);
  const today = kstDate();
  const label = S.method === 'icmp' ? 'IP 응답률' : '가동률';
  const all = S.stores.concat(localStores().map(s => ({...s, local: true})));
  $('#cards').innerHTML = all.map((s, i) => {
    const v = latest[s.id];
    const row = (dm[today] || {})[s.id];
    const stale = !v || (v.t ? Date.now() - Date.parse(v.t) > 40 * 60000 : true);
    const cls = (i % 2 ? 'card g' : 'card') + (stale ? ' stale' : '');
    return `<article class="${cls}">
      <b>${esc(s.short || s.name)}${s.local ? ' <span class="badge warn">이 기기</span>' : ''}</b>
      <span class="big">${v && v.on != null ? num(v.on) : '—'}<span>대 / ${num(s.pcs)}대</span></span>
      <div class="pct">${label} ${pctTxt(v ? v.pct : null)}</div>
      <span class="when">${v ? (v.t ? fmtTime(v.t) + ' · ' + ago(v.t) : (v.day ? v.day.slice(5) + ' 기록' : '기록')) : '측정 대기'}</span>
      <div class="avg">오늘 평균 ${row && row.on != null ? onTxt(row.on) + '대 · ' + pctTxt(row.pct) : '—'}</div>
    </article>`;
  }).join('');
  const missing = S.stores.filter(s => !latest[s.id]);
  $('#storeNote').textContent = missing.length ? missing.map(s => s.short || s.name).join(', ') + ' · 아직 자동 측정 기록이 없습니다' : '';
}

function drawChart(el, hours, ids, label) {
  const W = 360, H = 180, L = 30, R = 8, T = 12, B = 24;
  const vals = [];
  ids.forEach(id => Object.values((hours[id] || {})).forEach(v => { if (v.on != null) vals.push(v.on); }));
  const max = vals.length ? Math.max(...vals) * 1.15 : 1;
  const x = h => L + (h / 23) * (W - L - R);
  const y = v => T + (1 - v / max) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} 시간별 비교 그래프">`;
  for (let k = 0; k <= 3; k++) {
    const v = max * k / 3, yy = y(v);
    svg += `<line x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#eaf0f8"/>`
         + `<text x="2" y="${(yy + 3).toFixed(1)}" font-size="8" fill="#94a3b8">${Math.round(v)}</text>`;
  }
  [0, 6, 12, 18, 23].forEach(h => {
    svg += `<text x="${x(h).toFixed(1)}" y="${H - 6}" font-size="8.5" fill="#94a3b8" text-anchor="middle">${String(h).padStart(2, '0')}시</text>`;
  });
  ids.forEach(id => {
    const st = storeById(id);
    const pts = [];
    for (let h = 0; h < 24; h++) {
      const v = (hours[id] || {})[h];
      if (v && v.on != null) pts.push([x(h), y(v.on), v.on]);
    }
    if (!pts.length) return;
    svg += `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="${st.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach(p => { svg += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.2" fill="${st.color}"/>`; });
  });
  el.innerHTML = svg + '</svg>' + (vals.length ? '' : '<p class="chartEmpty">이 날짜의 측정 기록이 없습니다</p>');
}

function legend(ids, el) {
  el.innerHTML = ids.map(id => { const s = storeById(id); return `<span><i style="background:${s.color}"></i>${esc(s.short || s.name)}</span>`; }).join('');
}

function renderToday() {
  const today = kstDate();
  $('#todayLabel').textContent = today;
  const hours = hourMap(today, S.method);
  const ids = S.stores.map(s => s.id);
  drawChart($('#chartToday'), hours, ids, '오늘');
  legend(ids, $('#legendToday'));
  const hourList = [...new Set(ids.flatMap(id => Object.keys(hours[id] || {}).map(Number)))].sort((a, b) => a - b);
  let html = '<thead><tr><th>시간</th>' + ids.map(id => `<th colspan="2" class="${id === ids[1] ? 'g' : 'ox'}">${esc(storeById(id).short)}</th>`).join('') + '</tr>'
    + '<tr><th></th>' + ids.map(() => '<th>대수</th><th>%</th>').join('') + '</tr></thead><tbody>';
  if (!hourList.length) html += `<tr><td class="empty" colspan="${1 + ids.length * 2}">오늘 측정 기록이 아직 없습니다.</td></tr>`;
  hourList.forEach(h => {
    html += `<tr><td>${String(h).padStart(2, '0')}시</td>` + ids.map(id => {
      const v = (hours[id] || {})[h];
      return `<td><b>${v && v.on != null ? onTxt(v.on) : '—'}</b></td><td>${v ? pctTxt(v.pct) : '—'}</td>`;
    }).join('') + '</tr>';
  });
  $('#tableToday').innerHTML = html + '</tbody>';
  renderDaySummary($('#tableTodaySum'), [today]);
}

function renderDaySummary(el, days) {
  const dm = dayMap(S.method);
  const ids = S.stores.map(s => s.id);
  const label = S.method === 'icmp' ? 'IP 응답률' : '가동률';
  const stats = ids.map(id => {
    let n = 0, sumPct = 0, sumOn = 0, nOn = 0, dayN = 0;
    days.forEach(d => {
      const r = (dm[d] || {})[id];
      if (!r) return;
      dayN++;
      n += r.samples || 0;
      if (r.pct != null) { sumPct += r.pct; }
      if (r.on != null) { sumOn += r.on; nOn++; }
    });
    return {dayN, n, pct: dayN ? sumPct / dayN : null, on: nOn ? sumOn / nOn : null};
  });
  el.innerHTML = '<thead><tr><th>항목</th>' + ids.map(id => `<th class="${id === ids[1] ? 'g' : 'ox'}">${esc(storeById(id).short)}</th>`).join('') + '</tr></thead><tbody>'
    + '<tr><th>평균 가동대수</th>' + stats.map(s => `<td><b>${onTxt(s.on)}</b>대</td>`).join('') + '</tr>'
    + `<tr><th>평균 ${label}</th>` + stats.map(s => `<td>${pctTxt(s.pct)}</td>`).join('') + '</tr>'
    + '<tr><th>측정 횟수</th>' + stats.map(s => `<td>${num(s.n)}회</td>`).join('') + '</tr>'
    + '<tr><th>기록 일수</th>' + stats.map(s => `<td>${s.dayN}일</td>`).join('') + '</tr>'
    + '</tbody>';
}

function daysOfMonth(month) {
  const dm = dayMap(S.method);
  return Object.keys(dm).filter(d => d.startsWith(month)).sort().reverse();
}

function renderDaily() {
  $('#monthPick').value = S.month;
  const days = daysOfMonth(S.month);
  const ids = S.stores.map(s => s.id);
  const dm = dayMap(S.method);
  const label = S.method === 'icmp' ? 'IP 응답률' : '가동률';
  let html = '<thead><tr><th>날짜</th>' + ids.map(id => `<th colspan="2" class="${id === ids[1] ? 'g' : 'ox'}">${esc(storeById(id).short)}</th>`).join('') + '</tr>'
    + '<tr><th></th>' + ids.map(() => '<th>평균 대수</th><th>' + label + '</th>').join('') + '</tr></thead><tbody>';
  if (!days.length) html += `<tr><td class="empty" colspan="${1 + ids.length * 2}">이 달의 기록이 없습니다.</td></tr>`;
  days.forEach(d => {
    html += `<tr><td>${d.slice(5)} <span class="sm">${'일월화수목금토'.charAt(new Date(d + 'T00:00:00+09:00').getDay())}</span></td>` + ids.map(id => {
      const r = (dm[d] || {})[id];
      return `<td><b>${r && r.on != null ? onTxt(r.on) : '—'}</b></td><td>${r ? pctTxt(r.pct) : '—'}</td>`;
    }).join('') + '</tr>';
  });
  $('#tableDaily').innerHTML = html + '</tbody>';
  $('#monthNote').textContent = days.length ? `보관 기록: ${days[days.length - 1]} ~ ${days[0]} · ${days.length}일 (미수집 날짜 제외)` : '';
  renderDayChart();
}

function renderDayChart() {
  const day = $('#dayPick').value || S.day;
  const hours = hourMap(day, S.method);
  const ids = S.stores.map(s => s.id);
  drawChart($('#chartDay'), hours, ids, day);
  legend(ids, $('#legendDay'));
  const hourList = [...new Set(ids.flatMap(id => Object.keys(hours[id] || {}).map(Number)))].sort((a, b) => a - b);
  let html = '<thead><tr><th>시간</th>' + ids.map(id => `<th colspan="2" class="${id === ids[1] ? 'g' : 'ox'}">${esc(storeById(id).short)}</th>`).join('') + '</tr>'
    + '<tr><th></th>' + ids.map(() => '<th>대수</th><th>%</th>').join('') + '</tr></thead><tbody>';
  if (!hourList.length) html += `<tr><td class="empty" colspan="${1 + ids.length * 2}">이 날짜의 기록이 없습니다.</td></tr>`;
  hourList.forEach(h => {
    html += `<tr><td>${String(h).padStart(2, '0')}시</td>` + ids.map(id => {
      const v = (hours[id] || {})[h];
      return `<td><b>${v && v.on != null ? onTxt(v.on) : '—'}</b></td><td>${v ? pctTxt(v.pct) : '—'}</td>`;
    }).join('') + '</tr>';
  });
  $('#tableDayHours').innerHTML = html + '</tbody>';
}

function renderMonth() {
  const month = S.month;
  $('#monthTitle').textContent = month.replace('-', '년 ') + '월';
  const days = daysOfMonth(month);
  renderDaySummary($('#tableMonth'), days);
  /* 매출 추정 */
  const dm = dayMap(S.method);
  const ids = S.stores.map(s => s.id);
  const rowStats = ids.map(id => {
    let sumOn = 0, n = 0, dayN = 0;
    days.forEach(d => {
      const r = (dm[d] || {})[id];
      if (!r || r.on == null) return;
      sumOn += r.on; n++; dayN++;
    });
    return {on: n ? sumOn / n : null, dayN};
  });
  const hourRate = S.settings.hourly || null;
  const head = '<thead><tr><th>항목</th>' + ids.map(id => `<th class="${id === ids[1] ? 'g' : 'ox'}">${esc(storeById(id).short)}</th>`).join('') + '</tr></thead><tbody>';
  const rows = [];
  const calc = rowStats.map((st, i) => {
    const s = storeById(ids[i]);
    const rate = hourRate || s.hourly || 1290;
    const couponPct = (S.settings.coupon && i === 0) ? S.settings.coupon : (s.coupon || 60);
    if (st.on == null) return null;
    const coupon = st.on * 24 * rate;
    const total = coupon / (couponPct / 100);
    return {rate, couponPct, coupon, food: total - coupon, total};
  });
  rows.push('<tr><th>하루 추정 매출</th>' + calc.map(c => c ? `<td><b>${num(Math.round(c.total))}</b>원</span></td>` : '<td>—</td>').join('') + '</tr>');
  rows.push('<tr><th>· 쿠폰</th>' + calc.map(c => c ? `<td>${num(Math.round(c.coupon))}원</td>` : '<td>—</td>').join('') + '</tr>');
  rows.push('<tr><th>· 음식</th>' + calc.map(c => c ? `<td>${num(Math.round(c.food))}원</td>` : '<td>—</td>').join('') + '</tr>');
  rows.push('<tr><th>월 추정 매출 (30일)</th>' + calc.map(c => c ? `<td><b>${num(Math.round(c.total * 30 / 10000))}</b>만원</td>` : '<td>—</td>').join('') + '</tr>');
  rows.push('<tr><th>PC 1대당 하루</th>' + calc.map((c, i) => c ? `<td>${num(Math.round(c.total / (storeById(ids[i]).pcs || 1) / 100) / 10)}천원</td>` : '<td>—</td>').join('') + '</tr>');
  $('#tableRevenue').innerHTML = head + rows.join('') + '</tbody>';
  const cs = storeById(ids[0]);
  if (!$('#setHourly').value) $('#setHourly').value = hourRate || cs.hourly || 1290;
  if (!$('#setCoupon').value) $('#setCoupon').value = cs.coupon || 52;
}

function renderLog() {
  const rows = (S.live && S.live.recent) ? S.live.recent : [];
  $('#logCount').textContent = rows.length ? rows.length + '건' : '';
  if (!rows.length) {
    $('#logRows').innerHTML = '<tr><td class="empty" colspan="4">자동 측정 기록이 아직 없습니다.</td></tr>';
    return;
  }
  $('#logRows').innerHTML = rows.slice(0, 300).map(r => {
    const s = storeById(r.store);
    return `<tr><td>${fmtTime(r.t)}</td><td><span style="color:${s.color}">${esc(s.short)}</span></td><td><b>${r.on != null ? onTxt(r.on) : '실패'}</b></td><td>${pctTxt(r.pct)}</td></tr>`;
  }).join('');
}

function render() {
  renderStatus();
  renderCards();
  renderToday();
  renderDaily();
  renderMonth();
  renderLog();
}

async function load(bust) {
  try {
    if (!S.stores.length) {
      const cfg = await getJSON('data/stores.json', true);
      S.stores = cfg.stores.filter(s => s.enabled !== false);
    }
    try { S.live = await getJSON('data/live.json', bust); } catch (e) { S.live = null; }
    if (!S.history) { try { S.history = await getJSON('data/history.json'); } catch (e) { S.history = null; } }
    render();
    if (!S.liveLoaded) { S.liveLoaded = true; setView(S.live && S.live.updated_at ? 'today' : 'daily'); }
  } catch (e) {
    $('#status').textContent = '자료를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.';
    $('#status').className = 'status bad';
  }
}

/* ── 조작 ────────────────────────────────────────────────────── */
function setView(name) {
  S.view = name;
  $$('.seg button').forEach(x => x.classList.toggle('on', x.dataset.view === name));
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  if (name === 'daily') renderDaily();
  if (name === 'month') renderMonth();
}
$$('.seg button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('#method').addEventListener('change', e => { S.method = e.target.value; render(); });
$('#monthPick').addEventListener('change', e => { S.month = e.target.value; renderDaily(); renderMonth(); });
$('#dayPick').addEventListener('change', e => { S.day = e.target.value; renderDayChart(); });
$('#reload').addEventListener('click', () => load(true));
$('#reload2').addEventListener('click', () => load(true));
$('#setHourly').addEventListener('change', e => { S.settings.hourly = Number(e.target.value) || null; renderMonth(); });
$('#setCoupon').addEventListener('change', e => { S.settings.coupon = Number(e.target.value) || null; renderMonth(); });

$('#csv').addEventListener('click', () => {
  const rows = [['시각', '매장', '대수', '응답률']].concat((S.live && S.live.recent || []).map(r => [r.t, storeById(r.store).short, r.on, r.pct]));
  const csv = '\ufeff' + rows.map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
  a.download = '마이피씨방-기록-' + kstDate() + '.csv';
  a.click();
});

$('#addStore').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const item = {
    id: 'local-' + Date.now(), name: String(f.get('name')).trim(), short: String(f.get('name')).trim(),
    ip: String(f.get('ip')).trim(), pcs: Number(f.get('pcs')) || 0, color: '#7c3aed', local: true
  };
  const list = localStores(); list.push(item);
  localStorage.setItem('mypcbang.localStores', JSON.stringify(list));
  $('#addOut').innerHTML = '이 기기에 추가했습니다. 자동 측정까지 연결하려면 아래 설정 코드를 피클에게 보내 주세요.<br>'
    + `<code>${esc(JSON.stringify({name: item.name, ip: item.ip, pcs: item.pcs}))}</code>`;
  e.currentTarget.reset();
  renderCards();
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
load(false);
setInterval(() => { if (!document.hidden) load(true); }, 120000);
