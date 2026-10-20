# 上下文预算与阶段交接

## 目标

把视觉还原从“一个模型上下文携带全部图片、规范、报告和历史”改成磁盘上的状态机。完整证据保留可追溯性，模型每次只读取完成当前阶段所需的最小事实集。

## 三层信息结构

1. **规范层**：参考图、visual contract、acceptance policy、完整测量报告。它们是磁盘上的 canonical artifacts，不直接拼进提示词。
2. **状态层**：`run-state.json` 只保存阶段、迭代、文件路径、摘要哈希、失败目标、门禁和下一动作。
3. **工作层**：`context-packet.json` 只保存当前阶段目标、不可变约束、允许修改文件、当前目标事实和所需局部图片。

不要把规范层复制到状态层或工作层。

## 默认预算

| 阶段 | 文本估算上限 | 完整/局部图片 | 目标上限 |
|---|---:|---:|---:|
| contract | 16k tokens | 1 张完整参考图 | 0 |
| generation | 24k tokens | 1 张完整参考图 | 60 个关键/重要目标 |
| repair | 12k tokens | 3 张局部证据图 | 1 |
| capture/acceptance | 10k tokens | 最多 3 张局部图 | 3 |

`build-context-packet.mjs` 使用保守的字符估算，并检查文本、图片和目标数。预算失败时缩小目标范围；不能通过删除关键事实、放大 mask 或忽略失败目标来降载。

## 阶段切换

每次切换阶段或迭代时：

1. 把完整新产物写入规范路径。
2. 运行 `build-run-state.mjs`，不要手工总结完整历史。
3. 运行 `build-context-packet.mjs`。
4. 新阶段只读取 Skill 核心、该阶段参考资料、context packet 和其中列出的图片。
5. 旧阶段消息、完整 stdout、旧截图和旧报告不进入新上下文。

如果执行环境支持独立任务/子上下文，可为 contract、generation、capture、repair 分别使用新上下文；交接文件仍是相同的两个 JSON。

## CLI 规则

- 所有报告脚本默认只在 stdout 打印单行摘要，完整报告写入 `--output`。
- 正常工作流禁止 `--verbose`。它只用于脚本本身出错且摘要不足以定位问题时。
- 不读取 `scripts/*.mjs` 来理解用法；使用 `--help` 和本 Skill 中的命令。
- 不把命令输出原样重复给后续阶段；只传文件路径和必要摘要。

## 图像规则

- contract/generation 查看完整 reference 一次。
- capture 的完整 viewport 只用于定位作用域或应用壳干扰。
- compare 为关键/重要目标生成 `evidence/<target>/reference.png`、`actual.png` 和 `diff.png`。
- repair 只看当前目标的三张裁图；父级几何导致多个子项同时失败时，才把父级和最多两个直接相关目标放进同一包。

## 迭代规则

不再把每轮完整 diagnosis/repair 历史复制成越来越大的报告。`iteration-delta.json` 只描述：

- 本轮目标与改动文件；
- 已解决目标；
- 仍失败目标及一个根因；
- 新回归；
- 下一轮最小修复范围。

完整趋势可从各 iteration 目录的 canonical reports 重建，无需占用模型上下文。
