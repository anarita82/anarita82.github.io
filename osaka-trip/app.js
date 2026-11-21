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
  var tileLayer = null;
  var tileErrors = 0;
  var tileOk = 0;
  var hintEl = null;

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

    drawRoute(v.stops, i2color(t, v));
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
      try { map.remove(); } catch (e) {}
    }
    map = null;
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

  function drawRoute(stops, accent) {
    initMap();
    if (!map) return;
    layerGroup.clearLayers();
    markers = [];

    for (var i = 1; i < stops.length; i++) {
      var a = stops[i - 1], b = stops[i];
      var mode = (b.leg && b.leg.mode) || "walk";
      var style = mode === "train"
        ? { color: accent, weight: 4, opacity: 0.85 }
        : mode === "taxi" || mode === "tour"
          ? { color: "#8b5cf6", weight: 3.5, opacity: 0.8, dashArray: "2 8", lineCap: "round" }
          : { color: "#94a3b8", weight: 3, opacity: 0.9, dashArray: "6 8", lineCap: "round" };
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], style).addTo(layerGroup);
    }

    stops.forEach(function (s, i) {
      var icon = L.divIcon({
        className: "pin-wrap",
        html: '<div class="pin" style="--c:' + accent + '">' + (i + 1) + "</div>",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
      });
      var m = L.marker([s.lat, s.lng], { icon: icon, title: s.name, riseOnHover: true });
      m.bindPopup(
        '<div class="pop"><b>' + esc(s.name) + "</b><span>" + esc(s.time) + " · " + esc(s.jp || "") +
          '</span><a target="_blank" rel="noopener" href="' + gmapsUrl(null, s, "walk") + '">구글지도로 열기 →</a></div>',
        { closeButton: false, autoPan: true }
      );
      m.on("click", function () { highlight(i, false); });
      m.addTo(layerGroup);
      markers.push(m);
    });

    var bounds = L.latLngBounds(stops.map(function (s) { return [s.lat, s.lng]; }));
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: 15 });
    setTimeout(function () { if (map) map.invalidateSize(); }, 60);
    // 웹뷰 안에서 목록이 지도와 겹치지 않게
    window.__tripFocus = focusStop;
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
      map.setView([s.lat, s.lng], Math.max(map.getZoom(), 15), { animate: true });
      if (markers[i]) markers[i].openPopup();
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
