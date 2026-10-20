import type { Context } from "@deepseek-ai/cordis";
import type { Agent, AgentOptions } from "@deepseek-ai/dsh-agent";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { renderSkillContent } from "@deepseek-ai/dsh-skill";
import type { SubagentRun } from "@deepseek-ai/dsh-subagent";
import { defineTool, type ToolRestriction } from "@deepseek-ai/dsh-tools";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_PRESETS } from "./agent-presets.js";
import { packageRoot } from "./config.js";
import { getProjectConfig } from "./project-config.js";
import { DSH_GUIDANCE, projectDirectory } from "./dsh-resources.js";

/** Explicit same-name overrides replace the built-in role in full. */
export interface DshAgentOverride {
  persona: string;
  toolFilter: ToolRestriction;
  agentOptions?: AgentOptions;
}

export interface DshConfig {
  /** Provider registered with ctx.subagents, not an LLM provider. */
  subagentProvider?: string;
  /** Exact model string from AFP config -> Harness route. Useful across hosts. */
  modelRoutes?: Record<string, { provider: string; model: string }>;
  agents?: Record<string, DshAgentOverride>;
}

export function validateConfig(config: DshConfig): void {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("AFP config must be an object");
  if (config.subagentProvider !== undefined && (typeof config.subagentProvider !== "string" || !config.subagentProvider.trim())) throw new Error("subagentProvider must be a nonempty string");
  for (const value of [config.modelRoutes, config.agents]) {
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error("agents and modelRoutes must be objects");
  }
  for (const [name, route] of Object.entries(config.modelRoutes ?? {})) {
    if (!route || typeof route.provider !== "string" || !route.provider.trim() || typeof route.model !== "string" || !route.model.trim()) {
      throw new Error(`Invalid modelRoutes.${name}: provider and model are required`);
    }
  }
  for (const [name, role] of Object.entries(config.agents ?? {})) {
    if (!AGENT_PRESETS.some((preset) => preset.name === name)) throw new Error(`Unknown AFP agent override: ${name}`);
    if (!role || typeof role.persona !== "string" || !role.persona.trim() || !role.toolFilter || typeof role.toolFilter !== "object" || Array.isArray(role.toolFilter)) {
      throw new Error(`Override ${name} requires its own persona and toolFilter`);
    }
    for (const value of [role.toolFilter.allow, role.toolFilter.deny]) {
      if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) {
        throw new Error(`Invalid toolFilter for ${name}`);
      }
    }
    if (role.agentOptions !== undefined) {
      const options = role.agentOptions;
      if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error(`Invalid agentOptions for ${name}`);
      for (const key of ["provider", "model", "reasoningEffort"] as const) {
        if (options[key] !== undefined && (typeof options[key] !== "string" || !options[key]?.trim())) throw new Error(`Invalid ${key} for ${name}`);
      }
      if (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0)) throw new Error(`Invalid maxTokens for ${name}`);
    }
  }
}

/** Only visible task attachments; never resurrect compacted or hidden raw events. */
export function taskAttachments(agent: Agent): ContentBlock[] {
  const messages = agent.session.deriveMessages().filter((message) => message.source.kind === "user");
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].content.some((block) => block.type === "text" && /^\/afp-[a-z-]+(?:\s|$)/.test(block.text))) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].content.some((block) => block.type === "image" || block.type === "file")) { start = i; break; }
    }
  }
  return start < 0 ? [] : messages.slice(start).flatMap((message) => message.content.filter((block) => block.type === "image" || block.type === "file"));
}

function defaultFilter(ctx: Context, agent: Agent, tools: Record<string, boolean>): ToolRestriction {
  const available = new Set(ctx.tools.schemas(agent).map((tool) => tool.name));
  const allow: string[] = [];
  for (const [capability, enabled] of Object.entries(tools)) {
    if (!enabled) continue;
    const actual = capability === "bash" ? (available.has("pwsh") ? "pwsh" : "bash") : capability;
    if (!available.has(actual)) throw new Error(`AFP role requires tool '${actual}'. Load the matching Harness filesystem/shell tool plugin.`);
    allow.push(actual);
  }
  for (const name of ["skill", "afp_get_project_config", ...(tools.read ? ["glob", "grep", "read_image"] : [])]) {
    if (available.has(name)) allow.push(name);
  }
  return { allow };
}

export function registerSubagents(ctx: Context, config: DshConfig): void {
  ctx.tools.register(defineTool({
    name: "afp_run_subagent",
    description: "Execute an AFP role for one stage. Supply the full task and ordered skills. count=1 is single-agent; count=2..5 starts all independent same-role children before awaiting their results, each with all task attachments. Returns every complete final for parent merging/persistence. On failure the stage must not be marked done. This is not the full scene orchestrator.",
    parameters: {
      agent: { type: "string", required: true, enum: AGENT_PRESETS.map((item) => item.name) },
      prompt: { type: "string", required: true, description: "Complete single-stage task, asset facts, required output and persistence instructions." },
      skills: { type: "array", items: { type: "string" }, description: "stage.use.skill in its original order." },
      count: { type: "integer", description: "1 by default; use stage.multiAgent.agentCount for independent complete results (1..5)." },
    },
    output: { schema: { type: "json" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }] },
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      const parent = exec.agent;
      const directory = projectDirectory(parent);
      if (!parent) throw new Error("AFP delegation requires a parent agent");
      const count = args.count ?? 1;
      if (count < 1 || count > 5) throw new Error("count must be between 1 and 5");
      if (!args.prompt.trim()) throw new Error("prompt cannot be empty");
      const preset = AGENT_PRESETS.find((item) => item.name === args.agent)!;
      const project = getProjectConfig(directory);
      if (project.errors.length) throw new Error(project.errors.join("\n"));
      const providerName = config.subagentProvider ?? "spawn";
      const provider = ctx.subagents.getProvider(providerName);
      if (!provider) throw new Error(`AFP subagent provider '${providerName}' is unavailable`);
      const override = config.agents?.[preset.name];
      const persona = override ? override.persona : readFileSync(join(packageRoot(), "agents", preset.promptFile), "utf8");
      const toolFilter = override ? override.toolFilter : defaultFilter(ctx, parent, preset.tools);
      let agentOptions = override?.agentOptions;
      if (!override) {
        const model = project.subagents.find((item) => item.name === preset.name)?.model;
        if (model) {
          const route = config.modelRoutes?.[model];
          // Do not guess whether a slash is a provider prefix or part of a model id.
          if (!route) throw new Error(`Configure modelRoutes[${JSON.stringify(model)}] with the exact Harness provider and model`);
          agentOptions = route;
        }
      }
      for (const capability of ["persona", "toolFilter", "depthLimit", ...(agentOptions ? ["agentOptions"] as const : [])] as const) {
        if (!provider.capabilities[capability]) throw new Error(`Provider '${providerName}' does not support ${capability}`);
      }
      const skillText: string[] = [];
      for (const name of args.skills ?? []) {
        const skill = await ctx.skills.get(name, { cwd: directory, scope: parent, signal: exec.signal });
        if (!skill || !skill.invocation.modelInvocable) throw new Error(`AFP stage skill unavailable to model: ${name}`);
        skillText.push(renderSkillContent(skill));
      }
      const attachments = taskAttachments(parent);
      if (attachments.some((block) => block.type === "image")) {
        const route = { ...parent.options, ...(parent.session.requestContext() ?? {}),
          ...provider.agentRouteDefaults, ...agentOptions };
        if (!route.provider || !route.model) throw new Error("AFP image delegation requires an explicit effective provider/model route");
        const info = await ctx.llm.resolveModelInfo(route.provider, route.model, exec.signal);
        if (!info.inputModalities?.includes("image")) {
          throw new Error(`AFP cannot pass images to ${route.provider}/${route.model}: the route must declare image input support`);
        }
      }
      // Every child's start is submitted without waiting for any sibling start/result.
      const abort = new AbortController();
      const cancel = () => abort.abort(exec.signal.reason);
      exec.signal.addEventListener("abort", cancel, { once: true });
      if (exec.signal.aborted) cancel();
      try {
        const tasks = Array.from({ length: count }, async (_, index) => {
          let run: SubagentRun | undefined;
          try {
            run = await ctx.subagents.start(providerName, {
              parent, signal: abort.signal, label: `${preset.name} ${index + 1}/${count}`,
              persona, toolFilter, maxDepth: 3, ...(agentOptions ? { agentOptions } : {}),
              prompt: [...attachments, { type: "text", text: [DSH_GUIDANCE,
                `你是 agent-${index + 1}，共 ${count} 个独立执行者。${count > 1 ? "每个执行者都完成全部任务，不分工、不读取其他执行者结果；只写自己的 agent-<N> 目录，canonical 文件由主模型合并。" : "按单执行者阶段任务执行。"}`,
                args.prompt, ...skillText].join("\n\n") }],
            });
            const result = await run.result;
            if (result.stopReason !== "completed") throw new Error(`${preset.name} agent-${index + 1}: ${result.stopReason}; ${result.diagnostic ?? "stage did not complete"}`);
            return { agent: preset.name, index: index + 1, id: run.id, output: result.output };
          } catch (error) {
            abort.abort(error);
            throw error;
          } finally {
            if (run) {
              try { await run.dispose(); } catch (error) { abort.abort(error); throw error; }
            }
          }
        });
        const settled = await Promise.allSettled(tasks);
        const failures = settled.filter((item): item is PromiseRejectedResult => item.status === "rejected");
        if (failures.length) throw new AggregateError(failures.map((item) => item.reason),
          `AFP stage failed: ${failures.map((item) => String(item.reason)).join("; ")}`);
        exec.signal.throwIfAborted();
        return JSON.parse(JSON.stringify({ results: settled.map((item) => (item as PromiseFulfilledResult<unknown>).value) }));
      } finally {
        exec.signal.removeEventListener("abort", cancel);
      }
    },
  }));
}
