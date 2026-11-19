# 우리 가족 달력 — 안드로이드 앱 (WebView)

`https://anarita82.github.io/family-calendar/` 를 띄우는 안드로이드 앱입니다. 화면·기능은 모두 웹앱이 담당하고, 이 앱은 껍데기(WebView)만 제공합니다.

## 정보

| 항목 | 값 |
| --- | --- |
| 앱 이름 | 우리 가족 달력 |
| 패키지 | `com.anarita82.familycalendar` |
| 버전 | 1.6 (versionCode 7) |
| minSdk / targetSdk | 24 (Android 7.0) / 36 (Android 16) |
| 권한 | `INTERNET`, `ACCESS_NETWORK_STATE`, `RECORD_AUDIO`, `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, 사진 읽기 · (선택) 알림 접근 권한 |
| 진입 화면 | `MainActivity` → `https://anarita82.github.io/family-calendar/` |

## 동작

- 뒤로가기: 웹 히스토리가 있으면 웹에서 뒤로, 없으면 "한 번 더 누르면 앱을 종료해요" 안내 후 종료.
- 액션바 없는 전체화면 모바일 뷰, 세로 화면 기준, 상태바 색은 앱 브랜드 색(#4f46e5).
- `anarita82.github.io` 밖의 링크는 기본 브라우저로 엽니다.
- 페이지를 못 불러오면 "연결할 수 없어요 / 다시 시도" 화면을 보여 줍니다.
- 개인정보를 기기에서 꺼내 쓰지 않습니다(로그인·저장은 웹앱의 Firebase 익명 인증이 담당).

## 🎤 음성 입력 (1.2에서 추가)

- 안드로이드 **WebView에는 Web Speech API가 없어서** 1.1까지는 `🎤 말로 입력하기`가 동작하지 않았습니다.
- 1.2부터는 `AndroidApp.startVoiceInput()` JS 브리지가 `RecognizerIntent`(ko-KR, 무료 형식)를 띄우고,
  인식 결과를 `window.onAndroidVoiceResult(text)`, 취소·오류를 `window.onAndroidVoiceError("cancelled"|"permission"|"no-recognizer"|"empty")`로
  웹앱에 돌려줍니다. 웹앱(`voice.js`)은 이 콜백의 문장을 기존 한국어 자연어 해석기에 넣어 칸을 채웁니다.
- 마이크 권한이 없으면 먼저 권한을 요청하고, 거부하면 웹앱에 `permission`을 보내 안내 문구를 띄웁니다.
- 인식 액티비티를 찾지 못하는 기기(음성인식 앱 없음)는 `no-recognizer`로 안내합니다.

## 🔔 예약 알림 (1.4에서 추가)

- 웹앱이 동기화할 때마다 **다가오는 미리 알림(기본 45일, 최대 100건)** 을 `AndroidApp.scheduleNotifications(json)`으로 넘기고,
  앱은 `AlarmManager`(`setExactAndAllowWhileIdle`, 권한이 없으면 `setAndAllowWhileIdle`)로 예약합니다.
  → **앱을 닫아 둬도** 담당 일정 미리 알림이 울립니다.
- 알림은 `ReminderReceiver`가 띄우고, 누르면 `MainActivity`(가족 달력)가 열립니다.
- 폰을 다시 켜면 `BootReceiver`(`BOOT_COMPLETED`/`MY_PACKAGE_REPLACED`)가 저장된 예약(`SharedPreferences`)을 다시 겁니다.
- 웹앱 쪽 필터: 내 프로필이 **담당**으로 들어간 일정만(또는 설정에서 '전체 일정') 알림. 문구에 `[담당: 첫째·아빠]` 표시.
- 웹 브라우저(크롬·사파리)는 푸시 서버 없이 탭을 닫으면 예약 알림을 걸 수 없어, **달력 화면이 열려 있을 때만** 알림이 울립니다.

## 💰 금전출납부 — 폰 알림 자동 수집 (1.5에서 추가)

- `PaymentNotificationListener`(extends `NotificationListenerService`)가 **카드·은행·카카오톡 결제·입출금 알림**을 감지합니다.
- 개인 대화 오수집을 줄이려고 **금액(원)과 금융 키워드**(결제·승인·입금·출금·이체·카드·은행·페이·환불·매출·정산)가
  **함께 있는 알림만** 남깁니다. 같은 알림이 두 번 오면 한 번만 쌓습니다(최대 60건).
- 큐는 폰 안 `SharedPreferences`(`auto-entries/queue`)에만 있고, 사용자가 확인해 넣기 전에는 서버로 가지 않습니다.
- `MainActivity` JS 브리지:
  - `AndroidApp.hasNotificationAccess()` — 알림 접근 권한이 켜져 있는지
  - `AndroidApp.openNotificationAccessSettings()` — [설정 → 알림 → 알림 접근 권한] 열기
  - `AndroidApp.getPendingAutoEntries()` — 대기 내역 JSON 배열 (`{pkg, app, title, text, time, at}`)
  - `AndroidApp.clearPendingAutoEntries()` / `AndroidApp.pendingAutoEntryCount()`
  - `AndroidApp.saveTextFile(name, text)` — 출납부 CSV를 `다운로드/우리 가족 달력/`에 저장(Android 10+ MediaStore, 그 아래 앱 전용 폴더)
- 매니페스트: `BIND_NOTIFICATION_LISTENER_SERVICE` 권한을 가진 `exported=true` 서비스로 등록(사용자가 직접 켜야 동작).
- 웹앱(출납부)은 이 큐를 읽어 **📱 자동 수집 대기함**에 보여 주고, [모두 출납부에 넣기] 또는 설정의 '바로 넣기'로 반영합니다.

## 빌드

이 저장소에는 APK 빌드 워크플로(`.github/workflows/family-calendar-apk.yml`)를 두지 않았습니다(커밋 권한에 workflow 스코프가 없음). 대신 아래처럼 로컬에서 빌드합니다.

```bash
# JDK 17, Android SDK(platform 36, build-tools 36.0.0), Gradle 8.13(래퍼가 자동 내려받음) 필요
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew --no-daemon :app:assembleDebug
# 결과: app/build/outputs/apk/debug/app-debug.apk
```

`app-debug.apk`는 Android Debug 키로 v2 서명되어 있어 그대로 설치할 수 있습니다.

### 구글 플레이 업로드용(.aab)

```bash
./gradlew --no-daemon :app:bundleRelease   # 서명 없는 app-release.aab
# 이어서 업로드 키스토어로 서명 (키스토어는 저장소 밖에 보관)
jarsigner -keystore <upload.keystore> -sigalg SHA256withRSA -digestalg SHA-256 app-release.aab <alias>
```

- 2026-08-31부터 신규 앱은 **targetSdk 36(Android 16) 이상**이어야 구글 플레이에 제출됩니다. 그래서 1.5(versionCode 6) 부터 targetSdk를 36으로 올렸고(AGP 8.13.2·Gradle 8.13), Android 15+ 에서 강제되는 **엣지 투 엣지** 화면에서 웹뷰가 상태바·키보드에 가리지 않도록 `MainActivity.applySystemBarInsets()` 로 시스템 바·입력기 높이만큼 여백을 줍니다.

## 📅 홈 화면 위젯 (1.6에서 추가)

- 위젯 이름 **📅 우리 가족 달력** — 기본 **4×2** 칸, 가로·세로로 늘이고 줄일 수 있습니다(`resizeMode="horizontal|vertical"`).
- 구성: 위쪽에 제목·오늘 날짜(`11월 19일 (목)`)와 **[새로고침]**, 본문에 **오늘 일정**(최대 3줄, 시간·제목·담당)과 **다가오는 일정**(14일 안, 최대 3줄, 날짜·제목).
- 위젯이 차지한 높이에 맞춰 줄 수가 줄어들므로 작게 줄여도 잘리지 않습니다.
- 일정이 없으면 `오늘 등록된 일정이 없어요`, 아직 앱에서 한 번도 동기화하지 않았으면 `앱을 열면 오늘 일정이 바로 보여요`를 보여 줍니다.
- 본문을 누르면 앱(가족 달력)이 열립니다. **[새로고침]** 은 앱을 열지 않고 저장된 내용으로 다시 그립니다.
- 갱신: 웹앱이 일정을 불러올 때마다 `AndroidApp.updateWidget(json)` → `SharedPreferences("family_widget")` 저장 + `AppWidgetManager` 로 모든 위젯 즉시 갱신. 이때 오늘 일정과 **앞으로 14일 안의 일정**(반복 일정 포함, 최대 6건)을 넘깁니다. 시스템 주기 갱신은 30분(`updatePeriodMillis=1800000`)이라 날짜가 넘어가도 날짜 표시가 맞습니다.
- 네트워크를 위젯이 직접 쓰지 않습니다 — 앱을 열어 동기화한 내용만 보여 줍니다(새 일정은 앱을 열면 즉시 반영).
- **추가 권한은 없습니다**(기존 권한 그대로, 덮어쓰기 설치 가능).

### 위젯 추가하는 방법

1. 홈 화면 빈 곳을 길게 누릅니다.
2. **위젯** → 목록에서 **📅 우리 가족 달력**을 찾습니다.
3. 끌어다 홈 화면에 놓습니다(4×2).

## 설치 시 안내

1. 폰에 APK 파일을 옮깁니다(카카오톡 '나에게 보내기', USB, 다운로드 등).
2. 파일을 눌러 설치 → "출처를 알 수 없는 앱 설치" 허용을 묻으면 설정에서 허용합니다.
3. 처음 열면 **가족 코드**를 한 번 입력합니다. 이후에는 기억됩니다.
