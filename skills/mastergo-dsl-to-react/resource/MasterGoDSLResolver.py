"""
MasterGoDSLResolver — DSL 预处理脚本 v5.3
将 MasterGo DSL 文件转换为「对模型友好」的 Markdown 文档（_resolved.md）。

架构：
  输出格式为 Markdown，resolver 负责预计算所有 CSS，模型零翻译：
  - 节点树：ASCII 可视结构
  - 叶子节点清单：每节点含预计算定位 CSS + 字体/颜色 CSS（token 已展开）
  - 容器清单：每个 FRAME/INSTANCE 含自身定位 CSS + flex 子布局 CSS
  - LESS Token 定义：颜色/阴影变量供 .less 文件使用

优化项（按收益排序）：
  体积优化：
  1. [★★★] antd 图标识别：icon-<name>-outlined → { type:ICON, antdIcon }, 丢弃 SVG children
  2. [★★★] Token 就地解析：paint/font/effect → 实际色值/字体/阴影
  3. [★★ ] 背景形状 PATH 转 CSS：圆角矩形 PATH → bgShape 对象
  4. [★  ] 省略默认值：textDecoration=none / letterSpacing=normal 不输出
  5. [★  ] 删除 componentId

  语义优化（AI理解收益）：
  6. [★★ ] 状态节点标注：Tab-选中 → { state:"selected", baseName:"Tab" }
  7. [★★ ] LAYER 语义化：纯色块/分割线/进度条自动识别 semantic 字段
  8. [★  ] 纯包装 FRAME 消除：无语义属性的单子节点容器直接透传
  9. [★★★] Table INSTANCE 列结构整合：children→columns[] 数组，弱模型友好
  10.[★★★] INSTANCE 组件不展开子树：内部节点收入 props_data，禁止手写 DOM
  11.[★★★] Menu/Sider navItems 构建：raw children → 去重 items 树，弱模型友好
  12.[★★★] jsxHint 含 import 来源：防止弱模型使用 antd 替代 UECP 等三方库

  修复（还原度关键）：
  13. [★★★] 保留 componentInfo.description（三方组件 import）
  14. [★★★] 保留 relativeX/Y（绝对定位坐标）
  15. [★★ ] 保留 PATH path 数组（SVG 路径数据）
  16. [★  ] 预生成 lessVarHints（LESS 变量表）

用法：
  python resource/MasterGoDSLResolver.py <dsl文件路径>
  输出：同目录下 <原文件名>_resolved.md
"""

import json
import os
import re
import sys

# ── 已知组件 Props 快速参考表 ─────────────────────────
# 在 _resolved.md 中为已知 componentName 的 INSTANCE 节点附加 prop 类型提示，
# 减少弱模型在 STEP A 填写 props 时的幻觉。
# 格式：{ componentName: { 'required': [(prop, type, hint)], 'common': [...] } }
# hint 字段说明数据来源，帮助模型知道从哪里取值。
KNOWN_COMPONENT_PROPS: dict[str, dict] = {
    'Table': {
        'required': [
            ('columns',    'Column[]',          '← 来自 columns 字段，直接传入'),
            ('dataSource', 'object[]',           '← 来自 dataSource 字段，直接传入'),
        ],
        'common': [
            ('rowSelection', '{type,selectedRowKeys:[],onChange:()=>{}}', '← 来自 rowSelection 字段'),
            ('pagination',   'false | PaginationConfig',                  '无分页传 false'),
            ('scroll',       '{x?: number, y?: number}',                  '超宽/高时设置'),
        ],
    },
    'Form': {
        'required': [],
        'common': [
            ('form',           'FormInstance',                       'Form.useForm()[0]'),
            ('layout',         "'horizontal'|'vertical'|'inline'",   '布局方式'),
            ('initialValues',  'object',                             '表单初始值'),
            ('onFinish',       '(values: object) => void',           '提交回调'),
        ],
    },
    'Form.Item': {
        'required': [
            ('label', 'string',   '← 来自 props_data / 子节点文字'),
            ('name',  'NamePath', '字段 key，与 Form 数据对象对应'),
        ],
        'common': [
            ('rules',    "Rule[]",    "如 [{required:true,message:'请填写'}]"),
            ('required', 'boolean',   '快捷必填标记'),
        ],
    },
    'Input': {
        'required': [],
        'common': [
            ('placeholder', 'string',        '← 来自 props_data 文字'),
            ('value',       'string',        '受控值'),
            ('onChange',    '(e)=>void',     '变更回调'),
            ('disabled',    'boolean',       '禁用状态'),
        ],
    },
    'Select': {
        'required': [
            ('options', '{label:string,value:any}[]', '选项列表，来自 props_data / 子节点'),
        ],
        'common': [
            ('placeholder', 'string',                   '← 来自 props_data 文字'),
            ('value',       'any',                      '受控值'),
            ('onChange',    '(value, option)=>void',    '变更回调'),
            ('mode',        "'multiple'|'tags'",         '多选模式'),
            ('allowClear',  'boolean',                   '可清空'),
        ],
    },
    'Upload': {
        'required': [
            ('fileList', 'UploadFile[]',            '← 来自 props_data list_items（每组一个文件）'),
            ('onChange', '({fileList})=>void',      '状态变更回调，必须更新 fileList state'),
        ],
        'common': [
            ('action',   'string',   '上传接口地址'),
            ('multiple', 'boolean',  '是否多选'),
            ('accept',   'string',   "如 '.pdf,.jpg'"),
            ('maxCount', 'number',   '最大文件数'),
        ],
    },
    'Menu': {
        'required': [
            ('items', 'MenuItem[]', '← 来自 navItems 字段，按格式转换后传入'),
        ],
        'common': [
            ('mode',             "'inline'|'vertical'|'horizontal'", '通常为 inline（左侧菜单）'),
            ('selectedKeys',     'string[]',                          '选中项，由路由控制'),
            ('defaultOpenKeys',  'string[]',                          '默认展开项'),
        ],
    },
    'Tabs': {
        'required': [
            ('items', '{key:string,label:string,children:ReactNode}[]',
             '← 来自 tabList 字段，children 为各 Tab 内容'),
        ],
        'common': [
            ('activeKey',    'string',        '受控选中 Tab，由路由控制'),
            ('onChange',     '(key)=>void',   '切换回调'),
            ('tabPosition',  "'top'|'left'",  '竖向导航用 left'),
        ],
    },
    'Button': {
        'required': [],
        'common': [
            ('type',     "'primary'|'default'|'dashed'|'text'|'link'", '← 来自 props_data / 设计稿颜色'),
            ('icon',     'ReactNode',                                   '← 来自 props_data icons'),
            ('size',     "'large'|'middle'|'small'",                   '← 来自 componentProps'),
            ('disabled', 'boolean',                                     '禁用状态'),
            ('onClick',  '()=>void',                                    '点击回调'),
        ],
    },
    'Steps': {
        'required': [
            ('items', '{title:string,description?:string,status?:string}[]',
             '← 来自 props_data list_items'),
        ],
        'common': [
            ('current',   'number',                    '当前步骤（0-based）'),
            ('direction', "'horizontal'|'vertical'",   '布局方向'),
        ],
    },
}

# ── 字体粗细映射 ────────────────────────────────────
FONT_WEIGHT_MAP = {
    'Bold': 700, 'SemiBold': 600, 'Medium': 500,
    'Regular': 400, 'Normal': 400, 'Light': 300, 'Thin': 100,
    # 中文 style 名
    '中等': 500, '常规': 400, '粗体': 700, '细体': 300,
}

# ── 字重 → 可读名称 ──────────────────────────────────
FONT_WEIGHT_NAMES = {
    100: 'thin', 200: 'extralight', 300: 'light',
    400: 'regular', 500: 'medium', 600: 'semibold',
    700: 'bold', 800: 'extrabold', 900: 'black',
}

# ── 常见颜色 → 语义名称 ──────────────────────────────
COLOR_SEMANTIC_NAMES = {
    'ffffff': 'white',
    '000000': 'black',
}

# ── Ant Design Icons 已知图标名（kebab-case）────────────────────────────────
# 完整覆盖 @ant-design/icons 5.x 所有 481 个图标基础名
# 由 lib/icons/index.d.ts 导出列表自动生成，去掉 Outlined/Filled/TwoTone 后缀后转 kebab-case
ANTD_ICON_NAMES: set[str] = {
    'account-book', 'aim', 'alert', 'alibaba', 'align-center', 'align-left', 'align-right', 'alipay',
    'alipay-circle', 'alipay-square', 'aliwangwang', 'aliyun', 'amazon', 'amazon-circle', 'amazon-square', 'android',
    'ant-cloud', 'ant-design', 'apartment', 'api', 'apple', 'appstore', 'appstore-add', 'area-chart',
    'arrow-down', 'arrow-left', 'arrow-right', 'arrow-up', 'arrows-alt', 'audio', 'audio-muted', 'audit',
    'backward', 'baidu', 'bank', 'bar-chart', 'barcode', 'bars', 'behance', 'behance-circle',
    'behance-square', 'bell', 'bg-colors', 'bilibili', 'block', 'bold', 'book', 'border',
    'border-bottom', 'border-horizontal', 'border-inner', 'border-left', 'border-outer', 'border-right', 'border-top', 'border-verticle',
    'borderless-table', 'box-plot', 'branches', 'bug', 'build', 'bulb', 'calculator', 'calendar',
    'camera', 'car', 'caret-down', 'caret-left', 'caret-right', 'caret-up', 'carry-out', 'check',
    'check-circle', 'check-square', 'chrome', 'ci', 'ci-circle', 'clear', 'clock-circle', 'close',
    'close-circle', 'close-square', 'cloud', 'cloud-download', 'cloud-server', 'cloud-sync', 'cloud-upload', 'cluster',
    'code', 'code-sandbox', 'code-sandbox-circle', 'code-sandbox-square', 'codepen', 'codepen-circle', 'codepen-square', 'coffee',
    'column-height', 'column-width', 'comment', 'compass', 'compress', 'console-sql', 'contacts', 'container',
    'control', 'copy', 'copyright', 'copyright-circle', 'credit-card', 'crown', 'customer-service', 'dash',
    'dashboard', 'database', 'delete', 'delete-column', 'delete-row', 'delivered-procedure', 'deployment-unit', 'desktop',
    'diff', 'dingding', 'dingtalk', 'dingtalk-circle', 'dingtalk-square', 'disconnect', 'discord', 'dislike',
    'docker', 'dollar', 'dollar-circle', 'dot-chart', 'dot-net', 'double-left', 'double-right', 'down',
    'down-circle', 'down-square', 'download', 'drag', 'dribbble', 'dribbble-circle', 'dribbble-square', 'dropbox',
    'dropbox-circle', 'dropbox-square', 'edit', 'ellipsis', 'enter', 'environment', 'euro', 'euro-circle',
    'exception', 'exclamation', 'exclamation-circle', 'expand', 'expand-alt', 'experiment', 'export', 'eye',
    'eye-invisible', 'facebook', 'fall', 'fast-backward', 'fast-forward', 'field-binary', 'field-number', 'field-string',
    'field-time', 'file', 'file-add', 'file-done', 'file-excel', 'file-exclamation', 'file-gif', 'file-image',
    'file-jpg', 'file-markdown', 'file-pdf', 'file-ppt', 'file-protect', 'file-search', 'file-sync', 'file-text',
    'file-unknown', 'file-word', 'file-zip', 'filter', 'fire', 'flag', 'folder', 'folder-add',
    'folder-open', 'folder-view', 'font-colors', 'font-size', 'fork', 'form', 'format-painter', 'forward',
    'frown', 'fullscreen', 'fullscreen-exit', 'function', 'fund', 'fund-projection-screen', 'fund-view', 'funnel-plot',
    'gateway', 'gif', 'gift', 'github', 'gitlab', 'global', 'gold', 'golden',
    'google', 'google-circle', 'google-plus', 'google-plus-circle', 'google-plus-square', 'google-square', 'group', 'harmony-o-s',
    'hdd', 'heart', 'heat-map', 'highlight', 'history', 'holder', 'home', 'hourglass',
    'html5', 'idcard', 'ie', 'ie-circle', 'ie-square', 'import', 'inbox', 'info',
    'info-circle', 'insert-row-above', 'insert-row-below', 'insert-row-left', 'insert-row-right', 'instagram', 'insurance', 'interaction',
    'issues-close', 'italic', 'java', 'java-script', 'key', 'kubernetes', 'laptop', 'layout',
    'left', 'left-circle', 'left-square', 'like', 'line', 'line-chart', 'line-height', 'link',
    'linkedin', 'linux', 'loading', 'loading3-quarters', 'lock', 'login', 'logout', 'mac-command',
    'mail', 'man', 'medicine-box', 'medium', 'medium-circle', 'medium-square', 'medium-workmark', 'meh',
    'menu', 'menu-fold', 'menu-unfold', 'merge', 'merge-cells', 'message', 'minus', 'minus-circle',
    'minus-square', 'mobile', 'money-collect', 'monitor', 'moon', 'more', 'muted', 'node-collapse',
    'node-expand', 'node-index', 'notification', 'number', 'one-to-one', 'open-a-i', 'ordered-list', 'paper-clip',
    'partition', 'pause', 'pause-circle', 'pay-circle', 'percentage', 'phone', 'pic-center', 'pic-left',
    'pic-right', 'picture', 'pie-chart', 'pinterest', 'play-circle', 'play-square', 'plus', 'plus-circle',
    'plus-square', 'pound', 'pound-circle', 'poweroff', 'printer', 'product', 'profile', 'project',
    'property-safety', 'pull-request', 'pushpin', 'python', 'qq', 'qq-circle', 'qq-square', 'qrcode',
    'question', 'question-circle', 'radar-chart', 'radius-bottomleft', 'radius-bottomright', 'radius-setting', 'radius-upleft', 'radius-upright',
    'read', 'reconciliation', 'red-envelope', 'reddit', 'reddit-circle', 'reddit-square', 'redo', 'reload',
    'rest', 'retweet', 'right', 'right-circle', 'right-square', 'rise', 'robot', 'rocket',
    'rollback', 'rotate-left', 'rotate-right', 'ruby', 'safety', 'safety-certificate', 'save', 'scan',
    'schedule', 'scissor', 'search', 'security-scan', 'select', 'send', 'setting', 'shake',
    'share-alt', 'shop', 'shopping', 'shopping-cart', 'shrink', 'signal', 'signature', 'sisternode',
    'sketch', 'sketch-circle', 'sketch-square', 'skin', 'skype', 'slack', 'slack-circle', 'slack-square',
    'sliders', 'small-dash', 'smile', 'snippets', 'solution', 'sort-ascending', 'sort-descending', 'sound',
    'split-cells', 'spotify', 'star', 'step-backward', 'step-forward', 'stock', 'stop', 'strikethrough',
    'subnode', 'sun', 'swap', 'swap-left', 'swap-right', 'switcher', 'sync', 'table',
    'tablet', 'tag', 'tags', 'taobao', 'taobao-circle', 'taobao-square', 'team', 'thunderbolt',
    'tik-tok', 'to-top', 'tool', 'trademark', 'trademark-circle', 'transaction', 'translation', 'trophy',
    'truck', 'twitch', 'twitter', 'twitter-circle', 'twitter-square', 'underline', 'undo', 'ungroup',
    'unlock', 'unordered-list', 'up', 'up-circle', 'up-square', 'upload', 'usb', 'user',
    'user-add', 'user-delete', 'user-switch', 'usergroup-add', 'usergroup-delete', 'verified', 'vertical-align-bottom', 'vertical-align-middle',
    'vertical-align-top', 'vertical-left', 'vertical-right', 'video-camera', 'video-camera-add', 'wallet', 'warning', 'wechat',
    'wechat-work', 'weibo', 'weibo-circle', 'weibo-square', 'whats-app', 'wifi', 'windows', 'woman',
    'x', 'yahoo', 'youtube', 'yuque', 'zhihu', 'zhihu-circle', 'zhihu-square', 'zoom-in',
    'zoom-out',
}

# 图标名称别名：设计稿命名 → antd 标准 kebab-case 名
# 用于覆盖设计系统与 antd 命名不一致的图标
ANTD_ICON_ALIASES: dict[str, str] = {
    # 可见性
    'visible':    'eye',
    'invisible':  'eye-invisible',
    'show':       'eye',
    'hide':       'eye-invisible',
    # 省略号
    'more':       'ellipsis',
    # 排序
    'sort':       'sort-ascending',
    # 分享（antd 只有 share-alt，无 share）
    'share':      'share-alt',
    # 位置（antd 无 location，用 environment）
    'location':   'environment',
    # 身份证（antd 用 idcard，无连字符）
    'id-card':    'idcard',
    # 加粗方向箭头 → caret 系列（设计系统的 bold 变体在 antd 中不存在）
    'down-bold':  'caret-down',
    'up-bold':    'caret-up',
    'left-bold':  'caret-left',
    'right-bold': 'caret-right',
    'more-bold':  'ellipsis',
}


def _to_pascal(kebab: str) -> str:
    """top-bold → TopBold"""
    return ''.join(part.capitalize() for part in kebab.split('-'))


def _match_antd_icon(instance_name: str) -> str | None:
    """
    从 INSTANCE 名称提取 antd icon 组件名。
    支持格式：
      icon-<name>-outlined   → <Name>Outlined
      icon-<name>-filled     → <Name>Filled
      icon-<name>-twotone    → <Name>TwoTone
      <prefix>/icon-<name>-outlined → <Name>Outlined
    返回 None 表示无法匹配。
    """
    STYLE_SUFFIXES = ('-outlined', '-filled', '-twotone', '-two-tone', '-colorful')
    STYLE_MAP = {
        '-twotone': 'TwoTone', '-two-tone': 'TwoTone',
        '-filled': 'Filled', '-colorful': 'TwoTone',
    }

    name_lower = instance_name.lower()

    # 找到 icon- 或 icon/ 的起始位置
    m = re.search(r'icon[-/]', name_lower)
    if not m:
        return None

    # 取 "icon-" 之后的部分
    rest = name_lower[m.end():]          # e.g. "down-bold-outlined", "upload-outlined"

    # 剥离已知的 style 后缀
    style = 'Outlined'  # 默认
    for suffix in STYLE_SUFFIXES:
        if rest.endswith(suffix):
            style = STYLE_MAP.get(suffix, 'Outlined')
            rest = rest[: -len(suffix)]  # 去掉 style 后缀
            break

    icon_name = rest  # e.g. "down-bold", "upload", "robot"

    # 别名映射（设计稿命名 → antd 标准名）
    icon_name = ANTD_ICON_ALIASES.get(icon_name, icon_name)

    # 直接匹配
    if icon_name in ANTD_ICON_NAMES:
        return _to_pascal(icon_name) + style

    # 去掉 -bold 后缀再匹配（未覆盖的 bold 变体 → 用基础名，antd 无 bold 变体）
    if icon_name.endswith('-bold'):
        base = icon_name[:-5]
        if base in ANTD_ICON_NAMES:
            return _to_pascal(base) + style  # 去掉 -bold，如 down-bold → DownOutlined

    return None


def _estimate_border_radius(d: str) -> int | None:
    """
    从圆角矩形 SVG path data 估算 border-radius。
    策略：取 M 指令的第二个坐标（通常是圆角值）。
    示例：M64 3L0 3C0 1.34315... → radius ≈ 3
    """
    m = re.match(r'M[\d.]+\s+([\d.]+)', d.strip())
    if m:
        r = round(float(m.group(1)))
        return r if 0 < r < 100 else None
    return None


class MasterGoDSLResolver:
    def __init__(self, input_path: str):
        self.input_path = input_path
        self.styles: dict = {}
        # 统计信息
        self._stats: dict = {
            'antd_icons_replaced': 0,
            'bg_paths_converted': 0,
            'defaults_omitted': 0,
            'state_nodes_annotated': 0,
            'layers_semantified': 0,
            'wrappers_eliminated': 0,
            'instances_downgraded': 0,   # INSTANCE（无description）→ FRAME
            'design_artifacts_removed': 0,    # mask层/Clip层/SVG Mask圆 等设计工具产物
            'interaction_variants_dropped': 0, # hover/focus/loading 状态节点（与default共存时）
            'table_columns_extracted': 0,      # Table 节点 children 整合为 columns 数组
            'table_row_selection_detected': 0, # Table 首列是 Checkbox 行选列
            'nav_items_built': 0,              # 生成 navItems 树的导航组件数量
        }

    # ──────────────────────────────────────────────
    # 公共入口
    # ──────────────────────────────────────────────
    def run(self, output_path: str):
        if not os.path.exists(self.input_path):
            print(f"Error: {self.input_path} 不存在")
            return

        with open(self.input_path, 'r', encoding='utf-8') as f:
            raw = json.load(f)

        dsl = raw.get('dsl', {})
        self.styles = dsl.get('styles', {})

        resolved = {
            "version": "3.0-resolved",
            "lessVarHints": self._build_less_var_hints(),
            "rules": raw.get('rules', []),
            "componentDocumentLinks": raw.get('componentDocumentLinks', []),
            "nodes": [self._process_node(n) for n in dsl.get('nodes', [])],
        }

        # Markdown 渲染：resolver 预计算所有 CSS，输出人类可读文档
        # 不再调用 _strip_output_fields，渲染器按需选取字段
        markdown = self._render_to_markdown(resolved)

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(markdown)

        orig_kb = os.path.getsize(self.input_path) / 1024
        out_kb = os.path.getsize(output_path) / 1024
        node_count = self._count_nodes(resolved['nodes'])
        reduction = (1 - out_kb / orig_kb) * 100

        print(f"处理完成！{orig_kb:.1f}KB → {out_kb:.1f}KB (减少 {reduction:.0f}%)  |  节点总数: {node_count}")
        print(f"  antd 图标替换:      {self._stats['antd_icons_replaced']} 个")
        print(f"  背景形状转 CSS:     {self._stats['bg_paths_converted']} 个")
        print(f"  省略默认值字段:     {self._stats['defaults_omitted']} 个")
        print(f"  LAYER 语义化:       {self._stats['layers_semantified']} 个 → semantic 字段")
        print(f"  纯包装 FRAME 消除:  {self._stats['wrappers_eliminated']} 个")
        print(f"  INSTANCE→FRAME:     {self._stats['instances_downgraded']} 个（无组件描述）")
        print(f"  设计产物节点过滤:   {self._stats['design_artifacts_removed']} 个（Clip裁剪辅助层）")
        if self._stats['table_columns_extracted']:
            print(f"  Table列结构整合:    {self._stats['table_columns_extracted']} 个（children→columns数组）")
        if self._stats['table_row_selection_detected']:
            print(f"  Table行选列检测:    {self._stats['table_row_selection_detected']} 个（首列Checkbox→rowSelection）")
        if self._stats['nav_items_built']:
            print(f"  导航 navItems 生成: {self._stats['nav_items_built']} 个组件（Menu items 树结构）")
        print(f"输出: {output_path}")

    # ──────────────────────────────────────────────
    # LESS 变量提示表
    # ──────────────────────────────────────────────
    def _build_less_var_hints(self) -> dict:
        """
        构建 LESS 变量提示表，使用语义化变量名。

        去重策略：
          - 颜色：相同 hex/rgba 值 → 同一变量，tokens[] 存所有关联 token key
          - 字体：相同 (size, weight, lineHeight, family) → 同一变量，tokens[] 存所有关联 token key
          - 阴影：相同阴影值 → 同一变量
          - 跳过：transparent、空值、url() 图片填充（由节点 bg 字段直接承载，不走 LESS 变量）

        命名策略：
          - 颜色：@color-{hex6} 或 @color-white/black，rgba 加 -a{pct} 后缀
          - 字体：@font-{size}-{weight_name}，同 size+weight 不同 lh 时加 -{lh} 后缀
          - 阴影：@shadow-1, @shadow-2, ...
          - 名称冲突追加 -2/-3 后缀
        """
        # ── 第一步：按值分组，去重 ──────────────────────────
        color_groups:  dict = {}  # resolved_val → [token_key, ...]
        font_groups:   dict = {}  # (size, weight, lh, family) → (font_data, [token_key, ...])
        shadow_groups: dict = {}  # resolved_val → [token_key, ...]

        for key in self.styles:
            if key.startswith('paint_'):
                val = self._resolve_paint(key)
                # 透明色 / 图片填充不产生 LESS 变量（节点中不会有 bgToken）
                if not val or val == 'transparent' or val.startswith('url('):
                    continue
                color_groups.setdefault(val, []).append(key)

            elif key.startswith('font_'):
                font_data = self._resolve_font(key)
                size   = int(font_data['fontSize'].replace('px', ''))
                weight = font_data['fontWeight']
                lh     = font_data.get('lineHeight', 'normal')
                family = font_data.get('fontFamily', '')
                fkey   = (size, weight, lh, family)
                if fkey not in font_groups:
                    font_groups[fkey] = (font_data, [])
                font_groups[fkey][1].append(key)

            elif key.startswith('effect_'):
                val = self._resolve_effect(key)
                if not val:
                    continue
                shadow_groups.setdefault(val, []).append(key)

        # ── 第二步：生成变量名 ──────────────────────────────
        hints: dict = {}
        used_names: set = set()

        # 颜色变量
        for val, token_keys in color_groups.items():
            base = self._color_to_var_suffix(val)
            var  = self._unique_var('@color-', base, used_names)
            hints[var] = {"value": val, "tokens": token_keys}

        # 字体变量：逐步添加后缀消除歧义
        #   1. 同 (size,weight) 唯一 → @font-{size}-{weight_name}
        #   2. 同 (size,weight) 有冲突 → 加 lineHeight 后缀
        #   3. 同 (size,weight,lh) 仍有冲突 → 加 family 缩写后缀
        sw_count:  dict = {}   # (size,weight)      → 组数
        swl_count: dict = {}   # (size,weight,lh)   → 组数
        for (size, weight, lh, family) in font_groups:
            sw_count[(size, weight)]       = sw_count.get((size, weight), 0)       + 1
            swl_count[(size, weight, lh)]  = swl_count.get((size, weight, lh), 0)  + 1

        for (size, weight, lh, family), (font_data, token_keys) in font_groups.items():
            base = self._font_to_var_suffix(size, weight)
            if sw_count[(size, weight)] > 1:
                lh_str = lh.replace('px', '').replace('normal', 'auto')
                base = f'{base}-{lh_str}'
            if swl_count[(size, weight, lh)] > 1:
                base = f'{base}-{self._abbrev_family(family)}'
            var = self._unique_var('@font-', base, used_names)
            hints[var] = {"value": font_data, "tokens": token_keys}

        # 阴影变量
        shadow_idx = 1
        for val, token_keys in shadow_groups.items():
            var = f'@shadow-{shadow_idx}'
            shadow_idx += 1
            used_names.add(var)
            hints[var] = {"value": val, "tokens": token_keys}

        return hints

    @staticmethod
    def _abbrev_family(family: str) -> str:
        """将字体族名称缩写为短标识，用于变量名后缀。"""
        KNOWN = {
            'sourcehansanscnrevision': 'sourcehancn',
            'sourcehansanscn':         'sourcehancn',
            'sourcehansans':           'sourcehan',
            'pingfangsc':              'pingfang',
            'pingfang':                'pingfang',
            'helveticaneue':           'helvetica',
            'noto':                    'noto',
            'roboto':                  'roboto',
        }
        f = re.sub(r'[\s\-_]', '', family).lower()
        for full, abbrev in KNOWN.items():
            if full in f:
                return abbrev
        # 兜底：取前 8 个字母数字字符
        return re.sub(r'[^a-z0-9]', '', f)[:8] or 'font'

    def _color_to_var_suffix(self, color_val: str) -> str:
        """将颜色值转为可读的变量名后缀。"""
        v = color_val.strip()
        # hex 颜色
        if v.startswith('#'):
            hex6 = v[1:].lower()
            if len(hex6) == 3:
                hex6 = hex6[0]*2 + hex6[1]*2 + hex6[2]*2
            # 纯白/黑用语义名
            if hex6 in COLOR_SEMANTIC_NAMES:
                return COLOR_SEMANTIC_NAMES[hex6]
            return hex6   # e.g. '3370ff'
        # rgba(r, g, b, a)
        m = re.match(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)', v)
        if m:
            r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
            hex6 = f'{r:02x}{g:02x}{b:02x}'
            if m.group(4) is not None:
                alpha_pct = round(float(m.group(4)) * 100)
                return f'{hex6}-a{alpha_pct}'   # e.g. '1f2329-a15'
            return hex6
        # 兜底：清洗字符
        return re.sub(r'[^a-zA-Z0-9]', '-', v)[:24].strip('-')

    def _font_to_var_suffix(self, size: int, weight: int) -> str:
        """将字号+字重转为可读的变量名后缀，如 14-regular、20-bold。"""
        weight_name = FONT_WEIGHT_NAMES.get(weight, str(weight))
        return f'{size}-{weight_name}'

    @staticmethod
    def _unique_var(prefix: str, base: str, used: set) -> str:
        """生成不重复的变量名，冲突时追加 -2、-3 后缀。"""
        candidate = f'{prefix}{base}'
        if candidate not in used:
            used.add(candidate)
            return candidate
        i = 2
        while f'{candidate}-{i}' in used:
            i += 1
        name = f'{candidate}-{i}'
        used.add(name)
        return name

    # ──────────────────────────────────────────────
    # Token 解析
    # ──────────────────────────────────────────────
    def _resolve_paint(self, token_key: str) -> str:
        style = self.styles.get(token_key, {})
        value = style.get('value', [])
        if not value:
            return 'transparent'
        first = value[0]
        if isinstance(first, dict):
            url = first.get('url', '')
            return f'url({url})' if url else 'transparent'
        return str(first)

    def _resolve_font(self, token_key: str) -> dict:
        style = self.styles.get(token_key, {})
        v = style.get('value', {})
        line_height = v.get('lineHeight', 'auto')
        letter_spacing = v.get('letterSpacing', 'auto')
        result = {
            'fontSize': f"{v.get('size', 14)}px",
            'fontWeight': FONT_WEIGHT_MAP.get(v.get('style', 'Normal'), 400),
            'lineHeight': f"{line_height}px" if line_height not in ('auto', '', None) else 'normal',
            'fontFamily': v.get('family', 'inherit'),
        }
        # 只有非默认值才输出（优化 4：省略默认值）
        ls_val = f"{letter_spacing}px" if letter_spacing not in ('auto', '', None) else 'normal'
        deco_val = v.get('decoration', 'none')
        if ls_val != 'normal':
            result['letterSpacing'] = ls_val
        else:
            self._stats['defaults_omitted'] += 1
        if deco_val != 'none':
            result['textDecoration'] = deco_val
        else:
            self._stats['defaults_omitted'] += 1
        return result

    def _resolve_effect(self, token_key: str) -> str:
        style = self.styles.get(token_key, {})
        value = style.get('value', [])
        raw = value[0] if value else ''
        # 去掉 "box-shadow: " 前缀（DSL 原始值含此前缀）
        # 输出纯 CSS 值，使用时写 box-shadow: @shadow-xxx 或 box-shadow: <value>
        if raw.lower().startswith('box-shadow:'):
            raw = raw[len('box-shadow:'):].strip().rstrip(';').strip()
        return raw

    # ──────────────────────────────────────────────
    # 节点处理入口
    # ──────────────────────────────────────────────
    def _process_node(self, node: dict, parent: dict | None = None) -> dict:
        node_type = node.get('type', '')

        # ── 优化1：antd 图标识别（INSTANCE 层面）──
        if node_type == 'INSTANCE':
            antd = _match_antd_icon(node.get('name', ''))
            if antd:
                self._stats['antd_icons_replaced'] += 1
                return self._make_antd_icon_node(node, antd)

        result: dict = {
            'type': node_type,
            'id': node.get('id', ''),
            'name': node.get('name', ''),
        }

        result['layout'] = self._extract_layout(node)

        if fill_key := node.get('fill'):
            bg_val = self._resolve_paint(fill_key)
            result['bg'] = bg_val
            # 透明背景和图片填充无需保留 token
            # url() 填充不在 lessVarHints 中（_build_less_var_hints 跳过它们），
            # 保留 bgToken 会导致模型查找时找不到对应变量
            if bg_val != 'transparent' and not bg_val.startswith('url('):
                result['bgToken'] = fill_key

        stroke_key = node.get('strokeColor')
        stroke_w = node.get('strokeWidth')
        if stroke_key and stroke_w:
            stroke_color = self._resolve_paint(stroke_key)
            # 透明描边无任何视觉效果，不输出（设计工具默认 stroke 残留）
            if stroke_color != 'transparent':
                result['border'] = {
                    'color': stroke_color,
                    'token': stroke_key,
                    'width': stroke_w,
                }

        if br := node.get('borderRadius'):
            result['borderRadius'] = br

        if effect_key := node.get('effect'):
            resolved = self._resolve_effect(effect_key)
            if resolved:
                result['shadow'] = resolved
                result['shadowToken'] = effect_key

        if (opacity := node.get('opacity')) is not None:
            result['opacity'] = opacity

        if mask := node.get('mask'):
            result['mask'] = mask

        if flex := node.get('flexContainerInfo'):
            result['flex'] = flex

        if node_type == 'TEXT':
            self._apply_text(node, result)
        elif node_type == 'PATH':
            self._apply_path(node, result)
        elif node_type == 'INSTANCE':
            self._apply_instance(node, result)
            # NavigationBar: 从 raw children 提取 tabList（必须在 collapse/eliminate 前）
            if result.get('componentName') == 'NavigationBar':
                tab_list = self._extract_nav_tab_list(node.get('children', []))
                if tab_list:
                    result['tabList'] = tab_list
        elif node_type == 'LAYER':
            self._apply_layer_semantic(node, result)
        elif node_type == 'SVG_ELLIPSE':
            self._apply_ellipse(node, result)

        # ── Children ──
        if raw_children := node.get('children'):
            processed_children = []
            for i, child in enumerate(raw_children):
                # 背景形状 PATH 检测（首个子节点，尺寸≈父节点）
                if i == 0 and child.get('type') == 'PATH':
                    bg_shape = self._try_convert_bg_path(child, node)
                    if bg_shape is not None:
                        result['bgShape'] = bg_shape
                        self._stats['bg_paths_converted'] += 1
                        continue

                # ── 过滤纯设计工具产物（无任何样式数据）──
                if self._is_design_artifact(child):
                    self._stats['design_artifacts_removed'] += 1
                    continue

                processed_children.append(self._process_node(child, node))

            # 语义优化9：纯包装 FRAME 消除
            processed_children = self._eliminate_wrappers(processed_children)

            # Menu/Sider navItems：从已处理的子节点构建 items 树（text/icon 已 resolved）
            # 检测到后清空 children，避免模型手写菜单项 DOM
            if result.get('componentName') in ('Menu', 'Sider'):
                nav_items = self._build_menu_nav_items_from_processed(processed_children)
                if nav_items:
                    result['navItems'] = nav_items
                    processed_children = []
                    self._stats['nav_items_built'] += 1

            # 语义优化：Table 组件列结构统一提取
            processed_children = self._apply_table_columns_extraction(processed_children)

            if processed_children:
                result['children'] = processed_children

        return result

    # ──────────────────────────────────────────────
    # 优化1：antd 图标节点（替换整个 INSTANCE + children）
    # ──────────────────────────────────────────────
    def _make_antd_icon_node(self, node: dict, antd_icon: str) -> dict:
        """
        把图标 INSTANCE 折叠为简洁的 antdIcon 节点，丢弃所有 SVG children。
        输出格式：
          { type: "ICON", id, name, layout, antdIcon: "UploadOutlined", color?: "#xxx" }
        """
        result: dict = {
            'type': 'ICON',
            'id': node.get('id', ''),
            'name': node.get('name', ''),
            'layout': self._extract_layout(node),
            'antdIcon': antd_icon,
        }
        # 尝试从 children 中第一个 PATH 的 fill 获取图标颜色
        color = self._extract_icon_color(node)
        if color and color != 'transparent':
            result['color'] = color
        return result

    def _extract_icon_color(self, node: dict) -> str | None:
        """递归找第一个 PATH 节点的 fill 颜色"""
        for child in node.get('children', []):
            if child.get('type') == 'PATH':
                paths = child.get('path', [])
                if paths:
                    fill_key = paths[0].get('fill', '')
                    return self._resolve_paint(fill_key) if fill_key else None
            color = self._extract_icon_color(child)
            if color:
                return color
        return None

    # ──────────────────────────────────────────────
    # 优化2：背景形状 PATH → bgShape CSS 对象
    # ──────────────────────────────────────────────
    def _try_convert_bg_path(self, path_node: dict, parent: dict) -> dict | None:
        """
        满足以下全部条件时，将 PATH 转为 bgShape 对象（替代 bg CSS）：
          1. 只有 1 条路径
          2. 尺寸与父节点差值 ≤ 5%
          3. path data 含 C/c（贝塞尔曲线），特征为圆角矩形
          4. fill 为纯色或透明（不处理图片 fill）
        返回 None 表示不转换（保留为普通 PATH 节点）。
        """
        raw_paths = path_node.get('path', [])
        if len(raw_paths) != 1:
            return None

        p = raw_paths[0]
        d = p.get('data', '')
        fill_key = p.get('fill', '')
        fill_val = self._resolve_paint(fill_key) if fill_key else 'transparent'

        # 图片 fill 不转换
        if fill_val.startswith('url('):
            return None

        parent_layout = parent.get('layoutStyle', {})
        child_layout = path_node.get('layoutStyle', {})
        pw = parent_layout.get('width', 0)
        ph = parent_layout.get('height', 0)
        cw = child_layout.get('width', 0)
        ch = child_layout.get('height', 0)

        if not (pw > 0 and ph > 0 and cw > 0 and ch > 0):
            return None
        if abs(cw - pw) / pw > 0.05 or abs(ch - ph) / ph > 0.05:
            return None

        # 必须含曲线（否则是普通矩形，bg 已够用）
        if 'C' not in d and 'c' not in d:
            return None

        border_radius = _estimate_border_radius(d)
        result: dict = {'fill': fill_val, 'fillToken': fill_key}
        if border_radius:
            result['borderRadius'] = border_radius
        return result

    # ──────────────────────────────────────────────
    # Layout 提取
    # ──────────────────────────────────────────────
    def _extract_layout(self, node: dict) -> dict:
        ls = node.get('layoutStyle', {})
        layout = {}

        def _round(v):
            """对浮点布局值取整（设计工具的亚像素精度无意义）。"""
            return round(v) if isinstance(v, float) else v

        if (w := ls.get('width')) is not None:
            layout['w'] = _round(w)
        if (h := ls.get('height')) is not None:
            layout['h'] = _round(h)
        if (rx := ls.get('relativeX')) is not None:
            layout['x'] = _round(rx)
        if (ry := ls.get('relativeY')) is not None:
            layout['y'] = _round(ry)
        if (grow := ls.get('flexGrow')) is not None:
            layout['grow'] = grow
        if (shrink := ls.get('flexShrink')) is not None:
            layout['shrink'] = shrink

        # 兼容：顶层的 flexGrow/flexShrink
        if 'grow' not in layout and (grow := node.get('flexGrow')) is not None:
            layout['grow'] = grow
        if 'shrink' not in layout and (shrink := node.get('flexShrink')) is not None:
            layout['shrink'] = shrink

        return layout

    # ──────────────────────────────────────────────
    # TEXT 节点
    # ──────────────────────────────────────────────
    def _apply_text(self, node: dict, result: dict):
        result.pop('bg', None)
        result.pop('bgToken', None)
        # TEXT 节点的实际内容在 'text' 字段，'name' 是设计层命名（如"这里是标题"）
        # 两者并存会干扰模型判断，只保留 text
        result.pop('name', None)

        text_runs = node.get('text', [])
        color_ranges = node.get('textColor', [])

        char_color: dict[int, tuple] = {}
        for cr in color_ranges:
            token = cr.get('color', '')
            resolved_color = self._resolve_paint(token) if token else None
            for i in range(cr.get('start', 0), cr.get('end', 0)):
                char_color[i] = (resolved_color, token)

        resolved_runs = []
        pos = 0
        for run in text_runs:
            text = run.get('text', '')
            font_key = run.get('font', '')
            font_props = self._resolve_font(font_key) if font_key else {}
            color_val, color_token = char_color.get(pos, (None, None))

            entry: dict = {'text': text, **font_props}
            if font_key:
                entry['fontToken'] = font_key
            if color_val:
                entry['color'] = color_val
                entry['colorToken'] = color_token

            resolved_runs.append(entry)
            pos += len(text)

        if len(resolved_runs) == 1:
            run = resolved_runs[0]
            result['text'] = run.pop('text')
            result.update(run)
        else:
            result['runs'] = resolved_runs

        result['align'] = node.get('textAlign', 'left')
        if node.get('textMode') == 'single-line':
            result['nowrap'] = True

        # 大字号 TEXT → 语义标注为标题，告知模型此节点必须渲染为可见标题
        # 规则：fontSize >= 18px，或 fontSize >= 16px 且 fontWeight >= 500
        try:
            size_px = int(result.get('fontSize', '14px').replace('px', ''))
        except (ValueError, AttributeError):
            size_px = 14
        weight = result.get('fontWeight', 400)
        if size_px >= 18 or (size_px >= 16 and weight >= 500):
            result['semantic'] = 'heading'

    # ──────────────────────────────────────────────
    # PATH 节点
    # ──────────────────────────────────────────────
    def _apply_path(self, node: dict, result: dict):
        result.pop('bg', None)
        result.pop('bgToken', None)

        raw_paths = node.get('path', [])
        resolved = []
        for p in raw_paths:
            fill_key = p.get('fill', '')
            entry: dict = {
                'd': p.get('data', ''),
                'fill': self._resolve_paint(fill_key) if fill_key else 'none',
            }
            if fill_key:
                entry['fillToken'] = fill_key
            resolved.append(entry)
        result['paths'] = resolved

    # ──────────────────────────────────────────────
    # INSTANCE 节点（保留 component 字段 + 状态标注）
    # ──────────────────────────────────────────────
    def _apply_instance(self, node: dict, result: dict):
        ci = node.get('componentInfo', {})
        if desc := ci.get('description', ''):
            result['component'] = desc
            # 预提取组件名：让模型不用解析多行代码即可知道用什么组件
            if cname := self._extract_component_name(desc):
                result['componentName'] = cname
                # 从 description 提取 JSX 片段作为 jsxHint，让模型直接看到用法（含子组件如 Input）
                jsx_snippet = self._extract_jsx_snippet(desc)
                if jsx_snippet:
                    result['jsxHint'] = jsx_snippet
                else:
                    # 无 JSX 示例时，至少把组件库 import 行拼在前面
                    pkg_import = self._extract_pkg_import(desc)
                    placeholder = f'<{cname} {{/* props: check API or infer from children */}} />'
                    result['jsxHint'] = (pkg_import + '\n' + placeholder) if pkg_import else placeholder
            # properties：MasterGo 直接给出的组件 prop 键值（如 ltype/lsize），
            # 优先级高于从 children 推断，直接透传给模型
            if props := ci.get('properties'):
                if isinstance(props, dict) and props:
                    result['componentProps'] = props
        else:
            # 无 componentInfo.description：非组件，降级为 FRAME 直接渲染子节点
            result['type'] = 'FRAME'
            self._stats['instances_downgraded'] += 1

    def _extract_component_name(self, component_str: str) -> str | None:
        """
        从 component 字段（多行代码块）提取根 JSX 组件名。
        策略：
          1. 优先找 <ComponentName 模式（有 JSX 示例时最准确）
          2. 否则找组件库（非 react / 非 icons）的 import，取第一个导入名
          3. 兜底：找任意非 react 包的 import（含 icons）
        """
        # 策略1：JSX 标签（如 <Form.Item> / <Upload>）
        m = re.search(r'<([A-Z][A-Za-z.]+)', component_str)
        if m:
            return m.group(1)

        # 图标名模式：以大写字母开头，以 Outlined/Filled/TwoTone/Solid 结尾
        ICON_SUFFIX = ('Outlined', 'Filled', 'TwoTone', 'Solid')

        def is_icon_name(name: str) -> bool:
            return any(name.endswith(s) for s in ICON_SUFFIX)

        # 策略2：非 react 且非纯图标包（icons）的 import → 组件库主包
        SKIP_PACKAGES = ('react', 'icons', '@ant-design/icons')
        for line in component_str.split('\n'):
            m2 = re.search(r"import\s*\{([^}]+)\}\s*from\s*'([^']+)'", line)
            if m2:
                pkg = m2.group(2)
                if any(skip in pkg for skip in SKIP_PACKAGES):
                    continue
                names = [n.strip() for n in m2.group(1).split(',')
                         if n.strip() and not is_icon_name(n.strip())]
                if names:
                    return names[0]

        # 策略3：兜底，任意非 react 且非图标包的 import
        for line in component_str.split('\n'):
            m3 = re.search(r"import\s*\{([^}]+)\}\s*from\s*'([^']+)'", line)
            if m3:
                pkg = m3.group(2)
                if 'react' in pkg or 'icons' in pkg:
                    continue
                names = [n.strip() for n in m3.group(1).split(',')
                         if n.strip() and not is_icon_name(n.strip())]
                if names:
                    return names[0]
        return None

    def _extract_jsx_snippet(self, desc: str) -> str | None:
        """
        从 componentInfo.description 提取 JSX 使用示例，并在前面拼接组件库 import 行。
        格式：
          import { Form, Input } from '@cmbc/apollo-uecp-ui-pc';
          <Form.Item ...>
            <Input />
          </Form.Item>

        让模型在看到 JSX 的同时就能看到正确的 import 来源，避免误用 antd。
        若提取失败返回 None。
        """
        SKIP_PKGS = ('react', '@ant-design/icons', 'antd')

        # 提取组件库 import 行（非 react / 非图标包）
        import_line = ''
        for ln in desc.splitlines():
            m = re.search(r"from\s+['\"]([^'\"]+)['\"]", ln)
            if m and not any(p in m.group(1) for p in SKIP_PKGS):
                import_line = ln.strip()
                break

        # 找到第一个 JSX 根标签
        m = re.search(r'<([A-Z][A-Za-z.]+)', desc)
        if not m:
            return None
        start = m.start()
        tag   = m.group(1)

        # 自闭合：<Tag ... />
        self_close = re.search(r'<' + re.escape(tag) + r'[^>]*/>', desc[start:])
        if self_close and self_close.start() == 0:
            jsx = desc[start: start + self_close.end()].strip()
        else:
            # 有闭合标签：找 </Tag>
            close_m = re.search('</' + re.escape(tag) + '>', desc[start:])
            if not close_m:
                return None
            snippet = desc[start: start + close_m.end()]
            lines = [ln for ln in snippet.splitlines() if ln.strip()]
            jsx = '\n'.join(lines)

        return (import_line + '\n' + jsx) if import_line else jsx

    def _extract_pkg_import(self, desc: str) -> str:
        """从 description 提取第一条组件库 import 行（排除 react / 图标包）。"""
        SKIP_PKGS = ('react', '@ant-design/icons', 'antd')
        for ln in desc.splitlines():
            m = re.search(r"from\s+['\"]([^'\"]+)['\"]", ln)
            if m and not any(p in m.group(1) for p in SKIP_PKGS):
                return ln.strip()
        return ''

    # ──────────────────────────────────────────────
    # LAYER 节点：语义化识别
    # ──────────────────────────────────────────────
    def _apply_layer_semantic(self, node: dict, result: dict):
        """语义优化8：给 LAYER 节点附加 semantic 字段"""
        name = node.get('name', '').lower()
        layout = node.get('layoutStyle', {})
        w = layout.get('width', 0)
        h = layout.get('height', 0)
        bg = result.get('bg', '')

        semantic = None

        # 进度条轨道 / 进度条填充
        if 'progress-trail' in name or 'progress_trail' in name or '轨道' in name:
            semantic = 'progress-track'
        elif 'progress-bg' in name or 'progress_bg' in name or '进度' in name:
            semantic = 'progress-fill'
        # 分割线：极细（≤2px）的矩形
        elif (h > 0 and h <= 2 and w > 10) or (w > 0 and w <= 2 and h > 10):
            semantic = 'divider'
        # 图片层
        elif bg.startswith('url('):
            semantic = 'image'
        # 蒙版层
        elif result.get('mask') == 'alpha':
            semantic = 'mask'
        # 纯色装饰块
        elif bg and bg != 'transparent':
            semantic = 'color-block'

        if semantic:
            result['semantic'] = semantic
            self._stats['layers_semantified'] += 1

    # ──────────────────────────────────────────────
    # SVG_ELLIPSE 节点
    # ──────────────────────────────────────────────
    def _apply_ellipse(self, node: dict, result: dict):
        stroke_key = node.get('strokeColor')
        if stroke_key:
            result['strokeColor'] = self._resolve_paint(stroke_key)
            result['strokeToken'] = stroke_key
        if sw := node.get('strokeWidth'):
            result['strokeWidth'] = sw

    # ──────────────────────────────────────────────
    # 导航/菜单组件：navItems 树生成
    # ──────────────────────────────────────────────

    def _infer_form_component(self, name: str) -> str:
        """
        从 REPEAT 节点名称推断 Form.Item 内的 Ant Design 输入组件类型。
        返回组件名字符串（如 "Input"），无法判断时返回空字符串。
        """
        n = name.lower()
        if '文本域' in name or 'textarea' in n:
            return 'Input.TextArea'
        if '输入' in name or 'input' in n:
            return 'Input'
        if '下拉' in name or 'select' in n:
            return 'Select'
        if '日期范围' in name or 'range' in n:
            return 'DatePicker.RangePicker'
        if '日期' in name or 'date' in n:
            return 'DatePicker'
        if '时间' in name or 'time' in n:
            return 'TimePicker'
        if '复选' in name or 'checkbox' in n:
            return 'Checkbox.Group'
        if '单选' in name or 'radio' in n:
            return 'Radio.Group'
        if '开关' in name or 'switch' in n:
            return 'Switch'
        if '上传' in name or 'upload' in n:
            return 'Upload'
        if '滑块' in name or 'slider' in n:
            return 'Slider'
        if '表单' in name or 'form' in n:
            return 'Input'   # 通用表单字段默认 Input
        return ''

    def _extract_nav_tab_list(self, children: list) -> list:
        """
        从 NavigationBar 的 children 中提取顶部导航 Tab 列表。
        递归扫描子树，找到所有含 'Tab' 的 INSTANCE 节点，
        提取 name 和 active 状态，输出为:
          [{ "name": "xxx", "path": "todo", "active": true/false }, ...]
        """
        tabs: list = []

        def collect(node: dict):
            n_name = node.get('name', '')
            n_type = node.get('type', '')
            if n_type == 'INSTANCE' and 'Tab' in n_name and 'more' not in n_name.lower() and '更多' not in n_name:
                # 提取 tab label 文字
                label = ''
                def get_text(n: dict):
                    nonlocal label
                    if not label and n.get('type') == 'TEXT':
                        raw = n.get('text', '')
                        # raw DSL: text 是 list[{text, font}]；processed: text 是 str
                        if isinstance(raw, list):
                            for seg in raw:
                                if isinstance(seg, dict) and seg.get('text'):
                                    label = seg['text']; return
                        elif isinstance(raw, str) and raw:
                            label = raw
                        # 也尝试 characters 字段（部分 DSL 格式）
                        if not label:
                            chars = n.get('characters', '')
                            if isinstance(chars, str) and chars:
                                label = chars
                    for ch in n.get('children', []):
                        get_text(ch)
                get_text(node)
                tabs.append({'name': label or 'tab', 'path': 'todo'})
                return  # Tab 内部不再递归
            for ch in node.get('children', []):
                collect(ch)

        for child in children:
            collect(child)

        return tabs

    def _build_menu_nav_items_from_processed(self, processed_children: list) -> list:
        """
        从 Menu/Sider 等导航组件的已处理子节点构建 navItems 列表。

        策略：
          - 容器层判断：
              直接 FRAME/INSTANCE 子节点中，含文本的子节点 > 1 个 → 纯包装容器，递归
              否则（0 或 1 个含文本子节点）→ 当前节点本身就是菜单项，直接提取
          - 去重：仅对「完全相同的节点连续重复」去重（同名 + 同 label）
              设计稿放了 N 个占位就输出 N 条，开发替换 label 时按位置对应
              选中态（已出现相同 label）只保留第一次，不重复计入
          - 要求有文本：无任何文本后代的节点直接跳过（图标容器、箭头等）
          - 每项调用 _node_to_menu_item 提取 label/icon
        """
        items: list = []
        idx = [0]

        def subtree_has_text(n: dict) -> bool:
            if n.get('text'):
                return True
            return any(subtree_has_text(c) for c in n.get('children', []))

        def collect(node: dict):
            nt = node.get('type', '')
            if nt not in ('FRAME', 'INSTANCE'):
                return

            children = node.get('children', [])
            frame_children = [c for c in children if c.get('type') in ('FRAME', 'INSTANCE')]

            # 含文本的直接 FRAME/INSTANCE 子节点数量
            text_bearing_count = sum(1 for c in frame_children if subtree_has_text(c))

            if text_bearing_count > 1:
                # 纯包装容器（多个子节点各自携带不同菜单项文本）→ 递归
                for c in children:
                    collect(c)
            else:
                # 叶级菜单项：不去重，保留全部数据
                # selected/unselected 等状态不会出现在 label 中，无需过滤
                if not subtree_has_text(node):
                    return  # 无文本（图标容器、箭头等），跳过
                item = self._node_to_menu_item(node, key=f'nav-{idx[0]}')
                idx[0] += 1
                items.append(item)

        for child in processed_children:
            collect(child)

        return items

    def _node_to_menu_item(self, node: dict, key: str = '') -> dict:
        """
        将已 resolved 的 FRAME/INSTANCE 节点转为 Menu item 对象。
        提取：key、label（第一个文本）、icon（第一个 antdIcon）。
        """
        item: dict = {}
        if key:
            item['key'] = key

        # label：DFS 找第一个 TEXT
        texts: list = []

        def collect_texts(n: dict):
            if t := n.get('text'):
                texts.append(t)
            for c in n.get('children', []):
                collect_texts(c)

        collect_texts(node)
        item['label'] = texts[0] if texts else node.get('name', '')

        # icon：优先 antd ICON 节点；退而寻自定义图标 FRAME（名称含"图标"/"icon"）
        # 注意：从子节点开始检查，跳过根节点自身的 FRAME 名称匹配
        # （菜单项根节点名如"一级导航-展开+icon"含 icon 是设计命名习惯，不是图标 FRAME）
        icons: list = []
        icon_hints: list = []

        def collect_icons(n: dict, depth: int = 0):
            nt = n.get('type', '')
            if nt == 'ICON':
                if ai := n.get('antdIcon', ''):
                    icons.append(ai)
                return
            if nt == 'FRAME' and depth > 0:  # 只检查子节点，不检查根节点
                name = n.get('name', '')
                if '图标' in name or re.search(r'\bicon\b', name, re.I):
                    seg = [s.strip() for s in name.split('/') if s.strip()]
                    hint = seg[-1] if len(seg) > 1 else ''
                    if hint and hint.lower() not in ('icon', '图标'):
                        icon_hints.append(hint)
                    return
            for c in (n.get('children') or []):
                collect_icons(c, depth + 1)

        collect_icons(node)
        if icons:
            item['icon'] = icons[0]
        elif icon_hints:
            item['iconHint'] = icon_hints[0]

        return item

    def _detect_selection_col(self, col_node: dict) -> str | None:
        """
        检测列节点（FRAME）是否为行选列，返回选择类型或 None。
        - 'checkbox'：超过一半的行含 checkbox 关键词（多选）
        - 'radio'   ：超过一半的行含 radio 关键词（单选）
        - None      ：非行选列

        行选列是 Table 组件的独立 prop（rowSelection），不进入 columns 数组。
        容忍第一行（列头行）不是选择组件（设计上列头常为全选 checkbox 或空）。
        """
        rows = col_node.get('children', [])
        if not rows:
            return None
        threshold = max(1, len(rows) // 2)

        def matches(r: dict, keyword: str) -> bool:
            return (keyword in r.get('componentName', '').lower()
                    or keyword in r.get('name', '').lower())

        if sum(1 for r in rows if matches(r, 'checkbox')) >= threshold:
            return 'checkbox'
        if sum(1 for r in rows if matches(r, 'radio')) >= threshold:
            return 'radio'
        return None

    def _apply_table_columns_extraction(self, children: list) -> list:
        """
        在父节点的子节点列表中，为 Table INSTANCE 节点提取 columns + dataSource。

        同名 Table 兄弟组（设计稿将"表头行+数据行"拆成多个同名 INSTANCE）：
          - 第一个：提取 columns + dataSource（含表头行与首批数据行）
          - 后续同名节点：提取纯数据行追加到第一个的 dataSource，然后从输出中移除
          这样确保所有设计稿数据行都被整合进单一 Table，避免丢失行数据。
        """
        # Step 1: 按名称分组，记录每组的 indices
        groups: dict[str, list[int]] = {}
        for i, child in enumerate(children):
            if (child.get('type') == 'INSTANCE'
                    and child.get('componentName') == 'Table'
                    and 'children' in child):
                groups.setdefault(child.get('name', ''), []).append(i)

        absorbed: set[int] = set()
        replacements: dict[int, dict] = {}

        for name, indices in groups.items():
            first_idx = indices[0]
            first_child = children[first_idx]

            # 提取第一个 Table 的 columns + dataSource
            table = self._extract_table_columns(first_child.get('children', []))
            if not table:
                continue

            new_first = dict(first_child)
            new_first['columns'] = table['columns']
            dataSource: list = list(table.get('dataSource') or [])
            has_rs = bool(table.get('rowSelection'))

            if table.get('rowSelection'):
                new_first['rowSelection'] = table['rowSelection']
                self._stats['table_row_selection_detected'] += 1
            del new_first['children']
            self._stats['table_columns_extracted'] += 1

            # 后续同名 Table：提取纯数据行并追加
            n_cols = len(table['columns'])
            for other_idx in indices[1:]:
                other_child = children[other_idx]
                extra = self._extract_table_extra_rows(
                    other_child.get('children', []), n_cols, has_rs)
                dataSource.extend(extra)
                absorbed.add(other_idx)

            if dataSource:
                new_first['dataSource'] = dataSource
            replacements[first_idx] = new_first

        result = []
        for i, child in enumerate(children):
            if i in absorbed:
                continue          # 已被合并，从输出移除
            result.append(replacements.get(i, child))
        return result

    def _extract_table_extra_rows(self, processed_children: list,
                                   n_cols: int, has_row_selection: bool) -> list:
        """
        从同名 Table 组的后续节点（无表头行，全为数据行）提取数据行列表。
        支持列式（column-first）和行包装式（row-first wrapper）两种结构。
        返回: [{'col0': val, 'col1': val, ...}, ...]
        """
        if not processed_children:
            return []
        if not all(c.get('type') in ('REPEAT', 'FRAME') for c in processed_children):
            return []

        def collect_texts(n: dict, out: list):
            if n.get('type') == 'TEXT' and n.get('text'):
                out.append(n['text'])
            if n.get('type') == 'REPEAT':
                for item in n.get('items', []):
                    it = item.get('texts', [])
                    if isinstance(it, list):
                        out.extend(it)
                    elif it:
                        out.append(it)
            for c in n.get('children', []):
                collect_texts(c, out)

        col_vals: list[list[str]] = [[] for _ in range(n_cols)]

        # 行包装式：单 FRAME 子节点包含所有数据行
        if (len(processed_children) == 1
                and processed_children[0].get('type') == 'FRAME'):
            wrapper = processed_children[0]
            data_rows = [c for c in wrapper.get('children', [])
                         if c.get('type') == 'FRAME']
            sel_skip = 1 if has_row_selection else 0
            for dr in data_rows:
                cells = [c for c in dr.get('children', [])
                         if c.get('type') in ('FRAME', 'INSTANCE')]
                ordered: list[str] = []
                for cell in cells[sel_skip:]:
                    texts: list[str] = []
                    collect_texts(cell, texts)
                    if texts:
                        ordered.append(texts[0])
                for j in range(min(n_cols, len(ordered))):
                    col_vals[j].append(ordered[j])
        else:
            # 列式：每个 processed_child 是一列（无表头行，全为数据单元格）
            col_sources = processed_children[1:] if has_row_selection else processed_children
            for j, col_src in enumerate(col_sources[:n_cols]):
                if col_src.get('type') == 'REPEAT':
                    for item in col_src.get('items', []):
                        it = item.get('texts', [])
                        vals = (it if isinstance(it, list) else [it]) if it else []
                        col_vals[j].extend(vals)
                elif col_src.get('type') == 'FRAME':
                    for row_node in col_src.get('children', []):
                        texts: list[str] = []
                        collect_texts(row_node, texts)
                        if texts:
                            col_vals[j].append(texts[0])

        # 列转行
        if not any(col_vals):
            return []
        max_rows = max(len(v) for v in col_vals)
        if max_rows == 0:
            return []
        dataSource: list = []
        for ri in range(max_rows):
            rec: dict = {}
            for j, vals in enumerate(col_vals):
                if ri < len(vals):
                    rec[f'col{j}'] = vals[ri]
            dataSource.append(rec)
        return dataSource

    def _extract_table_columns(self, children: list) -> dict | None:
        """
        将 Table 组件的列式 children（REPEAT列组 + 独立列FRAME）提取为
        列定义 + 行数据的标准结构：
          columns  — [{ title, dataIndex, key, width, align?,
                        headerIcons?, render?, actions? }]
          dataSource — [{ col0: "值", col1: "值", ... }]  按行组织的数据

        触发条件：所有 children 都是 REPEAT 或 FRAME（即纯列式结构）。
        不触发条件：children 中有 TEXT / ICON / 其他类型（说明不是列式表格）。

        dataIndex 采用 "col0"/"col1"... 顺序编号；模型根据业务语义替换为实际字段名。
        actions 列含 render:"action" 提示，数据不进入 dataSource（需自定义 render 函数）。
        """
        if not children:
            return None
        # 只处理全部 children 均为 REPEAT 或 FRAME 的情况
        if not all(c.get('type') in ('REPEAT', 'FRAME') for c in children):
            return None

        def collect_texts_icons(n: dict, texts: list, icons: list):
            if n.get('type') == 'TEXT' and n.get('text'):
                texts.append(n['text'])
            if n.get('type') == 'ICON' and n.get('antdIcon'):
                icons.append(n['antdIcon'])
            for c in n.get('children', []):
                collect_texts_icons(c, texts, icons)
            # 若节点已被折叠为内层 REPEAT，递归其 items 的 texts/icons
            # （与 _extract_repeat_item.collect_texts 保持对称）
            if n.get('type') == 'REPEAT':
                for item in n.get('items', []):
                    item_texts = item.get('texts', [])
                    if isinstance(item_texts, list):
                        texts.extend(item_texts)
                    elif isinstance(item_texts, str) and item_texts:
                        texts.append(item_texts)
                    for icon in item.get('icons', []):
                        icons.append(icon)

        # ── 行选列检测：第一列是 checkbox/radio → 记录类型，从 columns 中排除 ──
        # 行选列在代码层面通过 rowSelection prop 自动生成，不需要写进 columns 定义
        row_selection: dict | None = None
        col_sources = list(children)
        if col_sources and col_sources[0].get('type') == 'FRAME':
            sel_type = self._detect_selection_col(col_sources[0])
            if sel_type:
                row_selection = {'type': sel_type}
                col_sources = col_sources[1:]   # 跳过行选列，不生成对应 column

        columns = []

        for child in col_sources:
            if child.get('type') == 'REPEAT':
                # 列优先 REPEAT：hfi=None，每个 item = 一列
                # 跳过行优先 REPEAT（hfi=True，items 是行，不是列）
                if child.get('headerFirstItem'):
                    return None   # 行优先表格，不适用列提取逻辑
                tmpl_w = child.get('template', {}).get('layout', {}).get('w')
                for item in child.get('items', []):
                    texts = item.get('texts', [])
                    if isinstance(texts, list) and texts:
                        col: dict = {'title': texts[0], 'width': tmpl_w}
                        if len(texts) > 1:
                            col['data'] = texts[1:]
                        if item.get('icons'):
                            col['headerIcons'] = item['icons']
                    elif isinstance(texts, str) and texts:
                        col = {'title': texts, 'width': tmpl_w}
                    else:
                        continue
                    columns.append(col)

            elif child.get('type') == 'FRAME':
                # 独立列 FRAME：第一个子 FRAME/节点含列头 TEXT
                col = {'width': child.get('layout', {}).get('w')}

                # 右对齐检测
                flex = child.get('flex', {})
                if flex.get('alignItems') == 'flex-end' or flex.get('justifyContent') == 'flex-end':
                    col['align'] = 'right'

                def parse_cell_elements(node: dict) -> list:
                    """
                    将操作列 cell 按直接子节点递归拆解为有序元素列表，保留渲染顺序。
                      TEXT → {"label": text, "type": "link"}  （操作列文字均为可点击元素）
                      ICON → {"icon": antdIcon}
                      FRAME/其他容器 → 递归展开，将内部 TEXT/ICON 按序提取
                      REPEAT → 展开 items 的 texts/icons
                    """
                    elements: list = []
                    children = node.get('children', [])
                    if not children:
                        return elements
                    for elem in children:
                        t = elem.get('type', '')
                        if t == 'TEXT' and elem.get('text'):
                            elements.append({'label': elem['text'], 'type': 'link'})
                        elif t == 'ICON' and elem.get('antdIcon'):
                            elements.append({'icon': elem['antdIcon']})
                        elif t == 'REPEAT':
                            for item in elem.get('items', []):
                                item_texts = item.get('texts', [])
                                if isinstance(item_texts, list):
                                    for txt in item_texts:
                                        elements.append({'label': txt, 'type': 'link'})
                                elif isinstance(item_texts, str) and item_texts:
                                    elements.append({'label': item_texts, 'type': 'link'})
                                for icon in item.get('icons', []):
                                    elements.append({'icon': icon})
                        else:
                            # FRAME 等容器：递归展开，保持子元素顺序
                            elements.extend(parse_cell_elements(elem))
                    return elements

                header_done = False
                # 按行收集，保留行边界
                # data_rows: [{'texts': [...], 'icons': [...], 'elements': [...]}]
                data_rows: list = []

                for row_node in child.get('children', []):
                    row_texts: list = []
                    row_icons: list = []
                    collect_texts_icons(row_node, row_texts, row_icons)

                    if not header_done and row_texts:
                        col['title'] = row_texts[0]
                        # 若表头行也含图标（如排序图标），记为 headerIcons
                        if row_icons:
                            col['headerIcons'] = row_icons
                        header_done = True
                    else:
                        # 只收录有内容的行（过滤纯空行）
                        if row_texts or row_icons:
                            data_rows.append({
                                'texts': row_texts,
                                'icons': row_icons,
                                'elements': parse_cell_elements(row_node),
                            })

                if not header_done:
                    continue   # 没有列头，跳过此列

                # 判断是否为操作列：任意 cell 中含有 icon 元素
                has_op_icons = any(
                    any('icon' in elem for elem in r.get('elements', []))
                    for r in data_rows
                )
                if has_op_icons:
                    # 操作列：结构化 actions 二维数组
                    # actions[i] = 第 i 行 cell 的有序元素列表
                    # 每个元素：{"label": "同意", "type": "link"} 或 {"icon": "EllipsisOutlined"}
                    # 渲染时按序遍历，label 元素渲染为 <Button type="link">，icon 元素渲染为图标
                    col['actions'] = [r['elements'] for r in data_rows if r.get('elements')]
                elif data_rows:
                    # 普通数据列：每个 cell 通常只有一个值，平铺为一维数组
                    col['data'] = [text for r in data_rows for text in r['texts']]

                columns.append(col)

        # ── 行优先结构兜底：单 wrapper FRAME 包裹所有行 ──────────────
        # 典型结构：Table → [容器 FRAME] → [header_FRAME, data_FRAME×N / REPEAT]
        # 列式提取只得到 1 列（把整个 wrapper FRAME 当成一列），回退为行优先提取。
        if len(columns) < 2 and len(col_sources) == 1 and col_sources[0].get('type') == 'FRAME':
            wrapper = col_sources[0]
            wrapper_kids = wrapper.get('children', [])
            frame_kids = [c for c in wrapper_kids if c.get('type') == 'FRAME']
            if frame_kids:
                # 行优先提取
                header_row = frame_kids[0]
                frame_data_rows = frame_kids[1:]
                repeat_data_rows = [c for c in wrapper_kids if c.get('type') == 'REPEAT']

                # 从表头行的每个单元格提取列标题
                header_cells = [c for c in header_row.get('children', [])
                                 if c.get('type') in ('FRAME', 'INSTANCE')]

                # 检测行选列（多选/单选）：检查第一个 cell 的 name
                rf_row_selection: dict | None = None
                hc_start = 0
                if header_cells:
                    first_name = (header_cells[0].get('name', '') + ' ' +
                                  header_cells[0].get('componentName', '')).lower()
                    if any(kw in first_name for kw in ('多选', 'checkbox')):
                        rf_row_selection = {'type': 'checkbox'}
                        hc_start = 1
                    elif 'radio' in first_name:
                        rf_row_selection = {'type': 'radio'}
                        hc_start = 1

                content_cells = header_cells[hc_start:]
                rf_columns: list = []
                rf_cell_indices: list = []   # 在 header_cells 中的原始位置
                for _i, _cell in enumerate(content_cells):
                    _htexts: list = []; _hicons: list = []
                    collect_texts_icons(_cell, _htexts, _hicons)
                    if not _htexts:
                        continue   # 无文字的结构性 cell（拖拽手柄等）跳过
                    _col: dict = {'title': _htexts[0], 'data': []}
                    if _hicons:
                        _col['headerIcons'] = _hicons
                    _w = (_cell.get('layout') or {}).get('w')
                    if _w:
                        _col['width'] = _w
                    rf_columns.append(_col)
                    rf_cell_indices.append(_i + hc_start)

                if len(rf_columns) >= 2:
                    n_cols = len(rf_columns)

                    # 从 FRAME 数据行提取：按文字顺序位置映射（不依赖绝对 cell 下标）
                    # 原因：处理后 INSTANCE→FRAME 转换 + _eliminate_wrappers 会改变 children 的绝对位置，
                    # 但有文字的 cell 数量和顺序与表头保持一致，直接按文字出现顺序对齐更可靠。
                    for _dr in frame_data_rows:
                        _dcells = [c for c in _dr.get('children', [])
                                   if c.get('type') in ('FRAME', 'INSTANCE')]
                        # 跳过最前面的行选列（与表头同样数量）
                        _row_sel_skip = 1 if rf_row_selection else 0
                        _ordered_texts: list = []
                        for _cell in _dcells[_row_sel_skip:]:
                            _dt: list = []; _di: list = []
                            collect_texts_icons(_cell, _dt, _di)
                            if _dt:
                                _ordered_texts.append(_dt[0])
                        for _j in range(min(n_cols, len(_ordered_texts))):
                            rf_columns[_j]['data'].append(_ordered_texts[_j])

                    # 从 REPEAT 数据行提取（平铺 texts 按列数切片）
                    for _rep in repeat_data_rows:
                        for _item in _rep.get('items', []):
                            _itexts = _item.get('texts', [])
                            if isinstance(_itexts, str):
                                _itexts = [_itexts] if _itexts else []
                            for _j in range(min(n_cols, len(_itexts))):
                                rf_columns[_j]['data'].append(_itexts[_j])

                    # 后处理（与列式路径相同）
                    for _i, _col in enumerate(rf_columns):
                        _col['dataIndex'] = f'col{_i}'
                        _col['key'] = f'col{_i}'

                    _data_cols = [(c['dataIndex'], c.pop('data')) for c in rf_columns if 'data' in c]
                    _dataSource: list = []
                    if _data_cols:
                        _max_rows = max(len(v) for _, v in _data_cols)
                        for _ri in range(_max_rows):
                            _rec: dict = {}
                            for _di, _vals in _data_cols:
                                if _ri < len(_vals):
                                    _rec[_di] = _vals[_ri]
                            _dataSource.append(_rec)

                    _rf_result: dict = {'columns': rf_columns, 'dataSource': _dataSource}
                    if rf_row_selection:
                        _rf_result['rowSelection'] = rf_row_selection
                    return _rf_result

        if len(columns) < 2:
            return None   # 少于 2 列不认为是表格

        # ── 后处理：对齐 Ant Design Table props ────────────────
        # 1. 添加 dataIndex / key（顺序编号，模型按业务语义替换）
        # 2. actions 列标记 render: "action"（需自定义 render 函数）
        for i, col in enumerate(columns):
            col['dataIndex'] = f'col{i}'
            col['key'] = f'col{i}'
            if 'actions' in col:
                col['render'] = 'action'  # 告知模型此列需要自定义 render

        # 3. 将列方向的 data 数组转置为行方向的 dataSource
        #    actions 列不进入 dataSource（数据来自自定义 render，非 dataIndex 映射）
        data_cols = [(c['dataIndex'], c.pop('data')) for c in columns if 'data' in c]
        dataSource: list = []
        if data_cols:
            max_rows = max(len(vals) for _, vals in data_cols)
            for row_idx in range(max_rows):
                record: dict = {}
                for di, vals in data_cols:
                    if row_idx < len(vals):
                        record[di] = vals[row_idx]
                dataSource.append(record)

        result: dict = {'columns': columns, 'dataSource': dataSource}
        if row_selection:
            result['rowSelection'] = row_selection
        return result

    def _is_design_artifact(self, node: dict) -> bool:
        """
        判断节点是否为纯设计工具产物（无任何可用于代码生成的样式数据）。
        仅当以下条件 **全部成立** 时才过滤，确保不误删含样式的节点：

        Clip LAYER：name 为 "clip"（大小写不敏感），LAYER 类型，
        且所有颜色/边框/阴影等视觉属性均为空或透明。
        这类节点是设计工具中的裁剪辅助层（如旋转动画的 overflow 容器），
        无任何 CSS 表示形式。
        """
        node_type = node.get('type', '')
        name = node.get('name', '').strip().lower()

        if node_type == 'LAYER' and name == 'clip':
            # 有 children 的 Clip 层可能有内容，保留
            if node.get('children'):
                return False
            # 检查非颜色样式字段（effect / stroke / opacity / mask）
            NON_COLOR_KEYS = ('effect', 'strokeColor', 'opacity', 'mask',
                              'borderRadius', 'flexContainerInfo')
            if any(node.get(k) for k in NON_COLOR_KEYS):
                return False
            # 检查 fill：若有 fill token，解析其颜色值
            # 透明色（transparent / empty value）视为无填充
            fill_key = node.get('fill', '')
            if fill_key:
                resolved = self._resolve_paint(fill_key)
                if resolved and resolved != 'transparent':
                    return False  # 有实际填充色，保留
            return True  # 无任何视觉数据，过滤

        # 完全不可见的 LAYER：透明背景 + 无有效描边 + 无子节点 + 无阴影/蒙版
        # 典型例子："server (Background)"、"矩形"（透明占位层）
        if node_type == 'LAYER':
            if node.get('children'):
                return False  # 有子节点 → 可能是容器，保留
            if node.get('effect') or node.get('opacity') or node.get('mask'):
                return False  # 有视觉效果，保留
            fill_key = node.get('fill', '')
            fill_val = self._resolve_paint(fill_key) if fill_key else 'transparent'
            if fill_val != 'transparent':
                return False  # 有实际填充色，保留
            # 检查 stroke：只有 strokeColor 且解析为透明时才过滤
            stroke_key = node.get('strokeColor', '')
            if stroke_key:
                stroke_val = self._resolve_paint(stroke_key)
                if stroke_val and stroke_val != 'transparent':
                    return False  # 有实际描边色，是真实 UI 元素（Input/Checkbox 等），保留
            return True  # 完全透明，无视觉数据，过滤

        return False

    # ──────────────────────────────────────────────
    # 语义优化9：纯包装 FRAME 消除
    # ──────────────────────────────────────────────
    def _eliminate_wrappers(self, children: list) -> list:
        """
        单子节点 FRAME 且自身无语义属性时，将其子节点提升替代该 FRAME。
        保留 FRAME 自身的 layout 信息合并到子节点（若子节点无 layout）。

        不消除条件（保留 FRAME）：
          - 有 bg / border / shadow / flex → 有视觉或布局语义
          - 有 borderRadius / opacity     → 样式信息无法安全转移到子节点
          - 有 state / baseName           → 状态节点，语义不可丢失
          - 有 inferredComponent          → 已推断为组件实例，不能降级
          - 子节点数 ≠ 1                  → 非单子节点包装
        """
        result = []
        for child in children:
            if (child.get('type') == 'FRAME'
                    and not child.get('bg')
                    and not child.get('bgShape')
                    and not child.get('border')
                    and not child.get('shadow')
                    and not child.get('flex')
                    and not child.get('borderRadius')
                    and not child.get('opacity')
                    and not child.get('state')
                    and not child.get('baseName')
                    and not child.get('inferredComponent')
                    and len(child.get('children', [])) == 1):
                inner = child['children'][0]
                # 若内层节点没有位置信息，继承外层的 layout
                if 'layout' not in inner or not inner.get('layout'):
                    inner = dict(inner)
                    inner['layout'] = child.get('layout', {})
                result.append(inner)
                self._stats['wrappers_eliminated'] += 1
            else:
                result.append(child)
        return result

    # ──────────────────────────────────────────────
    # 最终输出清理
    # ──────────────────────────────────────────────
    def _strip_output_fields(self, node):
        """
        递归移除对代码生成无用的字段。
        必须在整棵树处理完成后调用，不可在 _process_node 内部提前删除，
        原因：_collapse_repeats 依赖 result['name'] 对同名子节点分组。

        清理规则：
          id       — 全部节点移除（MasterGo 内部 ID，还原代码不需要）
          state    — 全部移除（设计稿视图快照，实际选中态由组件/业务逻辑控制）
          baseName — 全部移除（仅用于预处理阶段内部分组，模型无需感知）
          name     — ICON/LAYER/PATH 移除（antdIcon/semantic/paths 已承载语义）
                   — INSTANCE 有 componentName 或 inferredComponent 时移除（冗余）
                   — FRAME/SVG_ELLIPSE 保留（模型 className 提示 + 语义参考）
                   — TEXT 在 _apply_text 中已移除
          skipRender — 已废弃，不再使用
        """
        if isinstance(node, list):
            for item in node:
                self._strip_output_fields(item)
            return
        if not isinstance(node, dict):
            return

        node.pop('id', None)
        node.pop('state', None)
        node.pop('baseName', None)

        node_type = node.get('type', '')
        if node_type in ('ICON', 'LAYER', 'PATH'):
            node.pop('name', None)
        elif node_type == 'INSTANCE':
            if 'componentName' in node or 'inferredComponent' in node:
                node.pop('name', None)

        for val in node.values():
            self._strip_output_fields(val)

    # ──────────────────────────────────────────────
    # Markdown 输出生成
    # ──────────────────────────────────────────────

    def _extract_props_data(self, children: list) -> dict:
        """
        从 INSTANCE 组件的直接子节点提取 props 数据，供容器清单展示。
        子节点内容不展开为叶子节点——模型须通过组件 props 传入，禁止手写内部 DOM。

        分三类处理直接子节点：
          1. 按钮类（名称/componentName 含 button/按钮）→ button_children，作为 children prop
          2. 有子树的非按钮节点（2个及以上时）→ list_items，作为列表型 prop 数据
          3. 其余叶子节点 → 平铺收集 texts/icons/images
        """
        texts: list = []
        icons: list = []
        images: list = []
        button_children: list = []
        list_items: list = []

        def _is_button_like(node: dict) -> bool:
            n = (node.get('name') or '').lower()
            c = (node.get('componentName') or '').lower()
            return '按钮' in n or 'button' in n or c == 'button'

        def _collect_deep(node: dict, t_out: list, i_out: list):
            """递归收集节点内所有文字和图标。"""
            nt = node.get('type', '')
            if nt == 'TEXT':
                if t := (node.get('text') or ''):
                    t_out.append(t)
                for run in node.get('runs', []):
                    if t := run.get('text', ''):
                        t_out.append(t)
            elif nt == 'ICON':
                if ic := node.get('antdIcon', ''):
                    i_out.append(ic)
            for child in (node.get('children') or []):
                _collect_deep(child, t_out, i_out)

        def _collect_flat(node: dict):
            """收集直接叶子节点内容到顶层 texts/icons/images。"""
            nt = node.get('type', '')
            if nt == 'TEXT':
                if t := (node.get('text') or ''):
                    texts.append(t)
                for run in node.get('runs', []):
                    if t := run.get('text', ''):
                        texts.append(t)
            elif nt == 'ICON':
                if ic := node.get('antdIcon', ''):
                    icons.append(ic)
            elif nt == 'LAYER':
                if node.get('semantic') == 'image' and (bg := node.get('bg', '')):
                    images.append(bg)
            for child in (node.get('children') or []):
                _collect_flat(child)

        candidates: list = []   # 有子树的非按钮节点，暂存待分组判断

        for child in children:
            if _is_button_like(child):
                btn_t: list = []
                btn_i: list = []
                _collect_deep(child, btn_t, btn_i)
                button_children.append({
                    'text': btn_t[0] if btn_t else '',
                    'icon': btn_i[0] if btn_i else '',
                })
            elif child.get('children'):
                item_t: list = []
                item_i: list = []
                _collect_deep(child, item_t, item_i)
                candidates.append({'texts': item_t, 'icons': item_i, '_node': child})
            else:
                _collect_flat(child)

        # 2+ 个有子树的同级节点 → 按条目分组（如 fileList 项）
        # 仅 1 个时退化为平铺，避免无意义的"1项"标注
        if len(candidates) >= 2:
            for c in candidates:
                list_items.append({'texts': c['texts'], 'icons': c['icons']})
        else:
            for c in candidates:
                _collect_flat(c['_node'])

        return {
            'texts': texts,
            'icons': icons,
            'images': images,
            'button_children': button_children,
            'list_items': list_items,
        }

    def _var_for_token(self, token_key: str, less_hints: dict) -> str | None:
        """根据 token key 查找对应 LESS 变量名。"""
        for var, info in less_hints.items():
            if token_key in info.get('tokens', []):
                return var
        return None

    def _var_for_color_val(self, color_val: str, less_hints: dict) -> str | None:
        """根据颜色值反查 LESS 变量名（用于 ICON.color 等直接存色值的字段）。"""
        for var, info in less_hints.items():
            if var.startswith('@color-') and info.get('value') == color_val:
                return var
        return None

    def _node_self_css(self, node: dict, parent_has_flex: bool, is_root: bool,
                       is_abs_container: bool = False) -> list:
        """
        计算节点自身定位 CSS（维度A）。
        is_abs_container=True 时，若节点是 flex item，额外追加 position:relative，
        保证其 absolute 子节点能以此为定位基准。
        mainSizing/crossSizing='auto' 表示弹性容器在该轴上 hug 内容，不写显式 width/height。
        """
        layout = node.get('layout', {})
        w = layout.get('w')
        h = layout.get('h')
        x = layout.get('x', 0)
        y = layout.get('y', 0)
        grow = layout.get('grow')
        shrink = layout.get('shrink')
        lines = []

        # 检查此节点自身的 mainSizing/crossSizing（当此节点是 flex 容器时）
        own_flex = node.get('flex') or {}
        if own_flex:
            own_dir = own_flex.get('flexDirection', own_flex.get('mode', ''))
            is_col = 'vertical' in str(own_dir).lower() or 'column' in str(own_dir).lower()
            ms = own_flex.get('mainSizing', '')
            cs = own_flex.get('crossSizing', '')
            # row: main=width, cross=height; col: main=height, cross=width
            skip_w = (ms == 'auto' and not is_col) or (cs == 'auto' and is_col)
            skip_h = (ms == 'auto' and is_col) or (cs == 'auto' and not is_col)
            if skip_w:
                w = None
            if skip_h:
                h = None

        if is_root:
            lines.append('position: relative;')
            if w is not None:
                lines.append(f'width: {w}px;')
            if h is not None:
                lines.append(f'height: {h}px;')
        elif parent_has_flex:
            if grow == 1:
                lines.append('flex: 1;')
            elif grow is not None and grow != 0:
                lines.append(f'flex-grow: {grow};')
            if shrink is not None and shrink != 1:
                lines.append(f'flex-shrink: {shrink};')
            if w is not None:
                lines.append(f'width: {w}px;')
            if h is not None:
                lines.append(f'height: {h}px;')
            # ABS容器作为 flex item：需要 position:relative 为子节点提供定位基准
            if is_abs_container:
                lines.append('position: relative;  /* ABS容器：子节点 absolute 定位基准 */')
        else:
            # position:absolute 本身就是 positioned 元素，子节点可以以此为定位基准，无需额外加 relative
            lines.append('position: absolute;')
            if x is not None:
                lines.append(f'left: {x}px;')
            if y is not None:
                lines.append(f'top: {y}px;')
            if w is not None:
                lines.append(f'width: {w}px;')
            if h is not None:
                lines.append(f'height: {h}px;')

        return lines

    def _flex_container_css(self, flex: dict) -> list:
        """计算 flex 容器子布局 CSS（维度B）。"""
        if not flex:
            return []
        lines = ['display: flex;']

        mode = flex.get('mode', '') or flex.get('flexDirection', '')
        mode_lower = str(mode).lower()
        if 'vertical' in mode_lower or 'column' in mode_lower:
            lines.append('flex-direction: column;')

        jc = flex.get('justifyContent', '')
        if jc:
            jc_map = {
                'FLEX_START': 'flex-start', 'FLEX_END': 'flex-end',
                'CENTER': 'center', 'SPACE_BETWEEN': 'space-between',
                'SPACE_AROUND': 'space-around', 'SPACE_EVENLY': 'space-evenly',
            }
            jc_css = jc_map.get(jc, jc)
            if jc_css:
                # justify-content: flex-start 是 CSS 默认值，可省略；其余全部输出
                if jc_css != 'flex-start':
                    lines.append(f'justify-content: {jc_css};')

        ai = flex.get('alignItems', '')
        if ai:
            ai_map = {
                'FLEX_START': 'flex-start', 'FLEX_END': 'flex-end',
                'CENTER': 'center', 'BASELINE': 'baseline', 'STRETCH': 'stretch',
            }
            ai_css = ai_map.get(ai, ai)
            if ai_css:
                # CSS 默认 align-items 是 stretch，flex-start 不同于默认值，必须输出
                if ai_css != 'stretch':
                    lines.append(f'align-items: {ai_css};')

        gap = flex.get('gap') or flex.get('itemSpacing')
        if gap is not None:
            gap_str = str(gap).strip()
            if gap_str and gap_str not in ('0', '0px', '0px 0px', '0 0'):
                parts = gap_str.split()
                if len(parts) == 2:
                    # MasterGo 两值格式："rowGap colGap"
                    def _parse_px(s: str) -> float | None:
                        try:
                            return float(s.rstrip('px'))
                        except ValueError:
                            return None
                    rg = _parse_px(parts[0])
                    cg = _parse_px(parts[1])
                    if rg is not None and cg is not None:
                        if rg == cg and rg > 0:
                            lines.append(f'gap: {int(rg)}px;')
                        else:
                            if rg > 0:
                                lines.append(f'row-gap: {int(rg)}px;')
                            elif rg < 0:
                                lines.append(f'/* row-gap: {int(rg)}px — 负值重叠效果，建议改用子元素负 margin */')
                            if cg > 0:
                                lines.append(f'column-gap: {int(cg)}px;')
                            elif cg < 0:
                                lines.append(f'/* column-gap: {int(cg)}px — 负值重叠效果，建议改用子元素负 margin */')
                    else:
                        lines.append(f'gap: {gap_str};')
                else:
                    # 单值
                    try:
                        gap_val = float(gap_str.rstrip('px'))
                        if gap_val > 0:
                            lines.append(f'gap: {int(gap_val)}px;')
                        elif gap_val < 0:
                            lines.append(f'/* gap: {int(gap_val)}px — 负值重叠效果，建议改用子元素负 margin */')
                    except (ValueError, TypeError):
                        lines.append(f'gap: {gap_str};')

        padding = flex.get('padding')
        if padding:
            if isinstance(padding, dict):
                t = int(padding.get('top', 0) or 0)
                r = int(padding.get('right', 0) or 0)
                b = int(padding.get('bottom', 0) or 0)
                lv = int(padding.get('left', 0) or 0)
                if any([t, r, b, lv]):
                    if t == b and r == lv:
                        if t == 0:
                            lines.append(f'padding: 0 {r}px;')
                        elif r == 0:
                            lines.append(f'padding: {t}px 0;')
                        else:
                            lines.append(f'padding: {t}px {r}px;')
                    else:
                        lines.append(f'padding: {t}px {r}px {b}px {lv}px;')
            elif isinstance(padding, str):
                p = padding.strip()
                zero_vals = {'0', '0px', '0px 0px', '0px 0px 0px 0px', '0 0', '0 0 0 0'}
                if p and p not in zero_vals:
                    lines.append(f'padding: {p};')
            elif isinstance(padding, (int, float)) and padding > 0:
                lines.append(f'padding: {int(padding)}px;')

        return lines

    def _visual_css_lines(self, node: dict, less_hints: dict) -> list:
        """计算节点视觉样式 CSS（bg, border, shadow, borderRadius, opacity）。"""
        lines = []

        bg_shape = node.get('bgShape')
        bg_token = node.get('bgToken', '')
        bg_val   = node.get('bg', '')

        if bg_shape:
            ft  = bg_shape.get('fillToken', '')
            fv  = bg_shape.get('fill', '')
            var = self._var_for_token(ft, less_hints) if ft else None
            lines.append(f'background-color: {var or fv or "transparent"};')
            if br := bg_shape.get('borderRadius'):
                lines.append(f'border-radius: {br}px;')
        elif bg_val and bg_val != 'transparent':
            if bg_val.startswith('url('):
                lines.append(f'background: {bg_val} center/cover no-repeat;')
            else:
                var = self._var_for_token(bg_token, less_hints) if bg_token else None
                lines.append(f'background-color: {var or bg_val};')

        if border := node.get('border'):
            tk  = border.get('token', '')
            var = self._var_for_token(tk, less_hints) if tk else None
            color_css = var or border.get('color', 'transparent')
            width_raw = border.get('width', 1)
            try:
                width_num = int(float(str(width_raw).replace('px', '').strip()))
            except (ValueError, TypeError):
                width_num = 1
            lines.append(f'border: {width_num}px solid {color_css};')

        if not bg_shape:
            if br := node.get('borderRadius'):
                br_val = str(br).replace('px', '').strip()
                try:
                    br_num = int(float(br_val))
                    lines.append(f'border-radius: {br_num}px;')
                except (ValueError, TypeError):
                    lines.append(f'border-radius: {br};')

        if shadow_val := node.get('shadow'):
            shadow_token = node.get('shadowToken', '')
            var = self._var_for_token(shadow_token, less_hints) if shadow_token else None
            lines.append(f'box-shadow: {var or shadow_val};')

        opacity = node.get('opacity')
        if opacity is not None:
            try:
                if float(opacity) != 1.0:
                    lines.append(f'opacity: {opacity};')
            except (ValueError, TypeError):
                pass

        return lines

    def _text_css_lines(self, node: dict, less_hints: dict) -> list:
        """计算 TEXT 节点字体和颜色 CSS（已展开 fontToken → 4行）。"""
        lines = []
        font_token = node.get('fontToken', '')
        font_var   = self._var_for_token(font_token, less_hints) if font_token else None

        if fs := node.get('fontSize'):
            comment = f'  /* {font_var} */' if font_var else ''
            lines.append(f'font-size: {fs};{comment}')
        if fw := node.get('fontWeight'):
            lines.append(f'font-weight: {fw};')
        if lh := node.get('lineHeight'):
            lines.append(f'line-height: {lh};')
        if ff := node.get('fontFamily'):
            lines.append(f'font-family: {ff};')

        color_token = node.get('colorToken', '')
        color_val   = node.get('color', '')
        if color_val:
            var = self._var_for_token(color_token, less_hints) if color_token else None
            if not var:
                var = self._var_for_color_val(color_val, less_hints)
            lines.append(f'color: {var or color_val};')

        if node.get('nowrap'):
            lines.append('white-space: nowrap;')
        align = node.get('align', 'left')
        if align and align != 'left':
            lines.append(f'text-align: {align};')

        return lines

    def _make_tree_label(self, node: dict, leaf_num: int | None = None) -> str:
        """生成节点树行的简短标签。"""
        nt     = node.get('type', '')
        name   = node.get('name', '')
        layout = node.get('layout', {})
        w, h   = layout.get('w'), layout.get('h')
        flex   = node.get('flex')
        size   = f' {w}×{h}' if (w is not None and h is not None) else ''

        if nt == 'TEXT':
            raw  = (node.get('text') or '')
            text = raw[:24] + ('…' if len(raw) > 24 else '')
            sem  = node.get('semantic', '')
            tag  = f' [{sem}]' if sem else ''
            return f'#{leaf_num} TEXT{tag} "{text}"'
        elif nt == 'ICON':
            return f'#{leaf_num} ICON — {node.get("antdIcon", name or "icon")}'
        elif nt == 'PATH':
            return f'#{leaf_num} PATH (×{len(node.get("paths", []))})'
        elif nt == 'LAYER':
            sem = node.get('semantic', '')
            return f'#{leaf_num} LAYER({sem})'
        elif nt == 'SVG_ELLIPSE':
            return f'#{leaf_num} SVG_ELLIPSE{size}'
        elif nt == 'FRAME':
            if flex:
                mode = str(flex.get('mode', '') or flex.get('flexDirection', '')).lower()
                direction = 'column' if ('vertical' in mode or 'column' in mode) else 'row'
                return f'{name} [FRAME flex-{direction}{size}]'
            return f'{name} [FRAME ABS{size}]'
        elif nt == 'INSTANCE':
            comp = node.get('componentName', '')
            label = f':{comp}' if comp else ''
            return f'{name} [INSTANCE{label}{size}]'
        return f'{name} [{nt}{size}]'

    def _walk_node_for_md(self, node: dict, parent_has_flex: bool, is_root: bool,
                          depth: int, path: str, leaf_counter: list,
                          tree_lines: list, leaf_sections: list,
                          container_sections: list,
                          less_hints: dict, indent: str = '', is_last: bool = True,
                          parent_child_count: int = 2):
        """DFS 遍历，收集树结构与各类节点数据。"""
        nt        = node.get('type', '')
        name      = node.get('name', '')
        has_flex  = bool(node.get('flex'))
        connector = '└── ' if is_last else '├── '
        child_ind = indent + ('    ' if is_last else '│   ')

        LEAF_TYPES = {'TEXT', 'ICON', 'PATH', 'LAYER', 'SVG_ELLIPSE'}

        def tree_append(label: str):
            if depth == 0:
                tree_lines.append(label)
            else:
                tree_lines.append(f'{indent}{connector}{label}')

        # ── 叶子节点 ──
        if nt in LEAF_TYPES:
            leaf_counter[0] += 1
            leaf_num = leaf_counter[0]
            label = self._make_tree_label(node, leaf_num)
            tree_append(label)

            if parent_has_flex:
                pos_hint = 'flex item（父为flex容器，不写position/left/top）'
            elif is_root:
                pos_hint = '根节点'
            else:
                pos_hint = 'ABS子节点（父为ABS容器）'

            pos_css = self._node_self_css(node, parent_has_flex, is_root)
            vis_css = self._visual_css_lines(node, less_hints)

            extra: dict = {}
            if nt == 'TEXT':
                extra['text_css'] = self._text_css_lines(node, less_hints)
                extra['content']  = node.get('text') or ''
                extra['semantic'] = node.get('semantic', '')
                if node.get('runs'):
                    extra['runs'] = node['runs']
            elif nt == 'ICON':
                extra['antdIcon'] = node.get('antdIcon', '')
                cv = node.get('color', '')
                if cv:
                    var = self._var_for_color_val(cv, less_hints)
                    extra['color_css'] = var or cv
            elif nt == 'PATH':
                extra['paths'] = node.get('paths', [])
            elif nt == 'LAYER':
                sem = node.get('semantic', '')
                extra['semantic'] = sem
                if sem == 'image':
                    # 有兄弟节点 → <img>；唯一子节点 → 父容器 background-image
                    extra['render_as'] = 'img' if parent_child_count > 1 else 'background'

            leaf_sections.append({
                'num': leaf_num, 'type': nt, 'name': name,
                'path': path, 'pos_hint': pos_hint,
                'pos_css': pos_css, 'vis_css': vis_css,
                'extra': extra,
            })
            return

        # ── 容器节点（FRAME / INSTANCE）──
        node_path = f'{path} > {name}' if (path and name) else (name or path)
        label = self._make_tree_label(node)
        tree_append(label)

        if nt in ('FRAME', 'INSTANCE'):
            if is_root:
                pos_hint = '根节点'
            elif parent_has_flex:
                pos_hint = 'flex item'
            else:
                pos_hint = 'ABS子节点'

            is_abs = not has_flex and nt == 'FRAME'
            children_list = node.get('children', [])

            # mask 子节点 → 父容器加 overflow:hidden
            vis_css = self._visual_css_lines(node, less_hints)
            if any(c.get('semantic') == 'mask' for c in children_list):
                if not any('overflow' in ln for ln in vis_css):
                    vis_css = ['overflow: hidden;  /* ⬅ mask子节点：形状裁剪 */'] + list(vis_css)

            # 无组件名 INSTANCE 的明确提示
            component = node.get('componentName', '') or ''
            no_component_hint = (nt == 'INSTANCE' and not component
                                 and not node.get('inferredComponent'))

            # 组件 API 信息：import 来源 + jsxHint（让模型知道需要查 MCP）
            component_import = node.get('component', '') or ''   # 原始 import/JSX 字符串
            jsx_hint         = node.get('jsxHint', '') or ''
            component_props  = node.get('componentProps') or {}  # MasterGo 直接给出的 prop 键值

            # INSTANCE 有组件名：提取子节点 props 数据摘要，不展开子树
            props_data = None
            if nt == 'INSTANCE' and component:
                props_data = self._extract_props_data(children_list)

            container_sections.append({
                'name': name or nt,
                'type': nt,
                'path': node_path,
                'component': component,
                'component_import': component_import,
                'jsx_hint': jsx_hint,
                'component_props': component_props,
                'pos_hint': pos_hint,
                'pos_css': self._node_self_css(node, parent_has_flex, is_root,
                                               is_abs_container=is_abs),
                'flex_css': self._flex_container_css(node.get('flex', {})) if has_flex else [],
                'vis_css': vis_css,
                'has_flex': has_flex,
                'is_instance': nt == 'INSTANCE',
                'no_component_hint': no_component_hint,
                'nav_items': node.get('navItems'),
                'tab_list': node.get('tabList'),
                'columns': node.get('columns'),
                'data_source': node.get('dataSource'),
                'row_selection': node.get('rowSelection'),
                'props_data': props_data,
            })

            # INSTANCE 有组件名：不递归展开子树，内容已收入 props_data
            if nt == 'INSTANCE' and component:
                return

        # 递归 children
        children = node.get('children', [])
        for i, child in enumerate(children):
            self._walk_node_for_md(
                child, parent_has_flex=has_flex, is_root=False,
                depth=depth + 1, path=node_path,
                leaf_counter=leaf_counter,
                tree_lines=tree_lines, leaf_sections=leaf_sections,
                container_sections=container_sections,
                less_hints=less_hints, indent=child_ind,
                is_last=(i == len(children) - 1),
                parent_child_count=len(children),
            )

    def _render_leaf_section(self, sec: dict, less_hints: dict) -> str:
        lines = []
        num, nt, name = sec['num'], sec['type'], sec['name']
        path, pos_hint = sec['path'], sec['pos_hint']
        pos_css, vis_css, extra = sec['pos_css'], sec['vis_css'], sec['extra']

        if nt == 'TEXT':
            content = extra.get('content', '')
            sem = extra.get('semantic', '')
            tag = f' [{sem}]' if sem else ''
            header = f'### #{num} TEXT{tag} — "{content}"'
        elif nt == 'ICON':
            header = f'### #{num} ICON — {extra.get("antdIcon", name or "icon")}'
        elif nt == 'PATH':
            header = f'### #{num} PATH'
        elif nt == 'LAYER':
            sem = extra.get('semantic', '')
            header = f'### #{num} LAYER({sem})'
        elif nt == 'SVG_ELLIPSE':
            header = f'### #{num} SVG_ELLIPSE'
        else:
            header = f'### #{num} {nt}'

        lines.append(header)
        if path:
            lines.append(f'路径: {path}')

        # TEXT heading 提示（仅语义标注，渲染用 div+className，CSS 块已含完整字体样式）
        if nt == 'TEXT' and extra.get('semantic') == 'heading':
            lines.append('→ 标题级文字（semantic: heading），用 `<div className="..."/>` 渲染，CSS 块已含完整样式')

        # LAYER(image) renderAs 提示
        if nt == 'LAYER' and extra.get('semantic') == 'image':
            render_as = extra.get('render_as', 'img')
            if render_as == 'img':
                lines.append('→ 有兄弟节点：渲染为 `<img src={url} />`，url 从下方 background: url(...) 提取')
            else:
                lines.append('→ 唯一子节点：**不生成 DOM**，在父容器 LESS 加 `background-image/background-size: cover/background-position: center`')

        lines.append('```css')
        lines.append(f'/* {pos_hint} */')
        lines.extend(pos_css)

        if nt == 'TEXT':
            lines.extend(extra.get('text_css', []))
        elif nt == 'ICON':
            if color_css := extra.get('color_css', ''):
                lines.append(f'color: {color_css};')
        elif nt == 'PATH':
            for i, p in enumerate(extra.get('paths', [])):
                fill = p.get('fill', 'none')
                ft   = p.get('fillToken', '')
                var  = self._var_for_token(ft, less_hints) if ft else None
                if not var and fill not in ('none', 'transparent'):
                    var = self._var_for_color_val(fill, less_hints)
                lines.append(f'/* path[{i}] fill: {var or fill} */')
        elif nt == 'LAYER':
            lines.extend(vis_css)

        lines.append('```')

        if nt == 'PATH':
            paths = extra.get('paths', [])
            if paths:
                lines.append('SVG paths:')
                lines.append('```')
                for p in paths:
                    d    = (p.get('d', '') or '')[:80]
                    fill = p.get('fill', 'none')
                    lines.append(f'  d="{d}" fill="{fill}"')
                lines.append('```')

        if nt == 'TEXT' and extra.get('runs'):
            runs = extra['runs']
            lines.append(f'多段文本 runs（共 {len(runs)} 段，各段颜色/字重不同）:')
            lines.append('```json')
            lines.append(json.dumps(runs, ensure_ascii=False, indent=2))
            lines.append('```')

        lines.append('')
        return '\n'.join(lines)

    def _render_container_section(self, sec: dict) -> str:
        lines = []
        name, nt, path = sec['name'], sec['type'], sec['path']
        pos_hint, pos_css = sec['pos_hint'], sec['pos_css']
        flex_css, vis_css = sec['flex_css'], sec['vis_css']
        has_flex = sec['has_flex']
        component  = sec.get('component', '')
        nav_items  = sec.get('nav_items')
        tab_list   = sec.get('tab_list')
        _cname_hint = ''  # 组件名，供 children summary 区段复用

        header = f'### {name}（{nt}:{component}）' if component else f'### {name}（{nt}）'
        lines.append(header)
        if path:
            lines.append(f'路径: {path}')

        if sec.get('is_instance'):
            if nav_items is not None:
                lines.append('⚠️  INSTANCE — 勿遍历 children，使用 navItems 数据驱动')
            elif tab_list is not None:
                lines.append('⚠️  INSTANCE — 勿遍历 children，使用 tabList 数据驱动')
            elif sec.get('no_component_hint'):
                lines.append('⚠️  INSTANCE — 无法识别组件；禁止手写 DOM，输出占位注释 {/* UNRESOLVED: 节点名 */}')
            else:
                lines.append('⚠️  INSTANCE — 勿遍历 children，使用组件 props')

            # 输出组件名 + 来源（从 import 语句提取），替代冗长的完整 import 行
            comp_import  = sec.get('component_import', '')
            jsx_hint     = sec.get('jsx_hint', '')
            comp_props   = sec.get('component_props', {})

            # 提取组件名：直接用已解析的 componentName，无需再重新推断
            _cname_hint = component  # component = sec['component'] = componentName（如 Form.Item）
            if not _cname_hint and jsx_hint:
                _m = re.match(r'<([\w.]+)', jsx_hint)
                if _m:
                    _cname_hint = _m.group(1)
            if comp_import:
                # 过滤掉图标包 import 行
                clean_lines = [
                    ln for ln in comp_import.strip().splitlines()
                    if 'icons' not in ln and '@ant-design' not in ln
                ]
                stripped = '\n'.join(clean_lines).strip()
                if stripped:
                    # 提取 package 名：优先非 react 的 from '...'（react 是运行时，不是组件库）
                    _pkg = ''
                    for _ln in clean_lines:
                        _ln_strip = _ln.strip()
                        if not _ln_strip:
                            continue
                        _pm = re.search(r"from\s+['\"]([^'\"]+)['\"]", _ln_strip)
                        if not _pm:
                            continue
                        _candidate = _pm.group(1)
                        if _candidate == 'react' or _candidate.startswith('react/'):
                            continue  # 跳过 react 本身，找组件库 package
                        _pkg = _candidate
                        break
                    # 提取导入的组件名（优先）
                    _names_match = re.search(r'import\s*\{([^}]+)\}', stripped)
                    if not _cname_hint and _names_match:
                        _first = [s.strip() for s in _names_match.group(1).split(',') if s.strip()]
                        _cname_hint = _first[0] if _first else _cname_hint
                    if _cname_hint:
                        lines.append(f'组件名: {_cname_hint}')
                    if _pkg:
                        lines.append(f'来源: {_pkg}')

            if comp_props:
                props_str = '  '.join(f'{k}="{v}"' for k, v in comp_props.items())
                lines.append(f'示例props（仅参考，以MCP为准）: {props_str}')

            if jsx_hint:
                lines.append(f'jsxHint: `{jsx_hint}`')

            # 已知组件 Props 快速参考：减少弱模型 STEP A 填写时的幻觉
            if _cname_hint and _cname_hint in KNOWN_COMPONENT_PROPS:
                kp = KNOWN_COMPONENT_PROPS[_cname_hint]
                req = kp.get('required', [])
                com = kp.get('common', [])
                if req or com:
                    lines.append('已知Props（快速参考，STEP A 按此填写，MCP/antd文档补全）:')
                    if req:
                        req_strs = [f'{p}: {t}  {h}' for p, t, h in req]
                        lines.append('  必填: ' + '  |  '.join(req_strs))
                    if com:
                        com_strs = [f'{p}: {t}' for p, t, _ in com]
                        lines.append('  常用: ' + '  |  '.join(com_strs))
        elif not has_flex:
            lines.append('⚠️  ABS容器 — children 全部用 position:absolute；自身需 position:relative')

        lines.append('```css')
        lines.append(f'/* 自身定位: {pos_hint} */')
        lines.extend(pos_css)
        if flex_css:
            lines.append('/* 子布局: flex */')
            lines.extend(flex_css)
        elif not sec.get('is_instance') and not has_flex:
            lines.append('/* 子布局: ABS容器 — children 写 position:absolute */')
        lines.extend(vis_css)
        lines.append('```')

        tab_list = sec.get('tab_list')
        if tab_list:
            lines.append('')
            lines.append(f'tabList（共 {len(tab_list)} 项，name/path — path 需替换为实际路由）:')
            lines.append('```json')
            lines.append(json.dumps(tab_list, ensure_ascii=False, indent=2))
            lines.append('```')

        if nav_items:
            lines.append('')
            lines.append(f'navItems（共 {len(nav_items)} 项，key 需替换为实际路由 path）:')
            lines.append('```json')
            lines.append(json.dumps(nav_items, ensure_ascii=False, indent=2))
            lines.append('```')

        columns   = sec.get('columns')
        data_source = sec.get('data_source')
        row_sel   = sec.get('row_selection')
        if columns:
            lines.append('')
            lines.append(f'columns（共 {len(columns)} 列）:')
            lines.append('```json')
            lines.append(json.dumps(columns, ensure_ascii=False, indent=2))
            lines.append('```')
        if data_source:
            lines.append('')
            lines.append(f'dataSource（共 {len(data_source)} 行，前2行预览）:')
            lines.append('```json')
            lines.append(json.dumps(data_source[:2], ensure_ascii=False, indent=2))
            if len(data_source) > 2:
                lines.append(f'// ... 共 {len(data_source)} 行')
            lines.append('```')
        if row_sel:
            lines.append('')
            lines.append(f'rowSelection: {json.dumps(row_sel, ensure_ascii=False)}')

        # props 数据摘要：仅 INSTANCE 有组件名时输出，明确标注禁止手写内部 DOM
        pd = sec.get('props_data')
        if pd:
            parts = []
            for btn in (pd.get('button_children') or []):
                btn_text = btn.get('text', '')
                btn_icon = btn.get('icon', '')
                if btn_text and btn_icon:
                    parts.append(f'children prop: <Button icon={{<{btn_icon} />}}>{btn_text}</Button>')
                elif btn_text:
                    parts.append(f'children prop: <Button>{btn_text}</Button>')
                elif btn_icon:
                    parts.append(f'children prop: <Button icon={{<{btn_icon} />}} />')
            if pd.get('list_items'):
                parts.append(f'子节点内容（{len(pd["list_items"])} 组，通过 props 传入，禁止手写为 DOM）:')
                for item in pd['list_items']:
                    row_parts = []
                    if item.get('texts'):
                        row_parts.append(' / '.join(f'"{t}"' for t in item['texts']))
                    if item.get('icons'):
                        row_parts.append('  '.join(item['icons']))
                    parts.append('  — ' + ('  '.join(row_parts) if row_parts else '(空)'))
            if pd.get('texts'):
                parts.append('文字: ' + ' / '.join(f'"{t}"' for t in pd['texts']))
            if pd.get('icons'):
                parts.append('图标: ' + ' / '.join(pd['icons']))
            if pd.get('images'):
                parts.append(f'图片: {len(pd["images"])} 张')
            if parts:
                lines.append('')
                lines.append('⚠️  以下为组件 props 数据参考，禁止将内部节点手写为 DOM:')
                for p in parts:
                    lines.append(f'  {p}')

        lines.append('')
        return '\n'.join(lines)

    def _render_to_markdown(self, resolved: dict) -> str:
        """将 resolved 树渲染为 Markdown 文档（主入口）。"""
        less_hints = resolved.get('lessVarHints', {})
        nodes      = resolved.get('nodes', [])

        tree_lines         = []
        leaf_sections      = []
        container_sections = []
        leaf_counter       = [0]

        for i, node in enumerate(nodes):
            self._walk_node_for_md(
                node, parent_has_flex=False, is_root=True,
                depth=0, path='',
                leaf_counter=leaf_counter,
                tree_lines=tree_lines, leaf_sections=leaf_sections,
                container_sections=container_sections,
                less_hints=less_hints, indent='', is_last=(i == len(nodes) - 1),
            )

        # 叶子类型统计
        type_counts: dict = {}
        for sec in leaf_sections:
            t = sec['type']
            type_counts[t] = type_counts.get(t, 0) + 1
        count_str = '  '.join(f'{t}×{c}' for t, c in sorted(type_counts.items()))

        source = os.path.basename(self.input_path)
        out: list = []

        # ── Header ──────────────────────────────────
        out.append('---')
        out.append(f'source: {source}')
        out.append(f'leafNodes: {leaf_counter[0]}  {count_str}')
        out.append('---')
        out.append('')

        # ── Section 1: LESS Token 定义 ───────────────
        out.append('## LESS Token 定义')
        out.append('')
        out.append('```less')

        color_lines  = []
        shadow_lines = []
        font_lines   = []
        for var, info in less_hints.items():
            val = info.get('value', '')
            if var.startswith('@color-'):
                color_lines.append(f'{var}: {val};')
            elif var.startswith('@shadow-'):
                shadow_lines.append(f'{var}: {val};')
            elif var.startswith('@font-') and isinstance(val, dict):
                fs = val.get('fontSize', '14px')
                fw = val.get('fontWeight', 400)
                lh = val.get('lineHeight', 'normal')
                ff = val.get('fontFamily', 'inherit')
                font_lines.append(
                    f'/* {var}: font-size:{fs}; font-weight:{fw};'
                    f' line-height:{lh}; font-family:{ff}; */'
                )

        if color_lines:
            out.append('/* 颜色 */')
            out.extend(color_lines)
        if shadow_lines:
            out.append('/* 阴影 */')
            out.extend(shadow_lines)
        if font_lines:
            out.append('/* 字体（在叶子节点中已展开为4行CSS，此处仅作命名参考） */')
            out.extend(font_lines)

        out.append('```')
        out.append('')

        # ── Section 2: 节点树 ────────────────────────
        out.append('## 节点树')
        out.append('')
        out.append('```')
        out.extend(tree_lines)
        out.append('```')
        out.append('')

        # ── Section 3: 叶子节点清单 ──────────────────
        out.append('## 叶子节点清单')
        out.append('')
        for sec in leaf_sections:
            out.append(self._render_leaf_section(sec, less_hints))

        # ── Section 4: 容器清单 ──────────────────────
        if container_sections:
            out.append('')
            out.append('## 容器清单（FRAME / INSTANCE）')
            out.append('')
            for sec in container_sections:
                out.append(self._render_container_section(sec))

        return '\n'.join(out)

    # ──────────────────────────────────────────────
    # 工具
    # ──────────────────────────────────────────────
    def _count_nodes(self, nodes: list) -> int:
        count = 0
        for n in nodes:
            count += 1 + self._count_nodes(n.get('children', []))
        return count


# ──────────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────────
if __name__ == '__main__':
    input_file = sys.argv[1] if len(sys.argv) > 1 else input("请输入 DSL 文件路径: ")
    base, _ = os.path.splitext(input_file)
    output_file = base + '_resolved.md'
    resolver = MasterGoDSLResolver(input_file)
    resolver.run(output_file)
