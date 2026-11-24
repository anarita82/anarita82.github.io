import com.anarita82.familycalendar.WidgetMonth;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 위젯 미리보기용 하네스 — 앱과 같은 계산(WidgetMonth)으로 격자를 만들어 JSON 으로 찍습니다.
 * (안드로이드 없이 PC 에서 돌립니다)
 *
 *   javac -d /tmp/wp app/src/main/java/com/anarita82/familycalendar/WidgetMonth.java tools/WidgetPreview.java
 *   java -cp /tmp/wp WidgetPreview 300 340 2026-11-25 > /tmp/cells.json
 */
public final class WidgetPreview {

    private static WidgetMonth.Item it(String emoji, String title, String time) {
        return new WidgetMonth.Item(emoji, title, time);
    }

    private static void add(Map<String, List<WidgetMonth.Item>> map, String iso, WidgetMonth.Item... items) {
        List<WidgetMonth.Item> list = new ArrayList<WidgetMonth.Item>();
        for (WidgetMonth.Item i : items) list.add(i);
        map.put(iso, list);
    }

    private static Map<String, List<WidgetMonth.Item>> sample() {
        Map<String, List<WidgetMonth.Item>> m = new HashMap<String, List<WidgetMonth.Item>>();
        add(m, "2026-10-30", it("🧹", "대청소", ""));
        add(m, "2026-11-01", it("🎂", "외할머니 생신", "12:00"));
        add(m, "2026-11-03", it("🕯️", "제사 준비", "19:00"));
        add(m, "2026-11-06", it("📚", "첫째 학원 상담", "17:00"));
        add(m, "2026-11-11", it("💳", "카드 결제일", ""));
        add(m, "2026-11-13", it("🛒", "장보기", ""));
        add(m, "2026-11-18", it("🚌", "둘째 체험학습", ""), it("💊", "막내 약 챙기기", ""));
        add(m, "2026-11-20", it("🏫", "학부모 상담", "15:00"));
        add(m, "2026-11-24", it("💉", "둘째 예방접종", "10:00"));
        add(m, "2026-11-25", it("🦷", "치과 정기검진", "16:30"), it("🍽️", "엄마 회식", "19:00"),
                it("🛒", "주말 장보기", ""));
        add(m, "2026-11-26", it("📦", "택배 수령", ""));
        add(m, "2026-11-27", it("✈️", "오사카 출발", "09:30"));
        add(m, "2026-11-28", it("✈️", "오사카 2일차", ""));
        add(m, "2026-11-29", it("✈️", "오사카 3일차", ""));
        add(m, "2026-11-30", it("✈️", "오사카 → 서울", "18:00"));
        add(m, "2026-12-02", it("🎂", "아빠 생일", ""));
        add(m, "2026-12-05", it("🏨", "숙소 예약 확인", ""));
        return m;
    }

    public static void main(String[] args) {
        int width = args.length > 0 ? Integer.parseInt(args[0]) : 300;
        int height = args.length > 1 ? Integer.parseInt(args[1]) : 340;
        String today = args.length > 2 ? args[2] : "2026-11-25";
        int year = args.length > 3 ? Integer.parseInt(args[3]) : 2026;
        int month = args.length > 4 ? Integer.parseInt(args[4]) : 11;

        WidgetMonth.Cell[] cells = WidgetMonth.build(year, month, today, sample(), width, height);

        StringBuilder sb = new StringBuilder();
        sb.append("{\"width\":").append(width).append(",\"height\":").append(height)
                .append(",\"year\":").append(year).append(",\"month\":").append(month)
                .append(",\"today\":\"").append(today).append("\",\"cells\":[");
        for (int i = 0; i < cells.length; i++) {
            WidgetMonth.Cell c = cells[i];
            if (i > 0) sb.append(',');
            sb.append("{\"i\":").append(i)
                    .append(",\"col\":").append(c.col)
                    .append(",\"day\":").append(c.day)
                    .append(",\"iso\":\"").append(c.iso).append('"')
                    .append(",\"inMonth\":").append(c.inMonth)
                    .append(",\"today\":").append(c.today)
                    .append(",\"n\":").append(c.eventCount)
                    .append(",\"l1\":").append(q(c.line1))
                    .append(",\"l2\":").append(q(c.line2))
                    .append(",\"l2t\":").append(c.line2Time)
                    .append(",\"daySize\":").append(c.daySize)
                    .append(",\"l1Size\":").append(c.line1Size)
                    .append(",\"l2Size\":").append(c.line2Size)
                    .append('}');
        }
        sb.append("]}");
        System.out.println(sb.toString());
    }

    private static String q(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '"' || ch == '\\') sb.append('\\').append(ch);
            else if (ch < 0x20) sb.append(' ');
            else sb.append(ch);
        }
        return sb.append('"').toString();
    }
}
