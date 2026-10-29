(function () {
  'use strict';

  if (window.__gitboardHook) return;
  window.__gitboardHook = true;

  var core = window.GitBoardCore;
  if (!core) return;

  var originalFetch = window.fetch;
  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;

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

  function collect(input, init) {
    var text = null;
    if (init && typeof init.body === 'string') text = init.body;
    else if (typeof Request !== 'undefined' && input instanceof Request) {
      try {
        return input.clone().text().then(fromText).catch(function () { return []; });
      } catch (error) {
        return Promise.resolve([]);
      }
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
