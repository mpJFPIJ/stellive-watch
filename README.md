# 별 따라 보기 — 스텔라이브 모바일 정주행

**바로 시청:** https://mpjfpij.github.io/stellive-watch/

이 저장소는 GitHub Actions가 6시간마다 수집하고 GitHub Pages로 배포합니다. 아래 설치 안내는 별도 복제본을 만들 때 사용합니다.

휴대폰에서 GitHub Pages 주소를 열어 공개시각 오름차순으로 시청하는 정적 웹사이트입니다. 영상 수집과 JSON 갱신은 GitHub Actions가 맡으므로 **설치 후 PC를 켜 두지 않아도 됩니다.** API 키는 Actions Secrets에서만 사용하며, 웹사이트에는 포함하지 않습니다.

**설치는 [한국어 설치 안내](docs/설치안내.md)를 1단계부터 따라 하세요.**

## 포함한 기능

- 기존 channels.json 27개 유지: 공식 1 · 멤버 16 · 팬 10. 삭제된 기록용 채널 1개는 enabled:false.
- uploads 전체 페이지 소급 수집, 새 채널 추가 시 과거부터 수집, 중단 후 체크포인트 재개.
- videos.snippet.publishedAt 기준으로 모든 채널을 통합하고 KST로 표시. 동일 초에는 영상 ID 순.
- 500개 단위 JSON 샤드, ID 조회 인덱스, 화면 목록은 50개씩 교체. 다음/이전은 현재 샤드부터 이동.
- Shorts·VOD 자동 후보 분류 + 브라우저 수동 판정 + 저장소 공유 판정 overrides.json.
- 모바일 YouTube IFrame 플레이어, 오류/퍼가기 차단/자동재생 차단 안내와 시간 포함 원본 링크.
- 영상 ID별 재생 위치·완료·이어보기, 가장 오래된 미시청, JSON 백업/복원, 기존 SQLite 기록 이전.
- 6시간 간격 예약 갱신, 채널별 오류·전체 수집 완료시각 표시. 재수집 실패로 기존 목록을 지우지 않음.

## 구조

```text
channels.json + overrides.json
           ↓ GitHub Actions (YOUTUBE_API_KEY Secret)
scripts/collector.py → .state/state.json (Actions artifact, 1일 보관)
           ↓
scripts/build.py → dist/data/manifest.json + shards/ + lookup/
           ↓ GitHub Pages
휴대폰의 정적 화면 + YouTube 공식 IFrame
           ↓
브라우저 localStorage: 영상 ID별 위치·완료·수동 판정
```

영상 파일을 내려받거나 프록시로 재생하지 않습니다. Pages에는 공개 metadata만 배포합니다. 개인 시청 기록과 API 키는 수집 상태나 Pages에 들어가지 않습니다. metadata는 Git에 커밋하지 않습니다. Actions의 상태 artifact가 사라지면 전체 소급 수집으로 다시 시작합니다.

## 파일

| 경로 | 용도 |
|---|---|
| .github/workflows/update.yml | 예약·수동 수집과 Pages 배포 |
| channels.json | 상속한 공식·멤버·팬 채널과 KST 활동 기간 |
| overrides.json | 공유 수동 분류: 영상 ID → include/exclude/review |
| scripts/collector.py | 환경변수 키만 사용하는 공식 API 수집기 |
| scripts/restore_state.py | 이전 Actions 상태 artifact 복원 |
| scripts/build.py | 공개 JSON 샤딩과 정적 사이트 빌드 |
| scripts/migrate.py | 기존 SQLite의 metadata와 개인 기록을 분리 이전 |
| scripts/check_package.py | 공개 출력의 키 패턴·개인 파일 검사 |
| site/ | 모바일 HTML/CSS/JavaScript, 개인정보 안내 |
| tests/ | 수집·빌드·기록·모바일 UI 테스트 |
| dist/ | ZIP에 포함한 생성 완료 미리보기. Git 업로드 대상에서 제외 |
| docs/채널목록.md | 채널 URL·ID·기간·상속 여부 |
| docs/검증결과.md | 테스트 결과와 실제 검증 범위 |

## 로컬 검증 (선택)

Python 3.12 이상과 Node.js 22 이상. 제품에는 pip/npm 의존성이 없습니다.

```powershell
python -m unittest discover -s tests -v
node --test tests/core.test.mjs
python scripts/build.py
python scripts/check_package.py --dist dist
python -m http.server 8877 --bind 127.0.0.1 --directory dist
```

브라우저에서 http://127.0.0.1:8877/ 를 엽니다. ZIP의 dist가 있어도 `build.py`를 먼저 실행하면 .state가 없는 환경에서는 빈 목록으로 다시 생성됩니다. **즉시 미리보기만 할 때는 서버 명령만 실행하세요.** 로컬 서버는 개발 검사용이며 실제 이용은 Pages 주소로 합니다. file://로 HTML을 직접 열면 JSON/IFrame 기능이 제한됩니다.

브라우저 테스트에는 별도로 Playwright와 호환 Chromium이 필요합니다. 이미 설치돼 있으면 아래처럼 실행할 수 있습니다. 외부 YouTube 재생 성공 여부는 이 테스트의 판정에 포함하지 않습니다.

```powershell
$env:PLAYWRIGHT_MODULE = '설치된 playwright 모듈의 절대경로'
$env:BROWSER_EXECUTABLE = '설치된 Chromium 실행파일의 절대경로'
node tests/browser-test.cjs
node tests/player-test.cjs
```

## 운영 한계

‘누락 없는 전체 YouTube’는 보장하지 않습니다. 등록한 채널의 API가 공개하는 영상만 수집하며 삭제·비공개·미발견 팬 채널은 복원할 수 없습니다. 짧은 일반 영상과 Shorts, 편집본과 풀버전 VOD는 API만으로 완전히 구분할 수 없어 수동 검토가 필요합니다. 기존 채널 목록의 소속·활동일 전체를 이번 개조에서 재조사한 것은 아니며 미확인 메모를 유지했습니다.

예약 실행은 GitHub 지연·서비스 한도·비활동 정책 영향을 받습니다. 공개 저장소가 60일 동안 활동하지 않으면 예약이 꺼질 수 있습니다. 매월 실행 상태를 확인하세요. API metadata는 수집·빌드 때 29일 경과분을 제외하고 화면에서도 만료분을 숨깁니다. **자동화가 장기간 꺼진 사이트의 원본 JSON까지 자동 삭제할 수는 없으므로, 29일 안에 갱신하거나 Pages를 중지하고 기존 배포·artifact도 정리해야 합니다.**

무료 조건은 공개 저장소 + 표준 ubuntu-latest 러너 + 기본 Pages 주소를 기준으로 합니다. API는 설정된 무료 할당량 안에서만 요청하며, 실행당 1,800회(재시도 포함) 제한과 체크포인트를 사용합니다. 일일 예약 4회면 최대 7,200회입니다. 같은 프로젝트의 다른 프로그램과 수동 실행도 같은 일일 API 할당량을 사용합니다. 유료 러너·유료 도메인·할당량 증설은 필요하지 않습니다.

자세한 설치·수정·장애 복구·정책 출처는 [설치안내](docs/설치안내.md)를 확인하세요.
