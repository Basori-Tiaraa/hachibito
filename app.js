'use strict';

/**
 * Hachibito — unofficial key remapper for the 8BitDo Micro (K mode)
 * -----------------------------------
 * Protocol implementation is independently written from public protocol facts:
 * - FF10 service
 * - FF13 characteristic observed for Micro K-mode
 * - 180-byte config = 4 pages × 45 bytes
 * - CRC-16/MODBUS-style reflected poly 0xA001, init 0xFFFF
 * - read/write/commit packet layouts and known button slots
 *
 * No official 8BitDo images or logos are used.
 */

const APP_VERSION = '5.1.0';

// ===== BLE / protocol constants =====
const DEVICE_NAME = '80EL';
const SERVICE_UUID = '0000ff10-0000-1000-8000-00805f9b34fb';
const PREFERRED_CHARACTERISTICS = [
  '0000ff13-0000-1000-8000-00805f9b34fb', // Micro K-mode observed characteristic
  '0000ff11-0000-1000-8000-00805f9b34fb'  // fallback used by some other 8BitDo models
];

const CONFIG_LENGTH = 180;
const PAGE_LENGTH = 45;
const PAGE_OFFSETS = [0x00, 0x2d, 0x5a, 0x87];
const READ_RESPONSE_LENGTH = 61;
const WRITE_PACKET_LENGTH = 62;
const DISABLE_SLEEP_OFFSET = 0x03;

const LOAD_PREAMBLE = [
  [0x04,0x5a,0x00,0x00,0x00,0x01,0x00,0xbf,0x40,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00],
  [0x04,0x0b,0x00,0x00,0x00,0x04,0x00,0x00,0x24,0x04,0x00,0x00,0x00,0x40,0x70,0x01,0x01,0x00,0x00,0x00,0x00],
  [0x04,0x11,0x00,0x01,0x00,0x00,0x00,0xff,0xff,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00],
  [0x04,0x11,0x00,0x00,0x00,0x00,0x00,0xff,0xff,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]
].map(v => Uint8Array.from(v));

const COMMIT_PACKET = Uint8Array.from([
  0x04,0x06,0x00,0x5b,0x00,0x00,0x00,0xff,0xff,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00
]);

const BUTTONS = {
  a:     { id:'a',     physical:'A',     offset: 3 * 4 },
  b:     { id:'b',     physical:'B',     offset: 4 * 4 },
  x:     { id:'x',     physical:'X',     offset: 5 * 4 },
  y:     { id:'y',     physical:'Y',     offset: 6 * 4 },
  l:     { id:'l',     physical:'L',     offset: 7 * 4 },
  r:     { id:'r',     physical:'R',     offset: 8 * 4 },
  l2:    { id:'l2',    physical:'L2',    offset: 9 * 4 },
  r2:    { id:'r2',    physical:'R2',    offset:10 * 4 },
  minus: { id:'minus', physical:'−',     offset:13 * 4 },
  plus:  { id:'plus',  physical:'＋',    offset:14 * 4 },
  star:  { id:'star',  physical:'★',     offset:15 * 4 },
  logo:  { id:'logo',  physical:'♥',     offset:16 * 4 },
  up:    { id:'up',    physical:'↑',     offset:17 * 4 },
  down:  { id:'down',  physical:'↓',     offset:18 * 4 },
  left:  { id:'left',  physical:'←',     offset:19 * 4 },
  right: { id:'right', physical:'→',     offset:20 * 4 },
};

const LEFT_ORDER = ['l2','l','minus','up','left','right','down','star'];
const RIGHT_ORDER = ['r2','r','plus','x','a','y','b','logo'];

// ===== HID tables =====
const HID_NAMES = new Map([
  [0x00,'Disabled'],
  ...Array.from({length:26}, (_,i)=>[0x04+i,String.fromCharCode(65+i)]),
  [0x1e,'1'],[0x1f,'2'],[0x20,'3'],[0x21,'4'],[0x22,'5'],[0x23,'6'],[0x24,'7'],[0x25,'8'],[0x26,'9'],[0x27,'0'],
  [0x28,'Enter'],[0x29,'Esc'],[0x2a,'Backspace'],[0x2b,'Tab'],[0x2c,'Space'],
  [0x2d,'-'],[0x2e,'='],[0x2f,'['],[0x30,']'],[0x31,'\\'],[0x32,'# / ~'],
  [0x33,';'],[0x34,"'"],[0x35,'`'],[0x36,','],[0x37,'.'],[0x38,'/'],
  [0x39,'Caps Lock'],
  [0x3a,'F1'],[0x3b,'F2'],[0x3c,'F3'],[0x3d,'F4'],[0x3e,'F5'],[0x3f,'F6'],
  [0x40,'F7'],[0x41,'F8'],[0x42,'F9'],[0x43,'F10'],[0x44,'F11'],[0x45,'F12'],
  [0x46,'Print Screen'],[0x47,'Scroll Lock'],[0x48,'Pause'],
  [0x49,'Insert'],[0x4a,'Home'],[0x4b,'Page Up'],[0x4c,'Delete'],[0x4d,'End'],[0x4e,'Page Down'],
  [0x4f,'Right'],[0x50,'Left'],[0x51,'Down'],[0x52,'Up'],
  [0x53,'Num Lock'],[0x54,'Num /'],[0x55,'Num *'],[0x56,'Num -'],[0x57,'Num +'],[0x58,'Num Enter'],
  [0x59,'Num 1'],[0x5a,'Num 2'],[0x5b,'Num 3'],[0x5c,'Num 4'],[0x5d,'Num 5'],[0x5e,'Num 6'],
  [0x5f,'Num 7'],[0x60,'Num 8'],[0x61,'Num 9'],[0x62,'Num 0'],[0x63,'Num .'],
  [0x68,'F13'],[0x69,'F14'],[0x6a,'F15'],[0x6b,'F16'],[0x6c,'F17'],[0x6d,'F18'],
  [0x6e,'F19'],[0x6f,'F20'],[0x70,'F21'],[0x71,'F22'],[0x72,'F23'],[0x73,'F24'],
  [0x7a,'Undo'],[0x7b,'Cut'],[0x7c,'Copy'],[0x7d,'Paste'],[0x7e,'Find'],
  [0x7f,'Mute'],[0x80,'Volume +'],[0x81,'Volume -'],
  [0x87,'Ro'],[0x88,'Kana/Hangul'],[0x89,'Yen'],[0x8a,'Henkan'],[0x8b,'Muhenkan'],
  [0x90,'한/영'],[0x91,'한자'],
  [0xe0,'Ctrl'],[0xe1,'Shift'],[0xe2,'Alt'],[0xe3,'Win'],
  [0xe4,'Right Ctrl'],[0xe5,'Right Shift'],[0xe6,'Right Alt'],[0xe7,'Right Win'],
  [0xe8,'Play/Pause'],[0xe9,'Media Stop'],[0xea,'Previous Track'],[0xeb,'Next Track'],
  [0xed,'Media Volume +'],[0xee,'Media Volume -'],[0xef,'Media Mute'],
  [0xf0,'Browser'],[0xf1,'Browser Back'],[0xf2,'Browser Forward'],
  [0xf4,'Media Find'],[0xfa,'Media Refresh'],[0xfb,'Calculator'],
]);

const MODIFIERS = new Map([
  [0xe0,'Ctrl'],[0xe1,'Shift'],[0xe2,'Alt'],[0xe3,'Win'],
  [0xe4,'Right Ctrl'],[0xe5,'Right Shift'],[0xe6,'Right Alt'],[0xe7,'Right Win'],
]);

const SELECTABLE_KEYS = [...HID_NAMES.entries()]
  .filter(([code]) => code === 0 || !(code >= 0xe0 && code <= 0xe7))
  .filter(([code]) => code <= 0x91 || code >= 0xe8);

const CODE_TO_HID = new Map();
for (let i=0;i<26;i++) CODE_TO_HID.set(`Key${String.fromCharCode(65+i)}`, 0x04+i);
for (let i=1;i<=9;i++) CODE_TO_HID.set(`Digit${i}`, 0x1d+i);
CODE_TO_HID.set('Digit0',0x27);
[
  ['Enter',0x28],['Escape',0x29],['Backspace',0x2a],['Tab',0x2b],['Space',0x2c],
  ['Minus',0x2d],['Equal',0x2e],['BracketLeft',0x2f],['BracketRight',0x30],
  ['Backslash',0x31],['Semicolon',0x33],['Quote',0x34],['Backquote',0x35],
  ['Comma',0x36],['Period',0x37],['Slash',0x38],['CapsLock',0x39],
  ['PrintScreen',0x46],['ScrollLock',0x47],['Pause',0x48],
  ['Insert',0x49],['Home',0x4a],['PageUp',0x4b],['Delete',0x4c],
  ['End',0x4d],['PageDown',0x4e],['ArrowRight',0x4f],['ArrowLeft',0x50],
  ['ArrowDown',0x51],['ArrowUp',0x52],
  ['NumpadDivide',0x54],['NumpadMultiply',0x55],['NumpadSubtract',0x56],
  ['NumpadAdd',0x57],['NumpadEnter',0x58],['NumpadDecimal',0x63]
].forEach(([code,hid])=>CODE_TO_HID.set(code,hid));
for (let i=1;i<=12;i++) CODE_TO_HID.set(`F${i}`, 0x39+i);
for (let i=0;i<=9;i++) CODE_TO_HID.set(`Numpad${i}`, i===0 ? 0x62 : 0x58+i);

// ===== state =====
const state = {
  device: null,
  service: null,
  writeChar: null,
  notifyChar: null,
  connected: false,
  busy: false,
  baseline: null,
  draft: null,
  dirtyButtons: new Set(),
  sleepDirty: false,
  verified: false,
  currentTab: 'buttons',
  modalButton: null,
  modalSnapshot: null,
  captureActive: false,
  notificationQueue: [],
  notificationWaiters: [],
  connectingRetry: false,
  cached: null,   // 브라우저에 기억된 마지막 설정 (표시 전용)
  hover: null,
};

const $ = id => document.getElementById(id);

// ===== logging / UI helpers =====
function stamp() {
  return new Date().toLocaleTimeString('ko-KR', {hour12:true});
}

function log(message, type='info') {
  const line = `[${stamp()}] ${type === 'error' ? '✖' : type === 'ok' ? '✔' : '•'} ${message}`;
  const el = $('log');
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
  console[type === 'error' ? 'error' : 'log'](line);
}

function toast(message, type='info', duration=3400) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toastContainer').appendChild(el);
  setTimeout(()=>el.remove(), duration);
}

function shortUuid(uuid) {
  const m = /^0000([0-9a-f]{4})-/i.exec(uuid || '');
  return m ? m[1].toUpperCase() : (uuid || '—');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function equalBytes(a,b,start=0) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i=start;i<a.length;i++) if (a[i] !== b[i]) return false;
  return true;
}

function copyBytes(bytes) { return bytes ? Uint8Array.from(bytes) : null; }

function setBusy(busy, label='') {
  state.busy = busy;
  document.body.classList.toggle('busy', busy);
  $('connectButton').disabled = busy || state.connected;
  $('readButton').disabled = busy || !state.connected;
  $('syncButton').disabled = busy || !state.connected || !state.baseline || !isDirty();
  $('resetDraftButton').disabled = busy || !state.baseline || !isDirty();
  if (busy && label) setControllerStatus(label, 'busy');

  updateEditable();
  renderPresets();
  renderRestore();

  refreshConnectionUI();
}

function setControllerStatus(text, kind='') {
  const el = $('controllerStatus');
  el.textContent = text;
  el.className = `controller-status ${kind}`;
}

function isDirty() {
  return state.dirtyButtons.size > 0 || state.sleepDirty;
}

function refreshConnectionUI() {
  const connected = state.connected;
  $('deviceDot').classList.toggle('on', connected);
  $('connectionIcon').className = `connection-icon ${state.busy ? 'busy' : connected ? 'on' : 'off'}`;
  $('connectionText').textContent = state.busy ? '작업 중…' : connected ? '80EL 연결됨' : '연결 안 됨';
  $('connectionDetail').textContent = connected
    ? `${shortUuid(state.writeChar?.uuid)} / ${state.baseline ? '180B config loaded' : 'config not loaded'}`
    : 'Micro를 K 모드로 두고 연결하세요.';
  $('connectButton').textContent = connected ? '연결됨' : 'Micro 연결';
  $('connectButton').disabled = state.busy || connected;
  $('readButton').disabled = state.busy || !connected;
  $('verifiedBadge').classList.toggle('hidden', !state.verified);
  $('syncButton').disabled = state.busy || !connected || !state.baseline || !isDirty();
  $('resetDraftButton').disabled = state.busy || !state.baseline || !isDirty();
  $('rawBackupButton').disabled = !state.baseline;
  $('profileExportButton').disabled = !state.draft;
  $('diagDevice').textContent = state.device?.name || '—';
  $('diagWrite').textContent = state.writeChar ? shortUuid(state.writeChar.uuid) : '—';
  $('diagNotify').textContent = state.notifyChar ? shortUuid(state.notifyChar.uuid) : '—';
  $('diagConfig').textContent = state.baseline ? `${state.baseline.length} bytes / CRC OK` : '—';
}

function setTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  $(`tab-${tab}`).classList.add('active');
  storeSet(STORE_TAB, tab);
  if (tab === 'buttons') requestAnimationFrame(drawLeaderLines);
  $('topTitle').textContent = tab === 'buttons' ? 'Buttons' : tab === 'profile' ? 'Profile' : 'Settings';
  $('topSubtitle').textContent = tab === 'buttons'
    ? '8BitDo Micro · K mode'
    : tab === 'profile'
      ? 'Local profiles · no cloud'
      : 'Controller & BLE diagnostics';
}

// ===== HID helpers =====
function mappingBytes(config, id) {
  const b = BUTTONS[id];
  return Array.from(config.slice(b.offset, b.offset + 4));
}

function formatMapping(raw) {
  if (!raw || raw.length !== 4) return '—';
  const active = raw.filter(v => v !== 0);
  if (!active.length) return 'Disabled';
  const labels = active.map(v => HID_NAMES.get(v) ?? `0x${v.toString(16).padStart(2,'0').toUpperCase()}`);
  return labels.join('+');
}

function decodeEditor(raw) {
  const mods = {ctrl:false, shift:false, alt:false, meta:false};
  let key = 0;
  for (const code of raw) {
    if (code === 0) continue;
    if (code === 0xe0 || code === 0xe4) mods.ctrl = true;
    else if (code === 0xe1 || code === 0xe5) mods.shift = true;
    else if (code === 0xe2 || code === 0xe6) mods.alt = true;
    else if (code === 0xe3 || code === 0xe7) mods.meta = true;
    else if (!key) key = code;
  }
  return {mods, key};
}

function encodeEditor(key, mods) {
  if (!key) return [0,0,0,0];
  const out = [];
  if (mods.ctrl) out.push(0xe0);
  if (mods.shift) out.push(0xe1);
  if (mods.alt) out.push(0xe2);
  if (mods.meta) out.push(0xe3);
  if (out.length > 3) throw new Error('키 하나와 함께 사용할 수 있는 modifier는 최대 3개입니다.');
  out.push(Number(key));
  while (out.length < 4) out.push(0);
  return out.slice(0,4);
}

function mappingLabels(raw) {
  return raw.filter(v => v !== 0).map(v => HID_NAMES.get(v) ?? `0x${v.toString(16).padStart(2,'0').toUpperCase()}`);
}

function fillMappingValue(el, raw) {
  el.replaceChildren();
  el.className = 'mapping-value';
  if (!raw) { el.textContent = '—'; el.classList.add('empty'); return; }
  const labels = mappingLabels(raw);
  if (!labels.length) { el.textContent = 'Disabled'; el.classList.add('disabled-key'); return; }
  if (labels.length === 1) { el.textContent = labels[0]; return; }
  labels.forEach((label, i) => {
    if (i) {
      const plus = document.createElement('span');
      plus.className = 'plus';
      plus.textContent = '+';
      el.appendChild(plus);
    }
    const kc = document.createElement('span');
    kc.className = 'kc';
    kc.textContent = label;
    el.appendChild(kc);
  });
}

function canEdit() { return !!state.draft && !state.busy; }

function updateEditable() {
  const enabled = canEdit();
  document.body.classList.toggle('editable', enabled);
  document.querySelectorAll('.mapping-row').forEach(row => {
    row.classList.toggle('editable', enabled);
    row.tabIndex = enabled ? 0 : -1;
    row.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  });
}

function renderMappings() {
  // 연결 전에는 브라우저에 기억된 마지막 매핑을 흐리게 보여준다 (편집은 불가)
  const shown = state.draft || state.cached;
  const renderColumn = (targetId, ids, side) => {
    const host = $(targetId);
    host.innerHTML = '';
    for (const id of ids) {
      const button = BUTTONS[id];
      const raw = shown ? mappingBytes(shown, id) : null;
      const row = document.createElement('div');
      row.className = 'mapping-row';
      row.classList.toggle('dirty', state.dirtyButtons.has(id));
      row.classList.toggle('cached', !state.draft && !!state.cached);
      row.dataset.button = id;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `${button.physical} 매핑 편집`);

      const value = document.createElement('div');
      fillMappingValue(value, raw);
      value.title = state.draft ? `${formatMapping(raw)} — 클릭해서 변경`
        : state.cached ? `${formatMapping(raw)} — 마지막으로 읽은 값. 연결하면 편집할 수 있습니다` : '장치 연결 후 표시됩니다';

      const chevron = document.createElement('div');
      chevron.className = 'mapping-chevron';
      chevron.textContent = side === 'left' ? '‹' : '›';

      const physical = document.createElement('div');
      physical.className = 'mapping-physical';
      if (!/^[A-Z0-9]+$/.test(button.physical)) physical.classList.add('glyph');
      physical.textContent = button.physical;

      const connector = document.createElement('div');
      connector.className = 'connector';

      if (side === 'left') row.append(value, chevron, physical, connector);
      else row.append(connector, physical, chevron, value);
      host.appendChild(row);
    }
  };

  renderColumn('leftMappings', LEFT_ORDER, 'left');
  renderColumn('rightMappings', RIGHT_ORDER, 'right');

  document.querySelectorAll('#controllerSvg .hw').forEach(hw => {
    hw.classList.toggle('dirty', state.dirtyButtons.has(hw.dataset.button));
  });

  const sleepValue = state.draft ? state.draft[DISABLE_SLEEP_OFFSET] : null;
  const sleepLocked = !state.draft || state.busy || (sleepValue !== 0 && sleepValue !== 1);
  for (const el of [$('sleepToggle'), $('stageSleepToggle')]) {
    el.disabled = sleepLocked;
    el.checked = sleepValue === 1;
  }

  updateEditable();
  refreshConnectionUI();
  drawLeaderLines();
}

// ===== leader lines (매핑 줄 → 컨트롤러의 실제 버튼) =====
const SVG_NS = 'http://www.w3.org/2000/svg';

function anchorPoint(hw, stageRect) {
  const ctm = $('controllerSvg').getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(Number(hw.dataset.ax), Number(hw.dataset.ay)).matrixTransform(ctm);
  return {x: p.x - stageRect.left, y: p.y - stageRect.top, r: Number(hw.dataset.ar || 0) * ctm.a};
}

function drawLeaderLines() {
  const layer = $('leaderLines');
  const stage = $('mapperStage');
  if (!layer || !stage || getComputedStyle(layer).display === 'none') return;
  const sr = stage.getBoundingClientRect();
  if (!sr.width) return;
  layer.setAttribute('viewBox', `0 0 ${sr.width} ${sr.height}`);
  layer.replaceChildren();
  const body = $('ctrlBody').getBoundingClientRect();

  for (const row of document.querySelectorAll('.mapping-row')) {
    const id = row.dataset.button;
    const hw = document.querySelector(`#controllerSvg .hw[data-button="${id}"]`);
    const label = row.querySelector('.mapping-physical');
    if (!hw || !label) continue;
    const end = anchorPoint(hw, sr);
    if (!end) continue;
    const lr = label.getBoundingClientRect();
    const left = row.parentElement.classList.contains('left');
    const sx = left ? lr.right - sr.left + 8 : lr.left - sr.left - 8;
    const sy = lr.top + lr.height / 2 - sr.top;

    // 몸체 가장자리까지 수평으로 온 뒤 꺾여서 버튼으로 들어간다 (몸체 위를 수평으로 가로지르지 않게)
    let ex = left ? body.left - sr.left - 14 : body.right - sr.left + 14;
    ex = left ? Math.min(ex, end.x - 10) : Math.max(ex, end.x + 10);
    ex = left ? Math.max(sx + 14, ex) : Math.min(sx - 14, ex);

    // 둥근 버튼은 중심이 아니라 가장자리에서 선을 멈춘다 (글자를 가리지 않게)
    if (end.r) {
      const vx = end.x - ex, vy = end.y - sy, len = Math.hypot(vx, vy) || 1;
      end.x -= vx / len * (end.r + 2);
      end.y -= vy / len * (end.r + 2);
    }

    const g = document.createElementNS(SVG_NS, 'g');
    g.dataset.button = id;
    g.classList.toggle('dirty', state.dirtyButtons.has(id));
    g.classList.toggle('hl', state.hover === id);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} H${ex.toFixed(1)} L${end.x.toFixed(1)} ${end.y.toFixed(1)}`);
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', end.x.toFixed(1));
    dot.setAttribute('cy', end.y.toFixed(1));
    dot.setAttribute('r', '3.5');
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('class', 'ring');
    ring.setAttribute('cx', end.x.toFixed(1));
    ring.setAttribute('cy', end.y.toFixed(1));
    ring.setAttribute('r', '8');
    g.append(path, dot, ring);
    layer.appendChild(g);
  }
}

// 줄 ↔ 컨트롤러 버튼 ↔ 선을 한꺼번에 하이라이트
function setHover(id) {
  if (state.hover === id) return;
  state.hover = id;
  document.querySelectorAll('.mapping-row, #controllerSvg .hw, #leaderLines g').forEach(el => {
    el.classList.toggle('hl', !!id && el.dataset.button === id);
  });
}

document.addEventListener('pointerover', event => {
  const t = event.target instanceof Element ? event.target.closest('.mapping-row, #controllerSvg .hw') : null;
  setHover(t ? t.dataset.button : null);
});
document.addEventListener('focusin', event => {
  const row = event.target instanceof Element ? event.target.closest('.mapping-row') : null;
  if (row) setHover(row.dataset.button);
});

new ResizeObserver(() => drawLeaderLines()).observe(document.getElementById('mapperStage'));
document.fonts?.ready.then(() => drawLeaderLines());

// ===== 브라우저 저장 (localStorage) =====
// 쿠키 대신 localStorage: 용량이 넉넉하고 서버로 전송되지 않는다. 이 브라우저에만 남는다.
const STORE_LAST = 'micro-mapper:last-config';
const STORE_PENDING = 'micro-mapper:pending-edits';
const STORE_TAB = 'micro-mapper:tab';

function storeGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function storeSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function rememberConfig(config) {
  storeSet(STORE_LAST, {savedAt: new Date().toISOString(), raw: Array.from(config)});
}

function loadCachedConfig() { return loadStoredConfig(STORE_LAST); }

// Sync 안 한 편집을 버튼 단위로 기억한다. 바이트 원본은 매번 기기에서 새로 읽으므로 저장하지 않는다.
function persistDraft() {
  if (!state.draft || !isDirty()) { storeSet(STORE_PENDING, null); refreshStorageUI(); return; }
  const buttons = {};
  for (const id of state.dirtyButtons) buttons[id] = mappingBytes(state.draft, id);
  storeSet(STORE_PENDING, {
    savedAt: new Date().toISOString(),
    buttons,
    sleep: state.sleepDirty ? state.draft[DISABLE_SLEEP_OFFSET] : null,
  });
  refreshStorageUI();
}

function loadPending() {
  const p = storeGet(STORE_PENDING);
  if (!p || typeof p.buttons !== 'object' || !p.buttons) return null;
  const buttons = {};
  for (const [id, raw] of Object.entries(p.buttons)) {
    if (BUTTONS[id] && Array.isArray(raw) && raw.length === 4 && raw.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
      buttons[id] = raw;
    }
  }
  const sleep = p.sleep === 0 || p.sleep === 1 ? p.sleep : null;
  const count = Object.keys(buttons).length + (sleep === null ? 0 : 1);
  return count ? {buttons, sleep, count, savedAt: p.savedAt} : null;
}

function refreshPendingBanner() {
  const p = state.draft && !isDirty() ? loadPending() : null;
  $('pendingBanner').classList.toggle('hidden', !p);
  if (p) $('pendingText').textContent = `Sync 안 한 편집 ${p.count}개가 남아 있습니다`;
}

function setDraftMapping(id, raw) {
  state.draft.set(raw, BUTTONS[id].offset);
  const base = mappingBytes(state.baseline, id);
  if (raw.every((v,i)=>v===base[i])) state.dirtyButtons.delete(id);
  else state.dirtyButtons.add(id);
}

function restorePending() {
  const p = loadPending();
  if (!p || !state.draft) return;
  for (const [id, raw] of Object.entries(p.buttons)) setDraftMapping(id, raw);
  if (p.sleep !== null && [0,1].includes(state.baseline[DISABLE_SLEEP_OFFSET])) {
    state.draft[DISABLE_SLEEP_OFFSET] = p.sleep;
    state.sleepDirty = p.sleep !== state.baseline[DISABLE_SLEEP_OFFSET];
  }
  state.verified = false;
  log(`브라우저에 남아 있던 편집 ${p.count}개를 불러왔습니다.`, 'ok');
  renderMappings();
  persistDraft();
  refreshPendingBanner();
}

function discardPending() {
  storeSet(STORE_PENDING, null);
  refreshPendingBanner();
  refreshStorageUI();
}

function refreshStorageUI() {
  const c = loadCachedConfig();
  const p = loadPending();
  $('diagCached').textContent = c ? new Date(c.savedAt).toLocaleString() : '—';
  $('diagPending').textContent = p ? `${p.count}개` : '—';
  const o = loadStoredConfig(STORE_ORIGINAL);
  $('diagOriginal').textContent = o ? new Date(o.savedAt).toLocaleString() : '—';
  $('diagBackups').textContent = `${listAutomaticBackups().length}개`;
  $('diagProfiles').textContent = `${getProfiles().length}개`;
}

function clearStoredData() {
  if (!confirm('이 브라우저에 저장된 마지막 매핑과 Sync 안 한 편집을 지울까요?\n(내 프로필과 저장 전 자동 백업은 남습니다)')) return;
  storeSet(STORE_LAST, null);
  storeSet(STORE_PENDING, null);
  state.cached = null;
  renderMappings();
  refreshPendingBanner();
  refreshStorageUI();
  toast('저장된 데이터를 지웠습니다.', 'ok');
}

// ===== 추천 프리셋 =====
const K = (...codes) => [...codes, 0, 0, 0, 0].slice(0, 4);
const OFF = K();
const PRESETS = [
  {
    id: 'default',
    name: '8BitDo 기본값',
    description: '공장 출고 K 모드 배치. 공식 앱 화면과 Thoxy67/8bitult의 기본 프로필로 교차 확인.',
    mappings: {
      l2: K(0x0f), l: K(0x0e), minus: K(0x11),
      up: K(0x06), left: K(0x08), right: K(0x09), down: K(0x07), star: K(0x17),
      r2: K(0x15), r: K(0x10), plus: K(0x12),
      x: K(0x0b), a: K(0x0a), y: K(0x0c), b: K(0x0d), logo: K(0x16),
    },
  },
  {
    id: 'anki',
    name: 'Anki',
    description: '복습용 넘버패드 배치. Anki가 인식하지 못해 잘못 누르기만 하던 Num . 자리(−, +, R, R2, ♥)는 Disabled.',
    mappings: {
      l2: OFF, l: OFF, minus: OFF,
      up: K(0x5b), left: K(0x5a), right: K(0x28), down: K(0x59), star: K(0x29),
      r2: OFF, r: OFF, plus: OFF,
      x: K(0x59), a: K(0x5a), y: K(0x58), b: K(0x5b), logo: OFF,
    },
  },
];

function presetProfile(preset) {
  return {format: '8bitdo-micro-web-profile-v2', name: preset.name, createdAt: null, mappings: preset.mappings, disableSleep: null};
}

function renderPresets() {
  const host = $('presetsList');
  host.innerHTML = '';
  for (const preset of PRESETS) {
    host.appendChild(actionCard({
      title: preset.name,
      description: preset.description,
      mappings: preset.mappings,
      dataset: {preset: preset.id},
      onApply: () => applyProfile(presetProfile(preset)),
    }));
  }
}


// ===== 원래대로 되돌리기 =====
const STORE_ORIGINAL = 'micro-mapper:original-config';
const BACKUP_INDEX = '8bitdo-micro-backup-index';

function loadStoredConfig(key) {
  const entry = storeGet(key);
  const raw = entry?.raw;
  if (!Array.isArray(raw) || raw.length !== CONFIG_LENGTH) return null;
  if (raw.some(v => !Number.isInteger(v) || v < 0 || v > 255)) return null;
  return {config: Uint8Array.from(raw), savedAt: entry.savedAt || entry.createdAt};
}

// 이 웹앱으로 처음 읽은 설정. 한 번 기록하면 덮어쓰지 않는다.
function rememberOriginal(config) {
  if (loadStoredConfig(STORE_ORIGINAL)) return;
  storeSet(STORE_ORIGINAL, {savedAt: new Date().toISOString(), raw: Array.from(config)});
  log('처음 상태를 브라우저에 기록했습니다. Profile → 원래대로 되돌리기에서 쓸 수 있습니다.');
}

function listAutomaticBackups() {
  const index = storeGet(BACKUP_INDEX);
  if (!Array.isArray(index)) return [];
  return index.map(key => ({key, ...loadStoredConfig(key)})).filter(b => b.config);
}

function configMappings(config) {
  return Object.fromEntries(Object.keys(BUTTONS).map(id => [id, mappingBytes(config, id)]));
}

function applyConfigToDraft(config, label) {
  if (!state.draft || !state.baseline) throw new Error('먼저 Micro를 연결해 현재 설정을 읽어야 되돌릴 수 있습니다.');
  for (const id of Object.keys(BUTTONS)) setDraftMapping(id, mappingBytes(config, id));
  const sleep = config[DISABLE_SLEEP_OFFSET];
  if ([0,1].includes(sleep) && [0,1].includes(state.baseline[DISABLE_SLEEP_OFFSET])) {
    state.draft[DISABLE_SLEEP_OFFSET] = sleep;
    state.sleepDirty = sleep !== state.baseline[DISABLE_SLEEP_OFFSET];
  }
  state.verified = false;
  setTab('buttons');
  renderMappings();
  persistDraft();
  refreshPendingBanner();
  const n = state.dirtyButtons.size + (state.sleepDirty ? 1 : 0);
  log(`${label} 적용: 바뀌는 항목 ${n}개`, 'ok');
  toast(n ? `${label}을(를) 화면에 적용했습니다 (${n}개 변경). Sync to Micro로 저장하세요.` : `${label}과(와) 지금 설정이 같습니다.`, 'ok');
}

function mappingChips(mappings) {
  const keys = document.createElement('div');
  keys.className = 'preset-keys';
  for (const id of [...LEFT_ORDER, ...RIGHT_ORDER]) {
    const raw = mappings[id];
    if (raw.every(v => v === 0)) continue;
    const chip = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = BUTTONS[id].physical;
    chip.append(b, formatMapping(raw));
    keys.appendChild(chip);
  }
  return keys;
}

function actionCard({title, description, mappings, dataset, onApply}) {
  const card = document.createElement('div');
  card.className = 'preset-card';
  const copy = document.createElement('div');
  const h = document.createElement('h3');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = description;
  copy.append(h, p, mappingChips(mappings));
  const apply = document.createElement('button');
  apply.className = 'btn primary';
  apply.textContent = '적용';
  Object.assign(apply.dataset, dataset);
  apply.disabled = !state.draft || state.busy;
  apply.title = state.draft ? '' : '먼저 Micro를 연결해 현재 설정을 읽으세요';
  apply.addEventListener('click', () => guarded(onApply));
  card.append(copy, apply);
  return card;
}

function renderRestore() {
  const host = $('restoreList');
  host.innerHTML = '';
  const original = loadStoredConfig(STORE_ORIGINAL);
  if (original) {
    host.appendChild(actionCard({
      title: '처음 연결했을 때',
      description: `${new Date(original.savedAt).toLocaleString()} 이 브라우저에서 처음 읽은 설정`,
      mappings: configMappings(original.config),
      dataset: {restore: 'original'},
      onApply: () => applyConfigToDraft(original.config, '처음 상태'),
    }));
  }
  for (const backup of listAutomaticBackups()) {
    host.appendChild(actionCard({
      title: 'Sync 직전 자동 백업',
      description: new Date(backup.savedAt).toLocaleString(),
      mappings: configMappings(backup.config),
      dataset: {restore: backup.key},
      onApply: () => applyConfigToDraft(backup.config, '자동 백업'),
    }));
  }
  if (!host.children.length) {
    const empty = document.createElement('div');
    empty.className = 'profile-empty';
    empty.textContent = 'Micro를 한 번 연결하면 처음 상태가 여기 기록됩니다.';
    host.appendChild(empty);
  }
}

// ===== 전체 데이터 내보내기 / 불러오기 =====
const DATA_FORMAT = 'micro-mapper-data-v1';
const DATA_PREFIXES = ['micro-mapper:', '8bitdo-micro-'];
const isDataKey = key => DATA_PREFIXES.some(p => key.startsWith(p));

function exportAllData() {
  const items = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (isDataKey(key)) items[key] = JSON.parse(localStorage.getItem(key));
    }
  } catch (err) {
    throw new Error(`브라우저 저장소를 읽지 못했습니다: ${err.message}`);
  }
  if (!Object.keys(items).length) throw new Error('내보낼 데이터가 없습니다.');
  const stamp = new Date().toISOString().slice(0, 10);
  downloadJson({format: DATA_FORMAT, app: APP_VERSION, exportedAt: new Date().toISOString(), items}, `hachibito-data-${stamp}.json`);
  log(`브라우저 데이터 ${Object.keys(items).length}개 항목을 내보냈습니다.`, 'ok');
}

async function importAllData(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('JSON 파일이 아닙니다.'); }
  if (data?.format !== DATA_FORMAT || typeof data.items !== 'object' || !data.items) {
    throw new Error('Hachibito에서 내보낸 데이터 파일이 아닙니다.');
  }
  const entries = Object.entries(data.items).filter(([key]) => isDataKey(key));
  if (!entries.length) throw new Error('파일에 불러올 항목이 없습니다.');
  if (!confirm(`${entries.length}개 항목을 이 브라우저에 불러옵니다.\n프로필과 백업은 합치고, 나머지 같은 항목은 파일 쪽으로 바꿉니다. 계속할까요?`)) return;

  for (const [key, value] of entries) {
    if (key === '8bitdo-micro-profiles' && Array.isArray(value)) {
      const current = getProfiles();
      const seen = new Set(current.map(p => `${p.name}|${p.createdAt}`));
      storeSet(key, [...current, ...value.filter(p => !seen.has(`${p?.name}|${p?.createdAt}`))]);
    } else if (key === BACKUP_INDEX && Array.isArray(value)) {
      const merged = [...new Set([...(storeGet(key) || []), ...value])].filter(k => typeof k === 'string' && isDataKey(k));
      storeSet(key, merged.sort().reverse());
    } else if (key === STORE_ORIGINAL && loadStoredConfig(STORE_ORIGINAL)) {
      // 처음 상태는 더 오래된 쪽을 남긴다
      const mine = storeGet(STORE_ORIGINAL);
      if (value?.savedAt && value.savedAt < mine.savedAt) storeSet(key, value);
    } else {
      storeSet(key, value);
    }
  }
  const cached = loadCachedConfig();
  if (!state.draft) state.cached = cached ? cached.config : null;
  renderMappings();
  renderProfiles();
  renderRestore();
  refreshPendingBanner();
  refreshStorageUI();
  log(`데이터 파일에서 ${entries.length}개 항목을 불러왔습니다.`, 'ok');
  toast('데이터를 불러왔습니다.', 'ok');
}


// One capture-phase handler owns every mapping-row click. It never returns
// silently: if the editor can't open, the user is told why.
function requestEditor(id, via) {
  if (!BUTTONS[id]) return;
  if (!state.draft) {
    log(`편집 불가 (${BUTTONS[id].physical}): 아직 Micro 설정을 읽지 않았습니다.`);
    toast('먼저 “Micro 연결”로 현재 설정을 읽어야 편집할 수 있습니다.', 'info');
    return;
  }
  if (state.busy) {
    log(`편집 불가 (${BUTTONS[id].physical}): 다른 작업 진행 중`);
    toast('작업이 끝난 뒤 다시 눌러주세요.', 'info');
    return;
  }
  if (isModalOpen()) return;
  log(`편집창 열기${via ? `(${via})` : ''}: ${BUTTONS[id].physical}`);
  openMappingModal(id);
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const row = target.closest('.mapping-row, #controllerSvg .hw');
  if (!row) return;
  event.preventDefault();
  requestEditor(row.dataset.button);
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const row = target.closest('.mapping-row');
  if (!row) return;
  event.preventDefault();
  requestEditor(row.dataset.button, '키보드');
}, true);

function isModalOpen() {
  return !$('mappingModal').classList.contains('hidden');
}

function populateKeySelect() {
  const select = $('keySelect');
  select.innerHTML = '';
  for (const [code,name] of SELECTABLE_KEYS) {
    const opt = document.createElement('option');
    opt.value = String(code);
    opt.textContent = name;
    select.appendChild(opt);
  }
}

function openMappingModal(id) {
  if (!state.draft) return;
  state.modalButton = id;
  state.captureActive = false;
  const raw = mappingBytes(state.draft, id);
  const decoded = decodeEditor(raw);
  $('modalTitle').textContent = BUTTONS[id].physical;
  $('modalCurrent').textContent = formatMapping(raw);
  $('modalRaw').textContent = raw.map(v => v.toString(16).padStart(2,'0')).join(' ');
  $('keySelect').value = String(decoded.key);
  // key not in the list (unknown HID) → leave select on "Disabled" but the raw
  // bytes are kept unless the user actually changes something (see applyModal).
  if ($('keySelect').value === '') $('keySelect').value = '0';
  $('modCtrl').checked = decoded.mods.ctrl;
  $('modShift').checked = decoded.mods.shift;
  $('modAlt').checked = decoded.mods.alt;
  $('modMeta').checked = decoded.mods.meta;
  state.modalSnapshot = modalFormSnapshot();
  $('captureButton').classList.remove('listening');
  $('captureHint').textContent = '클릭한 뒤 키보드에서 예: Ctrl + S';
  $('mappingModal').classList.remove('hidden');
  // Move focus into the dialog so Enter/Space can't re-trigger the row behind it.
  $('keySelect').focus();
  log(`매핑 편집 모달 표시됨: ${BUTTONS[id].physical}`, 'ok');
}

function closeMappingModal() {
  const id = state.modalButton;
  state.captureActive = false;
  state.modalButton = null;
  state.modalSnapshot = null;
  $('mappingModal').classList.add('hidden');
  $('captureButton').classList.remove('listening');
  document.querySelector(`.mapping-row[data-button="${id}"]`)?.focus();
}

function modalFormSnapshot() {
  return ['keySelect','modCtrl','modShift','modAlt','modMeta']
    .map(id => $(id).type === 'checkbox' ? $(id).checked : $(id).value).join('|');
}

function applyModal() {
  const id = state.modalButton;
  if (!id || !state.draft) return;
  // Untouched editor → keep the original 4 bytes verbatim, so unknown HID codes,
  // multi-key chords and right-side modifiers are never flattened to our format.
  if (modalFormSnapshot() === state.modalSnapshot) {
    closeMappingModal();
    return;
  }
  const mods = {
    ctrl: $('modCtrl').checked,
    shift: $('modShift').checked,
    alt: $('modAlt').checked,
    meta: $('modMeta').checked
  };
  setDraftMapping(id, encodeEditor(Number($('keySelect').value), mods));
  state.verified = false;
  closeMappingModal();
  renderMappings();
  persistDraft();
}

function disableModalMapping() {
  if (!state.modalButton || !state.draft) return;
  setDraftMapping(state.modalButton, [0,0,0,0]);
  state.verified = false;
  closeMappingModal();
  renderMappings();
  persistDraft();
}

// ===== protocol =====
function crc16(data) {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit=0; bit<8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xa001 : 0);
    }
  }
  return crc & 0xffff;
}

function buildWritePage(offset, payload) {
  if (!PAGE_OFFSETS.includes(offset) || payload.length !== PAGE_LENGTH) {
    throw new Error('Invalid write page');
  }
  const out = new Uint8Array(WRITE_PACKET_LENGTH);
  const view = new DataView(out.buffer);
  out[0] = 0x04;
  out[1] = 0x01;
  out[5] = PAGE_LENGTH;
  view.setUint16(7, crc16(payload), true);
  out[9] = CONFIG_LENGTH;
  view.setUint32(13, offset, true);
  out.set(payload, 17);
  return out;
}

function buildReadRequest(offset) {
  const out = buildWritePage(offset, new Uint8Array(PAGE_LENGTH));
  out[1] = 0x02;
  return out;
}

function parseConfigNotification(packet) {
  if (packet.length < 3 || packet[0] !== 0x04 || packet[1] !== 0x00 || packet[2] !== 0x02) return null;
  if (packet.length !== READ_RESPONSE_LENGTH) throw new Error(`설정 응답 길이가 ${packet.length}B입니다. 예상값은 61B입니다.`);
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (packet[3] !== 0 || view.getUint16(4,true) !== PAGE_LENGTH || view.getUint32(8,true) !== CONFIG_LENGTH) {
    throw new Error('설정 응답 헤더 형식이 예상과 다릅니다.');
  }
  const offset = view.getUint32(12,true);
  if (!PAGE_OFFSETS.includes(offset)) throw new Error(`알 수 없는 설정 페이지 offset: 0x${offset.toString(16)}`);
  const payload = packet.slice(16);
  const expected = view.getUint16(6,true);
  const actual = crc16(payload);
  if (expected !== actual) throw new Error(`CRC 오류: page 0x${offset.toString(16)} / device=${expected.toString(16)} calc=${actual.toString(16)}`);
  return {offset, payload};
}

function assemblePages(pages) {
  const out = new Uint8Array(CONFIG_LENGTH);
  for (const offset of PAGE_OFFSETS) {
    const page = pages.get(offset);
    if (!page) throw new Error(`설정 페이지 0x${offset.toString(16)} 누락`);
    out.set(page, offset);
  }
  return out;
}

// ===== Web Bluetooth transport =====
function onGattDisconnected() {
  state.connected = false;
  state.service = null;
  state.writeChar = null;
  state.notifyChar = null;
  state.notificationQueue = [];
  while (state.notificationWaiters.length) {
    const waiter = state.notificationWaiters.shift();
    waiter.reject(new Error('Bluetooth 연결이 끊어졌습니다.'));
  }
  state.verified = false;
  refreshConnectionUI();
  renderMappings();

  if (state.connectingRetry) {
    setControllerStatus('초기 BLE 연결 재시도 중…', 'busy');
    log('초기 GATT 연결이 잠깐 끊어졌습니다. 자동 재시도합니다.');
  } else {
    setControllerStatus('Bluetooth 연결이 끊어졌습니다', 'error');
    log('GATT 연결이 끊어졌습니다.', 'error');
  }
}

function characteristicProps(c) {
  const p = c.properties;
  return {
    read: !!p.read,
    write: !!p.write,
    writeWithoutResponse: !!p.writeWithoutResponse,
    notify: !!p.notify,
    indicate: !!p.indicate
  };
}

async function discoverCharacteristics(service) {
  const chars = await service.getCharacteristics();
  if (!chars.length) throw new Error('FF10 서비스 안에 characteristic이 없습니다.');

  for (const c of chars) {
    const p = characteristicProps(c);
    log(`Characteristic ${shortUuid(c.uuid)} props=${JSON.stringify(p)}`);
  }

  const preferred = preferredUuid =>
    chars.find(c => c.uuid.toLowerCase() === preferredUuid.toLowerCase());

  let main = null;
  for (const uuid of PREFERRED_CHARACTERISTICS) {
    const c = preferred(uuid);
    if (c) { main = c; break; }
  }

  let writeChar = null;
  let notifyChar = null;

  if (main) {
    const p = characteristicProps(main);
    if (p.write || p.writeWithoutResponse) writeChar = main;
    if (p.notify || p.indicate) notifyChar = main;
  }

  if (!writeChar) writeChar = chars.find(c => c.properties.write) || chars.find(c => c.properties.writeWithoutResponse) || null;
  if (!notifyChar) notifyChar = chars.find(c => c.properties.notify) || chars.find(c => c.properties.indicate) || null;

  if (!writeChar) throw new Error('FF10 서비스에서 쓰기 가능한 characteristic을 찾지 못했습니다.');
  if (!notifyChar) throw new Error('FF10 서비스에서 notification 가능한 characteristic을 찾지 못했습니다.');

  log(`선택된 Write characteristic: ${writeChar.uuid}`, 'ok');
  log(`선택된 Notify characteristic: ${notifyChar.uuid}`, 'ok');
  return {writeChar, notifyChar};
}

function onNotification(event) {
  const view = event.target.value;
  if (!view) return;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();

  if (state.notificationWaiters.length) {
    const waiter = state.notificationWaiters.shift();
    waiter.resolve(bytes);
  } else {
    state.notificationQueue.push(bytes);
  }
}

function nextNotification(timeout=2200) {
  if (state.notificationQueue.length) return Promise.resolve(state.notificationQueue.shift());

  return new Promise((resolve,reject)=>{
    const entry = {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: err => { clearTimeout(timer); reject(err); }
    };
    const timer = setTimeout(()=>{
      const i = state.notificationWaiters.indexOf(entry);
      if (i >= 0) state.notificationWaiters.splice(i,1);
      reject(new Error('Notification timeout'));
    }, timeout);
    state.notificationWaiters.push(entry);
  });
}

async function waitForPage(offset, timeout=3200) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remain = Math.max(1, deadline - Date.now());
    const packet = await nextNotification(remain);
    const page = parseConfigNotification(packet);
    if (!page) {
      log(`관련 없는 notification ${packet.length}B 수신`);
      continue;
    }
    if (page.offset !== offset) {
      log(`page 0x${page.offset.toString(16)} 수신 (대기 중 0x${offset.toString(16)})`);
      // keep it for the next stage only if the offset is a later page
      state.notificationQueue.push(packet);
      await sleep(10);
      continue;
    }
    return page.payload;
  }
  throw new Error(`page 0x${offset.toString(16)} read timeout`);
}

async function writePacket(packet, label='packet') {
  if (!state.connected || !state.writeChar) throw new Error('Micro가 연결되어 있지 않습니다.');
  const data = Uint8Array.from(packet);
  log(`${label} 전송 (${data.length}B)`);

  if (state.writeChar.properties.write && typeof state.writeChar.writeValueWithResponse === 'function') {
    await state.writeChar.writeValueWithResponse(data);
  } else if (typeof state.writeChar.writeValueWithoutResponse === 'function') {
    await state.writeChar.writeValueWithoutResponse(data);
  } else {
    await state.writeChar.writeValue(data);
  }
}

async function connectGattForDevice(device) {
  if (!device?.gatt) throw new Error('이 장치에서 GATT를 사용할 수 없습니다.');

  state.connectingRetry = true;
  let lastError = null;

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        setControllerStatus(`GATT 연결 중… ${attempt}/3`, 'busy');

        if (!device.gatt.connected) {
          await device.gatt.connect();
        }

        // Windows BLE sometimes reports connected before the service table is ready.
        // A short settle delay + retry prevents the "connected then immediately
        // disconnected" first-attempt failure seen on the test machine.
        await sleep(attempt === 1 ? 700 : 1000);

        if (!device.gatt.connected) {
          throw new Error('GATT가 서비스 탐색 전에 끊어졌습니다.');
        }

        log(`GATT 연결 성공 (${attempt}/3). FF10 서비스 탐색 중…`);

        const server = device.gatt;
        const service = await server.getPrimaryService(SERVICE_UUID);
        const {writeChar, notifyChar} = await discoverCharacteristics(service);

        notifyChar.removeEventListener?.('characteristicvaluechanged', onNotification);
        notifyChar.addEventListener('characteristicvaluechanged', onNotification);
        await notifyChar.startNotifications();

        state.service = service;
        state.writeChar = writeChar;
        state.notifyChar = notifyChar;
        state.connected = true;
        state.notificationQueue = [];

        log(`Notification 구독 완료 (${shortUuid(notifyChar.uuid)})`, 'ok');
        refreshConnectionUI();
        return;
      } catch (err) {
        lastError = err;
        state.connected = false;
        state.service = null;
        state.writeChar = null;
        state.notifyChar = null;

        log(`GATT 초기 연결 ${attempt}/3 실패: ${err.message || err}`, attempt === 3 ? 'error' : 'info');

        try {
          if (device.gatt.connected) device.gatt.disconnect();
        } catch {}

        if (attempt < 3) {
          setControllerStatus(`BLE 자동 재시도 ${attempt + 1}/3…`, 'busy');
          await sleep(750);
        }
      }
    }

    throw lastError || new Error('GATT 연결에 실패했습니다.');
  } finally {
    state.connectingRetry = false;
  }
}

async function connectAndRead() {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth를 사용할 수 없습니다. Windows의 최신 Chrome 또는 Edge에서 start.bat로 실행하세요.');
  }

  setBusy(true, 'Bluetooth 장치를 선택하세요…');
  try {
    log('Bluetooth chooser를 엽니다. 80EL / 8BitDo Micro를 선택하세요.');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{name: DEVICE_NAME}, {namePrefix:'8BitDo'}],
      optionalServices: [SERVICE_UUID]
    });

    if (state.device && state.device !== device) {
      state.device.removeEventListener('gattserverdisconnected', onGattDisconnected);
    }

    state.device = device;
    device.removeEventListener('gattserverdisconnected', onGattDisconnected);
    device.addEventListener('gattserverdisconnected', onGattDisconnected);

    log(`선택됨: ${device.name || '(이름 없음)'}`);
    setControllerStatus('GATT 연결 중…', 'busy');
    await connectGattForDevice(device);

    setControllerStatus('현재 설정 읽는 중…', 'busy');
    const config = await readFullConfig();
    setLoadedConfig(config);
    toast('Micro 연결 및 현재 매핑 읽기 완료', 'ok');
  } catch (err) {
    setControllerStatus(err.message || String(err), 'error');
    log(`${err.name || 'Error'}: ${err.message || err}`, 'error');
    throw err;
  } finally {
    setBusy(false);
  }
}

async function reconnectKnownDevice() {
  if (!state.device) throw new Error('다시 연결할 장치 정보가 없습니다.');
  for (let attempt=1; attempt<=3; attempt++) {
    try {
      log(`재연결 시도 ${attempt}/3…`);
      await connectGattForDevice(state.device);
      log('재연결 성공', 'ok');
      return;
    } catch (err) {
      log(`재연결 ${attempt}/3 실패: ${err.message}`, 'error');
      await sleep(650);
    }
  }
  throw new Error('Micro 재연결에 실패했습니다. 연결 버튼을 다시 눌러주세요.');
}

async function readFullConfig() {
  if (!state.connected) throw new Error('Micro가 연결되어 있지 않습니다.');
  state.notificationQueue = [];
  const pages = new Map();

  for (let i=0;i<LOAD_PREAMBLE.length;i++) {
    await writePacket(LOAD_PREAMBLE[i], `Load preamble ${i+1}/4`);
    await sleep(180);
  }

  for (let i=0;i<PAGE_OFFSETS.length;i++) {
    const offset = PAGE_OFFSETS[i];
    setControllerStatus(`설정 읽는 중 ${i+1}/4…`, 'busy');
    await writePacket(buildReadRequest(offset), `Read page 0x${offset.toString(16).padStart(2,'0')}`);
    const payload = await waitForPage(offset, 4200);
    pages.set(offset, payload);
    log(`page 0x${offset.toString(16).padStart(2,'0')} CRC OK`, 'ok');
    await sleep(150);
  }

  const config = assemblePages(pages);
  log(`전체 설정 ${config.length}B 읽기 완료`, 'ok');
  return config;
}

function setLoadedConfig(config, verified=false) {
  state.baseline = copyBytes(config);
  state.draft = copyBytes(config);
  state.dirtyButtons.clear();
  state.sleepDirty = false;
  state.verified = verified;
  state.cached = copyBytes(config);
  rememberConfig(config);
  rememberOriginal(config);
  renderMappings();
  renderProfiles();
  renderPresets();
  renderRestore();
  refreshPendingBanner();
  refreshStorageUI();
  setControllerStatus(verified ? '저장 후 검증 완료 ✓' : '현재 매핑 로드 완료 · 줄이나 버튼을 눌러 편집', 'ok');
  refreshConnectionUI();
  if (!verified) toast('바꾸고 싶은 버튼의 줄이나 컨트롤러 그림의 버튼을 누르세요.', 'ok', 5200);
}

async function rereadCurrent() {
  if (!state.connected) throw new Error('먼저 Micro를 연결하세요.');
  setBusy(true, '현재 설정 다시 읽는 중…');
  try {
    const config = await readFullConfig();
    setLoadedConfig(config, false);
    toast('현재 매핑을 다시 읽었습니다.', 'ok');
  } finally {
    setBusy(false);
  }
}

// ===== save workflow =====
function storeAutomaticBackup(raw) {
  const key = `8bitdo-micro-backup-${Date.now()}`;
  const entry = {
    version: 2,
    createdAt: new Date().toISOString(),
    raw: Array.from(raw)
  };
  localStorage.setItem(key, JSON.stringify(entry));

  const index = JSON.parse(localStorage.getItem('8bitdo-micro-backup-index') || '[]');
  index.unshift(key);
  while (index.length > 12) {
    const old = index.pop();
    localStorage.removeItem(old);
  }
  localStorage.setItem('8bitdo-micro-backup-index', JSON.stringify(index));
  return key;
}

function buildExpectedFromFresh(fresh) {
  const expected = copyBytes(fresh);
  for (const id of state.dirtyButtons) {
    const b = BUTTONS[id];
    expected.set(state.draft.slice(b.offset,b.offset+4), b.offset);
  }
  if (state.sleepDirty) expected[DISABLE_SLEEP_OFFSET] = state.draft[DISABLE_SLEEP_OFFSET];
  return expected;
}

function summarizeChanges(expected, fresh) {
  const lines = [];
  for (const [id,b] of Object.entries(BUTTONS)) {
    const before = Array.from(fresh.slice(b.offset,b.offset+4));
    const after = Array.from(expected.slice(b.offset,b.offset+4));
    if (!before.every((v,i)=>v===after[i])) {
      lines.push(`${b.physical}: ${formatMapping(before)} → ${formatMapping(after)}`);
    }
  }
  if (fresh[DISABLE_SLEEP_OFFSET] !== expected[DISABLE_SLEEP_OFFSET]) {
    lines.push(`Disable sleep: ${fresh[DISABLE_SLEEP_OFFSET] ? 'ON' : 'OFF'} → ${expected[DISABLE_SLEEP_OFFSET] ? 'ON' : 'OFF'}`);
  }
  return lines;
}

async function syncToMicro() {
  if (!state.connected || !state.baseline || !state.draft) throw new Error('먼저 Micro를 연결하고 현재 설정을 읽으세요.');
  if (!isDirty()) return;

  setBusy(true, '저장 전 최신 설정 확인 중…');
  try {
    const fresh = await readFullConfig();

    if (!equalBytes(fresh, state.baseline)) {
      throw new Error('편집을 시작한 뒤 Micro의 설정이 바뀌었습니다. 안전을 위해 저장을 중단했습니다. “다시 읽기” 후 다시 수정하세요.');
    }

    const expected = buildExpectedFromFresh(fresh);
    const changes = summarizeChanges(expected, fresh);
    if (!changes.length) {
      setLoadedConfig(fresh);
      return;
    }

    const backupKey = storeAutomaticBackup(fresh);
    log(`저장 전 자동 백업 생성: ${backupKey}`, 'ok');

    const ok = confirm(
      `다음 ${changes.length}개 변경을 Micro에 저장합니다.\n\n` +
      changes.join('\n') +
      '\n\n저장 중에는 Micro 전원을 끄지 마세요. 계속할까요?'
    );
    if (!ok) {
      setControllerStatus('저장 취소됨', '');
      return;
    }

    for (let i=0;i<PAGE_OFFSETS.length;i++) {
      const offset = PAGE_OFFSETS[i];
      setControllerStatus(`저장 중 ${i+1}/4…`, 'busy');
      const page = expected.slice(offset, offset + PAGE_LENGTH);
      await writePacket(buildWritePage(offset,page), `Write page 0x${offset.toString(16).padStart(2,'0')}`);
      await sleep(120);
    }

    setControllerStatus('Commit…', 'busy');
    await writePacket(COMMIT_PACKET, 'Commit');
    log('Commit 전송 완료', 'ok');
    await sleep(650);

    if (!state.connected || !state.writeChar) {
      setControllerStatus('검증을 위해 재연결 중…', 'busy');
      await reconnectKnownDevice();
    }

    setControllerStatus('저장 결과 검증 중…', 'busy');
    const actual = await readFullConfig();

    if (!equalBytes(actual, expected, 2)) {
      const diffs = [];
      for (let i=2;i<CONFIG_LENGTH;i++) if (actual[i] !== expected[i]) diffs.push(i);
      throw new Error(`저장 후 검증 실패: ${diffs.length}바이트가 다릅니다. offsets=${diffs.slice(0,20).join(',')}`);
    }

    if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
      log('Commit 후 기기가 설정의 앞 2바이트를 갱신했습니다. 나머지 178바이트는 일치합니다.');
    }

    storeSet(STORE_PENDING, null);
    setLoadedConfig(actual, true);
    toast('Micro에 저장하고 다시 읽어서 검증까지 완료했습니다.', 'ok', 5000);
    log('저장 + readback verification 완료', 'ok');
  } catch (err) {
    setControllerStatus('저장/검증 실패', 'error');
    log(`저장 실패: ${err.message || err}`, 'error');
    toast(err.message || String(err), 'error', 6000);
    throw err;
  } finally {
    setBusy(false);
  }
}

function resetDraft() {
  if (!state.baseline) return;
  state.draft = copyBytes(state.baseline);
  state.dirtyButtons.clear();
  state.sleepDirty = false;
  state.verified = false;
  renderMappings();
  persistDraft();
  setControllerStatus('변경사항을 원래 값으로 되돌렸습니다', '');
}

// ===== profiles / backups =====
function getProfiles() {
  try { return JSON.parse(localStorage.getItem('8bitdo-micro-profiles') || '[]'); }
  catch { return []; }
}

function saveProfiles(profiles) {
  localStorage.setItem('8bitdo-micro-profiles', JSON.stringify(profiles));
}

function profileFromDraft(name) {
  if (!state.draft) throw new Error('저장할 현재 구성이 없습니다.');
  const mappings = {};
  for (const [id,b] of Object.entries(BUTTONS)) mappings[id] = Array.from(state.draft.slice(b.offset,b.offset+4));
  return {
    format:'8bitdo-micro-web-profile-v2',
    name,
    createdAt:new Date().toISOString(),
    mappings,
    disableSleep: [0,1].includes(state.draft[DISABLE_SLEEP_OFFSET]) ? !!state.draft[DISABLE_SLEEP_OFFSET] : null
  };
}

function validateProfile(p) {
  if (!p || p.format !== '8bitdo-micro-web-profile-v2' || !p.mappings) throw new Error('지원하지 않는 프로필 파일입니다.');
  for (const id of Object.keys(BUTTONS)) {
    const raw = p.mappings[id];
    if (!Array.isArray(raw) || raw.length !== 4 || raw.some(v=>!Number.isInteger(v) || v<0 || v>255)) {
      throw new Error(`${id} 매핑 형식이 올바르지 않습니다.`);
    }
  }
  return p;
}

function applyProfile(profile) {
  if (!state.draft || !state.baseline) throw new Error('먼저 Micro에서 현재 설정을 읽어야 프로필을 적용할 수 있습니다.');
  validateProfile(profile);
  for (const id of Object.keys(BUTTONS)) setDraftMapping(id, profile.mappings[id]);
  if (profile.disableSleep !== null && [0,1].includes(state.baseline[DISABLE_SLEEP_OFFSET])) {
    state.draft[DISABLE_SLEEP_OFFSET] = profile.disableSleep ? 1 : 0;
    state.sleepDirty = state.draft[DISABLE_SLEEP_OFFSET] !== state.baseline[DISABLE_SLEEP_OFFSET];
  }
  state.verified = false;
  setTab('buttons');
  renderMappings();
  persistDraft();
  refreshPendingBanner();
  toast(`프로필 “${profile.name || 'Imported'}”을 로컬 draft에 적용했습니다. 아직 Micro에는 저장되지 않았습니다.`, 'ok');
}

function renderProfiles() {
  const host = $('profilesList');
  const profiles = getProfiles();
  host.innerHTML = '';
  if (!profiles.length) {
    const empty = document.createElement('div');
    empty.className = 'profile-empty';
    empty.textContent = '저장된 로컬 프로필이 없습니다.';
    host.appendChild(empty);
    return;
  }

  profiles.forEach((p,index)=>{
    const row = document.createElement('div');
    row.className = 'profile-item';
    const copy = document.createElement('div');
    copy.innerHTML = `<strong></strong><small></small>`;
    copy.querySelector('strong').textContent = p.name || `Profile ${index+1}`;
    copy.querySelector('small').textContent = new Date(p.createdAt).toLocaleString();

    const actions = document.createElement('div');
    actions.className = 'actions';

    const apply = document.createElement('button');
    apply.className = 'compact-button';
    apply.textContent = '적용';
    apply.disabled = !state.draft;
    apply.addEventListener('click',()=>guarded(()=>applyProfile(p)));

    const del = document.createElement('button');
    del.className = 'compact-button';
    del.textContent = '삭제';
    del.addEventListener('click',()=>{
      const next = getProfiles();
      next.splice(index,1);
      saveProfiles(next);
      renderProfiles();
    });

    actions.append(apply,del);
    row.append(copy,actions);
    host.appendChild(row);
  });
}

function saveCurrentProfile() {
  if (!state.draft) throw new Error('먼저 Micro를 연결해 현재 구성을 읽으세요.');
  const name = prompt('프로필 이름', `Micro ${new Date().toLocaleDateString()}`);
  if (!name) return;
  const profiles = getProfiles();
  profiles.unshift(profileFromDraft(name.trim()));
  saveProfiles(profiles.slice(0,20));
  renderProfiles();
  refreshStorageUI();
  toast('브라우저에 프로필을 저장했습니다.', 'ok');
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function exportCurrentProfile() {
  const profile = profileFromDraft(`Micro profile ${new Date().toLocaleDateString()}`);
  downloadJson(profile, `8bitdo-micro-profile-${Date.now()}.json`);
}

function downloadRawBackup() {
  if (!state.baseline) throw new Error('백업할 설정이 없습니다.');
  downloadJson({
    format:'8bitdo-micro-raw-backup-v2',
    createdAt:new Date().toISOString(),
    length:state.baseline.length,
    raw:Array.from(state.baseline)
  }, `8bitdo-micro-raw-${Date.now()}.json`);
}

// ===== capture =====
function handleCaptureKeydown(event) {
  if (!state.captureActive) return;
  event.preventDefault();
  event.stopPropagation();

  const pureModifier = ['ControlLeft','ControlRight','ShiftLeft','ShiftRight','AltLeft','AltRight','MetaLeft','MetaRight'].includes(event.code);
  if (pureModifier) {
    $('captureHint').textContent = 'modifier 감지됨 — 같이 사용할 키를 누르세요';
    return;
  }

  const hid = CODE_TO_HID.get(event.code);
  if (!hid) {
    $('captureHint').textContent = `지원하지 않는 키: ${event.code}`;
    return;
  }

  $('keySelect').value = String(hid);
  $('modCtrl').checked = event.ctrlKey;
  $('modShift').checked = event.shiftKey;
  $('modAlt').checked = event.altKey;
  $('modMeta').checked = event.metaKey;
  state.captureActive = false;
  $('captureButton').classList.remove('listening');

  const raw = encodeEditor(hid,{
    ctrl:event.ctrlKey, shift:event.shiftKey, alt:event.altKey, meta:event.metaKey
  });
  $('captureHint').textContent = `감지됨: ${formatMapping(raw)}`;
}

// ===== errors / actions =====
async function guarded(fn) {
  try { return await fn(); }
  catch (err) {
    if (err?.name === 'NotFoundError' && String(err.message).includes('Bluetooth')) {
      // Browser chooser cancellation often arrives as NotFoundError.
      log('Bluetooth 장치 선택이 취소되었습니다.');
      return;
    }
    log(`${err?.name || 'Error'}: ${err?.message || err}`, 'error');
    toast(err?.message || String(err), 'error', 5200);
  }
}

function disconnectManual() {
  if (state.device) {
    state.device.removeEventListener('gattserverdisconnected', onGattDisconnected);
    try { state.device.gatt?.disconnect(); } catch {}
  }
  state.device = null;
  state.service = null;
  state.writeChar = null;
  state.notifyChar = null;
  state.connected = false;
  state.baseline = null;
  state.draft = null;
  state.dirtyButtons.clear();
  state.sleepDirty = false;
  state.verified = false;
  renderMappings();
  renderPresets();
  renderRestore();
  refreshPendingBanner();
  refreshConnectionUI();
  setControllerStatus('연결 후 현재 매핑을 읽습니다', '');
  log('사용자가 장치 연결을 해제했습니다.');
}

// ===== event wiring =====
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click',()=>setTab(btn.dataset.tab)));
$('connectButton').addEventListener('click',()=>guarded(connectAndRead));
$('deviceButton').addEventListener('click',()=>{
  if (state.connected) {
    if (confirm('Micro 연결을 해제할까요?')) disconnectManual();
  } else guarded(connectAndRead);
});
$('readButton').addEventListener('click',()=>guarded(rereadCurrent));
$('syncButton').addEventListener('click',()=>guarded(syncToMicro));
$('resetDraftButton').addEventListener('click',resetDraft);

$('modalClose').addEventListener('click',closeMappingModal);
$('modalCancel').addEventListener('click',closeMappingModal);
$('modalApply').addEventListener('click',()=>guarded(async()=>applyModal()));
$('disableMappingButton').addEventListener('click',disableModalMapping);
$('mappingModal').addEventListener('click',e=>{ if (e.target === $('mappingModal')) closeMappingModal(); });
$('captureButton').addEventListener('click',()=>{
  state.captureActive = true;
  $('captureButton').classList.add('listening');
  $('captureHint').textContent = '지금 원하는 키 조합을 누르세요…';
  window.focus();
});
window.addEventListener('keydown',handleCaptureKeydown,true);
window.addEventListener('keydown',e=>{ if (e.key === 'Escape' && !$('mappingModal').classList.contains('hidden') && !state.captureActive) closeMappingModal(); });

for (const toggle of ['sleepToggle', 'stageSleepToggle']) {
  $(toggle).addEventListener('change', e => {
    if (!state.draft || !state.baseline) return;
    state.draft[DISABLE_SLEEP_OFFSET] = e.target.checked ? 1 : 0;
    state.sleepDirty = state.draft[DISABLE_SLEEP_OFFSET] !== state.baseline[DISABLE_SLEEP_OFFSET];
    state.verified = false;
    renderMappings();
    persistDraft();
  });
}
$('pendingRestore').addEventListener('click', restorePending);
$('pendingDiscard').addEventListener('click', discardPending);
$('clearStorageButton').addEventListener('click', clearStoredData);
$('exportDataButton').addEventListener('click', () => guarded(async () => exportAllData()));
$('importDataInput').addEventListener('change', e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) guarded(() => importAllData(file));
});

$('newProfileButton').addEventListener('click',()=>guarded(async()=>saveCurrentProfile()));
$('profileExportButton').addEventListener('click',()=>guarded(async()=>exportCurrentProfile()));
$('rawBackupButton').addEventListener('click',()=>guarded(async()=>downloadRawBackup()));
$('profileImportInput').addEventListener('change',e=>{
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  guarded(async()=>{
    const profile = validateProfile(JSON.parse(await file.text()));
    applyProfile(profile);
  });
});
$('copyLogButton').addEventListener('click',()=>guarded(async()=>{
  await navigator.clipboard.writeText($('log').textContent);
  toast('로그를 클립보드에 복사했습니다.', 'ok');
}));

// ===== init =====
populateKeySelect();
{
  const cached = loadCachedConfig();
  if (cached) state.cached = cached.config;
  const tab = storeGet(STORE_TAB);
  if (['buttons','profile','settings'].includes(tab)) setTab(tab);
  if (cached) setControllerStatus(`마지막으로 읽은 매핑 (${new Date(cached.savedAt).toLocaleDateString()}) · 연결하면 최신 값을 읽습니다`);
}
renderMappings();
renderProfiles();
renderPresets();
renderRestore();
refreshStorageUI();
refreshConnectionUI();

if (!navigator.bluetooth) {
  setControllerStatus('Web Bluetooth 미지원 브라우저', 'error');
  log('navigator.bluetooth가 없습니다. 최신 Chrome/Edge를 사용하세요.', 'error');
}
if (!window.isSecureContext) {
  setControllerStatus('localhost/HTTPS로 열어야 합니다', 'error');
  log('Secure Context가 아닙니다. index.html 직접 실행 대신 start.bat를 사용하세요.', 'error');
}

log(`Hachibito v${APP_VERSION} 준비됨.`);
log('Micro를 K 모드로 두고 “Micro 연결”을 누르세요.');
