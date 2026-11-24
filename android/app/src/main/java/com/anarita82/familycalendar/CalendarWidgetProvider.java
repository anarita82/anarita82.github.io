package com.anarita82.familycalendar;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 📅 우리 가족 달력 — 홈 화면 '월간 격자' 위젯 (v1.7).
 *
 * 웹앱(app.js)이 일정을 불러올 때마다 AndroidApp.updateWidget(json) 으로 이번 달 앞뒤 몇 달치 일정을 넘기면
 * {@link #savePayload(Context, String)} 가 폰 안 SharedPreferences 에 저장하고 모든 위젯을 바로 다시 그립니다.
 * 네트워크를 직접 쓰지 않습니다 — 앱을 열어 동기화할 때 받은 내용만 보여 줍니다.
 *
 * ◀ ▶ · 오늘 버튼은 앱을 열지 않고 이 리시버로 브로드캐스트를 보내 그 위젯의 '보고 있는 달'만 바꿉니다.
 */
public class CalendarWidgetProvider extends AppWidgetProvider {

    /** 위젯 '↻' — 저장된 내용으로 다시 그립니다(앱 실행 없이). */
    public static final String ACTION_REFRESH = "com.anarita82.familycalendar.action.WIDGET_REFRESH";
    /** 위젯 ◀ ▶ 오늘 — 그 위젯이 보여 줄 달을 바꿉니다. */
    public static final String ACTION_NAV = "com.anarita82.familycalendar.action.WIDGET_NAV";

    private static final String EXTRA_WIDGET = "widgetId";
    private static final String EXTRA_DELTA = "delta";

    private static final String PREFS = "family_widget";
    private static final String KEY_PAYLOAD = "payload";
    private static final String KEY_MONTH = "month_";

    private static final int REQ_OPEN = 2101;
    private static final int REQ_REFRESH = 2102;
    private static final int REQ_PREV = 2301;
    private static final int REQ_TODAY = 2302;
    private static final int REQ_NEXT = 2303;

    private static final String MSG_NEED_APP = "앱을 열면 일정이 달력에 채워져요";

    private static final int C_DARK = Color.parseColor("#1f2430");
    private static final int C_SUN = Color.parseColor("#e5484d");
    private static final int C_SAT = Color.parseColor("#3b82f6");
    private static final int C_MUTED = Color.parseColor("#c6cbd8");
    private static final int C_SUB = Color.parseColor("#8b93a7");
    private static final int C_BRAND = Color.parseColor("#4f46e5");

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
    public void onDeleted(Context context, int[] appWidgetIds) {
        try {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = sp.edit();
            for (int id : appWidgetIds) editor.remove(KEY_MONTH + id);
            editor.apply();
        } catch (Exception ignored) { /* 무시 */ }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_NAV.equals(action)) {
            int id = intent.getIntExtra(EXTRA_WIDGET, AppWidgetManager.INVALID_APPWIDGET_ID);
            if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
                shiftMonth(context, id, intent.getIntExtra(EXTRA_DELTA, 0));
                return;
            }
        }
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(action)) refreshAll(context);
    }

    /* ---------------- 웹앱 → 위젯 ---------------- */

    /** 웹앱이 넘긴 JSON(이번 달 앞뒤 일정)을 저장하고 위젯을 즉시 다시 그립니다. */
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

    /* ---------------- 달 이동 ---------------- */

    private static void shiftMonth(Context context, int widgetId, int delta) {
        Calendar month;
        if (delta == 0) {
            month = firstOfMonth(new Date());
        } else {
            month = displayedMonth(context, widgetId);
            month.add(Calendar.MONTH, delta);
        }
        saveMonth(context, widgetId, month);
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            manager.updateAppWidget(widgetId, buildViews(context, manager, widgetId));
        } catch (Exception ignored) { /* 무시 */ }
    }

    private static Calendar firstOfMonth(Date date) {
        Calendar c = Calendar.getInstance();
        c.setTime(date);
        c.set(Calendar.DAY_OF_MONTH, 1);
        c.set(Calendar.HOUR_OF_DAY, 12);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c;
    }

    /** 그 위젯이 지금 보고 있는 달(저장값이 없으면 이번 달). */
    private static Calendar displayedMonth(Context context, int widgetId) {
        try {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String s = sp.getString(KEY_MONTH + widgetId, null);
            if (s != null && s.length() == 7) {
                int y = Integer.parseInt(s.substring(0, 4));
                int m = Integer.parseInt(s.substring(5, 7));
                if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
                    Calendar c = Calendar.getInstance();
                    c.set(y, m - 1, 1, 12, 0, 0);
                    c.set(Calendar.MILLISECOND, 0);
                    return c;
                }
            }
        } catch (Exception ignored) { /* 이번 달로 */ }
        return firstOfMonth(new Date());
    }

    private static void saveMonth(Context context, int widgetId, Calendar month) {
        try {
            String s = String.format(Locale.US, "%04d-%02d",
                    month.get(Calendar.YEAR), month.get(Calendar.MONTH) + 1);
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            sp.edit().putString(KEY_MONTH + widgetId, s).apply();
        } catch (Exception ignored) { /* 무시 */ }
    }

    /* ---------------- 그리기 ---------------- */

    static RemoteViews buildViews(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_calendar);

        String todayIso = todayIso();
        Calendar month = displayedMonth(context, widgetId);
        int year = month.get(Calendar.YEAR);
        int mon = month.get(Calendar.MONTH) + 1;

        int[] size = widgetSize(manager, widgetId);
        Map<String, List<WidgetMonth.Item>> days = readDays(context);
        WidgetMonth.Cell[] cells = WidgetMonth.build(year, mon, todayIso, days, size[0], size[1]);

        views.setTextViewText(R.id.widgetTitle, year + "년 " + mon + "월");

        if (days == null) {
            views.setTextViewText(R.id.widgetHint, MSG_NEED_APP);
            views.setViewVisibility(R.id.widgetHint, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.widgetHint, View.GONE);
        }

        for (int i = 0; i < WidgetMonth.CELLS && i < WidgetIds.DAY.length; i++) {
            WidgetMonth.Cell c = cells[i];
            int dayId = WidgetIds.DAY[i];

            views.setTextViewTextSize(dayId, TypedValue.COMPLEX_UNIT_SP, c.daySize);
            views.setTextViewText(dayId, String.valueOf(c.day));
            if (c.today) {
                views.setTextColor(dayId, Color.WHITE);
                views.setInt(dayId, "setBackgroundResource", R.drawable.widget_today_badge);
            } else {
                views.setInt(dayId, "setBackgroundResource", 0);
                int color;
                if (!c.inMonth) color = C_MUTED;
                else if (c.col == 0) color = C_SUN;
                else if (c.col == 6) color = C_SAT;
                else color = C_DARK;
                views.setTextColor(dayId, color);
            }

            int e1 = (WidgetIds.EV1.length > i) ? WidgetIds.EV1[i] : 0;
            int e2 = (WidgetIds.EV2.length > i) ? WidgetIds.EV2[i] : 0;
            if (e1 != 0) {
                views.setTextViewTextSize(e1, TypedValue.COMPLEX_UNIT_SP, c.line1Size);
                views.setTextViewText(e1, c.line1);
                views.setViewVisibility(e1, c.line1.length() > 0 ? View.VISIBLE : View.GONE);
            }
            if (e2 != 0) {
                views.setTextViewTextSize(e2, TypedValue.COMPLEX_UNIT_SP, c.line2Size);
                views.setTextViewText(e2, c.line2);
                views.setTextColor(e2, c.line2Time ? C_BRAND : C_SUB);
                views.setViewVisibility(e2, c.line2.length() > 0 ? View.VISIBLE : View.GONE);
            }
        }

        PendingIntent open = openIntent(context);
        if (open != null) {
            views.setOnClickPendingIntent(R.id.widgetRoot, open);
            views.setOnClickPendingIntent(R.id.widgetTitle, open);
        }
        PendingIntent refresh = refreshIntent(context);
        if (refresh != null) views.setOnClickPendingIntent(R.id.widgetRefresh, refresh);
        PendingIntent prev = navIntent(context, widgetId, -1, REQ_PREV);
        PendingIntent next = navIntent(context, widgetId, 1, REQ_NEXT);
        PendingIntent today = navIntent(context, widgetId, 0, REQ_TODAY);
        if (prev != null) views.setOnClickPendingIntent(R.id.widgetPrev, prev);
        if (next != null) views.setOnClickPendingIntent(R.id.widgetNext, next);
        if (today != null) views.setOnClickPendingIntent(R.id.widgetToday, today);

        return views;
    }

    /** 위젯이 실제로 차지한 크기(dp). 알 수 없으면 4×4 기준값을 씁니다. */
    private static int[] widgetSize(AppWidgetManager manager, int widgetId) {
        int width = 300;
        int height = 340;
        try {
            Bundle opts = manager.getAppWidgetOptions(widgetId);
            if (opts != null) {
                int w = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                int h = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
                if (w > 0) width = w;
                if (h > 0) height = h;
            }
        } catch (Exception ignored) { /* 기본값 */ }
        return new int[]{width, height};
    }

    private static String todayIso() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /* ---------------- 저장된 JSON 읽기 ---------------- */

    /**
     * 웹앱이 넘긴 일정을 날짜별로 풀어 둡니다.
     * 돌려주는 값이 null 이면 '아직 한 번도 동기화하지 않음'(= 앱을 열어 달라는 안내),
     * 빈 Map 이면 '동기화는 했는데 일정이 없음' 입니다.
     */
    private static Map<String, List<WidgetMonth.Item>> readDays(Context context) {
        String json;
        try {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            json = sp.getString(KEY_PAYLOAD, null);
        } catch (Exception e) {
            return null;
        }
        if (json == null || json.trim().isEmpty()) return null;

        Map<String, List<WidgetMonth.Item>> out = new HashMap<String, List<WidgetMonth.Item>>();
        try {
            JSONObject root = new JSONObject(json);

            JSONObject days = root.optJSONObject("days");
            if (days != null) {
                Iterator<String> keys = days.keys();
                int guard = 0;
                while (keys.hasNext() && guard < 500) {
                    String iso = keys.next();
                    guard++;
                    if (iso == null || iso.length() != 10) continue;
                    JSONArray arr = days.optJSONArray(iso);
                    if (arr == null) continue;
                    List<WidgetMonth.Item> list = new ArrayList<WidgetMonth.Item>();
                    for (int i = 0; i < arr.length() && i < 6; i++) {
                        JSONObject o = arr.optJSONObject(i);
                        if (o == null) continue;
                        String name = o.optString("n", "").trim();
                        if (name.isEmpty()) name = o.optString("t", "").trim();
                        if (name.isEmpty()) continue;
                        list.add(new WidgetMonth.Item(o.optString("e", ""), name, o.optString("t", "")));
                    }
                    if (!list.isEmpty()) out.put(iso, list);
                }
            }

            /* 예전 웹앱(v97 이하)은 today/upcoming 만 보냈습니다 — 격자에 옮겨 담아 빈 달이 되지 않게. */
            if (out.isEmpty()) {
                String today = root.optString("date", "");
                JSONArray todayArr = root.optJSONArray("today");
                if (todayArr != null && today.length() == 10) {
                    List<WidgetMonth.Item> list = new ArrayList<WidgetMonth.Item>();
                    for (int i = 0; i < todayArr.length() && i < 6; i++) {
                        JSONObject o = todayArr.optJSONObject(i);
                        if (o == null) continue;
                        String name = o.optString("n", "").trim();
                        if (name.isEmpty()) continue;
                        list.add(new WidgetMonth.Item(o.optString("e", ""), name, o.optString("t", "")));
                    }
                    if (!list.isEmpty()) out.put(today, list);
                }
                JSONArray upArr = root.optJSONArray("upcoming");
                if (upArr != null) {
                    for (int i = 0; i < upArr.length() && i < 6; i++) {
                        JSONObject o = upArr.optJSONObject(i);
                        if (o == null) continue;
                        String iso = o.optString("d", "");
                        String name = o.optString("n", "").trim();
                        if (iso.length() != 10 || name.isEmpty()) continue;
                        List<WidgetMonth.Item> list = out.get(iso);
                        if (list == null) {
                            list = new ArrayList<WidgetMonth.Item>();
                            out.put(iso, list);
                        }
                        list.add(new WidgetMonth.Item(o.optString("e", ""), name, o.optString("t", "")));
                    }
                }
            }
        } catch (Exception e) {
            return null; // 깨진 저장값이면 '앱을 열어 주세요' 상태로
        }
        return out;
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

    private static PendingIntent navIntent(Context context, int widgetId, int delta, int reqBase) {
        Intent intent = new Intent(context, CalendarWidgetProvider.class);
        intent.setAction(ACTION_NAV);
        intent.setData(Uri.parse("famcal://widget/" + widgetId + "/" + delta));
        intent.putExtra(EXTRA_WIDGET, widgetId);
        intent.putExtra(EXTRA_DELTA, delta);
        return PendingIntent.getBroadcast(context, reqBase + (widgetId % 500), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
