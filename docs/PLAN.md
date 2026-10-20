# 모바일 정주행 Implementation Plan

> 실행: superpowers:executing-plans. 사용자 요청대로 이 세션에서 완성 ZIP까지 수행한다.

**Goal:** PC 상시 가동 없이 휴대폰으로 공개시각순 시청한다.
**Architecture:** Actions 수집 → artifact 체크포인트 → JSON 샤드 → Pages → 브라우저 기록.
**Tech Stack:** Python 3.12+ 표준 라이브러리, 브라우저 JavaScript ES modules, YouTube IFrame API.
**Spec:** DESIGN.md

## Global Constraints
- API 키는 환경변수 YOUTUBE_API_KEY에서만 사용한다.
- 모든 표시는 KST, 동일시각은 영상 ID로 정렬한다.
- 원본과 비밀 설정 파일은 수정하거나 배포하지 않는다.
- API 메타데이터는 Git 이력에 커밋하지 않는다.

## Review Focus
- 할당량 중단: 진행 중 스캔 저장, 기존 목록 보존, 다음 실행 재개.
- 삭제·비공개: 전체 스캔 완료 후에만 제외.
- 소급 추가: 순서 인덱스 대신 영상 ID 기반 기록.
- 브라우저 저장 실패: 경고하고 백업 제공.
- 오래된 metadata/artifact: 29일 만료 및 전체 재수집.

## Tasks
- [x] collector.py + tests/test_collector.py: 페이지 탐색, KST 경계, 후보 분류, 예산 중단·복원, 삭제 복구, 오류시 보존. 실제 26채널/456요청/9,959개 확인.
- [x] build.py + tests/test_build.py: 샤딩, 안정적 ID 조회, 비밀·개인 기록 배제, 만료.
- [x] site/core.mjs + tests/core.test.mjs: 브라우저 기록 검증·병합·필터. 모바일 UI·원본 링크·순차 재생.
- [x] .github/workflows/update.yml + restore_state.py: 최소 권한, 기본 브랜치, 예약/수동 실행, 상태 복원, Pages 배포 연결. 원격 GitHub 실행은 사용자가 저장소 설정 후 검증.
- [x] migrate.py: 기존 DB에서 metadata와 개인 기록 분리 이전. 원본 보존.
- [x] 전체 테스트, 모바일 QA, 독립 코드 검토, 한국어 안내, 비밀 검사. 세부 결과는 검증결과.md.

## Execution ledger
- Ruling: 사용자 지정 아키텍처와 ZIP 완성 요청에 따라 추가 설계 승인 왕복 없이 이 세션에서 구현한다. 외부 배포는 하지 않는다.
- 수집기/API 시간·기간·분류·소급·체크포인트 실패 테스트 후 구현. 12 Python tests 통과.
- 기록 검증·수동 우선순위·병합 테스트 후 구현. 5 Node tests 통과.
- 독립 검토의 체크포인트 유실·갱신시 오래된 샤드·다중 탭·선택 경쟁·탐색 성능 문제를 재현/수정. 브라우저 회귀 검증 통과.
- 실제 YouTube API 수집에 환경변수/요청 헤더로만 키 사용. Secret을 출력·배포하지 않는다.
- GitHub 저장소는 지정되지 않아 생성·push·배포하지 않는다. 본인 저장소에서 첫 실행할 안내를 제공한다.
