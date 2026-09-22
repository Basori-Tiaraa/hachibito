# Hachibito

> Unofficial web-based key remapper for the **8BitDo Micro** in **K (Keyboard) mode**.
> Runs in Chrome / Edge via Web Bluetooth — no phone app needed.
> **Not affiliated with or endorsed by 8BitDo.**

**Hachibito(하치비토)**는 8BitDo Micro의 K 모드 키 매핑을 공식 모바일 앱 없이 PC 브라우저에서 읽고 바꾸는 비공식 웹앱입니다.
이름은 일본어로 "8비트(ハチビット)"에서 왔습니다.

**▶ 바로 쓰기: https://basori-tiaraa.github.io/hachibito/**
Micro 없이 둘러보기: https://basori-tiaraa.github.io/hachibito/?mock=1

## 기능

- 공식 앱처럼 컨트롤러 그림 주위에 매핑을 배치하고, 각 줄에서 실제 버튼까지 선으로 연결
- 키 하나 + Ctrl / Shift / Alt / Win 조합, 키보드로 직접 눌러서 입력
- 프리셋: 8BitDo 기본값, Anki
- 처음 상태 / Sync 직전 자동 백업으로 되돌리기
- 프로필·백업은 브라우저에 저장, 파일로 내보내서 다른 PC에서 불러오기

## 사용법

1. Micro 스위치를 **K**로 둡니다. 휴대폰의 8BitDo Ultimate Software는 완전히 종료합니다.
2. 위 주소를 **Chrome 또는 Edge**로 엽니다. (Firefox·Safari는 Web Bluetooth를 지원하지 않습니다)
3. **Micro 연결** → Bluetooth 목록에서 `80EL` 선택
4. 바꾸고 싶은 버튼의 줄이나 컨트롤러 그림의 버튼을 클릭 → 키 선택 → 적용
5. **Sync to Micro** → 저장 후 다시 읽어서 검증까지 끝나면 `✓ Verified`

## ⚠️ 주의

- **비공식 도구입니다.** 컨트롤러 설정을 직접 덮어씁니다. 사용에 따른 책임은 사용자에게 있습니다 ([MIT License](LICENSE), 무보증).
- 설정 **읽기**는 실기기에서 확인됐고, **저장**은 가짜 장치 테스트를 통과한 뒤 실기기 검증을 진행 중입니다.
- 저장 전에 원본을 브라우저에 자동 백업하고, 저장 후 전체를 다시 읽어 비교합니다. Profile → **Raw 180B 백업 다운로드**로 원본을 파일로도 받아 두세요.

## 안전장치

- 4페이지(180B)를 전부 읽고 CRC가 맞아야 편집·저장 가능
- 저장 직전 다시 읽어서, 그 사이 설정이 바뀌었으면 저장 중단
- 바꾼 버튼 4바이트만 덮어쓰고 나머지(의미를 모르는 바이트 포함)는 그대로 보존
- 저장 후 전체를 다시 읽어 기대값과 비교, 다르면 실패로 표시

프로토콜 상세는 [docs/PROTOCOL.md](docs/PROTOCOL.md).

## 개인정보

서버가 없습니다. 설정·프로필·백업은 브라우저(localStorage)에만 저장됩니다.
글꼴 [Pretendard](https://github.com/orioncactus/pretendard)(SIL OFL 1.1)를 jsDelivr CDN에서 불러오므로 접속 시 CDN에 요청이 갑니다.

## 개발

```bash
npm install
npm test          # Playwright로 UI + 저장 흐름 회귀 테스트 (가짜 Micro 사용)
npm run serve     # http://localhost:8877/
```

Windows에서는 `start.bat`을 실행해도 됩니다.
`?mock=1`을 붙이면 가짜 Micro([dev/mock-device.js](dev/mock-device.js))로 동작합니다. `?mock=flaky`(첫 연결 끊김), `?mock=badcommit`(저장 검증 실패)도 있습니다.

| 파일 | 역할 |
|---|---|
| `index.html` / `style.css` / `app.js` | 웹앱 본체 (빌드 없음) |
| `dev/mock-device.js` | 가짜 Micro — 테스트·데모용 |
| `tests/` | Playwright 테스트, 정적 서버 |
| `tools/server.ps1` | Python 없는 PC용 로컬 서버 (`start.bat`이 사용) |
| `docs/PROTOCOL.md` | BLE 프로토콜 메모 |

버그 제보는 [Issues](https://github.com/Basori-Tiaraa/hachibito/issues)에 Settings → **로그 복사** 내용을 붙여 주세요.

## 참고한 공개 자료

프로토콜 사실은 아래 프로젝트들의 공개 조사를 교차 확인했고, 코드는 독립적으로 작성했습니다.

- [whywaita/8bitdo-micro-remap](https://github.com/whywaita/8bitdo-micro-remap) — Micro용 Web Bluetooth 리매퍼
- [Thoxy67/8bitult](https://github.com/Thoxy67/8bitult) — 기본 매핑 프로필 참고
- [s8n/ultimatecontroller-rs](https://github.com/s8n/ultimatecontroller-rs)

"8BitDo"와 "Micro"는 해당 소유자의 상표이며, 호환 대상을 나타내기 위해서만 사용합니다. 로고·공식 이미지는 쓰지 않으며 컨트롤러 그림은 자체 SVG입니다.
