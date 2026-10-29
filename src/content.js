(function () {
  'use strict';

  var core = window.GitBoardCore;
  if (!core) return;

  var settings = { follow: true, addMissing: true, group: false };
  var context = { active: false, fields: [], error: '', title: '', layout: '' };
  var model = null;
  var hierarchyLoading = false;
  var hierarchyError = '';
  var openPaths = new Set();
  var requests = new Map();
  var lastKey = '';
  var panel = null;
  var launcher = null;
  var note = null;
  var toast = null;
  var toastTimer = 0;
  var observer = null;
  var applying = false;
  var collapsed = sessionStorage.getItem('gitboard-collapsed') === '1';

  function post(message) {
    window.postMessage(Object.assign({ source: 'gitboard-content' }, message), location.origin);
  }

  function projectFromLocation() {
    return core.parseProjectLocation(location.href);
  }

  function detectView() {
    var links = document.querySelectorAll('a[href*="/views/"]');
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      var current = link.getAttribute('aria-current') || link.getAttribute('aria-selected');
      if (current !== 'page' && current !== 'true') continue;
      var match = String(link.href || '').match(/\/views\/(\d+)/);
      if (match) return Number(match[1]);
    }
    return null;
  }

  function openStorageKey() {
    return 'gitboard-open:' + location.pathname;
  }

  function loadOpen() {
    try {
      openPaths = new Set(JSON.parse(sessionStorage.getItem(openStorageKey()) || '[]'));
    } catch (error) {
      openPaths = new Set();
    }
  }

  function saveOpen() {
    sessionStorage.setItem(openStorageKey(), JSON.stringify(Array.from(openPaths)));
  }

  function showToast(text) {
    if (!text) return;
    if (!toast || !toast.isConnected) {
      toast = document.createElement('div');
      toast.className = 'gitboard-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      if (toast) toast.hidden = true;
    }, 4200);
  }

  function issuePathsIn(root) {
    var paths = new Set();
    if (!root || !root.querySelectorAll) return paths;
    var links = root.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      if (link.closest('.gitboard-nest')) continue;
      var path = core.normalizeIssuePath(link.getAttribute('href'));
      if (path) paths.add(path);
    }
    return paths;
  }

  function issuePathCount(root) {
    return issuePathsIn(root).size;
  }

  function cardFromLink(link) {
    if (link.closest('.gitboard-nest, [role="dialog"], dialog')) return null;
    var marked = link.closest('[data-gitboard-card="1"]');
    if (marked && issuePathCount(marked) === 1) return marked;

    var el = link;
    var best = link;
    while (el.parentElement && el.parentElement !== document.body) {
      var parent = el.parentElement;
      if (issuePathCount(parent) > 1 && issuePathCount(el) === 1) return el;
      var rect = parent.getBoundingClientRect();
      if (rect.height > 420 || rect.width > 680) {
        return issuePathCount(el) === 1 ? el : best;
      }
      el = parent;
      if (issuePathCount(el) === 1) best = el;
    }
    return issuePathCount(best) === 1 ? best : null;
  }

  function looksLikeBoard(parent, columns) {
    var rect = parent.getBoundingClientRect();
    if (rect.width < 240 || rect.height < 80) return false;
    if (columns.length < 2) return rect.width >= Math.min(window.innerWidth * 0.45, 520);
    var lefts = columns.map(function (column) { return column.getBoundingClientRect().left; });
    return Math.max.apply(null, lefts) - Math.min.apply(null, lefts) > 30;
  }

  function locateColumn(card) {
    var el = card;
    for (var i = 0; i < 8 && el && el.parentElement; i += 1) {
      var parent = el.parentElement;
      var columns = Array.prototype.filter.call(parent.children, function (child) {
        return child.nodeType === 1 && issuePathCount(child) >= 1;
      });
      if (columns.length && looksLikeBoard(parent, columns)) return { column: el, board: parent };
      el = parent;
    }
    return null;
  }

  function indexBoardCards() {
    var map = new Map();
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      if (link.closest('.gitboard-nest, [role="dialog"], dialog')) continue;
      var path = core.normalizeIssuePath(link.getAttribute('href'));
      if (!path || map.has(path)) continue;
      var card = cardFromLink(link);
      if (!card || issuePathCount(card) !== 1 || !locateColumn(card)) continue;
      card.dataset.gitboardCard = '1';
      card.dataset.gitboardPath = path;
      map.set(path, card);
    }
    document.querySelectorAll('[data-gitboard-card="1"]').forEach(function (card) {
      var path = card.dataset.gitboardPath;
      if (path && card.isConnected && !map.has(path)) map.set(path, card);
    });
    return map;
  }

  function safeHref(url) {
    try {
      var parsed = new URL(url, location.origin);
      if (parsed.hostname !== location.hostname && parsed.hostname !== 'github.com') return '#';
      return parsed.href;
    } catch (error) {
      return '#';
    }
  }

  function hashText(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function shape(node, tree) {
    if (!node) return null;
    return {
      title: node.title,
      status: node.status,
      state: node.state,
      onBoard: node.onBoard,
      children: (node.children || []).map(function (path) { return shape(tree.nodes[path], tree); })
    };
  }

  function stopBubble(event) {
    event.stopPropagation();
  }

  function buildList(paths, tree) {
    var list = document.createElement('ul');
    list.className = 'gitboard-list';
    paths.forEach(function (path) {
      var node = tree.nodes[path];
      if (!node) return;
      var item = document.createElement('li');
      item.className = 'gitboard-item';
      var row = document.createElement('div');
      row.className = 'gitboard-row';
      var link = document.createElement('a');
      link.className = 'gitboard-link';
      link.href = safeHref(node.url);
      link.textContent = node.title || path;
      if (String(node.state || '').toUpperCase() === 'CLOSED') link.classList.add('gitboard-closed');
      var meta = document.createElement('span');
      meta.className = 'gitboard-meta';
      var bits = [];
      if (node.number) bits.push('#' + node.number);
      if (node.status) bits.push(node.status);
      if (!node.onBoard) bits.push('не на доске');
      meta.textContent = bits.join(' · ');
      row.appendChild(link);
      if (bits.length) row.appendChild(meta);
      item.appendChild(row);
      if (node.children && node.children.length) item.appendChild(buildNest(node, tree, false));
      list.appendChild(item);
    });
    return list;
  }

  function buildNest(node, tree, isRoot) {
    var nest = document.createElement('div');
    nest.className = isRoot ? 'gitboard-nest gitboard-nest-root' : 'gitboard-nest gitboard-nest-inner';
    nest.dataset.path = node.path;
    var open = openPaths.has(node.path);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'gitboard-toggle';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    var chevron = document.createElement('span');
    chevron.className = 'gitboard-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    var label = document.createElement('span');
    label.textContent = 'Субтаски';
    var count = document.createElement('span');
    count.className = 'gitboard-count';
    count.textContent = String((node.children || []).length);
    button.appendChild(chevron);
    button.appendChild(label);
    button.appendChild(count);
    var list = buildList(node.children || [], tree);
    list.hidden = !open;
    button.addEventListener('click', function () {
      var next = !openPaths.has(node.path);
      if (next) openPaths.add(node.path);
      else openPaths.delete(node.path);
      saveOpen();
      list.hidden = !next;
      button.setAttribute('aria-expanded', next ? 'true' : 'false');
    });
    nest.addEventListener('pointerdown', stopBubble);
    nest.addEventListener('mousedown', stopBubble);
    nest.addEventListener('click', stopBubble);
    nest.appendChild(button);
    nest.appendChild(list);
    return nest;
  }

  function clearGrouping() {
    document.querySelectorAll('.gitboard-card-hidden').forEach(function (card) {
      card.classList.remove('gitboard-card-hidden');
    });
    document.querySelectorAll('.gitboard-nest-root').forEach(function (nest) { nest.remove(); });
  }

  function applyGrouping() {
    if (!settings.group || !model || applying) return;
    applying = true;
    try {
      var cards = indexBoardCards();
      var childSet = new Set(model.childPaths || []);
      cards.forEach(function (card, path) {
        if (childSet.has(path)) card.classList.add('gitboard-card-hidden');
        else card.classList.remove('gitboard-card-hidden');
      });
      (model.rootPaths || []).forEach(function (path) {
        var card = cards.get(path);
        var node = model.nodes[path];
        if (!card || !node || !node.children || !node.children.length) return;
        var sig = hashText(JSON.stringify(shape(node, model)));
        var existing = Array.prototype.find.call(card.children, function (child) {
          return child.classList && child.classList.contains('gitboard-nest-root');
        });
        if (existing && existing.dataset.sig === sig) return;
        if (existing) existing.remove();
        var nest = buildNest(node, model, true);
        nest.dataset.sig = sig;
        card.appendChild(nest);
      });
      document.querySelectorAll('.gitboard-nest-root').forEach(function (nest) {
        if (!model.rootPaths || model.rootPaths.indexOf(nest.dataset.path) === -1) nest.remove();
      });
    } finally {
      applying = false;
    }
  }

  function ensureObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(function (mutations) {
      if (!settings.group || !model) return;
      var interesting = mutations.some(function (mutation) {
        var target = mutation.target;
        if (!(target instanceof Element)) return true;
        return !target.closest('.gitboard-panel, .gitboard-toast, .gitboard-nest, .gitboard-launcher');
      });
      if (!interesting) return;
      window.clearTimeout(ensureObserver.timer);
      ensureObserver.timer = window.setTimeout(applyGrouping, 120);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  function request(type) {
    var requestId = Math.random().toString(36).slice(2);
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () {
        requests.delete(requestId);
        reject(new Error('GitHub не ответил'));
      }, 30000);
      requests.set(requestId, { resolve: resolve, reject: reject, timer: timer });
      post({ type: type, requestId: requestId });
    });
  }

  var refreshToken = 0;
  function refreshHierarchy() {
    var token = refreshToken + 1;
    refreshToken = token;
    hierarchyLoading = true;
    hierarchyError = '';
    renderNote();
    request('hierarchy').then(function (next) {
      if (token !== refreshToken || !settings.group) return;
      model = next;
      hierarchyLoading = false;
      renderNote();
      ensureObserver();
      applyGrouping();
    }).catch(function (error) {
      if (token !== refreshToken) return;
      hierarchyLoading = false;
      hierarchyError = error.message || String(error);
      renderNote();
    });
  }

  function renderNote() {
    if (!note) return;
    if (!projectFromLocation()) {
      note.textContent = '';
      return;
    }
    if (context.error) {
      note.textContent = context.error;
      return;
    }
    if (settings.group && hierarchyError) {
      note.textContent = hierarchyError;
      return;
    }
    if (settings.group && hierarchyLoading) {
      note.textContent = 'Собираю субтаски…';
      return;
    }
    var names = (context.fields || []).map(function (field) { return field.name; }).filter(Boolean);
    var text = names.length ? ('Колонки: ' + names.join(', ')) : 'Читаю проект…';
    if (settings.group && model && model.rootPaths && !model.rootPaths.length) {
      text += '. На доске нет задач с субтасками';
    }
    note.textContent = text;
  }

  function setCollapsed(next) {
    collapsed = next;
    sessionStorage.setItem('gitboard-collapsed', next ? '1' : '0');
    if (panel) panel.hidden = next;
    if (launcher) launcher.hidden = !next;
  }

  function syncCheckbox(input, key) {
    if (!input) return;
    input.checked = Boolean(settings[key]);
  }

  function buildPanel() {
    if (panel && panel.isConnected) return;
    panel = document.createElement('aside');
    panel.className = 'gitboard-panel';
    panel.innerHTML = [
      '<div class="gitboard-head">',
      '  <div class="gitboard-title">GitBoard</div>',
      '  <button type="button" class="gitboard-icon-btn" data-action="collapse" aria-label="Свернуть">–</button>',
      '</div>',
      '<label class="gitboard-option"><input type="checkbox" data-key="follow"> Переносить субтаски вместе с задачей</label>',
      '<label class="gitboard-option"><input type="checkbox" data-key="addMissing"> Добавлять субтаск на доску, если его ещё нет</label>',
      '<label class="gitboard-option"><input type="checkbox" data-key="group"> Группировать субтаски списком</label>',
      '<p class="gitboard-note"></p>'
    ].join('');
    note = panel.querySelector('.gitboard-note');
    panel.querySelector('[data-action="collapse"]').addEventListener('click', function () {
      setCollapsed(true);
    });
    panel.querySelectorAll('input[data-key]').forEach(function (input) {
      var key = input.getAttribute('data-key');
      syncCheckbox(input, key);
      input.addEventListener('change', function () {
        var patch = {};
        patch[key] = input.checked;
        chrome.storage.local.set(patch);
      });
    });
    document.body.appendChild(panel);

    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'gitboard-launcher';
    launcher.textContent = 'GitBoard';
    launcher.addEventListener('click', function () { setCollapsed(false); });
    document.body.appendChild(launcher);
    setCollapsed(collapsed);
    renderNote();
  }

  function teardown() {
    clearGrouping();
    stopObserver();
    model = null;
    if (panel) panel.remove();
    if (launcher) launcher.remove();
    panel = null;
    launcher = null;
    note = null;
  }

  function postConfig(view) {
    post({
      type: 'config',
      follow: settings.follow,
      addMissing: settings.addMissing,
      href: location.href,
      view: view
    });
  }

  function saveScroll() {
    var nodes = document.querySelectorAll('div');
    var data = [];
    for (var i = 0; i < nodes.length && data.length < 6; i += 1) {
      var el = nodes[i];
      if (el.scrollLeft > 20 || el.scrollTop > 20) {
        data.push({
          left: el.scrollLeft,
          top: el.scrollTop,
          width: el.scrollWidth,
          className: String(el.className || '').slice(0, 80)
        });
      }
    }
    sessionStorage.setItem('gitboard-scroll', JSON.stringify(data));
  }

  function restoreScroll() {
    var raw = sessionStorage.getItem('gitboard-scroll');
    sessionStorage.removeItem('gitboard-scroll');
    if (!raw) return;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      return;
    }
    window.setTimeout(function () {
      var nodes = document.querySelectorAll('div');
      data.forEach(function (item) {
        for (var i = 0; i < nodes.length; i += 1) {
          var el = nodes[i];
          if (String(el.className || '').slice(0, 80) !== item.className) continue;
          if (Math.abs(el.scrollWidth - item.width) > 80) continue;
          el.scrollLeft = item.left;
          el.scrollTop = item.top;
          break;
        }
      });
    }, 700);
  }

  function verifyOrReload(msg) {
    var text = 'Субтаски перенесены в «' + (msg.optionName || 'ту же колонку') + '»: ' + msg.moved.length;
    window.setTimeout(function () {
      try {
        var cards = indexBoardCards();
        var parent = msg.parentPath ? cards.get(msg.parentPath) : null;
        var parentColumn = parent && parent.parentElement;
        var visibles = (msg.moved || []).map(function (item) { return cards.get(item.path); }).filter(Boolean);
        var stale = !parentColumn || !visibles.length || visibles.some(function (card) {
          return card.parentElement !== parentColumn;
        });
        if (!stale) {
          showToast(text);
          return;
        }
      } catch (error) {
        /* The board markup was not readable, so reload from the saved project data. */
      }
      sessionStorage.setItem('gitboard-toast', text);
      saveScroll();
      location.reload();
    }, 900);
  }

  function onMoved(msg) {
    var moved = msg.moved || [];
    var failed = msg.failed || [];
    if (!moved.length && !failed.length) return;
    if (failed.length) {
      showToast('Перенесено: ' + moved.length + '. Ошибок: ' + failed.length + '. ' + failed[0].message);
    }
    if (!moved.length) return;
    if (settings.group) {
      sessionStorage.setItem('gitboard-dirty', '1');
      if (!failed.length) {
        showToast('Субтаски перенесены в «' + (msg.optionName || 'ту же колонку') + '»: ' + moved.length);
      }
      refreshHierarchy();
      return;
    }
    if (!failed.length) showToast('Переношу субтаски…');
    verifyOrReload(msg);
  }

  function tick() {
    var parsed = projectFromLocation();
    if (!parsed) {
      if (lastKey) {
        lastKey = '';
        teardown();
      }
      return;
    }
    if (!document.body) return;
    buildPanel();
    var view = parsed.view || detectView();
    var key = [
      location.pathname,
      view == null ? '' : view,
      settings.follow,
      settings.addMissing,
      settings.group
    ].join('|');
    if (key === lastKey) return;
    var groupChanged = lastKey && lastKey.split('|').pop() !== String(settings.group);
    lastKey = key;
    loadOpen();
    postConfig(view);
    panel.querySelectorAll('input[data-key]').forEach(function (input) {
      syncCheckbox(input, input.getAttribute('data-key'));
    });
    if (settings.group) {
      if (context.active) refreshHierarchy();
      return;
    }
    clearGrouping();
    stopObserver();
    model = null;
    if (groupChanged && sessionStorage.getItem('gitboard-dirty') === '1') {
      sessionStorage.removeItem('gitboard-dirty');
      saveScroll();
      location.reload();
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var data = event.data;
    if (!data || data.source !== 'gitboard-page') return;
    if (data.type === 'context') {
      context = data;
      renderNote();
      if (settings.group && data.active) refreshHierarchy();
      return;
    }
    if (data.type === 'hierarchy') {
      var pending = requests.get(data.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timer);
      requests.delete(data.requestId);
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve(data.model);
      return;
    }
    if (data.type === 'moved') onMoved(data);
    if (data.type === 'error') showToast(data.message || 'Ошибка GitBoard');
  });

  window.addEventListener('pointerdown', function (event) {
    var target = event.target;
    if (target instanceof Element && target.closest('.gitboard-nest')) event.stopPropagation();
  }, true);

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.follow) settings.follow = changes.follow.newValue !== false;
    if (changes.addMissing) settings.addMissing = changes.addMissing.newValue !== false;
    if (changes.group) settings.group = Boolean(changes.group.newValue);
    lastKey = '';
    tick();
  });

  chrome.storage.local.get({ follow: true, addMissing: true, group: false }, function (stored) {
    settings.follow = stored.follow !== false;
    settings.addMissing = stored.addMissing !== false;
    settings.group = Boolean(stored.group);
    restoreScroll();
    var savedToast = sessionStorage.getItem('gitboard-toast');
    if (savedToast) {
      sessionStorage.removeItem('gitboard-toast');
      window.setTimeout(function () { showToast(savedToast); }, 800);
    }
    tick();
    window.setInterval(tick, 700);
  });
})();
