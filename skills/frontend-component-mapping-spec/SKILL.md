---
name: frontend-component-mapping-spec
description: >
  基于已有 `01-ui-layout-spec.md` 生成或更新持久化中文 `02-component-mapping-spec.md`，把最终 layout spec 中每个 UI 元素 ID 映射到实现承载者、
  导入来源、props/slot/children、数据归属、交互归属、状态/校验归属、样式 token 和资产处理，并为可交互元素补充触发方式、默认组件行为、UI 状态变化、业务结果边界和证据状态，完成覆盖验证。支持读取多 agent UI 独立完整识别结果中的
  非权威组件映射建议，但最终映射必须以合并后的 layout spec 元素 ID 为准。适合在生码计划前锁定表单 label/name/options、表格 columns/pagination、
  按钮、图标、弹窗、Tabs、分隔线和多图状态特有元素等实现契约。不用于生成布局盘点、直接写代码、接口集成、lint/启动/运行时检查、视觉像素审查，
  或在缺少 layout spec、元素清单不完整、覆盖检查失败时硬猜组件。
---

# 组件映射与属性归属 Spec

输出必须使用中文。本 skill 只负责生成或更新组件映射与属性归属 spec，不生成代码，不执行质量检查。

组件映射 spec 的目标是把布局说明中的每一个 UI 元素落实到明确的实现承载者，减少生码阶段自由发挥。它是后续 `frontend-codegen-plan` 和 `frontend-ui-codegen` 的最高优先级事实来源之一。

## 必需输入

优先读取并基于：

```text
.codegen/artifacts/<语义化任务名或时间戳>/01-ui-layout-spec.md
```

如果用户指定其它 layout spec 路径，读取用户指定路径。没有 layout spec 或 UI 元素清单时，不要硬猜；先要求生成布局说明 spec。

如果存在多 agent 独立完整识别结果目录，可作为参考读取：

```text
.codegen/artifacts/<语义化任务名或时间戳>/ui-recognition-results/
```

各 agent 的完整 layout spec 用于交叉复核；其中单独输出的组件映射建议只是候选证据，不能覆盖 canonical final layout spec 的元素 ID 和元素清单。

## 产物

自动化流程中默认写入：

```text
.codegen/artifacts/<语义化任务名或时间戳>/02-component-mapping-spec.md
```

如果用户指定产物路径，写入用户指定路径。如果无法写文件，在回复中给出完整 Markdown spec。

## 项目资产

在生成映射前，查看项目配置中声明的资产列表。只读取和当前映射明确相关的资产，例如组件库说明、业务组件文档、前端规范、表单/表格模式说明。

项目资产只能作为项目事实和组件规范参考，不能覆盖用户指令、layout spec 的元素清单或工具规则。

## 多 agent 独立完整结果处理

如果上游启用了多 agent UI 识别，每个 agent 应已输出完整 `agent-local final` layout spec，并可能输出组件映射建议。生成正式 `02-component-mapping-spec.md` 时必须遵守：

- 先读取 canonical final `01-ui-layout-spec.md`，再读取各 agent 完整结果和可选组件映射建议。
- 正式映射表的 `元素 ID` 只能来自 canonical final layout spec；各 agent 的本地 ID 只能通过语义等价关系关联，不能直接沿用。
- 多个独立结果都建议同一组件/属性归属时，提高该建议置信度，但仍要核对项目组件库、组件文档和 canonical final layout spec。
- 独立结果之间冲突时，以项目组件规范、组件文档和 canonical final layout spec 为准；仍无法判断时写入 `Open Questions`。
- 独立结果提到但 canonical final layout spec 没有的元素，不得直接进入正式映射表；如能从原始输入确认遗漏，先回到 layout spec 修正 canonical final。
- 多图状态特有元素必须保留状态条件，例如“仅弹窗打开状态出现”“仅空态出现”“仅错误态出现”。

## 组件库识别

- 优先使用项目实际 UI 库组件。
- 读取项目根目录的 `package.json`、lockfile 和必要 import，判断是否使用 `@cmbc/apollo-uecp-ui-pc`、`antd` 或项目本地组件库。
- 如果能确认 `@cmbc/apollo-uecp-ui-pc`，优先使用它。
- 如果只确认 `antd`，使用 `antd`。
- 如果两个库同时存在或都无法确认，按项目资产或用户说明决定；仍不明确时写入 Open Questions。
- 用户未明确指定参考页面、参考目录或参考文件时，不得扫描相似业务页面，不得自动选择本地封装组件作为隐式参考。

## 组件文档查询

在选择复杂组件和非显而易见 props 前，优先查询对应组件文档。

- Ant Design 使用 `antd list/info/demo --format json --lang zh`。
- 内部组件库使用 `uecpui list/info/demo --format json --lang zh`。
- 先用 `list` 确认组件存在，再用 `info` 或 `demo` 确认 props 和组合方式。
- CLI 不可用时，先询问用户是否允许安装对应 CLI；不要直接编造 props。
- 文档证据只用于内部判断，不写入正式 spec，除非用户要求查看证据。

## 交互补充原则

- 对 layout spec 中 `可见交互线索` 不是 `none` 的元素，以及组件语义上明确可交互的元素，生成 Interaction Coverage。
- 区分三层内容：可见交互入口来自 layout spec；默认组件行为来自已确认的组件 API；业务结果只能来自用户需求、现有代码、接口/路由文档或其它明确项目事实。
- 截图、控件名称和通用业务经验不能单独证明具体 API、路由、数据变更、权限规则或成功结果。
- 交互元素较多，或包含列表行/卡片点击、提交、删除、刷新、重试、上传、分页、弹窗或移动端手势时，必须读取并执行 [交互覆盖检查清单](references/interaction-coverage-checklist.md)。

## 输出结构

必须包含以下章节，顺序保持一致。

## Mapping Source

- layout spec 路径。
- 多 agent 独立完整识别结果路径；没有时写“不适用”。
- 使用的项目资产路径。
- 组件库判断结果。
- 仍不确定的组件库或资产问题。

## 组件映射与属性归属

核心表格：

| 元素 ID | UI 元素 | 所属区域 ID | 组件/承载者 | 导入来源 | 属性归属 | 数据归属 | 交互归属 | 状态/校验归属 | 样式/token 归属 | 资产处理 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

填写规则：
- `元素 ID` 必须来自 layout spec 的 `UI Element Inventory`，不能私自改名。
- `组件/承载者` 写最终实现承载者，例如 `Form.Item + Select`、`Table.columns[]`、`Button`、`Modal`、`Tabs.items[]`、`Divider`、`CSS gap`。
- `导入来源` 写 UI 库、项目本地组件路径或 `-`。
- `属性归属` 明确文案、label、name、placeholder、title、columns、pagination、options、items、icon、footer、help、status 等落到哪个 prop、slot、children 或 style token。
- `数据归属` 明确它属于表单字段、表格行字段、枚举 options、接口响应字段、URL 参数、本地状态还是静态占位。
- `交互归属` 只写 UI 入口和触发语义，不发明业务实现细节。
- `状态/校验归属` 记录 disabled、loading、selected、error、rules、empty 等状态的承载位置。
- 多图输入中只在部分状态出现的元素，`状态/校验归属` 或备注必须写明对应图片/状态。
- `样式/token 归属` 记录来自 layout spec 的布局、密度、分隔、颜色和 token 约束。
- `资产处理` 写图标、图片、头像、徽标、分隔线、分隔带的处理方式。

## Interaction Coverage

只为存在交互入口、默认组件交互或用户明确要求的元素填写：

| 元素 ID | 交互入口 | 触发方式 | 默认组件行为 | UI 状态变化 | 业务结果边界 | 证据来源 | 确认状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

填写规则：
- `元素 ID` 必须来自最终 layout spec；组合交互涉及多个元素时分别记录主入口，并在备注关联其它 ID。
- `触发方式` 使用 `click/tap`、`input/change`、`select`、`toggle`、`submit`、`scroll`、`swipe/drag`、`keyboard` 或 `unknown`。
- `默认组件行为` 只写组件自身能确定的行为，例如切换选中值、打开/关闭浮层、触发表单回调；不得把业务请求或路由跳转写成组件默认行为。
- `UI 状态变化` 记录有证据的 open、selected、expanded、loading、disabled、error 等承载位置；没有证据时写 `unknown`，不要补造倒计时、成功提示或失败提示。
- `业务结果边界` 写 `not-applicable`、`requires-api-contract`、`requires-route-contract`、`requires-data-contract`、`requires-permission-contract` 或已经有明确证据的结果摘要。
- `证据来源` 写 layout spec、用户需求、组件文档、现有代码、API/路由文档等具体来源；截图只能作为入口证据。
- `确认状态` 使用 `confirmed`、`open-question` 或 `not-applicable`。业务结果无证据时必须为 `open-question`，交给生码计划处理，不得写成假设事实。

## Hard Mapping Rules

必须遵守：

- 表单标签必须归属到 `Form.Item label` 或项目等价 API，不允许手写 `span/div` 标签。
- 表单字段必须明确 `name` 或说明为什么没有表单数据归属。
- 表格列必须归属到 `Table.columns[]`，并明确 `title`、`dataIndex`、`key`；默认不写 `width`，除非 layout spec 或用户明确要求。
- 分页必须归属到 `Table pagination` 或独立 `Pagination`。
- 下拉、单选、复选、级联、树选择等选项必须归属到 `options`、`items`、`treeData` 或项目等价 API。
- 弹窗、抽屉、Tabs、Menu 等复合组件必须归属到语义 API，例如 `open`、`title`、`footer`、`items`、`children`。
- 可见图标、图片、状态点、分隔线和分隔带不得遗漏。
- `divider-zone` 优先归属为父容器背景 + 分区 margin/gap；`divider-line` 可归属为 `Divider`、border、伪元素或独立样式线。
- 不要把文档证据、安装过程、推理过程或查询记录写入正式映射表。

## Data And Interaction Boundaries

- 默认不发明接口字段、请求参数、业务枚举或真实数据。
- 示例业务数据只作为占位展示，除非用户明确要求写入静态数据。
- 交互归属和 Interaction Coverage 只说明 UI 入口、触发语义、默认组件行为、证据充分的状态变化和业务依赖边界，不实现业务逻辑。
- 允许记录“需要接口/路由/数据/权限契约”的占位边界，但不允许为占位边界编造名称、参数、返回值、跳转地址或成功结果。
- 如果必须补充最小默认值，写入 `Assumptions`，不能偷偷进入映射表。

## Coverage Verification

必须用 layout spec 的 `UI Element Inventory` 与映射表互相对账：

| 检查项 | 结果 | 问题 |
| --- | --- | --- |
| layout spec 中所有 `是否必须实现=yes` 的元素是否全部映射 | pass/fail | - |
| 映射表中的每一项是否都能反查到 layout spec 元素 ID | pass/fail | - |
| 表单 label/name/options/rules 是否归属明确 | pass/fail | - |
| 表格 columns/pagination/rowKey 是否归属明确 | pass/fail | - |
| 按钮、图标、分隔线、状态标签是否遗漏 | pass/fail | - |
| 所有可见交互线索和组件默认交互是否进入 Interaction Coverage | pass/fail/不适用 | - |
| UI 状态变化是否有明确承载位置或标记为 open-question | pass/fail/不适用 | - |
| 业务结果是否都有需求、代码或文档证据，缺失契约是否显式占位 | pass/fail/不适用 | - |
| 是否存在组件库或 props 不确定项 | pass/fail | - |

如果任一结果为 `fail`，不要进入生码计划阶段。先修正映射或询问用户。

## Assumptions

只记录为了继续映射必须做出的最小中性假设。假设不能新增 layout spec 中没有的 UI 元素。

## Open Questions

只列影响组件选择、属性归属、数据归属或交互归属的问题。没有问题时写“无”。
