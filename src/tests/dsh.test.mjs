import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import Skills from '@deepseek-ai/dsh-skill';
import Commands from '@deepseek-ai/dsh-commands';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import plugin from '../../dist/dsh.js';
import { ApolloFlowpower } from '../../dist/index.js';
import { initializeProject, executeAfpTool } from '../../dist/core-tools.js';

const capabilities = { persona: true, toolFilter: true, depthLimit: true, agentOptions: true };

async function harness(t, config = {}, backend = {}) {
  const ctx = new Context();
  const fibers = [];
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose(); });
  async function mount(plugin, config) {
    const fiber = ctx.plugin(plugin, config);
    fibers.push(fiber);
    await fiber.await();
    return fiber;
  }
  await mount(SystemPrompt, {});
  await mount(Tools, {});
  await mount(Skills, {});
  await mount(Commands, {});
  const requests = [];
  const disposed = [];
  await mount({ name: 'test-provider', apply(ctx) {
    ctx.provide('llm', { async resolveModelInfo() { return { inputModalities: ['text', 'image'] }; } });
    ctx.provide('subagents', {
      getProvider: () => ({ capabilities: { ...capabilities, ...backend.capabilities } }),
      async start(name, request) {
        const index = requests.push(request);
        if (backend.start) return backend.start({ name, request, index, requests, disposed });
        return { id: `child-${index}`, result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: `final-${index}` }] }),
          async dispose() { disposed.push(index); } };
      },
    });
  } });
  const fiber = await mount(plugin, config);
  await mount({ name: 'test-host-tools', inject: ['tools'], apply(ctx) {
    for (const name of ['read', 'write', 'edit', 'pwsh', 'skill', 'glob', 'grep', 'read_image', 'str_replace_editor']) {
      ctx.tools.register({ name, description: name, parameters: { type: 'object', properties: {} },
        output: { schema: {}, render: () => [] }, async execute() { return null; } });
    }
  } });
  const directory = mkdtempSync(join(tmpdir(), 'afp-dsh-test-'));
  const messages = [];
  const injected = [];
  const agent = { id: `parent-${directory}`, options: { provider: 'test', model: 'vision' },
    session: { header: { cwd: directory }, deriveMessages: () => messages, requestContext: () => undefined },
    inject(message) { injected.push(message); },
    steer(message) { messages.push(message); },
  };
  let callId = 0;
  const call = (name, args = {}, signal = new AbortController().signal, caller = agent) =>
    ctx.tools.execute({ name, arguments: args, agent: caller, signal, callId: `call-${++callId}` });
  return { ctx, fiber, agent, messages, injected, directory, call, requests, disposed };
}

test('real Harness registries mount tools, skills and 11 commands; disposal unregisters them', async (t) => {
  const h = await harness(t);
  assert.equal(h.ctx.tools.schemas().filter(x => x.name.startsWith('afp_')).length, 5);
  assert.equal(h.ctx.commands.list(h.agent).length, 11);
  const skills = await h.ctx.skills.list({ cwd: h.directory });
  assert.ok(skills.some(x => x.name === 'frontend-ui-layout-spec'));
  assert.equal(h.messages.length + h.injected.length, 0, 'no automatic workflow injection');
  assert.equal(existsSync(join(h.directory, '.opencode')), false, 'no boot-time process cwd writes');
  await h.fiber.dispose();
  assert.equal(h.ctx.tools.schemas().filter(x => x.name.startsWith('afp_')).length, 0);
  assert.equal(h.ctx.commands.list(h.agent).length, 0);
  assert.equal((await h.ctx.skills.list()).length, 0);
});

test('AFP JSON matches OpenCode on initialized fixtures, including missing scene and malformed config', async (t) => {
  const h = await harness(t);
  const openCode = await ApolloFlowpower({ directory: h.directory });
  for (const [name, args] of [
    ['afp_list_scenes', { reason: 'tolerated', input: { arbitrary: true } }],
    ['afp_load_scene_template', { scene: 'text-to-page' }],
    ['afp_load_scene_template', { scene: 'missing-scene' }],
    ['afp_get_project_config', {}], ['afp_doctor', {}],
  ]) {
    const expected = await openCode.tool[name].execute(args, { directory: h.directory });
    const actual = await h.call(name, args);
    assert.equal(actual.isError, false, JSON.stringify(actual));
    assert.deepEqual(actual.value, JSON.parse(expected.output));
  }
  const config = join(h.directory, '.opencode/apollo-flowpower/config.yaml');
  writeFileSync(config, 'assets: [\n');
  const actual = await h.call('afp_get_project_config');
  assert.deepEqual(actual.value, JSON.parse(executeAfpTool('afp_get_project_config', h.directory).output));
  assert.ok(actual.value.errors.length);
  assert.equal(readFileSync(config, 'utf8'), 'assets: [\n');
});

test('parameters and caller cwd fail closed; projects do not share state', async (t) => {
  const h = await harness(t);
  assert.equal((await h.call('afp_load_scene_template', {})).isError, true);
  assert.equal((await h.call('afp_load_scene_template', { scene: 4 })).isError, true);
  assert.equal((await h.call('afp_list_scenes', {}, undefined, {})).isError, true);
  const other = mkdtempSync(join(tmpdir(), 'afp-other-project-'));
  initializeProject(other);
  writeFileSync(join(other, '.opencode/apollo-flowpower/scene-template/custom.yaml'), 'id: custom\nname: custom\ndescription: custom\nstages:\n  - id: test\n    instruction: test\n');
  const second = { ...h.agent, session: { ...h.agent.session, header: { cwd: other } } };
  const one = await h.call('afp_list_scenes');
  const two = await h.call('afp_list_scenes', {}, undefined, second);
  assert.ok(!one.value.scenes.some(x => x.id === 'custom'));
  assert.ok(two.value.scenes.some(x => x.id === 'custom'));
});

test('commands retain plugin instructions, exact user input and attachment order', async (t) => {
  const h = await harness(t);
  const attachments = [{ type: 'image', attachment: { id: 'image-1' } }, { type: 'file', attachment: { id: 'file-2' } }];
  const cmd = h.ctx.commands.find(h.agent, 'afp-scene');
  const result = await cmd.handler({ agent: h.agent, rawInput: ' scene=text-to-page build it', attachments, signal: new AbortController().signal });
  assert.equal(result.kind, 'success');
  assert.equal(h.injected[0].source.kind, 'plugin');
  assert.match(h.injected[0].content[0].text, /APOLLO_FLOWPOWER_SCENE_REQUEST_V1/);
  assert.deepEqual(h.messages[0].content.slice(0, 2), attachments);
  assert.equal(h.messages[0].content[2].text, '/afp-scene scene=text-to-page build it');
  const before = h.messages.length;
  const abort = new AbortController(); abort.abort();
  assert.throws(() => cmd.handler({ agent: h.agent, rawInput: '', attachments: [], signal: abort.signal }));
  assert.equal(h.messages.length, before);
});

test('user command and scene template edits survive repeated initialization', async (t) => {
  const h = await harness(t);
  initializeProject(h.directory);
  const scene = join(h.directory, '.opencode/apollo-flowpower/scene-template/text-to-page.yaml');
  writeFileSync(scene, '# user template\nid: custom-preserved\n');
  const commands = join(h.directory, '.opencode/commands');
  mkdirSync(commands, { recursive: true });
  writeFileSync(join(commands, 'afp-ui-spec.md'), '# Project command\nCustom prompt');
  h.ctx.commands.find(h.agent, 'afp-ui-spec').handler({ agent: h.agent, rawInput: '', attachments: [], signal: new AbortController().signal });
  assert.match(h.injected[0].content[0].text, /Custom prompt/);
  assert.equal(readFileSync(scene, 'utf8'), '# user template\nid: custom-preserved\n');
});

test('all children start before any result is available, receive full images and ordered skills, and are disposed', async (t) => {
  const results = [];
  const h = await harness(t, {}, { start({ request, index, requests, disposed }) {
    const result = new Promise(resolve => { results.push(resolve); });
    if (requests.length === 3) queueMicrotask(() => results.forEach((resolve, i) => resolve({ stopReason: 'completed', output: [{ type: 'text', text: `complete-${i + 1}` }] })));
    return { id: `child-${index}`, result, async dispose() { disposed.push(index); } };
  } });
  const images = [{ type: 'image', attachment: { id: 'one' } }, { type: 'image', attachment: { id: 'two' } }];
  h.messages.push(createUserMessage({ source: { kind: 'user' }, content: [...images, { type: 'text', text: '/afp-scene all states' }] }));
  const result = await h.call('afp_run_subagent', { agent: 'afp-observer-agent', prompt: 'Observe everything', count: 3,
    skills: ['frontend-ui-layout-spec', 'frontend-component-mapping-spec'] });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.deepEqual(result.value.results.map(x => x.output[0].text), ['complete-1', 'complete-2', 'complete-3']);
  assert.equal(h.disposed.length, 3);
  for (const request of h.requests) {
    assert.deepEqual(request.prompt.slice(0, 2), images);
    const text = request.prompt.at(-1).text;
    assert.ok(text.indexOf('<skill_content name="frontend-ui-layout-spec"') < text.indexOf('<skill_content name="frontend-component-mapping-spec"'));
    assert.ok(request.toolFilter.allow.includes('write'));
    assert.ok(!request.toolFilter.allow.includes('edit'));
    assert.ok(!request.toolFilter.allow.includes('pwsh'));
    assert.ok(!request.toolFilter.allow.includes('str_replace_editor'));
  }
});

test('child failure aborts siblings, waits for disposal and returns a tool error', async (t) => {
  const h = await harness(t, {}, { start({ request, index, disposed }) {
    const result = index === 1 ? Promise.resolve({ stopReason: 'error', output: [] }) : new Promise(resolve => {
      const cancel = () => resolve({ stopReason: 'aborted', output: [] });
      request.signal.addEventListener('abort', cancel, { once: true });
      if (request.signal.aborted) cancel();
    });
    return { id: `child-${index}`, result, async dispose() { disposed.push(index); } };
  } });
  const result = await h.call('afp_run_subagent', { agent: 'afp-builder-agent', prompt: 'Build', count: 3 });
  assert.equal(result.isError, true);
  assert.equal(h.requests.length, 3);
  assert.equal(h.disposed.length, 3);
  assert.ok(h.requests.every(x => x.signal.aborted));
});

test('provider capability failure happens before any child starts', async (t) => {
  const h = await harness(t, {}, { capabilities: { toolFilter: false } });
  const result = await h.call('afp_run_subagent', { agent: 'afp-builder-agent', prompt: 'Build' });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /toolFilter/);
  assert.equal(h.requests.length, 0);
});

test('model mapping is exact and same-name role overrides replace all defaults', async (t) => {
  const h = await harness(t, { modelRoutes: { vision: { provider: 'custom', model: 'vision-v1' } },
    agents: { 'afp-review-agent': { persona: 'custom reviewer', toolFilter: { allow: ['read'] } } } });
  initializeProject(h.directory);
  const file = join(h.directory, '.opencode/apollo-flowpower/config.yaml');
  writeFileSync(file, 'schemaVersion: 1\nsubagents:\n  afp-observer-agent:\n    model: vision\n  afp-review-agent:\n    model: unmapped\nassets: []\n');
  const first = await h.call('afp_run_subagent', { agent: 'afp-observer-agent', prompt: 'Observe' });
  assert.equal(first.isError, false, JSON.stringify(first));
  assert.deepEqual(h.requests[0].agentOptions, { provider: 'custom', model: 'vision-v1' });
  const second = await h.call('afp_run_subagent', { agent: 'afp-review-agent', prompt: 'Review' });
  assert.equal(second.isError, false, JSON.stringify(second));
  assert.equal(h.requests[1].persona, 'custom reviewer');
  assert.deepEqual(h.requests[1].toolFilter, { allow: ['read'] });
  assert.equal(h.requests[1].agentOptions, undefined);
  writeFileSync(file, 'subagents:\n  afp-observer-agent:\n    model: unknown\nassets: []\n');
  assert.equal((await h.call('afp_run_subagent', { agent: 'afp-observer-agent', prompt: 'Observe' })).isError, true);
  assert.equal(h.requests.length, 2);
});

test('legacy project skill overrides bundle and updates its body; native project provider wins', async (t) => {
  const h = await harness(t);
  const dir = join(h.directory, '.opencode/skills/frontend-ui-layout-spec');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  const header = '---\nname: frontend-ui-layout-spec\ndescription: custom\n---\n';
  writeFileSync(file, header + 'project body');
  const first = await h.ctx.skills.get('frontend-ui-layout-spec', { cwd: h.directory });
  assert.match(first.content, /project body/);
  assert.equal(first.resourceBase.path, dir);
  writeFileSync(file, header + 'updated body');
  assert.match((await h.ctx.skills.get(first.name, { cwd: h.directory })).content, /updated body/);
  const native = h.ctx.plugin({ name: 'native-project-test', inject: ['skills'], apply(ctx) {
    ctx.skills.registerProvider(() => ({ name: 'native-project-test', async list() {
      return [{ ...first, provider: 'native-project-test', source: 'project-dsh', rank: 100, locator: 'native' }];
    }, async get() { return { ...first, provider: 'native-project-test', content: 'native project' }; } }));
  } });
  await native.await();
  t.after(() => native.dispose());
  assert.equal((await h.ctx.skills.get(first.name, { cwd: h.directory })).content, 'native project');
});

test('caller cancellation reaches every child and waits for cleanup', async (t) => {
  const cancel = new AbortController();
  const h = await harness(t, {}, { start({ request, index, requests, disposed }) {
    const result = new Promise(resolve => {
      const abort = () => resolve({ stopReason: 'aborted', output: [] });
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
    });
    if (requests.length === 3) queueMicrotask(() => cancel.abort());
    return { id: `child-${index}`, result, async dispose() { disposed.push(index); } };
  } });
  const result = await h.call('afp_run_subagent', { agent: 'afp-builder-agent', prompt: 'Build', count: 3 }, cancel.signal);
  assert.equal(result.isError, true);
  assert.equal(h.disposed.length, 3);
  assert.ok(h.requests.every(x => x.signal.aborted));
});

test('startup and disposal failures do not leave siblings running', async (t) => {
  for (const failure of ['start', 'dispose']) {
    const h = await harness(t, {}, { start({ index, disposed }) {
      if (index === 2 && failure === 'start') throw new Error('startup failed');
      return { id: `child-${index}`, result: Promise.resolve({ stopReason: 'completed', output: [] }),
        async dispose() { disposed.push(index); if (index === 2 && failure === 'dispose') throw new Error('cleanup failed'); } };
    } });
    const result = await h.call('afp_run_subagent', { agent: 'afp-builder-agent', prompt: 'Build', count: 3 });
    assert.equal(result.isError, true);
    assert.equal(h.disposed.length, failure === 'start' ? 2 : 3);
  }
});

test('missing skills and invalid counts start no children', async (t) => {
  const h = await harness(t);
  for (const extra of [{ count: 0 }, { count: 6 }, { count: 1.5 }, { skills: ['not-a-skill'] }]) {
    assert.equal((await h.call('afp_run_subagent', { agent: 'afp-builder-agent', prompt: 'Build', ...extra })).isError, true);
  }
  assert.equal(h.requests.length, 0);
});

test('a text-only route cannot silently accept image delegation', async (t) => {
  const h = await harness(t);
  h.ctx.llm.resolveModelInfo = async () => ({ inputModalities: ['text'] });
  h.messages.push(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: { id: 'image' } }] }));
  const result = await h.call('afp_run_subagent', { agent: 'afp-observer-agent', prompt: 'Observe' });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /image input support/);
  assert.equal(h.requests.length, 0);
});
