/** Service-worker behavior checks with in-memory Cache API mocks. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const listeners = new Map(), stores = new Map();
const origin = 'https://example.test/cardcheck/';
let offline = false, cacheFull = false, skipped = false, claimed = false;
const requests = [];
const cacheKey = input => typeof input === 'string' ? input : input.url;
async function mockFetch(input) {
  const url = cacheKey(input);
  requests.push(url);
  if (offline) throw new Error('Offline');
  if (/assets\/cards\//.test(url)) return new Response('Missing optional artwork', { status: 404 });
  return new Response(`Network response for ${url}`, { status: 200 });
}
function store(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const map = stores.get(name);
  return {
    async addAll(urls) {
      const fetched = await Promise.all(urls.map(async url => [url, await mockFetch(url)]));
      if (fetched.some(([, response]) => !response.ok)) throw new Error('Required resource missing');
      for (const [url, response] of fetched) map.set(url, response);
    },
    async add(url) {
      const response = await mockFetch(url);
      if (!response.ok) throw new Error('Optional resource missing');
      map.set(url, response);
    },
    async put(input, response) {
      if (cacheFull) throw new Error('Quota full');
      map.set(cacheKey(input), response);
    },
    async match(input) { return map.get(cacheKey(input))?.clone(); },
  };
}
const context = vm.createContext({
  self: {
    location: { href: `${origin}sw.js` },
    addEventListener: (event, handler) => listeners.set(event, handler),
    skipWaiting: async () => { skipped = true; },
    clients: { claim: async () => { claimed = true; } },
  },
  caches: {
    open: async name => store(name), keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
  },
  fetch: input => mockFetch(input), URL, Request, Promise, console,
});
vm.runInContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), context, { filename: 'sw.js' });
async function lifecycle(name) {
  let pending;
  listeners.get(name)({ waitUntil: promise => { pending = promise; } });
  await pending;
}
async function request(path, options = {}) {
  let response;
  const request = { url: new URL(path, origin).href, method: 'GET', mode: 'cors', destination: 'script', ...options };
  listeners.get('fetch')({ request, respondWith: promise => { response = promise; } });
  return response;
}
let passed = 0;
function pass(label) { passed++; console.log(`PASS ${label}`); }

await lifecycle('install');
assert.equal(skipped, true);
assert.ok(requests.every(url => url.startsWith(origin)), 'Installation URLs must preserve project subpath');
assert.ok([...stores.values()].some(map => map.has(`${origin}index.html`)));
pass('installation preserves the GitHub project path and tolerates missing optional artwork');

const online = await request('js/app.js');
assert.equal(online.status, 200);
offline = true;
const cached = await request('js/app.js');
assert.equal(cached.status, 200);
assert.match(await cached.text(), /js\/app\.js/);
pass('cached app scripts remain available after the network disappears');

const navigation = await request('unknown-page', { mode: 'navigate', destination: 'document' });
assert.equal(navigation.status, 200);
assert.match(await navigation.text(), /cardcheck\//);
pass('offline navigation falls back to the scoped app home');

assert.equal(await request('https://example.test/other-project/app.js'), undefined);
assert.equal(await request('js/app.js', { method: 'POST' }), undefined);
assert.equal(await request('https://unrelated.test/picture.png', { destination: 'image' }), undefined);
pass('unrelated origins, other project paths, and non-GET requests are ignored');

offline = false;
const referenceUrl = 'https://images.pokemontcg.io/swsh7/189_hires.png';
assert.equal((await request(referenceUrl, { destination: 'image' })).status, 200);
offline = true;
const offlineReference = await request(referenceUrl, { destination: 'image' });
assert.equal(offlineReference.status, 200);
assert.match(await offlineReference.text(), /189_hires/);
pass('successful remote artwork fallback is cached for later offline use');

offline = false;
const messageReference = 'https://images.pokemontcg.io/sm10/205_hires.png';
const prohibitedReference = 'https://unrelated.test/private.png';
let messagePending;
listeners.get('message')({
  data: { type: 'CACHE_REFERENCES', urls: [messageReference, prohibitedReference] },
  waitUntil: promise => { messagePending = promise; },
});
await messagePending;
assert.ok(requests.includes(messageReference));
assert.equal(requests.includes(prohibitedReference), false);
offline = true;
assert.equal((await request(messageReference, { destination: 'image' })).status, 200);
pass('first-load reference message seeds offline cache and ignores unrelated hosts');

offline = false; cacheFull = true;
const fresh = await request('new-resource.js');
assert.equal(fresh.status, 200);
pass('cache quota failure does not block a successful network response');

const previousOwnCache = `cardcheck-${encodeURIComponent(new URL(origin).pathname)}-v0.0.0`;
const otherProjectCache = `cardcheck-${encodeURIComponent('/other-project/')}-v1.0.0`;
stores.set(previousOwnCache, new Map());
stores.set(otherProjectCache, new Map());
stores.set('unrelated-app-cache', new Map());
await lifecycle('activate');
assert.equal(stores.has(previousOwnCache), false);
assert.equal(stores.has(otherProjectCache), true);
assert.equal(stores.has('unrelated-app-cache'), true);
assert.equal(claimed, true);
pass('activation removes this project’s old cache while preserving other projects');
console.log(`\n${passed} offline worker checks passed. Airplane-mode behavior still needs testing on the target iPhone.`);
