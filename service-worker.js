/**
 * Nushell Web Demo - Service Worker
 * Version: 1.0.0
 *
 * Provides offline functionality for iOS Safari and other browsers.
 * Uses cache-first strategy for optimal offline performance.
 *
 * IMPORTANT: Update CACHE_VERSION when deploying new builds!
 */

const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `nushell-pwa-${CACHE_VERSION}`;

// iOS Safari has a ~50MB cache limit per origin
const IOS_CACHE_LIMIT_MB = 50;
const IOS_CACHE_LIMIT_BYTES = IOS_CACHE_LIMIT_MB * 1024 * 1024;

/**
 * Files to precache on install.
 *
 * Since Trunk adds content hashes to filenames, we use a hybrid approach:
 * 1. Precache known static files (manifest, icons)
 * 2. Use cache-first strategy to cache hashed files on first request
 *
 * The main WASM file is typically 20-40MB. On iOS Safari with its 50MB limit,
 * this means we need to be strategic about what we precache.
 */
const PRECACHE_ASSETS = [
  // Core HTML (entry point)
  './',
  './index.html',

  // PWA manifest and icons (static, no hashes)
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
];

/**
 * Directory patterns to cache - these will be fetched and cached on first access.
 * We can't precache directories, but we cache their contents on first request.
 */
const CACHE_DIR_PATTERNS = [
  '/ace/',      // Ace editor assets (modes, workers, themes)
  '/octicons/', // GitHub octicon SVG icons
];

/**
 * File extensions that should always be cached
 */
const CACHEABLE_EXTENSIONS = [
  '.wasm',
  '.js',
  '.css',
  '.html',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
];

/**
 * Check if a URL should be cached based on extension or path
 */
function shouldCache(url) {
  const pathname = new URL(url).pathname;

  // Check if it's in a cacheable directory
  for (const pattern of CACHE_DIR_PATTERNS) {
    if (pathname.includes(pattern)) {
      return true;
    }
  }

  // Check file extension
  for (const ext of CACHEABLE_EXTENSIONS) {
    if (pathname.endsWith(ext)) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate total cache size and warn if approaching iOS limit
 */
async function checkCacheSize() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    let totalSize = 0;

    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.clone().blob();
        totalSize += blob.size;
      }
    }

    const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
    console.log(`[SW] Cache size: ${sizeMB}MB / ${IOS_CACHE_LIMIT_MB}MB`);

    if (totalSize > IOS_CACHE_LIMIT_BYTES * 0.8) {
      console.warn(`[SW] WARNING: Cache size (${sizeMB}MB) is approaching iOS Safari limit (${IOS_CACHE_LIMIT_MB}MB)!`);
      console.warn('[SW] Consider removing unused assets or splitting the cache.');
    }

    if (totalSize > IOS_CACHE_LIMIT_BYTES) {
      console.error(`[SW] ERROR: Cache size exceeds iOS Safari limit! Some assets may not be cached.`);
    }

    return totalSize;
  } catch (error) {
    console.error('[SW] Error checking cache size:', error);
    return 0;
  }
}

/**
 * Install event - Precache critical assets
 * CRITICAL: skipWaiting() is essential for iOS Safari!
 */
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing service worker ${CACHE_NAME}`);

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Cache assets one by one to handle failures gracefully
      const results = await Promise.allSettled(
        PRECACHE_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response.ok) {
              await cache.put(url, response);
              console.log(`[SW] Precached: ${url}`);
              return { url, status: 'success' };
            } else {
              console.warn(`[SW] Failed to fetch for precache: ${url} (${response.status})`);
              return { url, status: 'failed', error: response.status };
            }
          } catch (error) {
            console.warn(`[SW] Error precaching ${url}:`, error.message);
            return { url, status: 'error', error: error.message };
          }
        })
      );

      const successful = results.filter(r => r.status === 'fulfilled' && r.value.status === 'success').length;
      console.log(`[SW] Precached ${successful}/${PRECACHE_ASSETS.length} assets`);

      // Check cache size after precaching
      await checkCacheSize();

      // CRITICAL for iOS Safari: Take control immediately
      await self.skipWaiting();
      console.log('[SW] skipWaiting() called - ready to activate');
    })()
  );
});

/**
 * Activate event - Clean up old caches
 * CRITICAL: clients.claim() is essential for iOS Safari!
 */
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating service worker ${CACHE_NAME}`);

  event.waitUntil(
    (async () => {
      // Delete old cache versions
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith('nushell-pwa-') && name !== CACHE_NAME)
          .map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );

      // CRITICAL for iOS Safari: Claim all clients immediately
      await self.clients.claim();
      console.log('[SW] clients.claim() called - controlling all clients');

      // Notify clients that the SW has been updated
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => {
        client.postMessage({
          type: 'SW_ACTIVATED',
          version: CACHE_VERSION,
        });
      });
    })()
  );
});

/**
 * Fetch event - Cache-first strategy for assets
 * Falls back to network if not in cache
 */
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return;
  }

  // Skip cross-origin requests except for known CDNs
  const requestUrl = new URL(url);
  if (requestUrl.origin !== self.location.origin) {
    // Allow specific CDNs if needed, otherwise skip
    return;
  }

  // Use cache-first strategy for cacheable resources
  if (shouldCache(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        // Try cache first
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          console.log(`[SW] Cache hit: ${requestUrl.pathname}`);
          return cachedResponse;
        }

        // Not in cache, fetch from network
        console.log(`[SW] Cache miss, fetching: ${requestUrl.pathname}`);
        try {
          const networkResponse = await fetch(event.request);

          // Cache successful responses
          if (networkResponse.ok) {
            // Clone the response before caching (response can only be consumed once)
            cache.put(event.request, networkResponse.clone());
            console.log(`[SW] Cached: ${requestUrl.pathname}`);
          }

          return networkResponse;
        } catch (error) {
          console.error(`[SW] Network error for ${requestUrl.pathname}:`, error);

          // Return a basic offline response for HTML requests
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return new Response(
              '<!DOCTYPE html><html><body><h1>Offline</h1><p>Please check your connection and try again.</p></body></html>',
              { headers: { 'Content-Type': 'text/html' } }
            );
          }

          throw error;
        }
      })()
    );
  } else {
    // For non-cacheable resources, use network-first with cache fallback
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          return networkResponse;
        } catch (error) {
          // Try cache as fallback
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match(event.request);
          if (cachedResponse) {
            return cachedResponse;
          }
          throw error;
        }
      })()
    );
  }
});

/**
 * Message handler - Respond to messages from the main thread
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CHECK_CACHE_SIZE') {
    checkCacheSize().then((size) => {
      event.ports[0].postMessage({ size });
    });
  }
});

console.log(`[SW] Service worker script loaded (${CACHE_VERSION})`);
