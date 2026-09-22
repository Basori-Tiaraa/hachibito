'use strict';

/**
 * 가짜 8BitDo Micro (K 모드) — index.html?mock=1 일 때만 로드된다.
 *
 * navigator.bluetooth.requestDevice를 가로채서, 실제 Micro와 같은 모양의
 * FF10/FF13 GATT 객체를 돌려준다. app.js의 BLE·프로토콜 코드는 그대로 실행되고
 * 이 파일은 "장치 쪽"만 흉내 낸다:
 *   - preamble 패킷 → 무관한 짧은 notification 응답
 *   - read request(04 02 …) → 61B 페이지 응답 + CRC
 *   - write page(04 01 …) → CRC 검사 후 pending 버퍼에 반영
 *   - commit(04 06 …) → pending을 확정하고 byte 0을 스스로 갱신 (실기기 추정 동작)
 *
 * 옵션 (쿼리스트링):
 *   ?mock=1          정상 장치
 *   ?mock=flaky      첫 GATT 연결 직후 한 번 끊김 (Windows 첫 연결 실패 재현)
 *   ?mock=badcommit  commit 후 매핑 바이트 하나가 다르게 저장됨 (검증 실패 재현)
 *
 * 테스트 코드는 window.__microMock 으로 장치 상태를 보고 조작한다.
 */
(() => {
  const SERVICE_UUID = '0000ff10-0000-1000-8000-00805f9b34fb';
  const CHAR_UUID = '0000ff13-0000-1000-8000-00805f9b34fb';
  const PAGE_LENGTH = 45;
  const CONFIG_LENGTH = 180;
  const mode = new URLSearchParams(location.search).get('mock') || '1';

  function crc16(data) {
    let crc = 0xffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xa001 : 0);
    }
    return crc & 0xffff;
  }

  // 그럴듯한 초기 설정. 버튼 영역 밖 바이트는 일부러 0이 아닌 값으로 채워서
  // "unknown bytes 보존"이 실제로 검증되게 한다.
  function initialConfig() {
    const c = new Uint8Array(CONFIG_LENGTH);
    for (let i = 0; i < CONFIG_LENGTH; i++) c[i] = (i * 37 + 11) & 0xff;
    c[0] = 0x10; c[1] = 0x00; c[2] = 0x01;
    c[3] = 0x00; // disable sleep = false
    const slot = (n, bytes) => c.set([...bytes, 0, 0, 0, 0].slice(0, 4), n * 4);
    slot(3,  [0x0e]);             // A  → K
    slot(4,  [0x0d]);             // B  → J
    slot(5,  [0x0c]);             // X  → I
    slot(6,  [0x12]);             // Y  → O
    slot(7,  [0xe0, 0x1d]);       // L  → Ctrl+Z
    slot(8,  [0xe0, 0x1c]);       // R  → Ctrl+Y
    slot(9,  [0x59]);             // L2 → Num 1
    slot(10, [0x5a]);             // R2 → Num 2
    slot(13, [0x2b]);             // −  → Tab
    slot(14, [0x28]);             // +  → Enter
    slot(15, [0xe4, 0x99]);       // ★  → Right Ctrl + 알 수 없는 HID 0x99 (보존 테스트용)
    slot(16, [0x29]);             // ◉  → Esc
    slot(17, [0x52]);             // ↑
    slot(18, [0x51]);             // ↓
    slot(19, [0x50]);             // ←
    slot(20, [0x4f]);             // →
    return c;
  }

  let config = initialConfig();
  let pending = config.slice();
  const writes = [];
  let connectCount = 0;

  const listeners = new Set();
  const characteristic = {
    uuid: CHAR_UUID,
    properties: { read: false, write: true, writeWithoutResponse: false, notify: true, indicate: false },
    value: null,
    addEventListener(type, fn) { if (type === 'characteristicvaluechanged') listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
    async startNotifications() { return characteristic; },
    async writeValueWithResponse(data) { handle(Uint8Array.from(data)); },
    async writeValue(data) { handle(Uint8Array.from(data)); },
  };

  function emit(bytes) {
    setTimeout(() => {
      if (!gatt.connected) return;
      characteristic.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (const fn of listeners) fn({ target: characteristic });
    }, 15);
  }

  function handle(p) {
    if (!gatt.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError');
    writes.push(Array.from(p));
    const view = new DataView(p.buffer);

    if (p[0] === 0x04 && p[1] === 0x02 && p.length === 62) {
      const offset = view.getUint32(13, true);
      const payload = config.slice(offset, offset + PAGE_LENGTH);
      const out = new Uint8Array(61);
      const ov = new DataView(out.buffer);
      out.set([0x04, 0x00, 0x02, 0x00]);
      ov.setUint16(4, PAGE_LENGTH, true);
      ov.setUint16(6, crc16(payload), true);
      ov.setUint32(8, CONFIG_LENGTH, true);
      ov.setUint32(12, offset, true);
      out.set(payload, 16);
      emit(out);
      return;
    }

    if (p[0] === 0x04 && p[1] === 0x01 && p.length === 62) {
      const offset = view.getUint32(13, true);
      const payload = p.slice(17);
      if (crc16(payload) !== view.getUint16(7, true)) throw new Error('mock: write CRC mismatch');
      pending.set(payload, offset);
      emit(Uint8Array.from([0x04, 0x01, 0x00, 0x00]));
      return;
    }

    if (p[0] === 0x04 && p[1] === 0x06) {
      config = pending.slice();
      config[0] = (config[0] + 1) & 0xff; // 실기기는 commit 후 앞 2바이트를 갱신하는 것으로 보임
      if (mode === 'badcommit') config[9 * 4] ^= 0x01;
      pending = config.slice();
      emit(Uint8Array.from([0x04, 0x06, 0x00, 0x00]));
      return;
    }

    // preamble 등: 의미 없는 짧은 응답
    emit(Uint8Array.from([p[0], p[1], 0x00, 0x00]));
  }

  const deviceListeners = new Set();
  const service = {
    uuid: SERVICE_UUID,
    async getCharacteristics() { return [characteristic]; },
    async getCharacteristic(uuid) {
      if (uuid !== CHAR_UUID) throw new DOMException(`No Characteristics matching UUID ${uuid}`, 'NotFoundError');
      return characteristic;
    },
  };
  const gatt = {
    connected: false,
    async connect() {
      connectCount++;
      gatt.connected = true;
      if (mode === 'flaky' && connectCount === 1) setTimeout(() => gatt.disconnect(), 100);
      return gatt;
    },
    disconnect() {
      if (!gatt.connected) return;
      gatt.connected = false;
      for (const fn of deviceListeners) fn({ target: device });
    },
    async getPrimaryService(uuid) {
      if (!gatt.connected) {
        throw new DOMException('GATT Server is disconnected. Cannot retrieve services. (Re)connect first with `device.gatt.connect`.', 'NetworkError');
      }
      if (uuid !== SERVICE_UUID) throw new DOMException('No Services matching UUID', 'NotFoundError');
      return service;
    },
  };
  const device = {
    name: '80EL',
    id: 'mock-80el',
    gatt,
    addEventListener(type, fn) { if (type === 'gattserverdisconnected') deviceListeners.add(fn); },
    removeEventListener(type, fn) { deviceListeners.delete(fn); },
  };

  Object.defineProperty(navigator, 'bluetooth', {
    configurable: true,
    value: { async requestDevice() { return device; } },
  });

  window.__microMock = {
    mode,
    get config() { return Array.from(config); },
    get writes() { return writes; },
    get connectCount() { return connectCount; },
    /** 앱이 읽은 뒤 다른 곳(예: 공식 앱)에서 설정이 바뀐 상황 */
    externalChange(offset, value) { config[offset] = value; pending = config.slice(); },
    disconnect() { gatt.disconnect(); },
  };

  document.addEventListener('DOMContentLoaded', () => {
    const tag = document.createElement('div');
    tag.textContent = `MOCK DEVICE (${mode}) — 실제 Micro가 아닙니다`;
    tag.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:200;' +
      'padding:4px 10px;border-radius:999px;background:#7a4b00;color:#ffe2a8;font:600 11px system-ui;pointer-events:none';
    document.body.appendChild(tag);
  });
})();
