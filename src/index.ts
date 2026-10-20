import { tool, type Plugin } from "@opencode-ai/plugin";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { registerDefaultSubagents } from "./agents.js";
import { packageRoot } from "./config.js";
import { AFP_TOOL_DESCRIPTIONS, executeAfpTool, initializeProject } from "./core-tools.js";
import { shouldSyncBuiltinResources, syncBuiltinResources } from "./sync.js";

/**
 * 无参工具的宽松参数定义。
 *
 * 实际执行会忽略这些字段；保留它们是为了容忍模型偶尔给无参工具误传 scene、stage 或说明文本。
 */
const tolerantNoArgs = {
  reason: tool.schema.string().optional().describe("Ignored. Optional note from the model; this tool does not require arguments."),
  scene: tool.schema.string().optional().describe("Ignored. Do not pass scene here; use afp_load_scene_template for a selected scene."),
  stage: tool.schema.string().optional().describe("Ignored. Optional stage name accidentally provided by the model."),
  request: tool.schema.string().optional().describe("Ignored. Optional user request accidentally provided by the model."),
  input: tool.schema.unknown().optional().describe("Ignored. Optional arbitrary input accidentally provided by the model."),
};

/**
 * 收集插件包内置 skill 名称，用于判断项目是否已经拥有完整的一份同步副本。
 */
function bundledSkillNames(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) return [];

  const names: string[] = [];
  for (const name of readdirSync(skillsRoot)) {
    const entry = join(skillsRoot, name);
    if (statSync(entry).isDirectory() && existsSync(join(entry, "SKILL.md"))) {
      names.push(name);
      continue;
    }
    if (name.endsWith(".md")) {
      names.push(name.slice(0, -3));
    }
  }
  return names;
}

/**
 * 判断项目 .opencode/skills 中是否已经存在指定 skill。
 */
function projectSkillExists(projectSkillsRoot: string, skillName: string): boolean {
  return existsSync(join(projectSkillsRoot, skillName, "SKILL.md")) || existsSync(join(projectSkillsRoot, `${skillName}.md`));
}

/**
 * 如果项目已经完整同步过内置 skills，就不再把包内 skills 路径追加到配置中。
 */
function projectHasAllBundledSkills(directory: string, skillsRoot: string): boolean {
  const names = bundledSkillNames(skillsRoot);
  if (names.length === 0) return false;

  const projectSkillsRoot = join(directory, ".opencode", "skills");
  return names.every((name) => projectSkillExists(projectSkillsRoot, name));
}

/**
 * OpenCode 插件入口。
 *
 * 初始化阶段会补齐项目级 config.yaml 和 scene template 种子；
 * 这些写入都采用缺失文件复制策略，不覆盖用户已有文件。
 */
export const ApolloFlowpower: Plugin = async (ctx) => {
  initializeProject(ctx.directory);

  if (shouldSyncBuiltinResources(ctx.directory)) {
    syncBuiltinResources(ctx.directory);
  }

  return {
    tool: {
      afp_list_scenes: tool({
        description: AFP_TOOL_DESCRIPTIONS.afp_list_scenes,
        args: tolerantNoArgs,
        async execute(args, context) {
          return executeAfpTool("afp_list_scenes", context.directory);
        },
      }),
      afp_load_scene_template: tool({
        description: AFP_TOOL_DESCRIPTIONS.afp_load_scene_template,
        args: { scene: tool.schema.string().describe("Scene id from afp_list_scenes, for example text-to-page.") },
        async execute(args, context) {
          return executeAfpTool("afp_load_scene_template", context.directory, args.scene);
        },
      }),
      afp_get_project_config: tool({
        description: AFP_TOOL_DESCRIPTIONS.afp_get_project_config,
        args: tolerantNoArgs,
        async execute(args, context) {
          return executeAfpTool("afp_get_project_config", context.directory);
        },
      }),
      afp_doctor: tool({
        description: AFP_TOOL_DESCRIPTIONS.afp_doctor,
        args: tolerantNoArgs,
        async execute(args, context) {
          return executeAfpTool("afp_doctor", context.directory);
        },
      }),
    },

    config: async (config: Record<string, unknown>) => {
      const skillsRoot = `${packageRoot()}/skills`;

      if (!projectHasAllBundledSkills(ctx.directory, skillsRoot)) {
        const currentSkills = (config.skills ?? {}) as Record<string, unknown>;
        const currentPaths = Array.isArray(currentSkills.paths) ? currentSkills.paths : [];
        if (!currentPaths.includes(skillsRoot)) {
          currentSkills.paths = [...currentPaths, skillsRoot];
        }
        config.skills = currentSkills;
      }

      registerDefaultSubagents(config, ctx.directory);
    },
  };
};

export const server = ApolloFlowpower;
export default ApolloFlowpower;
