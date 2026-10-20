---
name: frontend-api-integration
description: >
  用于根据接口文档或接口mcp为前端页面接入 API，包括 service 调用，逻辑实现，接口mock数据生层。仅用于用户明确提供接口文档或接口mcp并且要求生成接口逻辑时。仅适用于前端 Apollo项目。禁止应用于后端工程以及非前端 Apollo项目。
---

# 接口契约

这个 Skill 的产物是接口逻辑补充结果.

接口文档只接受用户显式指定：

- 用户指定的 YAML、Markdown、xlsx 文档。
- 不自动扫描项目根目录、`docs/api/` 或其它默认路径。
- 用户未指定接口文档时，直接跳过接口补充。

## 接口逻辑补充规则

- 接口定义必须定义在目标目录下 `services` 目录中，如果目标目录下没有 `services` 目录，则按照 `Apollo 框架规范` 自动创建 或向上查找最近的 `services` 目录。
- `services` 目录下接口定义参考其他 `services` 目录下的接口定义。
- 所有 接口的引入必须在对应目录的 `models` 目录下，如果目标目录下没有 `models` 目录，则按照 `Apollo 框架规范` 自动创建 或向上查找最近的 `models` 目录。
- 接口的返回内容必须严格做判空处理，放置出现空指针异常。
- 接口数据保存优先保存在 `model` 的 `state`, 如果判断出当前接口的数据仅在特定的组件中用，则数据使用 `useState` 存在组件中。
- 说明、注释和报告使用中文；代码标识符、路径、API 字段和 JSON key 保持英文。
- 默认所有接口都是POST请求，除非接口文档中有明确证据指明当前接口是GET请求。

## 接口Mock

- 默认所有接口必须在项目内mock，mock文件写在`mock`目录下，如果没有mock目录，则自动在项目根目录创建 `mock` 目录。
- mock文件示例
```js
const Mock = require('mockjs')

module.exports = {
  'POST /userList': function (req, res) {
    setTimeout(() => {
      res.json({
        code: 0,
        data: Mock.mock({
          'list|10': [
            {
              userId: '@guid',
              name: '@name',
              email: '@email'
            }
          ]
        })
      })
    }, 1000)
  },
}
```
- mock内容必须严格按照接口文档生成，字段数据类型必须对应，尤其枚举类型，如果文档中明确了枚举项，则必须严格遵循。
- mock内容开发参考 http://apaas.cmbc.com.cn/apollo_docs/#/packages/apollo-test/mock-guide
