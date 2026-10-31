/*
 * Chessly — registers the service worker (sw.js) so the app can be installed on a phone
 * ("Add to Home screen") and works offline. Service workers only run over https:// or on
 * localhost, so nothing happens when index.html is opened from disk.
 */
(function () {
    'use strict';

    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
            console.warn('[Chessly] Service worker not registered:', err);
        });
    });
})();
