# 우리 가족 달력 (가족 공유판)

가족끼리 실시간으로 함께 쓰는 음력 지원 가족 달력입니다. 휴대폰 브라우저에서 열고 "홈 화면에 추가"하면 앱처럼 쓸 수 있어요.
주소: <https://anarita82.github.io/family-calendar/>

## 이전 버전(테스트)에서 달라진 점

- 저장 위치를 `localStorage`(그 기기에만)에서 **Firebase Cloud Firestore**(가족 공유 DB)로 옮겼습니다.
  한 사람이 일정을 추가·수정·삭제하면 가족 모두의 폰에 `onSnapshot`으로 즉시 반영됩니다.
- 처음 앱을 열 때 **가족 코드**를 한 번 입력하면 그 폰에 기억됩니다(코드를 아는 사람만 같은 달력을 봅니다).
- 한국어 음력·공휴일 계산, 구성원 6인 필터, 5개 카테고리, D-Day 목록 등 기존 기능은 그대로입니다.
- "가족 초대 링크 복사" 버튼으로 `?code=가족코드`가 붙은 링크를 만들어 가족에게 보낼 수 있습니다.
- "샘플 일정 지우기"는 제목이 `[샘플]`로 시작하는 일정만 지웁니다(가족이 넣은 일정은 그대로).

## 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 화면 구조, Firebase SDK 및 스크립트 로드 |
| `app.js` | 달력·모달·필터·D-Day 등 UI 로직 |
| `cloud.js` | Firebase 초기화, 익명 로그인, 방 ID 계산(SHA-256), 실시간 구독, 읽기/쓰기, 구성원·PIN 해시·등록 요청 |
| `lunar.js` | 음력↔양력 변환과 공휴일 계산 (2022~2040) |
| `styles.css` | 모바일 우선 스타일 |
| `firebase-*-compat.js` | Firebase JS SDK 10.14.1 (저장소에 함께 둠, CDN 의존 없음) |
| `sw.js`, `manifest.json` | PWA 오프라인 캐시·홈 화면 추가 |

## 구성원·관리자·승인 (2026-11-16 추가)

| 역할 | 사람 | 할 수 있는 일 |
| --- | --- | --- |
| 메인 관리자 | 아빠 | 일정 즉시 등록·수정·삭제, 승인/거절, 구성원 추가·역할 변경, 아빠·엄마 PIN 변경 |
| 부매니저 | 엄마 | 일정 즉시 등록·수정·삭제, 승인/거절, 구성원 추가, 자기 PIN 변경 |
| 일반 구성원 | 외할머니·첫째·둘째·막내 + 추가한 인원 | 일정은 `일정 등록 요청`으로만 보낼 수 있고, 아빠·엄마 승인 후 달력에 올라감 |

- 앱을 열면 **"현재 사용자 선택"** 창에서 이 폰을 쓰는 사람을 고릅니다(폰에 기억).
  상단 프로필 배지를 누르면 언제든 바꿀 수 있습니다.
- **아빠·엄마는 4자리 관리자 PIN**을 넣어야 전환됩니다. 처음 PIN은 **`2026`** 이고,
  관리자 설정에서 각각 바꿀 수 있습니다. PIN 평문은 어디에도 저장하지 않고
  `SHA-256(방 ID + 구성원 ID + PIN)` 해시만 Firestore에 둡니다.
- 일반 구성원이 보낸 요청은 `요청 현황`(대기 중/승인됨/거절됨)으로 확인할 수 있고,
  관리자 화면 상단의 **🔔 승인 대기 N건**에서 승인·거절합니다.

## 데이터 구조 (Cloud Firestore)

```
rooms/{roomId}
  schema: 2, name: "우리 가족", createdAt
  members: [ { id, name, color, bg, role } ]    // role: admin | manager | member
  pins: { dad: "<sha256>", mom: "<sha256>" }     // 4자리 PIN의 해시 (평문 없음)
  requests: {                                    // 일정 등록 요청 (맵 필드)
    <requestId>: { status: pending|approved|rejected, requesterId, requesterName,
                   title, date, time, members[], category, memo, repeat, lunar,
                   createdAt, decidedBy, decidedByName, decidedAt, eventId }
  }
  events/{eventId}
    title, date(YYYY-MM-DD), time, members[], category, memo, repeat, lunar, createdAt, updatedAt
```

> 요청을 하위 컬렉션(`rooms/{roomId}/requests`)이 아니라 방 문서의 맵 필드로 둔 이유:
> 현재 게시된 보안 규칙이 `events` 하위 컬렉션만 허용하고, Firebase 콘솔이 재로그인을
> 요구해 규칙을 새로 게시하지 못했습니다. 방 문서 필드는 이미 허용된 경로라 규칙 변경
> 없이 동작하고, 예전 버전 앱은 이 필드를 무시합니다.
> 나중에 규칙을 바꾸게 되면 아래 한 줄을 `match /rooms/{roomId}` 안에 추가하면 됩니다.
> ```
> match /requests/{requestId} { allow read, create, update, delete: if request.auth != null; }
> ```

- `roomId` = `SHA-256("family-calendar-room:" + 가족코드)` 앞 32자리 — 코드 자체는 DB에 저장하지 않습니다.
- 보안 규칙(배포본):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      allow get, create, update: if request.auth != null;   // 목록 조회는 막음
      // 구성원·PIN 해시·요청은 이 문서의 필드라 위 규칙으로 함께 커버됩니다.
      match /events/{eventId} {
        allow read, create, update, delete: if request.auth != null;
      }
    }
  }
}
```

- 앱은 **익명 로그인**으로 접속하므로, 로그인하지 않은 요청은 거부되고 방 목록도 조회할 수 없습니다.
  같은 달력을 보려면 가족 코드를 알아야 해당 `roomId`에 접근할 수 있습니다.

## 개인정보

공개 저장소입니다. 가족 실명·생년월일·전화번호·주소는 코드와 DB 어디에도 넣지 않았고, 구성원은 `아빠·엄마·외할머니·첫째·둘째·막내`로만 표시합니다.
Firebase 설정값(apiKey 등)은 웹 앱 식별용 공개 값이며, 접근 통제는 위 보안 규칙이 담당합니다.
