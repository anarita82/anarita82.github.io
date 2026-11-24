#!/usr/bin/env python3
"""위젯 격자 미리보기 PNG 만들기.

앱과 같은 계산(WidgetMonth)으로 칸 내용을 뽑은 뒤(tools/WidgetPreview.java),
widget_calendar.xml 의 실제 dp 치수 그대로 HTML 을 만들어 Chromium 으로 찍습니다.
(= 글자 겹침·잘림·한글/이모지 가독성을 눈으로 확인하는 용도)

  python3 tools/render_widget_preview.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # work/fc/android
JAVA_HOME = "/workspace/work/android-tools/jdk-17.0.21+9"
OUT_DIR = "/workspace/downloads"
BUILD = "/tmp/wp"

C_SUN, C_SAT, C_DARK, C_MUTED = "#e5484d", "#3b82f6", "#1f2430", "#c6cbd8"

CSS = """
@font-face { font-family: 'NanumGC'; src: url('file:///workspace/work/fc/NanumGothic-Regular.ttf'); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #eef0f5; padding: 24px; display: flex; flex-direction: column;
       gap: 18px; align-items: flex-start; font-family: 'NanumGC', 'Noto Sans CJK KR', 'Noto Color Emoji', sans-serif; }
.label { font-size: 13px; color: #555c6e; font-family: 'NanumGC', sans-serif; }
.widget { background: #fff; border: 1px solid #E6E8F0; border-radius: 20px; display: flex;
          flex-direction: column; padding: 10px 12px; overflow: hidden; }
.head { height: 24px; display: flex; align-items: center; }
.title { flex: 1; font-size: 15px; font-weight: 700; color: #1f2430; white-space: nowrap; overflow: hidden; }
.nav { width: 22px; height: 22px; border-radius: 50%; background: #F1F2F8; color: #4f46e5;
       font-size: 9px; display: flex; align-items: center; justify-content: center; }
.todaybtn { height: 22px; padding: 0 9px; border-radius: 20px; background: #EEF0FF; color: #4f46e5;
            font-size: 10px; font-weight: 700; display: flex; align-items: center; margin-left: 4px; }
.next { margin-left: 4px; }
.refresh { width: 20px; height: 22px; margin-left: 3px; color: #9aa1b2; font-size: 13px;
           display: flex; align-items: center; justify-content: center; }
.week { height: 16px; margin-top: 3px; display: flex; font-size: 10px; font-weight: 700; }
.week span { flex: 1; text-align: center; line-height: 16px; }
.grid { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.wrow { flex: 1; display: flex; min-height: 0; }
.cell { flex: 1; display: flex; flex-direction: column; align-items: center; padding-top: 1px; overflow: hidden; }
.day { height: 18px; line-height: 18px; min-width: 18px; border-radius: 50%; text-align: center;
       font-weight: 700; padding: 0 2px; }
.day.badge { background: #4f46e5; color: #fff; }
.ev1 { height: 12px; line-height: 12px; margin-top: 1px; white-space: nowrap; overflow: hidden; color: #3b4152; }
.ev2 { height: 11px; line-height: 11px; white-space: nowrap; overflow: hidden; color: #8b93a7; }
.ev2.time { color: #4f46e5; }
"""


def cells_json(width, height, today="2026-11-25", year=2026, month=11):
    src = [os.path.join(ROOT, "app/src/main/java/com/anarita82/familycalendar/WidgetMonth.java"),
           os.path.join(HERE, "WidgetPreview.java")]
    javac = os.path.join(JAVA_HOME, "bin/javac")
    java = os.path.join(JAVA_HOME, "bin/java")
    subprocess.run([javac, "-encoding", "UTF-8", "-d", BUILD] + src, check=True)
    out = subprocess.run([java, "-cp", BUILD, "WidgetPreview", str(width), str(height), today,
                          str(year), str(month)], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def widget_html(data):
    w, h = data["width"], data["height"]
    rows = []
    for r in range(6):
        row = []
        for c in range(7):
            cell = data["cells"][r * 7 + c]
            if cell["today"]:
                color = "#fff"
                cls = "day badge"
            elif not cell["inMonth"]:
                color, cls = C_MUTED, "day"
            elif cell["col"] == 0:
                color, cls = C_SUN, "day"
            elif cell["col"] == 6:
                color, cls = C_SAT, "day"
            else:
                color, cls = C_DARK, "day"
            parts = [f'<div class="{cls}" style="color:{color};font-size:{cell["daySize"]}px">{cell["day"]}</div>']
            if cell["l1"]:
                parts.append(f'<div class="ev1" style="font-size:{cell["l1Size"]}px">{escape(cell["l1"])}</div>')
            if cell["l2"]:
                t = " time" if cell["l2t"] else ""
                parts.append(f'<div class="ev2{t}" style="font-size:{cell["l2Size"]}px">{escape(cell["l2"])}</div>')
            row.append('<div class="cell">' + "".join(parts) + "</div>")
        rows.append('<div class="wrow">' + "".join(row) + "</div>")

    week = "".join(
        f'<span style="color:{col}">{d}</span>'
        for d, col in zip(["일", "월", "화", "수", "목", "금", "토"],
                          [C_SUN, "#6b7280", "#6b7280", "#6b7280", "#6b7280", "#6b7280", C_SAT])
    )
    return f"""
<label class="label">우리 가족 달력 · 월간 격자 위젯 — {w}×{h}dp ({data['year']}년 {data['month']}월, 오늘 25일)</label>
<div class="widget" style="width:{w}px;height:{h}px">
  <div class="head">
    <div class="title">{data['year']}년 {data['month']}월</div>
    <div class="nav">◀</div><div class="todaybtn">오늘</div><div class="nav next">▶</div><div class="refresh">↻</div>
  </div>
  <div class="week">{week}</div>
  <div class="grid">{''.join(rows)}</div>
</div>
"""


def escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    sizes = [(300, 340), (300, 250)]
    body = "".join(widget_html(cells_json(w, h)) for w, h in sizes)
    html = f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{body}</body></html>"
    page = "/tmp/widget-preview.html"
    with open(page, "w", encoding="utf-8") as f:
        f.write(html)

    from playwright.sync_api import sync_playwright
    png = os.path.join(OUT_DIR, "fc-widget-v17-preview.png")
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": sizes[0][0] + 80, "height": 760},
                            device_scale_factor=3)
        pg = ctx.new_page()
        pg.goto("file://" + page)
        pg.wait_for_timeout(400)
        pg.screenshot(path=png, full_page=True)
        b.close()
    print("wrote", png)
    print("html", page)


if __name__ == "__main__":
    main()
