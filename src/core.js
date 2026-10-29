(function (root) {
  'use strict';

  function parseProjectLocation(href) {
    var url;
    try {
      url = new URL(String(href));
    } catch (error) {
      return null;
    }
    if (url.hostname !== 'github.com') return null;

    var parts = url.pathname.split('/').filter(Boolean);
    function viewAt(index) {
      if (parts[index] === 'views' && /^\d+$/.test(parts[index + 1] || '')) {
        return Number(parts[index + 1]);
      }
      return null;
    }

    if (parts[0] === 'orgs' && parts[2] === 'projects' && /^\d+$/.test(parts[3] || '')) {
      return { kind: 'org', owner: parts[1], number: Number(parts[3]), view: viewAt(4) };
    }
    if (parts[0] === 'users' && parts[2] === 'projects' && /^\d+$/.test(parts[3] || '')) {
      return { kind: 'user', owner: parts[1], number: Number(parts[3]), view: viewAt(4) };
    }
    if (
      parts.length >= 4 &&
      parts[2] === 'projects' &&
      /^\d+$/.test(parts[3] || '') &&
      parts[0] !== 'orgs' &&
      parts[0] !== 'users'
    ) {
      return {
        kind: 'repo',
        owner: parts[0],
        name: parts[1],
        number: Number(parts[3]),
        view: viewAt(4)
      };
    }
    return null;
  }

  function normalizeIssuePath(href) {
    if (!href) return null;
    try {
      var url = new URL(String(href), 'https://github.com');
      var match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/i);
      if (!match) return null;
      return '/' + match[1] + '/' + match[2] + '/' + match[3].toLowerCase() + '/' + match[4];
    } catch (error) {
      return null;
    }
  }

  function readFieldUpdate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    if (
      typeof input.projectId !== 'string' ||
      typeof input.itemId !== 'string' ||
      typeof input.fieldId !== 'string'
    ) {
      return null;
    }
    var value = input.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var single = typeof value.singleSelectOptionId === 'string' ? value.singleSelectOptionId : null;
    var iteration = typeof value.iterationId === 'string' ? value.iterationId : null;
    if (!single && !iteration) return null;
    return {
      projectId: input.projectId,
      itemId: input.itemId,
      fieldId: input.fieldId,
      singleSelectOptionId: single,
      iterationId: iteration,
      clear: false
    };
  }

  function readClearUpdate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    if (
      typeof input.projectId !== 'string' ||
      typeof input.itemId !== 'string' ||
      typeof input.fieldId !== 'string'
    ) {
      return null;
    }
    if (readFieldUpdate(input)) return null;
    return {
      projectId: input.projectId,
      itemId: input.itemId,
      fieldId: input.fieldId,
      singleSelectOptionId: null,
      iterationId: null,
      clear: true
    };
  }

  function visit(node, found, read) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(function (item) { visit(item, found, read); });
      return;
    }
    var nested = node.input ? read(node.input) : null;
    var direct = read(node);
    if (nested) found.push(nested);
    else if (direct) found.push(direct);
    Object.keys(node).forEach(function (key) {
      if (key === 'input' || key === 'value') return;
      visit(node[key], found, read);
    });
  }

  function dedupe(found) {
    var seen = new Set();
    var result = [];
    found.forEach(function (item) {
      var key = [
        item.projectId,
        item.itemId,
        item.fieldId,
        item.clear ? 'clear' : '',
        item.singleSelectOptionId || '',
        item.iterationId || ''
      ].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });
    return result;
  }

  function extractFieldUpdates(payload) {
    var found = [];
    visit(payload, found, readFieldUpdate);
    return dedupe(found);
  }

  function extractFieldClears(payload) {
    var raw = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    if (!/clearProjectV2ItemFieldValue/i.test(raw)) return [];
    var data = payload;
    if (typeof payload === 'string') {
      try {
        data = JSON.parse(payload);
      } catch (error) {
        return [];
      }
    }
    var found = [];
    visit(data, found, readClearUpdate);
    return dedupe(found);
  }

  function buildHierarchy(items) {
    var nodes = new Map();

    function blank(path) {
      return {
        path: path,
        title: '',
        url: 'https://github.com' + path,
        state: '',
        status: '',
        number: null,
        itemId: null,
        fullDatabaseId: null,
        contentId: null,
        onBoard: false,
        parentPath: null,
        children: []
      };
    }

    function nodeFor(path) {
      if (!nodes.has(path)) nodes.set(path, blank(path));
      return nodes.get(path);
    }

    function fill(path, data) {
      var node = nodeFor(path);
      if (data.title) node.title = data.title;
      if (data.url) node.url = data.url;
      if (data.state) node.state = data.state;
      if (data.status) node.status = data.status;
      if (data.number != null) node.number = data.number;
      if (data.itemId) node.itemId = data.itemId;
      if (data.fullDatabaseId) node.fullDatabaseId = String(data.fullDatabaseId);
      if (data.contentId) node.contentId = data.contentId;
      if (data.onBoard) node.onBoard = true;
      if (data.parentPath) node.parentPath = data.parentPath;
      return node;
    }

    function addChild(parentPath, childPath) {
      if (!parentPath || !childPath || parentPath === childPath) return;
      var parent = nodeFor(parentPath);
      if (parent.children.indexOf(childPath) === -1) parent.children.push(childPath);
      var child = nodeFor(childPath);
      if (!child.parentPath) child.parentPath = parentPath;
    }

    (items || []).forEach(function (item) {
      var content = item && item.content;
      if (!content || content.type !== 'Issue') return;
      var path = normalizeIssuePath(content.url);
      if (!path) return;
      fill(path, {
        title: content.title,
        url: content.url,
        state: content.state,
        status: item.status || '',
        number: content.number,
        itemId: item.itemId,
        fullDatabaseId: item.fullDatabaseId,
        contentId: content.id,
        onBoard: true,
        parentPath: normalizeIssuePath(content.parentUrl)
      });
      (content.subIssues || []).forEach(function (sub) {
        var childPath = normalizeIssuePath(sub && sub.url);
        if (!childPath) return;
        fill(childPath, {
          title: sub.title,
          url: sub.url,
          state: sub.state,
          number: sub.number,
          contentId: sub.id,
          parentPath: path
        });
        addChild(path, childPath);
      });
    });

    nodes.forEach(function (node) {
      if (node.parentPath) addChild(node.parentPath, node.path);
    });

    function hasOnBoardAncestor(node) {
      var seen = new Set();
      var current = node.parentPath ? nodes.get(node.parentPath) : null;
      while (current && !seen.has(current.path)) {
        seen.add(current.path);
        if (current.onBoard) return true;
        current = current.parentPath ? nodes.get(current.parentPath) : null;
      }
      return false;
    }

    var list = Array.from(nodes.values());
    var childPaths = list.filter(hasOnBoardAncestor).map(function (node) { return node.path; });
    var childSet = new Set(childPaths);
    var rootPaths = list
      .filter(function (node) {
        return node.onBoard && node.children.length > 0 && !childSet.has(node.path);
      })
      .map(function (node) { return node.path; });

    var plain = {};
    list.forEach(function (node) { plain[node.path] = node; });
    return { nodes: plain, childPaths: childPaths, rootPaths: rootPaths };
  }

  root.GitBoardCore = {
    parseProjectLocation: parseProjectLocation,
    normalizeIssuePath: normalizeIssuePath,
    extractFieldUpdates: extractFieldUpdates,
    extractFieldClears: extractFieldClears,
    buildHierarchy: buildHierarchy
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
