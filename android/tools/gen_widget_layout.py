#!/usr/bin/env python3
"""위젯 레이아웃(widget_calendar.xml)과 셀 ID 배열(WidgetIds.java)을 만듭니다.

v1.7 월간 격자 위젯 = 머리글 + 요일줄 + 6주 × 7일 정적 LinearLayout 격자.
RemoteViews 는 GridLayout 을 안전하게 못 쓰므로, 무게(weight)로 나눈 정적 칸을 씁니다.
칸을 늘리거나 줄일 때는 ROWS/COLS 만 고치고 이 스크립트를 다시 돌리면 됩니다.
"""
import os

ROWS, COLS = 6, 7
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LAYOUT = os.path.join(ROOT, "app/src/main/res/layout/widget_calendar.xml")
IDS = os.path.join(ROOT, "app/src/main/java/com/anarita82/familycalendar/WidgetIds.java")

DOW = ["일", "월", "화", "수", "목", "금", "토"]
DOW_COLOR = ["#e5484d"] + ["#6b7280"] * 5 + ["#3b82f6"]

HEADER = """<?xml version="1.0" encoding="utf-8"?>
<!-- 📅 월간 격자 위젯 (v1.7) — tools/gen_widget_layout.py 로 생성합니다. 손으로 고치지 마세요. -->
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widgetRoot"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@drawable/widget_bg"
    android:paddingLeft="12dp"
    android:paddingRight="12dp"
    android:paddingTop="10dp"
    android:paddingBottom="10dp">

    <!-- 머리글: 2026년 11월 · ◀ · 오늘 · ▶ · 새로고침 -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="24dp"
        android:orientation="horizontal"
        android:gravity="center_vertical">

        <TextView
            android:id="@+id/widgetTitle"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:text="@string/widget_title"
            android:textColor="#1f2430"
            android:textSize="15sp"
            android:fontFamily="sans-serif-medium"
            android:maxLines="1"
            android:ellipsize="end" />

        <TextView
            android:id="@+id/widgetPrev"
            android:layout_width="22dp"
            android:layout_height="22dp"
            android:background="@drawable/widget_nav_bg"
            android:gravity="center"
            android:includeFontPadding="false"
            android:text="◀"
            android:textColor="#4f46e5"
            android:textSize="9sp" />

        <TextView
            android:id="@+id/widgetToday"
            android:layout_width="wrap_content"
            android:layout_height="22dp"
            android:layout_marginLeft="4dp"
            android:background="@drawable/widget_chip"
            android:fontFamily="sans-serif-medium"
            android:gravity="center"
            android:includeFontPadding="false"
            android:paddingLeft="9dp"
            android:paddingRight="9dp"
            android:text="@string/widget_today_button"
            android:textColor="#4f46e5"
            android:textSize="10sp"
            android:maxLines="1" />

        <TextView
            android:id="@+id/widgetNext"
            android:layout_width="22dp"
            android:layout_height="22dp"
            android:layout_marginLeft="4dp"
            android:background="@drawable/widget_nav_bg"
            android:gravity="center"
            android:includeFontPadding="false"
            android:text="▶"
            android:textColor="#4f46e5"
            android:textSize="9sp" />

        <TextView
            android:id="@+id/widgetRefresh"
            android:layout_width="20dp"
            android:layout_height="22dp"
            android:layout_marginLeft="3dp"
            android:gravity="center"
            android:includeFontPadding="false"
            android:text="↻"
            android:textColor="#9aa1b2"
            android:textSize="13sp" />
    </LinearLayout>

    <TextView
        android:id="@+id/widgetHint"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="3dp"
        android:maxLines="1"
        android:ellipsize="end"
        android:text="@string/widget_need_app"
        android:textColor="#8b93a7"
        android:textSize="9sp"
        android:visibility="gone" />

    <!-- 요일 -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="16dp"
        android:layout_marginTop="3dp"
        android:orientation="horizontal">
"""

WEEKDAY_ROW = """        <TextView
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1"
            android:gravity="center"
            android:includeFontPadding="false"
            android:text="{dow}"
            android:textColor="{color}"
            android:textSize="10sp"
            android:fontFamily="sans-serif-medium" />
"""

GRID_OPEN = """    </LinearLayout>

    <!-- 6주 × 7일 격자 -->
    <LinearLayout
        android:id="@+id/widgetGrid"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:orientation="vertical">
"""

ROW_OPEN = """
        <LinearLayout
            android:id="@+id/week{row}"
            android:layout_width="match_parent"
            android:layout_height="0dp"
            android:layout_weight="1"
            android:orientation="horizontal">
"""

CELL = """
            <LinearLayout
                android:id="@+id/cell{idx}"
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_weight="1"
                android:orientation="vertical"
                android:gravity="top|center_horizontal"
                android:paddingTop="1dp">

                <TextView
                    android:id="@+id/day{idx}"
                    android:layout_width="wrap_content"
                    android:layout_height="18dp"
                    android:gravity="center"
                    android:includeFontPadding="false"
                    android:minWidth="16dp"
                    android:paddingLeft="3dp"
                    android:paddingRight="3dp"
                    android:paddingTop="1dp"
                    android:paddingBottom="1dp"
                    android:textSize="13sp"
                    android:fontFamily="sans-serif-medium"
                    android:maxLines="1"
                    android:textColor="{color}" />

                <TextView
                    android:id="@+id/ev1_{idx}"
                    android:layout_width="match_parent"
                    android:layout_height="12dp"
                    android:layout_marginTop="1dp"
                    android:gravity="center"
                    android:includeFontPadding="false"
                    android:maxLines="1"
                    android:ellipsize="end"
                    android:textColor="#3b4152"
                    android:textSize="9sp"
                    android:visibility="gone" />

                <TextView
                    android:id="@+id/ev2_{idx}"
                    android:layout_width="match_parent"
                    android:layout_height="11dp"
                    android:gravity="center"
                    android:includeFontPadding="false"
                    android:maxLines="1"
                    android:ellipsize="end"
                    android:textColor="#8b93a7"
                    android:textSize="8sp"
                    android:visibility="gone" />
            </LinearLayout>
"""

TAIL = "    </LinearLayout>\n</LinearLayout>\n"


def main():
    out = [HEADER]
    for i, dow in enumerate(DOW):
        out.append(WEEKDAY_ROW.format(dow=dow, color=DOW_COLOR[i]))
    out.append(GRID_OPEN)
    for r in range(ROWS):
        out.append(ROW_OPEN.format(row=r + 1))
        for c in range(COLS):
            idx = r * COLS + c
            out.append(CELL.format(idx=idx, color=DOW_COLOR[c]))
        out.append("        </LinearLayout>\n")
    out.append(TAIL)
    with open(LAYOUT, "w", encoding="utf-8") as f:
        f.write("".join(out))

    def arr(name, fmt):
        items = ", ".join(fmt.format(i) for i in range(ROWS * COLS))
        return f"    static final int[] {name} = {{ {items} }};\n"

    java = ["package com.anarita82.familycalendar;\n\n",
            "/** 위젯 격자 칸 ID (tools/gen_widget_layout.py 생성 — 손으로 고치지 마세요) */\n",
            "final class WidgetIds {\n\n",
            "    static final int CELLS = %d;\n\n" % (ROWS * COLS),
            arr("DAY", "R.id.day{0}"),
            arr("EV1", "R.id.ev1_{0}"),
            arr("EV2", "R.id.ev2_{0}"),
            "\n    private WidgetIds() {}\n}\n"]
    with open(IDS, "w", encoding="utf-8") as f:
        f.write("".join(java))
    print("wrote", LAYOUT)
    print("wrote", IDS)


if __name__ == "__main__":
    main()
