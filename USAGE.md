# apollo-flowpower 使用说明

## 插件提供什么

安装后，OpenCode 会获得：

- 前端布局说明、组件映射、生码计划、生码、API 集成、质量检查和错误修复 skills。
- `/afp-xxx` 单能力命令。
- 默认 subagent。
- 可在项目内编辑的 scene template。
- 项目级配置入口 `.opencode/apollo-flowpower/config.yaml`。
- 按需加载 scene、模板和项目配置的工具。

场景编排默认不生效。只有在需要模型按完整 YAML 流程执行时，才使用：

```text
/afp-scene
```

## 模板种子

插件内置模板种子位于：

```text
scene-template/*.yaml
```

运行时，缺失模板会被复制到项目目录：

```text
.opencode/apollo-flowpower/scene-template/*.yaml
```

项目目录是运行时事实来源。用户可以修改已有模板或新增模板；插件不会覆盖已有同名文件。

## 项目配置

项目级配置统一放在：

```text
.opencode/apollo-flowpower/config.yaml
```

插件会在文件不存在时自动创建。当前支持 `subagents` 和 `assets` 配置段；未来真正项目级配置也应继续收敛到这个文件，避免配置入口扩散。

最小配置示例：

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

`subagents.<name>.model` 留空表示使用 OpenCode 当前默认模型；填写后只影响插件自动注册的同名默认 subagent。

已有旧版配置会在插件初始化时自动补齐缺失默认项，但不会覆盖已有值。

资产路径必须相对项目根目录。插件不会加载资产正文；模型应在每个 stage 前查看解析后的资产列表，并只读取相关资产路径。

## 单能力命令

当你只想执行某一个能力时使用：

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

这些命令不会自动进入后续完整流程，除非用户显式调用 `/afp-scene`。

`/afp-ui-spec` 会按顺序产出两份 spec：

- `01-ui-layout-spec.md`：布局说明和 UI 元素盘点。
- `02-component-mapping-spec.md`：组件映射与属性归属。

如果用户提供多张图片，默认视为同一个页面的不同状态，并在最终 spec 中合并稳定结构和状态特有元素。单独使用 `/afp-ui-spec` 时默认单 agent；只有用户本次明确要求多 agent 识别，才临时并行多个同职责 agent。

`/afp-codegen-plan` 会产出 `03-codegen-plan-spec.md`，但不会写代码。它既可以基于这两份 UI spec 规划新页面，也可以基于现有代码、错误证据和用户需求规划功能变更、bug 修复或新增需求。

`/afp-reflect` 会产出或更新 `04-reflection-report.md`，用于复盘一次生码、修复、接口接入、质量检查或完整 scene 流程。默认只输出建议，不修改配置、模板、资产或代码；只有用户明确 `apply=true` 或要求落地时，才进入应用建议模式。

`/afp-doctor` 只做项目自检，调用 `afp_doctor` 检查配置、scene template、重复 id、资产路径和内置资源健康状态，不进入生码或修复流程。

## 场景命令

当你想执行完整编排流程时使用：

```text
/afp-scene scene=<scene-id> 你的需求
```

如果指定了 `scene`，模型应直接调用：

```text
afp_load_scene_template
```

加载该 scene 后再执行。

如果没有指定 `scene`，模型应：

1. 调用 `afp_list_scenes`。
2. 从返回元数据中选择最匹配的 scene。
3. 调用 `afp_load_scene_template` 加载选中的 scene、`executionGuidance`、`executionPlan` 和 `executionPlanTable`。
4. 在每个 stage 开始前调用 `afp_get_project_config`。
5. 只读取和当前 stage 相关的项目资产路径。
6. 使用 `executionPlanTable` 输出初始执行清单，并按 `executionPlan` 顺序执行。

如果匹配置信度低，模型应让用户选择 scene。

## 工具返回

`afp_list_scenes` 返回：

- `directory`
- `createdTemplates`
- `scenes`
- `errors`

每个 scene 项包含：

- `id`
- `name`
- `description`
- `match`
- `file`

`afp_load_scene_template` 参数：

- `scene`：来自 `afp_list_scenes` 的 scene id。

它返回选中 scene 的结构化元数据、原始 YAML、规范化 stages、`executionGuidance`、预计算 `executionPlan`、初始 `executionPlanTable` 和校验错误。

结构化 scene 元数据会保留模板中的 `notes`、`artifacts`、版本字段和扩展字段。`executionPlan` 会保留 stage `instruction`、`requires`、`when`、`onFail`、`maxRetries`、`multiAgent`、扩展字段和解析后的产物引用。

`afp_get_project_config` 返回：

- `configFile`
- `createdConfig`
- `schemaVersion`
- `subagents`
- `assets`
- `errors`

每个 subagent 项包含：

- `name`
- `modelKind`
- `model`
- `configuredModel`

每个资产项包含：

- `description`
- `path`
- `exists`
- `size`

`afp_doctor` 返回：

- `status`：`pass`、`warning` 或 `error`
- `checks`：按配置、scene、资产、skill、subagent 分类的检查项
- `summary`：通过、提示、警告、错误数量
- `config`：配置文件、迁移项、资产和 subagent 模型统计
- `scenes`：场景目录、场景数量、补齐模板和解析错误统计

## 场景 YAML 格式

最小示例：

```yaml
id: text-to-page
name: 文本生成页面
description: 根据文字需求生成前端页面。
notes:
  - 当用户只提供文字需求时，跳过图片分析。
match:
  intents:
    - text-codegen
    - create-page
stages:
  - id: clarify-target
    instruction: 确认目标目录、路由和 rootDomId。
  - id: ui-layout-spec
    multiAgent:
      enabled: false
      agentCount: 3
      mode: same-role-observation
      persistOutputs: true
      outputDir: ui-recognition-observations
    use:
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
  - id: lint
    use:
      subagent: afp-verifier-agent
      skill: frontend-lint-check
    onFail: fix-and-retry
    maxRetries: 3
```

支持字段：

- `id`：唯一 scene id。
- `name`：展示名称。
- `description`：scene 说明。
- `notes`：scene 特定约束。
- `match.intents`：自动匹配意图标签。
- `match.requires`：所需输入，例如 `image`、`api-doc`、`error-report`。
- `artifacts`：产物路径约定。
- `stages`：有序阶段列表。
- `stage.multiAgent`：当前阶段的多 agent 执行策略，只影响该节点。
- `stage.use.skill`：stage 使用的 skill；可以是字符串，也可以是字符串数组。数组会按顺序执行。
- `stage.use.subagent`：优先委派的 subagent。
- `stage.instruction`：由主模型直接执行的轻量说明。
- `stage.requires`：阶段前置条件。
- `stage.output`：阶段预期产物。
- `stage.when`：阶段执行条件。
- `stage.onFail`：失败策略，例如 `fix-and-retry`。
- `stage.maxRetries`：重试次数上限。

## 常见用法

指定场景：

```text
/afp-scene scene=screenshot-to-page 把这张截图还原到 src/pages/order-list。
```

已有功能变更或新增需求：

```text
/afp-scene scene=feature-change 给订单列表增加批量导出入口。
```

自动选择场景：

```text
/afp-scene 生成一个包含筛选、表格和分页的订单列表页。
```

按已有规格和计划执行 UI 生码：

```text
/afp-ui-codegen 根据 01-ui-layout-spec.md、02-component-mapping-spec.md 和 03-codegen-plan-spec.md 生成订单列表页代码，不运行验证阶段。
```

按现有代码生成变更计划并实施：

```text
/afp-ui-codegen 修复订单列表页筛选条件重置后分页没有回到第一页的问题。
```
