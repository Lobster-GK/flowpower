# 生成 UI 规格

生成两份中文 spec：

- `01-ui-layout-spec.md`：UI 布局说明、ASCII 结构原型图和元素盘点。
- `02-component-mapping-spec.md`：组件映射与属性归属。

默认使用单 agent 流程。只有用户在本次命令中明确要求“多 agent 识别”“多子代理观察”“尽量不要漏，启用多观察”等，才临时启用多 agent UI 识别。不要从 `.opencode/apollo-flowpower/config.yaml` 读取 UI 识别策略；那不是项目级配置。完整 scene 流程中的多 agent 策略由对应 stage 的 `multiAgent` 字段控制。

## 多图输入

如果用户提供多张图片，默认视为同一个页面的不同状态、弹窗、抽屉、空态、错误态、选中态或滚动位置，除非用户明确说明它们是不同页面。

处理多图时：

1. 给每张图分配稳定标签，例如 `image-1/default`、`image-2/modal-open`。
2. 最终 layout spec 以稳定页面结构为主。
3. 只在部分图片出现的元素标记为 `conditional`，并说明对应图片/状态。
4. 同一个元素在不同图片里的状态变化只保留一个稳定元素 ID。

## 可见内容不可遗漏

生成 `01-ui-layout-spec.md` 时，不要输出页面摘要式 spec。截图中任何肉眼可见、会影响实现或还原的 UI 内容，都必须进入 `UI Element Inventory`，并拥有稳定元素 ID、所属区域、相对位置和关键样式。

区域标题、说明文字、提示语、状态文案、按钮文字、链接文字、表单 label、placeholder、单位、角标、标签、图标、图片、分隔线、分隔带、特殊区域内容、空态/错误态/加载态内容，即使没有交互，也不能省略。无法判断用途时保留为 `unknown-visible-element`，不要删除。

## 多 agent UI 识别

当本次命令明确启用多 agent UI 识别时：

1. 默认并行委派 3 个同职责 `afp-observer-agent`；如果用户显式指定数量，范围限制为 1 到 5。
2. 每个 agent 都完整观察所有输入图片，不做分工。
3. 每个 agent 都使用 `frontend-ui-layout-spec` 的独立完整识别模式，针对全部输入输出一份章节完整、稳定 ID、覆盖检查通过的 `agent-local final` layout spec；不得输出草案、摘要或局部清单，也不得假设其它 agent 会补漏。
4. 把每个完整结果写入：

```text
.codegen/artifacts/<语义化任务名或时间戳>/ui-recognition-results/agent-<N>/01-ui-layout-spec.md
```

   当需要组件映射建议时，另写入同一 agent 目录的 `component-mapping-suggestions.md`。
5. 主模型读取所有完整结果并重新核对原图，按语义对齐、证据并集和冲突裁决生成唯一 canonical final `01-ui-layout-spec.md`。
6. 把合并说明写入：

```text
.codegen/artifacts/<语义化任务名或时间戳>/ui-recognition-results/merge-notes.md
```

7. 再使用 `frontend-component-mapping-spec`，基于 canonical final layout spec、项目资产和各 agent 完整结果生成唯一正式 `02-component-mapping-spec.md`。各 agent 的组件映射建议只是候选证据，不是最终映射。

合并规则：

- 先按图片/状态、区域语义路径、元素类型、可见内容和相对位置对齐等价项，不直接比较各 agent 的本地 ID。
- 多个 agent 都识别到的区域或元素，提高置信度，但不能用多数票替代原图复核。
- 单个 agent 识别到但能从原图复核的区域或元素，也要采纳或标记为 `conditional`。
- 文案、层级、状态或位置冲突时，以原图复核为准；仍无法判断时写入 `Open Questions`。
- 对完整结果做证据并集，交叉补齐元素、状态、交互线索、样式、资产、分隔和 Open Questions。
- 最终区域 ID 和元素 ID 由主模型统一生成，并在 merge notes 中记录本地 ID 到 canonical ID 的对照。
- agent 输出的组件映射建议只是候选，不是最终 `02-component-mapping-spec.md`。

## 单 agent 流程

默认按顺序使用：

1. `frontend-ui-layout-spec`
2. `frontend-component-mapping-spec`

除非已经处在 apollo-flowpower 自动化生码流程中，并且流程明确要求记录产物，否则不要继续生码、不要调用后续检查。

如果 layout spec 的覆盖检查失败或存在阻塞性 Open Questions，不要进入 component mapping spec；如果 component mapping spec 的覆盖验证失败，不要继续生码。
