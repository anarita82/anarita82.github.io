package com.anarita82.familycalendar;

import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 📅 월간 격자 위젯의 '무엇을 어디에 쓸지'만 계산하는 순수 자바 클래스입니다.
 * (안드로이드 클래스에 기대지 않아 PC에서 그대로 돌려 미리보기를 만들 수 있습니다 — tools/WidgetPreview.java)
 *
 * 위젯 레이아웃(widget_calendar.xml)의 실제 치수와 아래 상수가 맞아야 글자가 잘리지 않습니다.
 *  · 위/아래 여백 10dp + 머리글 24dp + 요일줄(위 3dp + 16dp) = 63dp 를 뺀 나머지가 6주 격자 높이입니다.
 */
public final class WidgetMonth {

    public static final int ROWS = 6;
    public static final int COLS = 7;
    public static final int CELLS = ROWS * COLS;

    /** 격자 위쪽에서 이미 쓰는 높이(세로 여백 + 머리글 + 요일줄) dp */
    static final int TOP_DP = 63;
    /** 격자 좌우 여백 합 dp */
    static final int SIDE_DP = 24;

    /** 위젯에 넘어온 일정 한 건 */
    public static final class Item {
        public final String emoji;
        public final String title;
        public final String time;

        public Item(String emoji, String title, String time) {
            this.emoji = emoji == null ? "" : emoji;
            this.title = title == null ? "" : title;
            this.time = time == null ? "" : time;
        }
    }

    /** 격자 한 칸의 그리기 값 */
    public static final class Cell {
        public int day;
        public String iso = "";
        public boolean inMonth;
        public boolean today;
        public int col;
        public int eventCount;
        public String line1 = "";
        public String line2 = "";
        public boolean line2Time;       // line2 가 시간(인디고)인지
        public float daySize = 13f;
        public float line1Size = 9f;
        public float line2Size = 8f;
    }

    private WidgetMonth() {
    }

    public static Cell[] build(int year, int month, String todayIso,
                               Map<String, List<Item>> byDay,
                               int widthDp, int heightDp) {
        int cellW = Math.max(26, (widthDp - SIDE_DP) / COLS);
        int rowH = Math.max(14, (heightDp - TOP_DP) / ROWS);

        /* 칸 높이에 따라 글자 크기와 줄 수를 정합니다.
           레이아웃의 칸 상자는 날짜 18dp · 일정1 12dp · 일정2 11dp 로 고정이라
           두 줄을 쓰려면 18 + 1 + 12 + 11 = 42dp 이상이 필요합니다. */
        float daySize, line1Size, line2Size;
        boolean second;
        if (rowH >= 55) {
            daySize = 14f; line1Size = 9.5f; line2Size = 8.5f; second = true;
        } else if (rowH >= 42) {
            daySize = 13f; line1Size = 9f; line2Size = 8f; second = true;
        } else if (rowH >= 31) {
            daySize = 12f; line1Size = 8.5f; line2Size = 8f; second = false;
        } else {
            daySize = 11f; line1Size = 8f; line2Size = 8f; second = false;
        }
        /* 칸 너비에 들어가는 제목 글자 수 — 한글 1자 ≈ line1Size dp, 이모지 ≈ line1Size * 1.25 dp */
        int titleChars = (int) Math.floor((cellW - 3 - line1Size * 1.25f) / (line1Size * 0.98f));
        if (titleChars < 1) titleChars = 1;
        if (titleChars > 8) titleChars = 8;

        Calendar cursor = Calendar.getInstance();
        cursor.set(year, month - 1, 1, 12, 0, 0);
        cursor.set(Calendar.MILLISECOND, 0);
        int offset = cursor.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY; // 일요일이 0
        cursor.add(Calendar.DATE, -offset);

        Cell[] cells = new Cell[CELLS];
        for (int i = 0; i < CELLS; i++) {
            Cell c = new Cell();
            c.col = i % COLS;
            int y = cursor.get(Calendar.YEAR);
            int m = cursor.get(Calendar.MONTH) + 1;
            int d = cursor.get(Calendar.DATE);
            c.day = d;
            c.iso = String.format(Locale.US, "%04d-%02d-%02d", y, m, d);
            c.inMonth = (y == year && m == month);
            c.today = c.iso.equals(todayIso);
            c.daySize = daySize;
            c.line1Size = line1Size;
            c.line2Size = line2Size;
            cursor.add(Calendar.DATE, 1);

            /* 이웃 달 날짜는 숫자만 (일정은 이번 달 칸에만 보여 줍니다) */
            if (!c.inMonth) {
                cells[i] = c;
                continue;
            }

            List<Item> items = byDay == null ? null : byDay.get(c.iso);
            if (items == null || items.isEmpty()) {
                cells[i] = c;
                continue;
            }
            c.eventCount = items.size();
            Item first = items.get(0);
            c.line1 = compose(first, titleChars);

            if (second) {
                if (items.size() >= 3) {
                    c.line2 = "+" + (items.size() - 1);
                } else if (items.size() == 2) {
                    c.line2 = compose(items.get(1), titleChars);
                } else if (!first.time.isEmpty()) {
                    c.line2 = first.time;
                    c.line2Time = true;
                }
            }
            cells[i] = c;
        }
        return cells;
    }

    /** "🎂생일" 처럼 이모지 + 짧은 제목. 칸이 좁으면 글자 수를 줄이고 … 를 붙입니다. */
    static String compose(Item item, int maxChars) {
        String title = item.title == null ? "" : item.title.trim();
        boolean cut = title.length() > maxChars;
        if (cut) title = title.substring(0, maxChars);
        String emoji = item.emoji;
        StringBuilder sb = new StringBuilder();
        if (emoji != null && !emoji.isEmpty()) {
            sb.append(emoji);
            if (maxChars >= 4) sb.append(' ');
        }
        sb.append(title);
        if (cut) sb.append('…');
        return sb.toString();
    }

    /** 이번 달 격자에 일정이 하나라도 있는지 (빈 달 안내에 쓸 수 있음) */
    public static int eventDays(Cell[] cells) {
        int n = 0;
        if (cells == null) return 0;
        for (Cell c : cells) if (c.inMonth && c.eventCount > 0) n++;
        return n;
    }
}
