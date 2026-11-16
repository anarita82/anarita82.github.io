package com.anarita82.familycalendar;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 웹앱(가족 달력)이 넘겨 준 미리 알림 목록을 AlarmManager에 예약합니다.
 * 앱을 닫아 두거나 화면이 꺼져 있어도 울리도록 RTC_WAKEUP + (가능하면) 정확 알람을 씁니다.
 *
 * 웹앱 JS: window.AndroidApp.scheduleNotifications('[{"id","title","body","at"}]')
 *  - at: 알림이 울릴 시각(epoch ms)
 *  - 호출할 때마다 이전 예약을 모두 지우고 새 목록으로 갈아 끼웁니다.
 */
final class AlarmScheduler {

    static final String PREFS = "family-calendar-alarms";
    static final String KEY_PLAN = "plan";
    static final String ACTION_REMIND = "com.anarita82.familycalendar.REMIND";
    private static final String DATA_PREFIX = "familycal://reminder/";
    private static final int MAX_ALARMS = 100;

    private AlarmScheduler() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 웹앱에서 온 JSON을 예약하고, 실제로 건 개수를 돌려줍니다. */
    static synchronized int apply(Context context, String json) {
        cancelStored(context);
        List<Item> items = parse(json);
        long now = System.currentTimeMillis();
        JSONArray saved = new JSONArray();
        int count = 0;
        for (Item it : items) {
            if (it.at <= now + 5000) continue;   // 이미 지난 알림은 걸지 않음
            if (count >= MAX_ALARMS) break;
            if (schedule(context, it)) {
                saved.put(it.json());
                count++;
            }
        }
        prefs(context).edit().putString(KEY_PLAN, saved.toString()).apply();
        return count;
    }

    /** 저장해 둔 예약을 모두 취소합니다. */
    static synchronized void cancelStored(Context context) {
        String json = prefs(context).getString(KEY_PLAN, "[]");
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        for (Item it : parse(json)) {
            PendingIntent pi = pending(context, it, PendingIntent.FLAG_NO_CREATE);
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        }
        prefs(context).edit().putString(KEY_PLAN, "[]").apply();
    }

    /** 재부팅 뒤 저장된 예약을 다시 겁니다(이미 지난 것은 건너뜀). */
    static synchronized int restore(Context context) {
        List<Item> items = parse(prefs(context).getString(KEY_PLAN, "[]"));
        long now = System.currentTimeMillis();
        int count = 0;
        for (Item it : items) {
            if (it.at <= now + 5000) continue;
            if (schedule(context, it)) count++;
        }
        return count;
    }

    private static boolean schedule(Context context, Item it) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;
        PendingIntent pi = pending(context, it, PendingIntent.FLAG_UPDATE_CURRENT);
        if (pi == null) return false;
        try {
            if (canExact(am)) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, it.at, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, it.at, pi);
            }
            return true;
        } catch (SecurityException e) {
            /* 정확 알람 권한이 없을 때: 몇 분 늦을 수 있지만 울리도록 예약 */
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, it.at, pi);
                return true;
            } catch (Exception ignored) {
                return false;
            }
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean canExact(AlarmManager am) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                return am.canScheduleExactAlarms();
            } catch (Exception e) {
                return false;
            }
        }
        return true;
    }

    /** 같은 id는 언제나 같은 PendingIntent가 되도록 action + data(uri)로 구분합니다. */
    private static PendingIntent pending(Context context, Item it, int extraFlags) {
        try {
            Intent intent = new Intent(context, ReminderReceiver.class);
            intent.setAction(ACTION_REMIND);
            intent.setData(Uri.parse(DATA_PREFIX + Uri.encode(it.id)));
            intent.putExtra(ReminderReceiver.EXTRA_ID, it.id);
            intent.putExtra(ReminderReceiver.EXTRA_TITLE, it.title);
            intent.putExtra(ReminderReceiver.EXTRA_BODY, it.body);
            int flags = PendingIntent.FLAG_IMMUTABLE | extraFlags;
            return PendingIntent.getBroadcast(context, 0, intent, flags);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<Item> parse(String json) {
        List<Item> out = new ArrayList<>();
        if (json == null || json.trim().isEmpty()) return out;
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String id = o.optString("id", "");
                long at = o.optLong("at", 0L);
                if (id.isEmpty() || at <= 0L) continue;
                out.add(new Item(id, o.optString("title", "일정 알림"), o.optString("body", ""), at));
            }
        } catch (Exception ignored) {
            /* 잘못된 JSON은 무시 */
        }
        return out;
    }

    static final class Item {
        final String id;
        final String title;
        final String body;
        final long at;

        Item(String id, String title, String body, long at) {
            this.id = id;
            this.title = title == null ? "일정 알림" : title;
            this.body = body == null ? "" : body;
            this.at = at;
        }

        JSONObject json() {
            JSONObject o = new JSONObject();
            try {
                o.put("id", id);
                o.put("title", title);
                o.put("body", body);
                o.put("at", at);
            } catch (Exception ignored) {
                /* 무시 */
            }
            return o;
        }
    }
}
