import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse, parseDocument } from "yaml";
import { AGENT_PRESETS, type AgentModelKind } from "./agent-presets.js";
import { AFP_PROJECT_DIRECTORY } from "./config.js";

type UnknownRecord = Record<string, unknown>;

/**
 * 暴露给模型的项目资产索引项。
 */
type ProjectAsset = {
  description: string;
  path: string;
  exists: boolean;
  size?: number;
};

/**
 * 暴露给模型的内置 subagent 模型配置项。
 */
type ProjectSubagentConfig = {
  name: string;
  modelKind: AgentModelKind;
  model: string | null;
  configuredModel: boolean;
};

/**
 * afp_get_project_config 工具返回的数据结构。
 */
type ProjectConfigResult = {
  configFile: string;
  createdConfig: boolean;
  migratedConfig: boolean;
  migrations: string[];
  schemaVersion?: number;
  subagents: ProjectSubagentConfig[];
  assets: ProjectAsset[];
  username?: string | unknown;
  password?: string | unknown;
  errors: string[];
};

/**
 * 注册默认 subagent 时使用的模型映射。
 */
type ProjectSubagentModelConfig = Record<string, string>;

/**
 * 项目配置文件相对路径。
 */
const PROJECT_CONFIG_FILE = [...AFP_PROJECT_DIRECTORY, "config.yaml"];

/**
 * 给新项目生成完整 subagent 模型配置段。
 *
 * model 留空表示不为该 subagent 指定模型，交给 OpenCode 当前默认模型处理。
 */
function defaultSubagentConfigLines(): string[] {
  const lines = [
    "# subagents 用于给插件内置子 agent 指定模型；model 留空表示使用 OpenCode 当前默认模型。",
    "# text 适合代码、计划、验证、审查等文本任务；multimodal 适合截图和 UI 图片观察。",
    "subagents:",
  ];

  for (const preset of AGENT_PRESETS) {
    lines.push(`  # ${preset.modelKind}`);
    lines.push(`  ${preset.name}:`);
    lines.push('    model: ""');
  }

  return lines;
}

/**
 * 新项目的默认配置种子。
 */
function defaultProjectConfig(): string {
  return [
    "# Apollo Flowpower 项目配置",
    "# 后续插件级项目配置都收敛到这个文件。",
    "schemaVersion: 1",
    "username: ",
    "password: ",
    ...defaultSubagentConfigLines(),
    "",
    "assets: ",
    "",
    "# 示例:",
    "# assets:",
    "#   - description: 项目组件库使用说明。",
    "#     path: docs/ai-assets/components.md",
    "#   - description: 前端开发规范。",
    "#     path: docs/ai-assets/frontend-rules.md",
    "",
  ].join("\n");
}

/**
 * 生成默认的 subagent 模型配置对象，供新配置和迁移补全共用。
 */
function defaultSubagentModelConfig(): Record<string, { model: string }> {
  const subagents: Record<string, { model: string }> = {};
  for (const preset of AGENT_PRESETS) {
    subagents[preset.name] = { model: "" };
  }
  return subagents;
}

/**
 * TypeScript 无法直接信任 YAML 解析结果，这里做一个轻量对象守卫。
 */
function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 统一把 Windows 路径展示为 slash 路径，避免工具返回随平台变化。
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
 * 生成内置 subagent 的默认配置解析结果。
 */
function defaultSubagentConfigs(): ProjectSubagentConfig[] {
  return AGENT_PRESETS.map((preset) => ({
    name: preset.name,
    modelKind: preset.modelKind,
    model: null,
    configuredModel: false,
  }));
}

/**
 * 解析 config.yaml 中的 subagents 配置段。
 */
function parseSubagentConfigs(configPath: string, rawSubagents: unknown, errors: string[]): ProjectSubagentConfig[] {
  const subagents = defaultSubagentConfigs();
  if (rawSubagents === undefined || rawSubagents === null) return subagents;

  if (!isRecord(rawSubagents)) {
    errors.push(`${configPath}: subagents must be an object`);
    return subagents;
  }

  const byName = new Map(subagents.map((item) => [item.name, item]));

  for (const [name, value] of Object.entries(rawSubagents)) {
    const target = byName.get(name);
    if (!target) {
      errors.push(`${configPath}: subagents.${name} is not a built-in Apollo Flowpower subagent`);
      continue;
    }

    if (value === undefined || value === null) continue;

    if (!isRecord(value)) {
      errors.push(`${configPath}: subagents.${name} must be an object`);
      continue;
    }

    const model = value.model;
    if (model === undefined || model === null || model === "") continue;
    if (typeof model !== "string") {
      errors.push(`${configPath}: subagents.${name}.model must be a string`);
      continue;
    }

    const trimmed = model.trim();
    if (trimmed.length === 0) continue;

    target.model = trimmed;
    target.configuredModel = true;
  }

  return subagents;
}

/**
 * 项目级 config.yaml 的绝对路径。
 */
export function projectConfigFile(directory: string): string {
  return join(directory, ...PROJECT_CONFIG_FILE);
}

/**
 * 校验资产路径必须留在项目根目录内。
 *
 * 资产正文由模型按需读取，但配置解析阶段先防掉绝对路径和目录逃逸。
 */
function resolveAssetPath(directory: string, assetPath: string): string {
  if (assetPath.trim().length === 0) {
    throw new Error("asset path must be a non-empty string");
  }
  if (isAbsolute(assetPath)) {
    throw new Error(`asset path must be relative to project root: ${assetPath}`);
  }

  const resolved = resolve(directory, assetPath);
  const relativeToProject = relative(directory, resolved);
  if (relativeToProject.startsWith("..") || isAbsolute(relativeToProject)) {
    throw new Error(`asset path escapes project root: ${assetPath}`);
  }

  return resolved;
}

/**
 * 确保项目存在 AFP 配置文件。
 *
 * 如果目标文件已经存在，直接返回 false，不覆盖用户配置。
 */
export function ensureProjectConfig(directory: string): boolean {
  const file = projectConfigFile(directory);
  if (existsSync(file)) return false;

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, defaultProjectConfig(), "utf8");
  return true;
}

/**
 * 在不覆盖用户已有值的前提下，给旧版 config.yaml 补齐当前插件需要的默认配置项。
 *
 * 如果配置文件本身不可解析、不是对象，或已有字段类型冲突，迁移会跳过对应部分，
 * 让 afp_get_project_config 和 afp_doctor 报告结构化错误。
 */
export function migrateProjectConfig(directory: string): string[] {
  const file = projectConfigFile(directory);
  if (!existsSync(file)) return [];

  const raw = readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];

  const doc = parseDocument(raw);
  if (doc.errors.length > 0) return [];

  const migrations: string[] = [];

  if (parsed.schemaVersion === undefined) {
    doc.set("schemaVersion", 1);
    migrations.push("schemaVersion");
  }

  const rawSubagents = parsed.subagents;
  if (rawSubagents === undefined || rawSubagents === null) {
    doc.set("subagents", defaultSubagentModelConfig());
    migrations.push("subagents");
  } else if (isRecord(rawSubagents)) {
    for (const preset of AGENT_PRESETS) {
      const current = rawSubagents[preset.name];
      if (current === undefined || current === null) {
        doc.setIn(["subagents", preset.name], { model: "" });
        migrations.push(`subagents.${preset.name}`);
        continue;
      }
      if (isRecord(current) && current.model === undefined) {
        doc.setIn(["subagents", preset.name, "model"], "");
        migrations.push(`subagents.${preset.name}.model`);
      }
    }
  }

  if (parsed.assets === undefined) {
    doc.set("assets", []);
    migrations.push("assets");
  }

  if (migrations.length > 0) {
    writeFileSync(file, String(doc), "utf8");
  }

  return migrations;
}

/**
 * 对外暴露的配置解析入口。
 */
export function getProjectConfig(directory: string): ProjectConfigResult {
  return loadProjectConfigInternal(directory);
}

/**
 * 读取项目配置里的 subagent 模型设置，供 OpenCode agent 注册阶段使用。
 */
export function getProjectSubagentModels(directory: string): ProjectSubagentModelConfig {
  const result = loadProjectConfigInternal(directory);
  const models: ProjectSubagentModelConfig = {};

  for (const subagent of result.subagents) {
    if (subagent.model) {
      models[subagent.name] = subagent.model;
    }
  }

  return models;
}

/**
 * 读取并校验 config.yaml。
 *
 * 返回资产索引和结构化错误，不读取任何资产正文。
 */
function loadProjectConfigInternal(directory: string): {
  configFile: string;
  createdConfig: boolean;
  migratedConfig: boolean;
  migrations: string[];
  schemaVersion?: number;
  subagents: ProjectSubagentConfig[];
  assets: ProjectAsset[];
  username?: string | unknown;
  password?: string | unknown;
  errors: string[];
} {
  const createdConfig = ensureProjectConfig(directory);
  const migrations = createdConfig ? [] : migrateProjectConfig(directory);
  const configFile = projectConfigFile(directory);
  const configPath = relativePath(directory, configFile);
  const errors: string[] = [];
  const defaultSubagents = defaultSubagentConfigs();
  const assets: ProjectAsset[] = [];
  let username: string | unknown;
  let password: string | unknown;

  let parsed: unknown;
  try {
    parsed = parse(readFileSync(configFile, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      configFile: configPath,
      createdConfig,
      migratedConfig: migrations.length > 0,
      migrations,
      schemaVersion: undefined,
      subagents: defaultSubagents,
      assets,
      errors: [`${configPath}: ${message}`],
    };
  }

  if (!isRecord(parsed)) {
    return {
      configFile: configPath,
      createdConfig,
      migratedConfig: migrations.length > 0,
      migrations,
      schemaVersion: undefined,
      subagents: defaultSubagents,
      assets,
      errors: [`${configPath}: config must be a YAML object`],
    };
  }

  const schemaVersion = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : undefined;
  const subagents = parseSubagentConfigs(configPath, parsed.subagents, errors);

  // assets 是项目资产配置段；后续配置继续挂在同一个 config.yaml。
  const rawAssets = parsed.assets;
  username = parsed.username
  password = parsed.password
  if (rawAssets !== undefined && !Array.isArray(rawAssets)) {
    errors.push(`${configPath}: assets must be an array`);
  }

  const assetItems = Array.isArray(rawAssets) ? rawAssets : [];
  assetItems.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`${configPath}: assets[${index}] must be an object`);
      return;
    }

    const description = item.description;
    const assetPath = item.path;
    if (typeof description !== "string" || description.trim().length === 0) {
      errors.push(`${configPath}: assets[${index}].description must be a non-empty string`);
      return;
    }
    if (typeof assetPath !== "string" || assetPath.trim().length === 0) {
      errors.push(`${configPath}: assets[${index}].path must be a non-empty string`);
      return;
    }

    try {
      const absolutePath = resolveAssetPath(directory, assetPath);
      let exists = false;
      let size: number | undefined;
      // 文件缺失不是 config 解析错误；模型后续可以根据 exists 决定是否继续。
      try {
        const stat = statSync(absolutePath);
        exists = stat.isFile();
        size = stat.isFile() ? stat.size : undefined;
      } catch {
        exists = false;
      }

      const normalizedPath = normalizePath(assetPath);
      assets.push({
        description: description.trim(),
        path: normalizedPath,
        exists,
        size,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${configPath}: assets[${index}].path ${message}`);
    }
  });

  return {
    configFile: configPath,
    createdConfig,
    migratedConfig: migrations.length > 0,
    migrations,
    schemaVersion,
    subagents,
    assets,
    username,
    password,
    errors,
  };
}
