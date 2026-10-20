#!/usr/bin/env node
/* ui-spec-vision 配套图像工具(Node 版,依赖 jimp@0.22,纯 JS 无原生二进制)。
 *
 * 用法:
 *   node crop.js pick  <image> --at 0.5,0.3            // 点采样,输出精确 hex
 *   node crop.js pick  <image> --cells B2 [--top 5]    // 区域主色直方图
 *   node crop.js info  <image>
 *   node crop.js grid  <image> [--cols 6] [--rows 8] [-o out.png]
 *   node crop.js cut   <image> --cells B2:E5 [--cols 6] [--rows 8] [--scale 2] [-o out.png]
 *   node crop.js cut   <image> --bbox 0.1,0.2,0.5,0.6 [--scale 2] [-o out.png]  // 相对坐标 l,t,r,b
 *   node crop.js slice <image> [--ratio 2.5] [--overlap 0.1] [-o prefix]
 *
 * 网格坐标:列用字母 A..(左→右),行用数字 1..(上→下)。B2:E5 = 列B-E、行2-5。
 * 单格写法 C3 等价于 C3:C3。cut 的 --cols/--rows 必须与生成 grid 图时一致,否则换算错位。
 */
'use strict';
const path = require('path');
const Jimp = require('jimp');

const MAX_SCALE = 4;
const MAGENTA = Jimp.rgbaToInt(255, 0, 255, 255);

function die(msg) { console.error(msg); process.exit(1); }

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') args.output = argv[++i];
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

function suffixed(file, suffix) {
  const ext = path.extname(file);
  return file.slice(0, -ext.length || undefined) + suffix + '.png';
}

async function cmdInfo(args) {
  const img = await Jimp.read(args._[0]);
  const { width: w, height: h } = img.bitmap;
  const ratio = h / w;
  const hint = ratio > 2.5 ? 'long-page (建议 slice)' : 'normal';
  console.log(`size: ${w}x${h}  aspect(h/w): ${ratio.toFixed(2)}  hint: ${hint}`);
}

function fillRect(img, x0, y0, x1, y1, color) {
  const { width: w, height: h } = img.bitmap;
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++)
      img.setPixelColor(color, x, y);
}

async function cmdGrid(args) {
  const img = await Jimp.read(args._[0]);
  const { width: w, height: h } = img.bitmap;
  const cols = +(args.cols || 6), rows = +(args.rows || 8);
  if (cols > 26) die('--cols 最大 26 (A-Z)');

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

  const out = args.output || suffixed(args._[0], `_grid${cols}x${rows}`);
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
  if (c2 >= cols || r2 >= rows) die(`格子越界: ${cells} 超出 ${cols}x${rows} 网格`);
  return [c1 / cols, r1 / rows, (c2 + 1) / cols, (r2 + 1) / rows];
}

async function cmdCut(args) {
  const img = await Jimp.read(args._[0]);
  const { width: w, height: h } = img.bitmap;
  const cols = +(args.cols || 6), rows = +(args.rows || 8);

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

  const scale = Math.min(Math.max(+(args.scale || 2), 1), MAX_SCALE);
  if (scale > 1) {
    img.resize(img.bitmap.width * scale, img.bitmap.height * scale, Jimp.RESIZE_BICUBIC);
  }

  const tag = (args.cells || 'bbox').replace(':', '-');
  const out = args.output || suffixed(args._[0], `_cut_${tag}_x${scale}`);
  await img.writeAsync(out);
  console.log(`region -> ${out}  (${img.bitmap.width}x${img.bitmap.height}, scale x${scale})`);
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

async function cmdPick(args) {
  const img = await Jimp.read(args._[0]);
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
  const cols = +(args.cols || 6), rows = +(args.rows || 8);
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
  const top = [...buckets.values()].sort((a, b2) => b2.n - a.n).slice(0, +(args.top || 5));
  console.log(`region [${l},${t} - ${r},${b}] dominant colors:`);
  for (const bk of top) {
    const hex = toHex(Math.round(bk.r / bk.n), Math.round(bk.g / bk.n), Math.round(bk.b / bk.n));
    console.log(`  ${hex}  ${(bk.n / total * 100).toFixed(1)}%`);
  }
}

async function cmdSlice(args) {
  const img = await Jimp.read(args._[0]);
  const { width: w, height: h } = img.bitmap;
  const ratio = +(args.ratio || 2.5), overlap = +(args.overlap || 0.1);
  if (h / w <= ratio) { console.log(`aspect ${(h / w).toFixed(2)} <= ${ratio}, 无需切片`); return; }

  const segH = Math.round(w * ratio);
  const step = Math.round(segH * (1 - overlap));
  const prefix = args.output || args._[0].replace(path.extname(args._[0]), '');
  let i = 1;
  for (let y = 0; y < h; y += step, i++) {
    const hh = Math.min(segH, h - y);
    const seg = img.clone().crop(0, y, w, hh);
    const out = `${prefix}_slice${String(i).padStart(2, '0')}.png`;
    await seg.writeAsync(out);
    console.log(`slice ${i} [y ${y}-${y + hh}] -> ${out}`);
    if (y + segH >= h) break;
  }
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!args._[0] && cmd !== undefined) die('缺少图片路径');
  const table = { info: cmdInfo, grid: cmdGrid, cut: cmdCut, slice: cmdSlice, pick: cmdPick };
  const fn = table[cmd];
  if (!fn) die('用法: node crop.js <info|grid|cut|slice|pick> <image> [选项]  (详见文件头注释)');
  await fn(args);
})().catch(e => die(e.message || String(e)));
