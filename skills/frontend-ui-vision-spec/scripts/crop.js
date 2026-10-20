#!/usr/bin/env node
/* frontend-ui-vision-spec 配套图像工具(Node 版,依赖 jimp@0.22.12)。
 *
 * 用法:
 *   node crop.js pick  <image> --at 0.5,0.3            // 点采样,输出精确 hex
 *   node crop.js pick  <image> --cells B2 [--top 5]    // 区域主色直方图
 *   node crop.js info  <image> [--json]
 *   node crop.js grid  <image> [--cols 6] [--rows 8] [-o out.png] [--force]
 *   node crop.js cut   <image> --cells B2:E5 [--cols 6] [--rows 8] [--scale 2] [-o out.png] [--force]
 *   node crop.js cut   <image> --bbox 0.1,0.2,0.5,0.6 [--scale 2] [-o out.png] [--force]
 *   node crop.js slice <image> [--ratio 2.5] [--overlap 0.1] [-o prefix] [--force]
 *   node crop.js prepare <image> [--overlap 0.20] [--fixed-tile 640] [-o evidence-dir] [--force]
 *   node crop.js prepare <image> --tile 768x768 [--overlap 0.20] [-o evidence-dir] [--force]
 *
 * 网格坐标:列用字母 A..(左→右),行用数字 1..(上→下)。B2:E5 = 列B-E、行2-5。
 * 单格写法 C3 等价于 C3:C3。cut/pick 的 --cols/--rows 必须与生成 grid 图时一致。
 * 默认拒绝覆盖已有输出。仅在目标确认无误时使用 --force。
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let Jimp;
try {
  Jimp = require('jimp');
} catch (error) {
  console.error('缺少图像依赖 jimp@0.22.12；请先在 scripts 目录执行 npm ci，未生成任何视觉证据。');
  process.exit(1);
}

const MAX_SCALE = 4;
const DEFAULT_MAX_PIXELS = 100_000_000;
const DEFAULT_FIXED_TILE_SIZE = 640;
const FALLBACK_FIXED_TILE_SIZE = 768;
const DEFAULT_OVERVIEW_MAX = 1600;
const DEFAULT_MAX_TILES = 48;
const DEFAULT_PREPARE_OVERLAP = 0.20;
const AXIS_THRESHOLDS = Object.freeze({
  singleMax: 320,
  twoMax: 900,
  threeMax: 1600,
  fourMax: 2400
});
const MAGENTA = Jimp.rgbaToInt(255, 0, 255, 255);
const BOOLEAN_OPTIONS = new Set(['force', 'json', 'help']);

function die(msg) { console.error(msg); process.exit(1); }

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') args.output = argv[++i];
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      if (BOOLEAN_OPTIONS.has(key)) args[key] = true;
      else args[key] = argv[++i];
    }
    else args._.push(a);
  }
  return args;
}

function numberArg(args, name, fallback, options = {}) {
  const raw = args[name] === undefined ? fallback : args[name];
  const value = Number(raw);
  const { min = -Infinity, max = Infinity, integer = false, maxExclusive = false } = options;
  const maxOk = maxExclusive ? value < max : value <= max;
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || !maxOk) {
    const interval = `${min === -Infinity ? '-∞' : min}..${maxExclusive ? '<' : ''}${max === Infinity ? '∞' : max}`;
    die(`--${name} 必须为${integer ? '整数' : '数值'}且位于 ${interval}`);
  }
  return value;
}

function assertInput(file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) die(`图片不存在或不是文件: ${file || '(空)'}`);
}

function assertImageSize(img, args, scale = 1) {
  const maxPixels = numberArg(args, 'max-pixels', DEFAULT_MAX_PIXELS, { min: 1, integer: true });
  const pixels = img.bitmap.width * img.bitmap.height * scale * scale;
  if (pixels > maxPixels) {
    die(`图片处理规模 ${Math.round(pixels).toLocaleString()} px 超过上限 ${maxPixels.toLocaleString()} px; 请先缩小图片或显式调整 --max-pixels`);
  }
}

async function readImage(file, args) {
  assertInput(file);
  const img = await Jimp.read(file);
  assertImageSize(img, args);
  return img;
}

function prepareOutput(file, args) {
  const resolved = path.resolve(file);
  if (fs.existsSync(resolved) && !args.force) die(`输出已存在,拒绝覆盖: ${resolved} (确认后可加 --force)`);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function assertOutputsAvailable(files, args) {
  const resolved = files.map(file => path.resolve(file));
  const existing = resolved.filter(file => fs.existsSync(file));
  if (existing.length > 0 && !args.force) {
    die(`输出已存在,拒绝覆盖: ${existing[0]} (确认后可加 --force)`);
  }
  for (const file of resolved) fs.mkdirSync(path.dirname(file), { recursive: true });
  return resolved;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function suffixed(file, suffix) {
  const ext = path.extname(file);
  return file.slice(0, -ext.length || undefined) + suffix + '.png';
}

async function cmdInfo(args) {
  const file = args._[0];
  const img = await readImage(file, args);
  const { width: w, height: h } = img.bitmap;
  const ratio = h / w;
  const hint = ratio > 2.5 ? 'long-page (prepare 会自动二维重叠覆盖)' : 'normal';
  if (args.json) {
    console.log(JSON.stringify({
      source: path.resolve(file),
      sha256: await sha256File(file),
      width: w,
      height: h,
      pixels: w * h,
      aspect_height_width: Number(ratio.toFixed(4)),
      mime: img.getMIME(),
      hint
    }, null, 2));
    return;
  }
  console.log(`size: ${w}x${h}  aspect(h/w): ${ratio.toFixed(2)}  hint: ${hint}`);
}

function fillRect(img, x0, y0, x1, y1, color) {
  const { width: w, height: h } = img.bitmap;
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++)
      img.setPixelColor(color, x, y);
}

function strokeRect(img, x, y, width, height, color, thickness = 2) {
  fillRect(img, x, y, x + width, y + thickness, color);
  fillRect(img, x, y + height - thickness, x + width, y + height, color);
  fillRect(img, x, y, x + thickness, y + height, color);
  fillRect(img, x + width - thickness, y, x + width, y + height, color);
}

function explicitTileDimensions(args) {
  if (args.tile) {
    const match = /^(\d+)x(\d+)$/i.exec(args.tile.trim());
    if (!match) die('--tile 必须为 <width>x<height>，例如 768x768');
    return {
      width: numberArg({ width: match[1] }, 'width', DEFAULT_FIXED_TILE_SIZE, { min: 128, max: 4096, integer: true }),
      height: numberArg({ height: match[2] }, 'height', DEFAULT_FIXED_TILE_SIZE, { min: 128, max: 4096, integer: true })
    };
  }
  if (args['tile-width'] === undefined && args['tile-height'] === undefined) return null;
  return {
    width: numberArg(args, 'tile-width', DEFAULT_FIXED_TILE_SIZE, { min: 128, max: 4096, integer: true }),
    height: numberArg(args, 'tile-height', DEFAULT_FIXED_TILE_SIZE, { min: 128, max: 4096, integer: true })
  };
}

function fixedAxisPlan(size, tileSize, overlap, mode = 'fixed-pixels') {
  const actualTile = Math.min(size, tileSize);
  if (size <= actualTile) {
    return { mode: 'single', source_size: size, tile_size: size, segments: 1, starts: [0], stride: 0 };
  }
  const maximumStep = Math.max(1, Math.floor(actualTile * (1 - overlap)));
  const segments = Math.ceil((size - actualTile) / maximumStep) + 1;
  const span = size - actualTile;
  const starts = [];
  for (let index = 0; index < segments; index++) {
    starts.push(Math.round(index * span / (segments - 1)));
  }
  return {
    mode,
    source_size: size,
    tile_size: actualTile,
    segments,
    starts,
    stride: segments > 1 ? Number((span / (segments - 1)).toFixed(4)) : 0
  };
}

function gridAxisPlan(size, segments, overlap) {
  if (segments <= 1) {
    return { mode: 'single', source_size: size, tile_size: size, segments: 1, starts: [0], stride: 0 };
  }
  const denominator = segments - (segments - 1) * overlap;
  const tileSize = Math.min(size, Math.ceil(size / denominator));
  const span = size - tileSize;
  const starts = [];
  for (let index = 0; index < segments; index++) {
    starts.push(Math.round(index * span / (segments - 1)));
  }
  return {
    mode: 'grid',
    source_size: size,
    tile_size: tileSize,
    segments,
    starts,
    stride: Number((span / (segments - 1)).toFixed(4))
  };
}

function adaptiveAxisPlan(size, overlap, fixedTileSize) {
  if (size <= AXIS_THRESHOLDS.singleMax) return gridAxisPlan(size, 1, overlap);
  if (size <= AXIS_THRESHOLDS.twoMax) return gridAxisPlan(size, 2, overlap);
  if (size <= AXIS_THRESHOLDS.threeMax) return gridAxisPlan(size, 3, overlap);
  if (size <= AXIS_THRESHOLDS.fourMax) return gridAxisPlan(size, 4, overlap);
  return fixedAxisPlan(size, fixedTileSize, overlap);
}

function buildPreparationPlan(width, height, overlap, args, maxTiles) {
  const explicitTile = explicitTileDimensions(args);
  if (explicitTile) {
    const x = fixedAxisPlan(width, explicitTile.width, overlap, 'explicit-fixed');
    const y = fixedAxisPlan(height, explicitTile.height, overlap, 'explicit-fixed');
    return {
      method: 'explicit-fixed-overlap-tiles',
      requested_tile: explicitTile,
      fixed_tile_requested: null,
      fixed_tile_effective: null,
      x,
      y,
      tile_count: x.segments * y.segments
    };
  }

  const requestedFixedTile = numberArg(args, 'fixed-tile', DEFAULT_FIXED_TILE_SIZE, {
    min: 128,
    max: 4096,
    integer: true
  });
  let effectiveFixedTile = requestedFixedTile;
  let x = adaptiveAxisPlan(width, overlap, effectiveFixedTile);
  let y = adaptiveAxisPlan(height, overlap, effectiveFixedTile);
  let tileCount = x.segments * y.segments;
  if (
    tileCount > maxTiles &&
    requestedFixedTile < FALLBACK_FIXED_TILE_SIZE &&
    (x.mode === 'fixed-pixels' || y.mode === 'fixed-pixels')
  ) {
    effectiveFixedTile = FALLBACK_FIXED_TILE_SIZE;
    x = adaptiveAxisPlan(width, overlap, effectiveFixedTile);
    y = adaptiveAxisPlan(height, overlap, effectiveFixedTile);
    tileCount = x.segments * y.segments;
  }
  return {
    method: 'adaptive-axis-overlap-tiles',
    requested_tile: null,
    fixed_tile_requested: requestedFixedTile,
    fixed_tile_effective: effectiveFixedTile,
    thresholds: {
      single_max: AXIS_THRESHOLDS.singleMax,
      two_max: AXIS_THRESHOLDS.twoMax,
      three_max: AXIS_THRESHOLDS.threeMax,
      four_max: AXIS_THRESHOLDS.fourMax
    },
    x,
    y,
    tile_count: tileCount
  };
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

async function fileRecord(root, file, width, height) {
  return {
    path: posixRelative(root, file),
    sha256: await sha256File(file),
    width,
    height
  };
}

async function cmdPrepare(args) {
  const sourceFile = args._[0];
  const img = await readImage(sourceFile, args);
  const { width: sourceWidth, height: sourceHeight } = img.bitmap;
  const overlap = numberArg(args, 'overlap', DEFAULT_PREPARE_OVERLAP, { min: 0, max: 0.5, maxExclusive: true });
  const maxTiles = numberArg(args, 'max-tiles', DEFAULT_MAX_TILES, { min: 1, max: 500, integer: true });
  const overviewMax = numberArg(args, 'overview-max', DEFAULT_OVERVIEW_MAX, { min: 320, max: 4096, integer: true });
  const plan = buildPreparationPlan(sourceWidth, sourceHeight, overlap, args, maxTiles);
  const tileWidth = plan.x.tile_size;
  const tileHeight = plan.y.tile_size;
  const xStarts = plan.x.starts;
  const yStarts = plan.y.starts;
  const tileCount = plan.tile_count;
  if (tileCount > maxTiles) {
    die(`预计生成 ${tileCount} 个 tile，超过 --max-tiles ${maxTiles}；请增大 --fixed-tile、降低 overlap 或显式提高上限`);
  }

  const outputRoot = path.resolve(args.output || suffixed(sourceFile, '_evidence').replace(/\.png$/i, ''));
  const overviewPath = path.join(outputRoot, 'overview.png');
  const tileMapPath = path.join(outputRoot, 'tile-map.png');
  const manifestPath = path.join(outputRoot, 'manifest.json');
  const tiles = [];
  for (let row = 0; row < yStarts.length; row++) {
    for (let column = 0; column < xStarts.length; column++) {
      const x = xStarts[column], y = yStarts[row];
      const id = `r${String(row + 1).padStart(2, '0')}-c${String(column + 1).padStart(2, '0')}`;
      tiles.push({
        id,
        row: row + 1,
        column: column + 1,
        x,
        y,
        width: Math.min(tileWidth, sourceWidth - x),
        height: Math.min(tileHeight, sourceHeight - y),
        out: path.join(outputRoot, 'tiles', `${id}.png`)
      });
    }
  }

  assertOutputsAvailable(
    [overviewPath, tileMapPath, manifestPath, ...tiles.map(tile => tile.out)],
    args
  );

  const overviewScale = Math.min(1, overviewMax / Math.max(sourceWidth, sourceHeight));
  const overview = img.clone();
  if (overviewScale < 1) {
    overview.resize(
      Math.max(1, Math.round(sourceWidth * overviewScale)),
      Math.max(1, Math.round(sourceHeight * overviewScale)),
      Jimp.RESIZE_BICUBIC
    );
  }
  await overview.writeAsync(overviewPath);

  const tileMap = overview.clone();
  const mapScaleX = tileMap.bitmap.width / sourceWidth;
  const mapScaleY = tileMap.bitmap.height / sourceHeight;
  const font = await Jimp.loadFont(
    Math.min(tileMap.bitmap.width, tileMap.bitmap.height) >= 1000
      ? Jimp.FONT_SANS_32_WHITE
      : Jimp.FONT_SANS_16_WHITE
  );
  for (const tile of tiles) {
    const x = Math.round(tile.x * mapScaleX);
    const y = Math.round(tile.y * mapScaleY);
    const width = Math.max(2, Math.round(tile.width * mapScaleX));
    const height = Math.max(2, Math.round(tile.height * mapScaleY));
    const label = tile.id.toUpperCase();
    const textWidth = Jimp.measureText(font, label);
    const textHeight = Jimp.measureTextHeight(font, label, textWidth + 4);
    strokeRect(tileMap, x, y, width, height, MAGENTA, 2);
    fillRect(tileMap, x + 2, y + 2, x + textWidth + 8, y + textHeight + 6, MAGENTA);
    tileMap.print(font, x + 5, y + 4, label);
  }
  await tileMap.writeAsync(tileMapPath);

  for (const tile of tiles) {
    const cropped = img.clone().crop(tile.x, tile.y, tile.width, tile.height);
    await cropped.writeAsync(tile.out);
  }

  const sourceResolved = path.resolve(sourceFile);
  const manifest = {
    schema_version: '1.1',
    generated_at: new Date().toISOString(),
    source: {
      path: sourceResolved,
      sha256: await sha256File(sourceResolved),
      width: sourceWidth,
      height: sourceHeight,
      mime: img.getMIME()
    },
    preparation: {
      method: plan.method,
      requested_tile: plan.requested_tile,
      fixed_tile_requested: plan.fixed_tile_requested,
      fixed_tile_effective: plan.fixed_tile_effective,
      thresholds: plan.thresholds || null,
      overlap,
      x: plan.x,
      y: plan.y,
      rows: yStarts.length,
      columns: xStarts.length,
      tile_count: tileCount,
      overview_max: overviewMax,
      max_tiles: maxTiles
    },
    overview: await fileRecord(outputRoot, overviewPath, overview.bitmap.width, overview.bitmap.height),
    tile_map: await fileRecord(outputRoot, tileMapPath, tileMap.bitmap.width, tileMap.bitmap.height),
    tiles: []
  };
  for (const tile of tiles) {
    manifest.tiles.push({
      id: tile.id,
      row: tile.row,
      column: tile.column,
      bbox: {
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        right: tile.x + tile.width,
        bottom: tile.y + tile.height
      },
      normalized_bbox: [
        Number((tile.x / sourceWidth).toFixed(6)),
        Number((tile.y / sourceHeight).toFixed(6)),
        Number(((tile.x + tile.width) / sourceWidth).toFixed(6)),
        Number(((tile.y + tile.height) / sourceHeight).toFixed(6))
      ],
      touches_source_edge: {
        top: tile.y === 0,
        right: tile.x + tile.width === sourceWidth,
        bottom: tile.y + tile.height === sourceHeight,
        left: tile.x === 0
      },
      file: await fileRecord(outputRoot, tile.out, tile.width, tile.height)
    });
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`evidence prepared -> ${outputRoot}`);
  console.log(
    `source ${sourceWidth}x${sourceHeight}; tiles=${tileCount} (${yStarts.length}x${xStarts.length}); ` +
    `x=${plan.x.mode}/${plan.x.tile_size}px; y=${plan.y.mode}/${plan.y.tile_size}px; overlap=${overlap}`
  );
  console.log(`manifest -> ${manifestPath}`);
}

async function cmdGrid(args) {
  const img = await readImage(args._[0], args);
  const { width: w, height: h } = img.bitmap;
  const cols = numberArg(args, 'cols', 6, { min: 1, max: 26, integer: true });
  const rows = numberArg(args, 'rows', 8, { min: 1, max: 100, integer: true });

  for (let c = 1; c < cols; c++) {
    const x = Math.round(w * c / cols);
    fillRect(img, x, 0, x + 2, h, MAGENTA);
  }
  for (let r = 1; r < rows; r++) {
    const y = Math.round(h * r / rows);
    fillRect(img, 0, y, w, y + 2, MAGENTA);
  }

  // 每格左上角标注编号(品红底 + 白字位图字体)
  const font = await Jimp.loadFont(
    Math.min(w, h) >= 1200 ? Jimp.FONT_SANS_32_WHITE : Jimp.FONT_SANS_16_WHITE
  );
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.round(w * c / cols) + 3;
      const y = Math.round(h * r / rows) + 3;
      const label = String.fromCharCode(65 + c) + (r + 1);
      const tw = Jimp.measureText(font, label);
      const th = Jimp.measureTextHeight(font, label, tw + 4);
      fillRect(img, x - 2, y - 2, x + tw + 2, y + th + 2, MAGENTA);
      img.print(font, x, y, label);
    }
  }

  const out = prepareOutput(args.output || suffixed(args._[0], `_grid${cols}x${rows}`), args);
  await img.writeAsync(out);
  console.log(`grid image -> ${out}  (${cols} cols A-${String.fromCharCode(64 + cols)}, ${rows} rows 1-${rows})`);
}

const CELL_RE = /^([A-Z])(\d+)(?::([A-Z])(\d+))?$/i;

function cellsToBbox(cells, cols, rows) {
  const m = CELL_RE.exec(cells.trim());
  if (!m) die(`非法网格坐标: ${cells} (示例: C3 或 B2:E5)`);
  let c1 = m[1].toUpperCase().charCodeAt(0) - 65, r1 = +m[2] - 1;
  let c2 = (m[3] || m[1]).toUpperCase().charCodeAt(0) - 65, r2 = +(m[4] || m[2]) - 1;
  [c1, c2] = [Math.min(c1, c2), Math.max(c1, c2)];
  [r1, r2] = [Math.min(r1, r2), Math.max(r1, r2)];
  if (c1 < 0 || r1 < 0 || c2 >= cols || r2 >= rows) die(`格子越界: ${cells} 超出 ${cols}x${rows} 网格`);
  return [c1 / cols, r1 / rows, (c2 + 1) / cols, (r2 + 1) / rows];
}

async function cmdCut(args) {
  const img = await readImage(args._[0], args);
  const { width: w, height: h } = img.bitmap;
  const cols = numberArg(args, 'cols', 6, { min: 1, max: 26, integer: true });
  const rows = numberArg(args, 'rows', 8, { min: 1, max: 100, integer: true });

  let rel;
  if (args.cells) {
    rel = cellsToBbox(args.cells, cols, rows);
  } else if (args.bbox) {
    rel = args.bbox.split(',').map(Number);
    const ok = rel.length === 4 && rel.every(v => v >= 0 && v <= 1) && rel[0] < rel[2] && rel[1] < rel[3];
    if (!ok) die('--bbox 需为 l,t,r,b 四个 0~1 相对值,且 l<r, t<b');
  } else die('必须指定 --cells 或 --bbox');

  // 四周外扩 2%,避免网格线贴边截断内容
  const pad = 0.02;
  const l = Math.round(Math.max(0, rel[0] - pad) * w);
  const t = Math.round(Math.max(0, rel[1] - pad) * h);
  const r = Math.round(Math.min(1, rel[2] + pad) * w);
  const b = Math.round(Math.min(1, rel[3] + pad) * h);
  img.crop(l, t, r - l, b - t);

  const scale = numberArg(args, 'scale', 2, { min: 1, max: MAX_SCALE });
  assertImageSize(img, args, scale);
  if (scale > 1) {
    img.resize(img.bitmap.width * scale, img.bitmap.height * scale, Jimp.RESIZE_BICUBIC);
  }

  const tag = (args.cells || 'bbox').replace(':', '-');
  const out = prepareOutput(args.output || suffixed(args._[0], `_cut_${tag}_x${scale}`), args);
  await img.writeAsync(out);
  console.log(`region -> ${out}  (${img.bitmap.width}x${img.bitmap.height}, scale x${scale})`);
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

async function cmdPick(args) {
  const img = await readImage(args._[0], args);
  const { width: w, height: h } = img.bitmap;

  if (args.at) {
    // 点采样:--at x,y(0~1 相对坐标),输出中心像素 + 5x5 邻域众数(抗抗锯齿/压缩噪声)
    const [rx, ry] = args.at.split(',').map(Number);
    if (!(rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1)) die('--at 需为 x,y 两个 0~1 相对值');
    const cx = Math.min(w - 1, Math.round(rx * w));
    const cy = Math.min(h - 1, Math.round(ry * h));
    const center = Jimp.intToRGBA(img.getPixelColor(cx, cy));

    const count = new Map();
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const p = Jimp.intToRGBA(img.getPixelColor(x, y));
        const key = toHex(p.r, p.g, p.b);
        count.set(key, (count.get(key) || 0) + 1);
      }
    }
    const mode = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(`pixel (${cx},${cy}): center=${toHex(center.r, center.g, center.b)}  5x5-mode=${mode[0]} (${mode[1]}/25)`);
    if (toHex(center.r, center.g, center.b) !== mode[0])
      console.log('warn: 中心像素与邻域众数不一致,采样点可能落在边缘/抗锯齿带,建议移到色块中心重采');
    return;
  }

  // 区域主色:--cells B2 或 --bbox,直方图量化后输出 top N 颜色及占比
  const cols = numberArg(args, 'cols', 6, { min: 1, max: 26, integer: true });
  const rows = numberArg(args, 'rows', 8, { min: 1, max: 100, integer: true });
  let rel = [0, 0, 1, 1];
  if (args.cells) rel = cellsToBbox(args.cells, cols, rows);
  else if (args.bbox) {
    rel = args.bbox.split(',').map(Number);
    const ok = rel.length === 4 && rel.every(v => v >= 0 && v <= 1) && rel[0] < rel[2] && rel[1] < rel[3];
    if (!ok) die('--bbox 需为 l,t,r,b 四个 0~1 相对值,且 l<r, t<b');
  }
  const l = Math.round(rel[0] * w), t = Math.round(rel[1] * h);
  const r = Math.round(rel[2] * w), b = Math.round(rel[3] * h);

  // 每通道量化到 32 级做桶,桶内取实际均值作为代表色,避免量化偏移
  const buckets = new Map(); // key -> {n, r, g, b}
  for (let y = t; y < b; y++) {
    for (let x = l; x < r; x++) {
      const p = Jimp.intToRGBA(img.getPixelColor(x, y));
      if (p.a < 128) continue;
      const key = ((p.r >> 3) << 10) | ((p.g >> 3) << 5) | (p.b >> 3);
      const bk = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bk.n++; bk.r += p.r; bk.g += p.g; bk.b += p.b;
      buckets.set(key, bk);
    }
  }
  const total = (r - l) * (b - t);
  const topN = numberArg(args, 'top', 5, { min: 1, max: 20, integer: true });
  const top = [...buckets.values()].sort((a, b2) => b2.n - a.n).slice(0, topN);
  console.log(`region [${l},${t} - ${r},${b}] dominant colors:`);
  for (const bk of top) {
    const hex = toHex(Math.round(bk.r / bk.n), Math.round(bk.g / bk.n), Math.round(bk.b / bk.n));
    console.log(`  ${hex}  ${(bk.n / total * 100).toFixed(1)}%`);
  }
}

async function cmdSlice(args) {
  const img = await readImage(args._[0], args);
  const { width: w, height: h } = img.bitmap;
  const ratio = numberArg(args, 'ratio', 2.5, { min: 0.1, max: 20 });
  const overlap = numberArg(args, 'overlap', 0.1, { min: 0, max: 0.9, maxExclusive: true });
  if (h / w <= ratio) { console.log(`aspect ${(h / w).toFixed(2)} <= ${ratio}, 无需切片`); return; }

  const segH = Math.round(w * ratio);
  const step = Math.round(segH * (1 - overlap));
  const prefix = args.output || args._[0].replace(path.extname(args._[0]), '');
  const slices = [];
  for (let y = 0, i = 1; y < h; y += step, i++) {
    const hh = Math.min(segH, h - y);
    slices.push({ y, hh, out: `${prefix}_slice${String(i).padStart(2, '0')}.png` });
    if (y + segH >= h) break;
  }
  for (const slice of slices) slice.out = prepareOutput(slice.out, args);

  let i = 1;
  for (const { y, hh, out } of slices) {
    const seg = img.clone().crop(0, y, w, hh);
    await seg.writeAsync(out);
    console.log(`slice ${i} [y ${y}-${y + hh}] -> ${out}`);
    i++;
  }
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (args.help || cmd === 'help' || cmd === undefined) {
    console.log('用法: node crop.js <prepare|info|grid|cut|slice|pick> <image> [选项]  (详见文件头注释)');
    return;
  }
  if (!args._[0]) die('缺少图片路径');
  const table = { prepare: cmdPrepare, info: cmdInfo, grid: cmdGrid, cut: cmdCut, slice: cmdSlice, pick: cmdPick };
  const fn = table[cmd];
  if (!fn) die('用法: node crop.js <prepare|info|grid|cut|slice|pick> <image> [选项]  (详见文件头注释)');
  await fn(args);
})().catch(e => die(e.message || String(e)));
