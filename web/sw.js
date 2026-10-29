const CACHE = 'yomiageman-v4';
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('yomiageman-') && key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET' || new URL(event.request.url).origin!==self.location.origin) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // Keep the small app code fresh. Models are immutable within a release.
    if(new URL(event.request.url).pathname.includes('/vendor/')) {
      const cached=await cache.match(event.request);if(cached)return cached;
    }
    try {
      const response=await fetch(event.request);
      if(response.ok && !response.redirected) await cache.put(event.request,response.clone());
      return response;
    } catch(error) {const cached=await cache.match(event.request);if(cached)return cached;throw error;}
  })());
});
