# 8BitDo Micro — K 모드 설정 프로토콜 메모

실기기(광고 이름 `80EL`)에서 확인한 내용과 공개 조사 자료를 합친 것. 코드의 단일 기준.

## BLE

| 항목 | 값 |
|---|---|
| Service | `0000ff10-0000-1000-8000-00805f9b34fb` |
| Characteristic (Micro K 모드) | `0000ff13-0000-1000-8000-00805f9b34fb` |
| FF13 properties (실측) | read ✗ · write ✓ · writeWithoutResponse ✗ · notify ✓ · indicate ✗ |

- **FF11이 아니다.** 초기 버전은 FF11을 써서 `No Characteristics matching UUID …ff11…` 로 실패했다.
- 선택 순서: FF13 → FF11 → FF10 서비스 안에서 write+notify 가능한 것 자동 선택.
- Windows에서 첫 GATT 연결 직후 끊기는 일이 있다(`GATT Server is disconnected. Cannot retrieve services.`). connect → 700~1000ms 대기 → `gatt.connected` 확인 → getPrimaryService, 실패 시 disconnect 후 750ms 쉬고 최대 3회 재시도. 사용자가 직접 해제한 경우엔 재연결하지 않는다.

## 설정 구조

- 전체 180B = 45B × 4 페이지, 페이지 offset `0x00 0x2d 0x5a 0x87`
- CRC-16: init `0xffff`, poly `0xa001`(reflected), xorout 0, little-endian 저장
  - 검증 벡터: 0x00 × 45 → `0xcf30` (패킷엔 `30 cf`)

## 패킷

**Load preamble** (의미 미상, 그대로 보냄, 사이 ~180ms)

```
04 5a 00 00 00 01 00 bf 40 01 00 00 00 00 00 00 00 00
04 0b 00 00 00 04 00 00 24 04 00 00 00 40 70 01 01 00 00 00 00
04 11 00 01 00 00 00 ff ff 00 00 00 00 00 00 00 00
04 11 00 00 00 00 00 ff ff 00 00 00 00 00 00 00 00
```

**Read request** (62B): `04 02 00 00 00 2d 00 | 30 cf | b4 00 00 00 | offset(u32 LE) | 00×45`

**Read response** (61B): `04 00 02 00 | 2d 00 | crc(LE) | b4 00 00 00 | offset(u32 LE) | payload 45B`
검증: 길이 61, prefix `04 00 02`, payload 길이 45, config 길이 180, offset 유효, CRC.

**Write page** (62B): `04 01 00 00 00 2d 00 | crc(LE) | b4 00 00 00 | offset(u32 LE) | payload 45B`

**Commit**: `04 06 00 5b 00 00 00 ff ff 00 00 00 00 00 00 00 00`

## 설정 내용

| offset | 의미 |
|---|---|
| `0x03` | Disable sleep. `00`=off, `01`=on. 다른 값이면 UI에서 잠그고 보존 |
| slot × 4 | 버튼 매핑 4B, 각 바이트가 USB HID Keyboard Usage ID. 빈 칸은 0 |

| 버튼 | slot | offset | | 버튼 | slot | offset |
|---|---|---|---|---|---|---|
| A | 3 | 0x0c | | − (Select) | 13 | 0x34 |
| B | 4 | 0x10 | | + (Start) | 14 | 0x38 |
| X | 5 | 0x14 | | ★ Star | 15 | 0x3c |
| Y | 6 | 0x18 | | ◉ Logo | 16 | 0x40 |
| L | 7 | 0x1c | | ↑ | 17 | 0x44 |
| R | 8 | 0x20 | | ↓ | 18 | 0x48 |
| L2 | 9 | 0x24 | | ← | 19 | 0x4c |
| R2 | 10 | 0x28 | | → | 20 | 0x50 |

**공장 기본값** (K 모드): L2=L · L=K · −=N · ↑=C · ←=E · →=F · ↓=D · ★=T · R2=R · R=M · +=O · X=H · A=G · Y=I · B=J · ♥=S
공식 앱 화면과 [8bitult `profiles/default.toml`](https://github.com/Thoxy67/8bitult/blob/HEAD/profiles/default.toml)이 15개 일치.
★만 다름 — 8bitult는 비어 있음, 공식 앱 화면은 `T`. 앱은 `T`를 쓴다. 실기기 공장 초기화로 확인하면 여기 적을 것.

예: `04 00 00 00`=A, `e0 1a 00 00`=Ctrl+W, `e0 e1 17 00`=Ctrl+Shift+T.
Modifier: Ctrl `e0`, Shift `e1`, Alt `e2`, Win `e3` (오른쪽 `e4`~`e7`).

## 저장 절차 (바꾸지 말 것)

1. 4페이지 전부 읽고 CRC 통과 → 그때만 편집 가능한 baseline
2. 저장 직전 다시 읽기. baseline과 다르면 **DEVICE_CHANGED** → 중단
3. fresh 복사본에 바뀐 버튼 4B / sleep 바이트만 덮어쓰기. 나머지 바이트는 전부 보존
4. raw 180B 백업 (localStorage)
5. 4페이지 각각 CRC 다시 계산해 write → 4개 다 성공해야 commit
6. commit 후 전체 다시 읽기, CRC 확인
7. bytes 2..179 는 완전 일치해야 성공. bytes 0..1 은 기기가 스스로 바꿀 수 있어 허용

## 참고

- https://github.com/whywaita/8bitdo-micro-remap — Micro 전용 Web Bluetooth 구현, 이 문서 대부분의 교차 확인 출처 (라이선스 없음 → 코드 복사 금지, 사실만 참고)
- https://github.com/Thoxy67/8bitult — Micro 역공학 CLI (MIT)
- https://github.com/s8n/ultimatecontroller-rs — 8BitDo BLE 프로토콜 연구
