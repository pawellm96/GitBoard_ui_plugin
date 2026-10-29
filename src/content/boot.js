(function (root) {
  'use strict';

  var settings = null;
  var board = null;
  var panel = null;
  var href = location.href;
  var observer = null;
  var scanQueued = false;
  var chain = Promise.resolve();
  var recent = new Map();

  function statusLine(current) {
    if (!current) return 'Откройте проект GitHub.';
    if (!current.view || current.view.layout !== 'BOARD_LAYOUT') {
      return 'Откройте вид Board, чтобы работать с колонками.';
    }
    if (!current.field) {
      return 'Сгруппируйте доску по полю, обычно Status.';
    }
    var kind = current.field.__typename === 'ProjectV2IterationField' ? 'итерации' : 'колонки';
    return 'Поле «' + current.field.name + '» задаёт ' + kind + '.';
  }

  function detectView(parsed) {
    if (parsed.view) return parsed;
    var current = document.querySelector('a[aria-current="page"][href*="/projects/"], a[aria-selected="true"][href*="/views/"]');
    if (!current) return parsed;
    var fromLink = root.GitBoardCore.parseProjectLocation(current.href);
    if (!fromLink || !fromLink.view) return parsed;
    return Object.assign({}, parsed, { view: fromLink.view });
  }

  function scheduleScan() {
    if (!(settings && settings.groupEnabled)) {
      root.GitBoardDom.clearGrouping();
      return;
    }
    if (scanQueued) return;
    scanQueued = true;
    window.requestAnimationFrame(function () {
      scanQueued = false;
      applyGrouping();
    });
  }

  function observe() {
    if (!settings || !settings.groupEnabled) {
      if (observer) observer.disconnect();
      return;
    }
    if (!observer) {
      observer = new MutationObserver(function (records) {
        var useful = false;
        for (var i = 0; i < records.length; i += 1) {
          var target = records[i].target;
          var node = target instanceof Element ? target : target.parentElement;
          if (!node || !node.closest) continue;
          if (node.closest('.gitboard-panel, .gitboard-nest')) continue;
          useful = true;
          break;
        }
        if (useful) scheduleScan();
      });
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function applyGrouping() {
    if (!board || !root.GitBoardCore.parseProjectLocation(location.href)) return;
    if (!(settings && settings.groupEnabled)) {
      root.GitBoardDom.clearGrouping();
      if (observer) observer.disconnect();
      return;
    }
    root.GitBoardDom.applyGrouping(board);
    observe();
  }

  function parentHasChildren(itemId) {
    var nodes = board && board.hierarchy && board.hierarchy.nodes;
    if (!nodes) return false;
    var paths = Object.keys(nodes);
    for (var i = 0; i < paths.length; i += 1) {
      var node = nodes[paths[i]];
      if (node.itemId === itemId) return !!(node.children && node.children.length);
    }
    return false;
  }

  function isFresh(update) {
    var key = [
      update.projectId,
      update.itemId,
      update.fieldId,
      update.clear ? 'clear' : '',
      update.singleSelectOptionId || '',
      update.iterationId || ''
    ].join('|');
    var now = Date.now();
    var previous = recent.get(key) || 0;
    recent.set(key, now);
    return now - previous > 2000;
  }

  function wait(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  function runMove(update) {
    var attempts = 0;
    function ready() {
      if (board || attempts >= 10) return Promise.resolve();
      attempts += 1;
      return wait(300).then(ready);
    }

    return ready().then(function () {
      if (!settings || !settings.followEnabled || !board || !board.field) return null;
      if (update.projectId !== board.project.id || update.fieldId !== board.field.id) return null;
      if (!isFresh(update)) return null;
      if (!parentHasChildren(update.itemId)) return null;

      panel.setStatus('Переношу субтаски…');
      return root.GitBoardApi.moveDescendants(board, update, settings).then(function (result) {
        if (!result.moved.length && !result.failed.length) {
          panel.setStatus(result.skipped.length
            ? 'Субтаски есть, но их нет на доске. Включите добавление на доску.'
            : '');
          return null;
        }
        if (result.failed.length) {
          panel.setStatus(
            'Перенесено ' + result.moved.length +
            ', ошибок ' + result.failed.length +
            ': ' + result.failed[0].message
          );
          return null;
        }

        var text = 'Субтаски перенесены: ' + result.moved.length;
        if (result.skipped.length) text += '. Пропущено: ' + result.skipped.length;
        if (settings.reloadAfterMove) {
          sessionStorage.setItem('gitboard-flash', text);
          location.reload();
          return null;
        }
        panel.setStatus(text);
        return activate();
      });
    }).catch(function (error) {
      panel.setStatus(error && error.message ? error.message : 'Не удалось перенести субтаски');
    });
  }

  function enqueueMove(update) {
    chain = chain.then(function () { return runMove(update); }, function () { return runMove(update); });
  }

  function onMessage(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var data = event.data;
    if (!data || data.source !== 'gitboard-hook' || data.type !== 'field-updates') return;
    (data.updates || []).forEach(enqueueMove);
  }

  function activate() {
    var parsed = root.GitBoardCore.parseProjectLocation(location.href);
    if (!parsed) {
      board = null;
      panel.hide();
      root.GitBoardDom.clearGrouping();
      if (observer) observer.disconnect();
      return Promise.resolve();
    }

    panel.show();
    panel.setHint('Читаю проект…');
    panel.setStatus('');
    return root.GitBoardApi.loadBoard(detectView(parsed)).then(function (next) {
      board = next;
      panel.sync(settings, board);
      panel.setHint(statusLine(board));
      var flash = sessionStorage.getItem('gitboard-flash');
      if (flash) {
        sessionStorage.removeItem('gitboard-flash');
        panel.setStatus(flash);
      }
      scheduleScan();
    }).catch(function (error) {
      board = null;
      panel.sync(settings, null);
      panel.setHint(error && error.message ? error.message : 'Не удалось прочитать проект');
    });
  }

  function boot() {
    panel = root.GitBoardPanel.mount({
      onChange: function (patch) {
        root.GitBoardSettings.save(patch).then(function (next) {
          var tokenChanged = (settings.token || '') !== (next.token || '');
          settings = next;
          panel.sync(settings, board);
          if (tokenChanged) activate();
          else scheduleScan();
        });
      }
    });

    window.addEventListener('message', onMessage);
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes[root.GitBoardSettings.KEY]) return;
        var next = Object.assign({}, root.GitBoardSettings.DEFAULTS, changes[root.GitBoardSettings.KEY].newValue || {});
        var tokenChanged = (settings.token || '') !== (next.token || '');
        settings = next;
        panel.sync(settings, board);
        if (tokenChanged && root.GitBoardCore.parseProjectLocation(location.href)) activate();
        else scheduleScan();
      });
    } catch (error) {
      /* The extension was reloaded; this page still has the previous script. */
    }

    window.setInterval(function () {
      if (location.href === href) return;
      href = location.href;
      activate();
    }, 600);

    root.GitBoardSettings.load().then(function (stored) {
      settings = stored;
      panel.sync(settings, null);
      return activate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(globalThis);
