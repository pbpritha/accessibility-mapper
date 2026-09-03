// Minimal service worker — only exists so the browser considers the app
// "installable" (Add to Home Screen). No offline caching for MVP.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {});
