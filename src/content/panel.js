(function (root) {
  'use strict';

  var FIELDS = [
    ['followEnabled', 'Переносить субтаски вместе с задачей'],
    ['groupEnabled', 'Группировать субтаски списком'],
    ['addMissing', 'Добавлять отсутствующие субтаски на доску'],
    ['reloadAfterMove', 'Обновлять доску после переноса']
  ];

  function mount(handlers) {
    var panel = document.createElement('section');
    panel.className = 'gitboard-panel';
    panel.setAttribute('aria-label', 'GitBoard');

    var header = document.createElement('div');
    header.className = 'gitboard-panel-header';

    var titleWrap = document.createElement('div');
    var title = document.createElement('div');
    title.className = 'gitboard-panel-title';
    title.textContent = 'GitBoard';
    var project = document.createElement('div');
    project.className = 'gitboard-panel-project';
    titleWrap.appendChild(title);
    titleWrap.appendChild(project);

    var collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'gitboard-icon-button';
    collapse.textContent = '–';
    collapse.setAttribute('aria-label', 'Свернуть GitBoard');

    header.appendChild(titleWrap);
    header.appendChild(collapse);

    var body = document.createElement('div');
    body.className = 'gitboard-panel-body';

    var inputs = {};
    FIELDS.forEach(function (field) {
      var label = document.createElement('label');
      label.className = 'gitboard-check';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', function () {
        var patch = {};
        patch[field[0]] = input.checked;
        handlers.onChange(patch);
      });
      var text = document.createElement('span');
      text.textContent = field[1];
      label.appendChild(input);
      label.appendChild(text);
      body.appendChild(label);
      inputs[field[0]] = input;
    });

    var hint = document.createElement('p');
    hint.className = 'gitboard-hint';
    var status = document.createElement('p');
    status.className = 'gitboard-status';
    body.appendChild(hint);
    body.appendChild(status);

    panel.appendChild(header);
    panel.appendChild(body);
    document.documentElement.appendChild(panel);

    collapse.addEventListener('click', function () {
      var collapsed = panel.classList.toggle('gitboard-panel-collapsed');
      collapse.textContent = collapsed ? 'Git' : '–';
      collapse.setAttribute('aria-label', collapsed ? 'Развернуть GitBoard' : 'Свернуть GitBoard');
    });

    function show() {
      if (!panel.isConnected) document.documentElement.appendChild(panel);
      panel.hidden = false;
    }

    function hide() {
      panel.hidden = true;
    }

    function sync(settings, board) {
      FIELDS.forEach(function (field) {
        inputs[field[0]].checked = !!(settings && settings[field[0]]);
      });
      project.textContent = board && board.project ? board.project.title : '';
    }

    return {
      show: show,
      hide: hide,
      sync: sync,
      setHint: function (text) { hint.textContent = text || ''; },
      setStatus: function (text) { status.textContent = text || ''; }
    };
  }

  root.GitBoardPanel = { mount: mount };
})(globalThis);
