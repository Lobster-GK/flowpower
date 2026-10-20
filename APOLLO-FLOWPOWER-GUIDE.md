# apollo-flowpower 插件完整指南

## 1. 插件简介

`apollo-flowpower`，简称 `afp`，是一套面向 OpenCode 的前端 AI 开发流程插件。它的目标不是简单增加几个提示词，而是沉淀一套可复用、可配置、可演进的前端 AI 开发范式。

在普通 AI 生码流程里，模型经常会遇到几个问题：

- 用户只说“帮我做个页面”，模型不知道应该先确认视图、再生码、再检查，还是直接改代码。
- 固定流程如果常驻在上下文里，容易被模型在不该使用的时候误触发。
- 不同项目有自己的组件库、业务规范、接口风格和目录约定，如果每次都靠用户临时补充，容易遗漏。
- 质量检查、错误修复和视觉还原往往没有明确阶段，导致模型边做边猜。

`apollo-flowpower` 的核心思路是：把前端 AI 开发拆成“显式命令、场景模板、能力 skill、执行 subagent、项目配置”几个层次。只有当用户明确调用 `/afp-scene` 时，模型才会进入完整场景编排；平时普通对话不会自动注入完整流程。

插件当前提供：

- 场景编排命令：`/afp-scene`
- 单能力命令：`/afp-ui-spec`、`/afp-codegen-plan`、`/afp-ui-codegen`、`/afp-api-integration`、`/afp-lint-check`、`/afp-boot-check`、`/afp-runtime-check`、`/afp-ui-review`、`/afp-reflect`、`/afp-doctor`
- 内置前端能力 skills：布局说明、组件映射、生码计划、生码、接口集成、lint 检查、启动检查、运行时检查、UI review、错误修复
- 默认 subagents：上下文侦察、UI 观察、计划、实现、验证、审查等职责车道
- 可编辑场景模板：复制到项目目录后由项目自行维护
- 项目配置入口：`.opencode/apollo-flowpower/config.yaml`
- 插件工具：用于列出场景、加载场景、解析项目配置和执行项目自检

## 2. 设计思想

### 2.1 显式触发，而不是常驻流程

插件不会把完整流程常驻注入到每轮上下文里。完整编排只在用户调用 `/afp-scene` 时生效。

这样做有两个好处：

- 降低误调用风险：普通 UI 修改、一次性调试或闲聊不会被强行套进完整流程。
- 降低上下文污染：模型平时只看到必要规则，只有进入场景时才读取完整 YAML。

### 2.2 场景先索引，后加载完整 YAML

模型自动选择场景时，应该先调用 `afp_list_scenes`。这个工具只返回场景的轻量元数据，例如 `id`、`name`、`description`、`match` 和 `file`。

模型选中场景后，必须再调用 `afp_load_scene_template` 加载完整 YAML、结构化 scene 信息、`executionGuidance`、`executionPlan` 和 `executionPlanTable`。完整流程节点、场景 notes、阶段约束、产物要求和预计算执行计划只在这一步进入上下文。

这避免了所有预制流程和用户自定义流程一次性进入上下文，减少误触发，也减少 token 消耗。

### 2.3 模板是种子，项目目录才是运行时事实来源

插件内部会内置几份 scene template 作为默认模板。插件启动时，会把缺失的模板复制到项目目录：

```text
.opencode/apollo-flowpower/scene-template/*.yaml
```

如果目标目录已经存在同名文件，插件不会覆盖。项目可以在这里修改已有模板，也可以新增自己的模板。运行时工具只读取项目目录中的模板，因此项目目录是唯一事实来源。

### 2.4 Skill 表达能力，Scene 表达流程

skill 只描述一个能力应该怎么做，例如“如何修复错误”“如何做 UI 生码”“如何做 lint 检查”。它不应该绑定某个固定流程阶段。

scene template 负责把这些能力编排起来，例如：

```yaml
stages:
  - id: codegen
    use:
      skill: frontend-ui-codegen
  - id: lint
    use:
      subagent: afp-verifier-agent
      skill: frontend-lint-check
```

这样同一个 skill 可以被多个场景复用，而一个场景也可以按需要组合多个 skill。

### 2.5 项目资产只声明索引，不自动读取正文

项目组件库、业务组件规范、前端开发规范等资产通常是 Markdown 文件。插件通过 `config.yaml` 解析这些资产的说明和路径，但不会自动读取资产正文。

模型在每个流程节点开始前调用 `afp_get_project_config`，拿到资产列表后，只读取和当前阶段明确相关的文件。

这样能兼顾两件事：

- 模型知道项目有哪些资产可以用。
- 不把所有资产正文一次性塞进上下文。

### 2.6 新 UI 生码拆成三份规格

新页面、新组件、截图还原或大幅 UI 结构变更拆成三份连续产物：

```text
01-ui-layout-spec.md
02-component-mapping-spec.md
03-codegen-plan-spec.md
```

- `01-ui-layout-spec.md`：说明页面区域、层级、元素盘点、布局约束和分隔结构。
- `02-component-mapping-spec.md`：把每个元素归属到组件、props、slot、children、数据、交互和状态。
- `03-codegen-plan-spec.md`：持久化记录文件结构、组件拆分、状态设计、样式策略和验证方式。

这样做是为了把模型更难稳定遵守的“像素级视觉还原”降级为软约束，把元素覆盖、组件选择、属性归属和生码计划提升为硬约束。

`03-codegen-plan-spec.md` 也是现有功能变更、bug 修复、新增需求和小范围重构的统一计划载体。这类任务不强制要求 layout spec 和 component mapping spec，应优先基于现有代码、错误证据、用户需求和项目资产制定计划。

### 2.7 执行过程要显式可追踪

模型加载 scene YAML 后，必须优先使用 `afp_load_scene_template` 返回的 `executionPlanTable` 输出一个待办列表式执行清单。每个阶段需要包含：

- 状态：`running`、`done`、`skip`、`error`
- 流程阶段
- 执行者
- 产物
- 使用资产
- 说明

模型必须按清单顺序推进。每完成、跳过或失败一个阶段，都要更新清单，再进入下一个阶段。

## 3. 安装方式

OpenCode 支持两类插件加载方式：项目或全局的本地插件目录，以及在 `opencode.json` 中声明 npm 插件包。下面给出两种推荐安装方式。

### 3.1 从 npm 安装

如果 `apollo-flowpower` 已发布到 npm，可以在项目根目录的 `opencode.json` 中声明插件：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["apollo-flowpower"]
}
```

OpenCode 启动时会自动安装并加载 npm 插件包。

如果希望全局启用，可以把同样的配置放到 OpenCode 的全局配置文件中。

### 3.2 本地开发安装

如果你正在本地开发这个插件，可以先在插件目录安装依赖并构建：

```bash
cd codegen-superpower
npm install
npm run build
```

然后在目标项目中创建 `.opencode/package.json`，把插件作为本地依赖声明进去：

```json
{
  "dependencies": {
    "apollo-flowpower": "file:../codegen-superpower"
  }
}
```

再创建本地插件入口文件：

```text
.opencode/plugins/apollo-flowpower.js
```

内容如下：

```js
export { default } from "apollo-flowpower";
```

重新启动 OpenCode 后，插件会被加载。

如果你的插件目录不在目标项目的相邻路径，请把 `file:../codegen-superpower` 改成实际相对路径。

### 3.3 安装后自动生成的项目文件

插件第一次在项目中启动时，会自动补齐运行时目录：

```text
.opencode/apollo-flowpower/
  config.yaml
  scene-template/
    api-integration.yaml
    error-fix.yaml
    feature-change.yaml
    screenshot-to-page.yaml
    text-to-page.yaml
```

注意：

- 只会创建缺失文件。
- 如果同名配置或模板已经存在，不会覆盖。
- 后续用户修改项目目录中的模板和配置，插件会尊重用户修改。

## 4. 快速开始

### 4.1 使用完整场景编排

如果已经知道要用哪个场景，可以显式指定：

```text
/afp-scene scene=text-to-page 生成一个订单列表页，包含筛选、表格、分页和操作按钮。
```

如果不知道应该用哪个场景，可以不指定：

```text
/afp-scene 生成一个订单列表页，包含筛选、表格、分页和操作按钮。
```

此时模型应该：

1. 调用 `afp_list_scenes` 获取当前项目可用场景。
2. 根据用户需求选择最匹配的 scene。
3. 调用 `afp_load_scene_template` 加载完整 YAML、结构化 scene 信息、`executionGuidance`、`executionPlan` 和 `executionPlanTable`。
4. 调用 `afp_get_project_config` 获取项目配置和资产索引。
5. 输出执行清单。
6. 按清单逐阶段执行，每个阶段完成后更新清单。

### 4.2 只使用某个单能力命令

如果你只想让模型执行某一个能力，不需要进入完整编排，可以使用单能力命令：

```text
/afp-ui-codegen 根据已有 01-ui-layout-spec.md、02-component-mapping-spec.md 和 03-codegen-plan-spec.md 生成页面代码，不运行完整质量检查流程。
```

```text
/afp-ui-codegen 修复订单列表筛选重置后分页没有回到第一页的问题。
```

常用命令：

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

单能力命令不会自动升级成完整流程。只有 `/afp-scene` 才代表进入完整场景编排。

`/afp-ui-spec` 会按顺序生成 layout spec 和 component mapping spec；`/afp-codegen-plan` 只生成生码计划，不写代码。新 UI 或大幅 UI 变更应先有这两份 UI spec；现有功能变更、bug 修复和新增局部需求可以直接基于现有代码、错误证据和用户需求生成计划。

`/afp-reflect` 用于复盘一次前端 AI 开发任务或完整 scene 流程，默认生成 `04-reflection-report.md` 和沉淀建议，不修改配置、模板、资产或代码。只有用户明确 `apply=true` 或要求落地建议时，才进入应用建议模式。

`/afp-doctor` 用于检查当前项目 Apollo Flowpower 运行状态，只做诊断，不进入生码、修复或 scene 编排。

## 5. 配置项目资产

项目配置统一放在：

```text
.opencode/apollo-flowpower/config.yaml
```

当前支持两个主要配置段：

- `subagents`：给插件内置子 agent 指定模型。
- `assets`：声明项目级资产。资产可以是组件库说明、业务组件文档、前端规范、接口约定、目录结构说明等。

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
  - description: 项目组件库说明，包含通用组件、业务组件和使用约束。
    path: docs/ai-assets/components.md
  - description: 项目前端开发规范，包含目录结构、命名、状态管理和接口调用方式。
    path: docs/ai-assets/frontend-rules.md
  - description: 订单业务组件说明，包含订单状态、筛选项和表格列约定。
    path: docs/ai-assets/order-domain.md
```

字段说明：

- `schemaVersion`：配置文件版本，当前为 `1`。
- `subagents`：内置子 agent 模型配置。
- `subagents.<name>.model`：该子 agent 使用的模型。留空表示使用 OpenCode 当前默认模型。
- `assets`：项目资产列表。
- `assets[].description`：资产说明，要写清楚这个文件解决什么问题。
- `assets[].path`：资产路径，必须是相对项目根目录的路径。

`subagents` 只影响插件自动注册的默认 subagent。如果用户已经在 OpenCode 标准 `agent` 配置里定义了同名 agent，插件不会覆盖用户配置。

插件解析配置时会返回：

- subagent 名称
- subagent 模型类型
- subagent 实际配置的模型
- 资产说明
- 资产路径
- 文件是否存在
- 文件大小
- 解析错误

已有旧版配置会在插件初始化时自动补齐缺失默认项，例如 `subagents`、内置子 agent 的 `model` 字段和 `assets`。补全只添加缺失字段，不覆盖用户已有值。

插件不会返回资产正文。模型必须根据当前 stage 的需要，自己读取相关路径。

建议把资产拆成粒度适中的 Markdown 文件，例如：

```text
docs/ai-assets/
  components.md
  frontend-rules.md
  api-client.md
  domain-order.md
  form-patterns.md
```

不要把所有项目知识塞进一个超长文件。资产越清晰，模型越容易判断当前阶段该读哪个文件。

## 6. 配置和扩展场景模板

项目场景模板目录：

```text
.opencode/apollo-flowpower/scene-template/
```

内置模板只是初始种子。你可以直接修改项目目录里的模板，也可以新增模板。

一个最小场景模板示例：

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

常用字段：

- `id`：唯一场景 id，也是 `/afp-scene scene=<id>` 使用的值。
- `name`：展示名称。
- `description`：场景说明，用于帮助模型自动匹配场景。
- `notes`：场景特定约束。
- `match.intents`：意图标签，用于自动匹配。
- `match.requires`：所需输入，例如 `image`、`api-doc`、`error-report`。
- `artifacts`：产物路径约定。
- `stages`：按顺序执行的阶段列表。
- `stage.id`：阶段 id。
- `stage.multiAgent`：当前阶段的多 agent 执行策略，只影响该节点。
- `stage.use.skill`：阶段使用的 skill，可以是字符串，也可以是字符串数组。
- `stage.use.subagent`：阶段优先委派的 subagent。
- `stage.instruction`：由主模型直接执行的轻量说明。
- `stage.requires`：阶段前置条件。
- `stage.output`：阶段预期产物。
- `stage.when`：阶段执行条件。
- `stage.onFail`：失败策略，例如 `fix-and-retry`。
- `stage.maxRetries`：最大重试次数。

多 agent 是阶段节点级执行策略，不属于项目级 `config.yaml`，也不属于整个 scene。复杂截图、多状态图片、表单/表格密集页面，或后续错误分析、方案评审、接口理解等节点，都可以按需声明 `stage.multiAgent`。每个 agent 如何执行由当前 stage 的 skill 和 instruction 决定；UI 识别节点使用同职责观察和主模型合并。

### 6.1 一个阶段配置多个 skill

如果一个阶段需要连续应用多个 skill，可以写成数组：

```yaml
stages:
  - id: repair-and-check
    use:
      skill:
        - frontend-error-fix
        - frontend-lint-check
```

模型应该按数组顺序执行这些 skill。

### 6.2 没有 use 的阶段

如果某个阶段没有 `use`，但有 `instruction`，执行者就是主模型：

```yaml
stages:
  - id: final-summary
    instruction: 总结修改文件、验证结果和剩余风险。
```

## 7. 执行清单要求

模型加载 scene YAML 后，执行第一个 stage 前，必须输出执行清单。

如果工具返回了 `executionPlanTable`，初始清单必须使用该表格，不要自行根据 YAML 重算执行者、产物、阶段说明、失败策略或多 agent 策略。

模型必须读取并遵守结构化返回中的 `scene.notes`、`scene.artifacts`、`scene.extras`、`executionGuidance`、stage `instruction` 和 stage `extras`。这些信息都是模板有效内容，不应只因为计划表已经生成就忽略。

表格格式：

| 状态 | 流程阶段 | 执行者 | 产物 | 使用资产 | 说明 |
| --- | --- | --- | --- | --- | --- |
| running | clarify-target | 主模型 | 无显式产物 | - | 确认目标目录、路由和 rootDomId |
|  | codegen | frontend-ui-codegen | 无显式产物 | 待判断 | - |
|  | lint | afp-verifier-agent | 无显式产物 | 待判断 | onFail: fix-and-retry |

状态只能使用：

- `running`
- `done`
- `skip`
- `error`

执行规则：

- 任一时刻只能有一个 `running` 阶段。
- 只能在当前阶段 `done` 或 `skip` 后进入下一个阶段。
- 如果阶段失败且无法继续，状态标记为 `error` 并停止流程。
- 如果 `when` 条件不满足，状态标记为 `skip`，并说明跳过原因。
- 每个 stage 开始前都要重新调用 `afp_get_project_config`，判断是否需要读取项目资产。
- 每完成、跳过或失败一个 stage，都要重新输出更新后的执行清单。
- 如果某个 stage 的 `executionPlan.multiAgent.parallelDispatchInstruction` 存在，必须原文保留到对应行的说明中，并在执行时同一轮同时启动指定数量的 subagent，不能串行替代。

## 8. 内置场景

当前内置场景模板包括：

- `text-to-page`：从文字需求生成页面。
- `screenshot-to-page`：从截图或图片还原页面。
- `feature-change`：对已有功能做变更、新增局部需求或小范围重构。
- `api-integration`：根据接口文档完成前端 API 集成。
- `error-fix`：根据错误报告进行分析、计划和最小修复。

这些模板复制到项目目录后可以按项目需要修改。

## 9. 内置能力和子代理

内置 skills：

- `frontend-ui-layout-spec`：从截图、图片或文字需求生成布局说明、ASCII 原型图和 UI 元素盘点。
- `frontend-component-mapping-spec`：基于布局说明生成组件映射与属性归属。
- `frontend-codegen-plan`：在生码、改码或修复前生成持久化计划，记录任务类型、文件、步骤、状态、样式和验证方式。
- `frontend-ui-codegen`：根据生码计划、可选布局说明/组件映射和现有代码生成或修改前端代码。
- `frontend-component-doc`：根据组件代码生成组件功能、API、示例和 ASCII 原型图文档。
- `frontend-api-integration`：根据明确接口文档完成 API 集成。
- `frontend-lint-check`：执行 lint 检查和相关修复流程。
- `frontend-boot-check`：执行启动检查和相关修复流程。
- `frontend-runtime-check`：执行浏览器运行时检查。
- `frontend-ui-review`：执行视觉还原度审查。
- `frontend-error-fix`：根据明确错误报告分析原因、制定计划并做最小修复。
- `frontend-flow-reflection`：复盘一次前端 AI 开发流程，生成 `04-reflection-report.md`，沉淀资产、模板、skill 和 agent 改进建议。

默认 subagents：

- `afp-context-agent`：上下文侦察，读取相关事实和项目约定。
- `afp-observer-agent`：观察输入，整理可见事实、状态差异和不确定项。
- `afp-planner-agent`：制定或审查可执行计划。
- `afp-builder-agent`：按明确范围实施代码、文档或配置改动。
- `afp-verifier-agent`：执行检查并返回结构化证据。
- `afp-review-agent`：独立审查需求、计划、改动、证据和流程风险。

subagent 更像执行角色，skill 更像能力说明。scene 可以决定某个阶段由主模型执行、由某个 subagent 执行，或由主模型按 skill 执行。

## 10. 插件工具

插件注册四个工具，主要供模型在 AFP 命令中调用。

### 10.1 afp_list_scenes

作用：扫描项目目录中的 scene template，只返回轻量元数据。

返回内容包括：

- `directory`
- `createdTemplates`
- `scenes`
- `errors`

每个 scene 包含：

- `id`
- `name`
- `description`
- `match`
- `file`

### 10.2 afp_load_scene_template

作用：根据 scene id 加载完整 YAML、结构化 scene 信息、`executionGuidance`、规范化后的 stages、预计算 `executionPlan` 和初始 `executionPlanTable`。

参数：

```json
{
  "scene": "text-to-page"
}
```

注意：`scene` 必须是来自 `afp_list_scenes` 的 scene id，不能传列表下标、展示名称或完整 scene 对象。

### 10.3 afp_get_project_config

作用：解析 `.opencode/apollo-flowpower/config.yaml`，返回项目配置、subagent 模型设置和资产索引。

返回内容包括：

- `configFile`
- `createdConfig`
- `schemaVersion`
- `subagents`
- `assets`
- `errors`

每个 subagent 包含：

- `name`
- `modelKind`
- `model`
- `configuredModel`

每个 asset 包含：

- `description`
- `path`
- `exists`
- `size`

### 10.4 afp_doctor

作用：执行项目自检，检查 `.opencode/apollo-flowpower/config.yaml`、scene template、重复 scene id、资产路径、内置 skill frontmatter，以及 scene 中引用的 skill/subagent。

返回内容包括：

- `status`
- `checks`
- `summary`
- `config`
- `scenes`

## 11. 推荐落地方式

### 11.1 先落地项目资产

建议先整理项目资产：

```text
docs/ai-assets/components.md
docs/ai-assets/frontend-rules.md
docs/ai-assets/api-client.md
docs/ai-assets/domain-models.md
```

然后在 `config.yaml` 中声明这些资产。

### 11.2 再固化典型场景

优先沉淀高频场景，例如：

- 文本需求生成页面
- 截图还原页面
- 根据接口文档补 API
- 根据 lint 或启动报错修复问题
- 对已有页面做视觉 review

每个场景都用 YAML 描述阶段顺序，尽量让流程短而明确。

### 11.3 最后演进团队规范

当多个项目都在使用 `apollo-flowpower` 后，可以逐步沉淀：

- 通用场景模板库
- 团队级前端资产模板
- 项目初始化检查清单
- 质量检查标准
- 常见错误修复策略

插件内部只放通用种子，项目目录保留最终定制权。这样既有统一范式，也不会压死项目差异。

## 12. 常见问题

### 12.1 为什么不把所有流程直接写进 rule.md

因为 rule 会常驻上下文。完整流程常驻后，模型可能在普通问题里误用流程，也会占用上下文。`apollo-flowpower` 选择用命令显式触发，再按需加载场景 YAML。

### 12.2 为什么插件不直接读取项目资产正文

项目资产可能很多，也可能很长。插件只返回资产说明和路径，让模型按阶段判断是否需要读取。这样更节制，也更符合“当前阶段需要什么就读什么”的原则。

### 12.3 如果模型不知道该选哪个场景怎么办

模型应该先调用 `afp_list_scenes` 查看当前项目可用场景。若多个场景都可能匹配且置信度低，应让用户选择，而不是硬猜。

### 12.4 如果项目模板和内置模板重名怎么办

插件不会覆盖已有同名模板。已有项目模板优先保留。你可以继续修改项目目录里的模板，也可以删除不需要的旧模板。

### 12.5 如果出现 duplicate scene id 怎么办

说明 `.opencode/apollo-flowpower/scene-template/` 中有两个模板使用了相同的 `id`。需要保留一个，或修改其中一个模板的 `id`。

## 13. 一句话总结

`apollo-flowpower` 的价值在于：用显式命令控制流程入口，用 YAML 描述可编辑编排，用 skill 和 subagent 复用能力，用 config.yaml 接入项目资产，最终让前端 AI 开发从“模型自由发挥”走向“项目可治理的协作流程”。
