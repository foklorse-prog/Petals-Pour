/*
  Petals & Pour — Service Worker
  ================================
  NO manual versioning needed. Ever.

  How it works:
  ─────────────
  Instead of a hardcoded CACHE_VERSION string, each cached
  entry is keyed by its URL. On every fetch we:

    1. Try the network first (always fresh content).
    2. If the network succeeds, compare the incoming response's
       ETag / Last-Modified header against what we stored last time.
       If different → replace the cache entry automatically.
    3. If the network fails (offline) → serve from cache.

  This means:
  • You never bump a version string.
  • Deploys automatically invalidate stale files.
  • Users always get fresh content when online.
  • Users still get something when offline.
*/

const CACHE = 'petals-and-pour';

// ── INSTALL ──────────────────────────────────────────────
// Pre-cache just the shell so it loads instantly offline.
// No version string — just the filenames.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(['/', '/index.html', '/manifest.json'])
    )
  );
  // Don't skipWaiting here — the page triggers it below
  // so we never interrupt an active session.
});

// ── ACTIVATE ─────────────────────────────────────────────
// Clean up any old cache buckets from previous SW versions.
// Since we only ever use one cache name, this is a no-op
// unless you renamed the cache above.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── MESSAGE ───────────────────────────────────────────────
// The page sends SKIP_WAITING after a new SW installs,
// which triggers an immediate takeover + one silent reload.
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── FETCH ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Only cache same-origin requests.
  // Let fonts, CDN scripts, Unsplash images pass through untouched.
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirstWithAutoUpdate(event.request));
});

async function networkFirstWithAutoUpdate(request) {
  const cache = await caches.open(CACHE);

  try {
    // Always hit the network
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cached = await cache.match(request);

      // Check if the content actually changed before writing.
      // Browsers include ETag or Last-Modified on most responses.
      const newEtag   = networkResponse.headers.get('etag');
      const newDate   = networkResponse.headers.get('last-modified');
      const oldEtag   = cached?.headers.get('etag');
      const oldDate   = cached?.headers.get('last-modified');

      const contentChanged =
        !cached ||                          // nothing cached yet
        (newEtag  && newEtag  !== oldEtag) ||  // ETag changed
        (newDate  && newDate  !== oldDate) ||  // Last-Modified changed
        (!newEtag && !newDate);             // no headers → always refresh

      if (contentChanged) {
        // Store a fresh copy (clone because response is a stream)
        cache.put(request, networkResponse.clone());
      }
    }

    return networkResponse;

  } catch {
    // Network failed — serve from cache, or a generic offline fallback
    const cached = await cache.match(request);
    return cached ?? cache.match('/index.html');
  }
}
