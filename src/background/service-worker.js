'use strict';

var GRAPHQL_URL = 'https://api.github.com/graphql';

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (!message || message.type !== 'gitboard-graphql') return undefined;

  callGithub(message.token, message.query, message.variables)
    .then(function (data) {
      sendResponse({ ok: true, data: data });
    })
    .catch(function (error) {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });

  return true;
});

function callGithub(token, query, variables) {
  if (!token || typeof token !== 'string') {
    return Promise.reject(new Error('Не задан токен GitHub API'));
  }

  return fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token.trim(),
      'User-Agent': 'GitBoard-ui-plugin'
    },
    body: JSON.stringify({ query: query, variables: variables || {} })
  }).then(function (response) {
    return response.text().then(function (text) {
      return unwrapGraphql(response.status, text);
    });
  });
}

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
    throw new Error('GitHub API HTTP ' + status);
  }

  return payload.data;
}
