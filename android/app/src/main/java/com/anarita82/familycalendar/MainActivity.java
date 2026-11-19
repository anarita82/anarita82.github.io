package com.anarita82.familycalendar;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 우리 가족 달력 — 가족 공유 웹앱(https://anarita82.github.io/family-calendar/)을 띄우는 앱.
 * - 인터넷 권한만 사용하고 개인정보를 기기 밖으로 보내지 않습니다(웹앱 자체가 Firebase로 동기화).
 * - 뒤로가기: 웹 히스토리가 있으면 뒤로, 없으면 한 번 더 눌러 종료.
 */
public class MainActivity extends Activity {

    private static final String HOME_URL = "https://anarita82.github.io/family-calendar/";
    private static final String HOME_HOST_SUFFIX = "anarita82.github.io";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_PERMISSIONS = 1002;
    private static final int REQ_SPEECH = 1004;
    private static final int REQ_SPEECH_PERMISSION = 1005;
    private static final String CHANNEL_ID = "family-calendar-reminder";

    private WebView webView;
    private View errorView;
    private ProgressBar progressBar;
    private long lastBackPressed = 0L;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingWebPermission;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#f4f5f9"));
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() == null ? "" : uri.getHost();
                if (host.endsWith(HOME_HOST_SUFFIX)) {
                    return false; // 우리 앱 안에서 열기
                }
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if (scheme.startsWith("http")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {
                        // 열 수 있는 앱이 없으면 무시
                    }
                    return true; // 다른 사이트는 기본 브라우저로
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (progressBar != null) progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (progressBar != null) progressBar.setVisibility(View.GONE);
                hideError();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError();
                }
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                    showError();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            /* 사진·파일 선택기: 인물 사진, 날짜별 사진 업로드에 필요 */
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(Intent.createChooser(intent, "사진 선택"), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "사진 선택기를 열 수 없어요", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }

            /* 마이크(음성 입력)·카메라 권한 요청을 웹페이지에 허용 */
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                boolean wantsAudio = false;
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsAudio = true;
                }
                if (wantsAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    pendingWebPermission = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_PERMISSIONS);
                    return;
                }
                request.grant(request.getResources());
            }
        });

        webView.addJavascriptInterface(new NotifierBridge(), "AndroidApp");

        root.addView(webView);

        progressBar = new ProgressBar(this);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        progressParams.gravity = Gravity.CENTER;
        progressBar.setLayoutParams(progressParams);
        root.addView(progressBar);

        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView);

        setContentView(root);
        applySystemBarInsets(root);
        requestNotificationPermissionIfNeeded();

        if (savedInstanceState == null) {
            webView.loadUrl(HOME_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    /* Android 15(API 35)+ 는 화면을 상태바·내비게이션바 뒤까지 그리는 엣지 투 엣지가 강제됩니다.
       웹뷰 내용이 상태바나 키보드에 가리지 않도록 시스템 바·입력기 높이만큼 안쪽 여백을 줍니다.
       (targetSdk 36 빌드에서도 이전과 같은 화면 배치가 유지되도록) */
    private void applySystemBarInsets(final View root) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int left, top, right, bottom;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                    android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    left = bars.left;
                    top = bars.top;
                    right = bars.right;
                    bottom = Math.max(bars.bottom, ime.bottom);
                } else {
                    left = insets.getSystemWindowInsetLeft();
                    top = insets.getSystemWindowInsetTop();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                v.setPadding(left, top, right, bottom);
                return insets;
            }
        });
        root.requestApplyInsets();
    }

    private View buildErrorView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#f4f5f9"));
        box.setPadding(48, 48, 48, 48);
        box.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        TextView title = new TextView(this);
        title.setText("연결할 수 없어요");
        title.setTextSize(18f);
        title.setGravity(Gravity.CENTER);
        title.setTextColor(Color.parseColor("#1f2430"));

        TextView desc = new TextView(this);
        desc.setText("인터넷 연결을 확인한 뒤 다시 시도해 주세요.\n저장된 일정은 다시 연결되면 자동으로 나타납니다.");
        desc.setTextSize(13f);
        desc.setGravity(Gravity.CENTER);
        desc.setTextColor(Color.parseColor("#5b6273"));
        desc.setPadding(0, 16, 0, 24);

        Button retry = new Button(this);
        retry.setText("다시 시도");
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideError();
                webView.loadUrl(HOME_URL);
            }
        });

        box.addView(title);
        box.addView(desc);
        box.addView(retry);
        return box;
    }

    private void showError() {
        if (progressBar != null) progressBar.setVisibility(View.GONE);
        if (errorView != null) errorView.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        if (errorView != null) errorView.setVisibility(View.GONE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_SPEECH) {
            /* 네이티브 음성인식 결과 → 웹앱 window.onAndroidVoiceResult(문자열) */
            if (resultCode == Activity.RESULT_OK && data != null) {
                ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                String text = (results != null && !results.isEmpty()) ? results.get(0) : "";
                if (text != null && !text.trim().isEmpty()) {
                    callJs("onAndroidVoiceResult", text.trim());
                } else {
                    callJs("onAndroidVoiceError", "empty");
                }
            } else {
                callJs("onAndroidVoiceError", "cancelled");
            }
            return;
        }
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    List<Uri> uris = new ArrayList<>();
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        Uri uri = clip.getItemAt(i).getUri();
                        if (uri != null) uris.add(uri);
                    }
                    if (!uris.isEmpty()) results = uris.toArray(new Uri[0]);
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_SPEECH_PERMISSION) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                openSpeechRecognizer();
            } else {
                callJs("onAndroidVoiceError", "permission");
                Toast.makeText(this, "마이크 권한을 허용해야 음성 입력을 쓸 수 있어요", Toast.LENGTH_SHORT).show();
            }
            return;
        }
        if (requestCode == REQ_PERMISSIONS && pendingWebPermission != null) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) pendingWebPermission.grant(pendingWebPermission.getResources());
            else {
                pendingWebPermission.deny();
                Toast.makeText(this, "마이크 권한을 허용해야 음성 입력을 쓸 수 있어요", Toast.LENGTH_SHORT).show();
            }
            pendingWebPermission = null;
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    /* 일정 미리 알림 — 앱이 열려 있을 때 네이티브 알림으로 띄웁니다. */
    private class NotifierBridge {
        @JavascriptInterface
        public String platform() { return "android"; }

        @JavascriptInterface
        public void notify(String title, String body) {
            showNotification(title == null ? "일정 알림" : title, body == null ? "" : body);
        }

        /* 🔔 예약 알림 — 웹앱이 다가오는 미리 알림 목록(JSON)을 넘기면 AlarmManager에 예약합니다.
           앱을 닫아 둬도 울리므로, 가족 달력의 '담당 일정' 미리 알림이 폰에서 제대로 동작합니다. */
        @JavascriptInterface
        public int scheduleNotifications(String json) {
            try {
                return AlarmScheduler.apply(getApplicationContext(), json == null ? "[]" : json);
            } catch (Exception e) {
                return 0;
            }
        }

        @JavascriptInterface
        public void cancelNotifications() {
            try {
                AlarmScheduler.cancelStored(getApplicationContext());
            } catch (Exception e) {
                /* 무시 */
            }
        }

        @JavascriptInterface
        public boolean hasScheduledNotifications() { return true; }

        /* Android 12+에서는 '알람 및 리마인더' 권한이 있어야 분 단위로 정확히 울립니다.
           없으면 몇 분 늦을 수 있어 웹앱이 안내·설정 열기를 할 수 있게 상태를 알려 줍니다. */
        @JavascriptInterface
        public boolean canScheduleExact() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
            try {
                AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
                return am != null && am.canScheduleExactAlarms();
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void openExactAlarmSettings() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "설정에서 '알람 및 리마인더'를 허용해 주세요", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        /* 🎤 음성 입력 — WebView에는 Web Speech API가 없어 네이티브 음성인식 창을 띄웁니다.
           결과는 window.onAndroidVoiceResult(text), 취소·오류는 window.onAndroidVoiceError(reason). */
        @JavascriptInterface
        public void startVoiceInput() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    openSpeechRecognizer();
                }
            });
        }

        @JavascriptInterface
        public boolean hasVoiceInput() { return true; }

        /* 🔐 구글 로그인처럼 WebView 안에서 막히는 화면은 기본 브라우저(크롬)로 엽니다.
           웹앱은 window.AndroidApp.openExternal(url) 을 부를 수 있으면 부르고, 없으면 주소를 복사하도록 안내합니다. */
        @JavascriptInterface
        public void openExternal(final String url) {
            final String target = url == null ? "" : url.trim();
            if (!(target.startsWith("https://") || target.startsWith("http://"))) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(target));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "브라우저를 열 수 없어요. 크롬에서 주소를 열어 주세요.", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean hasOpenExternal() { return true; }

        /* 💰 금전출납부 — 폰 알림 자동 수집.
           사용자가 '알림 접근 권한'을 켜면 PaymentNotificationListener 가 결제·입출금 알림만 모읍니다. */
        @JavascriptInterface
        public boolean hasNotificationAccess() {
            try {
                String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
                return enabled != null && enabled.contains(getPackageName());
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void openNotificationAccessSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "설정 → 알림 → 알림 접근 권한에서 '우리 가족 달력'을 켜 주세요", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        /* 대기 중인 자동 수집 내역(JSON 배열). 넣은 뒤 clearPendingAutoEntries() 로 비웁니다. */
        @JavascriptInterface
        public String getPendingAutoEntries() {
            return PaymentNotificationListener.readQueue(getApplicationContext());
        }

        @JavascriptInterface
        public void clearPendingAutoEntries() {
            PaymentNotificationListener.clearQueue(getApplicationContext());
        }

        @JavascriptInterface
        public int pendingAutoEntryCount() {
            return PaymentNotificationListener.pendingCount(getApplicationContext());
        }

        /* 📅 홈 화면 위젯 — 웹앱이 넘긴 오늘·다가오는 일정(JSON)을 폰에 저장하고 위젯을 바로 다시 그립니다.
           위젯이 없거나 위젯을 쓰지 않는 폰에서는 저장만 되고 아무 일도 일어나지 않습니다. */
        @JavascriptInterface
        public void updateWidget(String json) {
            try {
                CalendarWidgetProvider.savePayload(getApplicationContext(), json);
            } catch (Exception e) {
                /* 위젯 갱신 실패는 앱 동작에 영향 없음 */
            }
        }

        @JavascriptInterface
        public boolean hasWidget() { return true; }

        /* 출납부 CSV를 폰 '다운로드/우리 가족 달력'에 저장하고 경로를 돌려줍니다(실패하면 빈 문자열). */
        @JavascriptInterface
        public String saveTextFile(String name, String text) {
            try {
                String safe = (name == null || name.trim().isEmpty()) ? "내보내기.csv" : name.trim();
                StringBuilder sb = new StringBuilder();
                for (char c : safe.toCharArray()) {
                    sb.append((Character.isLetterOrDigit(c) || c == '.' || c == '-' || c == '_') ? c : '_');
                }
                safe = sb.toString();
                if (safe.isEmpty()) safe = "내보내기.csv";
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "text/csv");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/우리 가족 달력");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return "";
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os == null) return "";
                    os.write((text == null ? "" : text).getBytes("UTF-8"));
                    os.close();
                    return "다운로드/우리 가족 달력/" + safe;
                }
                File dir = new File(getExternalFilesDir(null), "내보내기");
                if (!dir.exists() && !dir.mkdirs()) return "";
                File file = new File(dir, safe);
                FileOutputStream out = new FileOutputStream(file);
                out.write((text == null ? "" : text).getBytes("UTF-8"));
                out.close();
                return file.getAbsolutePath();
            } catch (Exception e) {
                return "";
            }
        }
    }

    /* 음성인식 액티비티를 엽니다. 마이크 권한이 없으면 먼저 요청합니다. */
    private void openSpeechRecognizer() {
        if (webView == null) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_SPEECH_PERMISSION);
            return;
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ko-KR");
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "일정을 말씀해 주세요");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(intent, REQ_SPEECH);
        } catch (ActivityNotFoundException e) {
            callJs("onAndroidVoiceError", "no-recognizer");
            Toast.makeText(this, "음성인식 앱을 찾지 못했어요. Google 앱을 설치해 주세요", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            callJs("onAndroidVoiceError", "error");
        }
    }

    /* 웹앱의 전역 함수(window.onAndroidVoiceResult 등)를 문자열 인자와 함께 호출합니다. */
    private void callJs(String fnName, String arg) {
        if (webView == null) return;
        final String js = "window." + fnName + " && window." + fnName + "(" + JSONObject.quote(arg == null ? "" : arg) + ");";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) webView.evaluateJavascript(js, null);
            }
        });
    }

    private void showNotification(String title, String body) {
        ReminderReceiver.show(this, title, body, "");
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                try {
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1003);
                } catch (Exception e) { /* 무시 */ }
            }
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        /* 앱을 다시 열 때 위젯의 날짜·줄 수만 먼저 맞춰 둡니다(웹앱이 곧 최신 일정을 넘겨 줍니다). */
        try {
            CalendarWidgetProvider.refreshAll(getApplicationContext());
        } catch (Exception ignored) { /* 위젯이 없으면 무시 */ }
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (errorView != null && errorView.getVisibility() == View.VISIBLE) {
            finish();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPressed < 2000) {
            super.onBackPressed();
        } else {
            lastBackPressed = now;
            Toast.makeText(this, "한 번 더 누르면 앱을 종료해요", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
