import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { parse } from "yaml";
import { AFP_PROJECT_DIRECTORY, packageRoot } from "./config.js";

type UnknownRecord = Record<string, unknown>;
type TemplateVersion = number | string;

/**
 * 单个流程阶段的规范化结构。
 */
type SceneStage = {
  id: string;
  use?: {
    skill?: string | string[];
    subagent?: string;
  };
  multiAgent?: StageMultiAgent;
  instruction?: string;
  requires?: string[];
  output?: string;
  when?: string;
  onFail?: string;
  maxRetries?: number;
  extras?: UnknownRecord;
};

/**
 * 单个流程节点的多 agent 执行策略。
 */
type StageMultiAgent = {
  enabled?: boolean;
  agentCount?: number;
  mode?: string;
  persistOutputs?: boolean;
  outputDir?: string;
  options?: UnknownRecord;
};

/**
 * 完整 scene template，包含原始 YAML 和解析后的 stages。
 */
type SceneTemplate = {
  id: string;
  schemaVersion?: TemplateVersion;
  templateVersion?: TemplateVersion;
  name?: string;
  description?: string;
  notes?: string[];
  match?: {
    intents?: string[];
    requires?: string[];
  };
  artifacts?: UnknownRecord;
  stages: SceneStage[];
  extras?: UnknownRecord;
  file: string;
  raw: string;
};

/**
 * 返回给模型用于选择场景的轻量索引项。
 */
type SceneIndexItem = {
  id: string;
  schemaVersion?: TemplateVersion;
  templateVersion?: TemplateVersion;
  name?: string;
  description?: string;
  notes?: string[];
  match?: SceneTemplate["match"];
  artifacts?: UnknownRecord;
  extras?: UnknownRecord;
  file: string;
};

/**
 * 项目 scene-template 目录的解析结果。
 */
type SceneRegistry = {
  directory: string;
  createdTemplates: string[];
  scenes: SceneTemplate[];
  errors: string[];
};

/**
 * 单个流程节点在执行计划中的归一化执行者。
 */
type SceneExecutionPlanExecutor = {
  type: "subagent" | "skill" | "main";
  label: string;
  subagent?: string;
  skills?: string[];
};

/**
 * 多 agent 节点的执行计划提示。
 */
type SceneExecutionPlanMultiAgent = StageMultiAgent & {
  enabled: boolean;
  agentCount: number;
  parallelDispatchInstruction: string;
};

/**
 * 返回给模型的预计算流程计划项。
 */
type SceneExecutionPlanItem = {
  id: string;
  initialStatus: "running" | "";
  executor: SceneExecutionPlanExecutor;
  instruction?: string;
  output: string;
  resolvedOutput?: unknown;
  requires: string[];
  when?: string;
  onFail?: string;
  maxRetries?: number;
  multiAgent?: SceneExecutionPlanMultiAgent;
  extras?: UnknownRecord;
  note: string;
};

/**
 * afp_load_scene_template 返回的场景级执行提示。
 */
type SceneExecutionGuidance = {
  notes: string[];
  artifacts?: UnknownRecord;
  extras?: UnknownRecord;
};

/**
 * 项目内 scene template 目录相对路径。
 */
const SCENE_TEMPLATE_DIRECTORY = [...AFP_PROJECT_DIRECTORY, "scene-template"];
const SCENE_TEMPLATE_KNOWN_KEYS = new Set([
  "id",
  "schemaVersion",
  "templateVersion",
  "name",
  "description",
  "notes",
  "match",
  "artifacts",
  "stages",
]);
const SCENE_STAGE_KNOWN_KEYS = new Set([
  "id",
  "use",
  "multiAgent",
  "instruction",
  "requires",
  "output",
  "when",
  "onFail",
  "maxRetries",
]);

/**
 * YAML 解析结果需要先缩窄为普通对象，后续才能安全读取字段。
 */
function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 只接受非空字符串数组；其它输入视为未配置。
 */
function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * notes 这类说明字段既支持字符串数组，也宽容支持单个字符串。
 */
function asStringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : undefined;
  }
  return asStringArray(value);
}

/**
 * 版本字段允许数字或非空字符串，方便后续模板演进。
 */
function asVersion(value: unknown): TemplateVersion | undefined {
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  return undefined;
}

/**
 * 保留模板中的未知扩展字段，避免用户自定义信息在结构化返回里丢失。
 */
function collectExtras(value: UnknownRecord, knownKeys: Set<string>): UnknownRecord | undefined {
  const extras: UnknownRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (!knownKeys.has(key)) {
      extras[key] = item;
    }
  }
  return Object.keys(extras).length > 0 ? extras : undefined;
}

/**
 * stage.use.skill 允许单个 skill，也允许按顺序配置多个 skill。
 */
function asSkillValue(value: unknown): string | string[] | undefined {
  if (value === undefined) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const skills = value.map((item) => (typeof item === "string" ? item.trim() : ""));
    if (skills.some((item) => item.length === 0)) return undefined;
    return skills.length > 0 ? skills : undefined;
  }

  return undefined;
}

/**
 * 解析流程节点级多 agent 执行策略。
 */
function parseStageMultiAgent(value: unknown, sceneId: string, stageId: string): StageMultiAgent | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`scene template ${sceneId} stage ${stageId} multiAgent must be an object`);
  }

  const multiAgent: StageMultiAgent = {};
  const path = `scene template ${sceneId} stage ${stageId} multiAgent`;

  const booleanFields = ["enabled", "persistOutputs"] as const;
  for (const field of booleanFields) {
    const fieldValue = value[field];
    if (fieldValue === undefined) continue;
    if (typeof fieldValue !== "boolean") {
      throw new Error(`${path}.${field} must be a boolean`);
    }
    multiAgent[field] = fieldValue;
  }

  const agentCount = value.agentCount;
  if (agentCount !== undefined) {
    if (typeof agentCount !== "number" || !Number.isInteger(agentCount) || agentCount < 1 || agentCount > 5) {
      throw new Error(`${path}.agentCount must be an integer between 1 and 5`);
    }
    multiAgent.agentCount = agentCount;
  }

  const mode = value.mode;
  if (mode !== undefined) {
    if (typeof mode !== "string" || mode.trim().length === 0) {
      throw new Error(`${path}.mode must be a non-empty string`);
    }
    multiAgent.mode = mode;
  }

  const outputDir = value.outputDir;
  if (outputDir !== undefined) {
    if (typeof outputDir !== "string" || outputDir.trim().length === 0) {
      throw new Error(`${path}.outputDir must be a non-empty string`);
    }
    multiAgent.outputDir = outputDir;
  }

  const options = value.options;
  if (options !== undefined) {
    if (!isRecord(options)) {
      throw new Error(`${path}.options must be an object`);
    }
    multiAgent.options = options;
  }

  return multiAgent;
}

/**
 * 统一工具返回中的路径分隔符，避免 Windows 反斜杠进入模型上下文。
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Markdown 表格单元格转义，避免返回的计划表被 stage 文本破坏。
 */
function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/**
 * 压缩展示结构化字段，避免计划表被多行 JSON 打乱。
 */
function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * 计划表里的单值展示保持直观；复杂对象再压缩成 JSON。
 */
function compactDisplay(value: unknown): string {
  return typeof value === "string" ? value : compactJson(value);
}

/**
 * 返回相对项目根目录的路径，方便模型直接读取项目文件。
 */
function relativePath(directory: string, file: string): string {
  return normalizePath(relative(directory, file));
}

/**
 * 生成统一的场景元数据返回结构。
 */
function sceneIndexItem(directory: string, scene: SceneTemplate): SceneIndexItem {
  return {
    id: scene.id,
    schemaVersion: scene.schemaVersion,
    templateVersion: scene.templateVersion,
    name: scene.name,
    description: scene.description,
    notes: scene.notes,
    match: scene.match,
    artifacts: scene.artifacts,
    extras: scene.extras,
    file: relativePath(directory, scene.file),
  };
}

/**
 * 将 stage.use.skill 统一转成数组，便于执行计划展示。
 */
function stageSkills(stage: SceneStage): string[] {
  const skill = stage.use?.skill;
  if (!skill) return [];
  return Array.isArray(skill) ? skill : [skill];
}

/**
 * 根据 stage.use 生成执行者展示信息。
 */
function stageExecutor(stage: SceneStage): SceneExecutionPlanExecutor {
  const skills = stageSkills(stage);
  const subagent = stage.use?.subagent;

  if (subagent) {
    return {
      type: "subagent",
      label: skills.length > 0 ? `${subagent}（skill: ${skills.join(" -> ")}）` : subagent,
      subagent,
      skills,
    };
  }

  if (skills.length > 0) {
    return {
      type: "skill",
      label: skills.join(" -> "),
      skills,
    };
  }

  return {
    type: "main",
    label: "主模型",
  };
}

/**
 * 生成强约束并行执行说明。
 *
 * 这段文字会进入执行计划和计划表，减少模型把并行子 agent 误执行成串行的概率。
 */
function parallelDispatchInstruction(stage: SceneStage, executor: SceneExecutionPlanExecutor): string | undefined {
  if (stage.multiAgent?.enabled !== true) return undefined;

  const agentCount = stage.multiAgent.agentCount ?? 1;
  const target = executor.subagent ? `${executor.subagent} subagent` : "同职责 subagent";
  const sameRoleFullScope =
    stage.multiAgent.mode === "same-role-independent-final" || stage.multiAgent.mode === "same-role-observation";

  if (sameRoleFullScope) {
    return [
      `强制并行：必须在同一轮中同时启动 ${agentCount} 个 ${target}，让每个 subagent 独立处理同一份完整任务和全部输入。`,
      "不要先等待任何一个 subagent 完成后再启动下一个。",
      "不得按图片、区域、元素类型或页面状态分工；每个 subagent 都必须交付可单独验收的完整最终结果，彼此不依赖，也不能假设其它 subagent 会补漏。",
    ].join(" ");
  }

  return [
    `强制并行：把任务拆成 ${agentCount} 个完全独立的子任务，并且必须在同一轮中同时启动 ${agentCount} 个 ${target}。`,
    "不要先等待任何一个 subagent 完成后再启动下一个。",
    "每个 subagent 只负责自己的范围，不要互相依赖。",
  ].join(" ");
}

/**
 * 生成单个 stage 的备注说明。
 */
function stageNote(scene: SceneTemplate, stage: SceneStage, index: number, parallelInstruction?: string): string {
  const notes: string[] = [];

  if (index === 0 && scene.notes?.length) {
    notes.push(`场景约束：${scene.notes.join("；")}`);
  }
  if (stage.instruction) notes.push(`阶段说明：${stage.instruction}`);
  if (stage.requires?.length) notes.push(`前置产物：${stage.requires.join("、")}`);
  if (stage.when) notes.push(`条件：${stage.when}`);
  if (stage.onFail) {
    const retryText = stage.maxRetries === undefined ? "" : `，最多重试 ${stage.maxRetries} 次`;
    notes.push(`失败策略：${stage.onFail}${retryText}`);
  }
  if (parallelInstruction) notes.push(parallelInstruction);
  if (stage.extras) notes.push(`阶段扩展字段：${compactJson(stage.extras)}`);

  return notes.length > 0 ? notes.join("；") : "-";
}

/**
 * 按 `artifacts.foo` 或当前模板常见的 `artifacts.files.foo` 解析产物引用。
 */
function resolveArtifactReference(scene: SceneTemplate, reference: string | undefined): unknown {
  if (!reference || !reference.startsWith("artifacts.") || !scene.artifacts) return undefined;

  const keys = reference.slice("artifacts.".length).split(".");
  const direct = lookupPath(scene.artifacts, keys);
  if (direct !== undefined) return direct;

  const files = scene.artifacts.files;
  if (isRecord(files)) {
    return lookupPath(files, keys);
  }

  return undefined;
}

/**
 * 从对象中按路径读取值；只要中间节点不是对象就视为未解析。
 */
function lookupPath(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * 从完整 scene 生成模型可直接执行和展示的流程计划。
 */
function buildExecutionPlan(scene: SceneTemplate): SceneExecutionPlanItem[] {
  return scene.stages.map((stage, index) => {
    const executor = stageExecutor(stage);
    const instruction = parallelDispatchInstruction(stage, executor);
    const resolvedOutput = resolveArtifactReference(scene, stage.output);

    return {
      id: stage.id,
      initialStatus: index === 0 ? "running" : "",
      executor,
      instruction: stage.instruction,
      output: stage.output ?? "无显式产物",
      resolvedOutput,
      requires: stage.requires ?? [],
      when: stage.when,
      onFail: stage.onFail,
      maxRetries: stage.maxRetries,
      multiAgent: instruction
        ? {
            ...stage.multiAgent,
            enabled: true,
            agentCount: stage.multiAgent?.agentCount ?? 1,
            parallelDispatchInstruction: instruction,
          }
        : undefined,
      extras: stage.extras,
      note: stageNote(scene, stage, index, instruction),
    };
  });
}

/**
 * 生成场景级执行提示，供模型在执行计划之外读取全局约束。
 */
function buildExecutionGuidance(scene: SceneTemplate): SceneExecutionGuidance {
  return {
    notes: scene.notes ?? [],
    artifacts: scene.artifacts,
    extras: scene.extras,
  };
}

/**
 * 把执行计划渲染成命令侧要求的初始待办表。
 */
function buildExecutionPlanTable(plan: SceneExecutionPlanItem[]): string {
  const lines = [
    "| 状态 | 流程阶段 | 执行者 | 产物 | 使用资产 | 说明 |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const item of plan) {
    const output =
      item.resolvedOutput === undefined ? item.output : `${item.output} -> ${compactDisplay(item.resolvedOutput)}`;

    lines.push(
      [
        item.initialStatus,
        item.id,
        item.executor.label,
        output,
        "-",
        item.note,
      ]
        .map((cell) => escapeTableCell(cell))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }

  return lines.join("\n");
}

/**
 * 插件包内置 scene template 种子目录。
 */
export function builtinSceneTemplateRoot(): string {
  return join(packageRoot(), "scene-template");
}

/**
 * 用户项目中的 scene template 运行时目录。
 */
export function projectSceneTemplateRoot(directory: string): string {
  return join(directory, ...SCENE_TEMPLATE_DIRECTORY);
}

/**
 * 只复制缺失文件，绝不覆盖用户已经修改过的模板。
 */
function copyIfMissing(source: string, target: string, created: string[]): void {
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  created.push(target);
}

/**
 * 插件启动和工具调用时都会确保模板种子存在于项目目录。
 *
 * 返回本次新创建的文件，方便工具结果告知模型发生了哪些初始化动作。
 */
export function ensureProjectSceneTemplates(directory: string): string[] {
  const sourceDir = builtinSceneTemplateRoot();
  const targetDir = projectSceneTemplateRoot(directory);
  const created: string[] = [];

  mkdirSync(targetDir, { recursive: true });
  if (!existsSync(sourceDir)) return created;

  for (const name of readdirSync(sourceDir).sort((a, b) => a.localeCompare(b))) {
    const source = join(sourceDir, name);
    if (!statSync(source).isFile()) continue;
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    copyIfMissing(source, join(targetDir, name), created);
  }

  return created;
}

/**
 * 读取项目 scene-template 目录下的 YAML 文件列表。
 */
function readYamlFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const file = join(directory, name);
    if (!statSync(file).isFile()) continue;
    if (name.endsWith(".yaml") || name.endsWith(".yml")) {
      files.push(file);
    }
  }
  return files.sort((a, b) => basename(a).localeCompare(basename(b)));
}

/**
 * 解析并校验单个 scene template。
 *
 * 这里只做 schema 级校验，具体 stage 行为仍由 skill、subagent 或 instruction 决定。
 */
function parseSceneTemplate(file: string): SceneTemplate {
  const raw = readFileSync(file, "utf8");
  const parsed = parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("scene template must be a YAML object");
  }

  const id = parsed.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("scene template id must be a non-empty string");
  }

  const stages = parsed.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error(`scene template ${id} must define at least one stage`);
  }

  const normalizedStages = stages.map((stage, index): SceneStage => {
    if (!isRecord(stage)) {
      throw new Error(`scene template ${id} stage ${index + 1} must be an object`);
    }
    if (typeof stage.id !== "string" || stage.id.trim().length === 0) {
      throw new Error(`scene template ${id} stage ${index + 1} must define id`);
    }

    const instruction = stage.instruction;
    if (instruction !== undefined && (typeof instruction !== "string" || instruction.trim().length === 0)) {
      throw new Error(`scene template ${id} stage ${stage.id} instruction must be a non-empty string`);
    }

    const use = isRecord(stage.use) ? stage.use : undefined;
    if (stage.use !== undefined && !use) {
      throw new Error(`scene template ${id} stage ${stage.id} use must be an object`);
    }

    const skill = asSkillValue(use?.skill);
    const subagent = use?.subagent;
    if (use?.skill !== undefined && skill === undefined) {
      throw new Error(`scene template ${id} stage ${stage.id} use.skill must be a non-empty string or string array`);
    }
    if (subagent !== undefined && typeof subagent !== "string") {
      throw new Error(`scene template ${id} stage ${stage.id} use.subagent must be a string`);
    }
    if (!skill && !subagent && !instruction) {
      throw new Error(`scene template ${id} stage ${stage.id} must define use.skill, use.subagent, or instruction`);
    }

    return {
      id: stage.id,
      use: use
        ? {
            skill,
            subagent,
          }
        : undefined,
      multiAgent: parseStageMultiAgent(stage.multiAgent, id, stage.id),
      instruction,
      requires: asStringArray(stage.requires),
      output: typeof stage.output === "string" ? stage.output : undefined,
      when: typeof stage.when === "string" ? stage.when : undefined,
      onFail: typeof stage.onFail === "string" ? stage.onFail : undefined,
      maxRetries: typeof stage.maxRetries === "number" ? stage.maxRetries : undefined,
      extras: collectExtras(stage, SCENE_STAGE_KNOWN_KEYS),
    };
  });

  const match = isRecord(parsed.match)
    ? {
        intents: asStringArray(parsed.match.intents),
        requires: asStringArray(parsed.match.requires),
      }
    : undefined;

  return {
    id,
    schemaVersion: asVersion(parsed.schemaVersion),
    templateVersion: asVersion(parsed.templateVersion),
    name: typeof parsed.name === "string" ? parsed.name : undefined,
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    notes: asStringList(parsed.notes),
    match,
    artifacts: isRecord(parsed.artifacts) ? parsed.artifacts : undefined,
    stages: normalizedStages,
    extras: collectExtras(parsed, SCENE_TEMPLATE_KNOWN_KEYS),
    file,
    raw,
  };
}

/**
 * 加载项目中所有 scene template，聚合有效场景和解析错误。
 */
export function loadSceneTemplateRegistry(directory: string): SceneRegistry {
  const createdTemplates = ensureProjectSceneTemplates(directory);
  const sceneRoot = projectSceneTemplateRoot(directory);
  const scenes: SceneTemplate[] = [];
  const errors: string[] = [];
  const byId = new Set<string>();

  for (const file of readYamlFiles(sceneRoot)) {
    try {
      const scene = parseSceneTemplate(file);
      if (byId.has(scene.id)) {
        errors.push(`${relativePath(directory, file)}: duplicate scene id ${scene.id}`);
        continue;
      }
      byId.add(scene.id);
      scenes.push(scene);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${relativePath(directory, file)}: ${message}`);
    }
  }

  return {
    directory: sceneRoot,
    createdTemplates,
    scenes: scenes.sort((a, b) => a.id.localeCompare(b.id)),
    errors,
  };
}

/**
 * 返回用于模型选择场景的轻量索引，不暴露完整 YAML。
 */
export function listSceneTemplates(directory: string): {
  directory: string;
  createdTemplates: string[];
  scenes: SceneIndexItem[];
  errors: string[];
} {
  const registry = loadSceneTemplateRegistry(directory);
  return {
    directory: relativePath(directory, registry.directory),
    createdTemplates: registry.createdTemplates.map((file) => relativePath(directory, file)),
    scenes: registry.scenes.map((scene) => sceneIndexItem(directory, scene)),
    errors: registry.errors,
  };
}

/**
 * 按 scene id 加载完整 YAML 和规范化 stages。
 */
export function loadSceneTemplate(directory: string, sceneId: string): {
  directory: string;
  createdTemplates: string[];
  scene?: SceneIndexItem;
  executionGuidance?: SceneExecutionGuidance;
  yaml?: string;
  stages?: SceneStage[];
  executionPlan?: SceneExecutionPlanItem[];
  executionPlanTable?: string;
  errors: string[];
} {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sceneId)) {
    return {
      directory: normalizePath(SCENE_TEMPLATE_DIRECTORY.join("/")),
      createdTemplates: [],
      errors: [`Invalid scene id: ${sceneId}`],
    };
  }

  const registry = loadSceneTemplateRegistry(directory);
  const scene = registry.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    return {
      directory: relativePath(directory, registry.directory),
      createdTemplates: registry.createdTemplates.map((file) => relativePath(directory, file)),
      errors: [`Scene not found: ${sceneId}`, ...registry.errors],
    };
  }

  const executionPlan = buildExecutionPlan(scene);

  return {
    directory: relativePath(directory, registry.directory),
    createdTemplates: registry.createdTemplates.map((file) => relativePath(directory, file)),
    scene: sceneIndexItem(directory, scene),
    executionGuidance: buildExecutionGuidance(scene),
    yaml: scene.raw,
    stages: scene.stages,
    executionPlan,
    executionPlanTable: buildExecutionPlanTable(executionPlan),
    errors: registry.errors,
  };
}
