// ShopRemind Service Worker
// Handles background sync and push notifications

const CACHE_NAME = 'shopremind-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/edit.html',
  '/addstore.html',
  '/manifest.json',
  '/shopremindlogo-192.png',
  '/shopremindlogo-512.png'
];

// ── Install — cache app shell ─────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── Activate — clean old caches ───────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch — serve from cache, fall back to network ─
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ── Background sync message from main app ─────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_PROXIMITY') {
    const { stores, userLat, userLng } = e.data;
    checkAndNotify(stores, userLat, userLng);
  }
});

// ── Proximity check + notification ────────────────
function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Track which stores we've already notified this session
const notifiedThisSession = new Set();

function checkAndNotify(stores, userLat, userLng) {
  if (!stores || userLat == null) return;

  stores.forEach(store => {
    if (!store.lat) return;
    const dist = distMeters(userLat, userLng, store.lat, store.lng);
    const radius = store.radius || 200;

    // Key resets every 10 minutes so you get re-notified if you leave and return
    const key = store.id + '_' + Math.floor(Date.now() / 600000);

    if (dist <= radius && !notifiedThisSession.has(key)) {
      notifiedThisSession.add(key);
      const remaining = (store.items || []).filter(i => !i.done).length;
      const total     = (store.items || []).length;

      self.registration.showNotification(`📍 You're near ${store.name}!`, {
        body: remaining > 0
          ? `${remaining} of ${total} item${total !== 1 ? 's' : ''} still on your list.`
          : total > 0
          ? 'All items checked off — good job!'
          : 'You have a list for this store.',
        icon:  '/shopremindlogo-192.png',
        badge: '/shopremindlogo-192.png',
        tag:   store.id,
        renotify: false,
        data: { storeId: store.id, url: '/edit.html?id=' + store.id }
      });
    }
  });
}

// ── Notification click — open the list ────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url)
    ? e.notification.data.url
    : '/index.html';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // If app is already open, focus it
      for (const client of list) {
        if (client.url.includes('shopremind') && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
