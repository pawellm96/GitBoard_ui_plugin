(function () {
  'use strict';

  var settingsApi = globalThis.GitBoardSettings;
  var fields = ['groupEnabled'];
  var tokenInput = document.getElementById('token');
  var result = document.getElementById('result');

  function say(text) {
    result.textContent = text || '';
  }

  settingsApi.load().then(function (settings) {
    fields.forEach(function (name) {
      document.getElementById(name).checked = !!settings[name];
    });
    tokenInput.value = settings.token || '';
  });

  fields.forEach(function (name) {
    document.getElementById(name).addEventListener('change', function (event) {
      var patch = {};
      patch[name] = event.target.checked;
      settingsApi.save(patch).catch(function (error) {
        say(error && error.message ? error.message : 'Не удалось сохранить настройку');
      });
    });
  });

  document.getElementById('save').addEventListener('click', function () {
    settingsApi.save({ token: tokenInput.value.trim() }).then(function () {
      say(tokenInput.value.trim() ? 'Токен сохранён.' : 'Токен очищен. Используется сессия GitHub.');
    }).catch(function (error) {
      say(error && error.message ? error.message : 'Не удалось сохранить токен');
    });
  });

  document.getElementById('check').addEventListener('click', function () {
    var token = tokenInput.value.trim();
    if (!token) {
      say('Токен пуст: на странице проекта используется текущий вход GitHub.');
      return;
    }
    say('Проверяю токен…');
    chrome.runtime.sendMessage({
      type: 'gitboard-graphql',
      token: token,
      query: 'query GitBoardViewer { viewer { login } }',
      variables: {}
    }).then(function (response) {
      if (!response || !response.ok) {
        say((response && response.error) || 'Токен не подошёл');
        return;
      }
      var login = response.data && response.data.viewer && response.data.viewer.login;
      say(login ? 'Токен работает: ' + login : 'Токен принят.');
    }).catch(function (error) {
      say(error && error.message ? error.message : 'Не удалось проверить токен');
    });
  });
})();
