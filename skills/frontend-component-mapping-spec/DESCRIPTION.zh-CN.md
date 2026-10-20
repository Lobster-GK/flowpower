# frontend-component-mapping-spec 描述

## 干什么用

用于生成或更新 `02-component-mapping-spec.md`。它基于最终 `01-ui-layout-spec.md` 的元素清单，把每个 UI 元素 ID 落到明确的实现承载者、导入来源、props/slot/children、数据归属、交互归属、状态/校验归属、样式 token 和资产处理方式，并为交互元素记录触发方式、默认组件行为、UI 状态变化、业务结果边界、证据来源和确认状态，最后做覆盖验证。

如果上游启用了多 agent UI 识别，它可以读取每个 agent 的完整 layout spec 和非权威组件映射建议，但最终映射必须以主模型合并后的 canonical final layout spec 元素 ID 为准。

## 什么时候用

- 已经有可用的 `01-ui-layout-spec.md`，准备进入生码计划前，需要锁定组件映射和属性归属。
- 多 agent 独立完整识别结果已经生成，需要把多个 agent 的组件建议与 canonical final layout spec 对齐。
- 需要明确表单 `label/name/options/rules`、表格 `columns/pagination/rowKey`、按钮、图标、Tabs、弹窗、抽屉、状态标签、分隔线和分隔带的实现契约。
- 多图输入中有状态特有元素，需要明确它们在组件、状态和交互上的承载方式。
- 页面存在按钮、表单、列表操作、分页、弹窗、刷新、重试或移动端手势，需要逐项检查默认组件交互、UI 状态变化和业务契约缺口。
- 需要在生码前确认 layout spec 中所有必须实现的元素都已经映射，没有遗漏。

## 什么时候不用

- 不用于生成 UI 布局盘点；没有 layout spec 或元素清单时，先使用 `frontend-ui-layout-spec`。
- 不用于直接写代码、生成生码计划、接口集成、lint、启动检查、运行时检查或视觉像素审查。
- 不用于发明 layout spec 中没有的字段、控件、交互、接口参数或业务数据。
- 截图或常见业务经验不能作为具体 API、路由、数据变更、权限规则或业务成功结果的唯一证据。
- layout spec 覆盖检查失败、元素 ID 不稳定或阻塞性 `Open Questions` 未解决时，不要硬猜组件。
