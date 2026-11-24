"""가족 달력 웹앱 점검 — 로컬 서버로 띄워 콘솔 오류 0건 + 위젯 페이로드(days) 검증.

  LD_LIBRARY_PATH=... python3 work/fc/android/tools/check_widget_payload.py
"""
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = "/workspace/work/fc"
PORT = 8799

srv = ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(SimpleHTTPRequestHandler, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

JS = """() => {
  const evs = FamilyCalendar.seedSamples();
  const p = FamilyCalendar.widgetPayload(evs);
  const keys = Object.keys(p.days).sort();
  const sample = {};
  ['2026-11-19','2026-11-25','2026-12-02','2026-12-05','2026-12-16','2026-12-28'].forEach(k => { if (p.days[k]) sample[k] = p.days[k]; });
  return {keys, first: keys[0], last: keys[keys.length-1], dayCount: keys.length,
          sample, size: JSON.stringify(p).length, upcoming: p.upcoming.length, today: p.today.length};
}"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 880})
    pg = ctx.new_page()
    errs, logs = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    pg.goto(f"http://127.0.0.1:{PORT}/family-calendar/", wait_until="load")
    pg.wait_for_timeout(4000)
    out = pg.evaluate(JS)
    print(json.dumps(out, ensure_ascii=False, indent=1))
    print("pageerrors:", errs)
    print("console:", logs[:8])
    pg.screenshot(path="/workspace/downloads/fc-web-check.png")
    b.close()
srv.shutdown()
