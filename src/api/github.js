(function (root) {
  'use strict';

  var core = root.GitBoardCore;
  var SESSION_URL = 'https://github.com/graphql';

  var PROJECT_FIELDS = [
    'fragment GitBoardProject on ProjectV2 {',
    '  id',
    '  title',
    '  number',
    '  views(first: 40) {',
    '    nodes {',
    '      number',
    '      name',
    '      layout',
    '      groupByFields(first: 4) {',
    '        nodes {',
    '          __typename',
    '          ... on ProjectV2SingleSelectField { id name options { id name } }',
    '          ... on ProjectV2IterationField { id name }',
    '        }',
    '      }',
    '    }',
    '  }',
    '}'
  ].join('\n');

  var QUERIES = {
    org: 'query GitBoardOrg($login: String!, $number: Int!) { organization(login: $login) { projectV2(number: $number) { ...GitBoardProject } } }' + PROJECT_FIELDS,
    user: 'query GitBoardUser($login: String!, $number: Int!) { user(login: $login) { projectV2(number: $number) { ...GitBoardProject } } }' + PROJECT_FIELDS,
    repo: 'query GitBoardRepo($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { projectV2(number: $number) { ...GitBoardProject } } }' + PROJECT_FIELDS,
    items: [
      'query GitBoardItems($id: ID!, $cursor: String) {',
      '  node(id: $id) {',
      '    ... on ProjectV2 {',
      '      items(first: 50, after: $cursor) {',
      '        pageInfo { hasNextPage endCursor }',
      '        nodes {',
      '          id',
      '          isArchived',
      '          fieldValues(first: 12) {',
      '            nodes {',
      '              __typename',
      '              ... on ProjectV2ItemFieldSingleSelectValue {',
      '                name',
      '                optionId',
      '                field { ... on ProjectV2SingleSelectField { id } }',
      '              }',
      '              ... on ProjectV2ItemFieldIterationValue {',
      '                title',
      '                iterationId',
      '                field { ... on ProjectV2IterationField { id } }',
      '              }',
      '            }',
      '          }',
      '          content {',
      '            __typename',
      '            ... on Issue {',
      '              id number title url state',
      '              parent { url }',
      '              subIssues(first: 50) {',
      '                pageInfo { hasNextPage endCursor }',
      '                nodes { id number title url state }',
      '              }',
      '            }',
      '            ... on PullRequest { id number title url state }',
      '            ... on DraftIssue { id title }',
      '          }',
      '        }',
      '      }',
      '    }',
      '  }',
      '}'
    ].join('\n'),
    moreSubIssues: [
      'query GitBoardMoreSubIssues($id: ID!, $cursor: String) {',
      '  node(id: $id) {',
      '    ... on Issue {',
      '      subIssues(first: 50, after: $cursor) {',
      '        pageInfo { hasNextPage endCursor }',
      '        nodes { id number title url state }',
      '      }',
      '    }',
      '  }',
      '}'
    ].join('\n'),
    itemSubIssues: [
      'query GitBoardItemSubIssues($id: ID!, $cursor: String) {',
      '  node(id: $id) {',
      '    ... on ProjectV2Item {',
      '      content {',
      '        __typename',
      '        ... on Issue {',
      '          subIssues(first: 50, after: $cursor) {',
      '            pageInfo { hasNextPage endCursor }',
      '            nodes { id number title url state }',
      '          }',
      '        }',
      '      }',
      '    }',
      '  }',
      '}'
    ].join('\n'),
    addItem: 'mutation GitBoardAdd($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }',
    setSingle: 'mutation GitBoardSingle($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } } }',
    setIteration: 'mutation GitBoardIteration($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { iterationId: $iterationId } }) { projectV2Item { id } } }',
    clearField: 'mutation GitBoardClear($projectId: ID!, $itemId: ID!, $fieldId: ID!) { clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) { projectV2Item { id } } }'
  };

  function unwrapGraphql(status, text) {
    var payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error('GitHub API вернул не JSON (HTTP ' + status + ')');
    }
    if (payload.errors && payload.errors.length && !payload.data) {
      throw new Error(payload.errors.map(function (error) {
        return error.message;
      }).filter(Boolean).join('; ') || 'Ошибка GitHub API');
    }
    if (!payload.data) {
      if (status === 401 || status === 403) {
        throw new Error('Нет доступа к GitHub API. Войдите в GitHub или сохраните токен в окне расширения.');
      }
      throw new Error('GitHub API HTTP ' + status);
    }
    return payload.data;
  }

  function postGraphql(url, query, variables) {
    var headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };
    var meta = document.querySelector('meta[name="csrf-token"]');
    var csrf = meta ? meta.getAttribute('content') || '' : '';
    if (csrf) headers['X-CSRF-Token'] = csrf;

    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function (response) {
      if (response.status === 404 || response.status === 405) {
        var missing = new Error('GraphQL endpoint недоступен');
        missing.retry = true;
        throw missing;
      }
      return response.text().then(function (text) {
        return unwrapGraphql(response.status, text);
      });
    });
  }

  function sessionGraphql(query, variables) {
    return postGraphql(SESSION_URL, query, variables).catch(function (error) {
      if (!error || !error.retry) throw error;
      return postGraphql(location.origin + '/api/graphql', query, variables);
    });
  }

  function tokenGraphql(token, query, variables) {
    return chrome.runtime.sendMessage({
      type: 'gitboard-graphql',
      token: token,
      query: query,
      variables: variables || {}
    }).then(function (response) {
      if (!response || !response.ok) {
        throw new Error((response && response.error) || 'GitHub API недоступен');
      }
      return response.data;
    });
  }

  function graphql(query, variables) {
    return root.GitBoardSettings.load().then(function (settings) {
      var token = (settings.token || '').trim();
      if (token) return tokenGraphql(token, query, variables);
      return sessionGraphql(query, variables);
    });
  }

  function projectFromData(kind, data) {
    if (kind === 'org') return data && data.organization && data.organization.projectV2;
    if (kind === 'user') return data && data.user && data.user.projectV2;
    return data && data.repository && data.repository.projectV2;
  }

  function fetchProject(parsed) {
    var variables = parsed.kind === 'repo'
      ? { owner: parsed.owner, name: parsed.name, number: parsed.number }
      : { login: parsed.owner, number: parsed.number };
    return graphql(QUERIES[parsed.kind], variables).then(function (data) {
      var project = projectFromData(parsed.kind, data);
      if (!project) {
        throw new Error('Проект не найден. Расширение работает с новым GitHub Projects.');
      }
      return project;
    });
  }

  function pickView(views, viewNumber) {
    var list = (views || []).filter(Boolean);
    if (viewNumber != null) {
      var match = list.find(function (view) { return view.number === viewNumber; });
      if (match) return match;
    }
    return list.find(function (view) { return view.layout === 'BOARD_LAYOUT'; }) || list[0] || null;
  }

  function columnField(view) {
    var nodes = (view && view.groupByFields && view.groupByFields.nodes) || [];
    return nodes.find(function (node) {
      return node && (
        node.__typename === 'ProjectV2SingleSelectField' ||
        node.__typename === 'ProjectV2IterationField'
      );
    }) || null;
  }

  function fetchAllItems(projectId) {
    var items = [];
    function page(cursor) {
      return graphql(QUERIES.items, { id: projectId, cursor: cursor || null }).then(function (data) {
        var connection = data && data.node && data.node.items;
        if (!connection) return items;
        (connection.nodes || []).forEach(function (node) {
          if (node) items.push(node);
        });
        if (connection.pageInfo && connection.pageInfo.hasNextPage) {
          return page(connection.pageInfo.endCursor);
        }
        return items;
      });
    }
    return page(null);
  }

  function appendSubIssues(content) {
    if (!content || content.__typename !== 'Issue' || !content.subIssues) return Promise.resolve();
    var connection = content.subIssues;
    connection.nodes = (connection.nodes || []).filter(Boolean);

    function page(cursor) {
      if (!cursor) return Promise.resolve();
      return graphql(QUERIES.moreSubIssues, { id: content.id, cursor: cursor }).then(function (data) {
        var next = data && data.node && data.node.subIssues;
        if (!next) return null;
        (next.nodes || []).forEach(function (node) {
          if (node) connection.nodes.push(node);
        });
        if (next.pageInfo && next.pageInfo.hasNextPage) return page(next.pageInfo.endCursor);
        return null;
      });
    }

    var cursor = connection.pageInfo && connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
    return page(cursor);
  }

  function statusOf(raw, fieldId) {
    var values = (raw.fieldValues && raw.fieldValues.nodes) || [];
    var match = values.find(function (node) {
      return node && node.field && node.field.id === fieldId;
    });
    if (!match) return '';
    return match.name || match.title || '';
  }

  function mapItem(raw, fieldId) {
    var content = raw.content;
    if (!content || content.__typename !== 'Issue') return null;
    return {
      itemId: raw.id,
      status: statusOf(raw, fieldId),
      content: {
        type: 'Issue',
        id: content.id,
        number: content.number,
        title: content.title,
        url: content.url,
        state: content.state,
        parentUrl: content.parent && content.parent.url,
        subIssues: (content.subIssues && content.subIssues.nodes || []).filter(Boolean).map(function (sub) {
          return {
            id: sub.id,
            number: sub.number,
            title: sub.title,
            url: sub.url,
            state: sub.state
          };
        })
      }
    };
  }

  function loadBoard(parsed) {
    return fetchProject(parsed).then(function (project) {
      var view = pickView(project.views && project.views.nodes, parsed.view);
      var field = columnField(view);
      return fetchAllItems(project.id).then(function (rawItems) {
        var chain = Promise.resolve();
        rawItems.forEach(function (raw) {
          chain = chain.then(function () {
            return appendSubIssues(raw.content);
          });
        });
        return chain.then(function () {
          var modelItems = [];
          var byItemId = {};
          var byContentId = {};
          var archivedContentIds = {};
          rawItems.forEach(function (raw) {
            var contentId = raw.content && raw.content.id;
            if (raw.isArchived) {
              if (contentId) archivedContentIds[contentId] = true;
              return;
            }
            var mapped = mapItem(raw, field && field.id);
            if (!mapped) return;
            modelItems.push(mapped);
            byItemId[mapped.itemId] = mapped;
            byContentId[mapped.content.id] = mapped;
          });
          return {
            project: { id: project.id, title: project.title, number: project.number },
            view: view ? { number: view.number, name: view.name, layout: view.layout } : null,
            field: field,
            hierarchy: core.buildHierarchy(modelItems),
            byItemId: byItemId,
            byContentId: byContentId,
            archivedContentIds: archivedContentIds
          };
        });
      });
    });
  }

  function fetchDirectSubIssues(itemId) {
    var children = [];
    function page(cursor) {
      return graphql(QUERIES.itemSubIssues, { id: itemId, cursor: cursor || null }).then(function (data) {
        var content = data && data.node && data.node.content;
        var connection = content && content.subIssues;
        if (!connection) return children;
        (connection.nodes || []).forEach(function (node) {
          if (node) children.push(node);
        });
        if (connection.pageInfo && connection.pageInfo.hasNextPage) {
          return page(connection.pageInfo.endCursor);
        }
        return children;
      });
    }
    return page(null);
  }

  function addItem(projectId, contentId) {
    return graphql(QUERIES.addItem, { projectId: projectId, contentId: contentId }).then(function (data) {
      var item = data && data.addProjectV2ItemById && data.addProjectV2ItemById.item;
      if (!item || !item.id) throw new Error('GitHub не добавил субтаск на доску');
      return item.id;
    });
  }

  function writeColumn(projectId, itemId, fieldId, update) {
    if (update.clear) {
      return graphql(QUERIES.clearField, {
        projectId: projectId,
        itemId: itemId,
        fieldId: fieldId
      }).then(function (data) {
        if (!data || !data.clearProjectV2ItemFieldValue || !data.clearProjectV2ItemFieldValue.projectV2Item) {
          throw new Error('GitHub не очистил поле субтаска');
        }
      });
    }
    if (update.singleSelectOptionId) {
      return graphql(QUERIES.setSingle, {
        projectId: projectId,
        itemId: itemId,
        fieldId: fieldId,
        optionId: update.singleSelectOptionId
      }).then(function (data) {
        if (!data || !data.updateProjectV2ItemFieldValue || !data.updateProjectV2ItemFieldValue.projectV2Item) {
          throw new Error('GitHub не обновил колонку субтаска');
        }
      });
    }
    if (update.iterationId) {
      return graphql(QUERIES.setIteration, {
        projectId: projectId,
        itemId: itemId,
        fieldId: fieldId,
        iterationId: update.iterationId
      }).then(function (data) {
        if (!data || !data.updateProjectV2ItemFieldValue || !data.updateProjectV2ItemFieldValue.projectV2Item) {
          throw new Error('GitHub не обновил итерацию субтаска');
        }
      });
    }
    return Promise.resolve();
  }

  function findPathByItemId(board, itemId) {
    var nodes = board.hierarchy && board.hierarchy.nodes;
    if (!nodes) return null;
    var paths = Object.keys(nodes);
    for (var i = 0; i < paths.length; i += 1) {
      if (nodes[paths[i]].itemId === itemId) return paths[i];
    }
    return null;
  }

  function moveDescendants(board, update, settings) {
    var originPath = findPathByItemId(board, update.itemId);
    var origin = originPath ? board.hierarchy.nodes[originPath] : null;
    if (!origin || !origin.children || origin.children.length === 0) {
      return Promise.resolve({ moved: [], failed: [], skipped: [] });
    }

    var moved = [];
    var failed = [];
    var skipped = [];
    var seen = new Set();

    function ensureItem(issue) {
      var known = board.byContentId[issue.id];
      if (known && known.itemId) return Promise.resolve(known.itemId);
      if (board.archivedContentIds[issue.id] || !settings.addMissing) {
        skipped.push({ title: issue.title || issue.url || issue.id });
        return Promise.resolve(null);
      }
      return addItem(board.project.id, issue.id).then(function (itemId) {
        board.byContentId[issue.id] = { itemId: itemId, content: { id: issue.id } };
        return itemId;
      });
    }

    function walk(itemId) {
      return fetchDirectSubIssues(itemId).then(function (children) {
        var chain = Promise.resolve();
        children.forEach(function (child) {
          chain = chain.then(function () {
            if (!child || !child.id || seen.has(child.id)) return null;
            seen.add(child.id);
            return ensureItem(child).then(function (childItemId) {
              if (!childItemId) return null;
              return writeColumn(board.project.id, childItemId, update.fieldId, update).then(function () {
                moved.push({ title: child.title || child.url || child.id });
                return walk(childItemId);
              });
            }).catch(function (error) {
              failed.push({
                title: child.title || child.id,
                message: error && error.message ? error.message : String(error)
              });
              return null;
            });
          });
        });
        return chain;
      });
    }

    return walk(update.itemId).then(function () {
      return { moved: moved, failed: failed, skipped: skipped };
    });
  }

  root.GitBoardApi = {
    loadBoard: loadBoard,
    moveDescendants: moveDescendants
  };
})(globalThis);
