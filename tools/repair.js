/* Repair app files only. This file never opens, resets, or deletes a library. */
(function () {
  'use strict';
  var status = document.getElementById('repair-status');
  var base = new URL('./', location.href);
  var stalled = false;
  var timer = setTimeout(function () {
    stalled = true;
    status.textContent = 'The browser has not finished refreshing the app. Close other Nabu tabs, then retry this page. Your library has not been reset.';
  }, 10000);
  function registrations() {
    if (!('serviceWorker' in navigator)) return Promise.resolve();
    return navigator.serviceWorker.getRegistrations().then(function (items) {
      return Promise.all(items.filter(function (item) { return item.scope === base.href; }).map(function (item) { return item.unregister(); }));
    });
  }
  function cachedShell() {
    if (!('caches' in window)) return Promise.resolve();
    return caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) { return name.indexOf('nabu-translate-shell-') === 0; }).map(function (name) {
        return caches.open(name).then(function (cache) {
          return cache.keys().then(function (requests) {
            return Promise.all(requests.filter(function (request) {
              var url = new URL(request.url);
              return url.origin === base.origin && url.pathname.indexOf(base.pathname) === 0;
            }).map(function (request) { return cache.delete(request); }));
          });
        });
      }));
    });
  }
  Promise.resolve().then(registrations).then(cachedShell).then(function () {
    clearTimeout(timer);
    if (stalled) return;
    status.textContent = 'App files refreshed. Opening Nabu. Your saved words and review history are unchanged.';
    var target = new URL('./', location.href);
    target.searchParams.set('nabu-repaired', String(Date.now()));
    location.replace(target.href);
  }).catch(function (error) {
    clearTimeout(timer);
    status.textContent = 'The browser blocked app repair: ' + (error.message || String(error)) + '. Allow site storage, close other Nabu tabs, then retry. Your library has not been reset.';
  });
})();
