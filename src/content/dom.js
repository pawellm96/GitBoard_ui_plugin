(function (root) {
  'use strict';

  var core = root.GitBoardCore;
  var OPEN_PREFIX = 'gitboard-open:';

  var lastToggleAt = 0;

  function toggleNest(button) {
    var now = Date.now();
    if (now - lastToggleAt < 50) return;
    lastToggleAt = now;

    var wrap = button.closest('.gitboard-nest');
    if (!wrap) return;
    var list = wrap.querySelector(':scope > .gitboard-nest-list');
    var chevron = button.querySelector('.gitboard-chevron');
    if (!list) return;

    var open = list.classList.contains('is-closed');
    list.classList.toggle('is-closed', !open);
    list.hidden = !open;
    if (chevron) chevron.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');

    var projectId = wrap.getAttribute('data-gitboard-project') || '';
    var path = wrap.getAttribute('data-gitboard-for') || '';
    if (projectId && path) setOpen(projectId, path, open);
  }

  if (!window.__gitboardNestToggle) {
    window.__gitboardNestToggle = true;
    document.addEventListener('pointerdown', function (event) {
      var target = event.target;
      if (!(target instanceof Element) || !target.closest('.gitboard-nest-toggle')) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    document.addEventListener('pointerup', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var button = target.closest('.gitboard-nest-toggle');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      toggleNest(button);
    }, true);
  }

  var cardCache = { at: 0, cards: null };

  function indexCards() {
    var now = Date.now();
    if (cardCache.cards && now - cardCache.at < 200) {
      var fresh = true;
      cardCache.cards.forEach(function (card) {
        if (!card.isConnected) fresh = false;
      });
      if (fresh) return cardCache.cards;
    }
    var links = document.querySelectorAll('a[href]');
    var anchors = [];
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      if (link.closest('.gitboard-nest, .gitboard-panel, [role="dialog"], dialog')) continue;
      var path = core.normalizeIssuePath(link.getAttribute('href'));
      if (!path) continue;
      anchors.push({ link: link, path: path });
    }

    var mark = new WeakMap();
    for (var a = 0; a < anchors.length; a += 1) {
      var path = anchors[a].path;
      var node = anchors[a].link;
      while (node && node !== document.body) {
        var prev = mark.get(node);
        if (prev == null) mark.set(node, path);
        else if (prev !== path) mark.set(node, '*');
        node = node.parentElement;
      }
    }

    var cards = new Map();
    for (var b = 0; b < anchors.length; b += 1) {
      if (cards.has(anchors[b].path)) continue;
      var node = anchors[b].link.parentElement;
      var card = node || anchors[b].link;
      var depth = 0;
      while (node && node !== document.body && depth < 14) {
        if (!node.classList.contains('gitboard-nest')) {
          var radius = parseFloat(window.getComputedStyle(node).borderTopLeftRadius) || 0;
          if (radius >= 6) {
            card = node;
            break;
          }
        }
        if (mark.get(node.parentElement) === '*') {
          card = node;
          break;
        }
        node = node.parentElement;
        depth += 1;
      }
      cards.set(anchors[b].path, card);
    }
    cardCache = { at: Date.now(), cards: cards };
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

  function openLikeBoardCard(node) {
    if (!node || !node.path) return;
    window.postMessage({
      source: 'gitboard-content',
      type: 'open-card',
      path: node.path,
      itemId: node.fullDatabaseId || ''
    }, location.origin);
  }

  function completedCount(node, hierarchy) {
    var done = 0;
    (node.children || []).forEach(function (childPath) {
      var child = hierarchy.nodes[childPath];
      if (child && child.state === 'CLOSED') done += 1;
    });
    return done;
  }

  function rowLabel(node) {
    var number = node.number != null ? '#' + node.number : '';
    var title = (node.title || '').trim();
    if (!title || title === number || title === String(node.number)) return number || title || node.path;
    if (number && title.indexOf(number) !== -1) return title;
    return number ? number + '  ' + title : title;
  }

  function stateIcon(closed) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('gitboard-state');
    svg.classList.add(closed ? 'is-closed' : 'is-open');
    var ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('cx', '8');
    ring.setAttribute('cy', '8');
    ring.setAttribute('r', '6');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke-width', '1.5');
    svg.appendChild(ring);
    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', '8');
    dot.setAttribute('cy', '8');
    dot.setAttribute('r', closed ? '3' : '2');
    svg.appendChild(dot);
    return svg;
  }

  function chevronIcon(open) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('gitboard-chevron');
    if (open) svg.classList.add('is-open');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 4.5 10.5 8 6 11.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function renderRow(node, hierarchy, position) {
    var item = document.createElement('li');
    item.className = 'gitboard-subissue';
    item.appendChild(stateIcon(node.state === 'CLOSED'));

    var index = document.createElement('span');
    index.className = 'gitboard-pos';
    index.textContent = String(position);
    item.appendChild(index);

    var link = document.createElement('a');
    link.className = 'gitboard-nest-link';
    link.href = issueHref(node);
    link.textContent = rowLabel(node);
    link.addEventListener('click', function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      openLikeBoardCard(node);
    });
    item.appendChild(link);

    if (node.children && node.children.length) {
      var nested = document.createElement('ul');
      nested.className = 'gitboard-nest-list gitboard-nest-list-nested';
      node.children.forEach(function (childPath, childIndex) {
        var child = hierarchy.nodes[childPath];
        if (child) nested.appendChild(renderRow(child, hierarchy, childIndex + 1));
      });
      item.appendChild(nested);
    }

    return item;
  }

  function renderNest(node, hierarchy, projectId) {
    var wrap = document.createElement('div');
    wrap.className = 'gitboard-nest';
    wrap.setAttribute('data-gitboard-for', node.path);
    wrap.setAttribute('data-gitboard-project', projectId);
    wrap.setAttribute('data-gitboard-count', String(node.children.length));

    var open = !!openMap(projectId)[node.path];
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'gitboard-nest-toggle';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.appendChild(chevronIcon(open));

    var label = document.createElement('span');
    label.textContent = 'Sub-issues';
    button.appendChild(label);

    var count = document.createElement('span');
    count.className = 'gitboard-progress';
    count.textContent = completedCount(node, hierarchy) + ' of ' + node.children.length;
    button.appendChild(count);

    var list = document.createElement('ul');
    list.className = 'gitboard-nest-list' + (open ? '' : ' is-closed');
    list.hidden = !open;
    node.children.forEach(function (childPath, index) {
      var child = hierarchy.nodes[childPath];
      if (child) list.appendChild(renderRow(child, hierarchy, index + 1));
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

  function selectedNames(list) {
    return Array.isArray(list) ? list.filter(Boolean) : [];
  }

  function matchesGroupFilter(node, settings) {
    if (!node) return false;
    var types = selectedNames(settings && settings.groupTypes);
    var labels = selectedNames(settings && settings.groupLabels);
    if (!types.length && !labels.length) return true;
    if (types.length && types.indexOf(node.issueType || '') === -1) return false;
    if (!labels.length) return true;
    var own = node.labels || [];
    for (var i = 0; i < labels.length; i += 1) {
      if (own.indexOf(labels[i]) !== -1) return true;
    }
    return false;
  }

  function groupingSelection(hierarchy, settings) {
    var hidden = {};
    var roots = [];
    if (!hierarchy) return { hidden: hidden, roots: roots };

    function hideChildren(path) {
      var node = hierarchy.nodes[path];
      if (!node) return;
      (node.children || []).forEach(function (childPath) {
        hidden[childPath] = true;
        hideChildren(childPath);
      });
    }

    (hierarchy.rootPaths || []).forEach(function (path) {
      if (!matchesGroupFilter(hierarchy.nodes[path], settings)) return;
      roots.push(path);
      hideChildren(path);
    });
    return { hidden: hidden, roots: roots };
  }

  function applyGrouping(board, settings) {
    if (!board || !board.hierarchy) return;

    var cards = indexCards();
    var hierarchy = board.hierarchy;
    var selection = groupingSelection(hierarchy, settings);
    var hide = selection.hidden;

    cards.forEach(function (card, path) {
      if (hide[path]) {
        card.classList.add('gitboard-card-hidden');
        card.setAttribute('data-gitboard-path', path);
      } else if (card.classList.contains('gitboard-card-hidden')) {
        card.classList.remove('gitboard-card-hidden');
        card.removeAttribute('data-gitboard-path');
      }
    });

    var hiddenNow = document.querySelectorAll('.gitboard-card-hidden');
    for (var i = 0; i < hiddenNow.length; i += 1) {
      var hiddenCard = hiddenNow[i];
      var hiddenPath = hiddenCard.getAttribute('data-gitboard-path');
      if (!hiddenPath || !hide[hiddenPath]) hiddenCard.classList.remove('gitboard-card-hidden');
    }

    var seenRoots = {};
    var nests = document.querySelectorAll('.gitboard-nest');
    selection.roots.forEach(function (path) {
      var card = cards.get(path);
      var node = hierarchy.nodes[path];
      if (!card || !node || !node.children.length) return;
      seenRoots[path] = true;

      var matches = [];
      for (var n = 0; n < nests.length; n += 1) {
        if (nests[n].getAttribute('data-gitboard-for') === path) matches.push(nests[n]);
      }
      var inside = matches.filter(function (nest) { return card.contains(nest); });
      var keep = inside[0] || null;
      if (
        keep &&
        keep.getAttribute('data-gitboard-count') !== String(node.children.length)
      ) {
        keep.remove();
        keep = null;
      }
      if (!keep) keep = renderNest(node, hierarchy, board.project.id);
      if (!card.contains(keep)) card.appendChild(keep);
      matches.forEach(function (nest) {
        if (nest !== keep) nest.remove();
      });
    });

    document.querySelectorAll('.gitboard-nest').forEach(function (nest) {
      var path = nest.getAttribute('data-gitboard-for');
      if (!seenRoots[path]) nest.remove();
    });
  }

  root.GitBoardDom = {
    applyGrouping: applyGrouping,
    clearGrouping: clearGrouping
  };
})(globalThis);
