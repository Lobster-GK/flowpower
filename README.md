# apollo-flowpower

现已提供 DeepSeek Harness 双平台适配入口 `apollo-flowpower/dsh`，安装、模型映射与兼容范围见 [Harness 使用说明](src/DSH.md)。

`apollo-flowpower` 是一个面向 OpenCode 的前端 AI 开发流程插件。它通过显式命令进入场景编排，把前端生码拆成可编辑场景模板、能力型 skill、默认 subagent 和项目级配置。

插件提供：

- 前端布局说明、组件映射、生码计划、生码、API 集成、质量检查和错误修复 skills。
- `/afp-xxx` 单能力命令。
- 默认 subagent。
- 可在项目内修改的 scene template。
- 项目级配置入口 `.opencode/apollo-flowpower/config.yaml`。
- 按需加载 scene 和项目配置的工具。

场景编排不会注入到每一轮普通对话。只有用户显式调用 `/afp-scene` 时，模型才进入 Apollo Flowpower 场景编排模式。

## 场景模板

插件内置模板种子位于：

```text
scene-template/*.yaml
```

插件启动时会把缺失模板复制到项目目录：

```text
.opencode/apollo-flowpower/scene-template/*.yaml
```

项目目录是运行时事实来源。用户可以在这里修改已有模板或新增模板；插件不会覆盖同名文件。

## 项目配置

项目级配置统一放在：

```text
.opencode/apollo-flowpower/config.yaml
```

插件会在文件不存在时自动生成。当前支持的项目级配置段包括：

- `subagents`：给插件内置子 agent 指定模型。
- `assets`：声明项目级 Markdown 或文本资产。

示例：

```yaml
schemaVersion: 1
subagents:
  afp-context-agent:
    model: ""
  afp-observer-agent:
    model: "your-vision-model"
  afp-planner-agent:
    model: ""
  afp-builder-agent:
    model: ""
  afp-verifier-agent:
    model: ""
  afp-review-agent:
    model: ""
assets:
  - description: 项目组件库说明。
    path: docs/ai-assets/components.md
  - description: 前端开发规范。
    path: docs/ai-assets/frontend-rules.md
```

`subagents.<name>.model` 留空表示使用 OpenCode 当前默认模型；填写后只影响插件自动注册的同名默认 subagent。若用户已经在 OpenCode 标准 `agent` 配置里定义了同名 agent，插件不会覆盖那份配置。

如果已有旧版配置文件，插件初始化时会自动补齐缺失的默认配置项，例如 `subagents`、内置子 agent 的 `model` 字段和 `assets`。已有字段值不会被覆盖。

资产正文不会由插件自动读取。模型应先解析配置，再按当前 stage 需要读取相关资产文件。

## 工具

插件注册四个工具：

- `afp_list_scenes`：扫描项目 scene template 目录，只返回 `id`、`name`、`description`、`match`、`file` 等元数据。
- `afp_load_scene_template`：根据 scene id 加载完整 YAML，并返回结构化 scene 信息、`executionGuidance`、规范化 stages、`executionPlan` 和 `executionPlanTable`。
- `afp_get_project_config`：解析 `.opencode/apollo-flowpower/config.yaml`，返回项目配置、subagent 模型设置和资产路径索引。
- `afp_doctor`：执行项目自检，检查配置补全、scene 解析、重复 scene id、资产路径、内置 skill 和 scene 引用。

完整 scene YAML 只有在模型选择 scene 并调用 `afp_load_scene_template` 后才进入上下文。工具会结构化返回 `notes`、`artifacts`、stage `instruction`、扩展字段和预计算执行计划；资产文件正文不通过插件返回，模型按路径自行读取。

## 命令

单能力命令：

```text
/afp-ui-spec
/afp-codegen-plan
/afp-ui-codegen
/afp-api-integration
/afp-lint-check
/afp-boot-check
/afp-runtime-check
/afp-ui-review
/afp-reflect
/afp-doctor
```

完整场景编排命令：

```text
/afp-scene
```

指定场景：

```text
/afp-scene scene=text-to-page 生成一个订单列表页。
```

已有功能变更：

```text
/afp-scene scene=feature-change 给订单列表增加批量导出入口。
```

自动选择场景：

```text
/afp-scene 生成一个包含筛选、表格和分页的订单列表页。
```

自动模式下，模型必须先调用 `afp_list_scenes`，从返回索引中选择 scene，再调用 `afp_load_scene_template` 加载完整模板、结构化模板信息和预计算执行计划。每个 stage 开始前，应调用 `afp_get_project_config` 并只读取相关项目资产。

## 场景 YAML

示例：

```yaml
id: screenshot-to-page
name: 截图生成页面
description: 根据截图生成或更新前端页面。
match:
  intents:
    - screenshot-codegen
  requires:
    - image
stages:
  - id: clarify-target
    instruction: 确认目标目录、路由和 rootDomId。
  - id: ui-layout-spec
    use:
      subagent: afp-observer-agent
      skill: frontend-ui-layout-spec
  - id: component-mapping-spec
    use:
      skill: frontend-component-mapping-spec
  - id: codegen-plan
    use:
      skill: frontend-codegen-plan
  - id: codegen
    use:
      skill: frontend-ui-codegen
  - id: repair-and-check
    use:
      skill:
        - frontend-error-fix
        - frontend-lint-check
```

YAML 只定义编排顺序。每个阶段的实际行为来自引用的 skill、subagent 或 stage instruction。

`use.skill` 可以是单个 skill 名称，也可以是 skill 名称数组；数组会按顺序执行。

多 agent 是流程节点级执行策略，不属于项目级 `config.yaml`。任意 stage 都可以声明 `multiAgent`；UI 识别只是第一个使用它的节点：

```yaml
stages:
  - id: ui-layout-spec
    multiAgent:
      enabled: false
      agentCount: 3
      mode: same-role-independent-final
      persistOutputs: true
      outputDir: ui-recognition-results
      options:
        includeComponentMapping: true
```

## 能力说明

- `frontend-ui-layout-spec`：从截图、图片或文字需求生成布局说明、ASCII 原型图和 UI 元素盘点。
- `frontend-component-mapping-spec`：基于布局说明生成组件映射与属性归属。
- `frontend-codegen-plan`：在生码、改码或修复前生成持久化计划，记录任务类型、文件、步骤、状态、样式和验证方式。
- `frontend-ui-codegen`：根据生码计划、可选布局说明/组件映射和现有代码生成或修改前端代码。
- `frontend-component-doc`：根据组件代码生成组件功能、API、示例和 ASCII 原型图文档。
- `frontend-api-integration`：根据明确接口文档完成前端 API 集成。
- `frontend-lint-check`：执行 lint 检查和相关修复流程。
- `frontend-boot-check`：执行启动检查和相关修复流程。
- `frontend-runtime-check`：执行浏览器运行时检查。
- `frontend-ui-review`：执行视觉还原度审查。
- `frontend-error-fix`：根据明确错误报告做最小必要修复。
- `frontend-flow-reflection`：复盘一次前端 AI 开发流程，生成 `04-reflection-report.md`，沉淀资产、模板、skill 和 agent 改进建议。

## 内置子代理

插件会注册这些默认 subagent，且不会覆盖用户已有同名配置：

- `afp-context-agent`：上下文侦察，读取相关事实和项目约定。
- `afp-observer-agent`：观察输入，整理可见事实、状态差异和不确定项。
- `afp-planner-agent`：制定或审查可执行计划。
- `afp-builder-agent`：按明确范围实施代码、文档或配置改动。
- `afp-verifier-agent`：执行检查并返回结构化证据。
- `afp-review-agent`：独立审查需求、计划、改动、证据和流程风险。
