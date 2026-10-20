# 交互覆盖检查清单

只在页面存在交互元素时执行。清单用于发现遗漏，不得把常见交互当作当前页面事实。

## 证据优先级

1. 用户明确需求、接口/路由文档和现有代码可以证明业务结果。
2. 最终 layout spec 和多状态图片可以证明交互入口及已展示的 UI 状态变化。
3. 组件文档可以证明默认组件行为和合法 props/callback。
4. 通用业务经验只能用于提出 Open Questions，不能用于确认业务结果。

## 默认组件交互

- Button/Link/IconButton：确认点击入口和 callback 承载者；点击后的业务结果另行取证。
- Input/TextArea：确认输入/change、受控值、清空、禁用和可见校验状态。
- Select/Radio/Checkbox/Switch/DatePicker：确认选择或切换、值承载、选中和禁用状态。
- Tabs/Menu/Pagination/Table：确认切换、翻页、排序或筛选入口；请求参数和数据刷新规则需要业务证据。
- Modal/Drawer/Popover/Dropdown：确认打开、关闭、确认和取消入口，以及 open 状态归属。
- Form：确认 submit/reset 入口、校验承载和 submitting 状态；提交接口及结果反馈需要业务证据。

## 常见遗漏

- 返回、关闭、取消、清空、重置、搜索、筛选、排序、分页和刷新。
- 列表行、卡片、操作列、更多菜单、展开/收起和详情入口。
- 弹窗/抽屉打开与关闭、遮罩关闭、确认与取消。
- 提交、删除、上传、下载、重试、重新获取、加载更多和下拉刷新。
- hover、focus、selected、expanded、loading、disabled、error、success 等 UI 状态。
- 移动端滑动、长按、拖拽、轮播和软键盘触发；没有明确证据时保持 unknown。

## 业务边界

- 跳转详情、返回目标或打开外链需要路由契约。
- 查询、提交、删除、上传、下载、刷新和重试需要 API/数据契约。
- 按钮可见性、可用性和操作范围涉及角色时需要权限契约。
- 接口、路由、数据或权限契约缺失时只标记 `requires-*-contract` 和 Open Questions，不命名不存在的实现。
