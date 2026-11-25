#!/usr/bin/env python3
"""마이피씨방 자동 측정기 — 10분마다 매장 PC 공인 IP 대역에 ICMP 를 보내 응답 대수를 기록한다.

- 매장 정의: mypcbang/data/stores.json
- 결과:      mypcbang/data/live.json  (최신값 · 일별 · 시간별 · 최근 기록)
- 실행:      GitHub Actions(.github/workflows/mypcbang-probe.yml) 또는 매장 PC의 python3

IP 응답 대수는 실제 좌석 이용률이 아니라 "켜져 있어 ICMP 에 응답하는 PC 수"다.
제어용 ping(8.8.8.8)이 실패하면 측정기 쪽 네트워크 문제로 보고 기록을 남기지 않는다.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # .../mypcbang
DATA = os.path.join(ROOT, "data")
KST = dt.timezone(dt.timedelta(hours=9))
CONTROL_HOST = "8.8.8.8"
WORKERS = 64
PING_TIMEOUT = 1          # 초 (-W)
KEEP_DAYS = 62            # live.json 에 남기는 일별 보관 일수
HOURLY_DAYS = 4           # 시간별 집계 보관 일수
RECENT_MAX = 480          # 최근 개별 측정 보관 개수


def now_kst() -> dt.datetime:
    return dt.datetime.now(KST)


def parse_range(spec: str) -> list[str]:
    """'59.186.104.1~107' · '218.145.217.001~177' · '1.2.3.4' 형태를 IP 목록으로."""
    spec = spec.strip()
    m = re.match(r"^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})\s*[~-]\s*(\d{1,3})$", spec)
    if m:
        head, a, b = m.group(1), int(m.group(2)), int(m.group(3))
        if b < a:
            a, b = b, a
        return [f"{head}.{i}" for i in range(a, b + 1)]
    m = re.match(r"^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s*[~-]\s*(\d{1,3})$", spec)
    if m:
        return [f"{m.group(1)}+{i}" for i in range(int(m.group(2)))]  # 형식 오류 방지용, 아래서 걸러짐
    return [spec]


def ping_once(host: str) -> bool:
    try:
        r = subprocess.run(
            ["ping", "-n", "-c", "1", "-W", str(PING_TIMEOUT), host],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=PING_TIMEOUT + 3,
        )
        return r.returncode == 0
    except Exception:
        return False


def has_ping() -> bool:
    from shutil import which
    return which("ping") is not None


def probe_store(store: dict, hosts: list[str]) -> dict:
    t0 = time.time()
    alive = 0
    if hosts:
        with cf.ThreadPoolExecutor(max_workers=min(WORKERS, max(1, len(hosts)))) as ex:
            for ok in ex.map(ping_once, hosts):
                alive += 1 if ok else 0
    pcs = int(store.get("pcs") or len(hosts) or 1)
    return {
        "on": alive,
        "pcs": pcs,
        "pct": round(alive / pcs * 100, 2) if pcs else None,
        "probed": len(hosts),
        "duration": round(time.time() - t0, 1),
    }


def bump(row: dict, res: dict) -> None:
    """한 번의 측정을 일별·시간별 누적에 더한다(누적 필드 sp·sn·so·son)."""
    row["samples"] = int(row.get("samples") or 0) + 1
    if res.get("pct") is not None:
        row["sp"] = round(float(row.get("sp") or 0.0) + float(res["pct"]), 4)
        row["sn"] = int(row.get("sn") or 0) + 1
    row["so"] = round(float(row.get("so") or 0.0) + float(res["on"]), 4)
    row["son"] = int(row.get("son") or 0) + 1


def finish(row: dict) -> None:
    sn, son = int(row.get("sn") or 0), int(row.get("son") or 0)
    if sn:
        row["pct"] = round(float(row.get("sp") or 0.0) / sn, 2)
    if son:
        row["on"] = round(float(row.get("so") or 0.0) / son, 1)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def main() -> int:
    cfg = load_json(os.path.join(DATA, "stores.json"), {})
    stores = [s for s in cfg.get("stores", []) if s.get("enabled", True)]
    if not stores:
        print("!! stores.json 에 매장이 없습니다", file=sys.stderr)
        return 1

    live_path = os.path.join(DATA, "live.json")
    live = load_json(live_path, {})
    now = now_kst()
    stamp = now.isoformat(timespec="seconds")

    if not has_ping():
        live["runner"] = {"at": stamp, "error": "ping 명령을 찾을 수 없습니다"}
        write_json(live_path, live)
        print("!! ping 없음", file=sys.stderr)
        return 1

    if not ping_once(CONTROL_HOST):
        live["runner"] = {"at": stamp, "error": f"제어 ping 실패({CONTROL_HOST}) — 측정기 네트워크 점검 필요"}
        write_json(live_path, live)
        print("!! 제어 ping 실패 — 기록하지 않음", file=sys.stderr)
        return 0

    live["runner"] = {"at": stamp, "error": None}
    live["updated_at"] = stamp
    live["timezone"] = "Asia/Seoul"
    live.setdefault("stores", {})
    live.setdefault("days", [])
    live.setdefault("hourly", [])
    live.setdefault("recent", [])

    day = now.strftime("%Y-%m-%d")
    hour = now.hour

    for store in stores:
        sid = store["id"]
        hosts = parse_range(store.get("ip", ""))
        res = probe_store(store, hosts)
        sample = {"t": stamp, "store": sid, "method": "icmp", **res}
        live["stores"][sid] = sample
        live["recent"].insert(0, {"t": stamp, "store": sid, "on": res["on"], "pct": res["pct"]})
        print(f"  {store.get('short', sid)}: {res['on']}/{res['pcs']}대 ({res['pct']}%) {res['duration']}s")

        # 일별 집계
        row = next((d for d in live["days"] if d["day"] == day and d["store"] == sid), None)
        if row is None:
            row = {"day": day, "store": sid, "method": "icmp", "samples": 0, "fails": 0}
            live["days"].append(row)
        bump(row, res)

        # 시간별 집계
        hrow = next((h for h in live["hourly"] if h["day"] == day and h["hour"] == hour and h["store"] == sid), None)
        if hrow is None:
            hrow = {"day": day, "hour": hour, "store": sid, "method": "icmp", "samples": 0}
            live["hourly"].append(hrow)
        bump(hrow, res)

    # 집계값 마무리(누적 필드 sp·sn·so·son → 평균 pct·on)
    for row in live["days"] + live["hourly"]:
        finish(row)

    # 오래된 일별 → 월별 보관 파일로 옮기고 live.json 은 최근 것만
    cutoff = (now - dt.timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    old = [d for d in live["days"] if d["day"] < cutoff]
    if old:
        by_month = {}
        for d in old:
            by_month.setdefault(d["day"][:7], []).append(d)
        for month, rows in by_month.items():
            path = os.path.join(DATA, f"archive-{month}.json")
            arch = load_json(path, {"month": month, "days": []})
            known = {(r["day"], r["store"]) for r in arch["days"]}
            arch["days"].extend(r for r in rows if (r["day"], r["store"]) not in known)
            arch["days"].sort(key=lambda r: (r["day"], str(r["store"])))
            write_json(path, arch)
        live["days"] = [d for d in live["days"] if d["day"] >= cutoff]

    recent_cut = (now - dt.timedelta(days=HOURLY_DAYS)).strftime("%Y-%m-%d")
    live["hourly"] = [h for h in live["hourly"] if h["day"] >= recent_cut]
    live["recent"] = live["recent"][:RECENT_MAX]
    live["days"].sort(key=lambda r: (r["day"], str(r["store"])))
    live["hourly"].sort(key=lambda r: (r["day"], r["hour"], str(r["store"])))

    write_json(live_path, live)
    print(f"== 저장 완료 {stamp} · 일별 {len(live['days'])}행 · 시간별 {len(live['hourly'])}행")
    return 0


def write_json(path: str, obj) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


if __name__ == "__main__":
    sys.exit(main())
