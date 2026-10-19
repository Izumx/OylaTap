// No persistent caching of personal records, audio or videos on shared devices.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
const offlinePage = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101112"><title>OylaTap · Offline</title>
<style>body{margin:0;background:#15181a;color:#edf2ef;font:16px/1.7 system-ui,sans-serif}main{max-width:480px;margin:12vh auto;padding:28px}h1{font-size:30px;line-height:1.2}p{color:#b7c4bd}button{font:inherit;padding:12px 18px;border:1px solid #68877a;border-radius:12px;background:#a8cdbb;color:#15271d;cursor:pointer}nav{display:flex;gap:10px;margin-bottom:36px}nav button{background:transparent;color:#c1d6cb;padding:8px 14px}button:focus-visible{outline:3px solid white;outline-offset:3px}[hidden]{display:none}</style></head>
<body><main><nav aria-label="Language"><button onclick="language('ru')" lang="ru">Русский</button><button onclick="language('kk')" lang="kk">Қазақша</button></nav>
<section id="ru" lang="ru"><h1>Нет подключения</h1><p>Для просмотра уроков нужен интернет. Ранее отправленные результаты останутся в аккаунте.</p><p>Новые ответы можно отправить после подключения.</p><button onclick="location.reload()">Попробовать снова</button></section>
<section id="kk" lang="kk" hidden><h1>Интернет байланысы жоқ</h1><p>Сабақтарды көру үшін интернет қажет. Бұрын жіберілген нәтижелер аккаунтта сақталады.</p><p>Жаңа жауаптарды байланыс қалпына келгеннен кейін жіберуге болады.</p><button onclick="location.reload()">Қайта көру</button></section></main>
<script>function language(value){document.documentElement.lang=value;document.getElementById('ru').hidden=value!=='ru';document.getElementById('kk').hidden=value!=='kk';}try{language(localStorage.getItem('oylatap-locale')==='kk'?'kk':'ru')}catch{}</script></body></html>`;
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(offlinePage, {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          }),
      ),
    );
  }
});
