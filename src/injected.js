(function () {
  'use strict';

  if (window.__gitboardInstalled) return;
  window.__gitboardInstalled = true;

  var core = window.GitBoardCore;
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  var SOURCE = 'gitboard-page';
  var settings = { follow: true, addMissing: true };
  var state = {
    href: '',
    view: null,
    projectId: null,
    title: '',
    layout: '',
    fields: [],
    error: '',
    epoch: 0
  };
  var hierarchyCache = null;
  var pendingUpdates = [];
  var recent = new Map();
  var tail = Promise.resolve();
  var endpoint = null;

  function post(message) {
    window.postMessage(Object.assign({ source: SOURCE }, message), location.origin);
  }

  function enqueue(fn) {
    var run = tail.then(fn, fn);
    tail = run.then(function () {}, function () {});
    return run;
  }

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function graphqlError(message, retry) {
    var error = new Error(message);
    error.retry = Boolean(retry);
    return error;
  }

  async function gqlAt(url, query, variables) {
    if (!nativeFetch) throw graphqlError('fetch недоступен', false);
    var headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-GitBoard-Internal': '1'
    };
    var token = csrfToken();
    if (token) headers['X-CSRF-Token'] = token;
    var response = await nativeFetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: JSON.stringify({ query: query, variables: variables || {} })
    });
    if (response.status === 404 || response.status === 405 || response.status === 415) {
      throw graphqlError('GraphQL ' + response.status, true);
    }
    var body = null;
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }
    if (response.status === 401 || response.status === 403) {
      throw graphqlError('Нужно войти в GitHub', false);
    }
    if (!response.ok) {
      var fallback = body && body.message ? body.message : ('GitHub ответил ' + response.status);
      throw graphqlError(fallback, response.status >= 500);
    }
    if (body && body.errors && body.errors.length && !body.data) {
      throw graphqlError(body.errors.map(function (item) { return item.message; }).join('; '), false);
    }
    if (!body || !body.data) throw graphqlError('Пустой ответ GraphQL', false);
    return body.data;
  }

  async function gql(query, variables) {
    var urls = endpoint
      ? [endpoint]
      : ['https://github.com/graphql', location.origin + '/graphql'];
    var last = null;
    for (var i = 0; i < urls.length; i += 1) {
      try {
        var data = await gqlAt(urls[i], query, variables);
        endpoint = urls[i];
        return data;
      } catch (error) {
        last = error;
        if (!error.retry) throw error;
        endpoint = null;
      }
    }
    throw last || graphqlError('GraphQL недоступен', false);
  }

  var PROJECT_FIELDS = [
    'id',
    'title',
    'views(first: 40) {',
    '  nodes {',
    '    number',
    '    name',
    '    layout',
    '    groupByFields(first: 3) {',
    '      nodes {',
    '        __typename',
    '        ... on ProjectV2SingleSelectField { id name options { id name } }',
    '        ... on ProjectV2IterationField { id name }',
    '        ... on ProjectV2Field { id name }',
    '      }',
    '    }',
    '    verticalGroupByFields(first: 2) {',
    '      nodes {',
    '        __typename',
    '        ... on ProjectV2SingleSelectField { id name options { id name } }',
    '        ... on ProjectV2IterationField { id name }',
    '        ... on ProjectV2Field { id name }',
    '      }',
    '    }',
    '  }',
    '}'
  ].join('\n');

  function projectQuery(kind) {
    if (kind === 'org') {
      return 'query($login:String!,$number:Int!){ organization(login:$login){ projectV2(number:$number){' + PROJECT_FIELDS + '} } }';
    }
    if (kind === 'user') {
      return 'query($login:String!,$number:Int!){ user(login:$login){ projectV2(number:$number){' + PROJECT_FIELDS + '} } }';
    }
    return 'query($owner:String!,$name:String!,$number:Int!){ repository(owner:$owner,name:$name){ projectV2(number:$number){' + PROJECT_FIELDS + '} } }';
  }

  function collectFields(connection) {
    var fields = [];
    ((connection && connection.nodes) || []).forEach(function (node) {
      if (!node || !node.id) return;
      if (node.__typename !== 'ProjectV2SingleSelectField' && node.__typename !== 'ProjectV2IterationField') return;
      fields.push({
        id: node.id,
        name: node.name,
        kind: node.__typename === 'ProjectV2IterationField' ? 'iteration' : 'single',
        options: (node.options || []).map(function (option) { return { id: option.id, name: option.name }; })
      });
    });
    return fields;
  }

  function chooseView(views, viewNumber) {
    var list = (views || []).filter(Boolean);
    if (viewNumber != null) {
      var match = list.find(function (view) { return view.number === viewNumber; });
      if (match) return match;
    }
    return list.find(function (view) { return view.layout === 'BOARD_LAYOUT'; }) || list[0] || null;
  }

  function publishContext() {
    post({
      type: 'context',
      active: Boolean(state.projectId),
      title: state.title,
      layout: state.layout,
      fields: state.fields.map(function (field) {
        return { id: field.id, name: field.name, kind: field.kind };
      }),
      error: state.error
    });
  }

  async function loadContext(href, viewOverride) {
    var parsed = core.parseProjectLocation(href);
    var epoch = state.epoch + 1;
    state.epoch = epoch;
    state.href = href;
    state.view = viewOverride == null ? (parsed && parsed.view) : viewOverride;
    if (!parsed) {
      state.projectId = null;
      state.fields = [];
      state.error = '';
      hierarchyCache = null;
      publishContext();
      return;
    }

    try {
      var variables = parsed.kind === 'repo'
        ? { owner: parsed.owner, name: parsed.name, number: parsed.number }
        : { login: parsed.owner, number: parsed.number };
      var data = await gql(projectQuery(parsed.kind), variables);
      if (epoch !== state.epoch) return;
      var owner = data.organization || data.user || data.repository;
      var project = owner && owner.projectV2;
      if (!project) throw new Error('Это не новый GitHub Project');
      var view = chooseView(project.views && project.views.nodes, state.view);
      var fields = [];
      if (view) {
        fields = collectFields(view.groupByFields).concat(collectFields(view.verticalGroupByFields));
      }
      state.projectId = project.id;
      state.title = project.title || '';
      state.layout = view ? view.layout : '';
      state.fields = fields;
      state.error = fields.length
        ? ''
        : 'Доска не сгруппирована по колонке. Выберите группировку, например Status.';
      hierarchyCache = null;
      publishContext();
      flushPending();
    } catch (error) {
      if (epoch !== state.epoch) return;
      state.projectId = null;
      state.fields = [];
      state.error = error.message || 'Не удалось прочитать проект';
      hierarchyCache = null;
      publishContext();
    }
  }

  var ITEM_QUERY = [
    'query GitBoardItem($id:ID!){',
    '  node(id:$id){',
    '    ... on ProjectV2Item {',
    '      id',
    '      content {',
    '        __typename',
    '        ... on Issue {',
    '          id number title url',
    '          subIssues(first:100){',
    '            pageInfo { hasNextPage endCursor }',
    '            nodes { id number title url }',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '}'
  ].join('\n');

  var SUBS_QUERY = [
    'query GitBoardSubs($id:ID!,$cursor:String){',
    '  node(id:$id){',
    '    ... on Issue {',
    '      id',
    '      subIssues(first:100, after:$cursor){',
    '        pageInfo { hasNextPage endCursor }',
    '        nodes { id number title url }',
    '      }',
    '    }',
    '  }',
    '}'
  ].join('\n');

  var ISSUE_PROJECTS = [
    'query GitBoardIssueProjects($id:ID!,$field:String!,$cursor:String){',
    '  node(id:$id){',
    '    ... on Issue {',
    '      projectItems(first:50, after:$cursor){',
    '        pageInfo { hasNextPage endCursor }',
    '        nodes {',
    '          id',
    '          project { id }',
    '          fieldValueByName(name:$field){',
    '            __typename',
    '            ... on ProjectV2ItemFieldSingleSelectValue { optionId name }',
    '            ... on ProjectV2ItemFieldIterationValue { iterationId title }',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '}'
  ].join('\n');

  var SET_MUTATION = [
    'mutation GitBoardSet($input:UpdateProjectV2ItemFieldValueInput!){',
    '  updateProjectV2ItemFieldValue(input:$input){ projectV2Item { id } }',
    '}'
  ].join('\n');

  var CLEAR_MUTATION = [
    'mutation GitBoardClear($input:ClearProjectV2ItemFieldValueInput!){',
    '  clearProjectV2ItemFieldValue(input:$input){ projectV2Item { id } }',
    '}'
  ].join('\n');

  var ADD_MUTATION = [
    'mutation GitBoardAdd($input:AddProjectV2ItemByIdInput!){',
    '  addProjectV2ItemById(input:$input){ item { id } }',
    '}'
  ].join('\n');

  async function subIssuesOf(issue) {
    var page = issue.subIssues;
    if (!page) {
      var first = await gql(SUBS_QUERY, { id: issue.id, cursor: null });
      page = first.node && first.node.subIssues;
    }
    var nodes = ((page && page.nodes) || []).filter(Boolean);
    var guard = 0;
    while (page && page.pageInfo && page.pageInfo.hasNextPage && guard < 20) {
      guard += 1;
      var more = await gql(SUBS_QUERY, { id: issue.id, cursor: page.pageInfo.endCursor });
      page = more.node && more.node.subIssues;
      nodes = nodes.concat(((page && page.nodes) || []).filter(Boolean));
    }
    return nodes;
  }

  async function descendantsOf(itemId) {
    var data = await gql(ITEM_QUERY, { id: itemId });
    var content = data.node && data.node.content;
    if (!content || content.__typename !== 'Issue') return { parent: null, issues: [] };
    var issues = [];
    var seen = new Set([content.id]);
    async function walk(issue) {
      var kids = await subIssuesOf(issue);
      for (var i = 0; i < kids.length; i += 1) {
        var kid = kids[i];
        if (!kid || !kid.id || seen.has(kid.id)) continue;
        seen.add(kid.id);
        issues.push(kid);
        await walk(kid);
      }
    }
    await walk(content);
    return { parent: content, issues: issues };
  }

  async function findProjectItem(issueId, projectId, fieldName) {
    var cursor = null;
    for (var i = 0; i < 6; i += 1) {
      var data = await gql(ISSUE_PROJECTS, { id: issueId, field: fieldName, cursor: cursor });
      var connection = data.node && data.node.projectItems;
      var nodes = (connection && connection.nodes) || [];
      var found = nodes.find(function (node) { return node && node.project && node.project.id === projectId; });
      if (found) return found;
      if (!connection || !connection.pageInfo || !connection.pageInfo.hasNextPage) return null;
      cursor = connection.pageInfo.endCursor;
    }
    return null;
  }

  function sameValue(value, update) {
    if (!value) return Boolean(update.clear);
    if (update.clear) return false;
    if (update.iterationId) return value.iterationId === update.iterationId;
    return value.optionId === update.singleSelectOptionId;
  }

  function optionName(field, update) {
    if (update.clear) return 'без значения';
    if (field.kind === 'iteration') return 'выбранная итерация';
    var match = (field.options || []).find(function (option) {
      return option.id === update.singleSelectOptionId;
    });
    return match ? match.name : 'ту же колонку';
  }

  async function syncIssue(issue, update, field) {
    var placement = await findProjectItem(issue.id, update.projectId, field.name);
    var itemId = placement && placement.id;
    if (itemId && sameValue(placement.fieldValueByName, update)) return null;
    if (!itemId) {
      if (!settings.addMissing) return null;
      var added = await gql(ADD_MUTATION, {
        input: { projectId: update.projectId, contentId: issue.id }
      });
      itemId = added.addProjectV2ItemById && added.addProjectV2ItemById.item && added.addProjectV2ItemById.item.id;
      if (!itemId) throw new Error('Не удалось добавить субтаск на доску');
    }
    if (update.clear) {
      await gql(CLEAR_MUTATION, {
        input: { projectId: update.projectId, itemId: itemId, fieldId: update.fieldId }
      });
    } else if (update.iterationId) {
      await gql(SET_MUTATION, {
        input: {
          projectId: update.projectId,
          itemId: itemId,
          fieldId: update.fieldId,
          value: { iterationId: update.iterationId }
        }
      });
    } else {
      await gql(SET_MUTATION, {
        input: {
          projectId: update.projectId,
          itemId: itemId,
          fieldId: update.fieldId,
          value: { singleSelectOptionId: update.singleSelectOptionId }
        }
      });
    }
    return {
      path: core.normalizeIssuePath(issue.url),
      title: issue.title || ('#' + issue.number),
      url: issue.url
    };
  }

  async function propagate(update) {
    var field = state.fields.find(function (item) { return item.id === update.fieldId; });
    if (!settings.follow || !state.projectId || update.projectId !== state.projectId || !field) return;

    var signature = [
      update.itemId,
      update.fieldId,
      update.clear ? 'clear' : (update.singleSelectOptionId || update.iterationId || '')
    ].join('|');
    var now = Date.now();
    if (recent.get(signature) && now - recent.get(signature) < 4000) return;
    recent.set(signature, now);

    var tree = await descendantsOf(update.itemId);
    if (!tree.parent || !tree.issues.length) return;

    var moved = [];
    var failed = [];
    var queue = tree.issues.slice();
    async function worker() {
      while (queue.length) {
        var issue = queue.shift();
        try {
          var result = await syncIssue(issue, update, field);
          if (result) moved.push(result);
        } catch (error) {
          failed.push({
            title: issue.title || ('#' + issue.number),
            message: error.message || String(error)
          });
        }
      }
    }
    var workers = [];
    var count = Math.min(4, queue.length);
    for (var i = 0; i < count; i += 1) workers.push(worker());
    await Promise.all(workers);
    hierarchyCache = null;
    if (!moved.length && !failed.length) return;
    post({
      type: 'moved',
      parentTitle: tree.parent.title || '',
      parentPath: core.normalizeIssuePath(tree.parent.url),
      optionName: optionName(field, update),
      moved: moved,
      failed: failed
    });
  }

  function remember(update) {
    update.at = Date.now();
    if (!state.projectId) {
      pendingUpdates.push(update);
      return;
    }
    enqueue(function () { return propagate(update); }).catch(function (error) {
      post({ type: 'error', message: error.message || String(error) });
    });
  }

  function flushPending() {
    var fresh = pendingUpdates.filter(function (update) { return Date.now() - update.at < 8000; });
    pendingUpdates = [];
    fresh.forEach(remember);
  }

  function inspectText(text) {
    if (!text || text.length > 1500000) return;
    if (text.indexOf('projectId') === -1 || text.indexOf('itemId') === -1 || text.indexOf('fieldId') === -1) return;
    var relevant = text.indexOf('singleSelectOptionId') !== -1 ||
      text.indexOf('iterationId') !== -1 ||
      /clearProjectV2ItemFieldValue/i.test(text);
    if (!relevant) return;
    var payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      return;
    }
    core.extractFieldUpdates(payload).forEach(remember);
    core.extractFieldClears(payload).forEach(remember);
  }

  function headerHasInternal(headers) {
    try {
      return new Headers(headers || {}).get('X-GitBoard-Internal') === '1';
    } catch (error) {
      return false;
    }
  }

  function hookedFetch(previous, input, init) {
    var headers = init && init.headers;
    if (!headers && typeof Request !== 'undefined' && input instanceof Request) headers = input.headers;
    if (headerHasInternal(headers)) return previous(input, init);

    var bodyText = null;
    var cloned = null;
    try {
      if (init && typeof init.body === 'string') bodyText = Promise.resolve(init.body);
      else if (typeof Request !== 'undefined' && input instanceof Request) cloned = input.clone();
    } catch (error) {
      bodyText = null;
    }

    var responsePromise = previous(input, init);
    if (bodyText || cloned) {
      void (async function () {
        try {
          var text = bodyText ? await bodyText : await cloned.text();
          var response = await responsePromise;
          if (!response.ok) return;
          inspectText(text);
        } catch (error) {
          /* The page request itself is untouched. */
        }
      })();
    }
    return responsePromise;
  }

  function installFetch() {
    if (!window.fetch || window.fetch.__gitboard) return;
    var previous = window.fetch.bind(window);
    if (!nativeFetch) nativeFetch = previous;
    var wrapped = function (input, init) {
      return hookedFetch(previous, input, init);
    };
    wrapped.__gitboard = true;
    window.fetch = wrapped;
  }

  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;
  var originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gitboardMethod = method;
    this.__gitboardUrl = String(url || '');
    this.__gitboardInternal = false;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (String(name).toLowerCase() === 'x-gitboard-internal' && String(value) === '1') {
      this.__gitboardInternal = true;
    }
    return originalSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (!this.__gitboardInternal && typeof body === 'string') {
      var text = body;
      this.addEventListener('load', function () {
        if (this.status >= 200 && this.status < 300) inspectText(text);
      });
    }
    return originalSend.apply(this, arguments);
  };

  installFetch();
  setInterval(installFetch, 2000);

  function mapIssueContent(content, status, itemId) {
    if (!content || content.__typename !== 'Issue') {
      return { type: content && content.__typename };
    }
    return {
      itemId: itemId,
      status: status,
      content: {
        type: 'Issue',
        id: content.id,
        number: content.number,
        title: content.title,
        url: content.url,
        state: content.state,
        parentUrl: content.parent ? content.parent.url : null,
        subIssues: ((content.subIssues && content.subIssues.nodes) || []).filter(Boolean).map(function (sub) {
          return {
            id: sub.id,
            number: sub.number,
            title: sub.title,
            url: sub.url,
            state: sub.state
          };
        }),
        subIssuesPage: content.subIssues && content.subIssues.pageInfo
      }
    };
  }

  var ITEMS_WITH_PARENT = [
    'query GitBoardItems($id:ID!,$cursor:String,$field:String!){',
    '  node(id:$id){',
    '    ... on ProjectV2 {',
    '      items(first:100, after:$cursor){',
    '        pageInfo { hasNextPage endCursor }',
    '        nodes {',
    '          id',
    '          fieldValueByName(name:$field){',
    '            __typename',
    '            ... on ProjectV2ItemFieldSingleSelectValue { name }',
    '            ... on ProjectV2ItemFieldIterationValue { title }',
    '          }',
    '          content {',
    '            __typename',
    '            ... on Issue {',
    '              id number title url state',
    '              parent { url }',
    '              subIssues(first:100){',
    '                pageInfo { hasNextPage endCursor }',
    '                nodes { id number title url state }',
    '              }',
    '            }',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '}'
  ].join('\n');

  var ITEMS_NO_PARENT = ITEMS_WITH_PARENT.replace('parent { url }', '');
  var parentSupported = true;

  async function fetchItemPage(variables) {
    if (!parentSupported) return gql(ITEMS_NO_PARENT, variables);
    try {
      return await gql(ITEMS_WITH_PARENT, variables);
    } catch (error) {
      if (/parent/i.test(error.message || '')) {
        parentSupported = false;
        return gql(ITEMS_NO_PARENT, variables);
      }
      throw error;
    }
  }

  async function loadHierarchy() {
    if (!state.projectId) throw new Error(state.error || 'Откройте GitHub Project');
    var fieldName = (state.fields[0] && state.fields[0].name) || 'Status';
    if (
      hierarchyCache &&
      hierarchyCache.projectId === state.projectId &&
      hierarchyCache.fieldName === fieldName &&
      Date.now() - hierarchyCache.at < 15000
    ) {
      return hierarchyCache.model;
    }

    var plain = [];
    var cursor = null;
    for (var page = 0; page < 40; page += 1) {
      var data = await fetchItemPage({ id: state.projectId, cursor: cursor, field: fieldName });
      var connection = data.node && data.node.items;
      var nodes = (connection && connection.nodes) || [];
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        if (!node || !node.content) continue;
        var status = '';
        if (node.fieldValueByName) status = node.fieldValueByName.name || node.fieldValueByName.title || '';
        var mapped = mapIssueContent(node.content, status, node.id);
        if (mapped.content && mapped.content.subIssuesPage && mapped.content.subIssuesPage.hasNextPage) {
          var extra = await subIssuesOf({
            id: mapped.content.id,
            subIssues: {
              nodes: mapped.content.subIssues,
              pageInfo: mapped.content.subIssuesPage
            }
          });
          mapped.content.subIssues = extra.map(function (sub) {
            return {
              id: sub.id,
              number: sub.number,
              title: sub.title,
              url: sub.url,
              state: sub.state
            };
          });
        }
        if (mapped.content) delete mapped.content.subIssuesPage;
        plain.push(mapped);
      }
      if (!connection || !connection.pageInfo || !connection.pageInfo.hasNextPage) break;
      cursor = connection.pageInfo.endCursor;
    }

    var model = core.buildHierarchy(plain);
    model.fieldName = fieldName;
    hierarchyCache = {
      at: Date.now(),
      projectId: state.projectId,
      fieldName: fieldName,
      model: model
    };
    return model;
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var data = event.data;
    if (!data || data.source !== 'gitboard-content') return;

    if (data.type === 'config') {
      settings.follow = data.follow !== false;
      settings.addMissing = data.addMissing !== false;
      var href = data.href || location.href;
      var view = data.view == null ? null : data.view;
      var parsed = core.parseProjectLocation(href);
      var key = parsed
        ? [parsed.kind, parsed.owner, parsed.name || '', parsed.number, view == null ? '' : view].join('|')
        : '';
      var previous = [
        state.projectId ? 'on' : '',
        state.href,
        state.view == null ? '' : state.view
      ].join('|');
      var next = [key ? 'on' : '', href, view == null ? '' : view].join('|');
      if (previous !== next || !state.projectId && key) {
        loadContext(href, view).catch(function (error) {
          state.error = error.message || String(error);
          publishContext();
        });
      }
      return;
    }

    if (data.type === 'hierarchy') {
      loadHierarchy().then(function (model) {
        post({ type: 'hierarchy', requestId: data.requestId, model: model });
      }).catch(function (error) {
        post({
          type: 'hierarchy',
          requestId: data.requestId,
          error: error.message || String(error)
        });
      });
    }
  });
})();
