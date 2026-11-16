import { CardRecognizer } from './recognizer.js';
import { openStorage, readState, writeState } from './storage.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(value);
const recognizer = new CardRecognizer();
let config, custom = [], extras = {}, binder = [], selectedVariant = 'sm10-205';
let cards = [], ready = new Set(), imageSources = {}, stream, scanning = false, training = false, lastCard, toastTimer;
let currentView = 'scan', referenceTarget, storageAvailable = true;

function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500);
}
function notice(message) { $('#global-notice').textContent = message; $('#global-notice').hidden = !message; }
async function save(key, value) {
  try { await writeState(key, value); return true; }
  catch (error) { storageAvailable = false; notice('Browser storage is unavailable or full. Your changes work for this session. Export a backup before leaving.'); toast(error.message); return false; }
}
function activeCards() {
  const base = config.cards.map(card => ['sm10-204','sm10-205'].includes(card.id) ? [...config.cards, ...config.alternatives].find(item => item.id === selectedVariant) || card : card);
  return [...base, ...custom].slice(0,8).map(card => ({...card, references:[...(card.references || []), ...(extras[card.id] || [])]}));
}
function imageTag(card, className = '') {
  const source = imageSources[card.id] || card.image || 'assets/card-placeholder.svg';
  return `<img class="card-image ${className}" src="${escapeHTML(source)}" data-card-id="${escapeHTML(card.id)}" alt="${escapeHTML(card.name + ' ' + card.number)}" loading="lazy">`;
}
document.addEventListener('error', event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.classList.contains('card-image')) return;
  const card = [...cards, ...binder.map(item => item.card)].find(item => item.id === image.dataset.cardId);
  if (!image.dataset.retried && card?.sourceUrl && image.getAttribute('src') !== card.sourceUrl) {
    image.dataset.retried = 'yes'; image.src = card.sourceUrl;
  } else if (!image.src.endsWith('/assets/card-placeholder.svg')) {
    image.src = 'assets/card-placeholder.svg'; image.alt = 'Reference image needed';
  }
}, true);

function switchView(view) {
  if (!['scan','collection','catalog'].includes(view)) view = 'scan';
  currentView = view;
  if (view !== 'scan') stopCamera();
  $$('.view').forEach(element => { element.hidden = element.id !== `view-${view}`; });
  $$('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
  if (location.hash !== '#' + view) history.replaceState(null,'','#' + view);
  if (view === 'collection') renderCollection();
}

async function trainCatalog() {
  if (training || scanning) return;
  training = true; cards = activeCards(); ready = new Set();
  $('#model-state').textContent = 'Building local references…';
  $('#catalog-load-state').textContent = 'Building local references…';
  $('#scan-status').textContent = 'Preparing card references. First-time image downloads may take a moment.';
  updateBusy(); renderCatalog();
  try {
    const report = await recognizer.load(cards);
    ready = new Set(report.loaded); imageSources = report.imageSources || {};
    const message = `${ready.size} / ${cards.length} cards ready`;
    $('#model-state').textContent = message;
    $('#catalog-load-state').textContent = message;
    $('#scan-status').textContent = ready.size ? 'Ready when you are. Keep the whole card visible and avoid glare.' : 'Reference images needed. Open My catalog and add a reference photo, or run the setup download.';
    $('#catalog-summary').textContent = `${cards.length} cards in your catalog. ${8-cards.length} slots to explore.`;
    if (report.failed.length) notice(`${report.failed.length} card reference${report.failed.length>1?'s are':' is'} unavailable. Open My catalog to add your own photo, or run npm run setup before hosting.`);
    else if (storageAvailable) notice('');
  } catch (error) { notice(error.message); $('#model-state').textContent = 'Reference setup needed'; $('#scan-status').textContent = error.message; }
  finally { training = false; updateBusy(); renderCatalog(); cacheReadyReferences(); }
}

function updateBusy() {
  for (const selector of ['#take-photo','#upload-photo','#sample-umbreon','#sample-gardevoir','#add-card','#import-pack']) $(selector).disabled = scanning || training;
  $('#viewfinder').classList.toggle('scanning', scanning);
  $$('[data-reference],[data-remove-card],[data-switch-variant],[data-remove-references]').forEach(button => { button.disabled = scanning || training; });
  $('#add-card').disabled = scanning || training || cards.length >= 8;
  if ($('#empty-add-card')) $('#empty-add-card').disabled = scanning || training;
}
function stopCamera() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; $('#camera').srcObject = null; $('#camera').hidden = true;
  $('#take-photo').hidden = true; $('#stop-camera').hidden = true; $('#start-camera').hidden = false; $('#camera-mode').hidden = true;
  $('#scan-guide').hidden = !$('#photo-preview').hidden;
  if ($('#photo-preview').hidden) $('#scanner-placeholder').hidden = false;
}
async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('#scan-status').textContent = 'The live camera needs HTTPS or localhost. You can still upload or take a photo.';
    $('#capture-input').click(); return;
  }
  $('#start-camera').disabled = true;
  let acquired;
  try {
    acquired = await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1600},height:{ideal:1200}}});
    if (currentView !== 'scan' || document.hidden) { acquired.getTracks().forEach(track => track.stop()); return; }
    stopCamera(); stream = acquired;
    const video = $('#camera'); video.srcObject = stream; video.hidden = false;
    $('#photo-preview').hidden = true; $('#scanner-placeholder').hidden = true; $('#scan-guide').hidden = false;
    await video.play();
    $('#take-photo').hidden = false; $('#stop-camera').hidden = false; $('#start-camera').hidden = true; $('#camera-mode').hidden = false;
    $('#viewfinder-label').textContent = 'Keep all four corners inside the guide.';
    $('#viewfinder-hint').textContent = 'Tap Scan card when the picture is sharp';
    $('#scan-status').textContent = 'Camera ready. Position one card inside the guide.';
  } catch (error) {
    acquired?.getTracks().forEach(track => track.stop()); stopCamera();
    $('#scan-status').textContent = error.name === 'NotAllowedError' ? 'Camera access was declined. Upload a photo, or enable camera access in Safari settings.' : 'Camera unavailable. Choose Upload photo, or try again in a top-level Safari tab.';
    toast('You can use Upload photo instead.');
  } finally { $('#start-camera').disabled = false; }
}
function videoFrame() {
  const video = $('#camera');
  if (!video.videoWidth || !video.videoHeight) throw new Error('The camera is still focusing. Please try again.');
  // Match the visible object-fit:cover preview, then crop the actual guide.
  const box = $('#viewfinder').getBoundingClientRect(), guide = $('#scan-guide').getBoundingClientRect();
  const scale = Math.max(box.width/video.videoWidth, box.height/video.videoHeight);
  const offsetX = (box.width-video.videoWidth*scale)/2, offsetY = (box.height-video.videoHeight*scale)/2;
  const x = Math.max(0,(guide.left-box.left-offsetX)/scale), y = Math.max(0,(guide.top-box.top-offsetY)/scale);
  const width = Math.min(video.videoWidth-x,guide.width/scale), height = Math.min(video.videoHeight-y,guide.height/scale);
  const canvas = document.createElement('canvas'); canvas.width = Math.round(width); canvas.height = Math.round(height);
  canvas.getContext('2d').drawImage(video,x,y,width,height,0,0,canvas.width,canvas.height);
  return canvas;
}

async function decodeImage(source) {
  return new Promise((resolve,reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Error('The image took too long to load. Add a local reference photo in My catalog.')), 12000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('Could not read that image. Try a JPG or PNG, or add a reference in My catalog.')); };
    image.src = source;
  });
}
async function fileCanvas(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  if (file.size > 25*1024*1024) throw new Error('Please choose an image smaller than 25 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await decodeImage(url); const ratio = Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(image.naturalWidth*ratio)); canvas.height = Math.max(1,Math.round(image.naturalHeight*ratio));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height); return canvas;
  } finally { URL.revokeObjectURL(url); }
}
async function referenceData(file) {
  const original = await fileCanvas(file), ratio = Math.min(1,960/Math.max(original.width,original.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(original.width*ratio); canvas.height = Math.round(original.height*ratio);
  const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(original,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',.9);
}
function showPhoto(canvas) {
  const preview = $('#photo-preview'); preview.width = canvas.width; preview.height = canvas.height;
  preview.getContext('2d').drawImage(canvas,0,0); preview.hidden = false;
  $('#scanner-placeholder').hidden = true; $('#scan-guide').hidden = true;
}
async function scan(canvas, isReference = false) {
  if (training || scanning) return;
  if (!ready.size) { toast('Add a reference photo in My catalog before scanning.'); return; }
  scanning = true; updateBusy(); stopCamera(); showPhoto(canvas);
  $('#viewfinder-label').textContent = isReference ? 'Reference-image test' : 'Checking visual features…';
  $('#viewfinder-hint').textContent = isReference ? 'This tests the setup; use fresh photos to assess accuracy.' : 'Processed locally. Your photo is not uploaded.';
  $('#scan-status').textContent = 'Comparing the image with your local card references…';
  try {
    const result = await recognizer.recognize(canvas);
    $('#scan-status').textContent = `${result.message} (${(result.elapsedMs/1000).toFixed(1)}s)`;
    $('#viewfinder-label').textContent = isReference ? 'Reference test complete' : result.status === 'matched' ? 'A match worth a closer look.' : 'Let’s take another look.';
    $('#viewfinder-hint').textContent = 'Verify the name, number and artwork before saving.';
    renderResult(result,isReference);
    if (matchMedia('(max-width: 760px)').matches) $('#results-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  } catch (error) { $('#scan-status').textContent = error.message; toast(error.message); }
  finally { scanning = false; updateBusy(); }
}

function priceRows(card) {
  if (!Array.isArray(card.demoPrices) || !card.demoPrices.length) return '<p class="price-caption">No sample price data for this card.</p>';
  const labels = ['TCGplayer example','eBay sold example','Cardmarket example'];
  return `<div class="sample-label">Sample market comparison <span>DEMO DATA</span></div><div class="price-amount">${money(card.demoPrices.reduce((a,b)=>a+b,0)/card.demoPrices.length)}</div><p class="price-caption">Illustrative average · USD · not a current market value</p><table class="price-table" aria-label="Fictional example prices"><tbody>${card.demoPrices.map((price,i)=>`<tr><th scope="row">${labels[i] || 'Example quote'}</th><td>${money(price)}</td></tr>`).join('')}</tbody></table>`;
}
function renderResult(result,isReference = false,manualCard = null) {
  $('#result-empty').hidden = true; $('#result-content').hidden = false;
  const top = result?.candidates?.[0], card = manualCard || result?.card || (result?.status === 'uncertain' ? top?.card : null);
  lastCard = card;
  if (!card) {
    $('#result-content').innerHTML = `<div class="result-error"><p class="eyebrow">MORE CLARITY NEEDED</p><h2>No confident match.</h2><p>This photo did not match a card in your current catalog.</p><ul><li>Fill the frame with a single card.</li><li>Use even lighting and reduce foil glare.</li><li>Keep all four corners visible.</li><li>Check that this exact artwork is in My catalog.</li></ul><button class="btn primary full-width" data-action="rescan">Try another photo</button><button class="btn secondary full-width" data-action="catalog" style="margin-top:10px">Check my catalog</button></div>`;
    return;
  }
  const uncertain = result?.status === 'uncertain', manual = !!manualCard;
  const query = encodeURIComponent(`${card.name} ${card.set} ${card.number}`);
  $('#result-content').innerHTML = `<div class="result-top"><p class="eyebrow">${manual?'CATALOG DETAILS':isReference?'REFERENCE TEST':'SCAN RESULT'}</p><span class="status-chip ${uncertain||manual?'warning':''}">${manual?'Selected manually':uncertain?'Possible match':'Visual match found'}</span></div><div class="result-body"><div class="identified-card">${imageTag(card)}<div><h2>${escapeHTML(card.name)}</h2><p>${escapeHTML(card.set)} · ${escapeHTML(card.number)}</p><p>${escapeHTML(card.year || '')}</p><span class="rarity-pill">✦ ${escapeHTML(card.variant)}</span></div></div>${top&&!manual?`<p class="evidence">${top.inliers} geometric feature matches · ${Math.round(top.coverage*100)}% reference coverage<br>Match strength: ${top.score}/99 · not a probability</p>`:''}${uncertain?'<p class="result-note">This match is uncertain. Retake the photo, or carefully verify the printed number and artwork before adding it.</p>':''}${isReference?'<p class="result-note">This used the reference image itself. A successful setup test does not measure real-photo accuracy.</p>':''}<label class="condition-row" for="result-condition">Condition <span><select id="result-condition"><option>Near Mint</option><option>Lightly Played</option><option>Moderately Played</option><option>Heavily Played</option><option>Damaged</option><option>Unspecified</option></select></span></label><p class="price-caption">Selected by you · no automatic grading</p>${priceRows(card)}<p class="result-disclaimer">All prices are fictional classroom examples. Condition does not change these samples. Authenticity is unverified. Confirm the card number and variant yourself.</p><button id="save-result" class="btn primary full-width">${uncertain?'I verified this card — add it':'Confirm card & add to collection'} <span aria-hidden="true">+</span></button><div class="market-links"><a class="text-button" href="https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${query}&view=grid" target="_blank" rel="noopener noreferrer">Search TCGplayer ↗</a><a class="text-button" href="https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Complete=1&LH_Sold=1" target="_blank" rel="noopener noreferrer">Search eBay sold ↗</a></div></div>`;
}

function cardSnapshot(card) { const {references, ...snapshot} = card; return snapshot; }
async function addToCollection() {
  if (!lastCard) return;
  const condition = $('#result-condition').value;
  const item = binder.find(item => item.card.id === lastCard.id && item.condition === condition);
  if (item) item.quantity++; else binder.push({card:cardSnapshot(lastCard),condition,quantity:1,addedAt:new Date().toISOString()});
  await save('binder',binder); renderCollection(); toast(`${lastCard.name} added to your collection.`);
}
function renderCollection() {
  const total = binder.reduce((sum,item)=>sum+item.quantity,0), unique = new Set(binder.map(item=>item.card.id)).size;
  let noPrices = false;
  const value = binder.reduce((sum,item) => { const prices = item.card.demoPrices; if(!prices?.length) { noPrices = true; return sum; } return sum+prices.reduce((a,b)=>a+b,0)/prices.length*item.quantity; },0);
  $('#collection-count').textContent = String(total); $('#stat-total').textContent = String(total); $('#stat-unique').textContent = String(unique);
  $('#stat-value').textContent = money(value)+(noPrices?'*':'');
  $('#stat-value').nextElementSibling.textContent = noPrices ? '*Cards without sample prices excluded' : 'Fictional prices; not a valuation';
  $('#export-collection').disabled = !binder.length;
  $('#collection-list').innerHTML = binder.length ? binder.map((item,index)=>`<article class="collection-row">${imageTag(item.card)}<div class="collection-info"><h3>${escapeHTML(item.card.name)}</h3><p>${escapeHTML(item.card.set)} · ${escapeHTML(item.card.number)} · ${escapeHTML(item.condition)}</p></div><div class="quantity-controls" aria-label="Quantity for ${escapeHTML(item.card.name)}"><button data-quantity="-1" data-index="${index}" aria-label="Remove one ${escapeHTML(item.card.name)}">−</button><span>${item.quantity}</span><button data-quantity="1" data-index="${index}" aria-label="Add one ${escapeHTML(item.card.name)}">+</button></div><button class="text-button danger" data-delete-item="${index}" aria-label="Remove all ${escapeHTML(item.card.name)}">Remove</button></article>`).join('') : '<div class="empty-state"><p class="eyebrow">THE FIRST CARD IS THE START</p><h2>Let’s build your collection.</h2><p>Scan a card and confirm its details to save it here.<br>Your collection stays in this browser.</p><button class="btn primary" data-action="rescan">Scan your first card ↗</button></div>';
}
function renderCatalog() {
  $('#catalog-capacity').textContent = `${cards.length} / 8 slots`;
  $('#catalog-list').innerHTML = cards.map(card => `<article class="catalog-card"><div class="catalog-image">${imageTag(card)}</div><h3>${escapeHTML(card.name)}</h3><p>${escapeHTML(card.set)} · ${escapeHTML(card.number)}</p><p>${escapeHTML(card.variant)}</p><span class="status-chip ${ready.has(card.id)?'':'warning'}">${training?'Building reference…':ready.has(card.id)?'Ready to scan':'Reference needed'} · ${1+(card.references?.length || 0)} photo${card.references?.length?'s':''}</span><div class="catalog-actions"><button class="text-button" data-reference="${escapeHTML(card.id)}">+ Add reference</button><button class="text-button" data-card-details="${escapeHTML(card.id)}">View card details ↗</button>${['sm10-204','sm10-205'].includes(card.id)?`<button class="text-button" data-switch-variant>Use ${card.id === 'sm10-205'?'204/214 Full Art':'205/214 Alternate Art'} instead</button>`:''}${(extras[card.id]?.length)?`<button class="text-button danger" data-remove-references="${escapeHTML(card.id)}">Remove extra references</button>`:''}${custom.some(item=>item.id===card.id)?`<button class="text-button danger" data-remove-card="${escapeHTML(card.id)}">Remove from catalog</button>`:''}</div></article>`).join('') + (cards.length<8?`<button class="catalog-card empty-slot" id="empty-add-card"><div><span>+</span><p>${8-cards.length} more cards to discover</p></div></button>`:'');
  updateBusy();
}

async function cacheReadyReferences() {
  // Cache only public reference artwork. Scanned photos never enter this cache.
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({type:'CACHE_REFERENCES',urls:Object.values(imageSources).filter(source=>!source.startsWith('data:')).map(source=>new URL(source,location.href).href)});
  } catch { /* Scanning remains available even when CacheStorage is disabled. */ }
}
function openAddDialog() { if (training || scanning) return; if (cards.length>=8) { toast('Your eight catalog slots are full. Remove a custom card first.'); return; } $('#card-form').reset(); $('#card-dialog').showModal(); }
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content],{type}));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const validPhoto = value => typeof value === 'string' && value.length < 2500000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
function textField(object,key,max=100) { if(typeof object?.[key] !== 'string' || !object[key].trim() || object[key].length>max) throw new Error(`Invalid ${key} in backup.`); return object[key].trim(); }
function validateCard(raw, customCard = true) {
  const card = {id:textField(raw,'id'),name:textField(raw,'name'),set:textField(raw,'set'),number:textField(raw,'number',30),variant:textField(raw,'variant',80)};
  if (customCard) { if(!card.id.startsWith('custom-') || !validPhoto(raw.image)) throw new Error('A custom card is missing a valid reference photo.'); card.image=raw.image; }
  if(raw.demoPrices !== undefined) { if(!Array.isArray(raw.demoPrices)||raw.demoPrices.length>3||raw.demoPrices.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e8)) throw new Error('Invalid example prices.'); card.demoPrices=raw.demoPrices; }
  return card;
}
async function importBackup(file) {
  if(training || scanning) throw new Error('Please wait for the current scan or reference build to finish.');
  if(!file || file.size>40*1024*1024) throw new Error('Choose a CardCheck backup smaller than 40 MB.');
  let pack; try { pack=JSON.parse(await file.text()); } catch { throw new Error('This is not a valid JSON backup.'); }
  if(pack?.format!=='cardcheck-backup'||pack.version!==1||!Array.isArray(pack.custom)||pack.custom.length>6||!Array.isArray(pack.binder)||pack.binder.length>500) throw new Error('Unsupported CardCheck backup.');
  const importedCustom=pack.custom.map(raw=>validateCard(raw));
  if(importedCustom.length+config.cards.length>8) throw new Error('This backup would exceed the eight-card catalog limit.');
  const all=[...config.cards,...config.alternatives,...importedCustom];
  if(new Set(importedCustom.map(card=>card.id)).size!==importedCustom.length) throw new Error('Duplicate card IDs in backup.');
  const importedExtras={};
  for(const [id,photos] of Object.entries(pack.extras || {})) {
    if(!all.some(card=>card.id===id)||!Array.isArray(photos)||photos.length>4||!photos.every(validPhoto)) throw new Error('Invalid extra reference photos.');
    importedExtras[id]=photos;
  }
  const conditions=['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged','Unspecified'];
  const importedBinder=pack.binder.map(item=>{
    if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100000||!conditions.includes(item.condition)) throw new Error('Invalid collection entry.');
    const known=all.find(card=>card.id===item.card?.id);
    const card=known||validateCard(item.card);
    return {card:cardSnapshot(card),quantity:item.quantity,condition:item.condition,addedAt:typeof item.addedAt==='string'?item.addedAt:new Date().toISOString()};
  });
  if(!['sm10-204','sm10-205'].includes(pack.selectedVariant)) throw new Error('Invalid Gardevoir variant.');
  if (!window.confirm(`Replace this device's catalog and collection with ${importedCustom.length + config.cards.length} catalog cards and ${importedBinder.length} collection entries? Export your current backup first if you want to keep it.`)) return;
  custom=importedCustom; extras=importedExtras; binder=importedBinder; selectedVariant=pack.selectedVariant;
  await save('catalog',{custom,extras,selectedVariant}); await save('binder',binder);
  lastCard=null; $('#result-content').hidden=true; $('#result-empty').hidden=false;
  renderCollection(); await trainCatalog(); toast('Backup imported. Catalog and collection restored.');
}

async function handleClick(event) {
  const button=event.target.closest('button'); if(!button || button.disabled) return;
  try {
    if(button.dataset.view) switchView(button.dataset.view);
    if(button.hasAttribute('data-close-dialog')) button.closest('dialog').close();
    if(button.dataset.action==='rescan') { switchView('scan'); $('#start-camera').focus(); window.scrollTo({top:0,behavior:'smooth'}); }
    if(button.dataset.action==='catalog') switchView('catalog');
    if(button.id==='start-camera') await startCamera();
    if(button.id==='stop-camera') stopCamera();
    if(button.id==='take-photo') await scan(videoFrame());
    if(button.id==='upload-photo') $('#photo-input').click();
    if(button.id==='about-button') $('#about-dialog').showModal();
    if(button.id==='add-card'||button.id==='empty-add-card') openAddDialog();
    if(button.id==='save-result') await addToCollection();
    if(button.id==='sample-umbreon'||button.id==='sample-gardevoir') {
      const card=cards.find(card=>button.id==='sample-umbreon'?card.id==='swsh7-189':card.id===selectedVariant);
      if(!card||!ready.has(card.id)) { toast('This reference is not ready. Add a photo in My catalog.'); return; }
      const image=await decodeImage(imageSources[card.id] || card.image); const canvas=document.createElement('canvas'); canvas.width=image.naturalWidth; canvas.height=image.naturalHeight; canvas.getContext('2d').drawImage(image,0,0); await scan(canvas,true);
    }
    if(button.dataset.cardDetails) { const card=cards.find(card=>card.id===button.dataset.cardDetails); renderResult(null,false,card); switchView('scan'); $('#results-panel').scrollIntoView({behavior:'smooth'}); }
    if(button.dataset.reference) { referenceTarget=button.dataset.reference; if((extras[referenceTarget]?.length || 0)>=4) throw new Error('This card already has four extra references. Remove extras to replace them.'); $('#reference-input').click(); }
    if(button.hasAttribute('data-switch-variant')) { selectedVariant=selectedVariant==='sm10-205'?'sm10-204':'sm10-205'; await save('catalog',{custom,extras,selectedVariant}); await trainCatalog(); }
    if(button.dataset.removeCard) { custom=custom.filter(card=>card.id!==button.dataset.removeCard); delete extras[button.dataset.removeCard]; await save('catalog',{custom,extras,selectedVariant}); await trainCatalog(); toast('Removed from recognition catalog. Saved collection entries are kept.'); }
    if(button.dataset.removeReferences) { delete extras[button.dataset.removeReferences]; await save('catalog',{custom,extras,selectedVariant}); await trainCatalog(); }
    if(button.dataset.quantity) { const index=Number(button.dataset.index); if(!binder[index]) return; binder[index].quantity+=Number(button.dataset.quantity); if(binder[index].quantity<=0) binder.splice(index,1); renderCollection(); await save('binder',binder); }
    if(button.dataset.deleteItem !== undefined) { binder.splice(Number(button.dataset.deleteItem),1); renderCollection(); await save('binder',binder); }
    if(button.id==='export-collection') {
      const csvCell=value=>{ let safe=String(value??''); if(/^[=+@\-\t\r\n]/.test(safe)) safe="'"+safe; return '"'+safe.replace(/"/g,'""')+'"'; };
      const rows=[['Name','Set','Number','Variant','Condition','Quantity','Example average USD (fictional)'],...binder.map(item=>[item.card.name,item.card.set,item.card.number,item.card.variant,item.condition,item.quantity,item.card.demoPrices?.length?item.card.demoPrices.reduce((a,b)=>a+b,0)/item.card.demoPrices.length:''])];
      download('cardcheck-collection.csv','\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
    }
    if(button.id==='export-pack') download('cardcheck-backup.json',JSON.stringify({format:'cardcheck-backup',version:1,exportedAt:new Date().toISOString(),custom,extras,selectedVariant,binder},null,2),'application/json');
    if(button.id==='import-pack') { $('#import-input').click(); }
  } catch(error) { toast(error.message); }
}
document.addEventListener('click',handleClick);
for(const selector of ['#photo-input','#capture-input']) $(selector).addEventListener('change',async event=>{ const file=event.target.files[0]; event.target.value=''; if(!file) return; try { await scan(await fileCanvas(file)); } catch(error) { toast(error.message); } });
$('#reference-input').addEventListener('change',async event=>{
  const file=event.target.files[0]; event.target.value=''; if(!file) return;
  try { if(training || scanning) throw new Error('Please wait for the current scan or reference build to finish.'); const data=await referenceData(file); (extras[referenceTarget] ||= []).push(data); await save('catalog',{custom,extras,selectedVariant}); await trainCatalog(); toast(ready.has(referenceTarget)?'Reference added and indexed on this device.':'Photo saved. Add a sharper, more detailed reference to enable matching.'); }
  catch(error) { toast(error.message); }
});
$('#card-form').addEventListener('submit',async event=>{
  event.preventDefault(); const button=event.target.querySelector('[type=submit]'); button.disabled=true;
  try {
    if(training || scanning) throw new Error('Please wait for the current scan or reference build to finish.');
    if(cards.length>=8) throw new Error('Your eight catalog slots are full.');
    const form=new FormData(event.target), card={id:'custom-'+crypto.randomUUID(),name:String(form.get('name')).trim(),set:String(form.get('set')).trim(),number:String(form.get('number')).trim(),variant:String(form.get('variant')).trim(),image:await referenceData(form.get('image'))};
    validateCard(card); custom.push(card); await save('catalog',{custom,extras,selectedVariant}); $('#card-dialog').close(); await trainCatalog(); toast(ready.has(card.id)?'New card added. Test it with a fresh photo.':'Card saved. Add a sharper reference to enable matching.');
  } catch(error) { toast(error.message); } finally { button.disabled=false; }
});
$('#import-input').addEventListener('change',async event=>{ const file=event.target.files[0]; event.target.value=''; if(!file) return; try{ await importBackup(file); }catch(error){toast(error.message);} });
document.addEventListener('visibilitychange',()=>{ if(document.hidden) stopCamera(); });
window.addEventListener('pagehide',stopCamera);
window.addEventListener('hashchange',()=>switchView(location.hash.slice(1)));

async function init() {
  try {
    const response=await fetch('data/cards.json'); if(!response.ok) throw new Error('Could not load the card catalog. Run CardCheck from a web server, not a file URL.'); config=await response.json();
    try {
      await openStorage(); const saved=await readState('catalog',{}); custom=saved.custom || []; extras=saved.extras || {}; selectedVariant=saved.selectedVariant || 'sm10-205'; binder=await readState('binder',[]);
    } catch { storageAvailable=false; notice('Browser storage is unavailable. You can try scanning, but export a backup to keep any changes.'); }
    if('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(()=>{});
    cards=activeCards(); renderCollection(); switchView(location.hash.slice(1)||'scan'); await trainCatalog();
  } catch(error) { notice(error.message); $('#model-state').textContent='Setup needed'; $('#scan-status').textContent=error.message; }
}
init();
