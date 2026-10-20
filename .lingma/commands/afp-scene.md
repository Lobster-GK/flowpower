---
description: Apollo Flowpower 场景编排
---

# Apollo Flowpower 场景编排

Apollo Flowpower 场景编排模式。场景编排只在本次命令调用中生效，不要把它应用到普通 UI 修改、一次性调试，或后续未调用该命令的对话。


**行为边界：在未确认场景前禁止读取skill**

## 参数

- `scene=<scene-id>` 或 `workflow=<scene-id>`：加载并执行指定场景模板。
- 不指定 scene：查看所有场景模板，由模型选择最匹配场景；低置信度时询问用户。

## 场景模板

- 场景模板放置在 `.lingma/apollo-flowpower/scene-template` 目录

## 场景模板选择

- 如果用户指定了场景模板，则用用户指定的名称去匹配模板名称，有匹配上的则直接使用，如果未命中，则查看所有模板，寻找模板 id 和用户指定的模板可以匹配上的，
- 如果用户未指定场景模板，则查看所有模板，自行判断使用那个模板。

## 执行规则

1. 不要根据场景名称或 `description` 直接执行流程。
2. 如果没有任何 scene 能够高置信度匹配，请让用户选择 scene，不要硬猜。
3. 如果工具返回 YAML 错误、scene 不存在或 schema 不合法，必须停止执行并向用户报告。
4. YAML 只定义编排顺序。每个 stage 的具体行为仍由引用的 skill、subagent 或 stage instruction 决定。
5. `stage.use.skill` 可以是单个 skill 字符串，也可以是 skill 字符串数组；如果是数组，必须按数组顺序应用多个 skill。
6. 如果 stage 同时声明 `subagent` 和 `skill`，优先使用 subagent，并确保它使用对应的一个或多个 skill。
7. 如果指定的 subagent 不可用，在主模型中按顺序使用对应 skill，并说明 fallback 原因。
8. 严格按字面含义遵守 `requires`、`when`、`onFail` 和 `maxRetries`。
9. 如果当前 stage 声明 `multiAgent`，必须按该节点策略执行；没有声明时按普通单执行者流程。


## 场景信息说明

- `id`：唯一 scene id。
- `name`：展示名称。
- `description`：适用场景说明。
- `notes`：scene 特定约束。
- `match.intents`：用于意图匹配的标签。
- `match.requires`：所需输入，例如 `image`、`api-doc` 或 `error-report`。
- `artifacts`：产物路径约定。
- `stages`：按顺序执行的 stages。
- `stage.multiAgent`：当前 stage 的多 agent 执行策略，只影响该节点。
- `stage.use.skill`：stage 使用的 skill；可以是单个字符串，也可以是字符串数组。数组表示该 stage 需要按顺序应用多个 skill。
- `stage.use.subagent`：stage 优先委派的 subagent。
- `stage.instruction`：由主模型直接执行的轻量说明。
- `stage.requires`：stage 执行前置条件。
- `stage.output`：stage 预期产物。
- `stage.when`：stage 执行条件。
- `stage.onFail`：失败策略，例如 `fix-and-retry`。
- `stage.maxRetries`：重试次数上限。

## 执行清单

匹配并加载 scene YAML 后、执行第一个 stage 前，必须先输出一个待办列表式执行清单。后续每个 stage 完成、跳过或失败时，在该表基础上更新 `状态`、`使用资产` 和 `说明`。

表格必须包含六列：

| 状态 | 流程阶段 | 执行者 | 产物 | 使用资产 | 说明 |
| --- | --- | --- | --- | --- | --- |

填写规则：
- `状态`：只能使用 `running`、`done`、`skip`、`error`；未开始阶段状态留空。
- `流程阶段`：使用 stage `id`。
- `执行者`：如果 stage 声明 `use.subagent`，填写该 subagent；如果只有 `use.skill`，填写该 skill；如果 `use.skill` 是数组，按顺序用 `、` 连接；如果没有 `use`，填写 `主模型`。
- `产物`：优先使用 `executionPlan` 中的 `output` 和 `resolvedOutput`；如果没有显式 `output`，填写 `无显式产物`。
- `使用资产`：填写当前 stage 实际读取的项目资产 `path`；如果没有相关资产，填写 `-`。
- `说明`：优先保留 `executionPlan` 中的 `note`；这里可能包含 scene notes、stage instruction、requires、when、失败重试、多 agent 强约束和扩展字段；没有补充信息时填写 `-`。

**如果执行者有子agent和skill，则代表要求这个agent使用这个skill来完成阶段任务**
**必须严格遵守的约定：当你把任务委派给子agent执行时，你必须判断一下用户提供的信息以及前面流程的产物是否和当前stage的任务有关联，如果有关联你必须把这些信息传递给子agent，同时如果目标是生成spec，要求子agent必须把文档放在指定目录**

### 多子 agent 配置说明

任意 stage 都可以声明多 子agent 执行策略：

通用规则：

1. `enabled=true` 时才启用多 子agent；否则按普通单执行者流程。
2. `agentCount` 是并行 子agent 数量，必须在 1 到 5 之间。
3. `mode` 描述多 子agent 执行方式；当前内置模板使用 `same-role-observation`，表示多个同职责 子agent 看同一批输入。
4. `persistOutputs=true` 时，将每个 子agent 的草案和合并说明写入 `outputDir` 指定目录。
5. `options` 是该节点自己的扩展参数，只有对应 skill 或 stage instruction 能解释它。

### 多子 agent 强约束

- 如果 `executionPlan` 的某个 stage 带有 `multiAgent.parallelDispatchInstruction`，该说明是硬约束，必须原文保留到对应行的 `说明` 中，不能改弱、删减或摘要成“并行执行”。
- 执行该 stage 时，必须把任务拆成指定数量的完全独立子任务，并且必须在同一轮中同时启动指定数量的 subagent。
- 不要先等待任何一个 subagent 完成后再启动下一个。
- 每个 subagent 只负责自己的范围，不要互相依赖，每个 subagent 都必须独立交付完整结果。
- 如果当前运行环境无法同一轮同时启动这些 subagent，必须把 stage 标记为 `error` 并说明原因，不要用串行执行冒充并行。

### 执行清单规则

1. 初始清单中，第一个需要执行的 stage 标记为 `running`，后续未开始 stage 的状态留空。
2. 任一时刻只能有一个 `running` stage。
3. 严格按执行清单顺序推进；只有当前 stage 标记为 `done` 或 `skip` 后，才能进入下一个 stage。
4. 每完成、跳过或失败一个 stage，都必须重新输出更新后的执行清单。
5. 如果 stage 的 `when` 条件不满足，标记为 `skip`，并在说明中写明跳过原因。
6. 如果 stage 执行失败且声明 `onFail: fix-and-retry`，按 `maxRetries` 限制修复并重试；超过限制后标记为 `error` 并停止流程。
7. 如果 stage 执行失败且没有可用失败策略，标记为 `error` 并停止流程。



**特别说明：如果多agent执行结果需要会被汇总，则必须生成合并说明写入`<outputDir>/merge-notes.md`，内容描述清楚那个产物的那些内容被舍弃以及舍弃原因**
**重要声明：必须按节点顺序执行对应 skill 或子 agent。每完成一个节点后，必须回到总控流程表，更新状态并继续执行下一个节点。只有所有必要节点完成后，才允许输出最终总结**


## 子agent调用约束

调用任何子agent前，必须生成完整的任务规格交给子agent。

**严禁自由发挥生成任务规格交个子agent**

任务规格必须包含如下内容：

1.目标
  - 子agent最终要解决什么问题，输出什么东西，明确是输出一个实际文件还是返回一段文本
  - 如果目标是输出一个文件，必须明确告知子agent输出目录以及文件名
2.输入
  - 明确所有输入文件的绝对路径或相对路径
  - 需要用到的项目资产，例如开发规范、组件文档等
3.背景
  - 提供完成任务所需的背景
4.约束条件
  - 明确允许做什么
  - 明确禁止做什么
  - 如果指明了使用什么skill技能、mcp、文档等，必须明文写入约束条件，要求使用什么skill技能、mcp、文档等。
5.输出
  - 指定输出格式
  - 指定必须包含的内容

## spec生成约束

如果某个流程节点被要求生成对应spec，无论这个节点时主agent执行还是子agent执行，都必须严格遵循并生成对应spec。

## 场景执行约束

- 每完成一个场景节点后，必须回到执行清单，更新状态并显示输出最新的状态。
- 当用户执行场景流程时，如果配置了子agent，那么严格禁止你去读取图片内容，你只需要识别图片路径，并把路径交给子agent，识别图片这一步交给后续流程节点的子agent去做。
- 当要求某个子agent使用某个skill进行任务时，交给子agent的任务信息中必须明确说明使用那个skill，不允许让子agent自己去推测。
- 当某个节点依赖用户提供的说明、文档、文件且由子agent执行时，你必须把需要的说明、文档、文件明确的交给子agent。
