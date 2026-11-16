package com.anarita82.familycalendar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * 예약된 시각에 AlarmManager가 깨우는 리시버 — 가족 달력 미리 알림을 띄웁니다.
 * 앱이 닫혀 있어도(프로세스가 없어도) 여기서 알림을 만들기 때문에 APK를 닫아 둬도 울립니다.
 */
public class ReminderReceiver extends BroadcastReceiver {

    static final String CHANNEL_ID = "family-calendar-reminder";
    static final String EXTRA_ID = "reminder_id";
    static final String EXTRA_TITLE = "reminder_title";
    static final String EXTRA_BODY = "reminder_body";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        String id = intent.getStringExtra(EXTRA_ID);
        if (title == null || title.isEmpty()) title = "🔔 일정 알림";
        if (body == null) body = "";
        show(context, title, body, id == null ? "" : id);
    }

    static void show(Context context, String title, String body, String id) {
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            ensureChannel(context, nm);

            Intent open = new Intent(context, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent pi = PendingIntent.getActivity(context, 0, open, flags);

            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(context, CHANNEL_ID)
                    : new Notification.Builder(context);
            builder.setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            int notifyId = id.isEmpty() ? (int) (System.currentTimeMillis() % 100000) : id.hashCode();
            nm.notify(notifyId, builder.build());
        } catch (Exception e) {
            /* 알림을 못 띄워도 앱 동작에는 영향 없음 */
        }
    }

    static void ensureChannel(Context context, NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "일정 알림", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("가족 달력 일정 미리 알림");
            nm.createNotificationChannel(channel);
        } catch (Exception ignored) {
            /* 무시 */
        }
    }
}
