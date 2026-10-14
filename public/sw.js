// Keep personal records and media off persistent shared-device caches.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            '<html lang="ru"><meta name="viewport" content="width=device-width"><body style="font:18px system-ui;padding:40px"><h1>Нет подключения</h1><p>Для просмотра сезонов нужен интернет. Прогресс сохранён на сервере.</p><button onclick="location.reload()">Попробовать снова</button></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          ),
      ),
    );
  }
});
