/* One-time cleanup worker: removes legacy Journey caches, then unregisters itself. */
self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())await caches.delete(key);await self.clients.claim();await self.registration.unregister()})())});
