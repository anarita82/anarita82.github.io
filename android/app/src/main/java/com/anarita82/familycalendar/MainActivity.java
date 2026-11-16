package com.anarita82.familycalendar;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
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
        requestNotificationPermissionIfNeeded();

        if (savedInstanceState == null) {
            webView.loadUrl(HOME_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
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
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "일정 알림", NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("가족 달력 일정 미리 알림");
                nm.createNotificationChannel(channel);
            }
            Intent open = new Intent(this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);

            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(this, CHANNEL_ID)
                    : new Notification.Builder(this);
            builder.setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            nm.notify((int) (System.currentTimeMillis() % 100000), builder.build());
        } catch (Exception e) {
            /* 알림 실패는 앱 동작에 영향 없음 */
        }
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
