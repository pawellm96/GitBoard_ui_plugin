(function () {
  'use strict';

  var defaults = { follow: true, addMissing: true, group: false };

  chrome.storage.local.get(defaults, function (stored) {
    document.querySelectorAll('input[data-key]').forEach(function (input) {
      var key = input.getAttribute('data-key');
      input.checked = Boolean(stored[key]);
      input.addEventListener('change', function () {
        var patch = {};
        patch[key] = input.checked;
        chrome.storage.local.set(patch);
      });
    });
  });
})();
