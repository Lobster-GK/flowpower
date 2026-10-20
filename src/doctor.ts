import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { AGENT_PRESETS } from "./agent-presets.js";
import { AFP_PROJECT_DIRECTORY, packageRoot } from "./config.js";
import { getProjectConfig } from "./project-config.js";
import { loadSceneTemplateRegistry } from "./scenes.js";

type DoctorStatus = "pass" | "info" | "warning" | "error";

type DoctorCheck = {
  id: string;
  status: DoctorStatus;
  message: string;
  details?: unknown;
  suggestion?: string;
};

type DoctorResult = {
  status: "pass" | "warning" | "error";
  directory: string;
  checks: DoctorCheck[];
  summary: {
    pass: number;
    info: number;
    warning: number;
    error: number;
  };
  config: {
    file: string;
    created: boolean;
    migrated: boolean;
    migrations: string[];
    assetCount: number;
    missingAssetCount: number;
    subagentCount: number;
    configuredSubagentModelCount: number;
  };
  scenes: {
    directory: string;
    sceneCount: number;
    createdTemplates: string[];
    errorCount: number;
  };
};

/**
 * 统一把 Windows 路径展示为 slash 路径。
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * 返回相对项目根目录的展示路径。
 */
function relativePath(directory: string, file: string): string {
  return normalizePath(relative(directory, file));
}

/**
 * 收集插件包内置 skill 名称，用于判断 scene 引用是否属于当前插件能力集。
 */
function bundledSkillNames(): string[] {
  const skillsRoot = join(packageRoot(), "skills");
  if (!existsSync(skillsRoot)) return [];

  const names: string[] = [];
  for (const name of readdirSync(skillsRoot)) {
    const entry = join(skillsRoot, name);
    if (statSync(entry).isDirectory() && existsSync(join(entry, "SKILL.md"))) {
      names.push(name);
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/**
 * 检查内置 skill frontmatter 是否包含 name 和 description。
 */
function validateBundledSkills(directory: string): DoctorCheck[] {
  const skillsRoot = join(packageRoot(), "skills");
  if (!existsSync(skillsRoot)) {
    return [{
      id: "skills.bundle-missing",
      status: "error",
      message: "插件包内置 skills 目录不存在。",
      details: relativePath(directory, skillsRoot),
    }];
  }

  const checks: DoctorCheck[] = [];
  const invalid: Array<{ skill: string; reason: string }> = [];

  for (const name of bundledSkillNames()) {
    const file = join(skillsRoot, name, "SKILL.md");
    const content = readFileSync(file, "utf8");
    const end = content.indexOf("\n---", 3);
    if (!content.startsWith("---") || end < 0) {
      invalid.push({ skill: name, reason: "missing or unterminated frontmatter" });
      continue;
    }
    const frontmatter = content.slice(3, end).trim();
    if (!/^name:\s*/m.test(frontmatter)) {
      invalid.push({ skill: name, reason: "missing name" });
    }
    if (!/^description:\s*/m.test(frontmatter)) {
      invalid.push({ skill: name, reason: "missing description" });
    }
  }

  if (invalid.length > 0) {
    checks.push({
      id: "skills.frontmatter",
      status: "error",
      message: "部分内置 skill frontmatter 不完整。",
      details: invalid,
      suggestion: "修复对应 SKILL.md 的 name 和 description。",
    });
  } else {
    checks.push({
      id: "skills.frontmatter",
      status: "pass",
      message: "内置 skill frontmatter 检查通过。",
      details: { skillCount: bundledSkillNames().length },
    });
  }

  return checks;
}

/**
 * 读取 scene YAML 的原始 id，用于在重复 id 时给出更清楚的定位。
 */
function rawSceneId(file: string): string | undefined {
  try {
    const parsed = parse(readFileSync(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const id = (parsed as Record<string, unknown>).id;
      return typeof id === "string" ? id : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * 检查 scene 中引用的 skill/subagent 是否能被当前插件识别。
 */
function validateSceneReferences(directory: string, registry: ReturnType<typeof loadSceneTemplateRegistry>): DoctorCheck[] {
  const knownSkills = new Set(bundledSkillNames());
  const knownSubagents = new Set(AGENT_PRESETS.map((item) => item.name));
  const unknownSkills: Array<{ scene: string; stage: string; skill: string; file: string }> = [];
  const unknownSubagents: Array<{ scene: string; stage: string; subagent: string; file: string }> = [];

  for (const scene of registry.scenes) {
    for (const stage of scene.stages) {
      const rawSkill = stage.use?.skill;
      const skills = Array.isArray(rawSkill) ? rawSkill : rawSkill ? [rawSkill] : [];
      for (const skill of skills) {
        if (!knownSkills.has(skill)) {
          unknownSkills.push({
            scene: scene.id,
            stage: stage.id,
            skill,
            file: relativePath(directory, scene.file),
          });
        }
      }

      const subagent = stage.use?.subagent;
      if (subagent && !knownSubagents.has(subagent)) {
        unknownSubagents.push({
          scene: scene.id,
          stage: stage.id,
          subagent,
          file: relativePath(directory, scene.file),
        });
      }
    }
  }

  const checks: DoctorCheck[] = [];
  if (unknownSkills.length > 0) {
    checks.push({
      id: "scenes.unknown-skill-references",
      status: "warning",
      message: "部分 scene 引用了当前插件包内不存在的 skill。",
      details: unknownSkills,
      suggestion: "如果这些是项目自定义 skill，请确认已在 OpenCode 配置中注册；否则修正 scene template。",
    });
  } else {
    checks.push({
      id: "scenes.unknown-skill-references",
      status: "pass",
      message: "scene skill 引用检查通过。",
    });
  }

  if (unknownSubagents.length > 0) {
    checks.push({
      id: "scenes.unknown-subagent-references",
      status: "warning",
      message: "部分 scene 引用了当前插件内置列表中不存在的 subagent。",
      details: unknownSubagents,
      suggestion: "如果这些是项目自定义 subagent，请确认已在 OpenCode agent 配置中注册；否则修正 scene template。",
    });
  } else {
    checks.push({
      id: "scenes.unknown-subagent-references",
      status: "pass",
      message: "scene subagent 引用检查通过。",
    });
  }

  return checks;
}

/**
 * 输出项目 scene-template 目录中重复 id 的文件分布。
 */
function duplicateSceneDetails(directory: string): Array<{ id: string; files: string[] }> {
  const sceneRoot = join(directory, ...AFP_PROJECT_DIRECTORY, "scene-template");
  if (!existsSync(sceneRoot)) return [];

  const byId = new Map<string, string[]>();
  for (const name of readdirSync(sceneRoot)) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    const file = join(sceneRoot, name);
    if (!statSync(file).isFile()) continue;
    const id = rawSceneId(file);
    if (!id) continue;
    const files = byId.get(id) ?? [];
    files.push(relativePath(directory, file));
    byId.set(id, files);
  }

  return [...byId.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([id, files]) => ({ id, files }));
}

/**
 * 运行 Apollo Flowpower 项目自检。
 */
export function runDoctor(directory: string): DoctorResult {
  const config = getProjectConfig(directory);
  const registry = loadSceneTemplateRegistry(directory);
  const checks: DoctorCheck[] = [];

  if (config.errors.length > 0) {
    checks.push({
      id: "config.parse",
      status: "error",
      message: "config.yaml 存在解析或结构错误。",
      details: config.errors,
      suggestion: "先修复配置文件，再执行场景编排。",
    });
  } else {
    checks.push({
      id: "config.parse",
      status: "pass",
      message: "config.yaml 解析通过。",
    });
  }

  if (config.migrations.length > 0) {
    checks.push({
      id: "config.migration",
      status: "info",
      message: "已自动补齐缺失的默认配置项。",
      details: config.migrations,
    });
  } else {
    checks.push({
      id: "config.migration",
      status: "pass",
      message: "config.yaml 未发现需要补齐的默认配置项。",
    });
  }

  const missingAssets = config.assets.filter((asset) => !asset.exists);
  if (missingAssets.length > 0) {
    checks.push({
      id: "config.assets",
      status: "warning",
      message: "部分项目资产路径不存在。",
      details: missingAssets,
      suggestion: "创建对应资产文件，或从 config.yaml 中移除过期资产声明。",
    });
  } else {
    checks.push({
      id: "config.assets",
      status: "pass",
      message: config.assets.length > 0 ? "项目资产路径检查通过。" : "未声明项目资产。",
    });
  }

  if (registry.createdTemplates.length > 0) {
    checks.push({
      id: "scenes.seed",
      status: "info",
      message: "已补齐缺失的内置 scene template 种子。",
      details: registry.createdTemplates.map((file) => relativePath(directory, file)),
    });
  } else {
    checks.push({
      id: "scenes.seed",
      status: "pass",
      message: "scene template 种子无需补齐。",
    });
  }

  if (registry.errors.length > 0) {
    checks.push({
      id: "scenes.parse",
      status: "error",
      message: "scene template 存在解析错误或重复 id。",
      details: {
        errors: registry.errors,
        duplicateIds: duplicateSceneDetails(directory),
      },
      suggestion: "修复 YAML 结构，或删除/改名重复 id 的模板文件。",
    });
  } else {
    checks.push({
      id: "scenes.parse",
      status: "pass",
      message: "scene template 解析通过。",
      details: { sceneCount: registry.scenes.length },
    });
  }

  checks.push(...validateSceneReferences(directory, registry));
  checks.push(...validateBundledSkills(directory));

  const summary = {
    pass: checks.filter((item) => item.status === "pass").length,
    info: checks.filter((item) => item.status === "info").length,
    warning: checks.filter((item) => item.status === "warning").length,
    error: checks.filter((item) => item.status === "error").length,
  };

  return {
    status: summary.error > 0 ? "error" : summary.warning > 0 ? "warning" : "pass",
    directory: normalizePath(directory),
    checks,
    summary,
    config: {
      file: config.configFile,
      created: config.createdConfig,
      migrated: config.migratedConfig,
      migrations: config.migrations,
      assetCount: config.assets.length,
      missingAssetCount: missingAssets.length,
      subagentCount: config.subagents.length,
      configuredSubagentModelCount: config.subagents.filter((item) => item.configuredModel).length,
    },
    scenes: {
      directory: relativePath(directory, registry.directory),
      sceneCount: registry.scenes.length,
      createdTemplates: registry.createdTemplates.map((file) => relativePath(directory, file)),
      errorCount: registry.errors.length,
    },
  };
}
