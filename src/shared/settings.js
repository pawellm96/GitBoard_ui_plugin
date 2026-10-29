(function (root) {
  'use strict';

  var KEY = 'gitboard-settings';
  var DEFAULTS = {
    followEnabled: true,
    groupEnabled: false,
    addMissing: true,
    reloadAfterMove: true,
    token: ''
  };

  var cached = null;

  function remember(settings) {
    cached = Object.assign({}, DEFAULTS, settings || {});
    return cached;
  }

  function load() {
    if (cached) return Promise.resolve(Object.assign({}, cached));
    try {
      return chrome.storage.local.get(KEY).then(function (stored) {
        return remember((stored && stored[KEY]) || {});
      }, function () {
        return remember(DEFAULTS);
      });
    } catch (error) {
      return Promise.resolve(remember(DEFAULTS));
    }
  }

  function save(patch) {
    var next = remember(Object.assign({}, cached || DEFAULTS, patch || {}));
    var payload = {};
    payload[KEY] = next;
    try {
      return chrome.storage.local.set(payload).then(function () {
        return Object.assign({}, next);
      }, function () {
        return Object.assign({}, next);
      });
    } catch (error) {
      return Promise.resolve(Object.assign({}, next));
    }
  }

  root.GitBoardSettings = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    load: load,
    save: save
  };
})(globalThis);
