# frontend-api-integration 描述

## 干什么用

用于基于明确接口文档完成前端 API 集成，包括 service 调用、请求/响应类型、endpoint 连接、页面数据加载、loading/error 状态和必要的数据映射。

## 什么时候用

- 用户要求“集成接口”“接接口”“connect this page to API”或“integrate API logic”。
- 用户提供了 Swagger、OpenAPI、curl、接口 Markdown、TypeScript interface 或其它明确接口资料。
- 页面 UI 已存在或已生成，现在需要把静态页面接入真实接口数据。

## 什么时候不用

- 不用于 API 设计、后端实现、数据库 schema 或服务端联调。
- 不用于没有接口文档的猜测式接入，也不主动扫描默认接口目录。
- 不用于 UI 布局生成、纯 mock 数据、lint 修复、启动失败或浏览器运行时问题。
