import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const browserCandidates = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const EDGE = browserCandidates.find((candidate) => fs.existsSync(candidate));
if (!EDGE) {
  throw new Error(
    'No Edge/Chrome found for UI smoke test. Install one or set EDGE_PATH.',
  );
}
const URL = process.env.WTF_URL || 'http://127.0.0.1:8000/';

const board = { W: 620, H: 684, M: 54 };

async function clickSquare(page, file, rank, flipped = false) {
  const box = await page.locator('#board-canvas').boundingBox();
  assert.ok(box, 'board canvas should have a bounding box');
  const screenFile = flipped ? 8 - file : file;
  const screenRank = flipped ? rank : 9 - rank;
  const x = box.x + ((board.M + screenFile * 64) / board.W) * box.width;
  const y = box.y + ((board.M + screenRank * 64) / board.H) * box.height;
  await page.mouse.click(x, y);
  await page.waitForTimeout(130);
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--disable-gpu'],
});

try {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  assert.equal(await page.title(), '中国象棋WTF版 · 剧毒术士（离谱暗封剑）');

  // PVP: recommended openings modal, then one move.
  await page.click('#pvp-card');
  await page.waitForTimeout(400);
  await page.click('#opening-guide-btn');
  await page.waitForTimeout(250);
  assert.equal(
    await page.locator('.modal-title').filter({ hasText: '推荐首着' }).count(),
    1,
  );
  assert.equal(await page.locator('.opening-list li').count(), 9);
  assert.doesNotMatch(await page.locator('.opening-guide').innerText(), /%/);
  await page.locator('.modal-close').click();
  await page.waitForTimeout(150);
  await clickSquare(page, 0, 3);
  await clickSquare(page, 0, 4);
  assert.equal(await page.locator('#move-count').textContent(), '1');
  assert.match((await page.locator('#move-list').innerText()).replace(/\s+/g, ''), /狼a4→a5/);

  // Rulebook iframe.
  await page.click('#rules-btn');
  await page.waitForTimeout(500);
  const frame = page.frameLocator('.rulebook-frame');
  assert.equal(await frame.locator('h2').count(), 10);
  await page.locator('.modal-close').click();

  // AI: human move, then AI reply.
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#ai-card');
  await page.waitForTimeout(150);
  await page.click('#ai-start');
  await page.waitForTimeout(500);
  await clickSquare(page, 0, 3);
  await clickSquare(page, 0, 4);
  await page.waitForTimeout(2600);
  assert.equal(await page.locator('#move-count').textContent(), '2');
  assert.match(await page.locator('#status-sub').textContent(), /AI|深度|行棋|将军/);

  // AI mode: flipping the board swaps sides and the new AI side moves on the current turn.
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#ai-card');
  await page.waitForTimeout(150);
  await page.click('#ai-start');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#move-count').textContent(), '0');
  assert.equal(
    await page.locator('#red-player .ai-tag').evaluate((el) => el.classList.contains('hidden')),
    true,
  );
  await page.click('#flip-btn');
  await page.waitForTimeout(3000);
  assert.equal(await page.locator('#move-count').textContent(), '1');
  assert.equal(
    await page.locator('#red-player .ai-tag').evaluate((el) => el.classList.contains('hidden')),
    false,
  );
  assert.equal(
    await page.locator('#black-player .ai-tag').evaluate((el) => el.classList.contains('hidden')),
    true,
  );
  assert.match(await page.locator('#mode-badge').textContent(), /执黑/);

  // AI mode: flipping while the AI is thinking cancels its move; the new human takes over.
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#ai-card');
  await page.waitForTimeout(150);
  await page.click('#ai-start');
  await page.waitForTimeout(500);
  await clickSquare(page, 0, 3);
  await clickSquare(page, 0, 4);
  await page.waitForTimeout(80);
  await page.click('#flip-btn');
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('#move-count').textContent(), '1');
  assert.equal(
    await page.locator('#red-player .ai-tag').evaluate((el) => el.classList.contains('hidden')),
    false,
  );
  // The new human plays Black on the flipped board: a7 -> a6.
  await clickSquare(page, 0, 6, true);
  await clickSquare(page, 0, 5, true);
  assert.equal(await page.locator('#move-count').textContent(), '2');
  await page.waitForTimeout(3000);
  assert.equal(await page.locator('#move-count').textContent(), '3');

  // Duel selection UI via the debug surface (PVP so both selectors are human).
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#pvp-card');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const d = window.__WTF_DEBUG__;
    const sq = (text) => d.parseCoord(text);
    const pos = new d.Position(new Int8Array(90), new Int16Array(90), d.RED, false);
    const put = (text, color, type, id) => {
      pos.board[sq(text)] = d.makePiece(color, type);
      pos.ids[sq(text)] = id;
    };
    put('e1', d.RED, d.PieceType.King, 1);
    put('e10', d.BLACK, d.PieceType.King, 2);
    put('e5', d.RED, d.PieceType.Pawn, 3);
    put('e6', d.RED, d.PieceType.Pawn, 4);
    put('c5', d.RED, d.PieceType.Pawn, 5);
    put('c6', d.BLACK, d.PieceType.Pawn, 6);
    put('a10', d.BLACK, d.PieceType.Pawn, 7);
    d.game.loadPosition(pos);
    d.game.startDuelByAgreement();
  });
  await page.waitForTimeout(800);
  const dockTitle = page.locator('#duel-dock .duel-dock-title strong');
  assert.match(await dockTitle.textContent(), /红方选子/);

  // Select a candidate directly on the board, then choose its target in the dock.
  await clickSquare(page, 2, 4);
  assert.match(await page.locator('#duel-dock .duel-focus-name').textContent(), /c5/);
  await page.locator('#duel-dock .duel-focus-targets .target-btn').first().click();
  assert.match(
    (await page.locator('#duel-dock .duel-chip-text').innerText()).replace(/\s+/g, ''),
    /c5→虎/,
  );

  // Minimize and restore without losing the selection.
  await page.locator('#duel-dock .duel-dock-toggle').click();
  await page.waitForTimeout(120);
  assert.equal(await page.locator('#duel-dock').evaluate((el) => el.classList.contains('collapsed')), true);
  await page.locator('#duel-dock .duel-dock-toggle').click();
  await page.waitForTimeout(120);
  assert.equal(await page.locator('#duel-dock').evaluate((el) => el.classList.contains('collapsed')), false);

  await page.locator('#duel-confirm').click();
  await page.waitForTimeout(800);
  assert.match(await page.locator('#duel-dock .duel-dock-title strong').textContent(), /黑方选子/);

  // Save a finished game, then open it in the replay viewer.
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#pvp-card');
  await page.waitForTimeout(350);
  await clickSquare(page, 0, 3);
  await clickSquare(page, 0, 4);
  await page.evaluate(() => {
    const d = window.__WTF_DEBUG__;
    d.game.resign(d.RED);
  });
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.game-over-modal').count(), 1);
  await page.locator('.game-over-modal button').filter({ hasText: '保存棋谱' }).click();
  await page.waitForTimeout(250);
  await page.locator('.game-over-modal button').filter({ hasText: '棋谱库' }).click();
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#record-list .record-item').count(), 11);
  await page.locator('#record-list .record-item').first().locator('.record-main').click();
  await page.waitForTimeout(450);
  assert.match(await page.locator('#replay-title').textContent(), /双人/);
  assert.match(await page.locator('#replay-step').textContent(), /第 0 \/ 1 步/);
  await page.click('#replay-next');
  await page.waitForTimeout(150);
  assert.match(await page.locator('#replay-step').textContent(), /第 1 \/ 1 步/);
  await page.click('#replay-back');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#record-list .record-item').count(), 11);

  // Import a valid bundle, then reject an invalid one.
  const featured = JSON.parse(fs.readFileSync('src/data/featuredRecords.json', 'utf8'));
  const validBundle = {
    format: 'wtf-chess-records',
    version: 1,
    exportedAt: new Date().toISOString(),
    records: [featured[0]],
  };
  await page.locator('#library-file').setInputFiles({
    name: 'valid-records.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(validBundle)),
  });
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#record-list .record-item').count(), 12);
  await page.locator('#library-file').setInputFiles({
    name: 'invalid-records.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"wrong"}'),
  });
  await page.waitForTimeout(350);
  assert.equal(
    await page.locator('.modal-title').filter({ hasText: '棋谱导入失败' }).count(),
    1,
  );
  await page.locator('.modal-actions button').filter({ hasText: '关闭' }).click();
  await page.waitForTimeout(200);

  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  console.log('UI smoke test passed.');
} finally {
  await browser.close();
}
