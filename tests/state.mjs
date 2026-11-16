/** Dependency-free state/backup smoke checks. DOM is stubbed; this is not a browser test. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile(new URL('../data/cards.json', import.meta.url), 'utf8'));
const source = (await readFile(new URL('../js/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\s*$/gm, '')
  .replace(/init\(\);\s*$/, '');
const elements = new Map();
const element = selector => {
  if (!elements.has(selector)) elements.set(selector, {
    hidden: false, disabled: false, value: 'Near Mint', textContent: '', innerHTML: '',
    nextElementSibling: {}, dataset: {}, classList: { toggle() {} },
    addEventListener() {}, setAttribute() {}, removeAttribute() {},
  });
  return elements.get(selector);
};
const writes = [];
const context = vm.createContext({
  CardRecognizer: class {
    async load(cards) { return { loaded: cards.map(card => card.id), failed: [], imageSources: {} }; }
  },
  openStorage: async () => {}, readState: async (_key, fallback) => fallback,
  writeState: async (key, value) => writes.push({ key, value: structuredClone(value) }),
  document: { querySelector: element, querySelectorAll: () => [], addEventListener() {} },
  window: { addEventListener() {}, isSecureContext: false, confirm: () => true },
  location: { hash: '#scan' }, history: { replaceState() {} }, navigator: {},
  setTimeout: () => 0, clearTimeout() {}, Intl, console,
});
vm.runInContext(`${source}\n;globalThis.testApp = {
  configure(next) {
    config = next.config; custom = next.custom || []; extras = next.extras || {};
    binder = next.binder || []; selectedVariant = next.selectedVariant || 'sm10-205';
    cards = activeCards();
  },
  state() { return JSON.stringify({custom, extras, binder, selectedVariant, cards:activeCards()}); },
  activeCards, validateCard, importBackup,
  setLastCard(card) { lastCard = card; },
  addToCollection,
  click(button) { return handleClick({target:{closest:()=>({...button,hasAttribute:()=>false})}}); },
  installDownloadCapture(callback) { download = callback; }
};`, context, { filename: 'app.js' });
const app = context.testApp;
const state = () => JSON.parse(app.state());
const photo = 'data:image/jpeg;base64,QUJDRA==';
const customCard = {
  id: 'custom-qa', name: '=QA card', set: 'Synthetic set', number: '007/008',
  variant: 'Synthetic art', image: photo,
};
let passed = 0;
function pass(label) { passed++; console.log(`PASS ${label}`); }

app.configure({ config: catalog, custom: [customCard], extras: { 'custom-qa': [photo] } });
assert.equal(state().cards.length, 3);
assert.equal(state().cards[2].references.length, 1);
pass('custom cards and extra references join the starter catalog');

app.configure({ config: catalog, selectedVariant: 'sm10-204' });
assert.equal(state().cards[0].id, 'swsh7-189');
assert.equal(state().cards[1].id, 'sm10-204');
pass('Gardevoir printing switches while Umbreon is retained');

const futureCard = { ...catalog.cards[0], id: 'sm10-201', name: 'Future different card' };
app.configure({ config: { ...catalog, cards: [...catalog.cards, futureCard] } });
assert.equal(state().cards[2].id, 'sm10-201', 'Future source cards must not be mistaken for Gardevoir');
pass('future Unbroken Bonds card IDs are not replaced by the variant switch');

app.configure({ config: catalog, custom: [customCard] });
app.setLastCard(customCard);
await app.addToCollection();
await app.addToCollection();
assert.equal(state().binder.length, 1);
assert.equal(state().binder[0].quantity, 2);
assert.equal(element('#stat-total').textContent, '2');
assert.equal(state().binder[0].card.references, undefined);
pass('confirming twice combines quantity and updates collection totals');

await app.click({ dataset: { quantity: '-1', index: '0' } });
assert.equal(state().binder[0].quantity, 1);
pass('quantity decrement updates persisted collection state');

let download;
app.installDownloadCapture((name, content, type) => { download = { name, content, type }; });
await app.click({ id: 'export-collection', dataset: {} });
assert.equal(download.name, 'cardcheck-collection.csv');
assert.ok(download.content.includes('"\'=QA card"'), 'Spreadsheet formula-like names must be escaped in CSV');
pass('CSV export includes data and escapes formula-like card names');

await app.click({ id: 'export-pack', dataset: {} });
const pack = JSON.parse(download.content);
assert.equal(pack.custom.length, 1);
assert.equal(pack.binder[0].quantity, 1);
const importing = value => app.importBackup({ size: 1000, text: async () => JSON.stringify(value) });
app.configure({ config: catalog });
await importing(pack);
assert.equal(state().custom[0].id, 'custom-qa');
assert.equal(state().binder[0].quantity, 1);
assert.equal(state().cards.length, 3);
pass('backup export/import restores custom artwork, catalog, and collection');

const beforeInvalid = app.state();
await assert.rejects(importing({ ...pack, custom: [customCard, customCard] }), /Duplicate card IDs/);
assert.equal(app.state(), beforeInvalid);
await assert.rejects(importing({ ...pack, binder: [{ ...pack.binder[0], quantity: -1 }] }), /Invalid collection entry/);
assert.equal(app.state(), beforeInvalid);
pass('invalid backups are rejected before replacing current state');

await app.click({ dataset: { deleteItem: '0' } });
assert.equal(state().binder.length, 0);
assert.equal(element('#stat-total').textContent, '0');
assert.ok(writes.some(write => write.key === 'binder' && write.value.length === 0));
pass('remove-all clears the item and persists the empty collection');
console.log(`\n${passed} state and backup checks passed. Browser interaction remains a separate check.`);
