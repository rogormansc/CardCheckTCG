// Bump this version when publishing changed app assets.
const SCOPE = new URL('./',self.location.href);
const CACHE_PREFIX = `cardcheck-${encodeURIComponent(SCOPE.pathname)}-`;
const CACHE = `${CACHE_PREFIX}v1.0.1`;
const REQUIRED = ['./','index.html','styles.css','js/app.js','js/recognizer.js','js/storage.js','data/cards.json','manifest.webmanifest','assets/logo.svg','assets/card-placeholder.svg','assets/icon-192.png','assets/icon-512.png', 'assets/logo.png'];
const REFERENCES = ['assets/cards/umbreon-v-189.png','assets/cards/gardevoir-sylveon-gx-205.png','assets/cards/gardevoir-sylveon-gx-204.png'];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(REQUIRED.map(path=>new URL(path,SCOPE).href));
    // A missing optional card image must not break offline installation.
    await Promise.allSettled(REFERENCES.map(path=>cache.add(new URL(path,SCOPE).href)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type!=='CACHE_REFERENCES'||!Array.isArray(event.data.urls)) return;
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    for(const source of event.data.urls.slice(0,8)) {
      try {
        const url=new URL(source);
        const allowedLocal=url.origin===SCOPE.origin&&url.pathname.startsWith(SCOPE.pathname);
        if(!allowedLocal&&url.origin!=='https://images.pokemontcg.io') continue;
        const request=new Request(url,{mode:'cors',credentials:'omit'});
        if(await cache.match(request)) continue;
        const response=await fetch(request);
        if(response.ok&&response.type!=='opaque') await cache.put(request,response);
      } catch { /* Reference caching is optional; local imports remain available in IndexedDB. */ }
    }
  })());
});
self.addEventListener('fetch',event=>{
  const {request}=event, url=new URL(request.url);
  if(request.method!=='GET') return;
  const local=url.origin===SCOPE.origin&&url.pathname.startsWith(SCOPE.pathname);
  const remoteReference=url.origin==='https://images.pokemontcg.io'&&request.destination==='image';
  if(!local&&!remoteReference) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try {
      const response=await fetch(request);
      if(response.ok && response.type!=='opaque') {
        // Preserve the complete response for offline reloads.
        try { await cache.put(request,response.clone()); } catch { /* A full cache must not block a successful network response. */ }
        return response;
      }
      return await cache.match(request)||response;
    } catch(error) {
      const hit=await cache.match(request);
      if(hit) return hit;
      if(request.mode==='navigate') { const home=await cache.match(new URL('./',SCOPE).href); if(home) return home; }
      throw error;
    }
  })());
});
