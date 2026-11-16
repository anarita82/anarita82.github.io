# 우리 가족 달력 — 안드로이드 앱 (WebView)

`https://anarita82.github.io/family-calendar/` 를 띄우는 안드로이드 앱입니다. 화면·기능은 모두 웹앱이 담당하고, 이 앱은 껍데기(WebView)만 제공합니다.

## 정보

| 항목 | 값 |
| --- | --- |
| 앱 이름 | 우리 가족 달력 |
| 패키지 | `com.anarita82.familycalendar` |
| 버전 | 1.4 (versionCode 5) |
| minSdk / targetSdk | 24 (Android 7.0) / 34 |
| 권한 | `INTERNET`, `ACCESS_NETWORK_STATE`, `RECORD_AUDIO`, `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, 사진 읽기 |
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

## 빌드

이 저장소에는 APK 빌드 워크플로(`.github/workflows/family-calendar-apk.yml`)를 두지 않았습니다(커밋 권한에 workflow 스코프가 없음). 대신 아래처럼 로컬에서 빌드합니다.

```bash
# JDK 17, Android SDK(platform 34, build-tools 34.0.0) 필요
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew --no-daemon :app:assembleDebug
# 결과: app/build/outputs/apk/debug/app-debug.apk
```

`app-debug.apk`는 Android Debug 키로 v2 서명되어 있어 그대로 설치할 수 있습니다.

## 설치 시 안내

1. 폰에 APK 파일을 옮깁니다(카카오톡 '나에게 보내기', USB, 다운로드 등).
2. 파일을 눌러 설치 → "출처를 알 수 없는 앱 설치" 허용을 묻으면 설정에서 허용합니다.
3. 처음 열면 **가족 코드**를 한 번 입력합니다. 이후에는 기억됩니다.
