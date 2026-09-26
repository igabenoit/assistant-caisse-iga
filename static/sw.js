'use strict';
const CACHE='assistant-caisse-shell-v2';
const ASSETS=['/static/offline.html','/static/style.css','/static/icons/icon-192.png','/static/icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
 // Never cache products, procedures, sessions or admin responses.
 if(request.mode==='navigate'){event.respondWith(fetch(request).catch(()=>caches.match('/static/offline.html')));return;}
 if(ASSETS.includes(url.pathname))event.respondWith(fetch(request).catch(()=>caches.match(request)));
});
