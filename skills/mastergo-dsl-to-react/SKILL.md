---
name: mastergo-dsl-to-react
description: 将MasterGo DSL文件转换为React页面，优先识别并应用 component 字段中的三方组件信息，次选 Ant Design 4 组件库。
license: MIT
compatibility: opencode
metadata:
  domain: frontend-conversion
  workflow: design-to-code
  version: "5.9"
---

## ⚡ 执行入口（先看这里）

```
python3 resource/MasterGoDSLResolver.py <dsl文件>   # 输出 _resolved.md（CSS已预计算）
  ↓
执行 STEP 0 → A → P（写入 _plan.md）→ 加载 cmbc-apollo-code-generator skill → STEP D → STEP E（核销）

_resolved.md 已包含完整 CSS，无需推导布局规则。
其余章节（节点类型规则 / 组件规则）= 参考资料，按需查阅。
STEP D 入口处有 D-1 快速参考表覆盖常用决策。
```

> ⚠️ **强制要求：生成的所有代码必须符合 Apollo 规范。**
> 规范以 `cmbc-apollo-code-generator` skill 为唯一权威来源，进入 STEP D 前必须加载该 skill 并在整个生码过程中严格遵守其全部约束。任何与 Apollo 规范冲突的写法不得出现在产物中。

---

## 前置步骤 — DSL 预处理（必须最先执行）

**每次转换前必须先运行 Resolver 脚本**，禁止直接处理原始文件。

```bash
python3 resource/MasterGoDSLResolver.py <dsl文件路径>
# 输出：同目录下 <原文件名>_resolved.md
```

**使用 `_resolved.md` 作为输入，禁止直接使用原始 DSL 文件。**

---

## _resolved.md 文件结构

Resolver 预处理后输出 Markdown 文档，**所有 CSS 已预计算，无需再做字段→CSS 转换**。

| 区段 | 内容 | 用途 |
|------|------|------|
| `## LESS Token 定义` | 颜色/阴影变量声明 + 字体命名参考（注释形式） | 直接复制写入 `tokens.less` |
| `## 节点树` | ASCII 树，标注类型/尺寸/叶子编号 | 理解组件层级，建立 JSX 骨架 |
| `## 叶子节点清单` | 每个 TEXT/ICON/PATH/LAYER 含路径 + 完整 CSS 块 | 直接用于写 LESS class |
| `## 容器清单` | 每个 FRAME/INSTANCE 含自身定位 CSS + 子布局 CSS | 直接用于写容器 LESS class |

---

## tokens.less — 仅变量定义

从 `_resolved.md` 的 `## LESS Token 定义` 区段复制颜色和阴影变量，**只写变量声明，不写任何样式类**：

```less
/* 直接从 _resolved.md ## LESS Token 定义 复制颜色/阴影行 */
@color-white: #FFFFFF;
@color-1f2329: #1F2329;
@shadow-1: 0px 1px 4px 0px rgba(0, 0, 0, 0.1);
/* 字体注释行不复制，字体属性直接在 class 中展开为 4 行 */
```

**字体处理：** 叶子节点 CSS 块中字体已展开为 `font-size/font-weight/line-height/font-family` 4 行，直接抄入对应 class，不定义 `@font-` 子变量。

---

## index.less — 样式类定义

```less
@import 'styles/tokens.less';
```

**CSS 来源：** 从 `_resolved.md` 叶子节点/容器清单的 css 块直接读取，按 className 写入对应 class。不需要再推导字段→CSS。

**class 命名：** 按节点语义（`page-header`、`form-label`、`nav-icon`），不按 token key。

**Token 使用优先级（强制，不得绕过）：**

| 优先级 | 情况 | 处理方式 |
|--------|------|---------|
| 1（最高） | `_resolved.md` CSS 块中已含 `@color-xxx` / `@shadow-xxx` | 直接照抄，不改写 |
| 2 | CSS 块中有裸色值，但 `## LESS Token 定义` 里有对应变量 | 改用变量名 |
| 3 | 色值无对应变量 | 在 `tokens.less` 补充新变量，再引用 |
| 4（禁止） | 任何情况直接写 `#hex` / `rgba(...)` / `0px 0px ...` 阴影裸值 | **禁止**；违反 = 还原失败 |

**运行时动态值**（进度条 percent）用内联 style，其余一律用 className。

---

## 节点渲染总则

**树中每个节点都必须生成对应输出，不得跳过、合并或省略。**

以下是唯一允许不生成 DOM 的例外，例外之外一律渲染：

| 例外条件 | 处理方式 |
|---------|---------|
| `type: "GROUP"` | 不生成 DOM；直接输出其 children |
| LAYER `semantic:"mask"` 且 `mask:"alpha"` | 不生成 DOM；在父容器 LESS 类加 `overflow: hidden` |
| INSTANCE 有 `columns` 或 `dataSource` | INSTANCE.children 已由 Resolver 清空；直接用 columns/dataSource 生成 `<Table>`，不遍历 children |
| INSTANCE 有 `navItems` | INSTANCE.children 已由 Resolver 清空；navItems 字段已包含完整多级菜单树（含嵌套 children），直接转 Menu items prop |

**生成每一段代码前，先列出该段全部叶子节点（TEXT / ICON / PATH / LAYER / INSTANCE），生成后逐一核对是否全部出现在代码中。**

---

## 节点类型与渲染规则

### FRAME — 容器

CSS 从 `_resolved.md ## 容器清单` 对应块直接读取，不推导。`⚠️ ABS容器` 标记的容器自身 CSS 已含 `position:relative`，其 children CSS 已含 `position:absolute`。

**注意：** `gap:"-1px"` → `margin-left:-1px`（列 border 折叠）；`bgShape` → 不生成额外 DOM，CSS 已展开在容器清单中。

### INSTANCE — 组件实例

**有 `component` 字段 → JSX 根标签必须是 `<ComponentName>`，不得替换为 `<div>` 或任何原生标签。**

- **`组件名:`** — Resolver 提取的组件名（如 `Button`），直接用作 JSX 标签名
- **`来源:`** — 组件所在 package（如 `@cmbc/apollo-uecp-ui-pc` / `antd`），用于判断是否为 UECP 组件；替换原 `API来源:` 行
- **`componentName`** — 直接用作 JSX 标签名，无需解析 component 字段
- **`jsxHint`** — Resolver 自动生成；若已知 props（ltype/lsize 等）或子节点文字，已内联至模板（如 `<Button ltype="default">确认</Button>`）；无数据时为通用占位符，props 通过 MCP + 子节点数据填写
- **`已知Props`** — Resolver 预填的必填/常用 prop 类型，STEP A 直接用作起点，无需从零推断
- **type=FRAME（原 INSTANCE 降级）** — 无组件，直接渲染 children，name 可作 className
- **`⚠️  INSTANCE — 无法识别组件`** — 禁止手写任何 DOM，输出 `{/* UNRESOLVED: [节点名] — 组件未识别，等待人工确认 */}`

**UECP 组件（`_resolved.md` 中有 `来源:` 行且值含 `@cmbc/apollo-uecp-ui-pc`）：**
- 查 `uecpui` MCP 获取 API 和 JSX 示例
- 读取该节点 `子节点内容摘要` 中的 texts / icons / images / children → 对应填入 props（`children:` 出现时为该组件的 children prop，如 Button 的按钮文字）
- MCP 不可用时：参考 antd 同名组件 props 列表，结合子节点数据填写值
- 不得降级为 `<div>` 或原生 HTML

**父子都有 component** → 用父级组件，子 component 字段只作 props API 参考。

**INSTANCE children 渲染规则（按情况互斥）：**

| 情况 | children 处理 |
|------|-------------|
| 有 `columns` 或 `dataSource` | INSTANCE.children 已清空，不遍历，直接生成 `<Table>` |
| 有 `navItems` | INSTANCE.children 已清空；navItems 已含嵌套 children 树，直接生成 `<Menu>` |
| 其他所有情况 | children 全部渲染为 `<ComponentName>` 的 JSX children，不得省略任何子节点 |

**children 中的 PATH 节点：**
- `jsxHint` 或 `component` 中明确含 `icon` prop → 作为 prop 传入：`icon={<svg>...</svg>}`
- 否则 → 渲染为紧邻的兄弟 `<svg>`，不可省略

### TEXT — 文本节点

CSS 从叶子节点清单对应块直接读取。`white-space: nowrap` 若在 CSS 块中出现则照抄。

**`semantic:"heading"`**（fontSize≥18px 或 ≥16px且fontWeight≥500 时自动标注）→ 渲染为 `<div className="..."/>`，CSS 块已含完整 font-size/font-weight/line-height，**不得用 `<h2>`/`<h3>`**（浏览器默认 margin/font 会覆盖设计稿样式），也不得用 `<span>` 或 `<p>`。

**semantic 与 component 优先级**：TEXT 节点极少有 `component` 字段；若同时存在，`component` 优先（用指定组件渲染）；`semantic:"heading"` 仅在无 `component` 字段时生效。

**多 run（富文本）：** 叶子节点清单中出现 `runs` 字段 → 每个 run 单独一个 `<span>`，各自应用对应颜色变量；外层 `<span>` 包裹。

### ICON — antd 图标

叶子节点清单格式：`#N ICON — XxxOutlined`，CSS 块含 `color`（已解析为 `@color-xxx`）和 `width/height`。渲染为 `<XxxOutlined className="..."/>`，LESS 写 `color` + `font-size`（取 width 值）。

**未识别图标**（type=INSTANCE，name 含"icon"，children 是 PATH）→ 渲染 PATH 为 `<svg>`，注释 `{/* fallback svg */}`。

### PATH — SVG 路径

叶子节点清单含 `paths` 数组，每项有 `d`（路径）和 `fill`（已解析色值）。渲染为：
```tsx
<svg width={w} height={h} style={{overflow:'visible'}}>
  <path d="..." fill="#解析值" />
</svg>
```
`fill` 直接用解析值，不引用 LESS 变量（SVG fill 不支持 CSS 变量）。

### LAYER — 装饰层

按 `semantic` 字段渲染，规则不得变通：

| semantic | mask 字段 | 渲染方式 |
|----------|----------|---------|
| `image` | — | 见下方专项规则 |
| `mask` | `alpha` | **不渲染 DOM**，父容器加 `overflow: hidden` |
| `color-block` | `outline` | `border-radius: 50%; overflow: hidden`（圆形裁剪，用于头像） |
| `color-block` | 无 | `<div className="..."/>`，LESS：`background: @color-xxx; width: Npx; height: Npx` |
| `divider` | 无 | `<div className="divider"/>`，LESS：`height: 1px; background: @color-xxx` |
| `progress-track` | — | 进度条轨道，与 `progress-fill` 配合（见下） |
| `progress-fill` | — | `percent = round(fill.layout.w / track.layout.w * 100)`，渲染为 `<Progress percent={N} strokeColor={fill.bg} trailColor={track.bg} />` |

**LAYER `semantic:"image"` 渲染规则（按兄弟节点数量判断，`bg` 值已是 `url(...)` 格式）：**
- LAYER 有其他兄弟节点（父容器还有别的子节点）→ 渲染为 `<img src={bg.slice(4,-1)} className="..." />`，LESS 写 `width/height`（`bg.slice(4,-1)` 去掉 `url(` 和 `)` 得到原始 URL）
- LAYER 是父容器唯一子节点 → 不生成 LAYER 自身 DOM；在父容器 LESS 类加 `background-image: {bg的值}; background-size: cover; background-position: center`（`bg` 值本身含 `url(...)`，直接用）

**`navItems`（Resolver 自动生成）：**  
Resolver 检测到导航结构时自动生成，该父节点 children 已清空，直接按 navItems 生成 Menu：

```tsx
// navItems 直接转为 Menu items prop 格式
const menuItems = navItems.map(item => ({
  key: item.label,           // key 用 label，业务开发时按路由替换
  label: item.label,
  icon: item.icon ? React.createElement(iconMap[item.icon]) : undefined,
  children: item.children?.map(child => ({
    key: child.label,
    label: child.label,
    children: child.children?.map(/* 同上递归 */)
  }))
}));
// → <Menu items={menuItems} />
// 选中态（activeKey/selectedKeys）由路由控制，不从 DSL 硬编码
```

### SVG_ELLIPSE — 圆形/椭圆

- LESS：`border-radius: 50%; overflow: hidden; width: Npx; height: Npx`
- 有 `bg:"url(...)"` → `<img src={...} style={{width:'100%',height:'100%',objectFit:'cover'}} />`
- 两个叠加的 SVG_ELLIPSE（name 含"Mask"）→ 合并为一个 DOM 节点，外层取 shadow，内层取图片 URL

### GROUP — 透传容器

不生成 DOM，直接渲染 children。

---

## 表格数据结构

### Table INSTANCE — `columns` + `dataSource`

有 `columns/dataSource` 字段时 Resolver 已预处理，**不得再解析 children**（children 已移除）：

```jsonc
{ "type": "INSTANCE", "componentName": "Table",
  "columns": [
    { "title": "产品名称", "dataIndex": "col0", "key": "col0", "width": 140,
      "headerIcons": ["InfoOutlined"] },
    { "title": "有效时间", "dataIndex": "col5", "key": "col5", "width": 140, "align": "right" },
    { "title": "操作", "dataIndex": "col6", "key": "col6", "width": 140,
      "render": "action",
      "actions": [[{"label":"同意","type":"link"},{"icon":"EllipsisOutlined"}]] }
  ],
  "dataSource": [{ "col0": "操作系统", "col5": "2026.08" }],
  "rowSelection": { "type": "checkbox" }
}
```

**渲染规则：**
- 生成前写注释 `// columns count: N`
- `width` 必填，直接用 DSL 值，不得省略或估算
- `headerIcons` → 列标题渲染为 `<>{col.title}<InfoOutlined /></>`
- `align:"right"` → `align: 'right'` prop
- `render:"action"` → 自定义 render 函数，`actions[rowIndex]` 按序渲染：`label` → `<Button type="link" size="small">`，`icon` → 对应图标组件
- `rowSelection` → `<Table rowSelection={{ type: node.rowSelection.type, selectedRowKeys: [], onChange: () => {} }} />`
- `dataIndex` 为 `col0/col1...` 序号，**生成代码时保持 col0/col1 不变**（业务开发阶段再按含义重命名，同步修改 dataSource key）

---

## 六条最高优先级规则

1. **组件锁定**：`component` 含 import 时 JSX 根标签必须是 `<componentName>`，有 `jsxHint` 时直接用作起点，不得替换为 `<div>`。
2. **数据禁幻**：所有文本/数据必须来自 DSL 节点，不得出现"选项1""Column 1"等自造占位符。
3. **尺寸保真**：`layout.w/h` 固定时输出固定尺寸，不得被组件库默认样式覆盖。
4. **资产保真**：图片 URL、PATH SVG d 值、ICON antdIcon 必须精准使用，不得替换为色块或省略。
5. **变量化**：`_resolved.md` 节点 CSS 中已含 `@color-xxx` / `@shadow-xxx` 变量引用，照抄即可；不得改写为裸色值。
6. **未识别占位**：INSTANCE 节点在 `_resolved.md` 中有 `⚠️  INSTANCE — 无法识别组件` 提示时，禁止手写 DOM，输出 `{/* UNRESOLVED: [节点名] — 组件未识别，等待人工确认 */}`，其余代码照常生成。

---

## 组件选用优先级

```
_resolved.md 中有 来源: 含 @cmbc/apollo-uecp-ui-pc → UECP 第三方组件（查 MCP）
  ↓（无 API来源 行）
Ant Design 4（Table / Form / Menu / Upload / Tabs …）
  ↓（无对应组件）
语义化 HTML（section / h2 / ul / li …）
```

---

## uecpui MCP — 内部组件库 API 查询

`@cmbc/apollo-uecp-ui-pc` 是内部组件库。识别为 UECP 组件后，**查 MCP + 分析子节点数据 = 完整 props**。

**识别规则：** `_resolved.md` 容器清单中节点有 `来源:` 行且值包含 `@cmbc/apollo-uecp-ui-pc` → UECP 第三方组件。

**处理流程（每个 UECP 组件执行一次）：**

1. **查 MCP**：调用 `uecpui` MCP 查询该组件的 API 文档和 JSX 示例
2. **看子节点**：读取 `_resolved.md` 中该节点的 `子节点内容摘要`（texts / icons / images / 子组件），这些数据决定 props 传什么值
3. **写适配**：以 MCP 示例为骨架，将子节点内容对应填入各 prop

**MCP 不可用时：** 参考 antd 同名组件的完整 props 列表作为行来源，将子节点数据填入对应 prop 的值列。不得降级为 `<div>` 或原生 HTML。

**同一组件名只查一次 MCP**，结果复用于该组件所有出现位置。

---

## 执行协议（严格按顺序）

### ▶ STEP 0 — 初始化

**0-A**：逐条读取并执行 `rules` 字段，写明每条执行方式。尝试连接 `uecpui` MCP；不可用时标记 `mcp: unavailable`，后续 UECP 组件改用 antd 同名组件 props 列表作为行来源，值从子节点数据填写。

**0-C 现有组件检查（有 `src/components/` 目录时执行）：**

```
ls src/components/   # 或搜索 src/components/index.ts
```

列出项目已有组件名。后续 INSTANCE 渲染时，若 `componentName` 与已有组件名一致，**优先复用已有组件**，不重新创建。若目录不存在，跳过此步骤继续。

**0-B 叶子节点底账（生成任何代码前必须完整输出此表，格式不对不得继续）**：

**第一步：从 `_resolved.md` 头部读取总数**
```
leafNodes 行: （仅显示存在的类型，如 TEXT×3  LAYER×2）   合计 __
```

**第二步：逐行抄录（从 `## 叶子节点清单` 原文复制，禁止省略、禁止写占位符）**
```
| #  | 类型  | 标识内容                  | 路径简写              |
|----|-------|--------------------------|----------------------|
| 1  | TEXT  | "产品列表"                | 编组2备份 > 标题       |
| 2  | ICON  | InfoOutlined             | Table > 产品名称列头   |
| 3  | LAYER | color-block              | 编组2备份 > 标题       |
...（每个叶子一行；LAYER semantic:mask 跳过不列）
```

**第三步：数量核对（必须）**
```
_resolved.md leafNodes 合计: __   底账实际列出: __   一致? ✓/✗
✗ → 停止，从清单补入遗漏项，重新数后继续
```

**第四步：附录清单**
```
component 节点:
  [节点名] → <ComponentName>
  ...（从 ## 容器清单 找出所有含组件名的 INSTANCE）

分段策略: 共P段
  段1: #1–#N  [区域描述]（≤15个） 组件: <ComponentA>, <ComponentB>
  段2: #N+1–#M  [区域描围]（≤15个） 组件: 无
  ...
  （组件节点无叶子编号，按视觉位置归入所在段，不得遗漏）
```

**底账规则（底账填写时适用）：**
- LAYER `semantic:mask` 不列入底账
- INSTANCE 含 `componentName`：Resolver 已不展开其子树，清单中不含其内部节点，无需手动排除
- **每段叶子节点不超过 15 个**；超出时拆段

### ▶ STEP A — 组件 props 完整映射表

从 `_resolved.md` 的 `## 容器清单` 中找出**所有含 `⚠️  INSTANCE` 标记且有 `组件名:` 行的节点**（UECP 和 antd 均计入）。**每个有 componentName 的节点都必须写一张映射表，不得遗漏。**

**Props 来源优先级（按顺序判断）：**

| 情况 | Props 行来源 |
|------|------------|
| `_resolved.md` 中有 `已知Props` 行 | **先以 `已知Props` 为起点**，再按以下规则补全 |
| 有 `来源:` 且值含 `@cmbc/apollo-uecp-ui-pc`（UECP） | 调用 `uecpui` MCP 获取完整 props 列表 |
| MCP 不可用（`mcp: unavailable`） | antd 同名组件完整 props 列表 |
| 无 `来源:` 行，有明确 `组件名:` 的 antd 组件 | antd 该组件完整 props 列表 |

**每个组件处理顺序：**
1. 读取 `_resolved.md` 该节点的 `已知Props` 行（若有），作为初始 props 骨架
2. 按上表确定完整 props 来源，补全所有 props
3. 读取该节点在 `_resolved.md` 中的所有数据字段：`tabList` / `navItems` / `子节点内容摘要`（texts/icons/images）/ `示例props` / `columns` / `items` 等
4. 以 props 列表为行，将 DSL 数据填入对应 prop 的值列，每个 prop 一行，不得省略

**每个组件输出一张映射表（不写示例代码）：**

```
### [组件名]（节点: [节点名]，API: mcp:uecpui / antd）

| prop 名 | 值 / 数据来源 | 说明 |
|---------|-------------|------|
| tabList | resolved.md tabList 字段（7项） | 直接传入 |
| width   | 1440 | layout.w |
| onChange | () => {} | 事件回调，运行时绑定 |
| activeKey | tabList[0].path | 默认第一项选中，运行时由路由控制 |
```

**填写规则（目标：props 准确到可直接写入代码，不依赖后续推测）：**
- prop 行必须来自 MCP / antd 文档，不得自己推测 prop 名称
- 每个 prop 必须出现在表中，一行都不能少
- 有对应 DSL 数据的 prop → **必须**写清楚具体的值或数据来源字段，不得写模糊描述
- 事件回调 prop → 写 `() => {}`
- **禁止**：用示例代码替代此表；禁止只列部分 prop；禁止写"待确定"等模糊值

同一组件名只查一次（MCP / antd 文档），多次出现的节点复用同一张表（注明"同上"）。

### ▶ STEP P — 计划自验证（PLAN 阶段结束前必须执行）

STEP 0 / A 完成后，**不立即停止，先执行自验证**：

**P-1 底账数量复核**

对比 `_resolved.md` 头部 `leafNodes:` 行与 STEP 0-B 底账登记数：

```
_resolved.md leafNodes 行: （仅含存在的类型）合计 N
STEP 0-B 底账登记:         合计 N'
一致? ✓/✗（✗ 则从叶子节点清单补入遗漏项，更新编号）
```

**P-2 组件决策表复核**

对比 `_resolved.md` 容器清单中含 `⚠️  INSTANCE` 且有 `组件名:` 行的节点数与 STEP A 映射表数：

```
_resolved.md 有 componentName 的 INSTANCE 节点数: N
STEP A 映射表数:                                 N'
一致? ✓/✗（✗ 则找出遗漏节点补入映射表）
```

全部 ✓ 后，**必须立即使用 Write 工具将 Plan 写入文件，禁止只输出在对话中**：

**使用 Write 工具创建文件 `_plan.md`**（路径：`_resolved.md` 所在目录，文件名替换后缀为 `_plan.md`）

> ⚠️ **强制要求**：`_plan.md` 必须作为独立文件落盘，不得仅在对话输出。STEP D 依赖此文件作为唯一参考，文件不存在时禁止进入 STEP D。

文件内容固定为以下四个区段（严格按此顺序，每段以 `##` 开头）：

```markdown
# Plan — {页面/组件名}

## 底账
| # | 类型 | 标识内容 | 节点路径 |
|---|------|---------|---------|
| 1 | TEXT | "产品列表" | Header > Title |
| 2 | ICON | UploadOutlined | Toolbar > Upload |
| 3 | PATH | 64×3 | Divider |
...（每个叶子节点一行，GROUP/mask 不计入）

ABS容器: [节点名] w×h | ...（无则写"无"）

## 组件示例
### [ComponentName]（节点: [节点名]，API: mcp:uecpui / 推断）

| prop 名 | 值 / 数据来源 | 说明 |
|---------|-------------|------|
| tabList | resolved.md tabList 字段（7项） | 直接传入 |
| width   | 1440 | layout.w |
| onChange | () => {} | 事件回调，运行时绑定 |

（每个有 componentName 的 INSTANCE 一块，包括 UECP 和 antd；同名组件只写一次）

## 分段策略
段1: #1–#8 — [区域描述]（≤15个）
段2: #9–#18 — [区域描述]（≤15个）
...

## 验证
底账 M 个（仅列存在的类型）| 组件 N 个
```

Write 工具调用成功后，**立即运行校验脚本**（必须通过才能进入 STEP D）：

```bash
python3 resource/validate_plan.py <_resolved.md路径> <_plan.md路径>
# 退出码 0 = 全部通过；退出码 1 = 有失败项，按输出提示修正后重跑
```

校验通过后，输出以下摘要，随即进入 STEP D：

```
══════════════════════════════════════
PLAN COMPLETE — 已写入 _plan.md，开始生成代码
══════════════════════════════════════
底账: M 个叶子节点（仅列存在的类型）✓ 已复核
组件: N 个 ✓ 已复核
分段: P 段 → [各段编号范围]
══════════════════════════════════════
```

---

### ▶ STEP D — 分段生成代码

> **进入 STEP D 前必须加载 `cmbc-apollo-code-generator` skill，后续所有代码严格遵守 Apollo 规范，不得以任何理由跳过。**

> **每段生成前必须逐条确认（不得跳过）：**
> 1. **CSS 只抄不推** — 所有 LESS class 内容从 `_resolved.md` 对应 CSS 块逐行复制，不自己推导
> 2. **className 必写** — 每个 FRAME/叶子节点 JSX 必须带 `className="xxx"`，缺失则样式全部失效
> 3. **ABS 定位不改** — ABS 容器 CSS 已含 `position:relative`，ABS 子节点 CSS 已含 `position:absolute/left/top/width/height`；照抄，不替换为 flex/margin
> 4. **LAYER 不跳过** — `color-block`/`divider` LAYER 是真实 DOM，必须渲染为 `<div className="..."/>`

---

**D-0 计划上下文**：进入 STEP D 前先确认 `_plan.md` 文件已存在（使用 Read 工具读取验证）；文件不存在则返回 STEP P 补写后再继续。四个区段各有用途：

| _plan.md 区段 | 用途 |
|-------------|------|
| `## 底账` | 叶子节点编号表 + ABS容器清单，STEP D 每段消费，STEP E 核销 |
| `## 组件示例` | 各组件 props 映射表，遇到对应组件时直接按表填写 props |
| `## 分段策略` | 确定当前段的底账范围，按顺序逐段执行 |
| `## 验证` | 数量参照，STEP E 核销时对比 |

不重新分析 DSL，不重新调用 MCP。

**D-0 生成前组件强制检查（每段必须，不可跳过）：**  
列出本段涉及的全部 INSTANCE 含 `componentName` 的节点，逐行确认：
```
本段 component 节点:
  - [节点名] componentName=[X] → JSX 根标签必须是 <X>，不得改为 <div>  ✓/✗
  （✗ 时禁止继续生成，先确认组件 API 来源后补正）
```

遇到 UECP 组件时：**以 `_plan.md` 中 `## 组件示例` 的 props 映射表为唯一依据，按表每行写一个 prop，值照抄"值/数据来源"列，不得新增、删减或重新推断任何 prop。**

---

**D-1 节点类型快速参考（生成时遇到对应类型直接查此表）**

CSS 已在 `_resolved.md` 预计算，此表只列 JSX/渲染决策：

| 节点类型 | JSX/渲染决策 | 必须输出 |
|---------|------------|---------|
| FRAME/容器 | CSS 从 `## 容器清单` 直接读取；⚠️ABS容器标记→CSS已含position:relative | className 引用对应 class |
| INSTANCE 有component | JSX根标签必须是`<ComponentName>`，不得改为div | 有MCP示例块→以示例为模板替换 |
| INSTANCE 无component | 直接渲染children；name 字段可作 className | — |
| TEXT | CSS 从 `## 叶子节点清单` 读取；`semantic:heading`→`<div>`（不用h2/h3，浏览器默认样式会冲突）；`nowrap`→white-space:nowrap（已在CSS中） | className 引用 class |
| TEXT runs | 每个run独立`<span>`，各自用颜色（已在CSS中预计算） | 外层`<span>`包裹 |
| ICON | `<XxxOutlined className="..."/>` | LESS: color（已给出）+font-size |
| PATH | `<svg w h><path d="..." fill="解析值"/></svg>` | fill直接用解析值，不用LESS变量 |
| LAYER image（有兄弟） | `<img src={url}/>` | url 从叶子清单 background: url(...) 提取 |
| LAYER image（独子） | 不生成LAYER DOM | 父容器LESS: background-image/size/position |
| LAYER color-block | `<div/>` | CSS 从叶子清单读取 |
| LAYER divider | `<div/>` | CSS 从叶子清单读取 |
| LAYER progress-fill | `<Progress percent={fill.w/track.w*100}/>` | strokeColor/trailColor用叶子清单中的颜色值 |
| navItems | `navItems.map()`转Menu items格式；navItems[].children 需递归处理多级菜单；不遍历 INSTANCE.children | 选中态不硬编码 |
| Table columns | `// columns count: N`，width必填；不遍历 INSTANCE.children | — |
| GROUP | 不生成DOM，直接输出children | — |

---

**每段生成前，先输出本段计数核对：**

```
本段消费底账: #1(TEXT"产品列表") #3(ICON UploadOutlined) #5(PATH 64×3)  共N个
本段 component 节点（含 UECP 和 antd）: [列出名称] → _plan.md 组件示例均已登记 ✓/✗
（✗ 时禁止继续生成，先补 _plan.md 组件示例后再生成）
```

数字不一致时先补齐再生成，不得跳过。

**每段生成后，立即核销：**

```
本段已渲染: #1 ✓ #3 ✓ #5 ✓
本段未渲染: （列出编号，立即补写，补写后再继续下一段）
```

**生成规则：**
- tokens.less：只写变量声明
- index.less：`@import 'styles/tokens.less'` + 具名 class（无裸色值/裸数字）
- index.tsx：JSX className 引用 index.less 中的 class

每段末输出：`// [SEGMENT SUMMARY] components/repeat/icons/tokens/nodes-covered`

### ▶ STEP E — 底账核销（数量对比，不得主观判断）

**E-0 组件标签核销（门卫步骤，必须最先执行；E-0 未全部 ✓ 禁止进入 E-1）：**

逐个列出底账中的 "component 节点"，检查代码中是否出现对应标签：

```
component 节点核销（UECP + antd 全部覆盖）:
[节点名] componentName=Table        → 代码中出现 <Table ...>: ✓ / ✗
[节点名] componentName=Upload       → 代码中出现 <Upload ...>: ✓ / ✗
[节点名] componentName=Menu         → 代码中出现 <Menu ...>: ✓ / ✗
[节点名] componentName=NavigationBar → 代码中出现 <NavigationBar ...>: ✓ / ✗
...
_plan.md 组件示例共 N 个 → 代码中全部出现对应标签: ✓ / ✗
全部 ✓ → 进入 E-1
有 ✗ → 立即修正（补写对应 <ComponentName> 结构），修正后重新执行 E-0，不得跳过进入 E-1
```

**E-1 叶子节点核销（E-0 全部 ✓ 后才执行）：**

```
底账共 M 个：
#1 TEXT "产品列表"   → 代码中找到: ✓ / ✗
#2 TEXT "2024-01-01" → 代码中找到: ✓ / ✗
#3 ICON UploadOutlined → 代码中找到: ✓ / ✗
...
核销结果: M 个全部 ✓ / 有 K 个 ✗（列出编号，立即补写）
```

未全部 ✓ 时禁止标记完成，必须补写缺失节点后重新核销。

**E-2 结构核对：**

```
① tokens.less 颜色/阴影变量：与 _resolved.md ## LESS Token 定义 数量一致
② index.less className N 个 → 均有对应 class 定义（对比 className 出现次数）
```

**E-3 Resolver 预处理字段：**

```
columns/dataSource 存在 → <Table> 直接用预处理数据，无 children 遍历   ✓/✗
rowSelection 存在 → rowSelection prop 含 type/selectedRowKeys/onChange   ✓/✗
navItems 存在 → 转为 Menu items 格式，无 children 遍历                  ✓/✗
```

**E-3B Token 裸值审计（扫描 index.less）：**

```
扫描 index.less，找出所有 #xxx / rgba(...) / 0px N px ... 形式的裸值:
  发现裸色值: [列出行号和值]  → 替换为对应 @color-xxx 变量（tokens.less 中补充）
  发现裸阴影: [列出行号和值]  → 替换为对应 @shadow-xxx 变量
  无裸值: ✓
```

有裸值必须替换后重新扫描，不得以"下次优化"跳过。

有 ✗ 项必须修复后重新标记。

### ▶ 上下文告急降级（剩余上下文 < 20%）

| 降级项 | 降级方式 | 必须注释 |
|--------|---------|---------|
| MCP不可用的组件 props | 参考 antd 同名组件 props，结合子节点数据填写 | — |
| 未识别图标 | 渲染 PATH SVG | `{/* fallback svg */}` |
| 不可降级 | component 指定组件不得改为 `<div>`；TEXT/texts 内容不得省略；图片 URL 不得删除 | — |

---

## 失败判定（命中任一条 = 还原失败）

1. `component` 指向三方组件（包括 `@cmbc/apollo-uecp-ui-pc` 中的 NavigationBar、Sider、Menu 等），但代码用 `<div>` 或原生 HTML 替代
2. ICON 被色块/文字替代，或 PATH d 值 / 图片 URL 被删除或替换
3. 关键节点 layout.w/h 明显偏离，或 Table 列宽被省略
4. Table 含 `columns` 字段但代码遍历 children 或手写列定义
5. tokens.less 中定义了 `@font-xxx` 字体变量（字体属性已由 Resolver 展开为 4 行 CSS 属性，应直接抄入对应 class，不在 tokens.less 中定义任何 `@font-` 变量）
6. STEP A 未完成即生成代码，或组件 props 与映射表不一致
7. `rules` 指令未执行（token 未引用 LESS 变量等）
8. STEP 0-B 底账未完整填写（缺少 TEXT 文字内容、ICON 名称、PATH/LAYER 标识）
9. STEP E-1 核销结果有 ✗ 项但仍标记完成
10. INSTANCE children 在非豁免情况下（无 columns/navItems）未全部渲染
11. ABS 容器的 `position: relative` 或 ABS 子节点的 `position: absolute; left/top/width/height` 被手动删改（resolver 已在 CSS 块中给出，照抄即可，不得覆盖）
12. Flex item 手动写了 `position: absolute; left/top`（CSS 块注释已标明 `flex item`，不写 position）
13. E-0 组件标签核销有 ✗ 但仍继续进入 E-1（E-0 是门卫，未全部通过禁止继续）

---

## 输出文件结构

文件写入 `_resolved.md` 同目录下的 `src/`

```
src/
├── styles/
│   └── tokens.less    ← 仅变量：@color-xxx / @shadow-xxx / @font-xxx-size/weight/line-height/family
├── index.less         ← 样式类（@import 'styles/tokens.less'）
└── index.tsx          ← JSX，className 引用 index.less 中的类名
```

## 依赖

- React 16+ / TypeScript
- Ant Design 4.x（含 `@ant-design/icons`）
- `@cmbc/apollo-uecp-ui-pc`（三方组件，按 component 字段按需引入）

## 输入格式

提供 `_resolved.md` 文件路径或其内容。
