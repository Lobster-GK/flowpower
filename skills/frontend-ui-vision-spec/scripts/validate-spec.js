#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AXIS_THRESHOLDS = Object.freeze({
  singleMax: 320,
  twoMax: 900,
  threeMax: 1600,
  fourMax: 2400
});

const REQUIRED_SECTIONS = [
  'Spec Metadata',
  'Change Summary',
  'Page Summary',
  'Source And Evidence Index',
  'Layout Wireframe',
  'Layout Tree',
  'UI Element Inventory',
  'Repeated Content Patterns',
  'Layout Constraints',
  'Visual Tokens',
  'Assets And Separators',
  'Image And Viewport Matrix',
  'Page State Coverage',
  'Layout Coverage Check',
  'Open Questions'
];

const TABLE_HEADINGS = {
  metadata: 'Spec Metadata',
  changes: 'Change Summary',
  sources: 'Source Input Register',
  evidence: 'Region Evidence',
  tileCoverage: 'Tile Inspection Log',
  measurements: 'Visual Measurements',
  regions: 'Layout Tree',
  elements: 'UI Element Inventory',
  repeated: 'Repeated Content Patterns',
  matrix: 'Image And Viewport Matrix',
  states: 'Page State Coverage',
  coverage: 'Layout Coverage Check'
};

function usage() {
  console.log('用法: node validate-spec.js <01-ui-layout-spec.md> [--strict]');
}

function splitMarkdownRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  const cells = [];
  let current = '';
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (ch === '\\' && text[index + 1] === '|') {
      current += text[index + 1];
      index++;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseHeadings(lines) {
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(lines[i]);
    if (match) headings.push({ level: match[1].length, title: match[2].trim(), line: i });
  }
  return headings;
}

function sectionBounds(headings, title) {
  const itemIndex = headings.findIndex(item => item.title === title);
  if (itemIndex < 0) return null;
  const item = headings[itemIndex];
  let end = Infinity;
  for (let i = itemIndex + 1; i < headings.length; i++) {
    if (headings[i].level <= item.level) {
      end = headings[i].line;
      break;
    }
  }
  return { start: item.line + 1, end };
}

function parseTable(lines, headings, title) {
  const bounds = sectionBounds(headings, title);
  if (!bounds) return null;
  const end = Math.min(bounds.end, lines.length);
  for (let i = bounds.start; i < end - 1; i++) {
    if (lines[i].trim().startsWith('|') && isSeparator(lines[i + 1])) {
      const headers = splitMarkdownRow(lines[i]);
      const rows = [];
      for (let j = i + 2; j < end; j++) {
        if (!lines[j].trim().startsWith('|')) break;
        const cells = splitMarkdownRow(lines[j]);
        const row = {};
        headers.forEach((header, index) => { row[header] = cells[index] || ''; });
        row.__line = j + 1;
        rows.push(row);
      }
      return { headers, rows, line: i + 1 };
    }
  }
  return null;
}

function sectionText(lines, headings, title) {
  const bounds = sectionBounds(headings, title);
  if (!bounds) return '';
  return lines.slice(bounds.start, Math.min(bounds.end, lines.length)).join('\n').trim();
}

function clean(value) {
  return String(value || '').replace(/`/g, '').trim();
}

function isNA(value) {
  return /^(?:-|无|不适用|n\/a|none)$/i.test(clean(value));
}

function isKebab(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean(value));
}

function evidenceRefs(value) {
  return [...clean(value).matchAll(/\bevidence-[a-z0-9-]+\b/g)].map(match => match[0]);
}

function parseDimensions(value) {
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(clean(value));
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function addUniqueId(kind, value, line, idOwners, errors) {
  const id = clean(value);
  if (!id || isNA(id)) return null;
  if (!isKebab(id)) errors.push(`${kind} ID 不是 kebab-case: "${id}" (line ${line})`);
  if (idOwners.has(id)) errors.push(`重复 ID "${id}": ${idOwners.get(id)} 与 ${kind} line ${line}`);
  else idOwners.set(id, `${kind} line ${line}`);
  return id;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveArtifactFile(specDir, value) {
  const raw = clean(value);
  if (!raw || isNA(raw)) return null;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(specDir, raw);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validatePhysicalFile(specDir, value, label, errors, expectedSha256 = null) {
  const resolved = resolveArtifactFile(specDir, value);
  if (!resolved) {
    errors.push(`${label} 缺少文件路径`);
    return null;
  }
  if (!isWithin(specDir, resolved)) {
    errors.push(`${label} 必须位于 artifact 目录内: ${resolved}`);
    return null;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    errors.push(`${label} 文件不存在: ${resolved}`);
    return null;
  }
  if (fs.statSync(resolved).size <= 0) {
    errors.push(`${label} 文件为空: ${resolved}`);
    return null;
  }
  if (expectedSha256 && sha256File(resolved) !== expectedSha256) {
    errors.push(`${label} SHA-256 与 manifest 不一致: ${resolved}`);
  }
  return resolved;
}

function expectedAdaptiveAxis(size) {
  if (size <= AXIS_THRESHOLDS.singleMax) return { mode: 'single', segments: 1 };
  if (size <= AXIS_THRESHOLDS.twoMax) return { mode: 'grid', segments: 2 };
  if (size <= AXIS_THRESHOLDS.threeMax) return { mode: 'grid', segments: 3 };
  if (size <= AXIS_THRESHOLDS.fourMax) return { mode: 'grid', segments: 4 };
  return { mode: 'fixed-pixels', segments: null };
}

function validateAxisPlan(axis, axisName, sourceSize, method, overlap, effectiveFixedTile, errors, sourceLabel) {
  const prefix = `来源 ${sourceLabel} manifest ${axisName} 轴`;
  if (!axis || typeof axis !== 'object') {
    errors.push(`${prefix}缺少分块计划`);
    return null;
  }
  const mode = clean(axis.mode);
  const tileSize = Number(axis.tile_size);
  const segments = Number(axis.segments);
  const starts = Array.isArray(axis.starts) ? axis.starts.map(Number) : [];
  if (!['single', 'grid', 'fixed-pixels', 'explicit-fixed'].includes(mode)) errors.push(`${prefix}模式无效: ${mode}`);
  if (Number(axis.source_size) !== sourceSize) errors.push(`${prefix}原图尺寸不一致`);
  if (!Number.isInteger(tileSize) || tileSize <= 0 || tileSize > sourceSize) errors.push(`${prefix} tile_size 无效`);
  if (!Number.isInteger(segments) || segments < 1 || starts.length !== segments) errors.push(`${prefix} segments/starts 不一致`);
  if (starts.length > 0) {
    if (starts[0] !== 0) errors.push(`${prefix}未从 0 开始`);
    if (starts[starts.length - 1] + tileSize !== sourceSize) errors.push(`${prefix}末片未贴齐原图边界`);
    for (let index = 0; index < starts.length; index++) {
      if (!Number.isInteger(starts[index]) || starts[index] < 0 || starts[index] + tileSize > sourceSize) {
        errors.push(`${prefix}起点越界: ${starts[index]}`);
      }
      if (index > 0) {
        const gap = starts[index] - starts[index - 1];
        if (gap <= 0) errors.push(`${prefix}起点未严格递增`);
        const actualOverlap = (tileSize - gap) / tileSize;
        if (actualOverlap + 1 / tileSize < overlap) {
          errors.push(`${prefix}相邻 tile 重叠度低于 ${overlap}`);
        }
      }
    }
  }
  if (mode === 'single' && (segments !== 1 || tileSize !== sourceSize)) errors.push(`${prefix} single 计划无效`);

  if (method === 'adaptive-axis-overlap-tiles') {
    const expected = expectedAdaptiveAxis(sourceSize);
    if (mode !== expected.mode) errors.push(`${prefix}未遵循自适应分档，应为 ${expected.mode}`);
    if (expected.segments !== null && segments !== expected.segments) {
      errors.push(`${prefix}未遵循自适应分档，应为 ${expected.segments} 段`);
    }
    if (expected.mode === 'fixed-pixels' && tileSize !== Math.min(sourceSize, effectiveFixedTile)) {
      errors.push(`${prefix}固定窗口尺寸与 fixed_tile_effective 不一致`);
    }
  }
  if (method === 'explicit-fixed-overlap-tiles' && !['single', 'explicit-fixed'].includes(mode)) {
    errors.push(`${prefix}与 explicit-fixed 方法不一致`);
  }
  return { mode, tileSize, segments, starts };
}

function validateManifest(specDir, manifestValue, sourceLabel, errors) {
  const manifestPath = validatePhysicalFile(specDir, manifestValue, `来源 ${sourceLabel} manifest`, errors);
  if (!manifestPath) return null;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    errors.push(`来源 ${sourceLabel} manifest 不是有效 JSON: ${error.message}`);
    return null;
  }
  if (manifest.schema_version !== '1.1') errors.push(`来源 ${sourceLabel} manifest schema_version 必须为 1.1`);
  const manifestDir = path.dirname(manifestPath);
  const sourceWidth = Number(manifest.source?.width);
  const sourceHeight = Number(manifest.source?.height);
  if (!(sourceWidth > 0 && sourceHeight > 0)) errors.push(`来源 ${sourceLabel} manifest 缺少有效原图尺寸`);
  if (!/^[a-f0-9]{64}$/i.test(clean(manifest.source?.sha256))) {
    errors.push(`来源 ${sourceLabel} manifest 缺少有效原图 SHA-256`);
  }

  for (const [key, record] of [['overview', manifest.overview], ['tile-map', manifest.tile_map]]) {
    if (!record?.path) {
      errors.push(`来源 ${sourceLabel} manifest 缺少 ${key}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/i.test(clean(record.sha256))) {
      errors.push(`来源 ${sourceLabel} manifest ${key} SHA-256 无效`);
    }
    const file = path.resolve(manifestDir, record.path);
    const relativeToArtifact = path.relative(specDir, file);
    validatePhysicalFile(specDir, relativeToArtifact, `来源 ${sourceLabel} ${key}`, errors, record.sha256);
  }

  const tiles = Array.isArray(manifest.tiles) ? manifest.tiles : [];
  if (tiles.length === 0) errors.push(`来源 ${sourceLabel} manifest 不含 tile`);
  const method = clean(manifest.preparation?.method);
  if (!['adaptive-axis-overlap-tiles', 'explicit-fixed-overlap-tiles'].includes(method)) {
    errors.push(`来源 ${sourceLabel} manifest preparation.method 无效`);
  }
  const overlap = Number(manifest.preparation?.overlap);
  if (!(overlap >= 0 && overlap < 0.5)) errors.push(`来源 ${sourceLabel} manifest overlap 无效`);
  const effectiveFixedTile = Number(manifest.preparation?.fixed_tile_effective);
  if (method === 'adaptive-axis-overlap-tiles') {
    const thresholds = manifest.preparation?.thresholds || {};
    if (
      Number(thresholds.single_max) !== AXIS_THRESHOLDS.singleMax ||
      Number(thresholds.two_max) !== AXIS_THRESHOLDS.twoMax ||
      Number(thresholds.three_max) !== AXIS_THRESHOLDS.threeMax ||
      Number(thresholds.four_max) !== AXIS_THRESHOLDS.fourMax
    ) {
      errors.push(`来源 ${sourceLabel} manifest 自适应阈值与 schema 不一致`);
    }
    if (!Number.isInteger(effectiveFixedTile) || effectiveFixedTile < 128) {
      errors.push(`来源 ${sourceLabel} manifest fixed_tile_effective 无效`);
    }
  }
  const xPlan = validateAxisPlan(
    manifest.preparation?.x,
    'x',
    sourceWidth,
    method,
    overlap,
    effectiveFixedTile,
    errors,
    sourceLabel
  );
  const yPlan = validateAxisPlan(
    manifest.preparation?.y,
    'y',
    sourceHeight,
    method,
    overlap,
    effectiveFixedTile,
    errors,
    sourceLabel
  );
  const expectedCount = Number(manifest.preparation?.tile_count);
  if (!Number.isInteger(expectedCount) || expectedCount !== tiles.length) {
    errors.push(`来源 ${sourceLabel} manifest tile_count 与 tiles 数量不一致`);
  }
  const expectedRows = Number(manifest.preparation?.rows);
  const expectedColumns = Number(manifest.preparation?.columns);
  if (!Number.isInteger(expectedRows) || !Number.isInteger(expectedColumns) || expectedRows * expectedColumns !== tiles.length) {
    errors.push(`来源 ${sourceLabel} manifest 行列数与 tiles 数量不一致`);
  }
  if (xPlan && expectedColumns !== xPlan.segments) errors.push(`来源 ${sourceLabel} manifest columns 与 x 轴计划不一致`);
  if (yPlan && expectedRows !== yPlan.segments) errors.push(`来源 ${sourceLabel} manifest rows 与 y 轴计划不一致`);
  const declaredMaxTiles = Number(manifest.preparation?.max_tiles);
  if (!Number.isInteger(declaredMaxTiles) || declaredMaxTiles < tiles.length) {
    errors.push(`来源 ${sourceLabel} manifest max_tiles 无效或小于实际数量`);
  }

  const tileIds = new Set();
  const gridCells = new Set();
  for (const tile of tiles) {
    const id = clean(tile.id);
    if (!/^r\d{2,}-c\d{2,}$/.test(id)) errors.push(`来源 ${sourceLabel} manifest tile ID 无效: ${id || '(空)'}`);
    if (tileIds.has(id)) errors.push(`来源 ${sourceLabel} manifest 重复 tile ID: ${id}`);
    tileIds.add(id);
    const row = Number(tile.row), column = Number(tile.column);
    gridCells.add(`${row}:${column}`);
    if (!(row >= 1 && row <= expectedRows && column >= 1 && column <= expectedColumns)) {
      errors.push(`来源 ${sourceLabel} tile ${id} 行列越界`);
    }
    const bbox = tile.bbox || {};
    const x = Number(bbox.x), y = Number(bbox.y), width = Number(bbox.width), height = Number(bbox.height);
    if (!(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= sourceWidth && y + height <= sourceHeight)) {
      errors.push(`来源 ${sourceLabel} tile ${id} bbox 越界或无效`);
    }
    if (xPlan && width !== xPlan.tileSize) errors.push(`来源 ${sourceLabel} tile ${id} 宽度与 x 轴计划不一致`);
    if (yPlan && height !== yPlan.tileSize) errors.push(`来源 ${sourceLabel} tile ${id} 高度与 y 轴计划不一致`);
    if (!tile.file?.path) {
      errors.push(`来源 ${sourceLabel} tile ${id} 缺少文件记录`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/i.test(clean(tile.file.sha256))) {
      errors.push(`来源 ${sourceLabel} tile ${id} SHA-256 无效`);
    }
    const file = path.resolve(manifestDir, tile.file.path);
    const relativeToArtifact = path.relative(specDir, file);
    validatePhysicalFile(specDir, relativeToArtifact, `来源 ${sourceLabel} tile ${id}`, errors, tile.file.sha256);
  }
  if (gridCells.size !== tiles.length) errors.push(`来源 ${sourceLabel} manifest 存在重复行列位置`);

  const rows = new Map();
  for (const tile of tiles) {
    const row = Number(tile.row);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(tile);
  }
  for (let row = 1; row <= expectedRows; row++) {
    const rowTiles = (rows.get(row) || []).sort((a, b) => Number(a.bbox?.x) - Number(b.bbox?.x));
    if (rowTiles.length !== expectedColumns) {
      errors.push(`来源 ${sourceLabel} manifest 第 ${row} 行 tile 不完整`);
      continue;
    }
    if (Number(rowTiles[0].bbox?.x) !== 0) errors.push(`来源 ${sourceLabel} manifest 第 ${row} 行未覆盖左边界`);
    if (Number(rowTiles[rowTiles.length - 1].bbox?.right) !== sourceWidth) {
      errors.push(`来源 ${sourceLabel} manifest 第 ${row} 行未覆盖右边界`);
    }
    for (let i = 1; i < rowTiles.length; i++) {
      if (Number(rowTiles[i].bbox?.x) > Number(rowTiles[i - 1].bbox?.right)) {
        errors.push(`来源 ${sourceLabel} manifest 第 ${row} 行存在水平覆盖空洞`);
      }
    }
  }
  const firstRow = (rows.get(1) || [])[0];
  const lastRow = (rows.get(expectedRows) || [])[0];
  if (firstRow && Number(firstRow.bbox?.y) !== 0) errors.push(`来源 ${sourceLabel} manifest 未覆盖上边界`);
  if (lastRow && Number(lastRow.bbox?.bottom) !== sourceHeight) errors.push(`来源 ${sourceLabel} manifest 未覆盖下边界`);
  for (let row = 2; row <= expectedRows; row++) {
    const previous = (rows.get(row - 1) || [])[0];
    const current = (rows.get(row) || [])[0];
    if (previous && current && Number(current.bbox?.y) > Number(previous.bbox?.bottom)) {
      errors.push(`来源 ${sourceLabel} manifest 第 ${row - 1}/${row} 行之间存在垂直覆盖空洞`);
    }
  }
  return {
    path: manifestPath,
    tileIds,
    tileCount: tiles.length,
    sourceSha256: clean(manifest.source?.sha256),
    sourcePath: clean(manifest.source?.path),
    sourceWidth,
    sourceHeight
  };
}

function validate(specPath, strict) {
  const absolute = path.resolve(specPath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    console.error(`spec 不存在或不是文件: ${absolute}`);
    return 1;
  }

  const specDir = path.dirname(absolute);
  const content = fs.readFileSync(absolute, 'utf8');
  const lines = content.split(/\r?\n/);
  const headings = parseHeadings(lines);
  const headingSet = new Set(headings.filter(item => item.level === 2).map(item => item.title));
  const errors = [];
  const warnings = [];

  for (const title of REQUIRED_SECTIONS) {
    if (!headingSet.has(title)) errors.push(`缺少章节: ## ${title}`);
  }

  const tables = {};
  for (const [key, title] of Object.entries(TABLE_HEADINGS)) {
    tables[key] = parseTable(lines, headings, title);
  }

  for (const key of ['metadata', 'sources', 'regions', 'elements', 'states', 'coverage']) {
    if (!tables[key]) errors.push(`缺少必要表格: ${TABLE_HEADINGS[key]}`);
  }

  const metadata = new Map((tables.metadata?.rows || []).map(row => [clean(row['字段']), clean(row['值'])]));
  if (metadata.get('schema_version') !== '1.2') errors.push('schema_version 必须为 1.2');
  if (!['structure', 'standard', 'precision'].includes(metadata.get('analysis_profile'))) {
    errors.push('analysis_profile 必须为 structure、standard 或 precision');
  }
  if (!['create', 'update'].includes(metadata.get('mode'))) errors.push('mode 必须为 create 或 update');
  if (!metadata.get('artifact_root')) errors.push('Spec Metadata 缺少 artifact_root');
  if (!metadata.get('generated_at')) errors.push('Spec Metadata 缺少 generated_at');
  if (metadata.get('mode') === 'update' && (!tables.changes || tables.changes.rows.length === 0)) {
    errors.push('update 模式必须填写 Change Summary 表格');
  }

  const sourceLabels = new Set();
  const sourceScriptability = new Map();
  const sourceMetadata = new Map();
  for (const row of tables.sources?.rows || []) {
    const label = clean(row['来源标签']);
    if (!label) errors.push(`来源标签为空 (line ${row.__line})`);
    else if (sourceLabels.has(label)) errors.push(`重复来源标签 "${label}" (line ${row.__line})`);
    else sourceLabels.add(label);
    const scriptable = clean(row['可脚本测量']);
    if (scriptable && !['yes', 'no'].includes(scriptable)) {
      errors.push(`可脚本测量必须为 yes/no (line ${row.__line})`);
    }
    const inputType = clean(row['输入类型']).toLowerCase();
    const sourceValue = clean(row['来源']);
    const localSource = path.isAbsolute(sourceValue) && fs.existsSync(sourceValue) && fs.statSync(sourceValue).isFile();
    if (inputType === 'image' && localSource && scriptable !== 'yes') {
      errors.push(`本地图片来源 ${label || '(空)'} 存在但被标为不可脚本测量 (line ${row.__line})`);
    }
    if (label) sourceScriptability.set(label, inputType === 'image' && localSource ? 'yes' : scriptable);
    if (label) {
      sourceMetadata.set(label, {
        sha256: clean(row['SHA-256']),
        sourcePath: sourceValue,
        localSource,
        dimensions: parseDimensions(row['尺寸'])
      });
    }
    if (scriptable === 'yes' && !/^[a-f0-9]{64}$/i.test(clean(row['SHA-256']))) {
      errors.push(`可脚本测量来源 SHA-256 无效: ${label} (line ${row.__line})`);
    }
    if (scriptable === 'yes' && !parseDimensions(row['尺寸'])) {
      errors.push(`可脚本测量来源尺寸必须为 <width>×<height>: ${label} (line ${row.__line})`);
    }
  }
  if (sourceLabels.size === 0) errors.push('Source Input Register 至少需要一个来源');

  const scriptableSources = new Set(
    [...sourceScriptability.entries()].filter(([, value]) => value === 'yes').map(([label]) => label)
  );
  const manifests = new Map();
  if (scriptableSources.size > 0 && !tables.tileCoverage) {
    errors.push('存在可脚本测量图片时必须填写 Tile Inspection Log');
  }
  for (const row of tables.tileCoverage?.rows || []) {
    const source = clean(row['来源标签']);
    if (!scriptableSources.has(source)) {
      errors.push(`Tile Inspection Log 引用非脚本图片来源 "${source || '(空)'}" (line ${row.__line})`);
      continue;
    }
    if (manifests.has(source)) {
      errors.push(`Tile Inspection Log 重复来源 "${source}" (line ${row.__line})`);
      continue;
    }
    const manifest = validateManifest(specDir, row['Manifest 文件'], source, errors);
    if (!manifest) continue;
    manifests.set(source, manifest);
    const sourceMeta = sourceMetadata.get(source);
    if (sourceMeta?.sha256 && manifest.sourceSha256 !== sourceMeta.sha256) {
      errors.push(`来源 ${source} 的 Source Input SHA-256 与 manifest 不一致 (line ${row.__line})`);
    }
    if (
      sourceMeta?.dimensions &&
      (
        sourceMeta.dimensions.width !== manifest.sourceWidth ||
        sourceMeta.dimensions.height !== manifest.sourceHeight
      )
    ) {
      errors.push(`来源 ${source} 的 Source Input 尺寸与 manifest 不一致 (line ${row.__line})`);
    }
    if (
      sourceMeta?.localSource &&
      manifest.sourcePath &&
      path.resolve(manifest.sourcePath) !== path.resolve(sourceMeta.sourcePath)
    ) {
      errors.push(`来源 ${source} 的本地路径与 manifest 不一致 (line ${row.__line})`);
    }
    const declaredCount = Number(clean(row['Tile 总数']));
    if (!Number.isInteger(declaredCount) || declaredCount !== manifest.tileCount) {
      errors.push(`来源 ${source} Tile 总数与 manifest 不一致 (line ${row.__line})`);
    }
    const inspected = clean(row['已检查 Tile']).toLowerCase();
    if (inspected !== 'all') {
      const inspectedIds = new Set(inspected.split(/[\s,，]+/).filter(Boolean));
      if (inspectedIds.size !== manifest.tileIds.size || [...manifest.tileIds].some(id => !inspectedIds.has(id))) {
        errors.push(`来源 ${source} 已检查 Tile 未完整覆盖 manifest (line ${row.__line})`);
      }
    }
    if (clean(row['未检查 Tile']) !== '0') errors.push(`来源 ${source} 仍有未检查 Tile (line ${row.__line})`);
    if (!['pass', '不适用'].includes(clean(row['边界复检']).toLowerCase())) {
      errors.push(`来源 ${source} 边界复检必须为 pass/不适用 (line ${row.__line})`);
    }
    if (clean(row['结果']).toLowerCase() !== 'pass') errors.push(`来源 ${source} Tile Inspection Log 未通过 (line ${row.__line})`);
  }
  for (const source of scriptableSources) {
    if (!manifests.has(source)) errors.push(`可脚本测量来源 ${source} 缺少有效 manifest 与完整 tile 检查记录`);
  }

  const idOwners = new Map();
  const evidenceIds = new Set();
  const evidenceSources = new Map();
  const physicalEvidenceIds = new Set();
  if (tables.evidence && !tables.evidence.headers.includes('证据文件')) {
    errors.push('Region Evidence 缺少“证据文件”列');
  }
  for (const row of tables.evidence?.rows || []) {
    const id = addUniqueId('证据', row['证据 ID'], row.__line, idOwners, errors);
    if (id) evidenceIds.add(id);
    const source = clean(row['来源标签']);
    if (source && !sourceLabels.has(source)) errors.push(`证据引用未知来源 "${source}" (line ${row.__line})`);
    if (id) evidenceSources.set(id, source);
    const evidenceFile = clean(row['证据文件']);
    if (scriptableSources.has(source)) {
      const physical = validatePhysicalFile(specDir, evidenceFile, `证据 ${id || '(空)'}`, errors);
      if (physical && id) physicalEvidenceIds.add(id);
    } else if (evidenceFile && !isNA(evidenceFile)) {
      errors.push(`不可脚本测量来源 ${source || '(空)'} 的证据文件必须为不适用 (line ${row.__line})`);
    }
  }
  if (scriptableSources.size > 0 && physicalEvidenceIds.size === 0) {
    errors.push('可脚本测量图片没有任何真实落盘的 Region Evidence');
  }

  const regionIds = new Set();
  const regionParents = [];
  for (const row of tables.regions?.rows || []) {
    const id = addUniqueId('区域', row['区域 ID'], row.__line, idOwners, errors);
    if (id) regionIds.add(id);
    regionParents.push({ id, parent: clean(row['父级区域']), line: row.__line });
    for (const ref of evidenceRefs(row['来源证据'])) {
      if (!evidenceIds.has(ref)) errors.push(`区域 ${id || '(空)'} 引用未知证据 ${ref} (line ${row.__line})`);
    }
  }
  for (const { id, parent, line } of regionParents) {
    if (parent && !isNA(parent) && !regionIds.has(parent)) {
      errors.push(`区域 ${id || '(空)'} 的父级不存在: ${parent} (line ${line})`);
    }
  }

  const elementIds = new Set();
  const lowObjects = [];
  const elementRows = [];
  for (const row of tables.elements?.rows || []) {
    const id = addUniqueId('元素', row['元素 ID'], row.__line, idOwners, errors);
    if (id) elementIds.add(id);
    if (id) elementRows.push({ id, line: row.__line });
    const region = clean(row['所属区域 ID']);
    if (region && !regionIds.has(region)) errors.push(`元素 ${id || '(空)'} 引用未知区域 ${region} (line ${row.__line})`);
    for (const ref of evidenceRefs(row['来源证据'])) {
      if (!evidenceIds.has(ref)) errors.push(`元素 ${id || '(空)'} 引用未知证据 ${ref} (line ${row.__line})`);
      if (
        scriptableSources.has(evidenceSources.get(ref)) &&
        ['high', 'medium'].includes(clean(row['置信度'])) &&
        !physicalEvidenceIds.has(ref)
      ) {
        errors.push(`元素 ${id || '(空)'} 的 ${clean(row['置信度'])} 证据未指向实体图片: ${ref} (line ${row.__line})`);
      }
    }
    const lifecycle = clean(row['生命周期']);
    if (lifecycle && !['active', 'conditional', 'deprecated'].includes(lifecycle)) {
      errors.push(`元素 ${id || '(空)'} 生命周期无效: ${lifecycle} (line ${row.__line})`);
    }
    if (lifecycle === 'conditional' && !clean(row['来源证据']) && !clean(row['备注'])) {
      errors.push(`conditional 元素缺少来源证据或备注: ${id || '(空)'} (line ${row.__line})`);
    }
    if (clean(row['置信度']) === 'low' && id) lowObjects.push(id);
  }
  const stateSuffixes = ['submitting', 'loading', 'disabled', 'selected', 'hover', 'error'];
  for (const { id, line } of elementRows) {
    for (const suffix of stateSuffixes) {
      const marker = `-${suffix}`;
      if (id.endsWith(marker) && elementIds.has(id.slice(0, -marker.length))) {
        errors.push(`同一元素的 ${suffix} 状态必须复用原 ID，不要创建状态副本 ${id} (line ${line})`);
      }
    }
  }

  const patternIds = new Set();
  for (const row of tables.repeated?.rows || []) {
    const id = addUniqueId('重复模式', row['模式 ID'], row.__line, idOwners, errors);
    if (id) patternIds.add(id);
    const region = clean(row['所属区域 ID']);
    if (region && !regionIds.has(region)) errors.push(`重复模式 ${id || '(空)'} 引用未知区域 ${region} (line ${row.__line})`);
    const granularity = clean(row['记录粒度']);
    if (granularity && !['all-visible', 'representative', 'structure-only'].includes(granularity)) {
      errors.push(`重复模式记录粒度无效: ${granularity} (line ${row.__line})`);
    }
  }

  for (const row of tables.measurements?.rows || []) {
    const id = addUniqueId('测量', row['测量 ID'], row.__line, idOwners, errors);
    for (const ref of evidenceRefs(row['来源证据'])) {
      if (!evidenceIds.has(ref)) errors.push(`测量 ${id || '(空)'} 引用未知证据 ${ref} (line ${row.__line})`);
    }
    if (clean(row['置信度']) === 'low') {
      const review = clean(row['复检状态']);
      if (!['reviewed', 'pending'].includes(review)) {
        errors.push(`low 测量必须标记 reviewed/pending: ${id || '(空)'} (line ${row.__line})`);
      }
      if (id) lowObjects.push(id);
      const objectId = clean(row['对象 ID']);
      if (objectId) lowObjects.push(objectId);
    }
  }

  const openQuestions = sectionText(lines, headings, 'Open Questions');
  if (lowObjects.length > 0 && /^(?:无|不适用)\s*$/m.test(openQuestions)) {
    errors.push('存在 low 字段，但 Open Questions 写为无/不适用');
  }
  for (const id of new Set(lowObjects)) {
    if (!openQuestions.includes(id)) warnings.push(`low 对象未在 Open Questions 中明确引用: ${id}`);
  }

  for (const row of tables.states?.rows || []) {
    if (clean(row['是否需要实现']) === 'unknown') {
      const state = clean(row['状态']);
      if (/^(?:无|不适用)\s*$/m.test(openQuestions)) {
        errors.push(`状态 "${state}" 仍为 unknown，但 Open Questions 写为无/不适用`);
      } else if (state && !openQuestions.includes(state)) {
        warnings.push(`unknown 状态未在 Open Questions 中明确引用: ${state}`);
      }
    }
  }

  for (const row of tables.coverage?.rows || []) {
    const result = clean(row['结果']).toLowerCase();
    if (result === 'fail') errors.push(`Coverage Check 存在 fail: ${clean(row['检查项'])} (line ${row.__line})`);
    if (!['pass', '不适用'].includes(result)) {
      errors.push(`Coverage Check 结果未定稿: "${result}" (line ${row.__line})`);
    }
  }

  const knownIds = new Set([...regionIds, ...elementIds, ...patternIds]);
  const wireframe = sectionText(lines, headings, 'Layout Wireframe');
  const wireframeIds = new Set(wireframe.match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g) || []);
  const vocabulary = new Set(['full-width', 'space-between', 'flex-row', 'flex-column', 'structure-only', 'all-visible']);
  for (const id of wireframeIds) {
    if (!knownIds.has(id) && !vocabulary.has(id)) warnings.push(`Wireframe 中的 ID 无法反查: ${id}`);
  }

  if (/pass\/fail|TODO|\[TODO/i.test(content)) errors.push('文档仍包含未定稿占位符');

  for (const message of warnings) console.warn(`WARN: ${message}`);
  for (const message of errors) console.error(`ERROR: ${message}`);
  console.log(`Checked ${absolute}`);
  console.log(`regions=${regionIds.size} elements=${elementIds.size} evidence=${evidenceIds.size} warnings=${warnings.length} errors=${errors.length}`);

  return errors.length > 0 || (strict && warnings.length > 0) ? 1 : 0;
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const strict = args.includes('--strict');
const specPath = args.find(arg => !arg.startsWith('--'));
if (!specPath) {
  usage();
  process.exit(1);
}
process.exit(validate(specPath, strict));
