import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const sandbox = { URL, Set, Map };
runInNewContext(readFileSync(new URL('../src/core.js', import.meta.url), 'utf8'), sandbox);
const core = sandbox.GitBoardCore;

const org = core.parseProjectLocation('https://github.com/orgs/acme/projects/7/views/3');
assert.deepEqual(JSON.parse(JSON.stringify(org)), { kind: 'org', owner: 'acme', number: 7, view: 3 });

const user = core.parseProjectLocation('https://github.com/users/ada/projects/1');
assert.equal(user.kind, 'user');
assert.equal(user.view, null);

const repo = core.parseProjectLocation('https://github.com/acme/app/projects/4/views/2?query=is%3Aopen');
assert.deepEqual(JSON.parse(JSON.stringify(repo)), { kind: 'repo', owner: 'acme', name: 'app', number: 4, view: 2 });

assert.equal(core.parseProjectLocation('https://github.com/acme/app/issues/4'), null);
assert.equal(core.normalizeIssuePath('https://github.com/acme/app/issues/12?board=1'), '/acme/app/issues/12');
assert.equal(core.normalizeIssuePath('/acme/app/pull/9'), '/acme/app/pull/9');

const updates = core.extractFieldUpdates({
  operationName: 'Update',
  variables: {
    input: {
      projectId: 'PVT_1',
      itemId: 'PVTI_1',
      fieldId: 'PVTSSF_1',
      value: { singleSelectOptionId: 'opt_a' }
    }
  }
});
assert.equal(updates.length, 1);
assert.equal(updates[0].singleSelectOptionId, 'opt_a');
assert.equal(updates[0].clear, false);

const batched = core.extractFieldUpdates([
  { variables: { input: { projectId: 'P', itemId: 'A', fieldId: 'F', value: { iterationId: 'iter' } } } },
  { variables: { input: { projectId: 'P', itemId: 'A', fieldId: 'F', value: { iterationId: 'iter' } } } },
  { variables: { input: { projectId: 'P', itemId: 'B', fieldId: 'F', value: { text: 'note' } } } }
]);
assert.equal(batched.length, 1);
assert.equal(batched[0].iterationId, 'iter');

const clears = core.extractFieldClears({
  query: 'mutation { clearProjectV2ItemFieldValue(input: $input) { projectV2Item { id } } }',
  variables: { input: { projectId: 'P', itemId: 'A', fieldId: 'F' } }
});
assert.equal(clears.length, 1);
assert.equal(clears[0].clear, true);
assert.equal(core.extractFieldClears({ variables: { input: { projectId: 'P', itemId: 'A', fieldId: 'F' } } }).length, 0);

const model = core.buildHierarchy([
  {
    itemId: 'PVTI_A',
    status: 'Todo',
    content: {
      type: 'Issue',
      id: 'I_A',
      number: 1,
      title: 'Parent',
      url: 'https://github.com/acme/app/issues/1',
      state: 'OPEN',
      parentUrl: null,
      subIssues: [
        { id: 'I_B', number: 2, title: 'Child', url: 'https://github.com/acme/app/issues/2', state: 'OPEN' },
        { id: 'I_C', number: 3, title: 'Off board', url: 'https://github.com/acme/app/issues/3', state: 'OPEN' }
      ]
    }
  },
  {
    itemId: 'PVTI_B',
    status: 'Done',
    content: {
      type: 'Issue',
      id: 'I_B',
      number: 2,
      title: 'Child',
      url: 'https://github.com/acme/app/issues/2',
      state: 'OPEN',
      parentUrl: 'https://github.com/acme/app/issues/1',
      subIssues: [
        { id: 'I_D', number: 4, title: 'Grandchild', url: 'https://github.com/acme/app/issues/4', state: 'CLOSED' }
      ]
    }
  }
]);

const plain = JSON.parse(JSON.stringify(model));
assert.deepEqual(plain.rootPaths, ['/acme/app/issues/1']);
assert.deepEqual(plain.nodes['/acme/app/issues/1'].children, [
  '/acme/app/issues/2',
  '/acme/app/issues/3'
]);
assert.deepEqual(plain.nodes['/acme/app/issues/2'].children, ['/acme/app/issues/4']);
assert.equal(model.nodes['/acme/app/issues/3'].onBoard, false);
assert.equal(model.nodes['/acme/app/issues/2'].status, 'Done');
assert.ok(model.childPaths.includes('/acme/app/issues/2'));
assert.ok(model.childPaths.includes('/acme/app/issues/4'));
assert.ok(!model.childPaths.includes('/acme/app/issues/1'));

console.log('core tests passed');
