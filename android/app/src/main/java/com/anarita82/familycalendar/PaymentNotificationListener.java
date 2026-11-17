package com.anarita82.familycalendar;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 💰 금전출납부 — 폰 알림 자동 수집.
 *
 * 사용자가 [설정 → 알림 → 알림 접근 권한]에서 이 앱을 켜 두면, 카드사·은행 앱과 문자·카카오톡으로
 * 오는 결제·입출금 알림에서 금액이 들어 있는 것만 골라 로컬 큐(SharedPreferences)에 쌓아 둡니다.
 * 웹앱(출납부)은 AndroidApp.getPendingAutoEntries() 로 큐를 읽어 '자동 수집 대기함'에 보여 주고,
 * 사용자가 확인해 한 번에 장부에 넣습니다.
 *
 * - 개인 대화 오수집을 줄이려고 금액(원)과 금융 키워드가 모두 있는 알림만 남깁니다.
 * - 큐는 폰 안(SharedPreferences)에만 있고, 사용자가 넣기 전에는 서버로 보내지 않습니다.
 */
public class PaymentNotificationListener extends NotificationListenerService {

    static final String PREFS = "auto-entries";
    static final String KEY_QUEUE = "queue";
    static final int MAX_ITEMS = 60;

    private static final String[] KEYWORDS = {
            "원", "결제", "승인", "입금", "출금", "이체", "카드", "은행", "페이", "환불", "매출", "정산"
    };

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null) return;
            String pkg = sbn.getPackageName() == null ? "" : sbn.getPackageName();
            if (pkg.startsWith(getPackageName())) return;

            Notification n = sbn.getNotification();
            if (n == null || n.extras == null) return;
            Bundle extras = n.extras;

            String title = str(extras.getCharSequence(Notification.EXTRA_TITLE));
            String text = str(extras.getCharSequence(Notification.EXTRA_TEXT));
            String big = str(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
            String sub = str(extras.getCharSequence(Notification.EXTRA_SUB_TEXT));
            String lines = str(extras.getCharSequence(Notification.EXTRA_TEXT_LINES));

            StringBuilder body = new StringBuilder();
            append(body, text);
            if (big.length() > 0 && !big.equals(text)) append(body, big);
            if (sub.length() > 0) append(body, sub);
            if (lines.length() > 0) append(body, lines);
            if (body.length() == 0) append(body, title);

            String all = (title + " " + body).trim();
            if (!looksFinancial(all)) return;

            JSONObject item = new JSONObject();
            item.put("pkg", pkg);
            item.put("app", appLabel(pkg));
            item.put("title", title);
            item.put("text", body.toString());
            item.put("time", new SimpleDateFormat("MM-dd HH:mm", Locale.KOREA).format(new Date(sbn.getPostTime())));
            item.put("at", sbn.getPostTime());
            enqueue(this, item);
        } catch (Exception ignored) {
            // 알림 하나가 이상해도 수집은 계속됩니다.
        }
    }

    private static void append(StringBuilder sb, String value) {
        if (value == null) return;
        String v = value.trim();
        if (v.length() == 0) return;
        if (sb.indexOf(v) >= 0) return;
        if (sb.length() > 0) sb.append(' ');
        sb.append(v);
    }

    private static String str(CharSequence cs) {
        return cs == null ? "" : cs.toString();
    }

    /** 금액(원)과 금융 키워드가 함께 있어야 결제·입출금 알림으로 봅니다. */
    static boolean looksFinancial(String text) {
        if (text == null || text.length() == 0) return false;
        int digits = 0;
        for (int i = 0; i < text.length(); i++) {
            if (Character.isDigit(text.charAt(i))) digits++;
        }
        if (digits < 3) return false;
        for (String k : KEYWORDS) {
            if (text.contains(k)) return true;
        }
        return false;
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
            CharSequence label = pm.getApplicationLabel(info);
            return label == null ? pkg : label.toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    /* ---------------- 로컬 큐 (웹앱과 공유) ---------------- */

    private static synchronized void enqueue(Context ctx, JSONObject item) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString(KEY_QUEUE, "[]"));
            List<JSONObject> list = new ArrayList<>();
            list.add(item);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject old = arr.optJSONObject(i);
                if (old == null) continue;
                // 같은 알림이 두 번 들어오는 경우를 걸러 냅니다.
                if (old.optString("app").equals(item.optString("app"))
                        && old.optString("text").equals(item.optString("text"))) {
                    continue;
                }
                list.add(old);
                if (list.size() >= MAX_ITEMS) break;
            }
            JSONArray out = new JSONArray();
            for (JSONObject o : list) out.put(o);
            sp.edit().putString(KEY_QUEUE, out.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static String readQueue(Context ctx) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String raw = sp.getString(KEY_QUEUE, "[]");
            JSONArray arr = new JSONArray(raw);
            List<JSONObject> list = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null) list.add(o);
            }
            // 오래된 것부터 차례대로 보여 줍니다.
            JSONArray out = new JSONArray();
            for (int i = list.size() - 1; i >= 0; i--) out.put(list.get(i));
            return out.toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    static void clearQueue(Context ctx) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().remove(KEY_QUEUE).apply();
        } catch (Exception ignored) {
        }
    }

    static int pendingCount(Context ctx) {
        try {
            return new JSONArray(readQueue(ctx)).length();
        } catch (Exception e) {
            return 0;
        }
    }
}
