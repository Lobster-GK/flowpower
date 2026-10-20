# 渲染收敛协议

## 目录

- 比较环境
- 作用域门禁
- 指标解释
- 组件感知验收
- 诊断顺序
- 修复批次
- 回归与停止条件

## 比较环境

每一轮必须保持相同：

- 浏览器及版本；
- viewport、DPR 和缩放；
- route、数据、状态和滚动位置；
- 字体、图片和图标资源；
- 截图根节点与裁剪边界；
- 动画、transition、光标、时间和随机数冻结策略。

等待 `document.fonts.ready`、关键图片加载和页面稳定后截图。固定等待时间不能替代稳定条件。

Visual Lab 模式的数据只能来自 `src/visual-fixture.json`。此模式不安装 API route，不读取真实接口，也不使用 data fixture contract/lock；改用 `visual-lab-lock.json` 固定静态 fixture 和源码哈希。

参考图与实际图尺寸不一致时立即停止像素比较，先修正 viewport 或裁剪。禁止隐式 resize。

## 作用域门禁

每轮先根据 `comparisonScope` 保持完整应用渲染，再只截目标 viewport、locator 或 DOM clip。内容区域设计稿不得与包含 Header/Sidebar 的完整 viewport screenshot 比较。

运行像素工具前必须生成并校验本轮 `alignment-report.json`。以下情况直接停止：

- scope 未确认；
- selector/clip 未唯一解析；
- 应保留的应用壳被删除或改变布局；
- reference/actual PNG 画布不完全等尺寸；
- capture-only mutation 改变 target bbox；
- state、字体、资产或锚点检查失败。
- Visual Lab lock、静态 fixture、运行时冻结或可见数据断言失败。

完整规则见 [比较作用域与画布对齐协议](comparison-scope-alignment.md)。

## 指标解释

`compare-png.mjs` 输出：

- `meanAbsoluteError`：RGB 绝对误差的归一化平均值；适合判断总体趋势。
- `differentPixelRatio`：最大通道差超过阈值的像素比例；适合定位大面积错色或错位。
- `differenceBounds`：所有差异像素的包围盒。
- `regions[]`：视觉契约中各 region 的独立指标。
- `perceptual`：先做 alpha 合成和 block-average 低通，再比较区域颜色与边缘；用于降低抗锯齿、细线和组件内部绘制差异的影响。
- `rawPixel.role`：说明原始像素指标是诊断、评分还是硬门禁。

原始指标会受到字体抗锯齿、平台字形和亚像素渲染影响。在默认 `component-faithful` 中，它们生成 diff 热力图但不直接决定通过。不可只根据单一全局分数做判断。

优先观察：

1. critical region 是否退化；
2. 差异包围盒是否集中；
3. MAE 与差异比例是否同步改善；
4. diff 的形状是否指向位移、尺寸、排版或颜色问题。

## 组件感知验收

使用 `evaluate-visual-acceptance.mjs` 合并四类证据：

1. alignment 中的作用域、fixture、状态和资源门禁；
2. `visualMeasurements` 中的 DOM bbox、可见性、内容、overflow 和 occlusion；
3. visual contract 与 component adaptation 的全局/局部容差；
4. pixel report 的低通感知指标和原始诊断指标。

`visual-evaluation.status` 才是自动验收结论。任何 hard gate、critical region 或 required element 失败都不能被整体分数抵消。组件级允许差异只能放宽具体样式属性，不能放宽存在性、内容、状态、overflow 或 occlusion。完整规则见 [组件感知验收协议](component-aware-acceptance.md)。

## 诊断顺序

### 环境类

- 整页等比例偏大/偏小：viewport、DPR、zoom 或截图裁剪错误。
- 所有文字宽度异常：字体未加载或字体族错误。
- 图标整体不同：资产或图标库错误。
- 页面内容状态不同：fixture、请求或交互状态没有固定。

环境问题优先于 CSS 修复。

### 几何类

- 大块双边缘：位置偏移。
- 一侧边缘重合、另一侧分离：宽高错误。
- 下游所有区域同步偏移：父容器 padding/gap/尺寸错误。
- 只在文字后续兄弟区域偏移：文字换行或行高错误。

优先修父约束，不逐个补偿子元素。

### 排版类

- 字符轮廓整体差异：字体族或字重。
- 基线一致但上下边界不同：字号或行高。
- 行尾逐渐偏离：字宽、letter-spacing 或容器宽度。
- 文本造成容器高度变化：white-space、line-height 或真实字体加载。

### 表面样式类

- 区域内部均匀差异：背景色或透明度。
- 仅轮廓差异：边框宽度、颜色或圆角。
- 外围模糊差异：阴影参数。
- 高频小块差异：图标、抗锯齿或细线。

## 修复批次

每轮只读取 repair `context-packet.json` 中当前目标的契约事实、失败摘要和三张局部 evidence crop。默认只修复一个目标；只有同一父级根因同时控制多个目标时，才显式提高到最多三个相互关联的 region。

修复后建立一个 `iteration-delta.json`，不复制完整历史。增量必须满足：

- 每个 remaining target 只有一个可证伪根因和局部证据；
- 只列出实际改动文件、属性、已解决目标、新回归与下一最小修复；
- 不重复 reference、完整 contract、完整 pixel report 或早期迭代内容；
- 不把多个独立假设塞进同一修改；
- 下一轮重新生成 run state 和 context packet。

若根因是 visual contract 错误，先更新 contract 和 changeLog，再改代码。

## 回归与停止条件

出现以下任一情况，将本轮标为 `regressed`：

- critical region 差异比例增加超过任务容差；
- 修复区域改善但无关区域明显退化；
- 元素、文案或交互状态丢失；
- 为提高分数改变 viewport、裁剪或隐藏内容；
- 自动指标改善但人工审查发现结构性错误。

出现以下任一情况应暂停并报告：

- 连续两轮指标没有实质改善；
- 同一属性在两组值之间振荡；
- 剩余差异主要来自无法取得的字体或资产；
- UI 库内部结构阻止稳定覆盖；
- 参考图本身包含不可复现的动态内容。

通过条件由任务定义。默认阈值只能作为初始门槛，关键区域必须单独审查。完整历史保留在各 iteration 的 canonical reports 中，需要追溯时按路径读取，不进入常规修复上下文。
