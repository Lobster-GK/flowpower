# Layout Spec 输出结构

先输出一个一级文档标题，例如 `# UI Layout Spec`，再按以下顺序使用**无编号的二级标题**生成中文 `01-ui-layout-spec.md`。章节标题必须写成 `## Spec Metadata`，不得写成 `# 1. Spec Metadata` 或 `## 1. Spec Metadata`。项目已有兼容 schema 时保留其必需字段，同时补入证据、置信度和覆盖信息。

## 目录

1. Spec Metadata
2. Change Summary
3. Page Summary
4. Source And Evidence Index
5. Layout Wireframe
6. Layout Tree
7. UI Element Inventory
8. Repeated Content Patterns
9. Layout Constraints
10. Visual Tokens
11. Assets And Separators
12. Image And Viewport Matrix
13. Page State Coverage
14. Layout Coverage Check
15. Open Questions

## Spec Metadata

| 字段 | 值 |
| --- | --- |
| schema_version | `1.2` |
| analysis_profile | `structure` / `standard` / `precision` |
| mode | `create` / `update` |
| artifact_root | 本次产物目录 |
| previous_spec | 更新模式填写旧 spec；否则“不适用” |
| generated_at | ISO 8601 时间 |

`structure` 仍保留全部章节；不适用的精确测量、视觉 token 或图片矩阵写“不适用”，不要删除章节。

## Change Summary

更新模式填写；创建模式写“不适用”。

| 变更类型 | 区域/元素 ID | 旧值/状态 | 新值/状态 | 来源证据 | 说明 |
| --- | --- | --- | --- | --- | --- |

变更类型使用 `added`、`modified`、`conditional`、`deprecated`、`conflict`。语义未变化的元素必须保留原 ID。

## Page Summary

记录页面目标、主要任务、区域数量和阅读顺序；说明是否包含表单、表格、列表、导航、工具栏、浮层、分隔结构、响应式 viewport 或异常状态。多输入时概括状态和 viewport 差异。

## Source And Evidence Index

### Source Input Register

| 来源标签 | 来源 | 输入类型 | 尺寸 | SHA-256 | 图片类型 | viewport | 推测状态 | 可脚本测量 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

- 图片使用 `image-N/<viewport>/<state>`。
- 本地图片路径真实存在时，`可脚本测量` 必须写 `yes`；不得因依赖未安装而降成 `no` 并继续生成 spec。
- 长图切片使用 `image-N/slice-NN/y<start>-<end>`。
- 拼图派生输入使用 `image-N/state-NN/<state>`。
- 纯文字或已有描述使用 `request-N/provided`。
- 会话附件无本地路径时，SHA-256 写“不适用”，`可脚本测量` 写 `no`。

### Region Evidence

| 证据 ID | 来源标签 | 证据文件 | 区域 ID | 网格配置 | 网格/裁剪范围 | 原图偏移 | 放大倍数 | 提取内容 | 置信度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

- 证据 ID 使用稳定 kebab-case，例如 `evidence-image-1-header`。
- 图片证据文件使用 artifact 根目录内的相对路径，例如 `visual-evidence/image-1/tiles/r01-c01.png`；文件必须真实存在且非空。
- 纯文字或无本地路径的会话图片将证据文件写为“不适用”，不得伪造文件路径。
- 网格配置记录 `6x8` 等实际值；同一来源的 grid/cut/pick 必须一致。
- 长图切片填写原图 y 偏移。
- 纯文字输入的网格、范围、偏移和放大倍数写“不适用”，方法标为 `provided`。

### Tile Inspection Log

每个 `可脚本测量=yes` 的来源必须填写一行；纯文字和无本地路径的会话附件不填写。

| 来源标签 | Manifest 文件 | Tile 总数 | 已检查 Tile | 未检查 Tile | 边界复检 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |

- Manifest 文件使用 artifact 根目录内相对路径，例如 `visual-evidence/image-1/manifest.json`。
- Tile 总数必须与 manifest 一致。
- 全部逐张检查后将已检查 Tile 写为 `all`，或完整列出 manifest 中的全部 ID。
- 未检查 Tile 必须为 `0`；边界复检使用 `pass` 或确实无跨边界内容时使用“不适用”。
- 未完成全覆盖时结果必须为 `fail`，不得生成最终 spec。

### Visual Measurements

| 测量 ID | 对象 ID | 字段 | 值 | 方法 | 来源证据 | 置信度 | 复检状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

方法使用 `pixel-pick`、`dominant-colors`、`visual-level`、`grid-estimate`、`provided` 或 `inferred`。`low` 必须标记 `reviewed` 或 `pending`；复检后仍不确定时进入 Open Questions。

每个可脚本图片必须在独立来源目录保存 manifest schema 1.1 的 `manifest.json`，记录原图路径和 SHA-256、尺寸、按轴分档策略、重叠度、二维 tile、原图 bbox、派生文件路径及 SHA-256。默认分档为每个轴 `<=320:1`、`<=900:2`、`<=1600:3`、`<=2400:4`、更大时使用 640px 固定窗口；宽高必须独立计算。默认重叠度为 20%，仅在任务明确需要时覆盖。验证器会检查策略、文件存在性、哈希、行列数量、manifest 声明的重叠度和完整覆盖。

## Layout Wireframe

使用 ASCII 表达主要区域、关键元素、相对位置和阅读顺序。只使用后续表格中存在的稳定 ID，不表达精确像素、颜色或真实比例。复杂状态或 viewport 可使用补充图。

## Layout Tree

| 区域 ID | 父级区域 | 区域名称 | 用途 | 子区域/元素 | 排列方式 | 横向位置 | 尺寸策略 | 分隔/背景 | 来源证据 | 生命周期 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

- ID 使用稳定、唯一的 kebab-case。
- 排列方式使用 `flex-column`、`flex-row`、`grid`、`absolute` 或 `unknown`。
- 横向位置使用 `left`、`center`、`right`、`space-between`、`full-width`、`mixed` 或 `unknown`。
- 尺寸策略说明铺满、固定/自适应、滚动和宽高倾向。
- 生命周期使用 `active`、`conditional` 或 `deprecated`。
- 共享分隔线只归属一个实现位置。

## UI Element Inventory

| 元素 ID | 所属区域 ID | 元素类型 | 可见文案/内容 | 视觉状态 | 可见交互线索 | 位置关系 | 关键样式 | 来源证据 | 置信度 | 生命周期 | 是否必须实现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

- 元素类型使用 UI 语义，不使用具体组件库名称。
- 精确记录非重复元素的可见文案；不确定时写 `uncertain:<原因>`。
- 交互线索只记录 `click/tap`、`input`、`select`、`toggle`、`scroll`、`swipe/drag`、`unknown` 或 `none`。
- 位置关系必须说明方位、相邻、并列、嵌套、对齐或分组关系。
- 生命周期使用 `active`、`conditional` 或 `deprecated`。
- `是否必须实现` 使用 `yes`、`no` 或 `conditional`。
- 标题、提示、图标、状态标签、图片、分隔线和未知可见内容必须是独立元素。
- `high` 或 `medium` 的图片结论必须引用有实体证据文件的 evidence；无法确认用途的可见内容使用中性类型或 `unknown-*`，不得按常见 UI 模式补猜。
- 同一控件的 submitting、loading、disabled、selected、hover 和 error 状态复用原元素 ID，在 `视觉状态`、状态矩阵或备注中记录；不要创建 `<element-id>-submitting` 等状态副本。

## Repeated Content Patterns

不存在重复内容时写“不适用”。

| 模式 ID | 所属区域 ID | 类型 | 可见数量 | 子结构/字段 | 记录粒度 | 代表项/差异 | 来源证据 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

记录粒度：

- `all-visible`：precision 档位，记录全部清晰可见实例。
- `representative`：standard 档位，记录结构、数量及覆盖视觉差异的代表项。
- `structure-only`：structure 档位，只记录重复模式和必要字段。

重复实例只有在状态、样式、内容形态或交互存在实现差异时才分配独立永久 ID。

## Layout Constraints

按强度记录，并注明来源证据：

- 硬约束：不可遗漏元素、区域层级、表单/表格/浮层结构、显式分隔、按钮组关系。
- 中约束：排列方向、对齐、密度、相对间距、响应式行为、滚动区域。
- 软约束：无可靠测量证据的像素级间距、阴影和细微颜色差异。

纯文字需求标为 `provided`；合理但未确认的选择标为 `inferred`。

## Visual Tokens

`structure` 档位或低保真输入可以写“不适用”。

| Token | 建议值/层级 | 原始测量 | 使用位置 | 来源证据 | 置信度 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |

记录颜色、字体层级、控件高度、圆角、阴影、密度和区块间距。不要仅因颜色接近就强行合并；保留 JPEG 压缩偏移和冲突说明。

## Assets And Separators

列出图片、图标、头像、徽标、状态点、分隔线和分隔带。无法确认身份时保留形态、尺寸倾向、颜色倾向、位置和来源证据。标注区域属于约束证据，不属于页面资产。

## Image And Viewport Matrix

输入包含多个状态或 viewport 时填写，包括多图、拼图派生状态和响应式截图；确实只有单一状态/viewport 或纯文字输入时写“不适用”。

| 来源标签 | viewport | 推测状态 | 稳定元素 | 条件元素 | 布局变化 | 状态变化 |
| --- | --- | --- | --- | --- | --- | --- |

同一语义元素跨状态或 viewport 复用稳定 ID；条件元素必须注明来源。

## Page State Coverage

| 状态 | 图片/需求证据 | 是否已观察 | 是否需要实现 | 处理 |
| --- | --- | --- | --- | --- |

至少评估默认/有数据、空态、加载态和错误态；提交型页面再评估提交中、成功和失败。没有视觉证据时只记录覆盖问题，不设计具体 UI。所有 `unknown` 必须给出明确结论或进入 Open Questions。

## Layout Coverage Check

| 检查项 | 结果 | 问题 |
| --- | --- | --- |
| Spec Metadata 是否完整且档位/模式有效 | pass/fail | - |
| 每个输入是否登记稳定来源标签及适用元数据 | pass/fail | - |
| 会话附件是否正确区分可脚本测量与不可测量 | pass/fail/不适用 | - |
| 长图、局部图、线框图、标注混合图和拼图是否走正确处理链 | pass/fail/不适用 | - |
| 同一来源的 grid/cut/pick 网格配置是否一致 | pass/fail/不适用 | - |
| 每个可脚本图片是否生成 manifest、overview、tile-map 和非空 tiles | pass/fail/不适用 | - |
| manifest 是否按宽高独立执行 1/2/3/4 段或固定像素分档 | pass/fail/不适用 | - |
| Tile Inspection Log 是否覆盖 manifest 全部 tile 且未检查数为 0 | pass/fail/不适用 | - |
| 跨 tile 边界的元素是否在相邻 tile 中复核并去重 | pass/fail/不适用 | - |
| 是否先看概览定骨架，再逐 tile 盘点，最后定向裁剪复检 | pass/fail/不适用 | - |
| 每条图片 evidence 是否指向 artifact 内真实存在的文件 | pass/fail/不适用 | - |
| low 字段是否完成一次复检或进入 Open Questions | pass/fail/不适用 | - |
| 脚本测量与视觉估计是否明确区分 | pass/fail | - |
| 更新模式是否保留稳定 ID 并填写 Change Summary | pass/fail/不适用 | - |
| 主要区域是否全部进入 Layout Tree | pass/fail | - |
| Wireframe、Layout Tree 和 Inventory 的 ID 是否一致 | pass/fail | - |
| 非重复可见内容是否作为独立元素进入 Inventory | pass/fail | - |
| 重复内容是否按分析档位进入 Repeated Content Patterns | pass/fail/不适用 | - |
| 每个元素是否记录所属区域、相对位置和关键样式 | pass/fail | - |
| unknown、conditional 和 deprecated 是否保留证据或说明 | pass/fail/不适用 | - |
| 文案是否逐字记录且未擅自改写 | pass/fail | - |
| 图标、资产、分隔线和状态标签是否单独记录 | pass/fail | - |
| 可见交互线索是否有证据且未推断业务结果 | pass/fail | - |
| 不确定图标、状态和业务用途是否保留 unknown/uncertain 而未按常见模式补猜 | pass/fail/不适用 | - |
| 适用的表单/列表/表格/浮层/移动端专项是否检查 | pass/fail/不适用 | - |
| 多状态/viewport 的稳定与条件元素是否正确合并 | pass/fail/不适用 | - |
| Page State Coverage 是否覆盖适用状态并处理 unknown | pass/fail | - |
| Visual Tokens 是否保留原始证据和置信度 | pass/fail/不适用 | - |
| 是否未提前执行正式组件库映射或 props 推断 | pass/fail | - |
| 自动验证器是否通过 | pass/fail | - |

任一结果为 `fail` 时先修正或补分析，不要进入下游组件映射。

`structure` 档位可以只列适用检查项，并用一行汇总“不适用的图片测量专项”；`standard` 和 `precision` 应逐项填写完整检查表。

## Open Questions

只列会影响元素盘点、布局关系、视觉 token、状态/viewport 合并或后续组件映射的问题。注明关联 ID、当前证据和需要确认的具体事项。没有问题时写“无”。
