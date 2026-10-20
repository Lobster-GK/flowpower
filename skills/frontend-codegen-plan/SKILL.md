---
name: frontend-codegen-plan
description: >
  在前端写代码、改代码或修复错误之前生成/更新持久化中文 `03-codegen-plan-spec.md`，作为后续实施契约。支持 `new-ui`、`change-existing`、
  `bug-fix`、`new-requirement`、`refactor-small`，并基于用户目标、现有代码、错误证据、可选 UI specs 和项目资产，明确任务类型、事实来源、
  变更范围、File Plan、Implementation Steps、状态/数据/样式策略、业务交互契约、需求或错误到代码的映射、风险和验证方式。新 UI/大幅 UI 变更必须先有
  layout spec 与 component mapping spec；现有功能变更和 bug 修复优先读取相关代码和证据。不用于直接写代码、截图识别、组件映射、接口设计、
  lint/启动/运行时检查，或在目标范围、关键证据、阻塞问题未解决时编造计划。
---

# 前端生码计划 Spec

输出必须使用中文。本 skill 只生成或更新生码计划 spec，不写代码、不执行检查。

生码计划 spec 是前端代码变更前的持久化执行契约。它不仅用于从 UI spec 生成新页面，也用于现有功能变更、bug 修复、新增需求和小范围重构，避免后续上下文压缩后丢失目标、范围、证据和实施步骤。

## 任务类型

先判断本次计划属于哪一种任务类型，并写入 `03-codegen-plan-spec.md`：

- `new-ui`：新页面、新组件、截图还原或从文字生成全新 UI。必须优先读取 `01-ui-layout-spec.md` 和 `02-component-mapping-spec.md`。
- `change-existing`：修改已有功能、已有页面或已有组件。必须读取用户指定的目标文件；未指定时，先做最小范围定位。
- `bug-fix`：修复明确错误、异常、回归或行为不符合预期的问题。必须读取错误信息、复现步骤、相关日志或用户描述，并规划先分析再修复。
- `new-requirement`：在现有代码上新增需求或扩展能力。必须读取现有实现和需求边界，说明新增与复用的关系。
- `refactor-small`：小范围结构整理或可维护性改造。必须保持行为不变，并说明验证方式。

如果任务会创建全新可见 UI、重塑页面结构，或大幅改变已有 UI 的元素覆盖关系，必须先补齐或更新 layout spec 和 component mapping spec。普通文案、字段、校验、状态、交互或局部样式调整，不强制要求这两份 UI spec。

## 输入收集规则

- 优先读取用户最新目标、用户指定路径、已有 `03-codegen-plan-spec.md`、相关现有代码、错误报告和项目资产。
- 如果用户指定了 spec 或计划路径，以用户指定路径为准。
- 如果没有指定目标文件，先基于路由、页面名、组件名、报错栈、测试名或关键词做最小范围定位；仍无法定位时再询问用户。
- 每个阶段都要参考 `afp_get_project_config` 返回的资产列表，只读取和当前任务明确相关的资产正文。
- 不要为了写计划而全量扫描项目；只读取能支撑计划决策的最小文件集合。
- 没有接口文档时，不要发明请求参数、响应字段或真实业务数据。
- 读取 component mapping spec 的 Interaction Coverage，并用用户需求、现有代码、接口/路由文档核对业务结果。截图和组件默认行为只能证明交互入口或 UI 行为，不能单独证明业务结果。

## 类型化输入要求

| 任务类型 | 必需输入 | 可选输入 | 缺失时处理 |
| --- | --- | --- | --- |
| `new-ui` | 用户目标、目标目录或 route、layout spec、component mapping spec | 参考图、项目组件资产 | UI spec 缺失或覆盖失败时停止，要求先补齐 |
| `change-existing` | 变更目标、相关现有文件或定位策略 | layout/component mapping spec、设计稿、资产文档 | 目标不明确时先定位；定位失败再询问 |
| `bug-fix` | 错误现象、复现路径、日志/堆栈/失败命令或可检查文件 | 相关测试、截图、历史计划 | 证据不足但可定位时先规划诊断步骤；完全无法定位时询问 |
| `new-requirement` | 新需求描述、现有实现入口或目标模块 | UI spec、接口文档、资产文档 | 需求边界不清时列阻塞问题 |
| `refactor-small` | 重构目标、目标文件、保持不变的行为 | 测试命令、规范资产 | 行为边界不清时停止 |

## 产物

默认写入：

```text
.codegen/artifacts/<语义化任务名或时间戳>/03-codegen-plan-spec.md
```

必须优先写入文件。如果用户指定产物路径，写入用户指定路径。如果当前环境无法写文件，才允许在回复中给出完整 Markdown 生码计划 spec，并明确说明未能持久化的原因。

## 输出结构

必须包含以下章节，顺序保持一致。

## Inputs

- 任务类型。
- 用户目标。
- 目标范围：目录、route、组件、文件、测试、报错入口或定位策略。
- 证据来源：用户描述、错误日志、现有代码、spec、资产路径。
- UI specs：layout spec 路径、component mapping spec 路径；不适用时写“不适用”并说明原因。
- 使用的项目资产路径。
- 计划产物路径。

## Readiness Check

| 检查项 | 结果 | 问题 |
| --- | --- | --- |
| 任务类型是否明确 | pass/fail | - |
| 用户目标和非目标是否明确 | pass/fail | - |
| 目标文件、目标目录或定位策略是否明确 | pass/fail | - |
| 相关现有代码或证据是否可读 | pass/fail | - |
| 项目资产是否已按需评估 | pass/fail | - |
| 涉及新 UI/大幅 UI 变更时，layout spec 是否存在且可读 | pass/fail/不适用 | - |
| 涉及新 UI/大幅 UI 变更时，component mapping spec 是否存在且可读 | pass/fail/不适用 | - |
| 涉及新 UI/大幅 UI 变更时，component mapping 覆盖验证是否通过 | pass/fail/不适用 | - |
| 本轮要求可用的关键交互是否已有业务结果及 API/路由/数据/权限证据 | pass/fail/不适用 | - |
| bug 修复是否已有证据或可执行诊断路径 | pass/fail/不适用 | - |
| 是否仍有阻塞性 Open Questions | pass/fail | - |

任一阻塞项为 `fail` 时，停止，不要生成实施计划。只输出缺失信息、建议补充的证据或建议先执行的 spec 阶段。

## Change Scope Plan

说明本次变更边界：

| 项 | 内容 |
| --- | --- |
| 任务类型 | `new-ui` / `change-existing` / `bug-fix` / `new-requirement` / `refactor-small` |
| 修改范围 | 文件、组件、页面、route、状态、接口或样式范围 |
| 不修改范围 | 明确不会碰的模块、行为、接口或视觉细节 |
| 主要事实来源 | spec、现有代码、错误日志、资产文档或用户需求 |
| 成功标准 | 生码或修复完成后的可观察结果 |

## File Plan

列出计划创建、修改或只读参考的文件：

| 文件 | 动作 | 目的 | 主要内容 | 依据 |
| --- | --- | --- | --- | --- |

动作只能是 `create`、`update`、`read-only` 或 `skip`。`bug-fix` 和 `change-existing` 必须优先列出现有文件；不要在没有依据时新建并行实现。

## Implementation Steps

把实施拆成可执行步骤：

| 步骤 | 状态 | 操作 | 输入 | 输出 | 停止条件 |
| --- | --- | --- | --- | --- | --- |

初始状态统一写 `pending`。步骤必须能直接指导 `frontend-ui-codegen` 或修复实施者按顺序工作。

## Component Decomposition

如果任务涉及新 UI、组件拆分或组件结构变化，说明页面或组件拆分：

| 组件 | 文件 | 对应区域/元素/需求 | 职责 | props/children |
| --- | --- | --- | --- | --- |

不涉及 UI 结构变化时，写“不适用”，并说明本次变更落在现有组件或逻辑中。

## State And Data Plan

说明本次任务涉及的状态和数据：

- 表单状态、表格数据、loading、empty、error、selected、modal open 等 UI 状态。
- 新增或修改的字段、枚举、静态占位和默认值。
- bug 修复涉及的数据流、边界条件和错误状态。
- 接口预留边界；没有接口文档时不得发明请求参数或响应字段。

## Business Interaction Contract Plan

对本次范围内的交互逐项记录；纯静态页面写“不适用”。

| 元素 ID/需求 | 触发方式 | 交互语义 | 预期业务结果 | API/路由/数据/权限依赖 | UI 状态变化 | 证据来源 | 确认状态 | 实现边界 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

填写规则：
- 新 UI 优先继承 component mapping spec 的 Interaction Coverage；现有功能变更、bug 修复和新增需求以现有代码与用户需求为主。
- `预期业务结果` 只能来自用户需求、现有代码、接口/路由文档或其它明确事实。只有截图或通用经验时写 `TBD`。
- `API/路由/数据/权限依赖` 写已经确认的契约或 `requires-*-contract`，不得编造接口名、字段、参数、地址、权限码或响应结构。
- `UI 状态变化` 明确 loading、disabled、selected、open、error、success 等状态的触发和结束条件；没有证据时写 `TBD`。
- `确认状态` 使用 `confirmed`、`open-question` 或 `not-applicable`。
- 本轮要求实现真实业务行为时，关键交互存在 `open-question` 必须使 Readiness Check 失败；用户明确只要求视觉壳或静态原型时，可以标记 `not-applicable`，但实现不得伪造业务成功结果。
- 业务契约占位默认只保留在 spec 中。只有计划明确要求暴露 callback、service 或 route 接入边界时，才允许在代码计划中创建对应边界；不得生成假成功、假删除或假跳转。

## Mapping And Contract Plan

根据任务类型选择一种写法。

新 UI 或大幅 UI 变更时，把组件映射落实到代码：

| 元素 ID | 组件/承载者 | 目标文件/组件 | 实现方式 | 注意事项 |
| --- | --- | --- | --- | --- |

现有功能变更、bug 修复或新增需求时，把需求或错误映射到代码：

| 需求/错误/行为 | 目标文件/函数/组件 | 计划修改 | 契约或边界 | 验证点 |
| --- | --- | --- | --- | --- |

每个必须实现的 UI 元素、需求点或错误点都必须能追溯到目标文件或组件。

每个确认要实现的交互还必须能反查到 Business Interaction Contract Plan；纯组件默认交互可以标记业务结果 `not-applicable`。

## Styling Plan

如果任务涉及 UI 或样式，说明：

- 样式文件或 token 文件。
- 布局方式。
- 分隔线/分隔带实现。
- 响应式策略。
- 哪些视觉细节作为软约束留给后续微调。

不涉及样式时，写“不适用”。

## Verification Plan

列出代码生成或修复后应该运行的检查：

- 静态检查。
- 类型检查或构建。
- 单元测试、组件测试或相关失败用例。
- 启动检查。
- 浏览器运行时检查。
- 必要时 UI review。
- 已确认交互的触发、UI 状态变化、成功/失败路径和回归验证；契约未确认的交互不得通过伪实现制造通过结果。

只列和当前项目实际可用的检查，不要编造命令。bug 修复必须包含复现或回归验证方式；如果当前无法自动验证，说明人工验证步骤。

## Risks And Assumptions

记录：

- 仍存在的非阻塞假设。
- 需要用户后续确认的视觉、需求或接口细节。
- Business Interaction Contract Plan 中仍为 `open-question` 的非阻塞交互，以及为什么本轮允许不实现其业务结果。
- 不影响首轮实施的风险。
- 如果计划只包含诊断步骤，说明进入修复实施前需要补充什么证据。

## Codegen Instructions

给后续实施者的简短执行指令：

- 必须读取本生码计划 spec 文件。
- 必须按 `Implementation Steps` 顺序执行，不得跳步扩大范围。
- `new-ui` 或大幅 UI 变更必须同时读取 layout spec 和 component mapping spec，并以 component mapping spec 为 UI 契约来源。
- `change-existing`、`bug-fix`、`new-requirement` 和 `refactor-small` 必须以现有代码、错误证据和本计划的 File Plan 为主要依据，不强制要求 UI specs。
- 不得新增计划中没有的 UI 元素、字段、交互、接口参数、业务数据或额外重构。
- 必须按 Business Interaction Contract Plan 实现交互；`open-question` 或 `requires-*-contract` 不得被替换成猜测性 API、路由或假成功逻辑。
- 如果实现中发现计划不可执行，停止并报告，不要自行改写契约。
