# CHANGELOG

## v5.1 (2026-09-23) — 디자인 개편 · 브라우저 저장 · 프리셋 · 되돌리기

- 컨트롤러 SVG를 실물 Micro 비율로 다시 그림 (어깨 L/L2·R/R2 두 단, −·LED·+, ★·픽셀 하트, 로고 글자 없음)
- 리더선: 각 매핑 줄에서 **실제 버튼 위치까지** 꺾인 선. 몸체 가장자리에서 꺾이고 둥근 버튼은 가장자리에서 멈춤
- 줄 / 선 / 컨트롤러 버튼 양방향 하이라이트, 컨트롤러 그림의 버튼을 눌러도 편집창이 열림
- Pretendard 폰트, 매핑 값 키캡 표시(`Ctrl` + `Z`), CSS 전면 재작성 (v3·v4 덧칠 제거), 좁은 화면 2열 배치
- 컨트롤러 아래 Disable Sleep 스위치 (Settings와 연동)
- 브라우저 저장(localStorage): 마지막으로 읽은 매핑을 연결 전에도 표시, Sync 안 한 편집을 새로고침 뒤 이어서 편집, 마지막 탭 기억
- 프리셋: **8BitDo 기본값**, **Anki** (기존 설정에서 `Num .` 자리만 Disabled)
- 원래대로 되돌리기: 처음 연결했을 때 상태(한 번 기록 후 덮어쓰지 않음) / Sync 직전 자동 백업
- 전체 데이터 내보내기·불러오기: 프로필·백업·처음 상태를 파일 하나로 옮김 (프로필·백업은 합침)
- 테스트 17개
- BLE / 프로토콜 / 저장 로직은 변경 없음

## v5.0 (2026-09-22) — 폴더 정리 + 편집창 신뢰성

- 프로젝트 구조 정리 (앱 / dev / tests / tools / docs)
- 매핑 행 클릭
  - 설정을 읽기 전이나 작업 중에 클릭하면 조용히 무시하던 것을 로그 + 토스트로 이유 표시
  - 모달이 열리면 포커스를 모달 안으로 옮김 (뒤쪽 행에 남아 Space/Enter로 다시 열리며 편집값이 초기화되던 문제)
  - 모달이 이미 열려 있으면 다시 열지 않음
  - init의 `style.display='none'` 과 open의 `style.display='grid'` 이중 관리 제거 → `.hidden` 클래스 하나로
- 모달에서 아무것도 안 바꾸고 "적용"하면 원래 4바이트를 그대로 둠 (알 수 없는 HID 코드·오른쪽 modifier 보존). 모달에 raw hex 표시
- 탭 전환 시 버전 배지가 사라지던 문제 수정
- `?mock=1` 가짜 Micro (`dev/mock-device.js`) + Playwright 테스트 10개 (`npm test`)
- `server.ps1` → `tools/`, 기본 포트 8877
- BLE / 프로토콜 / 저장 로직은 변경 없음

## v4

- Removed disabled HTML buttons from the mapping UI entirely.
- Added document-level capture-phase click delegation for all mapping rows.
- Mapping row clicks now work on the key text, physical label, connector, and whitespace.
- Added explicit modal display fallback (`style.display = grid`).
- Added editor-open logging.
- Added a visible `v4.0` badge in the header.
- Changed local server port from 8765 to **8877** so a previously-running old server cannot silently serve an older build.
- Added query-string cache busting for CSS/JS.

## v3

- Fixed the mapping controls staying disabled after a successful config read.
- Entire mapping rows are now clickable:
  - current mapping box
  - physical labels such as L2 / A / X / arrows
  - row whitespace
- Added keyboard activation with Enter/Space.
- Added stronger hover/focus feedback and wider mapping labels.
- Refined desktop layout to more closely match the official-app reference.
- Added automatic initial GATT retry (up to 3 attempts) with a settle delay to handle Windows BLE's transient first-connect disconnect.

## v2

- Fixed Micro K-mode characteristic:
  - preferred FF13
  - FF11 fallback
  - automatic characteristic enumeration/property fallback
- Replaced the earlier simplified 2-group mapping read/write with:
  - full 180-byte configuration
  - 4 pages × 45 bytes
  - per-page CRC validation
  - read-modify-write preserving unknown bytes
  - commit + full readback verification
- Added load preamble observed in public Micro protocol research.
- New official-app-inspired UI:
  - Profile / Buttons / Settings sidebar
  - controller-centered mapping view
  - 16 mapping controls around the controller
  - keyboard chord capture
  - local profiles
  - raw backup download
  - BLE diagnostics
- Automatic local raw backup before every write.
