# 组件适配规范

## 目标

组件适配不是“截图元素对应哪个 UI 库组件”的分类表，而是评估组件能否在保留正确语义和行为的同时实现视觉契约。

当 source manifest 为 `executionScope=visual-lab` 时，本版本只使用 `native-html` 和 `generated-ui.css`。此时 `component` 填原生标签或本地组合结构，`decision` 使用 `headless-or-native`；不要查询、导入或模拟目标项目 UI 库。下面的 UI 库决策矩阵只适用于未来非沙箱版本，不在当前工作流执行。

使用 `assets/component-adaptation.template.json` 作为起点。

## 评分维度

每个映射记录两个独立分数，范围为 0 到 1：

- `semanticFit`：API、可访问性、交互、数据归属是否匹配。
- `styleCompatibility`：目标 DOM 结构、尺寸、密度、排版和表面样式能否低风险实现。

不能用高语义分数抵消低视觉分数。

## 决策矩阵

| 语义适配 | 视觉兼容 | 推荐策略 |
| --- | --- | --- |
| 高 | 高 | `use-library-as-is` 或少量 token |
| 高 | 中 | `use-library-with-overrides`，列出所有覆盖入口 |
| 高 | 低 | `headless-or-native` 或只复用行为层 |
| 中 | 高 | 检查是否牺牲语义；通常添加语义包裹 |
| 低 | 任意 | `custom-wrapper` 或重新选择组件 |

## 必需字段

每个 mapping 至少包含：

- `elementId`
- `component`
- `source`
- `composition`
- `semanticFit`
- `styleCompatibility`
- `decision`
- `behaviorOwnership`
- `dataOwnership`
- `styleOwnership`
- `requiredOverrides`
- `overrideEntrypoints`
- `acceptancePolicy`
- `visualRisks`
- `evidence`

`requiredOverrides` 必须使用可实现字段，例如：

```json
{
  "headerHeight": 44,
  "rowHeight": 52,
  "cellPaddingInline": 16,
  "borderColor": "color.border.subtle",
  "paginationMarginTop": 20
}
```

不要写“调整成紧凑样式”。

`acceptancePolicy` 不是豁免单，而是该组件的局部验收契约。它必须声明：

- `profile`：默认 `component-faithful`；
- bbox 位置/尺寸容差与最低 IoU；
- 字号、行高和字重容差；
- `allowedLibraryVariations`：具体属性、原因、上限或不变量；
- `nonNegotiable`：存在、可见、内容、状态、无溢出、无遮挡。

原始像素抗锯齿、图标路径或圆角插值可以是允许差异；整表高度、列对齐、分页位置、文本换行和交互状态不能用“组件库默认如此”豁免。完整规则见 [组件感知验收协议](component-aware-acceptance.md)。

## 复合组件

表格、表单、Tabs、Menu、Modal 等组件必须同时描述：

- 语义子部件归属；
- 内部 DOM 是否妨碍目标布局；
- 哪些视觉参数可由公开 token/API 控制；
- 哪些需要局部 class 或 wrapper；
- 哪些覆盖依赖不稳定的内部选择器。

分页与表格同时出现时，可以保持 `Table.pagination` 的归属，但必须单独映射可见分页区域，并明确它的高度、对齐、间距和字体由哪个入口控制。

## 覆盖优先级

按以下顺序选择样式入口：

1. 项目 design token 或 UI 库主题 token；
2. 组件公开 size、variant、classNames、styles 等 API；
3. 页面范围内的稳定 wrapper/class；
4. 受控的局部 CSS 选择器；
5. 最后才考虑依赖库内部 DOM 的深层选择器。

不要使用全局 `!important` 修复局部差异。依赖内部类名的覆盖必须记录 `fragile-internal-selector` 风险。

## 样式所有权

明确每一层由谁控制：

- 页面/区域几何：页面布局容器；
- 组件自身密度和表面：主题 token 或组件样式 API；
- 数据和交互：组件 props/state；
- 跨组件间距：父容器，不塞进子组件内部 margin；
- 文本排版：最近的语义文本节点或组件 typography API。

避免同一视觉属性在 token、组件 prop 和页面 CSS 三处同时声明。

## 阻塞条件

以下情况不得直接进入生码：

- 关键组件 `styleCompatibility < 0.5` 且仍选择原样使用；
- 必需覆盖没有可确认入口；
- 为匹配视觉必须破坏键盘操作、label 关联或基础可访问性；
- mapping 指向 visual contract 中不存在的 element ID；
- 低置信度视觉字段被包装成确定的组件默认值。
