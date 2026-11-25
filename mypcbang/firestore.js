'use strict';
/* 마이피씨방 — 휴대폰이 10분마다 올린 측정값(Firestore)을 읽어 대시보드에 합칩니다.
   - 컬렉션: mypcbang_live(매장 최신값) · mypcbang_days(하루 누적) · mypcbang_samples(개별 기록) · mypcbang_status(앱 상태)
   - 읽기는 공개 규칙이라 로그인 없이 됩니다. 쓰기는 앱(등록된 기기)만.
   - 인터넷·규칙 문제로 못 읽어도 조용히 넘어가고, 정적 data/live.json 값만 보여 줍니다. */
window.MpbCloud = (function () {
  const PROJECT = 'family-calendar-woo';
  const KEY = 'AIzaSyCutf-64Bl3sXtm-xZtr5vRZUqwpkNI6NY';
  const DOCS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';

  const cache = {at: 0, key: '', data: null};

  function val(field) {
    if (!field) return null;
    if ('stringValue' in field) return field.stringValue;
    if ('integerValue' in field) return Number(field.integerValue);
    if ('doubleValue' in field) return Number(field.doubleValue);
    if ('booleanValue' in field) return field.booleanValue;
    if ('nullValue' in field) return null;
    if ('mapValue' in field) {
      const o = {}, f = field.mapValue.fields || {};
      Object.keys(f).forEach(k => { o[k] = val(f[k]); });
      return o;
    }
    if ('arrayValue' in field) return (field.arrayValue.values || []).map(val);
    if ('timestampValue' in field) return field.timestampValue;
    return null;
  }

  function fields(doc) {
    const o = {}, f = (doc && doc.fields) || {};
    Object.keys(f).forEach(k => { o[k] = val(f[k]); });
    return o;
  }

  async function get(path) {
    const r = await fetch(DOCS + '/' + path + '?key=' + KEY, {cache: 'no-store'});
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }

  async function query(body) {
    const r = await fetch(DOCS + ':runQuery?key=' + KEY, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), cache: 'no-store'
    });
    if (!r.ok) throw new Error('runQuery ' + r.status);
    return r.json();
  }

  const r1 = n => Math.round(n * 10) / 10;
  const r2 = n => Math.round(n * 100) / 100;

  /* mypcbang_days/{YYYY-MM-DD} → 일별·시간별 행 */
  function dayRows(doc) {
    const f = fields(doc);
    const out = {days: [], hourly: []};
    if (!f.day || !f.stores) return out;
    Object.keys(f.stores).forEach(sid => {
      const st = f.stores[sid] || {};
      const n = Number(st.samples || 0);
      if (!n) return;
      const on = r1(Number(st.sumOn || 0) / n);
      const pct = r2((Number(st.sumPct10 || 0) / 10) / n);
      out.days.push({day: f.day, store: sid, method: 'icmp', samples: n, fails: Number(st.fails || 0), on, pct, phone: true});
      const hours = st.hours || {};
      Object.keys(hours).forEach(h => {
        const b = hours[h] || {};
        const bn = Number(b.samples || 0);
        if (!bn) return;
        out.hourly.push({
          day: f.day, store: sid, hour: Number(h), method: 'icmp', samples: bn,
          on: r1(Number(b.sumOn || 0) / bn), pct: r2((Number(b.sumPct10 || 0) / 10) / bn), phone: true
        });
      });
    });
    return out;
  }

  /* 한 달치 일별 문서(최대 62개) */
  async function month(ym) {
    const [y, m] = String(ym || '').split('-').map(Number);
    if (!y || !m) return {days: [], hourly: []};
    const from = ym + '-01';
    const next = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
    const res = await query({
      structuredQuery: {
        from: [{collectionId: 'mypcbang_days'}],
        where: {
          compositeFilter: {
            op: 'AND', filters: [
              {fieldFilter: {field: {fieldPath: 'day'}, op: 'GREATER_THAN_OR_EQUAL', value: {stringValue: from}}},
              {fieldFilter: {field: {fieldPath: 'day'}, op: 'LESS_THAN', value: {stringValue: next}}}
            ]
          }
        },
        limit: 62
      }
    });
    const out = {days: [], hourly: []};
    (res || []).forEach(row => {
      if (!row || !row.document) return;
      const r = dayRows(row.document);
      out.days = out.days.concat(r.days);
      out.hourly = out.hourly.concat(r.hourly);
    });
    return out;
  }

  function iso(ms) {
    const n = Number(ms);
    return isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
  }

  /* 대시보드가 기대하는 live 모양으로 합칩니다. */
  function merge(staticLive, cloud) {
    const base = staticLive ? JSON.parse(JSON.stringify(staticLive)) : {timezone: 'Asia/Seoul'};
    base.stores = base.stores || {};
    base.days = base.days || [];
    base.hourly = base.hourly || [];
    base.recent = base.recent || [];
    if (!cloud) return base;

    let latest = 0;
    (cloud.live || []).forEach(doc => {
      const f = fields(doc);
      if (!f.store || !f.at) return;
      base.stores[f.store] = {
        on: f.on, pct: f.pct, t: iso(f.at), method: f.method || 'icmp',
        device: f.device, pcs: f.pcs, phone: true
      };
      latest = Math.max(latest, Number(f.at) || 0);
    });
    const st = cloud.status || null;
    if (st && st.at) latest = Math.max(latest, Number(st.at) || 0);
    if (latest) {
      base.updated_at = iso(latest);
      base.runner = null;
    }
    if (cloud.month && cloud.month.days) {
      const phoneDays = new Set(cloud.month.days.map(d => d.day));
      base.days = base.days.filter(d => !phoneDays.has(d.day)).concat(cloud.month.days);
    }
    if (cloud.month && cloud.month.hourly) {
      const phoneDays = new Set(cloud.month.hourly.map(h => h.day));
      base.hourly = base.hourly.filter(h => !phoneDays.has(h.day)).concat(cloud.month.hourly);
    }
    if (cloud.recent && cloud.recent.length) {
      base.recent = cloud.recent.concat(base.recent).slice(0, 480);
    }
    base.phone = st && st.device ? {device: st.device, ok: st.ok, error: st.error || '', at: iso(st.at), auto: st.auto} : null;
    return base;
  }

  async function load(ym) {
    const key = String(ym || '');
    const now = Date.now();
    if (cache.data && cache.key === key && now - cache.at < 45000) return cache.data;
    const data = {live: [], month: {days: [], hourly: []}, recent: [], status: null};
    try {
      const list = await get('mypcbang_live?pageSize=20');
      data.live = (list && list.documents) || [];
    } catch (e) {}
    try {
      data.month = await month(ym);
    } catch (e) {}
    try {
      const res = await query({
        structuredQuery: {
          from: [{collectionId: 'mypcbang_samples'}],
          orderBy: [{field: {fieldPath: 'at'}, direction: 'DESCENDING'}],
          limit: 120
        }
      });
      data.recent = (res || []).filter(r => r && r.document).map(r => {
        const f = fields(r.document);
        return {t: iso(f.at), store: f.store, on: f.on, pct: f.pct, phone: true};
      }).filter(r => r.t && r.store);
    } catch (e) {}
    try {
      const s = await get('mypcbang_status/latest');
      data.status = s ? fields(s) : null;
    } catch (e) {}
    cache.at = now;
    cache.key = key;
    cache.data = data;
    return data;
  }

  return {load, merge, fields, KEY};
})();
