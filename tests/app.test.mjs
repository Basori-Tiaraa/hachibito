// UI + 저장 흐름 회귀 테스트. 실제 Micro 대신 dev/mock-device.js 를 쓴다.
// 실행: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from './static-server.mjs';

let server, browser, base;

before(async () => {
  server = await startServer(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  // 실제 대상인 Edge/Chrome을 우선 사용하고, 없으면 Playwright 번들 Chromium
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { browser = await chromium.launch({ channel }); break; } catch (e) { if (!channel) throw e; }
  }
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(mock = '1') {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e));
  page.on('dialog', d => d.accept()); // 저장 확인 confirm()
  await page.goto(`${base}?mock=${mock}`);
  page.errors = errors;
  return page;
}

async function connect(page) {
  await page.click('#connectButton');
  await page.waitForFunction(() => document.querySelector('#log').textContent.includes('전체 설정 180B 읽기 완료'), null, { timeout: 15000 });
  await page.waitForFunction(() => !document.body.classList.contains('busy'));
}

const logText = page => page.textContent('#log');
const modalVisible = page => page.isVisible('#mappingModal');

test('protocol: CRC 검증 벡터와 read request 레이아웃', async () => {
  const page = await open();
  const r = await page.evaluate(() => ({
    crc: crc16(new Uint8Array(45)),
    req: Array.from(buildReadRequest(0x2d).slice(0, 17)),
    len: buildReadRequest(0).length,
  }));
  assert.equal(r.crc, 0xcf30);
  assert.equal(r.len, 62);
  assert.deepEqual(r.req, [0x04,0x02,0,0,0,0x2d,0,0x30,0xcf,0xb4,0,0,0,0x2d,0,0,0]);
  await page.close();
});

test('읽기 전 클릭: 모달은 안 열리고 이유가 로그에 남는다', async () => {
  const page = await open();
  // 행이 aria-disabled 라 Playwright는 기본적으로 안 누른다. 실제 마우스처럼 강제 클릭.
  await page.click('.mapping-row[data-button="l2"]', { force: true });
  assert.equal(await modalVisible(page), false);
  assert.match(await logText(page), /편집 불가 \(L2\)/);
  await page.close();
});

test('연결 → 실기기와 같은 read 순서 → L2/A/X 클릭 시 모달이 열린다', async () => {
  const page = await open();
  await connect(page);
  const log = await logText(page);
  for (const line of ['선택됨: 80EL', 'Notification 구독 완료 (FF13)', 'Load preamble 4/4',
                      'page 0x00 CRC OK', 'page 0x2d CRC OK', 'page 0x5a CRC OK', 'page 0x87 CRC OK']) {
    assert.ok(log.includes(line), `로그에 "${line}" 없음`);
  }

  // 물리 버튼 이름, 매핑 값 텍스트, 연결선 — 행의 어느 부분을 눌러도 열려야 한다
  const targets = [['l2', '.mapping-physical', 'L2'], ['a', '.mapping-value', 'A'], ['x', '.connector', 'X']];
  for (const [id, part, label] of targets) {
    await page.click(`.mapping-row[data-button="${id}"] ${part}`);
    assert.equal(await modalVisible(page), true, `${label} 클릭 후 모달이 안 보임`);
    assert.equal(await page.textContent('#modalTitle'), label);
    const l = await logText(page);
    assert.ok(l.includes(`편집창 열기: ${label}`));
    assert.ok(l.includes(`매핑 편집 모달 표시됨: ${label}`));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'keySelect');
    await page.click('#modalCancel');
    assert.equal(await modalVisible(page), false);
  }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('키보드 Enter로도 열리고, 모달 안에서 Space를 눌러도 편집값이 초기화되지 않는다', async () => {
  const page = await open();
  await connect(page);
  await page.focus('.mapping-row[data-button="b"]');
  await page.keyboard.press('Enter');
  assert.equal(await modalVisible(page), true);
  // 포커스를 옮기지 않고 값만 바꾼 뒤 Space — 포커스가 뒤쪽 행에 남아 있으면 모달이 다시 열리며 초기화된다
  await page.evaluate(() => { document.getElementById('modCtrl').checked = true; });
  await page.keyboard.press('Space');
  assert.equal(await page.isChecked('#modCtrl'), true);
  await page.close();
});

test('변경 없이 "적용"하면 알 수 없는 HID 바이트를 보존한다', async () => {
  const page = await open();
  await connect(page);
  await page.click('.mapping-row[data-button="star"]');
  assert.equal(await page.textContent('#modalRaw'), 'e4 99 00 00');
  await page.click('#modalApply');
  const dirty = await page.evaluate(() => [...state.dirtyButtons]);
  assert.deepEqual(dirty, []);
  await page.close();
});

test('L2 → F12 저장: 4페이지 write → commit → reread → 검증 성공, 나머지 바이트 보존', async () => {
  const page = await open();
  await connect(page);
  const before = await page.evaluate(() => window.__microMock.config);

  await page.click('.mapping-row[data-button="l2"]');
  await page.selectOption('#keySelect', String(0x45));
  await page.click('#modalApply');
  assert.equal(await page.textContent('.mapping-row[data-button="l2"] .mapping-value'), 'F12');
  assert.ok(await page.isEnabled('#syncButton'));

  await page.click('#syncButton');
  await page.waitForSelector('#verifiedBadge:not(.hidden)', { timeout: 20000 });

  const afterCfg = await page.evaluate(() => window.__microMock.config);
  const writes = await page.evaluate(() => window.__microMock.writes);
  assert.deepEqual(afterCfg.slice(36, 40), [0x45, 0, 0, 0]);
  for (let i = 2; i < 180; i++) {
    if (i >= 36 && i < 40) continue;
    assert.equal(afterCfg[i], before[i], `byte ${i} 가 바뀜`);
  }
  // 저장 시퀀스: write page 4개 다음 commit
  const kinds = writes.map(w => w[1]);
  const firstWrite = kinds.indexOf(0x01);
  assert.deepEqual(kinds.slice(firstWrite, firstWrite + 5), [0x01, 0x01, 0x01, 0x01, 0x06]);
  assert.match(await logText(page), /저장 \+ readback verification 완료/);
  assert.equal(await page.isDisabled('#syncButton'), true);
  await page.close();
});

test('편집 도중 장치 설정이 바뀌면 (DEVICE_CHANGED) 아무것도 쓰지 않는다', async () => {
  const page = await open();
  await connect(page);
  await page.click('.mapping-row[data-button="a"]');
  await page.selectOption('#keySelect', String(0x28));
  await page.click('#modalApply');
  await page.evaluate(() => window.__microMock.externalChange(100, 0x77));
  await page.click('#syncButton');
  await page.waitForFunction(() => document.querySelector('#log').textContent.includes('저장 실패'), null, { timeout: 15000 });
  const writes = await page.evaluate(() => window.__microMock.writes);
  assert.equal(writes.filter(w => w[1] === 0x01 || w[1] === 0x06).length, 0);
  assert.equal(await page.isVisible('#verifiedBadge'), false);
  await page.close();
});

test('commit 후 readback이 다르면 검증 실패로 표시한다', async () => {
  const page = await open('badcommit');
  await connect(page);
  await page.click('.mapping-row[data-button="a"]');
  await page.selectOption('#keySelect', String(0x28));
  await page.click('#modalApply');
  await page.click('#syncButton');
  await page.waitForFunction(() => document.querySelector('#log').textContent.includes('저장 후 검증 실패'), null, { timeout: 20000 });
  assert.equal(await page.isVisible('#verifiedBadge'), false);
  await page.close();
});

test('첫 GATT 연결이 바로 끊겨도 재시도로 연결된다', async () => {
  const page = await open('flaky');
  await connect(page);
  assert.ok(await page.evaluate(() => window.__microMock.connectCount) >= 2);
  assert.match(await logText(page), /GATT 초기 연결 1\/3 실패/);
  await page.close();
});

test('사용자가 연결 해제하면 자동 재연결하지 않는다', async () => {
  const page = await open();
  await connect(page);
  const n = await page.evaluate(() => window.__microMock.connectCount);
  await page.evaluate(() => disconnectManual());
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.__microMock.connectCount), n);
  assert.equal(await page.evaluate(() => state.connected), false);
  await page.close();
});

test('컨트롤러 그림의 버튼을 눌러도 편집창이 열린다', async () => {
  const page = await open();
  await connect(page);
  await page.click('#controllerSvg .hw[data-button="a"] .cap');
  assert.equal(await modalVisible(page), true);
  assert.equal(await page.textContent('#modalTitle'), 'A');
  await page.click('#modalCancel');
  await page.click('#controllerSvg .hw[data-button="up"] .dpad-seg');
  assert.equal(await page.textContent('#modalTitle'), '↑');
  await page.close();
});

test('연결선: 16개 모두 컨트롤러 버튼 위치에서 끝난다', async () => {
  const page = await open();
  await connect(page);
  const r = await page.evaluate(() => {
    const out = [];
    for (const g of document.querySelectorAll('#leaderLines g')) {
      const dot = g.querySelector('circle').getBoundingClientRect();
      const hw = document.querySelector(`#controllerSvg .hw[data-button="${g.dataset.button}"]`).getBoundingClientRect();
      const cx = dot.x + dot.width / 2, cy = dot.y + dot.height / 2;
      out.push(cx >= hw.left - 2 && cx <= hw.right + 2 && cy >= hw.top - 2 && cy <= hw.bottom + 2);
    }
    return out;
  });
  assert.equal(r.length, 16);
  assert.ok(r.every(Boolean), JSON.stringify(r));
  await page.close();
});

test('Anki 프리셋: Num . 자리만 Disabled, 나머지는 원래 키', async () => {
  const page = await open();
  await connect(page);
  await page.click('.nav-item[data-tab="profile"]');
  await page.click('button[data-preset="anki"]');
  const m = await page.evaluate(() => Object.fromEntries(Object.keys(BUTTONS).map(id => [id, mappingBytes(state.draft, id)])));
  const k = c => [c, 0, 0, 0], off = [0, 0, 0, 0];
  assert.deepEqual(m, {
    a: k(0x5a), b: k(0x5b), x: k(0x59), y: k(0x58),
    l: off, r: off, l2: off, r2: off, minus: off, plus: off, star: k(0x29), logo: off,
    up: k(0x5b), down: k(0x59), left: k(0x5a), right: k(0x28),
  });
  assert.equal(await page.isVisible('#tab-buttons'), true);
  assert.ok(await page.isEnabled('#syncButton'));
  await page.close();
});

test('브라우저 저장: 새로고침해도 마지막 매핑이 보이고, Sync 안 한 편집을 이어서 할 수 있다', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(`${base}?mock=1`);
  await connect(page);
  await page.click('.mapping-row[data-button="l2"]');
  await page.selectOption('#keySelect', String(0x45));
  await page.click('#modalApply');

  await page.reload();
  // 연결 전: 마지막으로 읽은 값(Num 1)이 흐리게 보이지만 편집은 안 된다
  assert.equal(await page.textContent('.mapping-row[data-button="l2"] .mapping-value'), 'Num 1');
  assert.ok(await page.evaluate(() => document.querySelector('.mapping-row').classList.contains('cached')));
  assert.equal(await page.evaluate(() => state.draft), null);

  await connect(page);
  assert.equal(await page.isVisible('#pendingBanner'), true);
  await page.click('#pendingRestore');
  assert.equal(await page.textContent('.mapping-row[data-button="l2"] .mapping-value'), 'F12');
  assert.equal(await page.isVisible('#pendingBanner'), false);
  await context.close();
});

test('8BitDo 기본값 프리셋 = 공식 앱 화면의 글자 배치', async () => {
  const page = await open();
  await connect(page);
  await page.click('.nav-item[data-tab="profile"]');
  await page.click('button[data-preset="default"]');
  const labels = await page.evaluate(() => Object.fromEntries(Object.keys(BUTTONS).map(id => [id, formatMapping(mappingBytes(state.draft, id))])));
  assert.deepEqual(labels, {
    a: 'G', b: 'J', x: 'H', y: 'I', l: 'K', r: 'M', l2: 'L', r2: 'R',
    minus: 'N', plus: 'O', star: 'T', logo: 'S', up: 'C', down: 'D', left: 'E', right: 'F',
  });
  await page.close();
});

test('처음 상태로 되돌리기: 저장 후에도 처음 읽은 매핑으로 돌아간다', async () => {
  const page = await open();
  await connect(page);
  await page.click('.mapping-row[data-button="a"]');
  await page.selectOption('#keySelect', String(0x28));
  await page.click('#modalApply');
  await page.click('#syncButton');
  await page.waitForSelector('#verifiedBadge:not(.hidden)', { timeout: 20000 });
  assert.equal(await page.textContent('.mapping-row[data-button="a"] .mapping-value'), 'Enter');

  await page.click('.nav-item[data-tab="profile"]');
  assert.equal(await page.locator('#restoreList .preset-card').count(), 2); // 처음 상태 + 자동 백업 1개
  await page.click('button[data-restore="original"]');
  assert.equal(await page.textContent('.mapping-row[data-button="a"] .mapping-value'), 'K');
  assert.deepEqual(await page.evaluate(() => [...state.dirtyButtons]), ['a']);
  await page.close();
});

test('전체 데이터 내보내기 → 새 브라우저에서 불러오기', async () => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  a.on('dialog', d => d.accept('테스트 프로필'));
  await a.goto(`${base}?mock=1`);
  await connect(a);
  await a.click('.nav-item[data-tab="profile"]');
  await a.click('#newProfileButton');
  await a.click('.nav-item[data-tab="settings"]');
  const [download] = await Promise.all([a.waitForEvent('download'), a.click('#exportDataButton')]);
  const buffer = await fs.readFile(await download.path()); // 컨텍스트를 닫으면 다운로드 파일도 지워진다
  await ctxA.close();

  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  b.on('dialog', d => d.accept());
  await b.goto(`${base}?mock=1`);
  assert.equal(await b.evaluate(() => getProfiles().length), 0);
  await b.click('.nav-item[data-tab="settings"]');
  await b.setInputFiles('#importDataInput', { name: 'data.json', mimeType: 'application/json', buffer });
  await b.waitForFunction(() => getProfiles().length === 1);
  assert.equal(await b.evaluate(() => getProfiles()[0].name), '테스트 프로필');
  // 연결 전에도 가져온 마지막 매핑이 보인다
  assert.equal(await b.textContent('.mapping-row[data-button="l2"] .mapping-value'), 'Num 1');
  assert.ok(await b.evaluate(() => !!loadStoredConfig(STORE_ORIGINAL)));
  await ctxB.close();
});
