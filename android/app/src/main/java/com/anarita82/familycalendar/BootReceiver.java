package com.anarita82.familycalendar;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 폰을 다시 켜면 AlarmManager 예약이 지워지므로, 마지막으로 받은 가족 달력 알림 계획을 다시 겁니다.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        try {
            AlarmScheduler.restore(context);
        } catch (Exception e) {
            /* 실패해도 다음에 앱을 열면 웹앱이 다시 예약합니다 */
        }
    }
}
