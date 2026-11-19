package com.anarita82.familycalendar;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 📅 우리 가족 달력 — 홈 화면 위젯.
 *
 * 웹앱(app.js)이 일정을 불러올 때마다 AndroidApp.updateWidget(json) 으로 오늘·다가오는 일정을 넘기면
 * {@link #savePayload(Context, String)} 가 폰 안 SharedPreferences 에 저장하고 모든 위젯을 바로 다시 그립니다.
 * 네트워크를 직접 쓰지 않습니다 — 앱을 열어 동기화할 때 받은 내용만 보여 줍니다.
 */
public class CalendarWidgetProvider extends AppWidgetProvider {

    /** 위젯 오른쪽 '새로고침' — 저장된 내용으로 다시 그립니다(앱 실행 없이). */
    public static final String ACTION_REFRESH = "com.anarita82.familycalendar.action.WIDGET_REFRESH";

    private static final String PREFS = "family_widget";
    private static final String KEY_PAYLOAD = "payload";
    private static final int REQ_OPEN = 2101;
    private static final int REQ_REFRESH = 2102;

    private static final int[] TODAY_ROW_IDS = {R.id.todayRow1, R.id.todayRow2, R.id.todayRow3};
    private static final int[] TODAY_TIME_IDS = {R.id.todayTime1, R.id.todayTime2, R.id.todayTime3};
    private static final int[] TODAY_TEXT_IDS = {R.id.todayText1, R.id.todayText2, R.id.todayText3};
    private static final int[] UP_ROW_IDS = {R.id.upRow1, R.id.upRow2, R.id.upRow3};
    private static final int[] UP_DATE_IDS = {R.id.upDate1, R.id.upDate2, R.id.upDate3};
    private static final int[] UP_TEXT_IDS = {R.id.upText1, R.id.upText2, R.id.upText3};

    private static final String MSG_NEED_APP = "앱을 열면 오늘 일정이 바로 보여요";
    private static final String MSG_NO_TODAY = "오늘 등록된 일정이 없어요";

    /* ---------------- 위젯 수명 주기 ---------------- */

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            manager.updateAppWidget(id, buildViews(context, manager, id));
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle newOptions) {
        manager.updateAppWidget(id, buildViews(context, manager, id));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null && ACTION_REFRESH.equals(intent.getAction())) {
            refreshAll(context);
        }
    }

    /* ---------------- 웹앱 → 위젯 ---------------- */

    /** 웹앱이 넘긴 JSON(오늘·다가오는 일정)을 저장하고 위젯을 즉시 다시 그립니다. */
    static void savePayload(Context context, String json) {
        if (context == null || json == null) return;
        try {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            sp.edit().putString(KEY_PAYLOAD, json).apply();
        } catch (Exception ignored) {
            return;
        }
        refreshAll(context);
    }

    /** 저장된 내용으로 모든 위젯을 다시 그립니다. */
    static void refreshAll(Context context) {
        if (context == null) return;
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, CalendarWidgetProvider.class));
            for (int id : ids) {
                manager.updateAppWidget(id, buildViews(context, manager, id));
            }
        } catch (Exception ignored) {
            /* 위젯이 없거나 런처가 응답하지 않아도 앱 동작에는 영향 없음 */
        }
    }

    /* ---------------- 그리기 ---------------- */

    static RemoteViews buildViews(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_calendar);

        // 오늘 날짜는 폰 시계로 계산합니다(위젯이 30분마다 다시 그려지므로 날짜가 넘어가도 맞습니다).
        String todayIso = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        views.setTextViewText(R.id.widgetTitle, context.getString(R.string.widget_title));
        views.setTextViewText(R.id.widgetDate, new SimpleDateFormat("M월 d일 (E)", Locale.KOREAN).format(new Date()));

        PendingIntent refresh = refreshIntent(context);
        if (refresh != null) views.setOnClickPendingIntent(R.id.widgetRefresh, refresh);

        PendingIntent open = openIntent(context);
        if (open != null) {
            views.setOnClickPendingIntent(R.id.widgetRoot, open);
            views.setOnClickPendingIntent(R.id.widgetTitle, open);
            views.setOnClickPendingIntent(R.id.widgetDate, open);
            views.setOnClickPendingIntent(R.id.widgetEmpty, open);
        }

        // 위젯이 실제로 차지한 높이에 맞춰 줄 수를 정합니다(작은 4×2에서도 잘리지 않게).
        // 한 줄 높이: 오늘 23dp · 다가오는 20dp · 머리들 83dp(여백 포함)
        int heightDp = 236;
        try {
            Bundle opts = manager.getAppWidgetOptions(widgetId);
            if (opts != null) {
                int h = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
                if (h > 0) heightDp = h;
            }
        } catch (Exception ignored) { /* 기본값 사용 */ }
        int todayCap;
        int upCap;
        if (heightDp >= 245) { todayCap = 3; upCap = 3; }
        else if (heightDp >= 205) { todayCap = 3; upCap = 2; }
        else if (heightDp >= 180) { todayCap = 2; upCap = 2; }
        else if (heightDp >= 158) { todayCap = 2; upCap = 1; }
        else if (heightDp >= 132) { todayCap = 1; upCap = 1; }
        else { todayCap = 1; upCap = 0; }

        Payload data = readPayload(context, todayIso);

        if (data == null) {
            // 아직 앱에서 한 번도 동기화하지 않은 상태
            views.setViewVisibility(R.id.todayHeader, View.GONE);
            views.setTextViewText(R.id.widgetEmpty, MSG_NEED_APP);
            views.setViewVisibility(R.id.widgetEmpty, View.VISIBLE);
            hideAll(views);
            return views;
        }

        boolean sameDay = todayIso.equals(data.date);

        // 오늘 일정
        List<Row> today = sameDay ? data.today : new ArrayList<Row>();
        int shownToday = 0;
        if (today.isEmpty()) {
            views.setViewVisibility(R.id.todayHeader, sameDay ? View.VISIBLE : View.GONE);
            views.setTextViewText(R.id.widgetEmpty, sameDay ? MSG_NO_TODAY : MSG_NEED_APP);
            views.setViewVisibility(R.id.widgetEmpty, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.todayHeader, View.VISIBLE);
            views.setViewVisibility(R.id.widgetEmpty, View.GONE);
        }
        for (int i = 0; i < TODAY_ROW_IDS.length; i++) {
            if (i < today.size() && i < todayCap) {
                Row row = today.get(i);
                views.setViewVisibility(TODAY_ROW_IDS[i], View.VISIBLE);
                views.setTextViewText(TODAY_TIME_IDS[i], row.when);
                views.setTextViewText(TODAY_TEXT_IDS[i], row.title);
                shownToday++;
            } else {
                views.setViewVisibility(TODAY_ROW_IDS[i], View.GONE);
            }
        }
        views.setTextViewText(R.id.todayHeader, "오늘 일정" + moreLabel(today.size() - shownToday));

        // 다가오는 일정(오늘이 지난 저장 내용이어도 지난 날짜는 걸러 냅니다)
        List<Row> upcoming = new ArrayList<Row>();
        for (Row row : data.upcoming) {
            if (row.iso == null || row.iso.compareTo(todayIso) >= 0) upcoming.add(row);
        }
        int shownUp = 0;
        for (int i = 0; i < UP_ROW_IDS.length; i++) {
            if (i < upcoming.size() && i < upCap) {
                Row row = upcoming.get(i);
                views.setViewVisibility(UP_ROW_IDS[i], View.VISIBLE);
                views.setTextViewText(UP_DATE_IDS[i], row.when);
                views.setTextViewText(UP_TEXT_IDS[i], row.title);
                shownUp++;
            } else {
                views.setViewVisibility(UP_ROW_IDS[i], View.GONE);
            }
        }
        boolean hasUp = shownUp > 0;
        views.setViewVisibility(R.id.upcomingHeader, hasUp ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.upcomingHeader, "다가오는 일정" + moreLabel(upcoming.size() - shownUp));

        return views;
    }

    private static void hideAll(RemoteViews views) {
        for (int id : TODAY_ROW_IDS) views.setViewVisibility(id, View.GONE);
        for (int id : UP_ROW_IDS) views.setViewVisibility(id, View.GONE);
        views.setViewVisibility(R.id.upcomingHeader, View.GONE);
    }

    private static String moreLabel(int hidden) {
        return hidden > 0 ? " · 외 " + hidden + "건" : "";
    }

    /* ---------------- 저장된 JSON 읽기 ---------------- */

    private static class Row {
        String when;   // 오늘: "16:30" / 다가오는: "11.25(화)"
        String title;  // "치과 정기검진 · 첫째"
        String iso;    // 다가오는 일정의 날짜(yyyy-MM-dd)
    }

    private static class Payload {
        String date = "";
        List<Row> today = new ArrayList<Row>();
        List<Row> upcoming = new ArrayList<Row>();
    }

    private static Payload readPayload(Context context, String todayIso) {
        String json;
        try {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            json = sp.getString(KEY_PAYLOAD, null);
        } catch (Exception e) {
            return null;
        }
        if (json == null || json.trim().isEmpty()) return null;

        Payload out = new Payload();
        try {
            JSONObject root = new JSONObject(json);
            out.date = root.optString("date", "");

            SimpleDateFormat dayLabel = new SimpleDateFormat("M.d(E)", Locale.KOREAN);
            SimpleDateFormat isoParser = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            isoParser.setLenient(false);

            JSONArray todayArr = root.optJSONArray("today");
            if (todayArr != null) {
                for (int i = 0; i < todayArr.length() && i < 6; i++) {
                    JSONObject o = todayArr.optJSONObject(i);
                    if (o == null) continue;
                    Row row = new Row();
                    row.when = o.optString("t", "");
                    row.title = composeTitle(o.optString("n", ""), o.optString("w", ""), "");
                    if (!row.title.isEmpty()) out.today.add(row);
                }
            }

            JSONArray upArr = root.optJSONArray("upcoming");
            if (upArr != null) {
                for (int i = 0; i < upArr.length() && i < 6; i++) {
                    JSONObject o = upArr.optJSONObject(i);
                    if (o == null) continue;
                    Row row = new Row();
                    row.iso = o.optString("d", "");
                    row.title = composeTitle(o.optString("n", ""), o.optString("w", ""), o.optString("t", ""));
                    if (row.title.isEmpty()) continue;
                    try {
                        row.when = dayLabel.format(isoParser.parse(row.iso));
                    } catch (Exception e) {
                        row.when = row.iso;
                    }
                    out.upcoming.add(row);
                }
            }
        } catch (Exception e) {
            return null; // 깨진 저장값이면 '앱을 열어 주세요' 상태로
        }
        return out;
    }

    /** "시간 제목 · 담당" 형태로 한 줄을 만듭니다. */
    private static String composeTitle(String name, String who, String time) {
        StringBuilder sb = new StringBuilder();
        if (time != null && !time.isEmpty()) sb.append(time).append(' ');
        sb.append(name == null ? "" : name);
        if (who != null && !who.isEmpty()) sb.append(" · ").append(who);
        return sb.toString().trim();
    }

    /* ---------------- 탭 동작 ---------------- */

    private static PendingIntent openIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, REQ_OPEN, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent refreshIntent(Context context) {
        Intent intent = new Intent(context, CalendarWidgetProvider.class);
        intent.setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, REQ_REFRESH, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
