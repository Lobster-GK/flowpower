# apollo-flowpower 设计思路说明

## 背景

`apollo-flowpower` 的目标是沉淀一套前端 AI 开发范式：用户可以从文字需求、截图、接口文档或错误报告出发，让模型按明确阶段完成视图分析、生码、接口集成、质量检查和修复。

早期把完整流程常驻放进上下文，容易带来误触发、阶段跳跃和上下文污染。因此当前设计采用显式命令触发：

```text
/afp-scene
```

只有用户调用该命令时，模型才读取场景索引、加载场景 YAML，并按阶段执行。

## 核心设计

### 1. 场景编排按需加载

场景模板不常驻注入上下文。插件只提供工具：

- `afp_list_scenes`
- `afp_load_scene_template`

用户调用 `/afp-scene` 后，模型先看 scene 元数据，再选择并加载完整 YAML。未调用场景命令时，普通 UI 修改、单次调试或单能力命令都不会自动进入完整流程。

### 2. 项目配置统一入口

项目级配置统一放在：

```text
.opencode/apollo-flowpower/config.yaml
```

插件提供：

```text
afp_get_project_config
```

这个工具只负责确定性解析配置，返回 subagent 模型设置、资产说明、路径、存在状态等结构化结果。资产正文仍由模型按需读取项目文件，不通过插件代理。

这样既避免模型手写 YAML 解析出错，又避免插件变成项目知识库读取层。

插件初始化时会自动补齐旧版配置中缺失的默认字段，例如 `subagents`、内置子 agent 的 `model` 和 `assets`；已有值不覆盖。项目健康检查由 `afp_doctor` 独立完成。

### 3. Skill 只表达能力

Skill 名称只和能力内容相关，不包含 `stage`、`workflow` 或插件前缀：

- `frontend-ui-layout-spec`
- `frontend-component-mapping-spec`
- `frontend-codegen-plan`
- `frontend-ui-codegen`
- `frontend-component-doc`
- `frontend-api-integration`
- `frontend-lint-check`
- `frontend-boot-check`
- `frontend-runtime-check`
- `frontend-ui-review`
- `frontend-error-fix`
- `frontend-flow-reflection`

这样 skill 可以被场景调用，也可以被单能力命令调用，还可以被其它 agent 复用。

### 4. Subagent 表达执行角色

默认 subagent 使用 `afp-xxx-agent`：

- `afp-context-agent`
- `afp-observer-agent`
- `afp-planner-agent`
- `afp-builder-agent`
- `afp-verifier-agent`
- `afp-review-agent`

这些 agent 用于隔离项目侦察、视觉观察、计划、实现、验证和审查等职责车道。插件只在用户没有定义同名 agent 时提供默认配置。用户可以在 `.opencode/apollo-flowpower/config.yaml` 的 `subagents.<name>.model` 中给这些默认 agent 指定模型；如果 OpenCode 标准 `agent` 配置中已有同名 agent，插件仍然尊重已有配置，不做覆盖。

### 5. Commands 是用户入口

完整流程入口：

```text
/afp-scene
```

单能力入口：

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

单能力命令不会主动串联后续阶段。完整流程只能由 `/afp-scene` 触发。

## 典型流程

### 截图转页面

```text
用户调用 /afp-scene 并提供截图
  -> afp_list_scenes
  -> 选择 screenshot-to-page
  -> afp_load_scene_template
  -> afp_get_project_config
  -> afp-context-agent
  -> afp-observer-agent + frontend-ui-layout-spec
  -> afp-planner-agent + frontend-component-mapping-spec
  -> afp-planner-agent + frontend-codegen-plan
  -> afp-builder-agent + frontend-ui-codegen
  -> afp-verifier-agent + frontend-lint-check
  -> afp-verifier-agent + frontend-boot-check
  -> afp-verifier-agent + frontend-runtime-check
  -> afp-review-agent + frontend-ui-review
```

### 文本生码

```text
用户调用 /afp-scene 并提供文字需求
  -> 选择 text-to-page
  -> frontend-ui-layout-spec
  -> frontend-component-mapping-spec
  -> frontend-codegen-plan
  -> frontend-ui-codegen
  -> frontend-lint-check
  -> frontend-boot-check
  -> frontend-runtime-check
```

### API 集成

```text
用户调用 /afp-scene scene=api-integration 并提供接口文档
  -> frontend-api-integration
  -> frontend-lint-check
  -> frontend-boot-check
  -> frontend-runtime-check
```

### 功能变更或新增需求

```text
用户调用 /afp-scene scene=feature-change 并描述已有功能变更
  -> frontend-codegen-plan
  -> frontend-ui-codegen
  -> frontend-lint-check
  -> frontend-boot-check
  -> frontend-runtime-check（按条件）
```

## 执行清单

加载 scene YAML 后，模型必须先读取 `afp_load_scene_template` 返回的结构化 scene 信息和 `executionGuidance`，再优先使用 `executionPlanTable` 输出待办式执行清单，并在每个阶段完成、跳过或失败后更新。

清单包含：

```text
状态 | 流程阶段 | 执行者 | 产物 | 使用资产 | 说明
```

状态只能是：

```text
running | done | skip | error
```

这样做的目的不是让插件完整接管状态机，而是让插件先给出稳定的模板信息和执行计划事实来源，再让模型在对话里显式暴露阶段推进，减少跳阶段、重复执行、漏读 notes 和错误解释 YAML。

如果某个节点启用了 `multiAgent`，执行计划会包含强约束说明：必须把任务拆成指定数量的完全独立子任务，并在同一轮同时启动对应数量的 subagent；不能等待某个 subagent 完成后再启动下一个。

## 设计取舍

### 为什么不把完整流程放进常驻上下文

常驻上下文会让模型在普通任务中误触发完整流程，也会浪费 token。现在只有 `/afp-scene` 才加载场景模板。

### 为什么不让插件读取资产正文

项目资产大多数是 Markdown。模型已经可以按路径读取文件，插件只需要解析 `config.yaml`，返回结构化资产列表即可。

### 为什么把多 agent 放在 stage 节点

复杂截图、多图状态和表单/表格密集页面更容易出现漏识别；后续错误分析、方案评审、接口理解也可能需要多个 agent 交叉观察。因此多 agent 不应该是全局配置，也不应该挂在整个 scene 上，而应该放在具体 stage 的 `multiAgent` 字段。

这样每个节点可以独立决定是否启用、启用几个、是否持久化草案，以及用什么节点专属 `options`。它也不是默认开启，因为会增加 token 和执行时间。最终仍然只保留对应节点的一份权威产物，多 agent 草案只是合并证据。

### 为什么保留单能力命令

用户并不总是需要完整流程。有时只要布局说明和组件映射、只要生码计划、只要 lint、只要运行时检查，或者只想复盘并沉淀经验。单能力命令让这些能力有明确入口，也减少模型自动扩展任务范围。

### 为什么拆成 layout spec、component mapping spec 和 codegen plan spec

模型对像素级视觉还原的遵从度有上限，但对结构化表格、组件契约和待办计划的遵从度更高。因此新的前端生码链路把产物拆成三份：

- layout spec 负责“页面上有什么、区域怎么排、哪些元素不能漏”。
- component mapping spec 负责“每个元素由哪个组件承载、文案和状态归到哪个 prop、数据和交互归到哪里”。
- codegen plan spec 负责“代码怎么组织、组件怎么拆、状态怎么放、生成后怎么验证”，并以文件形式持久化，避免上下文压缩后丢失计划。

视觉细节仍保留，但降级为辅助约束；组件映射、属性归属、元素覆盖、数据归属和交互归属是硬约束。

`03-codegen-plan-spec.md` 不只服务新页面。现有功能变更、bug 修复、新增需求和小范围重构也应先生成计划 spec，把任务类型、目标文件、实施步骤、停止条件和验证方式固化下来。只有新 UI 或大幅 UI 结构变更才强制依赖 layout spec 和 component mapping spec；局部改动和修复应以现有代码、错误证据和项目资产为主要事实来源。

### 为什么场景模板复制到项目

插件内置模板只是种子。真正运行时事实来源是项目目录：

```text
.opencode/apollo-flowpower/scene-template/
```

这样用户可以按项目修改、扩展或删除模板，而插件升级不会覆盖用户已有文件。

## 扩展方向

后续可以继续扩展：

- 在 `config.yaml` 中增加质量命令、项目技术栈、默认路径等配置。
- 增加更细的业务组件资产索引。
- 增加 Storybook、Figma MCP、视觉 diff 等外部工具集成。
- 为每次 `/afp-scene` 运行生成 `runId` 和持久化执行记录。
- 把阶段输入、产物、验收标准沉淀为更严格的 stage contract。

核心边界保持不变：流程按命令触发，场景按需加载，项目资产按需读取。
