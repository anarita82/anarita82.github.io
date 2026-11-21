/* 오사카 여행 동선 앱 — 현지에서 인터넷이 느려도 바로 열리도록 앱 본체를 캐시한다 */
var V = "osaka-trip-v3";
var SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./data.js",
  "./leaflet.js",
  "./leaflet.css",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(V).then(function (c) {
      return c.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== V && k !== V + "-tiles"; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // 지도 타일: 한 번 본 구역은 오프라인에서도 다시 뜬다
  if (/(^|\.)tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith(
      caches.open(V + "-tiles").then(function (c) {
        return c.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (r) {
            if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone());
            return r;
          }).catch(function () {
            return new Response("", { status: 504 });
          });
        });
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (r) {
        caches.open(V).then(function (c) { c.put("./index.html", r.clone()); });
        return r;
      }).catch(function () {
        return caches.match("./index.html");
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        caches.open(V).then(function (c) { c.put(req, r.clone()); });
        return r;
      });
    })
  );
});
