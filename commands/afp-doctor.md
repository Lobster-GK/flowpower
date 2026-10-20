# Apollo Flowpower 项目自检

只调用 `afp_doctor` 工具，对当前项目的 Apollo Flowpower 运行状态做确定性诊断。

不要执行生码、修复、lint、启动、运行时检查或 scene 编排。`/afp-doctor` 只负责检查插件配置、场景模板、项目资产和内置资源健康状态。

## 执行规则

1. 必须调用 `afp_doctor`。
2. 不要自行解析 `.opencode/apollo-flowpower/config.yaml`。
3. 不要自行扫描或解析所有 scene YAML；以 `afp_doctor` 返回结果为准。
4. 如果 doctor 返回 `error`，先列阻塞问题，再给修复建议。
5. 如果 doctor 返回 `warning`，列出风险和建议，但说明是否仍可继续使用。
6. 如果 doctor 返回 `pass`，说明当前 AFP 配置和模板检查通过。
7. 如果 doctor 报告 `config.migrated=true`，明确告诉用户插件已经自动补齐了哪些默认配置项。

## 输出格式

使用中文输出：

```text
状态：pass / warning / error

阻塞问题：
- ...

警告：
- ...

自动补全：
- ...

建议：
- ...
```

如果没有某类内容，写“无”。
