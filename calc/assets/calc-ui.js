/*!
 * 생활 계산기 — 공통 UI (복사·공유·숫자 입력·탭·저장)
 */
(function () {
  'use strict';
  var Core = window.CalcCore;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(msg) {
    var t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  /* -------- 숫자 입력: 천 단위 콤마 자동 -------- */
  function formatThousands(el) {
    var raw = el.value;
    if (!raw) return;
    var selStart = el.selectionStart == null ? raw.length : el.selectionStart;
    var digitsBefore = (raw.slice(0, selStart).match(/\d/g) || []).length;
    var isInt = el.dataset.int === 'true';
    var v = raw.replace(/,/g, '').replace(/[^\d.]/g, '');
    if (isInt) v = v.replace(/\./g, '');
    var dot = v.indexOf('.');
    if (dot > -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
    var neg = /^\s*-/.test(raw) && v !== '';
    var parts = v.split('.');
    var intPart = parts[0].replace(/^0+(?=\d)/, '');
    var out = (neg ? '-' : '') +
      intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
      (parts.length > 1 ? '.' + parts[1] : '');
    el.value = out;
    var pos = out.length;
    if (digitsBefore > 0) {
      var seen = 0; pos = 0;
      while (pos < out.length && seen < digitsBefore) {
        if (/\d/.test(out[pos])) seen++;
        pos++;
      }
    }
    try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
  }

  function bindNumeric(scope) {
    $$('input[data-num]', scope || document).forEach(function (el) {
      if (el._numBound) return;
      el._numBound = true;
      el.addEventListener('input', function () { formatThousands(el); });
      el.addEventListener('blur', function () {
        var v = Core.num(el.value);
        if (el.value !== '' && v === 0) el.value = '0';
        else if (el.value !== '' && el.dataset.int !== 'true') {
          // 소수 둘째 자리까지만 남긴다
          var s = String(Core.round(Core.num(el.value), Number(el.dataset.dec || 3)));
          el.value = s;
          formatThousands(el);
        }
        if (el.value === '') return;
      });
      if (el.value) formatThousands(el);
    });
  }

  function readNum(idOrEl) {
    var el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    return el ? Core.num(el.value) : 0;
  }

  function setValue(id, v, silent) {
    var el = typeof id === 'string' ? document.getElementById(id) : id;
    if (!el) return;
    el.value = v == null ? '' : String(v);
    if (el.hasAttribute('data-num')) formatThousands(el);
    if (!silent) el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* -------- 복사 / 공유 -------- */
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function copyResult(builder, btn) {
    var text = typeof builder === 'function' ? builder() : String(builder);
    return copyText(text).then(function (ok) {
      toast(ok ? '결과를 복사했어요. 카톡에 붙여넣기 하세요.' : '복사가 안 됐어요. 결과를 길게 눌러 복사해 주세요.');
      if (ok && btn) {
        var old = btn.getAttribute('data-label') || btn.textContent;
        btn.setAttribute('data-label', old);
        btn.textContent = '✓ 복사됨';
        setTimeout(function () { btn.textContent = old; }, 1600);
      }
      return ok;
    });
  }

  function shareResult(data) {
    var url = (data && data.url) || location.href;
    var title = (data && data.title) || document.title;
    var text = (data && data.text) || '';
    if (navigator.share) {
      return navigator.share({ title: title, text: text, url: url }).catch(function (err) {
        if (err && err.name === 'AbortError') return false;
        return copyText(text ? text + '\n' + url : url).then(function (ok) {
          toast(ok ? '공유 대신 링크를 복사했어요.' : '공유를 지원하지 않는 브라우저예요.');
          return ok;
        });
      });
    }
    return copyText(text ? text + '\n' + url : url).then(function (ok) {
      toast(ok ? '링크를 복사했어요. 붙여넣기로 공유하세요.' : '링크 복사에 실패했어요.');
      return ok;
    });
  }

  /* -------- 탭 -------- */
  function setupTabs(container, onChange) {
    var root = typeof container === 'string' ? $(container) : container;
    if (!root) return null;
    var tabs = $$('[role=tab]', root);
    var current = null;
    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      current = tab.getAttribute('data-value');
      if (onChange) onChange(current, tab);
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var next = tabs[(i + d + tabs.length) % tabs.length];
        next.focus(); select(next);
      });
    });
    var initial = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
    if (initial) select(initial);
    return {
      select: select,
      selectByValue: function (v) {
        var t = tabs.filter(function (x) { return x.getAttribute('data-value') === v; })[0];
        if (t) select(t);
      },
      value: function () { return current; }
    };
  }

  /* -------- 칩 -------- */
  function setupChips(scope, onPick) {
    $$('[data-chip]', scope || document).forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (onPick) onPick(chip.getAttribute('data-chip'), chip);
      });
    });
  }

  function group(el) {
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  function flash(el) { if (el) group(el); }

  /* -------- 입력값 기억(브라우저에만 저장) -------- */
  var PREFIX = 'calc.v1.';
  function save(key, values) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(values)); } catch (e) { /* noop */ }
  }
  function load(key) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 120);
    };
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function bindActions(opts) {
    var copyBtn = $('#copyBtn');
    var shareBtn = $('#shareBtn');
    if (copyBtn && opts.build) {
      copyBtn.addEventListener('click', function () { copyResult(opts.build, copyBtn); });
    }
    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        var text = opts.build ? String(opts.build()).split('\n').slice(0, 3).join('\n') : '';
        shareResult({ title: opts.title || document.title, text: text, url: opts.url || location.href });
      });
    }
  }

  window.CalcUI = {
    $: $, $$: $$, toast: toast, bindNumeric: bindNumeric, readNum: readNum, setValue: setValue,
    copyText: copyText, copyResult: copyResult, shareResult: shareResult, bindActions: bindActions,
    setupTabs: setupTabs, setupChips: setupChips, flash: flash, save: save, load: load,
    debounce: debounce, todayISO: todayISO, formatThousands: formatThousands
  };
})();
