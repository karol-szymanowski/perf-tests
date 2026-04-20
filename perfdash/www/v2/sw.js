const CACHE_NAME = 'perfdash-v2-cache-v13'; // Bumped version
const STALE_THRESHOLD = 10 * 60 * 1000;

const urlsToCache = [
    './',
    './index.html',
    './metric-details.html'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const forceReload = event.request.headers.get('Cache-Control') === 'no-cache' || 
                        event.request.headers.get('Pragma') === 'no-cache';

    // API requests strategy: Cache First, Revalidate if Stale
    if (url.pathname.startsWith('/jobnames') || 
        url.pathname.startsWith('/metriccategorynames') || 
        url.pathname.startsWith('/metricnames') || 
        url.pathname.startsWith('/buildsdata') || 
        url.pathname.startsWith('/config')) {
        
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(event.request).then(cachedResponse => {
                    const fetchPromise = fetch(event.request).then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200) {
                            var r1 = networkResponse.clone();
                            r1.blob().then(blob => {
                                var headers = new Headers(r1.headers);
                                headers.append('X-Cache-Timestamp', Date.now().toString());
                                cache.put(event.request, new Response(blob, {
                                    status: r1.status,
                                    statusText: r1.statusText,
                                    headers: headers
                                }));
                            });
                        }
                        return networkResponse;
                    });

                    if (cachedResponse && !forceReload) {
                        const timestamp = cachedResponse.headers.get('X-Cache-Timestamp');
                        if (timestamp) {
                            const age = Date.now() - parseInt(timestamp);
                            if (age < STALE_THRESHOLD) {
                                return cachedResponse;
                            }
                        }
                        event.waitUntil(fetchPromise);
                        return cachedResponse;
                    }
                    
                    return fetchPromise;
                });
            })
        );
        return;
    }

    // Static assets strategy: Stale-While-Revalidate with Cache on Miss
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    // Stale-While-Revalidate
                    fetch(event.request).then(newResponse => {
                        if (newResponse && newResponse.status === 200) {
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, newResponse));
                        }
                    });
                    return response;
                }
                
                // Miss - fetch and cache!
                return fetch(event.request).then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200) {
                        var responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
                    }
                    return networkResponse;
                });
            })
    );
});
