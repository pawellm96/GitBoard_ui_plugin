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

  function load() {
    return chrome.storage.local.get(KEY).then(function (stored) {
      return Object.assign({}, DEFAULTS, stored[KEY] || {});
    });
  }

  function save(patch) {
    return load().then(function (current) {
      var next = Object.assign({}, current, patch || {});
      var payload = {};
      payload[KEY] = next;
      return chrome.storage.local.set(payload).then(function () {
        return next;
      });
    });
  }

  root.GitBoardSettings = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    load: load,
    save: save
  };
})(globalThis);
