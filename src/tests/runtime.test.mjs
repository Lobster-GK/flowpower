import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import Skills from '@deepseek-ai/dsh-skill';
import Commands from '@deepseek-ai/dsh-commands';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Sessions from '@deepseek-ai/dsh-session';
import Agents from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import Projections from '@deepseek-ai/dsh-session-projection';
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import AFP from '../../dist/dsh.js';

test('real Cordis + agent loop + spawn provider run parallel AFP children without API credentials', { timeout: 15000 }, async t => {
  const ctx = new Context();
  const fibers = [];
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose(); });
  async function mount(plugin, config = {}) {
    const fiber = ctx.plugin(plugin, config); fibers.push(fiber); await fiber.await();
  }
  const requests = [];
  let active = 0;
  let peak = 0;
  class FixtureAdapter extends LlmAdapter {
    async *stream(options) {
      requests.push(options);
      active++; peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setTimeout(resolve, 20));
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: 'Complete independent final' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Complete independent final' } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } finally { active--; }
    }
  }
  for (const plugin of [SystemPrompt, Tools, Skills, Commands, Sessions, Agents, Projections, Llm, AgentLoop, Subagents, Spawn]) await mount(plugin);
  await mount({ name: 'fixture-model', inject: ['llm', 'tools'], apply(ctx) {
    ctx.llm.registerAdapter(['fixture'], new FixtureAdapter());
    for (const name of ['read', 'write', 'edit', 'pwsh', 'skill']) ctx.tools.register({ name, description: name,
      parameters: { type: 'object', properties: {} }, output: { schema: {}, render: () => [] }, async execute() { return null; } });
  } });
  await mount(AFP);
  const handle = await ctx.agents.create({ sessionId: 'afp-runtime-parent',
    meta: { cwd: mkdtempSync(join(tmpdir(), 'afp-runtime-')) }, agentOptions: { provider: 'fixture', model: 'fixture' } });
  t.after(() => handle.dispose());
  const result = await ctx.tools.execute({ name: 'afp_run_subagent', callId: 'afp-runtime-call', agent: handle.agent,
    signal: new AbortController().signal, arguments: { agent: 'afp-observer-agent', prompt: 'Observe all states', count: 3 } });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.value.results.length, 3);
  assert.equal(peak, 3);
  for (const request of requests) {
    assert.ok(request.tools.some(tool => tool.name === 'read'));
    assert.ok(request.tools.some(tool => tool.name === 'write'));
    assert.ok(!request.tools.some(tool => tool.name === 'edit'));
    assert.ok(!request.tools.some(tool => tool.name === 'pwsh'));
    assert.match(JSON.stringify(request.messages), /你是观察 agent/);
  }
  assert.equal(ctx.agents.list().length, 1, 'all child handles disposed');
  const command = await ctx.commands.execute(handle.agent, '/afp-ui-spec a sample page', [], new AbortController().signal);
  assert.ok(command);
  await handle.agent.whenIdle();
  const messages = requests.at(-1).messages;
  assert.match(JSON.stringify(messages), /生成 UI 规格/);
  assert.match(JSON.stringify(messages), /\/afp-ui-spec a sample page/);
});
