---
name: cmbc-apollo-code-generator
description: 根据需求生成 Apollo 3.0 框架的前端代码，包括 Model、Page、View、Service、Route 等文件结构。用户提到需要生成 Apollo 前端代码、页面组件、model 逻辑时使用此 skill。
---

# Apollo 3.0 代码生成器

根据需求生成符合 Apollo 3.0 框架规范的前端代码。

## 核心规范

- **View 文件**：纯视图组件，不包含业务逻辑调用
- **Page 文件**：负责调用 model 中的 reducer 或 thunk
- **调用 reducer/thunk 时**：参数格式必须与 model 中定义一致，必须在 Page.js 中调用
- **services 中的 request**：必须从 '@/utils/request.js' 导入
- **图标**：从 @ant-design/icons 导入
- **页面数据**：必须定义在对应的 model 中
- **model 文件**：使用 reducer、thunk、subscription 字段（非 reducers、thunks、subscriptions）
- **model 中**：使用 async/await 语法，不使用 generator 函数
- **在调用 model 中的 reducer 或 thunk 时，不要省略 namespace**
- **Page 页面调用完 reducer 后调用 thunk 的话，thunk 方法内如果使用到 state 的数据，应该使用 select 方法从 state 获取**
- **如果列表有分页的话，务必区分使用单独的 Pagination 组件和使用 Table 组件的 pagination 属性，两者的区别**
- **在生成 css 文件时，你需要查看 apollo.config.js 文件中的 output.cssModulesExclude 配置，配置中包含的路径不需要使用 css modules 的规则，否则使用 css modules 的规则**
- **禁止删除、重构或改写已有代码块**
- **禁止生成未使用变量、未引用模块或死代码**
- **优先参考提示词中的案例，再考虑当前项目中的案例**
- **生成页面代码后必须在 src/router 中补充页面路由**

## Workflow

1. **理解需求**
   - 确认页面功能（列表、详情、表单、统计等）
   - 确认是否需要接口调用
   - 确认 UI 组件需求（Table、Form、Chart 等）

2. **生成目录结构**
   ```
   pages/{PageName}/
   ├── models/
   │    └── index.js
   ├── services/
   │    └── index.js
   ├── routes/
   │    └── home/
   │         ├── HomePage.js
   │         ├── HomeView.js
   │         └── HomeView.less
   ├── index.js
   └── route.js
   ```

3. **生成 Model 文件**
   - 定义 namespace
   - 定义 state（data、pagination、searchParams、loading 等）
   - 定义 reducer（update、setLoading）
   - 定义 thunk（异步请求方法）
   - 调用 services 中的接口

4. **生成 Service 文件**
   - 导入 request from '@/utils/request'
   - 定义 API 方法

5. **生成 Page 文件**
   - 使用 useModel 获取 state、reducers、thunks
   - 调用 thunk 获取数据
   - 渲染 View 组件

6. **生成 View 文件**
   - 使用 @cmbc/apollo-uecp-ui-pc 组件
   - 纯 UI 展示，不含业务逻辑

7. **生成 Route 文件**
   - 配置路由路径
   - 使用 CacheRoute

8. **生成 Index 文件**
   - 使用 dynamic 导入 models 和 component

## 代码模板

### Model

```javascript
import { queryList, saveData } from '../services';

export default {
  namespace: 'home',

  state: {
    data: [],
    pagination: { current: 1, pageSize: 10, total: 0 },
    searchParams: {},
    loading: false,
  },

  reducer: {
    update(prevState, action) {
      return { ...prevState, ...action.payload };
    },
    setLoading(prevState, action) {
      return { ...prevState, loading: action.payload };
    },
  },

  thunk: {
    async queryList({ payload }, { put, select }) {
      put({ type: 'home/setLoading', payload: true });

      const { pagination, searchParams } = select((state) => state);
      const res = await queryList({ ...payload, ...pagination, ...searchParams });

      put({
        type: 'home/update',
        payload: {
          data: res.data,
          pagination: { ...pagination, total: res.total },
          loading: false,
        },
      });

      return res;
    },
  },

  subscription: {},
};
```

### Service

```javascript
import request from '@/utils/request';

export async function queryList(params) {
  return request('/api/list', params, 'POST');
}

export async function saveData(params) {
  return request('/api/save', params, 'POST');
}
```

### Page

```javascript
import React, { useEffect } from 'react';
import { useModel } from '@cmbc/apollo';
import HomeView from './routes/home';

const HomePage = () => {
  const [state, reducers, thunks] = useModel('home');

  useEffect(() => {
    thunks.queryList({ payload: {} });
  }, []);

  const handleSearch = (params) => {
    reducers.update({
      payload: {
        searchParams: params,
        pagination: { ...state.pagination, current: 1 },
      },
    });
    thunks.queryList({ payload: {} });
  };

  const handleTableChange = (pagination) => {
    reducers.update({ payload: { pagination } });
    thunks.queryList({ payload: {} });
  };

  return (
    <HomeView
      data={state.data}
      loading={state.loading}
      pagination={state.pagination}
      onSearch={handleSearch}
      onChange={handleTableChange}
    />
  );
};

export default HomePage;
```

### View

```javascript
import React from 'react';
import { Table, Form, Input, Button } from '@cmbc/apollo-uecp-ui-pc';
import { SearchOutlined } from '@ant-design/icons';
import styles from './HomeView.less';

const HomeView = ({ data, loading, pagination, onSearch, onChange }) => {
  const columns = [
    {
      title: '序号',
      dataIndex: 'id',
      key: 'id',
      width: 80,
      align: 'center',
      render: (_, __, index) => index + 1,
    },
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      width: 120,
      align: 'center',
    },
    {
      title: '年龄',
      dataIndex: 'age',
      key: 'age',
      width: 80,
      align: 'center',
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      align: 'center',
    },
  ];

  return (
    <div className={styles.container}>
      <Form layout="inline" onFinish={onSearch}>
        <Form.Item name="keyword" initialValue="">
          <Input placeholder="请输入关键词" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
            搜索
          </Button>
        </Form.Item>
      </Form>
      <Table
        columns={columns}
        dataSource={data}
        pagination={pagination}
        onChange={onChange}
        rowKey="id"
        loading={loading}
      />
    </div>
  );
};

export default HomeView;
```

### Less

```less
.container {
  padding: 16px;
}
```

### Index

```javascript
import { dynamic } from '@cmbc/apollo';
import Spin from '@/components/Spin';

export default app =>
  dynamic({
    app,
    models: () => [import(/* webpackChunkName: "home" */ './models')],
    component: () => import(/* webpackChunkName: "home" */ './route'),
    LoadingComponent: Spin,
  });
```

### Route

```javascript
import React from 'react';
import { connect } from '@cmbc/apollo';
import CacheRoute, { CacheSwitch } from 'react-router-cache-route';
import HomePage from './routes/home/HomePage';

function IndexPage(props) {
  const { match: { path } } = props;

  return (
    <CacheSwitch>
      <CacheRoute exact path={`${path}/home`} component={HomePage} cacheKey={`${path}/home`} />
    </CacheSwitch>
  );
}

export default connect()(IndexPage);
```

## 注意事项

- Apollo 项目使用 @cmbc/apollo 作为状态管理
- UI 组件根据项目配置选择，如果项目继承了 uecp 则优先使用 @cmbc/apollo-uecp-ui-pc
- 图标从 @ant-design/icons 导入
- 保持文件结构清晰，View 中不包含业务逻辑
- 遵循 Apollo 3.0 项目结构规范
- 所有组件使用方式、属性命名、事件绑定、样式引用等，必须与 Apollo 3.0 官方示例严格一致
- 禁止添加未在文档或上下文中出现的自定义属性、逻辑或 API
- 不得修改现有文件中任何未明确指示要修改的代码