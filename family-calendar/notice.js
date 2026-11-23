/* 📢 공지 — 화면(상단 배너 + 공지함 시트). 가족 달력·매장 달력이 함께 씁니다.
   - app.js 는 NoticeBoard.setup('family', {...}), store.js 는 NoticeBoard.setup('store', {...}) 로 연결합니다.
   - 공지 데이터는 방 문서에서 onRoom 으로 들어오고(NoticeBoard.setData), 쓰기는 adapter.save/remove/check 가 맡습니다.
   - 서버에 붙기 전(오프라인)에는 이 기기 저장소에 임시 보관했다가 연결되면 자동으로 올립니다.
   - 제목·본문·작성자·확인한 사람은 모두 textContent 로만 그립니다(XSS 방지).
*/
(function () {
  'use strict';

  var boards = { family: null, store: null };
  var active = '';
  var view = 'list';        /* list | detail | form */
  var selectedId = '';
  var editingId = '';
  var el = {};
  var bound = false;
  var KEY_PREFIX = 'family-calendar.notice.v1.';

  /* ---------------- 작은 도구 ---------------- */
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function txt(node, s) { if (node) node.textContent = s == null ? '' : String(s); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function newId() { return 'nt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function firstLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function whenText(n) {
    var base = Number(n.updatedAt || n.createdAt || 0);
    if (!base) return '';
    var d = new Date(base);
    var now = new Date();
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var label;
    if (sameDay(d, now)) label = '오늘 ' + hm;
    else if (sameDay(d, new Date(now.getTime() - 86400000))) label = '어제 ' + hm;
    else if (d.getFullYear() === now.getFullYear()) label = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + hm;
    else label = d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + ' ' + hm;
    if (n.updatedAt && n.createdAt && n.updatedAt - n.createdAt > 60000) label += ' 수정';
    return label;
  }
  function authorLine(n) {
    var name = String(n.authorName || '').trim();
    return name ? name : '가족';
  }
  function meKey(me) { return String((me && (me.uid || me.id)) || ''); }
  /* 확인 기록 맞추기 — 계정(uid)으로 먼저, 오프라인에서 남긴 기록은 구성원 id 로도 맞춥니다. */
  function checkIsMine(c, me) {
    if (!c || !me) return false;
    var uid = String(me.uid || '');
    var id = String(me.id || '');
    var key = String(c.uid || '');
    return !!key && ((uid && key === uid) || (id && key === id));
  }
  function checkedByMe(n, me) {
    if (!me || !Array.isArray(n.checks)) return false;
    for (var i = 0; i < n.checks.length; i++) if (checkIsMine(n.checks[i], me)) return true;
    return false;
  }
  function checkNames(n) {
    var out = [];
    (n.checks || []).forEach(function (c) {
      var name = String((c && c.name) || '').trim();
      if (name && out.indexOf(name) < 0) out.push(name);
    });
    return out;
  }

  /* ---------------- 보드(가족/매장) ---------------- */
  function storeKey(b) {
    var code = '';
    try { code = b.adapter.code ? String(b.adapter.code() || '') : ''; } catch (e) { code = ''; }
    return KEY_PREFIX + (code || 'local');
  }
  function loadPending(key) {
    var raw = '';
    try { raw = localStorage.getItem(key) || ''; } catch (e) { return []; }
    if (!raw) return [];
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(parsed)) return [];
    var out = [];
    parsed.forEach(function (r) {
      if (!r || typeof r !== 'object' || !r.id) return;
      out.push({
        id: String(r.id).slice(0, 40),
        title: String(r.title || '').slice(0, 60),
        body: String(r.body || '').slice(0, 1000),
        pinned: r.pinned === true,
        authorId: String(r.authorId || '').slice(0, 40),
        authorName: String(r.authorName || '').slice(0, 12),
        authorUid: String(r.authorUid || '').slice(0, 128),
        createdAt: Number(r.createdAt) || 0,
        updatedAt: Number(r.updatedAt) || 0,
        checks: Array.isArray(r.checks) ? r.checks : [],
        pending: true
      });
    });
    return out;
  }
  function savePending(b) {
    try {
      if (!b.pending.length) localStorage.removeItem(b.key);
      else localStorage.setItem(b.key, JSON.stringify(b.pending));
    } catch (e) { /* 저장 못해도 화면은 그대로 */ }
  }
  function syncKey(b) {
    var key = storeKey(b);
    if (key === b.key) return;
    b.key = key;
    b.pending = loadPending(key);
  }
  function boardOf(name) {
    var b = boards[name];
    if (b) syncKey(b);
    return b;
  }

  /* 화면에 보여 줄 목록 — 이 기기에만 있는 공지(pending)를 먼저, 서버 공지를 그다음.
     같은 id 는 pending 이 이깁니다(오프라인에서 고친 내용이 잠시 서버 사본에 가려지지 않게). */
  function listOf(b) {
    var out = [];
    var seen = {};
    (b.pending || []).forEach(function (n) {
      if (!n || !n.id || seen[n.id]) return;
      seen[n.id] = 1;
      out.push(n);
    });
    (b.server || []).forEach(function (n) {
      if (!n || !n.id || seen[n.id]) return;
      seen[n.id] = 1;
      out.push(n);
    });
    out.sort(function (a, b2) {
      if (!!b2.pinned !== !!a.pinned) return b2.pinned ? 1 : -1;
      return (b2.updatedAt || b2.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
    return out;
  }
  function findById(b, id) {
    var list = listOf(b);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------------- 배너 ---------------- */
  function paint(name) {
    var b = boards[name];
    if (!b || !b.adapter) return;
    /* 오프라인에 쌓아 둔 공지가 있으면 연결되는 순간 올립니다(화면이 다시 그려질 때마다 확인). */
    if (b.pending && b.pending.length) flush(b);
    var host = b.adapter.banner ? b.adapter.banner() : null;
    if (!host) return;
    var list = listOf(b);
    var me = b.adapter.me ? b.adapter.me() : null;
    var canWrite = false;
    try { canWrite = !!(b.adapter.canWrite && b.adapter.canWrite()); } catch (e) { canWrite = false; }

    host.innerHTML = '';
    if (!list.length) {
      if (!canWrite) { host.hidden = true; return; }
      host.hidden = false;
      var add = make('button', 'notice-banner__write');
      add.type = 'button';
      add.appendChild(make('span', 'notice-banner__icon', '📢'));
      add.appendChild(make('span', 'notice-banner__writeText', '+ 공지 쓰기'));
      add.appendChild(make('span', 'notice-banner__writeHint', (b.adapter.writeHint && b.adapter.writeHint()) || '모두에게 알리기'));
      add.addEventListener('click', function () { open(name, 'form'); });
      host.appendChild(add);
      return;
    }

    host.hidden = false;
    var top = list[0];
    var btn = make('button', 'notice-banner__main' + (top.pinned ? ' is-pinned' : ''));
    btn.type = 'button';
    btn.setAttribute('aria-label', '공지 보기');
    btn.appendChild(make('span', 'notice-banner__icon', top.pinned ? '📌' : '📢'));
    var body = make('span', 'notice-banner__body');
    var title = String(top.title || '').trim() || firstLine(top.body).slice(0, 40);
    body.appendChild(make('strong', 'notice-banner__title', title));
    var snippet = String(top.title || '').trim() ? firstLine(top.body) : '';
    if (snippet) body.appendChild(make('span', 'notice-banner__snippet', snippet));
    btn.appendChild(body);
    var side = make('span', 'notice-banner__side');
    if (!checkedByMe(top, me)) side.appendChild(make('i', 'notice-banner__dot', ''));
    else side.appendChild(make('i', 'notice-banner__ok', '✓'));
    side.appendChild(make('span', 'notice-banner__more', list.length > 1 ? '공지 ' + list.length + ' ›' : '전체 ›'));
    btn.appendChild(side);
    btn.addEventListener('click', function () { open(name, 'list'); });
    host.appendChild(btn);
  }

  /* ---------------- 시트(공지함) ---------------- */
  function bindDom() {
    if (bound) return;
    el.modal = document.getElementById('noticeModal');
    if (!el.modal) return;
    el.listView = document.getElementById('noticeListView');
    el.sheetTitle = document.getElementById('noticeSheetTitle');
    el.detailView = document.getElementById('noticeDetailView');
    el.formView = document.getElementById('noticeFormView');
    el.list = document.getElementById('noticeList');
    el.empty = document.getElementById('noticeEmpty');
    el.hint = document.getElementById('noticeListHint');
    el.writeBtn = document.getElementById('noticeWriteBtn');
    el.close = document.getElementById('noticeClose');
    el.back = document.getElementById('noticeBackBtn');
    el.dTitle = document.getElementById('noticeDetailTitle');
    el.dMeta = document.getElementById('noticeDetailMeta');
    el.dBody = document.getElementById('noticeDetailBody');
    el.dPin = document.getElementById('noticeDetailPin');
    el.checkBtn = document.getElementById('noticeCheckBtn');
    el.checkWho = document.getElementById('noticeCheckWho');
    el.editBtn = document.getElementById('noticeEditBtn');
    el.deleteBtn = document.getElementById('noticeDeleteBtn');
    el.pendingNote = document.getElementById('noticePendingNote');
    el.fTitle = document.getElementById('noticeFormTitle');
    el.fBody = document.getElementById('noticeFormBody');
    el.fPin = document.getElementById('noticeFormPin');
    el.fHint = document.getElementById('noticeFormHint');
    el.formError = document.getElementById('noticeFormError');
    el.saveBtn = document.getElementById('noticeSaveBtn');
    el.cancelBtn = document.getElementById('noticeCancelBtn');

    if (el.close) el.close.addEventListener('click', close);
    var backdrop = el.modal.querySelector('[data-close]');
    if (backdrop) backdrop.addEventListener('click', close);
    if (el.back) el.back.addEventListener('click', function () { view = 'list'; selectedId = ''; renderModal(); });
    if (el.writeBtn) el.writeBtn.addEventListener('click', function () { openForm(null); });
    if (el.cancelBtn) el.cancelBtn.addEventListener('click', function () {
      if (editingId) { editingId = ''; view = selectedId ? 'detail' : 'list'; renderModal(); return; }
      if (selectedId) { view = 'detail'; renderModal(); } else close();
    });
    if (el.saveBtn) el.saveBtn.addEventListener('click', submitForm);
    if (el.checkBtn) el.checkBtn.addEventListener('click', toggleCheck);
    if (el.editBtn) el.editBtn.addEventListener('click', function () {
      var b = currentBoard();
      var n = b ? findById(b, selectedId) : null;
      if (n) openForm(n);
    });
    if (el.deleteBtn) el.deleteBtn.addEventListener('click', removeSelected);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!el.modal || el.modal.hidden) return;
      close();
    });
    bound = true;
  }

  function currentBoard() { return active ? boards[active] : null; }

  function open(name, startView) {
    var b = boardOf(name);
    if (!b || !b.adapter) return;
    bindDom();
    if (!el.modal) return;
    active = name;
    view = 'list';
    selectedId = '';
    editingId = '';
    if (el.hint) txt(el.hint, b.adapter.hint ? b.adapter.hint() : '');
    if (el.sheetTitle) txt(el.sheetTitle, (b.adapter.title && b.adapter.title()) || '📢 공지');
    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    var wantForm = startView === 'form' && b.adapter.canWrite && b.adapter.canWrite();
    if (wantForm) { openForm(null); return; }
    /* 공지가 한 건뿐이면 목록을 거치지 않고 바로 전체 내용을 보여 줍니다(한 번 더 누르는 수고 줄이기). */
    if (startView !== 'form') {
      var only = listOf(b);
      if (only.length === 1) { selectedId = only[0].id; view = 'detail'; }
    }
    renderModal();
  }

  function close() {
    if (!el.modal) return;
    el.modal.hidden = true;
    document.body.style.overflow = '';
    view = 'list';
    selectedId = '';
    editingId = '';
  }

  function renderModal() {
    if (!el.modal || el.modal.hidden) return;
    var b = currentBoard();
    if (!b) return;
    if (view !== 'form') {
      el.listView.hidden = view !== 'list';
      el.detailView.hidden = view !== 'detail';
      el.formView.hidden = true;
      if (view === 'list') renderList(b);
      else renderDetail(b);
      return;
    }
    el.listView.hidden = true;
    el.detailView.hidden = true;
    el.formView.hidden = false;
    if (el.fHint) txt(el.fHint, b.adapter.hint ? b.adapter.hint() : '');
  }

  function renderList(b) {
    var list = listOf(b);
    var me = b.adapter.me ? b.adapter.me() : null;
    el.list.innerHTML = '';
    if (el.empty) el.empty.hidden = !!list.length;
    if (el.writeBtn) el.writeBtn.hidden = !(b.adapter.canWrite && b.adapter.canWrite());
    list.forEach(function (n) {
      var li = make('li', 'notice-item' + (n.pinned ? ' is-pinned' : ''));
      var head = make('div', 'notice-item__head');
      if (n.pinned) head.appendChild(make('span', 'notice-item__pin', '📌'));
      head.appendChild(make('strong', 'notice-item__title', String(n.title || '').trim() || firstLine(n.body).slice(0, 30)));
      if (!checkedByMe(n, me)) head.appendChild(make('span', 'notice-item__new', '새 공지'));
      li.appendChild(head);
      var snippet = String(n.title || '').trim() ? firstLine(n.body) : '';
      if (snippet) li.appendChild(make('p', 'notice-item__body', snippet));
      var meta = make('p', 'notice-item__meta');
      meta.appendChild(make('span', null, authorLine(n)));
      meta.appendChild(make('span', null, whenText(n)));
      var names = checkNames(n);
      meta.appendChild(make('span', 'notice-item__checks', names.length ? '확인 ' + names.length + '명' : '확인 0명'));
      if (n.pending) meta.appendChild(make('span', 'notice-item__pending', '이 기기에만'));
      li.appendChild(meta);
      li.addEventListener('click', function () { selectedId = n.id; view = 'detail'; renderModal(); });
      el.list.appendChild(li);
    });
  }

  function renderDetail(b) {
    var n = findById(b, selectedId);
    if (!n) { view = 'list'; renderList(b); return; }
    el.listView.hidden = true;
    el.detailView.hidden = false;
    el.formView.hidden = true;
    txt(el.dTitle, String(n.title || '').trim() || firstLine(n.body).slice(0, 40) || '공지');
    txt(el.dMeta, authorLine(n) + (whenText(n) ? ' · ' + whenText(n) : ''));
    if (el.dBody) el.dBody.textContent = String(n.body || '');
    if (el.dPin) el.dPin.hidden = !n.pinned;
    var me = b.adapter.me ? b.adapter.me() : null;
    var mine = checkedByMe(n, me);
    if (el.checkBtn) {
      txt(el.checkBtn, mine ? '✓ 확인했어요' : '확인했어요');
      el.checkBtn.classList.toggle('is-on', mine);
      el.checkBtn.setAttribute('aria-pressed', mine ? 'true' : 'false');
    }
    if (el.checkWho) {
      var names = checkNames(n);
      el.checkWho.hidden = false;
      txt(el.checkWho, names.length ? '확인한 사람 ' + names.length + '명 · ' + names.join(', ') : '아직 확인한 사람이 없어요');
    }
    if (el.pendingNote) el.pendingNote.hidden = !n.pending;
    var canEdit = !!(b.adapter.canEdit && b.adapter.canEdit(n));
    if (el.editBtn) el.editBtn.hidden = !canEdit;
    if (el.deleteBtn) el.deleteBtn.hidden = !canEdit;
  }

  function openForm(prev) {
    var b = currentBoard();
    if (!b) return;
    if (!b.adapter.canWrite || !b.adapter.canWrite()) return;
    bindDom();
    editingId = prev ? prev.id : '';
    selectedId = prev ? prev.id : '';
    view = 'form';
    if (el.fTitle) el.fTitle.value = prev ? String(prev.title || '') : '';
    if (el.fBody) el.fBody.value = prev ? String(prev.body || '') : '';
    if (el.fPin) el.fPin.checked = !!(prev && prev.pinned);
    if (el.formError) el.formError.hidden = true;
    if (el.saveBtn) txt(el.saveBtn, prev ? '수정 저장' : '공지 올리기');
    if (el.fHint) txt(el.fHint, b.adapter.hint ? b.adapter.hint() : '');
    renderModal();
    if (el.fBody) { try { el.fBody.focus(); } catch (e) { /* 무시 */ } }
  }

  function formError(msg) {
    if (!el.formError) return;
    txt(el.formError, msg);
    el.formError.hidden = !msg;
  }

  function submitForm() {
    var b = currentBoard();
    if (!b) return;
    if (!b.adapter.canWrite || !b.adapter.canWrite()) { formError('공지를 쓸 권한이 없어요.'); return; }
    var title = el.fTitle ? el.fTitle.value.trim() : '';
    var body = el.fBody ? el.fBody.value.trim() : '';
    if (!title && !body) { formError('공지 내용을 넣어 주세요.'); return; }
    formError('');
    var me = (b.adapter.me && b.adapter.me()) || {};
    var prev = editingId ? findById(b, editingId) : null;
    var rec = {
      id: editingId || newId(),
      title: title,
      body: body,
      pinned: !!(el.fPin && el.fPin.checked),
      authorId: prev ? prev.authorId : String(me.id || ''),
      authorName: prev ? prev.authorName : String(me.name || ''),
      authorUid: prev ? prev.authorUid : String(me.uid || ''),
      createdAt: prev ? prev.createdAt : Date.now(),
      updatedAt: prev ? Date.now() : 0,
      checks: prev && Array.isArray(prev.checks) ? prev.checks.slice() : []
    };
    var wasEditing = !!editingId;
    var ready = false;
    try { ready = !!(b.adapter.ready && b.adapter.ready()); } catch (e) { ready = false; }

    /* 오프라인 — 이 기기에 임시 보관했다가 연결되면 자동으로 올립니다. */
    if (!ready || (prev && prev.pending)) {
      rec.pending = true;
      var idx = -1;
      for (var i = 0; i < b.pending.length; i++) if (b.pending[i].id === rec.id) { idx = i; break; }
      if (idx >= 0) b.pending[idx] = rec; else b.pending.push(rec);
      savePending(b);
      editingId = '';
      selectedId = rec.id;
      view = 'detail';
      paint(b.name);
      renderModal();
      if (b.adapter.toast) b.adapter.toast('오프라인에 저장했어요 · 연결되면 자동으로 올라가요');
      return;
    }

    /* 서버 저장 — 성공하면 화면에도 바로 반영(스냅샷이 곧 확인) */
    b.adapter.save(rec).then(function () {
      if (prev) rec.pending = false;
      upsertServer(b, rec);
      editingId = '';
      selectedId = rec.id;
      view = 'detail';
      paint(b.name);
      renderModal();
      if (b.adapter.toast) b.adapter.toast(wasEditing ? '공지를 고쳤어요' : '공지를 올렸어요');
    }, function (err) {
      formError('저장하지 못했어요 · ' + errorText(err));
    });
  }

  function upsertServer(b, rec) {
    var list = b.server.slice();
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === rec.id) { idx = i; break; }
    if (idx >= 0) list[idx] = rec; else list.push(rec);
    b.server = list;
  }

  function removeFromServer(b, id) {
    b.server = b.server.filter(function (n) { return n && n.id !== id; });
  }

  function toggleCheck() {
    var b = currentBoard();
    if (!b) return;
    var n = findById(b, selectedId);
    if (!n) return;
    var me = (b.adapter.me && b.adapter.me()) || {};
    if (!meKey(me)) { if (b.adapter.toast) b.adapter.toast('이 폰의 사용자를 먼저 골라 주세요'); return; }
    var on = !checkedByMe(n, me);
    if (n.pending) {
      localCheck(n, me, on);
      savePending(b);
      paint(b.name);
      renderModal();
      return;
    }
    if (!b.adapter.ready || !b.adapter.ready()) {
      if (b.adapter.toast) b.adapter.toast('연결되면 확인할 수 있어요 · 잠시 뒤 다시 눌러 주세요');
      return;
    }
    localCheck(n, me, on);
    paint(b.name);
    renderModal();
    b.adapter.check(n.id, on).then(function () { /* 스냅샷이 최종 값을 맞춰 줍니다 */ }, function (err) {
      localCheck(n, me, !on);
      paint(b.name);
      renderModal();
      if (b.adapter.toast) b.adapter.toast('확인을 저장하지 못했어요 · ' + errorText(err));
    });
  }

  function localCheck(n, me, on) {
    var checks = Array.isArray(n.checks) ? n.checks.slice() : [];
    checks = checks.filter(function (c) { return !checkIsMine(c, me); });
    if (on) checks.unshift({ uid: meKey(me), name: String(me.name || '').slice(0, 12), at: Date.now() });
    n.checks = checks;
  }

  function removeSelected() {
    var b = currentBoard();
    if (!b) return;
    var n = findById(b, selectedId);
    if (!n) return;
    if (!b.adapter.canEdit || !b.adapter.canEdit(n)) return;
    if (!window.confirm('이 공지를 지울까요?\n지우면 모두의 폰에서 사라져요.')) return;
    var done = function () {
      selectedId = '';
      view = 'list';
      paint(b.name);
      renderModal();
      if (b.adapter.toast) b.adapter.toast('공지를 지웠어요');
    };
    if (n.pending) {
      b.pending = b.pending.filter(function (x) { return x.id !== n.id; });
      savePending(b);
      done();
      return;
    }
    if (!b.adapter.ready || !b.adapter.ready()) {
      if (b.adapter.toast) b.adapter.toast('연결되면 지울 수 있어요 · 잠시 뒤 다시 눌러 주세요');
      return;
    }
    b.adapter.remove(n.id).then(function () {
      removeFromServer(b, n.id);
      done();
    }, function (err) {
      if (b.adapter.toast) b.adapter.toast('지우지 못했어요 · ' + errorText(err));
    });
  }

  function errorText(err) {
    if (!err) return '알 수 없는 오류';
    if (err.code === 'permission-denied') return '권한이 없어요';
    if (err.code === 'unavailable') return '인터넷 연결을 확인해 주세요';
    if (err.message === 'room-missing') return '방을 찾지 못했어요';
    if (err.message === 'notice-missing') return '이미 지워진 공지예요';
    if (err.message === 'empty-notice') return '공지 내용이 비어 있어요';
    return err.message || '알 수 없는 오류';
  }

  /* ---------------- 바깥에서 쓰는 기능 ---------------- */
  /* 서버(방 문서)에서 받은 공지 목록 — onRoom 마다 호출합니다. */
  function setData(name, list) {
    var b = boardOf(name);
    if (!b) return;
    b.server = Array.isArray(list) ? list : [];
    b.loaded = true;
    flush(b);
    paint(name);
    if (active === name && el.modal && !el.modal.hidden && view !== 'form') renderModal();
  }

  /* 오프라인에 쌓아 둔 공지를 연결되면 차례로 올립니다. */
  function flush(b) {
    if (!b || !b.pending.length || b.flushing) return;
    var ready = false;
    try { ready = !!(b.adapter.ready && b.adapter.ready()); } catch (e) { ready = false; }
    if (!ready) return;
    b.flushing = true;
    var queue = b.pending.slice();
    var uploaded = 0;
    var chain = Promise.resolve();
    queue.forEach(function (rec) {
      chain = chain.then(function () {
        return b.adapter.save(rec).then(function () {
          var idx = -1;
          for (var i = 0; i < b.pending.length; i++) if (b.pending[i].id === rec.id) { idx = i; break; }
          if (idx >= 0) { b.pending.splice(idx, 1); savePending(b); }
          uploaded++;
        }, function () { /* 다음 기회에 다시 시도 */ });
      });
    });
    chain.then(function () {
      b.flushing = false;
      if (!uploaded) return;
      paint(b.name);
      if (active === b.name && el.modal && !el.modal.hidden && view !== 'form') renderModal();
      if (b.adapter.toast) b.adapter.toast('오프라인 공지를 올렸어요');
    });
  }

  function setup(name, adapter) {
    if (!boards.hasOwnProperty(name) || !adapter) return;
    var b = {
      name: name,
      adapter: adapter,
      server: [],
      pending: [],
      key: '',
      loaded: false,
      flushing: false
    };
    boards[name] = b;
    syncKey(b);
    bindDom();
    paint(name);
  }

  window.NoticeBoard = {
    setup: setup,
    setData: setData,
    paint: paint,
    open: open,
    close: close,
    has: function (name) { return !!boards[name]; }
  };
})();
