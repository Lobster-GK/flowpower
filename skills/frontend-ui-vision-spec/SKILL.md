---
name: frontend-ui-vision-spec
description: >
  从一张或多张 UI 截图、设计稿、Storybook 截图、线框图、局部组件图、长页面图片、会话图片附件、文字 UI 需求、已有页面描述或旧版 layout spec 中提取可复核视觉证据，并创建或增量更新持久化中文 frontend UI layout spec。用于截图还原、D2C、识图生码的生码前阶段，以及需要盘点布局树、稳定元素 ID、全量可见内容、相对位置、关键样式、视觉 token、资产、响应式 viewport、状态差异、交互线索和不确定项时。对可访问的图片按宽高独立分档生成轻量二维重叠 tile、编号视图和实体 evidence manifest，逐块完成覆盖与边界复检，以减少小元素遗漏并禁止用常见 UI 模式补猜不可见内容；再按 structure、standard 或 precision 档位生成可机器校验的 Layout Wireframe、Layout Tree、UI Element Inventory、状态矩阵与覆盖检查。不用于直接编写代码、正式组件库映射、props/API/业务逻辑推断、后端任务或在已有合格 spec 且没有新增证据时重复分析。
---

# Frontend UI Vision Spec

先解决“看清楚”，再解决“记完整”。创建或更新以证据为基础、可供组件映射和生码逐项对账的 `01-ui-layout-spec.md`；禁止从整图第一印象直接写最终 spec。

## 职责边界

- 负责输入登记、图片预处理、视觉事实提取、布局建模、状态/viewport 合并、增量更新和覆盖检查。
- 不选择最终组件库，不生成 props、事件处理、接口字段、路由、权限规则或业务结果。
- 只记录可见交互表面语义，例如 `click/tap`、`input`、`select`、`toggle`、`scroll`。
- 保留用途不明的可见内容为 `unknown-*`，不要省略或凭相似页面命名。
- 不主动扫描相似业务页面、目录或文件；只有用户明确指定参考范围时才读取。
- 正式组件映射交给下游 skill；下游发现证据不足时，返回本 skill 补分析对应区域。

## 运行上下文与产物

先解析本 `SKILL.md` 所在目录为 `<SKILL_DIR>`。所有脚本都使用绝对路径 `<SKILL_DIR>/scripts/...`；不要假设当前工作目录就是 skill 目录。

默认建立单独的 artifact 目录：

```text
.codex/artifacts/<语义化任务名或时间戳>/
├── 01-ui-layout-spec.md
└── visual-evidence/
    ├── image-1/
    │   ├── overview.png
    │   ├── tile-map.png
    │   ├── manifest.json
    │   ├── tiles/
    │   ├── grids/
    │   └── crops/
    └── partial/
```

用户指定产物路径时使用指定路径。为每次任务使用新的 `visual-evidence/`，不要把派生图写到源图片旁边。保留最终 spec 引用的证据图；完成合并后仅清理本次任务创建且未被引用的 `partial/` 文件，不删除用户输入。

最终 spec 必须符合 [输出结构与覆盖检查](references/layout-spec-schema.md)。遇到表单、列表、表格、分页、重复内容、图片组、浮层、响应式 viewport、移动端或复杂状态时，按需读取 [视觉识别检查清单](references/visual-recognition-checklist.md)。

## 分析档位

根据任务选择并在 `Spec Metadata` 记录档位：

| 档位 | 适用输入 | 要求 |
| --- | --- | --- |
| `structure` | 文字需求、低保真线框图、只关心页面骨架 | 生成完整章节；测量与视觉 token 可写“不适用”，不要运行无意义的取色 |
| `standard` | 普通页面截图、多状态页面、实现规格 | 默认档；完成分区、裁剪、全量元素盘点、状态和关键样式 |
| `precision` | 高保真设计稿、D2C、像素还原 | 执行全部视觉测量、低置信复检和 token 证据归并 |

用户明确要求像素级还原时使用 `precision`；低保真输入不得升级为精确数值。

## 创建与更新模式

- `create`：没有可用旧 spec 时创建完整 spec。
- `update`：用户补充截图、状态、viewport 或需求时，读取旧 spec 和新增证据；保留语义未变化的区域/元素 ID。
- 更新时新增元素才分配新 ID；消失但仍可能属于其它状态的元素标为 `conditional`，确认废弃后标记 `deprecated`，不要静默复用其 ID。
- 同一控件的 submitting、loading、disabled、selected、hover 或 error 只是状态变化，必须复用原元素 ID；只有状态中真实新增的图标、提示或容器才分配新 ID。
- 在 `Change Summary` 记录新增、修改、废弃、冲突和未解决问题。
- 新证据与旧 spec 冲突时，以更直接、更清晰、方法更可靠的证据为准；无法裁决时保留冲突并提问。
- 读取旧版 `schema_version < 1.2` 时可沿用其稳定 ID，但输出必须升级到 1.2，并补齐实体证据路径、manifest 和 Tile Inspection Log；不得原样复用旧伪证据。

## 证据与置信度

为关键文本、样式、token、状态和测量值记录来源、裁剪区域、方法及置信度：

- `high`：脚本测得，或放大图中清晰可辨且无歧义。
- `medium`：放大图中可辨，但数值属于档位估计或存在轻微歧义。
- `low`：被遮挡、压缩严重、看不清或只能弱推断；必须进入复检。

复检后仍不确定时写 `null`、`unknown` 或 `uncertain:<原因>`，并进入 `Open Questions`。真实页面噪声只降低视觉估计的置信度；脚本正确采样得到的像素值仍可为 `high`。

每条图片证据必须指向 artifact 内真实存在的文件。将“看见的形态”与“推测的用途”分开：

- 只有能在 evidence 中复核的元素才写入 Inventory；常见页面通常存在的元素不算证据。
- 图标用途无文字、状态或明确形态支持时，按外观记录为 `unknown-icon-*`，不要命名为搜索、设置、删除等业务动作。
- 没有展示的 hover、loading、error、空态、响应式变化和交互结果只能进入覆盖问题，不得补画或补写为页面事实。
- `high`/`medium` 图片结论必须引用实体 evidence；看不清时降为 `low` 并进行一次定向裁剪，仍不清楚则保留不确定。

## 图像工具

使用 `<SKILL_DIR>/scripts/crop.js`，不要临时重写裁剪或取色代码。每个有本地路径的图片先运行 `prepare`，始终显式指定该来源的独立证据目录：

```bash
node <SKILL_DIR>/scripts/crop.js info  <image> --json
node <SKILL_DIR>/scripts/crop.js prepare <image> --overlap 0.20 -o <artifact>/visual-evidence/image-1
node <SKILL_DIR>/scripts/crop.js grid  <image> --cols 6 --rows 8 -o <artifact>/visual-evidence/image-1/grids/grid-6x8.png
node <SKILL_DIR>/scripts/crop.js cut   <image> --cells B2:E5 --cols 6 --rows 8 --scale 2 -o <artifact>/visual-evidence/image-1/crops/header.png
node <SKILL_DIR>/scripts/crop.js pick  <image> --cells B2:E5 --cols 6 --rows 8 --top 5
node <SKILL_DIR>/scripts/crop.js pick  <crop> --at 0.5,0.3
node <SKILL_DIR>/scripts/validate-spec.js <artifact>/01-ui-layout-spec.md
```

`prepare` 使用确定性的按轴自适应裁切，不调用 OCR、检测器或外部视觉模型。宽、高分别按以下规则规划，因此横图可以是 `3x2`，不要强制正方形网格：

| 单边长度 | 该方向策略 |
| --- | --- |
| `<=320px` | 不切，保留完整方向 |
| `321-900px` | 2 段 |
| `901-1600px` | 3 段 |
| `1601-2400px` | 4 段 |
| `>2400px` | 640px 固定窗口 |

默认 overlap 为 20%，普通任务最多 48 个 tile；`precision` 确有需要时显式传 `--max-tiles 64`。超大图超过上限时脚本先把固定窗口从 640px 提高到 768px，仍超限则失败，不得截断尾部。只有需要覆盖默认规划时才传 `--tile <width>x<height>`、`--fixed-tile <n>` 或不同的 `--overlap`。`tile-map.png` 只用于定位，识别细节必须查看未画线的 `tiles/*.png`。`grid`、`cut`、`pick` 用于二次定位和复检；同一图片使用网格时必须保持 `--cols/--rows` 一致。脚本默认拒绝覆盖已有文件；仅在确认目标属于本次任务时使用 `--force`。

脚本默认限制单次处理规模为 100,000,000 像素；确有需要且资源允许时才显式传入 `--max-pixels <n>`。依赖 Node.js 18+ 和 `jimp@0.22.12`。依赖缺失时，先征得授权，再在 `<SKILL_DIR>/scripts` 执行 `npm ci`。

## 工作流

### 1. 登记输入与可处理性

为每个输入分配稳定来源标签：

- 图片：`image-1/desktop-1440/default`、`image-2/mobile-390/modal-open`。
- 文字或已有描述：`request-1/provided`。
- 长图切片：`image-1/slice-01/y0-2000`。
- 拼图派生状态：`image-1/state-01/default`。

除非用户说明是多个页面，多图默认视为同一页面的不同状态、viewport 或滚动位置。确认属于不同页面时，为每个页面创建独立 artifact/spec，避免 ID 空间混杂。

会话附件标记不是本地路径：

- 能取得真实文件路径时才运行脚本。
- 只有会话内视觉内容、没有本地路径时，直接识别结构与内容；脚本测量写“不适用”，视觉数值最高标 `medium`。
- 精确测量是任务硬要求而文件不可访问时，请用户提供原始图片文件，不要伪造路径或测量值。
- 图片路径可访问但 `prepare` 失败时停止图片分析，不得创建只有表格记录、没有实体文件的伪 evidence。

### 2. 分类并选择处理链

先运行 `info --json` 获取尺寸、哈希，再对每个可脚本图片运行 `prepare`。二维 tile 已覆盖普通图、宽图和长图，不再把长图切片视为可选步骤：

| 类型 | 特征 | 处理 |
| --- | --- | --- |
| A 高保真设计稿 | 像素规整、无浏览器边框 | `standard` 或 `precision`；prepare 后逐 tile 完整链 |
| B 真实页面截图 | 浏览器边框、滚动条、真实数据噪声 | prepare 后逐 tile；真实数据标为示例值 |
| C 低保真线框图 | 灰盒、占位符、手绘感 | `structure`；仍 prepare 防遗漏，精确视觉值写“不适用” |
| D 局部组件截图 | 尺寸小、单一组件 | prepare 按组件宽高独立分档；例如 600×400 生成 2×2；跳过页面级骨架 |
| E 长页面截图 | 高宽比大于 2.5 | prepare 自动二维重叠覆盖；按原图 bbox 去重 |
| F 多状态/多 viewport 拼图 | 同一页面或组件并排 | 先切为派生输入，再分别提取和填写状态/viewport 矩阵 |

一张图混合设计稿、尺寸标注或说明文字时，将标注区域单独裁出并标为 `annotation/provided-constraint`；不要把标注文字当成页面可见内容。

纯文字输入不运行图片工具；明确需求标 `provided`，合理但未确认的布局选择标 `inferred`。

### 3. 提取全局骨架

先查看 `overview.png` 和 `tile-map.png`，只提取页面模式、区域、父子关系、排列方向和粗略密度；不要在此阶段输出最终元素清单、精确文本或精确样式。

按从上到下、同层从左到右、每个区域从外到内登记稳定区域 ID。不要让视觉模型估算像素 bbox。

### 4. 逐 tile 全覆盖

严格按 manifest 的行列顺序逐张查看 `tiles/*.png`，每次只分析一张：

1. **内容遍**：逐字转录可见文本；记录图片、图标、分隔线、标签、状态点和未知元素。
2. **结构样式遍**：记录层级、兄弟顺序、相对位置、对齐、尺寸策略、滚动/覆盖、排版层级、边框、圆角、阴影、密度及禁用、选中、hover 残留、错误、加载和空态。
3. **边界遍**：记录触碰 tile 边缘的内容，并在相邻 tile 中复核完整范围；使用 manifest 原图 bbox 合并重复项。

重复内容按档位处理：

- `precision`：记录所有清晰可见的行、卡片和差异文本。
- `standard`：记录重复结构、可见数量、全量表头和能覆盖视觉差异的代表项；普通重复实例不逐单元格分配永久 ID。
- `structure`：记录重复模式和必要字段，不抄写示例数据。

所有非重复且影响实现或理解的可见内容必须获得稳定元素 ID。区域标题或备注不能代替元素记录。

全部 tile 完成前，不得把 `Tile Inspection Log` 写为 `pass`，也不得进入最终 spec。日志中的 Tile 总数必须与 manifest 一致，未检查数必须为 `0`。

### 5. 测量与复检

- 对 tile 中过小、模糊或语义有歧义的子区域使用 `cut` 生成 2x 裁剪；只有仍无法辨认时使用 4x。
- 对背景、填充和大面积分隔色使用 `pick --cells`。
- 对文字、图标和边框使用裁剪图相对采样点执行 `pick --at`，避开抗锯齿边缘。
- JPEG 等有损格式注明压缩偏移。
- 无确定测量手段的字号、间距和尺寸只记录层级或 4px 栅格档位。

收集 `low` 字段，对子区域再裁剪放大一次；最多复检一轮。复检只提高可见度，不创造原图不存在的信息。区域超过 8 个时，每完成 3 个区域把阶段结果写入 `visual-evidence/partial/`，最终从文件合并。

### 6. 合并状态、viewport 与 token

- 分别提取每张图，再在文本层比较；不要同时展示多张裁剪图要求直接对比。
- 稳定结构复用同一 ID；状态或 viewport 特有元素标为 `conditional` 并注明来源。
- 合并依据语义路径、内容、相对位置和状态，不仅依据名称。
- token 保留原始测量与证据；不要因“看起来接近”强行合并。
- 单张拼图拆出多个状态后也必须填写状态/viewport 矩阵。

### 7. 生成、校验与交接

先写一个一级文档标题，再按 schema 使用无编号的二级章节标题，例如 `## Spec Metadata`；不要写成 `# 1. Spec Metadata` 或 `## 1. Spec Metadata`。保持 Wireframe、Layout Tree、Inventory、状态矩阵和证据索引的 ID 一致。

先完成模型的 `Layout Coverage Check`，再运行：

```bash
node <SKILL_DIR>/scripts/validate-spec.js <artifact>/01-ui-layout-spec.md
```

验证器报错或 Coverage 存在 `fail` 时先修正；无法通过且问题影响实现时，停止进入组件映射并询问用户。

验证器会读取 manifest、核对全部 tile、检查 SHA-256 与覆盖空洞，并确认 Region Evidence 的文件真实存在。不得以手工 evidence ID 绕过实体证据检查。

## 多识别结果合并

仅当用户或上层流程明确要求多个独立识别结果时使用：

- 每份 agent-local final 独立覆盖全部输入并执行校验，不按区域拆分。
- 需要落盘时写入 `ui-recognition-results/agent-<N>/01-ui-layout-spec.md`。
- 按“来源/状态/viewport + 区域语义路径 + 元素类型 + 内容 + 相对位置”对齐。
- 主流程重新核对原始输入、取证据并集、统一 canonical ID，并重新运行验证器。
- 将取舍记录写入 `ui-recognition-results/merge-notes.md`。
- 旧流程显式要求 `includeComponentMapping` 时，只能另写非权威建议文件；不得污染 canonical layout spec。
