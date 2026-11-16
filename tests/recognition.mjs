/**
 * Deterministic recognition regression checks. No camera or network is used.
 * Development dependency: npm install --no-save @napi-rs/canvas
 * Run from the project root: node tests/recognition.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let canvasPackage;
try { canvasPackage = require('@napi-rs/canvas'); }
catch {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) {
    throw new Error('Install the optional test dependency: npm install --no-save @napi-rs/canvas');
  }
  canvasPackage = createRequire(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/`)('@napi-rs/canvas');
}
const { createCanvas, Image, loadImage } = canvasPackage;
globalThis.Image = Image;
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas', 'Only canvas is expected by the recognition engine');
    return createCanvas(1, 1);
  },
};
globalThis.requestAnimationFrame ??= callback => setTimeout(() => callback(performance.now()), 0);

const { CardRecognizer } = await import('../js/recognizer.js');

function randomFor(seed) {
  return () => {
    seed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
    seed = Math.imul(seed ^ (seed >>> 15), 0x735a2d97);
    return ((seed ^= seed >>> 15) >>> 0) / 4294967296;
  };
}

function syntheticReference(seed, label) {
  const canvas = createCanvas(480, 672);
  const ctx = canvas.getContext('2d');
  const random = randomFor(seed);
  ctx.fillStyle = '#d8bf66';
  ctx.fillRect(0, 0, 480, 672);
  ctx.fillStyle = '#ece9df';
  ctx.fillRect(14, 14, 452, 644);
  ctx.fillStyle = '#131a28';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(label, 32, 57);
  ctx.save();
  ctx.beginPath();
  ctx.rect(32, 84, 416, 390);
  ctx.clip();
  for (let i = 0; i < 180; i++) {
    const x = 20 + random() * 440;
    const y = 70 + random() * 420;
    ctx.fillStyle = `rgb(${Math.floor(random() * 240)},${Math.floor(random() * 240)},${Math.floor(random() * 240)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + random() * 75 - 35, y + random() * 85);
    ctx.lineTo(x - random() * 85, y + random() * 60);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#182131';
  ctx.font = '17px sans-serif';
  for (let i = 0; i < 7; i++) {
    ctx.fillText(`${label} feature ${i + 1}: ${Math.floor(random() * 9999)}`, 32, 510 + i * 20);
  }
  return canvas;
}

function scene(image, { angle = 0, scale = 0.8, skew = 0, brightness = 1 } = {}) {
  const canvas = createCanvas(720, 920);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#6a7277';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(angle * Math.PI / 180);
  ctx.transform(scale, skew, 0, scale, 0, 0);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  ctx.restore();
  if (brightness < 1) {
    ctx.fillStyle = `rgba(0,0,0,${1 - brightness})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

let passed = 0;
async function check(label, recognizer, source, expectedId) {
  const result = await recognizer.recognize(source);
  const candidate = result.card?.id ?? null;
  if (expectedId) {
    assert.equal(result.status, 'matched', `${label}: expected a match; got ${JSON.stringify(result)}`);
    assert.equal(candidate, expectedId, `${label}: wrong card`);
  } else {
    assert.notEqual(result.status, 'matched', `${label}: must reject unfamiliar content`);
  }
  passed++;
  console.log(`PASS ${label}: ${result.status}${candidate ? ` (${candidate})` : ''}`);
}

const alpha = syntheticReference(104, 'Synthetic Alpha');
const beta = syntheticReference(296, 'Synthetic Beta');
const recognizer = new CardRecognizer();
const trained = await recognizer.load([
  { id: 'synthetic-alpha', name: 'Synthetic Alpha', image: alpha.toDataURL('image/png') },
  { id: 'synthetic-beta', name: 'Synthetic Beta', image: beta.toDataURL('image/png') },
]);
assert.equal(trained.failed.length, 0, 'Synthetic references must load');
for (const [id, image] of [['synthetic-alpha', alpha], ['synthetic-beta', beta]]) {
  await check(`${id} reference`, recognizer, image, id);
  await check(`${id} scene`, recognizer, scene(image), id);
  await check(`${id} rotated 18 degrees`, recognizer, scene(image, { angle: 18 }), id);
  await check(`${id} dimmed`, recognizer, scene(image, { brightness: 0.66 }), id);
  await check(`${id} slight affine tilt`, recognizer, scene(image, { angle: -9, skew: 0.08 }), id);
}
await check('Unfamiliar synthetic card', recognizer, scene(syntheticReference(771, 'Unfamiliar Gamma')), null);
const sharedLayout = createCanvas(alpha.width, alpha.height);
sharedLayout.getContext('2d').drawImage(alpha, 0, 0);
sharedLayout.getContext('2d').drawImage(syntheticReference(882, 'Changed artwork'), 32, 84, 416, 390, 32, 84, 416, 390);
await check('Shared border and text with unfamiliar artwork', recognizer, scene(sharedLayout), null);
const blank = createCanvas(720, 920);
blank.getContext('2d').fillRect(0, 0, blank.width, blank.height);
await check('Blank frame', recognizer, blank, null);

const model = JSON.parse(JSON.stringify(recognizer.exportModel()));
const restoredRecognizer = new CardRecognizer();
const restored = restoredRecognizer.loadModel(model, [
  { id: 'synthetic-alpha', name: 'Synthetic Alpha' },
  { id: 'synthetic-beta', name: 'Synthetic Beta' },
]);
assert.deepEqual(restored.loaded.sort(), ['synthetic-alpha', 'synthetic-beta']);
await check('Exported model survives JSON roundtrip', restoredRecognizer, scene(beta, { angle: -13 }), 'synthetic-beta');

const multiRecognizer = new CardRecognizer();
const multiLoaded = await multiRecognizer.load([
  {
    id: 'synthetic-alpha', name: 'Synthetic Alpha', image: alpha.toDataURL('image/png'),
    references: [scene(alpha, { angle: 9 }).toDataURL('image/png')],
  },
  { id: 'synthetic-beta', name: 'Synthetic Beta', image: beta.toDataURL('image/png') },
]);
assert.equal(multiLoaded.failed.length, 0);
assert.equal(multiRecognizer.references.length, 3, 'Additional reference must be indexed');
const multiResult = await multiRecognizer.recognize(scene(alpha, { angle: 9 }));
assert.equal(multiResult.status, 'matched', 'Same-card references must not compete as separate classes');
assert.equal(multiResult.card.id, 'synthetic-alpha');
assert.equal(multiResult.candidates.length, 2, 'Candidates should contain one entry per card');
passed++;
console.log('PASS multiple references consolidate to one card candidate');

const ambiguousRecognizer = new CardRecognizer();
await ambiguousRecognizer.load([
  { id: 'duplicate-one', name: 'Duplicate One', image: alpha.toDataURL('image/png') },
  { id: 'duplicate-two', name: 'Duplicate Two', image: alpha.toDataURL('image/png') },
]);
const ambiguous = await ambiguousRecognizer.recognize(alpha);
assert.equal(ambiguous.status, 'uncertain', 'Visually identical classes must require review');
assert.equal(ambiguous.card, null, 'Ambiguous match must not select a card');
passed++;
console.log('PASS visually identical classes return uncertain');

// Also check bundled card references when they have been supplied. These tests
// use transformations of reference art, not independent iPhone photographs.
try {
  const catalog = JSON.parse(await readFile(path.join(projectRoot, 'data/cards.json'), 'utf8'));
  const cards = Array.isArray(catalog) ? catalog : catalog.cards;
  if (cards?.length) {
    const refs = [];
    for (const card of cards.filter(card => card.enabled !== false)) {
      const local = card.image.startsWith('data:') ? card.image : path.join(projectRoot, card.image.replace(/^\.\//, ''));
      const image = await loadImage(local.startsWith('data:') ? local : await readFile(local));
      const canvas = createCanvas(image.width, image.height);
      canvas.getContext('2d').drawImage(image, 0, 0);
      refs.push({ card: { ...card, image: canvas.toDataURL('image/png') }, canvas });
    }
    const realRecognizer = new CardRecognizer();
    const loaded = await realRecognizer.load(refs.map(reference => reference.card));
    assert.equal(loaded.failed.length, 0, 'Bundled references must load');
    for (const reference of refs) {
      // Normalize dimensions so scene scale remains sensible for large images.
      const small = createCanvas(480, Math.round(480 * reference.canvas.height / reference.canvas.width));
      small.getContext('2d').drawImage(reference.canvas, 0, 0, small.width, small.height);
      await check(`${reference.card.id} bundled artwork`, realRecognizer, small, reference.card.id);
      await check(`${reference.card.id} rotated artwork`, realRecognizer, scene(small, { angle: 16 }), reference.card.id);
      await check(`${reference.card.id} dimmed artwork`, realRecognizer, scene(small, { brightness: 0.66 }), reference.card.id);
    }
    await check('Bundled model rejects unfamiliar artwork', realRecognizer, syntheticReference(511, 'Unfamiliar Delta'), null);
    await check('Bundled model rejects blank frame', realRecognizer, blank, null);
  }
} catch (error) {
  if (error.code === 'ENOENT') console.log('SKIP bundled-reference checks: catalog or image not available yet.');
  else throw error;
}
console.log(`\n${passed} recognition checks passed. Real iPhone photos still need field testing.`);
