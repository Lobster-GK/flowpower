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
 * 插件包内置 scene template 种子目录。
 */
export declare function builtinSceneTemplateRoot(): string;
/**
 * 用户项目中的 scene template 运行时目录。
 */
export declare function projectSceneTemplateRoot(directory: string): string;
/**
 * 插件启动和工具调用时都会确保模板种子存在于项目目录。
 *
 * 返回本次新创建的文件，方便工具结果告知模型发生了哪些初始化动作。
 */
export declare function ensureProjectSceneTemplates(directory: string): string[];
/**
 * 加载项目中所有 scene template，聚合有效场景和解析错误。
 */
export declare function loadSceneTemplateRegistry(directory: string): SceneRegistry;
/**
 * 返回用于模型选择场景的轻量索引，不暴露完整 YAML。
 */
export declare function listSceneTemplates(directory: string): {
    directory: string;
    createdTemplates: string[];
    scenes: SceneIndexItem[];
    errors: string[];
};
/**
 * 按 scene id 加载完整 YAML 和规范化 stages。
 */
export declare function loadSceneTemplate(directory: string, sceneId: string): {
    directory: string;
    createdTemplates: string[];
    scene?: SceneIndexItem;
    executionGuidance?: SceneExecutionGuidance;
    yaml?: string;
    stages?: SceneStage[];
    executionPlan?: SceneExecutionPlanItem[];
    executionPlanTable?: string;
    errors: string[];
};
export {};
