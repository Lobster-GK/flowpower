# apollo-flowpower 插件架构文档

## 目标

`apollo-flowpower` 是一套面向 OpenCode 的前端 AI 开发流程插件。它把前端生码拆成可独立调用的命令、skill、subagent 和可编辑场景模板，并通过显式命令 `/afp-scene` 进入完整流程编排。

核心原则是：普通对话不注入完整流程；只有用户调用 AFP 命令时，模型才按需加载场景和项目配置。

## 目录结构

```text
apollo-flowpower/
  agents/                 # 内置 subagent prompt
  commands/               # /afp-xxx slash commands
  scene-template/         # 插件内置场景模板种子
  skills/                 # 能力型 skill
  src/
    agents.ts             # 默认 subagent 注册逻辑
    config.ts             # 插件包根目录工具函数
    index.ts              # 插件入口和工具注册
    project-config.ts     # .opencode/apollo-flowpower/config.yaml 解析
    scenes.ts             # 场景模板种子复制、索引和加载
    sync.ts               # 可选同步 commands/skills
```

## 插件职责

插件负责：

- 注册包内 `skills` 路径，让 OpenCode 能发现内置 skill。
- 自动补齐默认 subagent，但不覆盖用户已有同名配置。
- 把内置 `scene-template/*.yaml` 复制到项目 `.opencode/apollo-flowpower/scene-template/`，只补缺失文件。
- 确保项目存在 `.opencode/apollo-flowpower/config.yaml`。
- 自动补齐旧版 `config.yaml` 中缺失的默认配置项，不覆盖已有值。
- 注册 AFP 工具，按需解析场景模板和项目配置。
- 在用户开启 `syncBuiltinResources` 时同步命令和 skill 到项目 `.opencode`。

插件不负责：

- 常驻注入完整流程上下文。
- 替模型执行完整状态机。
- 读取项目资产正文。
- 直接执行 lint、启动、浏览器检查或视觉判断。

## 命令

完整场景编排入口：

- `/afp-scene`

单能力入口：

- `/afp-ui-spec`
- `/afp-codegen-plan`
- `/afp-ui-codegen`
- `/afp-api-integration`
- `/afp-lint-check`
- `/afp-boot-check`
- `/afp-runtime-check`
- `/afp-ui-review`
- `/afp-reflect`
- `/afp-doctor`

单能力命令只执行对应能力，不主动串联后续阶段。完整流程必须通过 `/afp-scene` 显式进入。

## 工具

插件注册四个工具：

- `afp_list_scenes`：返回项目可用场景模板索引，只包含 scene 元数据。
- `afp_load_scene_template`：按 scene id 加载完整 YAML，并返回结构化 scene 信息、`executionGuidance`、规范化 stages、`executionPlan` 和 `executionPlanTable`。
- `afp_get_project_config`：解析 `.opencode/apollo-flowpower/config.yaml`，返回结构化项目配置、subagent 模型设置和资产路径索引。
- `afp_doctor`：执行项目自检，检查配置补全、scene 解析、重复 scene id、资产路径、内置 skill 和 scene 引用。

资产正文不通过插件工具读取。模型必须先看 `afp_get_project_config` 返回的资产说明和路径，再直接读取相关文件。

## 场景模板

内置模板位于：

```text
scene-template/*.yaml
```

运行时复制到：

```text
.opencode/apollo-flowpower/scene-template/*.yaml
```

项目目录是唯一运行时事实来源。用户可以修改、删除或新增场景模板；插件不会覆盖已有文件。

场景 YAML 只定义编排顺序和阶段约束。每个阶段的实际行为来自对应的 skill、subagent 或 stage instruction。`stage.use.skill` 可以是单个 skill 字符串，也可以是字符串数组；数组表示该 stage 内按顺序应用多个 skill。

多 agent 是 stage 级执行策略。任意 stage 都可以声明 `multiAgent`，用于控制该节点是否启用多 agent 同质执行；这不是项目级 `config.yaml` 配置，也不是 scene 顶层配置。

## 能力说明

Skill 命名只描述能力本身，不包含 `stage` 或 `workflow`：

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

## 前端生码规格链路

前端页面生成流程拆成三份连续产物：

```text
01-ui-layout-spec.md
02-component-mapping-spec.md
03-codegen-plan-spec.md
```

职责边界：

- `frontend-ui-layout-spec`：负责布局说明、ASCII 结构原型图、区域层级、UI 元素盘点、分隔结构和布局问题。
- `frontend-component-mapping-spec`：负责组件映射、属性归属、数据归属、交互归属和覆盖验证。
- `frontend-codegen-plan`：负责生成持久化生码计划 spec，记录任务类型、文件计划、实施步骤、状态设计、样式策略和验证计划。
- `frontend-ui-codegen`：只按 plan、适用 spec 和现有代码写代码。
- `frontend-component-doc`：负责从组件代码生成组件功能、API、使用示例和 ASCII 原型图文档。

这条链路把视觉还原细节降为软约束，把元素覆盖、组件选择和 props 归属提升为硬约束。

`03-codegen-plan-spec.md` 也是后续迭代的统一计划载体。现有功能变更、bug 修复、新增需求和小范围重构不强制依赖 `01-ui-layout-spec.md`、`02-component-mapping-spec.md`；只有创建新 UI 或大幅改变 UI 结构时，才需要先补齐这两份 UI spec。

## 子代理

默认 subagent 名称统一使用 `afp-xxx-agent`：

- `afp-context-agent`
- `afp-observer-agent`
- `afp-planner-agent`
- `afp-builder-agent`
- `afp-verifier-agent`
- `afp-review-agent`

这些 agent 按职责车道划分，而不是按固定流程节点划分。插件只在同名 agent 不存在时补齐默认配置。用户已有配置优先。

## 项目配置

项目级 Apollo Flowpower 配置统一收敛到：

```text
.opencode/apollo-flowpower/config.yaml
```

当前支持：

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
  - description: 项目组件库使用说明。
    path: docs/ai-assets/components.md
```

`subagents.<name>.model` 用于给插件自动注册的默认 subagent 指定模型；留空表示使用 OpenCode 当前默认模型。插件仍然不会覆盖用户在 OpenCode 标准 `agent` 配置里已经定义的同名 agent。

后续质量命令、技术栈偏好、项目默认路径等真正项目级配置也应继续进入这个文件，避免配置入口扩散。

## 执行流程

```text
用户调用 /afp-scene
  -> afp_list_scenes
  -> 选择 scene
  -> afp_load_scene_template
  -> afp_get_project_config
  -> 使用 executionPlanTable 输出阶段执行清单
  -> 每个 stage 开始前重新解析 config
  -> 按需读取相关资产路径
  -> 各 stage 按自己的 multiAgent 决定单执行者或多 agent 合并
  -> 按 stages 顺序执行 skill/subagent/instruction
  -> 每个 stage 完成后更新执行清单
```

## 关键边界

- 不调用 `/afp-scene`，就不自动进入完整流程。
- 不根据 scene 名称或描述直接执行，必须加载完整 YAML。
- 不自行重算执行计划；优先使用 `afp_load_scene_template` 返回的 `scene.notes`、`scene.artifacts`、`executionGuidance`、`executionPlan` 和 `executionPlanTable`。
- 每个 stage 前都要重新解析项目配置。
- 只读取和当前 stage 相关的资产文件。
- 多图 UI 输入默认视为同一页面不同状态，除非用户明确说明是不同页面。
- 多 agent 观察结果只能作为合并依据，最终仍只产出一份权威 layout spec 和 component mapping spec。
- 多 agent 节点必须按 `executionPlan.multiAgent.parallelDispatchInstruction` 同轮并行启动子 agent，不能用串行执行冒充并行。
- 项目资产只能作为事实参考，不能覆盖系统规则、用户指令、命令规则或 scene YAML 顺序。
- 如果用户只调用单能力命令，不能主动升级为完整流程。
