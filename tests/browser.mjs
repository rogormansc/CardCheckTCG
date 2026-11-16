/**
 * Browser smoke checks with synthetic artwork (not physical-card validation).
 * Start the app with npm start, then:
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   node tests/browser.mjs
 * Optional: CARDCHECK_URL=http://localhost:4173/ CHROMIUM_PATH=/path/to/chromium
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) {
    throw new Error('Install the optional browser test dependency: npm install --no-save playwright');
  }
  playwright = createRequire(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/`)('playwright');
}
const appUrl = process.env.CARDCHECK_URL || 'http://localhost:4173/';
const launchOptions = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
const browser = await playwright.chromium.launch(launchOptions);

function artwork(seed, title) {
  const random = () => {
    seed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
    seed = Math.imul(seed ^ (seed >>> 15), 0x735a2d97);
    return ((seed ^= seed >>> 15) >>> 0) / 4294967296;
  };
  const shapes = [];
  for (let i = 0; i < 200; i++) {
    const x = 35 + random() * 410, y = 95 + random() * 360;
    const color = `rgb(${Math.floor(random()*230)},${Math.floor(random()*230)},${Math.floor(random()*230)})`;
    shapes.push(`<path d="M${x},${y}l${random()*65-30},${random()*65}l-${random()*70},-${random()*45}Z" fill="${color}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="672"><rect width="480" height="672" fill="#d5c07a"/><rect x="14" y="14" width="452" height="644" fill="#edf0e8"/><text x="30" y="57" font-family="sans-serif" font-size="25" font-weight="bold">${title}</text><svg x="30" y="80" width="420" height="400" viewBox="30 80 420 400">${shapes.join('')}</svg><g font-family="sans-serif" fill="#1f2b32" font-size="19">${Array.from({length:7},(_,i)=>`<text x="32" y="${515+i*20}">Reference ${title} feature ${i+1}: ${Math.floor(random()*9999)}</text>`).join('')}</g></svg>`;
}

const errors = [];
let passed = 0;
function pass(label) { passed++; console.log(`PASS ${label}`); }

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  // Serve known synthetic references so these UI checks need no image host.
  await context.route(/(?:assets\/cards\/|images\.pokemontcg\.io\/).*(?:png|jpg)/, async route => {
    const url = route.request().url();
    const isUmbreon = /umbreon|swsh7/.test(url);
    const is204 = /204/.test(url);
    await route.fulfill({
      status: 200, contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: artwork(isUmbreon ? 104 : is204 ? 426 : 296, isUmbreon ? 'Umbreon fixture' : is204 ? 'Gardevoir 204' : 'Gardevoir 205'),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(appUrl);
  await page.waitForFunction(() => !document.querySelector('#upload-photo')?.disabled, null, { timeout: 30000 });
  assert.equal(await page.locator('#model-state').innerText(), '2 / 2 cards ready');
  assert.equal(await page.title(), 'CardCheck — Know your cards.');
  assert.equal(await page.locator('#view-scan').isVisible(), true);
  pass('desktop app loads and indexes two synthetic references');

  await page.locator('#sample-umbreon').click();
  await page.locator('#result-content').waitFor({ state: 'visible' });
  await page.waitForFunction(() => /Umbreon V/.test(document.querySelector('#result-content')?.textContent || ''));
  assert.match(await page.locator('#result-content').innerText(), /fictional|sample/i);
  pass('sample scan uses recognizer and displays a labeled result');

  await page.locator('#save-result').click();
  await page.locator('#save-result').click();
  await page.locator('[data-view="collection"]').click();
  assert.equal(await page.locator('#stat-total').innerText(), '2');
  assert.equal(await page.locator('#stat-unique').innerText(), '1');
  await page.locator('[data-quantity="1"]').click();
  assert.equal(await page.locator('#stat-total').innerText(), '3');
  await page.locator('[data-quantity="-1"]').click();
  assert.equal(await page.locator('#stat-total').innerText(), '2');
  const csvDownload = page.waitForEvent('download');
  await page.locator('#export-collection').click();
  assert.equal((await csvDownload).suggestedFilename(), 'cardcheck-collection.csv');
  pass('confirmed cards combine quantity; increment, decrement, and CSV export work');

  await page.locator('[data-view="catalog"]').click();
  assert.equal(await page.locator('#view-catalog').isVisible(), true);
  assert.match(await page.locator('#catalog-capacity').innerText(), /2\s*\/\s*8/);
  pass('catalog shows two of eight slots');

  await page.locator('[data-switch-variant]').click();
  await page.waitForFunction(() => /204\/214/.test(document.querySelector('#catalog-list')?.textContent || ''));
  await page.locator('[data-view="scan"]').click();
  await page.locator('#sample-gardevoir').click();
  await page.waitForFunction(() => /204\/214/.test(document.querySelector('#result-content')?.textContent || ''));
  await page.locator('[data-view="catalog"]').click();
  await page.locator('[data-switch-variant]').click();
  await page.waitForFunction(() => /205\/214/.test(document.querySelector('#catalog-list')?.textContent || ''));
  pass('Gardevoir 205 and 204 variants switch and use their own references');

  const pngPhoto = await page.evaluate(async svg => {
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  }, artwork(741, 'New reference card'));

  await page.locator('#add-card').click();
  await page.locator('#card-form [name="name"]').fill('QA custom card');
  await page.locator('#card-form [name="set"]').fill('QA test set');
  await page.locator('#card-form [name="number"]').fill('007/008');
  await page.locator('#card-form [name="variant"]').fill('Synthetic test art');
  await page.locator('#card-form [name="image"]').setInputFiles({ name: 'qa-reference.png', mimeType: 'image/png', buffer: Buffer.from(pngPhoto, 'base64') });
  await page.locator('#card-form button[type="submit"]').click();
  await page.locator('#card-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => /3\s*\/\s*8/.test(document.querySelector('#catalog-capacity')?.textContent || ''));
  await page.reload();
  await page.locator('[data-view="catalog"]').click();
  await page.waitForFunction(() => /QA custom card/.test(document.querySelector('#catalog-list')?.textContent || ''));
  await page.waitForFunction(() => !document.querySelector('#upload-photo')?.disabled, null, { timeout: 30000 });
  pass('custom card and its reference persist across reload');

  await page.locator('[data-view="scan"]').click();
  await page.locator('#photo-input').setInputFiles({ name: 'qa-scan.png', mimeType: 'image/png', buffer: Buffer.from(pngPhoto, 'base64') });
  await page.waitForFunction(() => /QA custom card/.test(document.querySelector('#result-content')?.textContent || ''), null, { timeout: 30000 });
  pass('uploaded photo identifies the newly added reference');

  await page.locator('#save-result').click();
  await page.locator('[data-view="catalog"]').click();
  const backupEvent = page.waitForEvent('download');
  await page.locator('#export-pack').click();
  const backupDownload = await backupEvent;
  const backupStream = await backupDownload.createReadStream();
  const backupChunks = [];
  for await (const chunk of backupStream) backupChunks.push(chunk);
  const backupBytes = Buffer.concat(backupChunks);
  assert.equal(JSON.parse(backupBytes).custom.length, 1);
  await page.locator('[data-remove-card]').click();
  await page.waitForFunction(() => /2\s*\/\s*8/.test(document.querySelector('#catalog-capacity')?.textContent || ''));
  await page.waitForFunction(() => !document.querySelector('#import-pack')?.disabled, null, { timeout: 30000 });
  await page.locator('#import-input').setInputFiles({ name: 'cardcheck-backup.json', mimeType: 'application/json', buffer: backupBytes });
  await page.waitForFunction(() => /3\s*\/\s*8/.test(document.querySelector('#catalog-capacity')?.textContent || ''));
  await page.waitForFunction(() => !document.querySelector('#upload-photo')?.disabled, null, { timeout: 30000 });
  await page.locator('[data-view="collection"]').click();
  assert.equal(await page.locator('#stat-total').innerText(), '3');
  await page.locator('[data-delete-item]').first().click();
  assert.equal(await page.locator('#stat-total').innerText(), '1');
  pass('JSON backup restores references and collection; remove-all updates totals');

  await page.locator('[data-view="scan"]').click();
  const blank = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 700;
    canvas.getContext('2d').fillRect(0, 0, 500, 700);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#photo-input').setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: Buffer.from(blank, 'base64') });
  await page.waitForFunction(() => /No confident match/i.test(document.querySelector('#result-content')?.textContent || ''), null, { timeout: 30000 });
  pass('blank upload is rejected');

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    for (const view of ['scan', 'collection', 'catalog']) {
      await page.locator(`[data-view="${view}"]`).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `${view} must fit a ${width}px viewport`);
    }
  }
  pass('all views fit phone, tablet, and desktop widths');

  await page.locator('#about-button').click();
  assert.equal(await page.locator('#about-dialog').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#about-dialog').isVisible(), false);
  pass('about dialog supports keyboard dismissal');
  assert.deepEqual(errors, [], `Browser runtime errors: ${errors.join('; ')}`);
  pass('no uncaught browser runtime errors');
  await context.close();
  console.log(`\n${passed} browser smoke checks passed. Synthetic artwork only; test physical cards on the actual iPhone.`);
} finally {
  await browser.close();
}
