import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { SkillCandidate, SkillDefinition } from "@deepseek-ai/dsh-skill";
import type {} from "@deepseek-ai/dsh-commands";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { parse } from "yaml";
import { packageRoot } from "./config.js";
import { initializeProject } from "./core-tools.js";

export function projectDirectory(agent: Agent | undefined): string {
  const directory = agent?.session.header.cwd;
  if (!directory || !isAbsolute(directory) || !statSync(directory).isDirectory()) {
    throw new Error("AFP requires an agent session with an absolute local workspace cwd.");
  }
  return directory;
}

export const DSH_GUIDANCE = `AFP 在 DeepSeek Harness 中运行。数据目录仍是 .opencode/apollo-flowpower。
文档中的 OpenCode 默认模型指本 Harness 会话的有效默认模型；图片标记不是本地文件路径。
阶段委派使用 afp_run_subagent：agent 为 afp-xxx-agent，prompt 包含完整阶段任务和必要事实，skills 按 stage.use.skill 顺序传入。
同职责独立多 agent 节点使用一次 afp_run_subagent 调用，count=agentCount；每个子 agent 接收相同完整任务和全部所选附件。
该工具一次启动所有子 agent，并等待全部完成。禁止以多次串行调用冒充并行。每个 agent 的编号在其任务中给出。
工具返回 results 数组后，主模型按原场景规则持久化完整结果并生成 canonical final；不得直接任选一份作为合并结果。
工具失败时遵循原场景 onFail/maxRetries；并行能力不足时把阶段标记 error，不能降级为串行。
普通对话不自动进入 AFP 编排。`;

function readSkill(file: string): SkillDefinition {
  const text = readFileSync(file, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error(`Invalid AFP skill frontmatter: ${file}`);
  const meta: unknown = parse(match[1]);
  if (!meta || typeof meta !== "object" || !("name" in meta) || !("description" in meta)
    || typeof meta.name !== "string" || typeof meta.description !== "string") {
    throw new Error(`AFP skill requires name and description: ${file}`);
  }
  const fields = meta as Record<string, unknown>;
  return { name: meta.name, description: meta.description, provider: "apollo-flowpower",
    source: "bundled", path: file, resourceBase: { kind: "directory", path: dirname(file) },
    invocation: { modelInvocable: fields["disable-model-invocation"] !== true, userInvocable: fields["user-invocable"] !== false },
    content: `${text.slice(match[0].length).trim()}\n\n${DSH_GUIDANCE}` };
}

/** Rank bundled defaults below project and user skills; reread bodies on every load. */
export function registerSkills(ctx: Context): void {
  ctx.skills.registerProvider(() => ({
    name: "apollo-flowpower",
    async list({ signal, cwd }) {
      signal?.throwIfAborted();
      const candidates: SkillCandidate[] = [];
      const roots = [{ path: join(packageRoot(), "skills"), rank: 600, source: "bundled" },
        ...(cwd ? [{ path: join(cwd, ".opencode", "skills"), rank: 250, source: "project-opencode" }] : [])];
      for (const root of roots) {
        if (!existsSync(root.path)) continue;
        for (const entry of readdirSync(root.path).sort()) {
          const path = join(root.path, entry);
          const file = statSync(path).isDirectory() ? join(path, "SKILL.md") : path;
          if (!file.endsWith(".md") || !existsSync(file)) continue;
          candidates.push({ ...readSkill(file), source: root.source, rank: root.rank, locator: file });
        }
      }
      return candidates;
    },
    async get(candidate, { signal }) {
      signal?.throwIfAborted();
      if (typeof candidate.locator !== "string" || !existsSync(candidate.locator)) return undefined;
      return { ...readSkill(candidate.locator), source: candidate.source };
    },
  }));
}

export function registerCommands(ctx: Context): void {
  const root = join(packageRoot(), "commands");
  for (const file of readdirSync(root).filter((item) => /^afp-[a-z-]+\.md$/.test(item)).sort()) {
    const name = file.slice(0, -3);
    ctx.commands.register({
      name,
      description: readFileSync(join(root, file), "utf8").split(/\r?\n/)[0].replace(/^#+\s*/, ""),
      input: { hint: name === "afp-scene" ? "[scene=<id>] <任务说明>" : "<任务说明>", attachments: true },
      handler({ agent, rawInput, attachments, signal }) {
        signal.throwIfAborted();
        const directory = projectDirectory(agent);
        initializeProject(directory);
        const projectCommand = join(directory, ".opencode", "commands", file);
        const instructions = readFileSync(existsSync(projectCommand) ? projectCommand : join(root, file), "utf8");
        // Keep plugin instructions attributed to the plugin, and user input to the user.
        agent.inject(createUserMessage({ content: [{ type: "text", text: `${instructions}\n\n${DSH_GUIDANCE}` }],
          source: { kind: "plugin", plugin: "apollo-flowpower", form: "instructions" } }));
        agent.steer(createUserMessage({ content: [...attachments,
          { type: "text", text: `/${name}${rawInput}` }], source: { kind: "user" } }));
        return { kind: "success", text: `已提交 /${name}` };
      },
    });
  }
}
