/* 🖼 사진 도우미 — 고르기·압축(Canvas)·전체화면 보기
   - 서버(Storage) 없이 Firestore 문서에 dataURL로 저장할 수 있게 작게 압축합니다.
   - 프로필 사진: 160×160 정사각 JPEG (약 6~12KB)
   - 날짜 사진: 긴 변 900px JPEG 0.72 (약 60~120KB)
*/
(function () {
  'use strict';

  var picker = null;

  function pickFiles(multiple) {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (multiple) input.multiple = true;
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      var done = false;
      input.addEventListener('change', function () {
        done = true;
        var files = Array.prototype.slice.call(input.files || []);
        document.body.removeChild(input);
        resolve(files);
      });
      /* 취소하면 change가 오지 않을 수 있어 포커스 복귀 시 정리 */
      window.addEventListener('focus', function onFocus() {
        setTimeout(function () {
          if (done) return;
          if (!input.files || !input.files.length) {
            try { document.body.removeChild(input); } catch (e) { /* 무시 */ }
            window.removeEventListener('focus', onFocus);
            resolve([]);
          }
        }, 900);
      });
      input.click();
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('image-load-failed'));
      };
      img.src = url;
    });
  }

  /* 정사각(프로필) */
  function square(file, size, quality) {
    return loadImage(file).then(function (img) {
      var s = Math.min(img.width, img.height);
      var sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      return canvas.toDataURL('image/jpeg', quality == null ? 0.82 : quality);
    });
  }

  /* 긴 변 기준 축소(날짜 사진) */
  function fit(file, maxPx, quality) {
    return loadImage(file).then(function (img) {
      var w = img.width, h = img.height;
      var scale = Math.min(1, maxPx / Math.max(w, h));
      var tw = Math.max(1, Math.round(w * scale));
      var th = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tw, th);
      ctx.drawImage(img, 0, 0, tw, th);
      var q = quality == null ? 0.72 : quality;
      var url = canvas.toDataURL('image/jpeg', q);
      /* 너무 크면 한 번 더 줄입니다 (문서 1MB 제한 보호) */
      if (url.length > 240000) {
        canvas.width = Math.max(1, Math.round(tw * 0.75));
        canvas.height = Math.max(1, Math.round(th * 0.75));
        var ctx2 = canvas.getContext('2d');
        ctx2.fillStyle = '#ffffff';
        ctx2.fillRect(0, 0, canvas.width, canvas.height);
        ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
        url = canvas.toDataURL('image/jpeg', 0.66);
      }
      return url;
    });
  }

  function bytesOf(dataUrl) {
    var i = String(dataUrl || '').indexOf(',');
    var b64 = i >= 0 ? dataUrl.slice(i + 1) : '';
    return Math.round(b64.length * 3 / 4);
  }

  /* ---------------- 전체화면 보기 ---------------- */
  var lb = null;

  function closeLightbox() {
    if (lb && lb.parentNode) lb.parentNode.removeChild(lb);
    lb = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (!lb) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  }

  var lbState = { items: [], index: 0, opts: {} };

  function step(delta) {
    if (!lbState.items.length) return;
    lbState.index = (lbState.index + delta + lbState.items.length) % lbState.items.length;
    paintLightbox();
  }

  function paintLightbox() {
    if (!lb) return;
    var item = lbState.items[lbState.index];
    var img = lb.querySelector('.lightbox__img');
    var cap = lb.querySelector('.lightbox__cap');
    var counter = lb.querySelector('.lightbox__count');
    if (img) img.src = item.src;
    if (cap) cap.textContent = item.caption || '';
    if (counter) counter.textContent = (lbState.index + 1) + ' / ' + lbState.items.length;
    var prev = lb.querySelector('.lightbox__nav--prev');
    var next = lb.querySelector('.lightbox__nav--next');
    if (prev) prev.hidden = lbState.items.length < 2;
    if (next) next.hidden = lbState.items.length < 2;
    var del = lb.querySelector('.lightbox__del');
    if (del) del.hidden = !(lbState.opts && typeof lbState.opts.onDelete === 'function');
  }

  function openLightbox(items, index, opts) {
    closeLightbox();
    lbState = { items: items || [], index: Math.max(0, index || 0), opts: opts || {} };
    var wrap = document.createElement('div');
    wrap.className = 'lightbox';
    wrap.innerHTML =
      '<div class="lightbox__bar">' +
      '<span class="lightbox__count"></span>' +
      '<div class="lightbox__actions">' +
      '<button type="button" class="lightbox__btn lightbox__del">🗑 삭제</button>' +
      '<button type="button" class="lightbox__btn lightbox__close">✕</button>' +
      '</div></div>' +
      '<div class="lightbox__stage">' +
      '<button type="button" class="lightbox__nav lightbox__nav--prev">‹</button>' +
      '<img class="lightbox__img" alt="사진" />' +
      '<button type="button" class="lightbox__nav lightbox__nav--next">›</button>' +
      '</div>' +
      '<p class="lightbox__cap"></p>';
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    lb = wrap;

    wrap.querySelector('.lightbox__close').addEventListener('click', closeLightbox);
    wrap.querySelector('.lightbox__nav--prev').addEventListener('click', function () { step(-1); });
    wrap.querySelector('.lightbox__nav--next').addEventListener('click', function () { step(1); });
    wrap.querySelector('.lightbox__del').addEventListener('click', function () {
      if (!lbState.opts || typeof lbState.opts.onDelete !== 'function') return;
      var item = lbState.items[lbState.index];
      if (!window.confirm('이 사진을 지울까요?\n가족 모두의 앨범에서 사라져요.')) return;
      lbState.opts.onDelete(item, lbState.index);
    });
    document.addEventListener('keydown', onKey);
    paintLightbox();
  }

  window.CalendarMedia = {
    pickFiles: pickFiles,
    square: square,
    fit: fit,
    bytes: bytesOf,
    openLightbox: openLightbox,
    closeLightbox: closeLightbox
  };
})();
