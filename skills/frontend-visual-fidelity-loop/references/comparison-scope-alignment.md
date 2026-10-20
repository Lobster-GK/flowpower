# 比较作用域与画布对齐协议

## 目录

- 目标
- 作用域分类
- DOM 目标选择
- 尺寸校准
- 截图方法
- Capture-only mutation
- 锚点和显式裁剪
- Mask 边界
- 对齐报告与阻塞条件

## 目标

在像素比较前，把参考图和浏览器渲染映射到同一个比较画布。完整应用壳可以继续参与布局，但只有目标 DOM 或明确 clip 进入 `actual.png`。

不要让像素工具自动搜索最相似区域、自动 resize 或自行删除 Header/Sidebar。这会掩盖真实定位和布局错误。

## 作用域分类

为每张参考图选择一种 `comparisonScope.type`：

| 类型 | 参考图内容 | 实际截图方式 |
| --- | --- | --- |
| `full-viewport` | 完整应用 viewport，包括全局导航 | viewport screenshot |
| `page-content` | 页面内容，不含全局 Header/Sidebar | 内容根节点 locator screenshot |
| `region` | 筛选区、表格、图表等页面区域 | 对应 region locator screenshot |
| `component` | 单个组件 | 组件根节点 locator screenshot |
| `unknown` | 无法可靠确认 | 阻塞像素比较 |

`status` 使用 `proposed`、`confirmed` 或 `blocked`。只有 `confirmed` 能生成通过状态的 alignment report。

分类证据优先级：

1. 用户或设计稿元数据明确说明；
2. 可确认的页面/组件边界和稳定 DOM；
3. 参考图边缘、背景、阴影和结构线索；
4. 尺寸或相似度只能作为候选证据。

## DOM 目标选择

优先级固定为：

1. 稳定 `data-visual-id`；
2. 稳定业务 `id`；
3. 项目公开、不会随构建变化的语义 selector；
4. 由多个 DOM 锚点确定的显式 clip；
5. 人工确认的坐标 clip。

禁止把混淆后的 CSS module hash、列表索引、`:nth-child()` 或视觉相似度搜索结果作为长期 selector。

对 `page-content`、`region` 和 `component` 优先使用 locator screenshot。`#app`、`body` 或应用根节点只适合 `full-viewport`，不能因为容易定位就作为内容设计稿的目标。

## 尺寸校准

先保持完整应用正常渲染，再读取目标元素 `getBoundingClientRect()`。当参考画布是 `1200×800` 而目标 DOM 不是该尺寸时，按以下顺序处理：

1. 核对参考 crop 和 selector 是否正确；
2. 核对 DPR、zoom、字体、状态和滚动位置；
3. 调整 browser viewport，让真实内容区尺寸收敛到参考尺寸；
4. 重新读取 bbox；
5. target bbox 先收敛到 tolerance 内，最终输出的 reference/actual PNG 画布必须完全等尺寸。

不要把 target DOM 强制改成参考尺寸来通过预检，除非这种尺寸本身就是页面实现要求。不要缩放截图。

`sizePolicy`：

- `exact`：viewport 已知，目标必须天然等尺寸；
- `calibrate-viewport`：应用壳占用空间未知，迭代调整 viewport；
- `fixed-component`：组件自身具有明确固定尺寸；
- `blocked`：无法建立可靠映射。

## 截图方法

### Locator screenshot

适用于内容区域、region 和 component：

```js
const target = page.locator("[data-visual-id='content-root']");
await target.waitFor({ state: 'visible' });
await page.evaluate(() => document.fonts.ready);
const bbox = await target.boundingBox();
await target.screenshot({ path: actualPath, animations: 'disabled' });
```

locator screenshot 将目标 border box 左上角归一为比较画布原点。应用壳仍留在页面中影响目标宽度和响应式行为。

### 显式 DOM clip

只有 locator 无法表达参考边界时才使用。clip 必须由稳定 DOM bbox、`clipInset` 和 `bleed` 计算，不能由像素相似度搜索自动决定。

- `clipInset`：从目标 border box 向内收缩。
- `bleed`：为外部阴影、焦点环或设计稿留白向外扩展。
- 两者必须写入 source manifest，并在每轮保持不变。

`locator` 模式不允许非零 `clipInset/bleed`；需要调整边界时改用 `dom-clip`。`capture-observation.actual.bboxInViewport` 使用 CSS 像素，PNG canvas 使用设备像素，生成器会结合 DPR 校验二者关系。

### 验收测量坐标

截图目标的 `bboxInViewport` 仍使用 viewport CSS 像素；但 `visualMeasurements[].bbox` 必须转换为 comparison canvas 的图像像素坐标。以 capture target 为原点扣除 clipInset、加入 bleed 并乘 DPR，同时声明：

```json
{
  "measurementSpace": {
    "origin": "comparison-canvas",
    "units": "image-px",
    "dprApplied": true
  }
}
```

每个稳定 `data-visual-id` 都要独立测量存在性、可见性、内容/状态匹配、bbox、overflow、occlusion 和 computed style。不要从图片反推这些 actual 值，否则 DOM 与图像证据不再独立。

## Capture-only mutation

固定 Header、浮层、光标或开发工具覆盖目标时，可在截图期间隐藏明确不属于比较作用域的元素。优先使用 `visibility: hidden` 保留布局占位，不使用 `display: none`。

每个 mutation 必须记录：

- selector；
- property/value；
- reason；
- 变更前后的 target bbox；
- `layoutDelta`；
- 是否在 tolerance 内。

mutation 只能影响截图，不得进入产品代码。若 target bbox 或相邻布局发生超容差变化，`captureMutationsLayoutSafe=false`，停止比较。

## 锚点和显式裁剪

当没有稳定 selector 时，至少使用两个非共线或能确定范围的锚点，例如内容左上角、表格右下角。每个 anchor 同时记录：

- reference point；
- actual selector/DOM point；
- expected role/text；
- measured delta；
- tolerance；
- pass/fail。

自动视觉搜索只能提出锚点候选。canonical alignment report 必须由 DOM、用户或明确结构证据确认。

## Mask 边界

mask 只用于目标作用域内部的不可重复动态像素，例如光标、时间、随机头像或实时数据。每个 mask 必须包含固定 bbox、原因和证据。

禁止 mask：

- Header/Sidebar 等本应通过作用域排除的整块区域；
- 布局位置错误的元素；
- 难以匹配的组件；
- 为通过阈值而临时扩大的差异区域。

mask 面积超出比较画布 5% 时默认阻塞，除非用户明确接受。

在 `comparisonScope.maskPolicy` 中记录 `maxAreaRatio` 和 `allowOverLimit`；只有用户明确接受时才能把后者设为 `true`。

## 对齐报告与阻塞条件

先使用 `assets/capture-observation.template.json` 记录浏览器实测值，再运行 `scripts/build-alignment-report.mjs` 确定性生成本轮 `alignment-report.json`。不能跨迭代复用，因为 viewport、DOM bbox 或 mutation 可能变化。

`status=pass` 必须同时满足：

- scope 已确认；
- 目标 selector/clip 已解析；
- 应用壳按契约保留；
- reference/actual PNG canvas 完全等尺寸，DOM bbox 与锚点误差在 tolerance 内；
- 截图原点已归一；
- state、字体、资产通过；
- capture-only mutation 不改变布局；
- 所有锚点通过；
- blocker 为空。

任一条件失败时不要运行 PNG diff。先修正捕获范围或环境，不把对齐错误交给 CSS 修复阶段。
