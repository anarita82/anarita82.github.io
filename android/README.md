# 우리 가족 달력 — 안드로이드 앱 (WebView)

`https://anarita82.github.io/family-calendar/` 를 띄우는 안드로이드 앱입니다. 화면·기능은 모두 웹앱이 담당하고, 이 앱은 껍데기(WebView)만 제공합니다.

## 정보

| 항목 | 값 |
| --- | --- |
| 앱 이름 | 우리 가족 달력 |
| 패키지 | `com.anarita82.familycalendar` |
| 버전 | 1.0 (versionCode 1) |
| minSdk / targetSdk | 24 (Android 7.0) / 34 |
| 권한 | `INTERNET`, `ACCESS_NETWORK_STATE` |
| 진입 화면 | `MainActivity` → `https://anarita82.github.io/family-calendar/` |

## 동작

- 뒤로가기: 웹 히스토리가 있으면 웹에서 뒤로, 없으면 "한 번 더 누르면 앱을 종료해요" 안내 후 종료.
- 액션바 없는 전체화면 모바일 뷰, 세로 화면 기준, 상태바 색은 앱 브랜드 색(#4f46e5).
- `anarita82.github.io` 밖의 링크는 기본 브라우저로 엽니다.
- 페이지를 못 불러오면 "연결할 수 없어요 / 다시 시도" 화면을 보여 줍니다.
- 개인정보를 기기에서 꺼내 쓰지 않습니다(로그인·저장은 웹앱의 Firebase 익명 인증이 담당).

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
