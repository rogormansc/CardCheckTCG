#!/usr/bin/env node
/**
 * Save the three verified card-art reference sources locally.
 * Node 18+ only; no npm packages, account, or API key required.
 * Run from any directory: node /path/to/cardcheck/tools/download-references.mjs
 */
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const folder = new URL('../assets/cards/', import.meta.url);
const manifest = [
  ['umbreon-v-189.png', 'https://images.pokemontcg.io/swsh7/189_hires.png'],
  ['gardevoir-sylveon-gx-205.png', 'https://images.pokemontcg.io/sm10/205_hires.png'],
  ['gardevoir-sylveon-gx-204.png', 'https://images.pokemontcg.io/sm10/204_hires.png'],
];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_BYTES = 15 * 1024 * 1024;
const force = process.argv.includes('--force');

function validPng(bytes) {
  if (bytes.length < 33 || bytes.length > MAX_BYTES || !bytes.subarray(0, 8).equals(pngSignature)) return false;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  return width >= 100 && height >= 100 && width <= 10000 && height <= 10000;
}

async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'CardCheck-reference-setup/1.0' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_BYTES) throw new Error('Image exceeds 15 MiB limit');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error('Image exceeds 15 MiB limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = Buffer.concat(chunks);
  if (!validPng(bytes)) throw new Error('Source did not return a valid card-sized PNG');
  return bytes;
}

await mkdir(folder, { recursive: true });
let failures = 0;
for (const [filename, url] of manifest) {
  const target = new URL(filename, folder);
  if (!force) {
    try {
      if (validPng(await readFile(target))) {
        console.log(`Already saved: ${filename}`);
        continue;
      }
    } catch { /* Missing local image: download below. */ }
  }
  const temporary = new URL(`${filename}.download`, folder);
  try {
    const bytes = await download(url);
    await writeFile(temporary, bytes);
    await rename(temporary, target);
    console.log(`Saved ${filename} (${Math.round(bytes.length / 1024)} KiB)`);
  } catch (error) {
    failures++;
    await unlink(temporary).catch(() => {});
    console.error(`Could not save ${filename}: ${error.message}`);
    console.error(`  Open ${url} in your browser and save its PNG to ${fileURLToPath(target)}`);
  }
}

if (failures) {
  console.error(`\n${failures} reference download(s) failed. A network filter or source outage may be blocking access.`);
  console.error('You can still open CardCheck and attach your own clear reference photo for each card in Catalog.');
  console.error('Do not report these references as trained until the app shows that they are indexed.');
  process.exitCode = 1;
} else {
  console.log('\nReference PNGs are ready. Run npm start, then open the app and wait for indexing.');
  console.log('Commit assets/cards/*.png to GitHub if these images should ship with the hosted demo.');
}
