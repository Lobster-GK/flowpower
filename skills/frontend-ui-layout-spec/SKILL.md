---
name: frontend-ui-layout-spec
description: >
  将一张或多张截图、UI 图片、文字 UI 需求或已有页面描述转换为持久化中文 `01-ui-layout-spec.md`。用于在组件映射和生码计划之前盘点页面区域、
  布局树、ASCII 结构原型图、所有肉眼可见 UI 内容、元素 ID、相对位置、关键样式、文案、视觉状态、可见交互线索、分隔结构、布局约束、视觉 token、资产、状态差异和覆盖检查。
  识别时按从上到下、从左到右、从外到里的固定顺序检查文字、图片、布局和层级，并显式记录页面状态覆盖。支持同一页面多状态图片，以及
  多 agent 独立完整识别模式：每个 agent 必须针对全部输入输出一份可独立验收、覆盖检查通过的 agent-local final layout spec，主模型再对多份完整结果做语义对齐、交叉补缺和冲突裁决，生成唯一 canonical final layout spec。不用于直接编写代码、
  接口集成、质量检查、普通图片描述、后端任务，或在已有 layout spec 足够明确时重复分析。
---

# UI 布局说明 Spec

输出必须使用中文。本 skill 主要负责生成或更新 UI 布局说明 spec，不生成代码、不执行质量检查。

普通模式下，不做最终组件映射、不归属 props。多 agent 独立完整识别模式下，每个 agent 输出完整 layout spec；当配置允许时，可以另行输出非权威组件映射建议，供后续交叉校验。正式组件映射仍由 `frontend-component-mapping-spec` 产出 `02-component-mapping-spec.md`。

布局说明 spec 的目标是让后续 `frontend-component-mapping-spec` 能够逐项对账页面元素，避免遗漏。它不追求像素级还原，重点是页面结构、完整元素清单、元素相对位置、关键样式、ASCII 结构原型图和可实现的布局约束。

核心原则：不要输出页面摘要式 spec。只要截图中肉眼可见，并且会影响实现、布局、还原或用户理解，就必须被编号、定位并描述关键样式；无法判断用途时保留为 `unknown-visible-element`，不要省略。

如果需要为本阶段指定模型，优先查看 `afp_get_project_config` 返回的 `subagents` 中 `afp-observer-agent.model`；为空时使用当前 OpenCode 会话默认模型。

## 产物

自动化流程中默认写入：

```text
.codegen/artifacts/<语义化任务名或时间戳>/01-ui-layout-spec.md
```

如果用户指定产物路径，写入用户指定路径。如果无法写文件，在回复中给出完整 Markdown spec。

## 输入边界

- 可以基于截图、UI 图片、文字 UI 需求或已有页面描述生成布局说明。
- 支持多图输入。除非用户明确说明是多个不同页面，默认把多张图片视为同一页面的不同状态、弹窗、抽屉、空态、错误态、选中态或滚动位置。
- 如果当前上下文中有 OpenCode 图片附件标记，例如 `[Image 1]`，直接基于附件识别，不要把它解析成本地路径。
- 多图输入时，必须给每张图分配稳定标签，例如 `image-1/default`、`image-2/modal-open`、`image-3/empty-state`；无法判断状态时写 `image-N/unknown-state`。
- 多图输入时，最终 spec 以稳定页面结构为主，状态特有元素标记为 `conditional`，并在备注中写明来自哪些图片。
- 不主动扫描相似业务页面；只有用户明确指定参考页面、目录或文件时，才允许读取对应范围。
- 如果存在影响布局判断的疑问，写入 `Open Questions`，不要硬猜。

## 识别流程

严格按以下顺序识别，不得先写摘要再凭印象补元素：

1. 为每张图片分配稳定图片/状态标签，区分稳定结构与状态特有内容。
2. 从上到下划分纵向区域；同层同排从左到右记录；每个区域从外层容器进入内层容器和叶子元素。
3. 先记录区域边界、层级和排列，再记录区域内所有可见元素；区域边界至少检查宽高策略、背景、内容范围、边框、内外边距。相邻区域共享同一条分隔线时只归属一次。
4. 对每个区域和关键元素检查四类事实：文字、图片/资产、布局、层级。文字检查内容和排版层级；图片检查尺寸倾向、比例、裁剪和排列；布局检查尺寸、间距、对齐和方向；层级检查嵌套、兄弟顺序和覆盖关系。
5. 对每个元素记录可见交互线索：标准控件可记录其输入、选择、切换、点击等表面语义；列表行、卡片、图片或容器只有存在明确视觉线索或用户要求时才记录为可交互。不得推断点击后的业务结果。
6. 识别图片中已出现的默认、空、加载、错误、提交、成功/失败等状态，再判断当前页面类型还存在哪些适用但未提供证据的状态。
7. 生成 Layout Wireframe、Layout Tree、UI Element Inventory 和状态表，最后执行 Layout Coverage Check。

当页面包含表单、列表、表格、分页、重复卡片、图片组、浮层、移动端手势或未完整展示的页面状态时，必须按需读取并执行 [视觉识别检查清单](references/visual-recognition-checklist.md)。不要把清单中的常见模式当作截图事实；只记录可见内容、用户明确要求或必须确认的不确定项。

## 可见内容不可遗漏

- 任何肉眼可见的 UI 内容都必须进入 `UI Element Inventory`，不要只写进页面摘要、区域名称、用途、备注或自然语言描述。
- 区域标题、说明文字、提示语、状态文案、按钮文字、链接文字、表单 label、placeholder、单位、角标、标签、图标、图片、分隔线、分隔带、特殊区域内容、空态/错误态/加载态内容，即使没有交互，也必须有独立元素 ID。
- 不要预设每个区域应有哪些元素；只根据当前截图或需求中真实可见、可推断的 UI 内容记录。
- 如果看得见但用途不明确，使用 `unknown-visible-element`、`unknown-text`、`unknown-icon`、`unknown-separator` 等语义保留，并在备注写明不确定原因。
- 每个元素至少描述三类事实：它是什么、它相对谁在哪里、它有哪些影响实现的关键样式。
- 相对位置不要求像素级坐标，但必须说明所属区域、在区域内的大致方位，以及和相邻元素的上下/左右/并列/嵌套/对齐/分组关系。
- 关键样式只记录影响实现和还原的特征，例如字号层级、字重、颜色倾向、背景/边框/分隔线、突出或弱化程度、选中/禁用/警示状态、密度和对齐方式。

## 多 agent 独立完整识别模式

当 scene template 或本次命令要求“多 agent 识别”“independent final”时，由多个同职责子 agent 并行使用本 skill。每个 agent 必须独立处理同一批全部输入，不按图片、区域、元素类型或页面状态分工，也不能读取其它 agent 的结果。

每个 agent 输出的是 `agent-local final`，不是草案。它必须：

- 完整包含本 skill“输出结构”规定的全部章节，并保持相同顺序。
- 使用稳定、唯一、final-quality 的区域 ID 和元素 ID；不得使用临时 ID。
- 独立覆盖全部输入图片、状态、可见元素、交互线索、布局约束、视觉 token、资产、状态表和 Open Questions。
- 独立执行 Layout Coverage Check；存在 `fail` 时先自行修正，无法修正时返回失败，不得把不完整结果交给主模型补写。
- 不得假设其它 agent 会发现或补充自己的遗漏。

当 `multiAgent.persistOutputs=true` 时，每个 agent 写入独立目录：

```text
.codegen/artifacts/<语义化任务名或时间戳>/ui-recognition-results/agent-<N>/01-ui-layout-spec.md
```

文件标题下可以增加 `agent-local-final`、agent 编号和输入图片标签等元信息，但正文必须使用完整正式输出结构。如果 `multiAgent.persistOutputs=false` 或无法写文件，必须在回复中返回完整 spec，不能返回摘要或观察清单。

当 `multiAgent.options.includeComponentMapping=true` 时，可以在同一 agent 目录额外写入：

```text
.codegen/artifacts/<语义化任务名或时间戳>/ui-recognition-results/agent-<N>/component-mapping-suggestions.md
```

组件映射建议必须使用该 agent 完整 layout spec 中的稳定元素 ID，但仍是后续正式组件映射的候选证据，不能替代 `02-component-mapping-spec.md`。

## 多 agent 交叉合并规则

主模型必须读取所有 `agent-local final`、重新核对原始输入，并生成唯一的 canonical final `01-ui-layout-spec.md`。不得选一份结果直接覆盖其它结果，也不得按多数票机械决定。

- 先按“图片/状态 + 区域语义路径 + 元素类型 + 可见文案/内容 + 相对位置”对齐语义等价项，不直接按各 agent 的 ID 比较。
- 多个 agent 都识别到的事实提高置信度；只有一个 agent 识别到的事实只要能从原图或需求复核，也必须进入 canonical final 或标记为 `conditional`。
- 对三份完整结果做证据并集，逐项交叉补齐区域、元素、状态、交互线索、样式、资产、分隔和 Open Questions。
- 文案、层级、位置、状态或样式冲突时，以原始输入复核为准；仍无法判断时保留不确定事实并写入 `Open Questions`。
- 合并 Page State Coverage，并按最终页面类型重新评估适用状态；不能把所有 agent 都未观察到某状态当作该状态不需要实现的证据。
- 语义对齐完成后统一生成 canonical 区域 ID 和元素 ID，并保证 Layout Wireframe、Layout Tree、UI Element Inventory、状态表和覆盖检查内部一致。
- 任一 agent-local final 的 Coverage Check 含 `fail` 时，先要求该 agent 修正或将其标记为无效结果；不能把失败结果当作完整答案参与合并。
- 组件映射建议只作为后续 `02-component-mapping-spec.md` 的候选证据，不得直接成为正式映射。
- canonical final 必须重新执行完整 Layout Coverage Check，不能沿用任一 agent 的检查结论。

当 `multiAgent.persistOutputs=true` 时，将语义对齐和取舍记录写入：

```text
.codegen/artifacts/<语义化任务名或时间戳>/ui-recognition-results/merge-notes.md
```

合并说明至少记录 `agent 编号`、`agent-local ID`、`语义等价键`、`canonical ID`、`采纳/合并/拒绝决定` 和 `证据理由`。

## 输出结构

必须包含以下章节，顺序保持一致。

## Page Summary

- 页面目标和主要任务。
- 主要区域数量和阅读顺序。
- 是否包含表单、表格、列表、弹窗、抽屉、导航、工具栏、分隔结构、空状态或异常状态。
- 多图输入时，说明图片数量、推测页面状态和状态间差异。
- 概括 Page State Coverage 中已观察、未观察、适用和待确认的状态。

## Layout Wireframe

用 ASCII 码绘制页面结构原型图。它是结构示意图，不是像素稿。

```text
+------------------------------------------------------+
| page-header                                          |
| title                                      actions    |
+------------------------------------------------------+
| filter-area                                          |
| status-filter  date-range          query-button reset|
+------------------------------------------------------+
| table-area                                           |
| order-table                                          |
| columns: order-no | status | amount | action         |
|                                      pagination      |
+------------------------------------------------------+
```

绘制规则：
- 只表达主要区域、关键元素、相对位置和阅读顺序。
- 必须使用 Layout Tree 的区域 ID 和 UI Element Inventory 的元素 ID。
- 不表达精确像素、精确间距、颜色、阴影、圆角或真实比例。
- 页面复杂时，可以拆成多个 ASCII 图，例如 `主页面`、`弹窗打开状态`、`空状态`、`错误状态`。
- 多图输入时，先画稳定结构，再为状态特有元素单独画补充图或在图中标注 `conditional`。
- 图里的每个 ID 必须能在 Layout Tree 或 UI Element Inventory 中找到。
- 如果 ASCII 图与后续表格冲突，以表格为准，并在 Layout Coverage Check 中标记 `fail`。

## Layout Tree

用 Markdown 表格描述页面区域层级：

| 区域 ID | 父级区域 | 区域名称 | 用途 | 子区域/元素 | 排列方式 | 横向位置 | 尺寸策略 | 分隔/背景 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

填写规则：
- `区域 ID` 使用稳定 kebab-case，例如 `page-root`、`filter-area`、`table-area`。
- `排列方式` 只能写明确布局语义，例如 `flex-column`、`flex-row`、`grid`、`absolute`、`unknown`。
- `横向位置` 必须明确为 `left`、`center`、`right`、`space-between`、`full-width`、`mixed` 或 `unknown`。
- `尺寸策略` 描述相对宽高、是否铺满、是否固定高度、是否自适应、是否需要滚动。
- `分隔/背景` 记录灰色分隔带、细线、卡片背景、页面底色露出等实现相关信息。

## UI Element Inventory

用 Markdown 表格盘点所有可见元素：

| 元素 ID | 所属区域 ID | 元素类型 | 可见文案/内容 | 视觉状态 | 可见交互线索 | 位置关系 | 关键样式 | 是否必须实现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

填写规则：
- `元素 ID` 必须稳定、唯一、kebab-case，例如 `order-status-filter`、`query-button`、`order-no-column`。
- `元素类型` 写 UI 语义，不写具体组件库组件，例如 `section-title`、`helper-text`、`form-field`、`button`、`table-column`、`tab`、`divider-line`、`divider-zone`、`icon`、`image`、`status-tag`、`unknown-visible-element`。
- `可见文案/内容` 精确记录能看到的文字；不确定时写 `uncertain:<原因>`。
- `视觉状态` 记录默认、禁用、选中、错误、加载、空状态等。
- `可见交互线索` 只记录表面交互语义，例如 `click/tap`、`input`、`select`、`toggle`、`scroll`、`swipe/drag`、`unknown` 或 `none`。标准按钮、输入框和选择控件可按控件语义记录；列表行、卡片和普通容器没有明确证据时必须写 `unknown` 或 `none`。
- 截图只能证明交互入口或视觉状态，不能证明点击后的路由、接口、数据变更、权限判断或业务成功结果；这类内容不得进入 layout spec。
- `位置关系` 描述它和相邻元素、父区域、分组的关系；不能只写“在某区域内”，必须说明大致方位或相邻关系。
- `关键样式` 记录影响实现和还原的样式事实，例如字号层级、字重、颜色倾向、背景、边框、分隔线、标签形态、图标尺寸倾向、突出/弱化程度、对齐和密度；没有明显样式时写 `normal`。
- `是否必须实现` 使用 `yes`、`no` 或 `conditional`。
- 区域标题、说明文案、提示语、状态文案、图标、分隔线和特殊区域内容不得只出现在 Layout Tree、Layout Wireframe、Layout Constraints 或备注中；它们必须作为独立元素进入本表。

## Layout Constraints

按强度分级记录布局约束：

- 硬约束：元素不能遗漏、区域层级、表单/表格/弹窗结构、显式分隔线、按钮组关系。
- 中约束：对齐方向、密度、相对间距、响应式行为、滚动区域。
- 软约束：像素级间距、阴影、颜色细微差异、完全视觉一致。

## Visual Tokens

只记录对实现有帮助的 token：

- 主色、背景色、边框色、状态色。
- 字体层级、控件高度、圆角、阴影、密度。
- 区块内边距、区块间距、表单行距、表格和分页间距。

## Assets And Separators

列出图片、图标、头像、徽标、状态点、分隔线、分隔带等可见资产或分隔结构。

如果无法确认具体图标或图片，保留为独立元素，不要删除。说明建议占位尺寸、颜色倾向和所在区域。

## Image State Matrix

多图输入时必须填写；单图或纯文字输入时写“不适用”。

| 图片 | 推测页面状态 | 稳定元素 | 状态特有元素 | 状态变化说明 |
| --- | --- | --- | --- | --- |

同一元素在不同图片中状态不同，例如选中、禁用、错误、加载、空态、弹窗打开，应只保留一个稳定元素 ID，并在 `视觉状态` 或备注中说明状态来源。

## Page State Coverage

必须填写当前页面类型的状态覆盖；不要因为只收到默认态截图就默认其它状态不存在。

| 状态 | 图片/需求证据 | 是否已观察 | 是否需要实现 | 处理 |
| --- | --- | --- | --- | --- |

填写规则：
- 至少评估默认/有数据、空态、加载态和错误态；表单或提交型页面再评估提交中、成功和失败状态。
- `图片/需求证据` 写图片标签、文字需求或“无直接证据”。
- `是否已观察` 使用 `yes` 或 `no`；`是否需要实现` 使用 `yes`、`no` 或 `unknown`。
- 已观察状态必须落实到稳定元素或 `conditional` 元素；未提供视觉证据的状态不得虚构具体 UI。
- 某状态可能适用且会影响元素清单、区域层级或后续组件映射时，将具体问题写入 `Open Questions`；明确不适用时写明理由，不要机械询问用户。

## Layout Coverage Check

用表格自查布局盘点是否完整：

| 检查项 | 结果 | 问题 |
| --- | --- | --- |
| 是否按从上到下、从左到右、从外到里的顺序完成识别 | pass/fail | - |
| 主要区域是否全部进入 Layout Tree | pass/fail | - |
| 每个主要区域是否检查文字、图片/资产、布局、层级四类事实 | pass/fail | - |
| 区域边界、内外边距和共享分隔线归属是否明确 | pass/fail | - |
| Layout Wireframe 中的区域/元素 ID 是否都能在表格中反查 | pass/fail | - |
| Layout Wireframe 是否与 Layout Tree 和 UI Element Inventory 一致 | pass/fail | - |
| 可见元素是否全部进入 UI Element Inventory | pass/fail | - |
| 所有肉眼可见内容是否都被编号、定位并描述关键样式 | pass/fail | - |
| 分区标题、说明文案、提示语、特殊区域文字是否作为独立元素记录 | pass/fail | - |
| 分隔线/分隔带/图标/状态标签是否单独记录 | pass/fail | - |
| 未知用途但可见的内容是否保留为 unknown 元素而不是删除 | pass/fail | - |
| 每个元素是否都有明确所属区域和相对位置 | pass/fail | - |
| 关键元素是否记录了影响实现的样式特征 | pass/fail | - |
| 所有标准控件和明确可交互元素是否记录可见交互线索，且未推断业务结果 | pass/fail | - |
| 适用的表单/列表/表格/分页/重复内容模式是否完成专项检查 | pass/fail/不适用 | - |
| 移动端页面是否检查安全键盘、下拉刷新、上拉加载、骨架屏和固定底部区域 | pass/fail/不适用 | - |
| Page State Coverage 是否覆盖适用状态，并将所有 `unknown` 转为明确结论或 Open Questions | pass/fail | - |
| 是否存在影响后续组件映射的不确定项 | pass/fail | - |

如果任一结果为 `fail`，必须先修正布局说明或询问用户，不要进入组件映射。

## Open Questions

只列真正会影响元素盘点、区域层级、布局关系或后续组件映射的问题。没有问题时写“无”。
