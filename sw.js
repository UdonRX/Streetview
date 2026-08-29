/* Streetview Journey v0.1.11 */
const SHELL_CACHE = 'streetview-shell-v0.1.11';
const IMAGE_CACHE = 'streetview-images-v0.1.0';
const SHELL = ['/', '/index.html', '/styles.css?v=0.1.6', '/app.js?v=0.1.11', '/manifest.webmanifest'];
const IMAGE_LIMIT = 80;
self.addEventListener('install', event => { event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil((async()=>{ const keys=await caches.keys(); await Promise.all(keys.filter(k=>![SHELL_CACHE,IMAGE_CACHE].includes(k)).map(k=>caches.delete(k))); await self.clients.claim(); })()); });
async function trimImages(cache){ const keys=await cache.keys(); while(keys.length>IMAGE_LIMIT) await cache.delete(keys.shift()); }
self.addEventListener('fetch', event => {
  const request=event.request; if(request.method!=='GET') return; const url=new URL(request.url);
  if(request.destination==='image' && url.origin!==self.location.origin){
    if(request.mode==='cors'){ event.respondWith(fetch(request)); return; }
    event.respondWith((async()=>{ const cache=await caches.open(IMAGE_CACHE); const hit=await cache.match(request); if(hit)return hit; const response=await fetch(request); if(response.ok||response.type==='opaque'){ await cache.put(request,response.clone()); trimImages(cache).catch(()=>{}); } return response; })()); return;
  }
  if(url.origin===self.location.origin && !url.pathname.startsWith('/api/')){
    event.respondWith((async()=>{ const cache=await caches.open(SHELL_CACHE); try{ const response=await fetch(request); if(response.ok) await cache.put(request,response.clone()); return response; } catch(error){ const hit=await cache.match(request); if(hit)return hit; throw error; } })());
  }
});
