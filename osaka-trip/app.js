(function () {
  "use strict";

  var TABS = window.TRIP && window.TRIP.tabs ? window.TRIP.tabs : [];
  var root = document.documentElement;
  var tabsEl = document.getElementById("tabs");
  var mainEl = document.getElementById("main");
  var metaEl = document.getElementById("topMeta");
  var sheet = document.getElementById("sheet");
  var sheetBody = document.getElementById("sheetBody");
  var sheetClose = document.getElementById("sheetClose");
  var locBtn = document.getElementById("locBtn");

  var state = { tab: null, variant: null };
  var map = null;
  var mapEl = null;
  var mapWrap = null;
  var layerGroup = null;
  var markers = [];
  var lines = [];
  var currentStops = [];
  var zoomHandler = null;
  var tileLayer = null;
  var tileErrors = 0;
  var tileOk = 0;
  var hintEl = null;
  var renderSeq = 0;

  /* ---------------- helpers ---------------- */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function gmapsUrl(from, to, mode) {
    var travel = mode === "walk" ? "walking" : mode === "taxi" ? "driving" : "transit";
    var u = "https://www.google.com/maps/dir/?api=1&destination=" + to.lat + "," + to.lng +
      "&travelmode=" + travel;
    if (from) u += "&origin=" + from.lat + "," + from.lng;
    return u;
  }
  function placeUrl(s) {
    return "https://www.google.com/maps/search/?api=1&query=" + s.lat + "," + s.lng;
  }

  /* ---------------- tabs ---------------- */
  function buildTabs() {
    tabsEl.innerHTML = "";
    TABS.forEach(function (t) {
      var b = el("button", "tab");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", "false");
      b.innerHTML = '<span class="em">' + t.emoji + "</span><span>" + esc(t.label) + "</span>";
      b.addEventListener("click", function () {
        select(t.id, null, true);
      });
      b.__tabId = t.id;
      tabsEl.appendChild(b);
    });
  }

  function tabById(id) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i];
    return TABS[0];
  }

  function select(tabId, variantId, scrollTop) {
    var t = tabById(tabId);
    var v = t.variants[0];
    if (variantId) {
      for (var i = 0; i < t.variants.length; i++) if (t.variants[i].id === variantId) v = t.variants[i];
    }
    state.tab = t.id;
    state.variant = v.id;
    Array.prototype.forEach.call(tabsEl.children, function (b) {
      b.setAttribute("aria-selected", b.__tabId === t.id ? "true" : "false");
    });
    try {
      history.replaceState(null, "", "#" + t.id + (v.id && v.id !== "all" ? "-" + v.id : ""));
    } catch (e) {}
    render(t, v);
    if (scrollTop) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- render ---------------- */
  function render(t, v) {
    renderSeq++;
    // 탭을 바꿀 때 DOM 을 비우기 전에 지도를 먼저 걷어낸다(떨어진 노드에서 Leaflet 오류 방지)
    if (map) {
      try { map.stop(); map.off(); map.remove(); } catch (e) {}
      map = null;
      layerGroup = null;
      markers = [];
      lines = [];
    }
    root.style.setProperty("--accent", (v.accent || t.accent || "#2f6bff"));
    metaEl.textContent = window.TRIP.meta.dates + " · " + window.TRIP.meta.party;

    mainEl.innerHTML = "";

    var hero = el("section", "hero");
    hero.innerHTML =
      "<h2>" + esc(t.title) + "</h2>" +
      '<p class="sub">' + esc(t.sub) + "</p>" +
      (t.facts && t.facts.length
        ? '<div class="facts">' + t.facts.map(function (f) { return '<span class="fact">' + esc(f) + "</span>"; }).join("") + "</div>"
        : "") +
      (t.note ? '<p class="note">' + esc(t.note) + "</p>" : "");
    mainEl.appendChild(hero);

    if (t.cards) {
      renderCards(v);
      return;
    }

    if (t.info) {
      renderInfo(v);
      return;
    }

    if (t.variants.length > 1) {
      var seg = el("div", "seg");
      t.variants.forEach(function (vv) {
        var b = el("button");
        b.type = "button";
        b.setAttribute("aria-pressed", vv.id === v.id ? "true" : "false");
        b.innerHTML = "<span>" + esc(vv.label) + "</span><small>" + esc(vv.hint || "") + "</small>";
        b.addEventListener("click", function () { select(t.id, vv.id, false); });
        seg.appendChild(b);
      });
      mainEl.appendChild(seg);
    }

    buildMap();
    mainEl.appendChild(mapWrap);

    var route = el("div", "route");
    var prev = null;
    v.stops.forEach(function (s, i) {
      if (s.leg && i > 0) {
        var lg = el("div", "leg " + (s.leg.mode || "walk"));
        lg.innerHTML = '<span class="bar"></span><span>' + esc(s.leg.text || "") + "</span>";
        route.appendChild(lg);
      }
      route.appendChild(stopCard(s, i, prev, t, v));
      prev = s;
    });
    mainEl.appendChild(route);

    drawRoute(v.stops, i2color(t, v), t);
  }

  function i2color(t, v) { return v.accent || t.accent || "#2f6bff"; }

  function stopCard(s, i, prev, t, v) {
    var c = el("article", "stop kind-" + (s.kind || "sight"));
    var acts =
      '<div class="stop-acts">' +
      '<a class="act go" target="_blank" rel="noopener" href="' + gmapsUrl(prev, s, s.leg ? s.leg.mode : "walk") + '">📍 구글지도 길찾기</a>' +
      '<a class="act" target="_blank" rel="noopener" href="' + placeUrl(s) + '">장소 보기</a>' +
      "</div>";
    c.innerHTML =
      '<div class="num">' + (i + 1) + "</div>" +
      "<div>" +
      '<span class="time">' + esc(s.time) + "</span>" +
      (s.line ? '<span class="line-chip" style="background:' + esc(s.line.c) + '">' + esc(s.line.t) + "</span>" : "") +
      "<h3>" + esc(s.name) + "</h3>" +
      (s.jp ? '<p class="jp">' + esc(s.jp) + "</p>" : "") +
      (s.lines && s.lines.length
        ? "<ul>" + s.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>"
        : "") +
      (s.tip ? '<p class="tip">💡 ' + esc(s.tip) + "</p>" : "") +
      acts +
      "</div>";
    c.__stop = s;
    c.__index = i;
    c.addEventListener("click", function (e) {
      if (e.target.closest(".act")) return;
      focusStop(i, s);
    });
    return c;
  }

  function renderCards(v) {
    var wrap = el("div");
    (v.groups || []).forEach(function (g) {
      var sec = el("section", "card-group");
      sec.appendChild(el("h3", null, esc(g.title)));
      var grid = el("div", "jp-grid");
      g.items.forEach(function (it) {
        var b = el("button", "jp-card");
        b.type = "button";
        b.innerHTML =
          '<span class="ko">' + esc(it.ko) + "</span>" +
          '<span class="ja">' + esc(it.jp) + "</span>" +
          '<span class="rd">' + esc(it.read) + "</span>" +
          '<span class="use">' + esc(it.use) + "</span>";
        b.addEventListener("click", function () { openSheet(it); });
        grid.appendChild(b);
      });
      sec.appendChild(grid);
      wrap.appendChild(sec);
    });
    mainEl.appendChild(wrap);
  }

  /* 예약·준비 탭: 표 형태 정보 + 체크리스트(localStorage 저장) */
  function renderInfo(v) {
    var wrap = el("div", "info-wrap");
    (v.groups || []).forEach(function (g) {
      var sec = el("section", "info-card");
      var h = '<h3><span class="em">' + esc(g.emoji || "") + "</span>" + esc(g.title) + "</h3>";
      var rows = (g.rows || []).map(function (r) {
        var val = esc(r[1]);
        if (r[2]) val = '<a href="' + esc(r[2]) + '" target="_blank" rel="noopener">' + val + " ↗</a>";
        return '<div class="irow"><dt>' + esc(r[0]) + "</dt><dd>" + val + "</dd></div>";
      }).join("");
      sec.innerHTML = h + '<dl class="itable">' + rows + "</dl>";
      wrap.appendChild(sec);
    });

    if (v.checklist && v.checklist.length) {
      var cl = el("section", "info-card check-card");
      cl.innerHTML = '<h3><span class="em">✅</span>출발 준비물</h3>';
      var list = el("div", "check-list");
      v.checklist.forEach(function (txt, i) {
        var key = "osaka-trip-check-" + i;
        var on = false;
        try { on = localStorage.getItem(key) === "1"; } catch (e) {}
        var lab = el("label", "check-row" + (on ? " on" : ""));
        lab.innerHTML = '<input type="checkbox"' + (on ? " checked" : "") + "><span>" + esc(txt) + "</span>";
        var box = lab.querySelector("input");
        box.addEventListener("change", function () {
          lab.classList.toggle("on", box.checked);
          try { localStorage.setItem(key, box.checked ? "1" : "0"); } catch (err) {}
        });
        list.appendChild(lab);
      });
      cl.appendChild(list);
      wrap.appendChild(cl);
    }
    mainEl.appendChild(wrap);
  }

  function openSheet(it) {
    sheetBody.innerHTML =
      '<p class="ko">' + esc(it.ko) + "</p>" +
      '<p class="ja">' + esc(it.jp) + "</p>" +
      '<p class="rd">' + esc(it.read) + "</p>" +
      (it.use ? '<p class="use">' + esc(it.use) + "</p>" : "");
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeSheet() {
    sheet.hidden = true;
    document.body.style.overflow = "";
  }
  sheetClose.addEventListener("click", closeSheet);

  /* ---------------- map ---------------- */
  function buildMap() {
    mapWrap = el("div", "map-wrap");
    mapEl = el("div");
    mapEl.id = "map";
    mapWrap.appendChild(mapEl);

    hintEl = el("div", "map-hint", "번호를 탭하면 그 지점으로 이동");
    mapWrap.appendChild(hintEl);

    var btn = el("button", "map-btn", "⤢ 크게");
    btn.type = "button";
    btn.addEventListener("click", function () {
      if (mapWrap.classList.contains("full")) {
        mapWrap.classList.remove("full");
        btn.textContent = "⤢ 크게";
        document.body.style.overflow = "";
      } else {
        mapWrap.classList.add("full");
        btn.textContent = "✕ 닫기";
        document.body.style.overflow = "hidden";
      }
      setTimeout(function () { if (map) map.invalidateSize(); }, 260);
    });
    mapWrap.appendChild(btn);

    if (map) {
      try { map.off(); map.remove(); } catch (e) {}
    }
    map = null;
    layerGroup = null;
    markers = [];
    tileErrors = 0;
    tileOk = 0;
  }

  function initMap() {
    if (map || !mapEl) return;
    if (!window.L) {
      hintEl.textContent = "지도 모듈을 불러오지 못했습니다 — 아래 카드는 그대로 사용 가능";
      hintEl.classList.add("warn");
      return;
    }
    map = L.map(mapEl, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
      zoomAnimation: false,
      fadeAnimation: false,
      tap: true
    }).setView([34.66, 135.5], 12);

    tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      minZoom: 3,
      attribution: "&copy; OpenStreetMap",
      crossOrigin: true
    });
    tileLayer.on("tileerror", function () {
      tileErrors++;
      if (tileErrors >= 3 && tileOk === 0) {
        hintEl.textContent = "오프라인 — 지도 그림은 안 나오지만 핀·순서는 그대로";
        hintEl.classList.add("warn");
      }
    });
    tileLayer.on("tileload", function () {
      tileOk++;
      if (tileOk === 1 && tileErrors >= 3) {
        hintEl.textContent = "번호를 탭하면 그 지점으로 이동";
        hintEl.classList.remove("warn");
      }
    });
    tileLayer.addTo(map);
    layerGroup = L.layerGroup().addTo(map);
  }

  /* 같은 건물·같은 역에 붙은 지점들이 겹치지 않도록 화면 픽셀에서 서로 밀어낸다. */
  function layoutPoints(stops) {
    if (!map || !stops.length) return [];
    var z = map.getZoom();
    var c = map.getCenter();
    var mpp = 156543.03392 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, z);
    var maxShift = Math.min(52, 400 / mpp);   // 실제 위치에서 400m 넘게 밀지 않는다
    var origin = stops.map(function (s) { return map.project([s.lat, s.lng], z); });
    var pts = origin.map(function (p) { return L.point(p.x, p.y); });
    var MIN = 29;
    for (var it = 0; it < 90; it++) {
      var moved = false;
      for (var i = 0; i < pts.length; i++) {
        for (var j = i + 1; j < pts.length; j++) {
          var dx = pts[j].x - pts[i].x;
          var dy = pts[j].y - pts[i].y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d >= MIN) continue;
          if (d < 0.01) { dx = (j - i) * 0.7 + 0.3; dy = 0.5; d = Math.sqrt(dx * dx + dy * dy); }
          var push = (MIN - d) / 2 / d;
          pts[i].x -= dx * push; pts[i].y -= dy * push;
          pts[j].x += dx * push; pts[j].y += dy * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    // 실제 위치에서 너무 멀어지지 않게
    for (var k = 0; k < pts.length; k++) {
      var ox = pts[k].x - origin[k].x, oy = pts[k].y - origin[k].y;
      var len = Math.sqrt(ox * ox + oy * oy);
      if (len > maxShift) {
        pts[k].x = origin[k].x + ox * maxShift / len;
        pts[k].y = origin[k].y + oy * maxShift / len;
      }
    }
    return pts.map(function (p) { return map.unproject(p, z); });
  }

  function drawRoute(stops, accent, tab) {
    initMap();
    if (!map || !layerGroup) return;
    layerGroup.clearLayers();
    markers = [];
    lines = [];
    currentStops = stops;

    var fitStops = stops;
    if (tab && tab.fitKind) {
      var sub = stops.filter(function (s) { return s.kind === tab.fitKind; });
      if (sub.length > 1) fitStops = sub;
    }

    var bounds = L.latLngBounds(fitStops.map(function (s) { return [s.lat, s.lng]; }));
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: 15 });
    if (hintEl && tab && tab.mapHint) {
      hintEl.textContent = tab.mapHint;
      hintEl.classList.remove("warn");
    }

    var pts = layoutPoints(stops);

    for (var i = 1; i < stops.length; i++) {
      var b = stops[i];
      var mode = (b.leg && b.leg.mode) || "walk";
      var style = mode === "train"
        ? { color: accent, weight: 4, opacity: 0.85 }
        : mode === "taxi" || mode === "tour"
          ? { color: "#8b5cf6", weight: 3.5, opacity: 0.8, dashArray: "2 8", lineCap: "round" }
          : { color: "#94a3b8", weight: 3, opacity: 0.9, dashArray: "6 8", lineCap: "round" };
      var ln = L.polyline([[pts[i - 1].lat, pts[i - 1].lng], [pts[i].lat, pts[i].lng]], style);
      ln.addTo(layerGroup);
      lines.push(ln);
    }

    stops.forEach(function (s, i) {
      var icon = L.divIcon({
        className: "pin-wrap",
        html: '<div class="pin" style="--c:' + accent + '">' + (i + 1) + "</div>",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
      });
      var m = L.marker([pts[i].lat, pts[i].lng], { icon: icon, title: s.name, riseOnHover: true });
      m.bindPopup(
        '<div class="pop"><b>' + esc(s.name) + "</b><span>" + esc(s.time) + " · " + esc(s.jp || "") +
          '</span><a target="_blank" rel="noopener" href="' + gmapsUrl(null, s, "walk") + '">구글지도로 열기 →</a></div>',
        { closeButton: false, autoPan: true }
      );
      m.on("click", function () { highlight(i, false); });
      m.addTo(layerGroup);
      markers.push(m);
    });

    var seq = renderSeq;
    setTimeout(function () {
      if (!map || seq !== renderSeq) return;
      try { map.invalidateSize(); reflow(); } catch (e) {}
    }, 60);

    if (zoomHandler) map.off("zoomend", zoomHandler);
    zoomHandler = function () { reflow(); };
    map.on("zoomend", zoomHandler);
  }

  /* 지도를 확대·축소하면 화면 기준으로 다시 배치한다. */
  function reflow() {
    if (!map || !layerGroup || !markers.length) return;
    var pts = layoutPoints(currentStops);
    markers.forEach(function (m, i) { if (pts[i]) m.setLatLng(pts[i]); });
    lines.forEach(function (ln, i) {
      if (pts[i] && pts[i + 1]) ln.setLatLngs([[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]]);
    });
  }

  function highlight(i, scroll) {
    var cards = mainEl.querySelectorAll(".stop");
    Array.prototype.forEach.call(cards, function (c, k) {
      c.classList.toggle("active", k === i);
      if (k === i && scroll) c.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    markers.forEach(function (m, k) {
      var node = m.getElement();
      if (!node) return;
      var pin = node.querySelector(".pin");
      if (pin) pin.classList.toggle("active", k === i);
    });
  }

  function focusStop(i, s) {
    highlight(i, false);
    if (map && s) {
      map.setView([s.lat, s.lng], Math.max(map.getZoom(), 16), { animate: true });
      if (markers[i]) {
        setTimeout(function () { if (markers[i]) markers[i].openPopup(); }, 280);
      }
    }
  }

  /* ---------------- location ---------------- */
  locBtn.addEventListener("click", function () {
    if (!navigator.geolocation) {
      locBtn.textContent = "✕";
      return;
    }
    locBtn.textContent = "…";
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        locBtn.textContent = "📍";
        if (map) {
          map.setView([pos.coords.latitude, pos.coords.longitude], 15, { animate: true });
          L.circleMarker([pos.coords.latitude, pos.coords.longitude], {
            radius: 7, color: "#fff", weight: 2.5, fillColor: "#16a34a", fillOpacity: 1
          }).addTo(map);
        }
      },
      function () {
        locBtn.textContent = "📍";
        if (hintEl) {
          hintEl.textContent = "위치를 받지 못했어요 — 📍 버튼의 구글지도에서 확인";
          hintEl.classList.add("warn");
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });

  /* ---------------- boot ---------------- */
  buildTabs();
  var hash = (location.hash || "").replace("#", "");
  var startTab = TABS[0].id, startVar = null;
  if (hash) {
    var parts = hash.split("-");
    if (parts.length > 1) {
      startTab = parts[0];
      startVar = parts.slice(1).join("-");
    } else {
      startTab = hash;
    }
  }
  select(startTab, startVar, false);

  window.addEventListener("hashchange", function () {
    var h = (location.hash || "").replace("#", "");
    if (!h) return;
    var p = h.split("-");
    select(p[0], p.length > 1 ? p.slice(1).join("-") : null, false);
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
