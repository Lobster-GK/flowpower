#!/usr/bin/env python3
"""
validate_plan.py — _plan.md 完整性校验脚本

STEP P 完成后、STEP D 开始前执行，机械核查计划文件与 _resolved.md 的一致性。
无须依赖 LLM，纯 Python 解析两个文件，发现偏差立即报告。

用法:
  python3 resource/validate_plan.py <_resolved.md路径> <_plan.md路径>

  # 自动推断 plan 路径（resolved 路径替换后缀）
  python3 resource/validate_plan.py dsl_data_1_resolved.md

退出码:
  0 — 全部通过，可进入 STEP D
  1 — 有校验失败项，禁止进入 STEP D

校验项:
  C1  四个必需区段是否完整（## 底账 / ## 组件示例 / ## 分段策略 / ## 验证）
  C2  底账叶子节点数量与 _resolved.md leafNodes 一致（排除 LAYER(mask)）
  C3  ## 组件示例 覆盖 _resolved.md 中所有唯一 componentName（含推断组件）
  C4  ## 验证 行声称的数量与实际一致
"""

import re
import sys
from pathlib import Path


# ─────────────────────────────────────────────────────────────────────────────
# 解析 _resolved.md
# ─────────────────────────────────────────────────────────────────────────────

def parse_resolved(path: str) -> dict:
    text = Path(path).read_text(encoding='utf-8')
    lines = text.splitlines()

    # ── 1. leafNodes 头部行 ─────────────────────────────
    # 格式: "leafNodes: 6  LAYER×3  TEXT×3"
    m = re.search(r'^leafNodes:\s*(\d+)', text, re.MULTILINE)
    total_leaves = int(m.group(1)) if m else 0

    # ── 2. 逐叶子节点编号，标记 mask ─────────────────────
    # 格式: "### #N TYPE..." 或 "### #N LAYER(mask)"
    leaf_nums: set[int]  = set()
    mask_nums: set[int]  = set()
    for ln in lines:
        m = re.match(r'^### #(\d+)\s+(\S+)', ln)
        if m:
            num  = int(m.group(1))
            kind = m.group(2)
            leaf_nums.add(num)
            if kind == 'LAYER(mask)':
                mask_nums.add(num)

    # ── 3. 有 componentName / 推断组件 的 INSTANCE 节点 ──
    # 采集方式：找 "组件名: X" 和 "组件名（推断）: X" 行
    all_comp_names: list[str] = []   # 含重复（用于统计出现次数）
    for ln in lines:
        m = re.match(r'^组件名(?:（推断）)?:\s*(.+)', ln.strip())
        if m:
            all_comp_names.append(m.group(1).strip())

    # 去重保序
    seen: set[str] = set()
    unique_comp_names: list[str] = []
    for c in all_comp_names:
        if c not in seen:
            seen.add(c)
            unique_comp_names.append(c)

    return {
        'total_leaves':       total_leaves,
        'leaf_nums':          leaf_nums,
        'mask_nums':          mask_nums,
        'expected_plan_leaves': total_leaves - len(mask_nums),  # 底账应有数
        'all_comp_names':     all_comp_names,
        'unique_comp_names':  unique_comp_names,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 解析 _plan.md
# ─────────────────────────────────────────────────────────────────────────────

def parse_plan(path: str) -> dict | None:
    if not Path(path).exists():
        return None
    text = Path(path).read_text(encoding='utf-8')
    lines = text.splitlines()

    # ── 1. 四个必需区段 ────────────────────────────────
    has_ledger     = bool(re.search(r'^## 底账',    text, re.MULTILINE))
    has_components = bool(re.search(r'^## 组件示例', text, re.MULTILINE))
    has_segments   = bool(re.search(r'^## 分段策略', text, re.MULTILINE))
    has_verify     = bool(re.search(r'^## 验证',    text, re.MULTILINE))

    # ── 2. 底账表中的叶子编号 ──────────────────────────
    # 格式: | N | TYPE | 标识内容 | 节点路径 |
    leaf_rows: list[int] = []
    in_ledger = False
    for ln in lines:
        if re.match(r'^## 底账', ln):
            in_ledger = True
            continue
        if in_ledger and re.match(r'^## ', ln):
            break
        if in_ledger:
            m = re.match(r'^\|\s*(\d+)\s*\|', ln)
            if m:
                leaf_rows.append(int(m.group(1)))

    # ── 3. 组件示例区段内的组件块 ──────────────────────
    # 格式: ### ComponentName（节点: xxx，API: xxx）
    comp_blocks: list[str] = []
    in_components = False
    for ln in lines:
        if re.match(r'^## 组件示例', ln):
            in_components = True
            continue
        if in_components and re.match(r'^## ', ln):
            break
        if in_components and re.match(r'^### ', ln):
            # 提取组件名：截止到第一个空格 / 中文括号 / 半角括号
            m = re.match(r'^### ([\w./]+)', ln)
            if m:
                comp_blocks.append(m.group(1).strip())

    # ── 4. 验证行声称的数量 ────────────────────────────
    # 格式: 底账 M 个（...）| 组件 N 个
    verify_m: int | None = None
    verify_n: int | None = None
    m_m = re.search(r'底账\s+(\d+)\s*个', text)
    m_n = re.search(r'组件\s+(\d+)\s*个', text)
    if m_m:
        verify_m = int(m_m.group(1))
    if m_n:
        verify_n = int(m_n.group(1))

    return {
        'has_ledger':     has_ledger,
        'has_components': has_components,
        'has_segments':   has_segments,
        'has_verify':     has_verify,
        'leaf_rows':      leaf_rows,
        'comp_blocks':    comp_blocks,
        'verify_m':       verify_m,
        'verify_n':       verify_n,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 校验主逻辑
# ─────────────────────────────────────────────────────────────────────────────

def validate(resolved_path: str, plan_path: str) -> int:
    sep = '─' * 62

    print(sep)
    print(f'  validate_plan.py')
    print(f'  resolved : {resolved_path}')
    print(f'  plan     : {plan_path}')
    print(sep)

    # ── 文件存在检查 ──────────────────────────────────────
    if not Path(resolved_path).exists():
        print(f'✗  _resolved.md 不存在: {resolved_path}')
        return 1
    if not Path(plan_path).exists():
        print(f'✗  _plan.md 不存在: {plan_path}')
        print(f'   → 请先完成 STEP P，使用 Write 工具将计划写入 {plan_path}')
        return 1

    resolved = parse_resolved(resolved_path)
    plan     = parse_plan(plan_path)

    failures = 0

    # ════════════════════════════════════════════════════
    # C1  四个必需区段完整性
    # ════════════════════════════════════════════════════
    sections = [
        ('## 底账',    plan['has_ledger']),
        ('## 组件示例', plan['has_components']),
        ('## 分段策略', plan['has_segments']),
        ('## 验证',    plan['has_verify']),
    ]
    missing_sections = [name for name, ok in sections if not ok]
    if not missing_sections:
        print('✓  C1  区段完整性: 4/4（底账 / 组件示例 / 分段策略 / 验证）')
    else:
        for s in missing_sections:
            print(f'✗  C1  区段完整性: 缺少 {s}')
            failures += 1

    # ════════════════════════════════════════════════════
    # C2  底账叶子节点数量
    # ════════════════════════════════════════════════════
    expected = resolved['expected_plan_leaves']
    actual   = len(plan['leaf_rows'])
    plan_set = set(plan['leaf_rows'])
    res_set  = resolved['leaf_nums'] - resolved['mask_nums']  # 应出现在底账的编号

    if actual == expected and plan_set == res_set:
        print(f'✓  C2  底账数量: {actual}/{expected} 个叶子节点'
              + (f'（已排除 {len(resolved["mask_nums"])} 个 LAYER(mask)）'
                 if resolved['mask_nums'] else ''))
    else:
        print(f'✗  C2  底账数量: 底账 {actual} 个 ≠ _resolved.md 要求 {expected} 个')
        missing_nums = sorted(res_set - plan_set)
        extra_nums   = sorted(plan_set - res_set)
        if missing_nums:
            print(f'   缺少编号: #{", #".join(str(n) for n in missing_nums)}')
        if extra_nums:
            print(f'   多余编号: #{", #".join(str(n) for n in extra_nums)}')
        if resolved['mask_nums']:
            print(f'   提示: LAYER(mask) 编号 {sorted(resolved["mask_nums"])} 不列入底账')
        failures += 1

    # ════════════════════════════════════════════════════
    # C3  组件覆盖率
    # ════════════════════════════════════════════════════
    required = resolved['unique_comp_names']
    covered  = set(plan['comp_blocks'])

    if not required:
        print('✓  C3  组件覆盖: 无需组件映射表（_resolved.md 中无 componentName）')
    else:
        missing_comps = [c for c in required if c not in covered]
        if not missing_comps:
            print(f'✓  C3  组件覆盖: {len(required)} 个组件均有映射表'
                  f' ({", ".join(required)})')
        else:
            print(f'✗  C3  组件覆盖: 缺少 {len(missing_comps)}/{len(required)} 个组件的映射表')
            for c in missing_comps:
                cnt = resolved['all_comp_names'].count(c)
                print(f'   缺少: {c}（在 _resolved.md 出现 {cnt} 次）')
            # 提示多余的（_plan.md 有但 _resolved.md 没有，可能是笔误）
            extra_comps = [c for c in covered if c not in set(required)]
            if extra_comps:
                print(f'   多余（_resolved.md 中无对应）: {", ".join(extra_comps)}')
            failures += 1

    # ════════════════════════════════════════════════════
    # C4  验证行自洽性
    # ════════════════════════════════════════════════════
    c4_pass = True
    vm, vn  = plan['verify_m'], plan['verify_n']

    if vm is None and vn is None:
        print('⚠  C4  验证行: ## 验证 区段未找到"底账 N 个"或"组件 N 个"格式')
        # 不算 failure，只是警告
    else:
        if vm is not None and vm != expected:
            print(f'✗  C4  验证行: 底账声称 {vm} 个，实际应为 {expected} 个')
            c4_pass = False
            failures += 1
        if vn is not None and vn != len(required):
            print(f'✗  C4  验证行: 组件声称 {vn} 个，实际应为 {len(required)} 个')
            c4_pass = False
            failures += 1
        if c4_pass:
            print(f'✓  C4  验证行自洽: 底账 {vm} 个 | 组件 {vn} 个')

    # ════════════════════════════════════════════════════
    # 汇总
    # ════════════════════════════════════════════════════
    print(sep)
    if failures == 0:
        print('✅  全部通过 — 可进入 STEP D')
    else:
        print(f'❌  {failures} 项未通过 — 修正 _plan.md 后重新运行，通过后才能进入 STEP D')
        print(f'    python3 resource/validate_plan.py {resolved_path} {plan_path}')
    print(sep)

    return failures


# ─────────────────────────────────────────────────────────────────────────────
# 入口
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    resolved_path = sys.argv[1]

    if len(sys.argv) >= 3:
        plan_path = sys.argv[2]
    else:
        # 自动推断：将 _resolved.md 后缀换为 _plan.md
        plan_path = re.sub(r'_resolved\.md$', '_plan.md', resolved_path)
        if plan_path == resolved_path:
            print('错误: 无法从路径推断 _plan.md，请手动指定第二个参数')
            sys.exit(1)

    fail_count = validate(resolved_path, plan_path)
    sys.exit(0 if fail_count == 0 else 1)
