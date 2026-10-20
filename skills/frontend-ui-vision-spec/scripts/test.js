#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Jimp = require('jimp');

const scriptDir = __dirname;
const cropScript = path.join(scriptDir, 'crop.js');
const validateScript = path.join(scriptDir, 'validate-spec.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-ui-vision-spec-'));

function run(script, args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: tempRoot,
    encoding: 'utf8'
  });
  assert.strictEqual(
    result.status,
    expectedStatus,
    `unexpected exit ${result.status}: node ${path.basename(script)} ${args.join(' ')}\nstdout=${result.stdout}\nstderr=${result.stderr}`
  );
  return result;
}

function validSpec() {
  return `# 示例

## Spec Metadata
| 字段 | 值 |
| --- | --- |
| schema_version | 1.2 |
| analysis_profile | structure |
| mode | create |
| artifact_root | test |
| previous_spec | 不适用 |
| generated_at | 2026-07-27T00:00:00Z |

## Change Summary
不适用

## Page Summary
测试页面。

## Source And Evidence Index
### Source Input Register
| 来源标签 | 来源 | 输入类型 | 尺寸 | SHA-256 | 图片类型 | viewport | 推测状态 | 可脚本测量 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| request-1/provided | 用户需求 | text | 不适用 | 不适用 | 不适用 | desktop | default | no | - |

### Region Evidence
| 证据 ID | 来源标签 | 证据文件 | 区域 ID | 网格配置 | 网格/裁剪范围 | 原图偏移 | 放大倍数 | 提取内容 | 置信度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| evidence-request-1-page | request-1/provided | 不适用 | page-root | 不适用 | 不适用 | 不适用 | 不适用 | provided | high |

### Visual Measurements
不适用

## Layout Wireframe
\`page-root\`
└─ \`title-text\`

## Layout Tree
| 区域 ID | 父级区域 | 区域名称 | 用途 | 子区域/元素 | 排列方式 | 横向位置 | 尺寸策略 | 分隔/背景 | 来源证据 | 生命周期 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| page-root | - | 页面 | 根容器 | title-text | flex-column | full-width | 自适应 | normal | evidence-request-1-page | active | - |

## UI Element Inventory
| 元素 ID | 所属区域 ID | 元素类型 | 可见文案/内容 | 视觉状态 | 可见交互线索 | 位置关系 | 关键样式 | 来源证据 | 置信度 | 生命周期 | 是否必须实现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| title-text | page-root | section-title | 标题 | default | none | 页面顶部 | title | evidence-request-1-page | high | active | yes | - |

## Repeated Content Patterns
不适用

## Layout Constraints
- 页面包含标题。

## Visual Tokens
不适用

## Assets And Separators
不适用

## Image And Viewport Matrix
不适用

## Page State Coverage
| 状态 | 图片/需求证据 | 是否已观察 | 是否需要实现 | 处理 |
| --- | --- | --- | --- | --- |
| 默认 | request-1/provided | yes | yes | 已记录 |

## Layout Coverage Check
| 检查项 | 结果 | 问题 |
| --- | --- | --- |
| 自动验证器是否通过 | pass | - |

## Open Questions
无
`;
}

function validImageSpec(tileCount, sourceSha256, width = 80, height = 240) {
  return validSpec()
    .replace('| analysis_profile | structure |', '| analysis_profile | standard |')
    .replace(
      '| request-1/provided | 用户需求 | text | 不适用 | 不适用 | 不适用 | desktop | default | no | - |',
      `| image-1/desktop/default | fixture.png | image | ${width}×${height} | ${sourceSha256} | 设计稿 | desktop | default | yes | - |`
    )
    .replace(
      '| evidence-request-1-page | request-1/provided | 不适用 | page-root | 不适用 | 不适用 | 不适用 | 不适用 | provided | high |',
      '| evidence-image-1-page | image-1/desktop/default | visual-evidence/image-1/overview.png | page-root | tile-map | full | 0,0 | 1x | full overview | high |\n\n' +
      '### Tile Inspection Log\n' +
      '| 来源标签 | Manifest 文件 | Tile 总数 | 已检查 Tile | 未检查 Tile | 边界复检 | 结果 |\n' +
      '| --- | --- | --- | --- | --- | --- | --- |\n' +
      `| image-1/desktop/default | visual-evidence/image-1/manifest.json | ${tileCount} | all | 0 | pass | pass |`
    )
    .replaceAll('evidence-request-1-page', 'evidence-image-1-page')
    .replace('| 默认 | request-1/provided |', '| 默认 | image-1/desktop/default |');
}

function assertAxisCoverage(axis, sourceSize, expectedMode, expectedSegments, minimumOverlap) {
  assert.strictEqual(axis.mode, expectedMode);
  assert.strictEqual(axis.segments, expectedSegments);
  assert.strictEqual(axis.starts.length, expectedSegments);
  assert.strictEqual(axis.starts[0], 0);
  assert.strictEqual(axis.starts[axis.starts.length - 1] + axis.tile_size, sourceSize);
  for (let index = 1; index < axis.starts.length; index++) {
    const step = axis.starts[index] - axis.starts[index - 1];
    const actualOverlap = (axis.tile_size - step) / axis.tile_size;
    assert.ok(
      actualOverlap + 1 / axis.tile_size >= minimumOverlap,
      `overlap ${actualOverlap} below ${minimumOverlap}`
    );
  }
}

(async () => {
  try {
    const fixture = path.join(tempRoot, 'fixture.png');
    const img = new Jimp(80, 240, 0xffffffff);
    img.scan(10, 20, 60, 40, (x, y, index) => {
      img.bitmap.data[index] = 16;
      img.bitmap.data[index + 1] = 128;
      img.bitmap.data[index + 2] = 192;
      img.bitmap.data[index + 3] = 255;
    });
    await img.writeAsync(fixture);

    const info = run(cropScript, ['info', fixture, '--json']);
    const metadata = JSON.parse(info.stdout);
    assert.strictEqual(metadata.width, 80);
    assert.strictEqual(metadata.height, 240);
    assert.match(metadata.sha256, /^[a-f0-9]{64}$/);

    const grid = path.join(tempRoot, 'grid.png');
    const cut = path.join(tempRoot, 'cut.png');
    const slicePrefix = path.join(tempRoot, 'slice');
    run(cropScript, ['grid', fixture, '--cols', '4', '--rows', '6', '-o', grid]);
    run(cropScript, ['cut', fixture, '--cells', 'A1:B2', '--cols', '4', '--rows', '6', '--scale', '2', '-o', cut]);
    const pick = run(cropScript, ['pick', fixture, '--at', '0.5,0.1']);
    assert.match(pick.stdout, /#1080c0/);
    run(cropScript, ['slice', fixture, '--ratio', '2.5', '--overlap', '0.1', '-o', slicePrefix]);
    assert.ok(fs.existsSync(`${slicePrefix}_slice01.png`));
    assert.ok(fs.existsSync(`${slicePrefix}_slice02.png`));

    const evidenceRoot = path.join(tempRoot, 'artifact', 'visual-evidence', 'image-1');
    run(cropScript, ['prepare', fixture, '--tile', '128x128', '-o', evidenceRoot]);
    const manifestPath = path.join(evidenceRoot, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.schema_version, '1.1');
    assert.strictEqual(manifest.preparation.method, 'explicit-fixed-overlap-tiles');
    assert.strictEqual(manifest.preparation.overlap, 0.2);
    assert.strictEqual(manifest.preparation.tile_count, manifest.tiles.length);
    assert.ok(manifest.tiles.length > 1);
    assert.ok(fs.existsSync(path.join(evidenceRoot, manifest.overview.path)));
    assert.ok(fs.existsSync(path.join(evidenceRoot, manifest.tile_map.path)));
    for (const tile of manifest.tiles) {
      assert.ok(fs.existsSync(path.join(evidenceRoot, tile.file.path)));
      assert.ok(tile.bbox.x >= 0 && tile.bbox.y >= 0);
      assert.ok(tile.bbox.right <= manifest.source.width);
      assert.ok(tile.bbox.bottom <= manifest.source.height);
    }

    const adaptiveCases = [
      { name: 'tiny', width: 300, height: 200, columns: 1, rows: 1, xMode: 'single', yMode: 'single' },
      { name: 'card', width: 600, height: 400, columns: 2, rows: 2, xMode: 'grid', yMode: 'grid' },
      { name: 'wide-card', width: 1200, height: 600, columns: 3, rows: 2, xMode: 'grid', yMode: 'grid' },
      { name: 'desktop', width: 1920, height: 1080, columns: 4, rows: 3, xMode: 'grid', yMode: 'grid' },
      { name: 'large-axis', width: 2500, height: 600, columns: 5, rows: 2, xMode: 'fixed-pixels', yMode: 'grid' }
    ];
    for (const item of adaptiveCases) {
      const imagePath = path.join(tempRoot, `${item.name}.png`);
      await new Jimp(item.width, item.height, 0xffffffff).writeAsync(imagePath);
      const output = path.join(tempRoot, `adaptive-${item.name}`);
      run(cropScript, ['prepare', imagePath, '--overview-max', '320', '-o', output]);
      const adaptive = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
      assert.strictEqual(adaptive.schema_version, '1.1');
      assert.strictEqual(adaptive.preparation.method, 'adaptive-axis-overlap-tiles');
      assert.strictEqual(adaptive.preparation.overlap, 0.2);
      assert.strictEqual(adaptive.preparation.columns, item.columns);
      assert.strictEqual(adaptive.preparation.rows, item.rows);
      assert.strictEqual(adaptive.tiles.length, item.columns * item.rows);
      assertAxisCoverage(adaptive.preparation.x, item.width, item.xMode, item.columns, 0.2);
      assertAxisCoverage(adaptive.preparation.y, item.height, item.yMode, item.rows, 0.2);
    }

    const adaptiveArtifact = path.join(tempRoot, 'adaptive-artifact');
    const adaptiveEvidence = path.join(adaptiveArtifact, 'visual-evidence', 'image-1');
    run(cropScript, [
      'prepare', path.join(tempRoot, 'card.png'),
      '--overlap', '0.2',
      '--overview-max', '320',
      '-o', adaptiveEvidence
    ]);
    const adaptiveManifest = JSON.parse(fs.readFileSync(path.join(adaptiveEvidence, 'manifest.json'), 'utf8'));
    const adaptiveSpec = path.join(adaptiveArtifact, '01-ui-layout-spec.md');
    fs.writeFileSync(
      adaptiveSpec,
      validImageSpec(adaptiveManifest.tiles.length, adaptiveManifest.source.sha256, 600, 400),
      'utf8'
    );
    run(validateScript, [adaptiveSpec]);

    const fallbackImage = path.join(tempRoot, 'fallback-large.png');
    await new Jimp(2500, 2500, 0xffffffff).writeAsync(fallbackImage);
    const fallbackOutput = path.join(tempRoot, 'adaptive-fallback');
    run(cropScript, [
      'prepare', fallbackImage,
      '--overlap', '0.2',
      '--max-tiles', '20',
      '--overview-max', '320',
      '-o', fallbackOutput
    ]);
    const fallbackManifest = JSON.parse(fs.readFileSync(path.join(fallbackOutput, 'manifest.json'), 'utf8'));
    assert.strictEqual(fallbackManifest.preparation.fixed_tile_requested, 640);
    assert.strictEqual(fallbackManifest.preparation.fixed_tile_effective, 768);
    assert.strictEqual(fallbackManifest.preparation.columns, 4);
    assert.strictEqual(fallbackManifest.preparation.rows, 4);
    assert.strictEqual(fallbackManifest.tiles.length, 16);
    run(cropScript, [
      'prepare', fallbackImage,
      '--overlap', '0.2',
      '--max-tiles', '10',
      '--overview-max', '320',
      '-o', path.join(tempRoot, 'adaptive-over-limit')
    ], 1);

    run(cropScript, ['grid', fixture, '--cols', '4', '--rows', '6', '-o', grid], 1);
    run(cropScript, ['grid', fixture, '--cols', '0', '--rows', '6', '-o', path.join(tempRoot, 'invalid.png')], 1);
    run(cropScript, ['prepare', fixture, '--tile', '128x128', '--overlap', '0.2', '-o', evidenceRoot], 1);

    const spec = path.join(tempRoot, 'valid-spec.md');
    fs.writeFileSync(spec, validSpec(), 'utf8');
    run(validateScript, [spec]);

    const misclassifiedLocalSpec = path.join(tempRoot, 'misclassified-local-spec.md');
    fs.writeFileSync(
      misclassifiedLocalSpec,
      validSpec()
        .replace(
          '| request-1/provided | 用户需求 | text | 不适用 | 不适用 | 不适用 | desktop | default | no | - |',
          `| image-1/desktop/default | \`${fixture}\` | image | 80×240 | ${manifest.source.sha256} | 设计稿 | desktop | default | no | - |`
        )
        .replaceAll('request-1/provided', 'image-1/desktop/default'),
      'utf8'
    );
    const misclassifiedResult = run(validateScript, [misclassifiedLocalSpec], 1);
    assert.match(misclassifiedResult.stderr, /存在但被标为不可脚本测量/);

    const imageSpec = path.join(tempRoot, 'artifact', '01-ui-layout-spec.md');
    fs.writeFileSync(imageSpec, validImageSpec(manifest.tiles.length, manifest.source.sha256), 'utf8');
    run(validateScript, [imageSpec]);

    const invalidPlanManifest = path.join(evidenceRoot, 'invalid-plan-manifest.json');
    const invalidPlan = JSON.parse(JSON.stringify(manifest));
    invalidPlan.preparation.x.mode = 'grid';
    fs.writeFileSync(invalidPlanManifest, JSON.stringify(invalidPlan, null, 2), 'utf8');
    const invalidPlanSpec = path.join(tempRoot, 'artifact', 'invalid-plan-spec.md');
    fs.writeFileSync(
      invalidPlanSpec,
      validImageSpec(manifest.tiles.length, manifest.source.sha256).replace(
        'visual-evidence/image-1/manifest.json',
        'visual-evidence/image-1/invalid-plan-manifest.json'
      ),
      'utf8'
    );
    run(validateScript, [invalidPlanSpec], 1);

    const missingEvidenceSpec = path.join(tempRoot, 'artifact', 'missing-evidence-spec.md');
    fs.writeFileSync(
      missingEvidenceSpec,
      validImageSpec(manifest.tiles.length, manifest.source.sha256).replace(
        'visual-evidence/image-1/overview.png',
        'visual-evidence/image-1/missing.png'
      ),
      'utf8'
    );
    run(validateScript, [missingEvidenceSpec], 1);

    const incompleteTilesSpec = path.join(tempRoot, 'artifact', 'incomplete-tiles-spec.md');
    fs.writeFileSync(
      incompleteTilesSpec,
      validImageSpec(manifest.tiles.length, manifest.source.sha256).replace('| all | 0 | pass | pass |', '| all | 1 | pass | pass |'),
      'utf8'
    );
    run(validateScript, [incompleteTilesSpec], 1);

    const invalidSpec = path.join(tempRoot, 'invalid-spec.md');
    fs.writeFileSync(invalidSpec, validSpec().replace('| title-text | page-root |', '| page-root | page-root |'), 'utf8');
    run(validateScript, [invalidSpec], 1);

    const invalidStateSpec = path.join(tempRoot, 'invalid-state-spec.md');
    fs.writeFileSync(
      invalidStateSpec,
      validSpec().replace(
        '| title-text | page-root | section-title | 标题 | default | none | 页面顶部 | title | evidence-request-1-page | high | active | yes | - |',
        '| title-text | page-root | section-title | 标题 | default | none | 页面顶部 | title | evidence-request-1-page | high | active | yes | - |\n' +
        '| title-text-loading | page-root | section-title | 标题 | loading | none | 页面顶部 | title | evidence-request-1-page | high | conditional | conditional | - |'
      ),
      'utf8'
    );
    run(validateScript, [invalidStateSpec], 1);

    console.log('All frontend-ui-vision-spec script tests passed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
