(function () {
  'use strict';

  if (window.__gitboardHook) return;
  window.__gitboardHook = true;

  var core = window.GitBoardCore;
  if (!core) return;

  var originalFetch = window.fetch;
  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;

  var suppressUntil = 0;

  function leavesProject(url) {
    if (!url) return false;
    try {
      var parsed = new URL(String(url), location.href);
      if (parsed.origin !== location.origin) return true;
      return parsed.pathname !== location.pathname;
    } catch (error) {
      return false;
    }
  }

  if (window.navigation) {
    window.navigation.addEventListener('navigate', function (event) {
      if (Date.now() > suppressUntil) return;
      var destination = event.destination && event.destination.url;
      if (event.navigationType !== 'reload' && !leavesProject(destination)) return;
      if (event.cancelable) event.preventDefault();
    });
  }

  try {
    var reload = Location.prototype.reload;
    Location.prototype.reload = function () {
      if (Date.now() < suppressUntil) return undefined;
      return reload.apply(this, arguments);
    };
  } catch (error) {
    /* Location.reload can be non-writable; navigation blocking still applies. */
  }

  function openBoardCard(path) {
    var links = document.querySelectorAll('a[href]');
    var link = null;
    for (var i = 0; i < links.length; i += 1) {
      var candidate = links[i];
      if (candidate.closest('.gitboard-nest, .gitboard-panel')) continue;
      if (core.normalizeIssuePath(candidate.getAttribute('href')) === path) {
        link = candidate;
        break;
      }
    }
    if (!link) return;

    suppressUntil = Date.now() + 1500;
    var href = link.getAttribute('href');
    link.removeAttribute('href');
    link.click();
    window.setTimeout(function () {
      if (href != null && link.isConnected) link.setAttribute('href', href);
    }, 1500);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var data = event.data;
    if (!data || data.source !== 'gitboard-content' || data.type !== 'open-card' || !data.path) return;
    openBoardCard(data.path);
  });

  function emit(updates) {
    if (!updates || !updates.length) return;
    try {
      window.postMessage({
        source: 'gitboard-hook',
        type: 'field-updates',
        updates: updates.slice(0, 20)
      }, location.origin);
    } catch (error) {
      /* The page must keep working even if the hook cannot report a move. */
    }
  }

  function fromText(text) {
    if (!text || typeof text !== 'string' || text.length > 200000) return [];
    if (
      text.indexOf('singleSelectOptionId') === -1 &&
      text.indexOf('iterationId') === -1 &&
      text.indexOf('clearProjectV2ItemFieldValue') === -1
    ) {
      return [];
    }

    var raw = text;
    if (text.indexOf('variables=') !== -1 && text.trim().charAt(0) !== '{' && text.trim().charAt(0) !== '[') {
      try {
        var variables = new URLSearchParams(text).get('variables');
        if (variables) raw = variables;
      } catch (error) {
        raw = text;
      }
    }

    var data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      return [];
    }

    return core.extractFieldUpdates(data).concat(core.extractFieldClears(raw));
  }

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function collect(input, init) {
    var url = requestUrl(input);
    var text = null;
    if (init && typeof init.body === 'string') text = init.body;
    else if (typeof Request !== 'undefined' && input instanceof Request && /graphql/i.test(url)) {
      try {
        return input.clone().text().then(fromText).catch(function () { return []; });
      } catch (error) {
        return Promise.resolve([]);
      }
    }
    if (text && !/graphql/i.test(url) && text.indexOf('singleSelectOptionId') === -1 && text.indexOf('clearProjectV2ItemFieldValue') === -1) {
      return Promise.resolve([]);
    }
    return Promise.resolve(fromText(text));
  }

  window.fetch = function (input, init) {
    var pending;
    try {
      pending = collect(input, init);
    } catch (error) {
      pending = Promise.resolve([]);
    }

    var responsePromise = originalFetch.apply(this, arguments);
    if (!pending || typeof pending.then !== 'function') return responsePromise;

    pending.then(function (updates) {
      if (!updates || !updates.length) return;
      Promise.resolve(responsePromise).then(function (response) {
        if (response && response.ok) emit(updates);
      }).catch(function () {});
    }).catch(function () {});

    return responsePromise;
  };

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gitboardUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    var updates = [];
    try {
      if (typeof body === 'string') updates = fromText(body);
    } catch (error) {
      updates = [];
    }
    if (updates.length) {
      this.addEventListener('load', function () {
        if (this.status >= 200 && this.status < 300) emit(updates);
      });
    }
    return originalSend.apply(this, arguments);
  };
})();
