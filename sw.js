// Service Worker: E.V. Standalone PWA (v9.9-STEREOSCOPIC VR HUD)
const CACHE_NAME = 'ev-core-v9.9';

// Activos locales y pesos biométricos offline
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.min.js',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/tiny_face_detector_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/tiny_face_detector_model.bin',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/face_landmark_68_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/face_landmark_68_model.bin',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/face_recognition_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/face_recognition_model.bin'
];

// 1. INSTALACIÓN: Precarga tolerante con Promise.allSettled
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Precarga tolerante de cada recurso para no abortar si no hay red completa durante instalación
      const fetchPromises = PRECACHE_ASSETS.map((url) =>
        fetch(url, { mode: 'cors' })
          .then((response) => {
            if (response && response.status === 200) {
              return cache.put(url, response);
            }
          })
          .catch((err) => {
            console.warn('[E.V. SW] Fallo precacheando recurso:', url, err);
          })
      );
      await Promise.allSettled(fetchPromises);
      return self.skipWaiting();
    })
  );
});

// 2. ACTIVACIÓN: Purgado de versiones antiguas y toma de control inmediata
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              console.log('[E.V. SW] Purgando caché obsoleta:', name);
              return caches.delete(name);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// 3. FETCH: Manejo diferenciado de Biometría (Cache-First) vs Gemini API (Network-Only)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // A. NUNCA cachear llamadas a la API de Gemini (Network-Only)
  if (url.hostname.includes('googleapis.com') || req.method !== 'GET') {
    event.respondWith(
      fetch(req).catch((err) => {
        console.warn('[E.V. SW] Fallo de red en petición API:', err);
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: 'Sin enlace con los servidores de Gemini. Verifica tu conexión de red o clave de acceso.',
              status: 'UNAVAILABLE'
            }
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          }
        );
      })
    );
    return;
  }

  // B. Cache-First Inmediato para pesos biométricos CDN y scripts externos
  if (url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.match(req).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(req)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(req, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch((err) => {
            console.error('[E.V. SW] Error obteniendo recurso biométrico CDN:', req.url, err);
            return new Response('', { status: 408, statusText: 'Recurso biométrico no disponible offline' });
          });
      })
    );
    return;
  }

  // C. Stale-While-Revalidate para activos locales de la aplicación
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch((err) => {
          console.debug('[E.V. SW] Modo offline activo para activo local:', req.url, err);
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
