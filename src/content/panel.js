(function (root) {
  'use strict';

  var FIELDS = [
    ['groupEnabled', 'Группировать субтаски списком']
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
    var filters = document.createElement('div');
    filters.className = 'gitboard-filters';
    body.appendChild(filters);
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

    var filterKey = '';

    function namesFrom(board, read) {
      var found = {};
      var nodes = board && board.hierarchy && board.hierarchy.nodes;
      if (!nodes) return [];
      Object.keys(nodes).forEach(function (path) {
        var node = nodes[path];
        if (!node || !node.onBoard) return;
        read(node).forEach(function (name) {
          if (name) found[name] = true;
        });
      });
      return Object.keys(found).sort(function (a, b) { return a.localeCompare(b); });
    }

    function choiceList(title, options, selected, onToggle) {
      var block = document.createElement('div');
      block.className = 'gitboard-filter';
      var heading = document.createElement('div');
      heading.className = 'gitboard-filter-title';
      heading.textContent = title;
      block.appendChild(heading);
      if (!options.length) {
        var empty = document.createElement('div');
        empty.className = 'gitboard-hint';
        empty.textContent = 'На доске пока нет';
        block.appendChild(empty);
        return block;
      }
      var list = document.createElement('div');
      list.className = 'gitboard-filter-list';
      options.forEach(function (option) {
        var label = document.createElement('label');
        label.className = 'gitboard-check';
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = selected.indexOf(option) !== -1;
        input.addEventListener('change', function () {
          var next = selected.filter(function (item) { return item !== option; });
          if (input.checked) next.push(option);
          onToggle(next);
        });
        var text = document.createElement('span');
        text.textContent = option;
        label.appendChild(input);
        label.appendChild(text);
        list.appendChild(label);
      });
      block.appendChild(list);
      return block;
    }

    function renderFilters(settings, board) {
      var types = namesFrom(board, function (node) { return [node.issueType]; });
      var labels = namesFrom(board, function (node) { return node.labels || []; });
      var chosenTypes = (settings && settings.groupTypes) || [];
      var chosenLabels = (settings && settings.groupLabels) || [];
      var key = JSON.stringify({ types: types, labels: labels, chosenTypes: chosenTypes, chosenLabels: chosenLabels });
      if (key === filterKey) return;
      filterKey = key;
      filters.textContent = '';
      var note = document.createElement('p');
      note.className = 'gitboard-hint';
      note.textContent = 'Группируются только отмеченные. Пусто — все задачи. Тип и лейбл вместе требуют совпадения по обоим.';
      filters.appendChild(note);
      filters.appendChild(choiceList('Тип', types, chosenTypes, function (next) {
        handlers.onChange({ groupTypes: next });
      }));
      filters.appendChild(choiceList('Лейбл', labels, chosenLabels, function (next) {
        handlers.onChange({ groupLabels: next });
      }));
    }
    function sync(settings, board) {
      FIELDS.forEach(function (field) {
        inputs[field[0]].checked = !!(settings && settings[field[0]]);
      });
      project.textContent = board && board.project ? board.project.title : '';
      renderFilters(settings, board);
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
