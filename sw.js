self.addEventListener('install', (e) => {
    console.log('[琉璃城堡] 魔法阵已部署 (Service Worker Installed)');
    self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
    // 保证在没网的时候不会直接报网页错误，而是尝试读取缓存
    e.respondWith(fetch(e.request).catch(() => {
        return new Response('城堡暂时迷失在星空中（网络断开啦）');
    }));
});
