# 마이피씨방 (Mypcbang) — 두 매장 가동률 대시보드

옥스피씨 상일동역점(107대)·긱스타피씨카페(177대)의 PC 응답 대수를 10분마다 재서 비교하는 정적 웹앱입니다.
기존 ChatGPT 사이트(`mypcbang-remote-20261104.anarita82.chatgpt.site`)를 대신하며, 서버·계정 로그인 없이 GitHub Pages 에서 바로 열립니다.

- 주소: <https://anarita82.github.io/mypcbang/>
- 앱(APK): `documents/mypcbang-apk/마이피씨방.apk` (이 주소를 여는 웹뷰 앱)

## 구조

| 경로 | 내용 |
|---|---|
| `index.html` · `app.js` · `style.css` | 대시보드 (외부 라이브러리 없음) |
| `data/stores.json` | 매장 정의 — 이름·공인 IP 대역·PC 대수·시간당 단가·쿠폰/음식 비중 |
| `data/live.json` | 자동 측정이 10분마다 갱신 (최신값·일별·시간별·최근 기록) |
| `data/history.json` | 옛 사이트·2.1.0 앱에 남아 있던 기록(2026-10-27 ~ 11-10) 이관본 |
| `data/archive-YYYY-MM.json` | 62일이 지난 일별 기록 보관 |
| `tools/probe.py` | 측정기 — IP 대역에 ICMP 를 보내 응답 대수를 집계 |
| `.github/workflows/mypcbang-probe.yml` | 10분마다 `probe.py` 실행 → `live.json` 커밋 |
| `firestore.js` | 휴대폰 앱이 올린 측정값(Firestore)을 읽어 위 자료와 합칩니다 |

## 측정은 휴대폰에서 (2026-11-26~)

안드로이드 앱 `마이피씨방`(v1.1)이 휴대폰에서 직접 `/system/bin/ping` 으로 재서 10분마다 올립니다.
앱은 상단 막대의 **📡 지금 측정** 버튼과 **10분 자동** 스위치로 동작하고, 결과는 Firestore(`family-calendar-woo`)에 저장됩니다.

| 컬렉션 | 내용 |
|---|---|
| `mypcbang_live/{ox\|geek}` | 매장별 최신 측정값(대수·응답률·시각·기기) |
| `mypcbang_days/{YYYY-MM-DD}` | 하루 누적(매장별 합계 + 시간대별 합계) — 일별·월별 표가 이 값을 씁니다 |
| `mypcbang_samples/{YYYYMMDD-HHmm-store}` | 개별 측정 기록(최근 기록 목록) |
| `mypcbang_status/latest` | 앱 상태(마지막 시도·오류·자동 측정 여부) |
| `mypcbang_writers/{uid}` | 쓰기가 허용된 기기(앱이 등록 코드로 한 번 등록, 읽기는 막힘) |

읽기는 공개(로그인 없이), 쓰기는 등록된 기기만입니다. 그래서 브라우저로 열어도 폰이 올린 최신 값이 그대로 보입니다.
GitHub Actions 측정기는 ICMP 가 막혀 있어 예비용으로만 남겨 두었습니다(성공하면 그 값도 함께 표시).

`python3 work/mypcbang/tools/fetch_live.py --date 2026-11-25` 로 하루치 요약(평균 대수·응답률·측정 횟수·추정 매출)을 볼 수 있습니다.

## 측정 방식

- 매장별 공인 IP 대역(예: `59.186.104.1~107`)의 모든 주소에 `ping -c 1` 을 동시에 보내고, 응답한 대수를 기록합니다.
- 기준값: 한국시간 00:00~23:59 평균, 성공한 측정만 평균(실패·미수집은 0으로 채우지 않음).
- **IP 응답 대수는 실제 좌석 이용률·방문자 수가 아닙니다.** 켜져 있어 ICMP 에 응답하는 PC 수입니다. 같은 방식끼리만 비교하세요.
- 옛 사이트의 `가동률`(관리 프로그램 값)과 새 `IP 응답률`은 다른 지표이므로 대시보드에서 `측정 방식`을 골라 따로 봅니다.

## 매출 추정

```
쿠폰 매출 = 평균 가동대수 × 24시간 × 시간당 단가
합계      = 쿠폰 매출 ÷ (쿠폰 비중)
음식 매출 = 합계 − 쿠폰 매출
```

기본값 시간당 단가 1,290원(정액권 157명 시간가중 평균), 쿠폰 비중 옥스 52% · 긱스타 70%.
2026-11-22 실측(옥스 29.1대)으로 검산하면 173.2만원으로, 11-23에 계산한 값과 같습니다.

## 매장 추가

`data/stores.json` 에 항목을 추가하고 커밋하면 다음 측정부터 포함됩니다.
앱 안의 `＋ 다른 매장 추가` 는 그 휴대폰에만 보이는 미리보기이며, 설정 코드를 피클에게 보내면 서버(이 파일)에 반영합니다.

## 문제가 생기면

- `live.json` 의 `runner.error` 가 있으면 측정기 쪽 문제입니다(제어 ping 실패 등). 기록을 남기지 않습니다.
- 측정이 멈췄는지 보려면 `updated_at` 을 확인하세요. 40분이 넘으면 대시보드 상단이 붉게 바뀝니다.

## 자동 측정 켜기 (한 번만)

`.github/workflows/mypcbang-probe.yml` 은 저장소의 GitHub Actions 설정 파일이라 피클의 GitHub 앱 권한으로는 올릴 수 없습니다.
아래 둘 중 하나만 하면 10분 자동 측정이 시작됩니다.

1. 피클 GitHub 앱에 **Actions 쓰기** 권한을 주면 피클이 바로 올립니다.
2. GitHub 웹에서 <https://github.com/anarita82/anarita82.github.io/new/main?filename=.github/workflows/mypcbang-probe.yml> 을 열고
   `mypcbang/tools/probe-workflow.yml.txt` 내용을 그대로 붙여 넣고 커밋합니다.
