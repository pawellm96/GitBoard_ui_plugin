(function (root) {
  'use strict';

  var core = root.GitBoardCore;
  var OPEN_PREFIX = 'gitboard-open:';

  function stopBoardDrag(element) {
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'dragstart'].forEach(function (type) {
      element.addEventListener(type, function (event) {
        event.stopPropagation();
      });
    });
  }

  function cardElement(anchor) {
    var ownPath = core.normalizeIssuePath(anchor.getAttribute('href'));
    if (!ownPath) return null;
    var node = anchor;
    while (node.parentElement && node.parentElement !== document.body) {
      var parent = node.parentElement;
      var links = parent.querySelectorAll('a[href]');
      var foreign = false;
      for (var i = 0; i < links.length; i += 1) {
        if (links[i].closest('.gitboard-nest')) continue;
        var path = core.normalizeIssuePath(links[i].getAttribute('href'));
        if (path && path !== ownPath) {
          foreign = true;
          break;
        }
      }
      if (foreign) return node;
      node = parent;
    }
    return null;
  }

  function cardEntries() {
    var cards = new Map();
    var anchors = document.querySelectorAll('a[href]');
    anchors.forEach(function (anchor) {
      if (anchor.closest('.gitboard-nest, .gitboard-panel')) return;
      var path = core.normalizeIssuePath(anchor.getAttribute('href'));
      if (!path || cards.has(path)) return;
      var card = cardElement(anchor);
      if (!card) return;
      cards.set(path, card);
    });
    return cards;
  }

  function openMap(projectId) {
    try {
      return JSON.parse(sessionStorage.getItem(OPEN_PREFIX + projectId) || '{}');
    } catch (error) {
      return {};
    }
  }

  function setOpen(projectId, path, isOpen) {
    var map = openMap(projectId);
    map[path] = !!isOpen;
    sessionStorage.setItem(OPEN_PREFIX + projectId, JSON.stringify(map));
  }

  function issueHref(node) {
    return core.normalizeIssuePath(node.url) || node.url || '#';
  }

  function renderRow(node, hierarchy) {
    var item = document.createElement('li');
    item.className = 'gitboard-nest-item';

    var link = document.createElement('a');
    link.className = 'gitboard-nest-link';
    link.href = issueHref(node);
    link.textContent = node.title || link.href;
    item.appendChild(link);

    var bits = [];
    if (node.number != null) bits.push('#' + node.number);
    if (node.status) bits.push(node.status);
    else if (!node.onBoard) bits.push('не на доске');
    if (node.state === 'CLOSED') bits.push('закрыта');

    var meta = document.createElement('div');
    meta.className = 'gitboard-nest-meta';
    meta.textContent = bits.join(' · ');
    item.appendChild(meta);

    if (node.children && node.children.length) {
      var nested = document.createElement('ul');
      nested.className = 'gitboard-nest-list gitboard-nest-list-nested';
      node.children.forEach(function (childPath) {
        var child = hierarchy.nodes[childPath];
        if (child) nested.appendChild(renderRow(child, hierarchy));
      });
      item.appendChild(nested);
    }

    return item;
  }

  function renderNest(node, hierarchy, projectId) {
    var wrap = document.createElement('div');
    wrap.className = 'gitboard-nest';
    stopBoardDrag(wrap);

    var open = !!openMap(projectId)[node.path];
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'gitboard-nest-toggle';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');

    var chevron = document.createElement('span');
    chevron.className = 'gitboard-chevron';
    chevron.textContent = open ? '▾' : '▸';

    var label = document.createElement('span');
    label.textContent = 'Субтаски';

    var count = document.createElement('span');
    count.className = 'gitboard-nest-count';
    count.textContent = String(node.children.length);

    button.appendChild(chevron);
    button.appendChild(label);
    button.appendChild(count);

    var list = document.createElement('ul');
    list.className = 'gitboard-nest-list';
    list.hidden = !open;
    node.children.forEach(function (childPath) {
      var child = hierarchy.nodes[childPath];
      if (child) list.appendChild(renderRow(child, hierarchy));
    });

    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var nextOpen = list.hidden;
      list.hidden = !nextOpen;
      chevron.textContent = nextOpen ? '▾' : '▸';
      button.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      setOpen(projectId, node.path, nextOpen);
    });

    wrap.appendChild(button);
    wrap.appendChild(list);
    return wrap;
  }

  function clearGrouping() {
    document.querySelectorAll('.gitboard-card-hidden').forEach(function (element) {
      element.classList.remove('gitboard-card-hidden');
    });
    document.querySelectorAll('.gitboard-nest').forEach(function (element) {
      element.remove();
    });
  }

  function applyGrouping(board) {
    clearGrouping();
    if (!board || !board.hierarchy) return;

    var cards = cardEntries();
    var hierarchy = board.hierarchy;

    hierarchy.childPaths.forEach(function (path) {
      var card = cards.get(path);
      if (card) card.classList.add('gitboard-card-hidden');
    });

    hierarchy.rootPaths.forEach(function (path) {
      var card = cards.get(path);
      var node = hierarchy.nodes[path];
      if (!card || !node || !node.children.length) return;
      card.appendChild(renderNest(node, hierarchy, board.project.id));
    });
  }

  root.GitBoardDom = {
    applyGrouping: applyGrouping,
    clearGrouping: clearGrouping
  };
})(globalThis);
