/* Independent, dependency-free guard: keep this before the application bundle. */
(function () {
  'use strict';
  var ready = false;
  var failure = null;
  var timer = setTimeout(function () {
    fail(new Error('Startup took too long. Close other Nabu tabs, then retry. Your saved words have not been reset.'));
  }, 12000);
  function stage(message) {
    var node = document.getElementById('startup-status');
    if (node) node.textContent = message;
  }
  function fail(error) {
    if (ready || failure) return;
    failure = error || new Error('The application could not start.');
    clearTimeout(timer);
    var main = document.getElementById('main');
    if (!main) return;
    var panel = document.createElement('section');
    panel.className = 'fatal';
    panel.setAttribute('role', 'alert');
    var title = document.createElement('h1');
    title.textContent = 'Nabu could not finish starting.';
    var detail = document.createElement('p');
    detail.id = 'startup-error';
    detail.textContent = failure.message || String(failure);
    var safety = document.createElement('p');
    safety.textContent = 'Your library has not been reset. Do not clear browser site data; that can remove your saved words.';
    var actions = document.createElement('div');
    actions.className = 'button-row';
    var retry = document.createElement('a');
    retry.className = 'button primary';
    retry.href = location.href;
    retry.textContent = 'Retry loading';
    var repair = document.createElement('a');
    repair.className = 'button secondary';
    repair.href = './nabu-repair.html';
    repair.textContent = 'Repair app loading';
    actions.appendChild(retry);actions.appendChild(repair);
    panel.appendChild(title);panel.appendChild(detail);panel.appendChild(safety);panel.appendChild(actions);
    var help = document.createElement('p');
    help.className = 'small-print';
    help.textContent = 'Repair refreshes the app files, not the word database. A storage-permission problem still requires allowing storage in your browser.';
    panel.appendChild(help);
    main.replaceChildren(panel);
    window.__nabuStartupError = detail.textContent;
  }
  window.NabuStartup = {
    stage: stage,
    fail: fail,
    ready: function () {
      ready = true;
      clearTimeout(timer);
      window.__nabuReady = true;
      delete window.__nabuStartupError;
      document.documentElement.setAttribute('data-nabu-ready', 'true');
    }
  };
  window.addEventListener('error', function (event) {
    if (event.error) fail(event.error);
    else if (event.target && event.target.tagName === 'SCRIPT') fail(new Error('An application script was blocked or missing. Use Repair app loading.'));
  }, true);
  window.addEventListener('unhandledrejection', function (event) { fail(event.reason); });
})();
