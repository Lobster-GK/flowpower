#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { printResult, reportSummary } from './cli-output.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const COLOR_CHANNELS = new Map([[0, 1], [2, 3], [4, 2], [6, 4]]);

function usage(exitCode = 0) {
  console.error(`Usage:
  node compare-png.mjs <reference.png> <actual.png> [options]

Options:
  --alignment-report <report.json>  Required passing scope/canvas alignment report
  --acceptance-policy <policy.json> Required component-aware acceptance policy
  --profile <name>                  Override policy activeProfile
  --regions <visual-contract.json>  Report metrics for regions and elements
  --threshold <0..255>              Override raw-pixel diagnostic threshold
  --max-mae <0..1>                  Override raw-pixel diagnostic MAE threshold
  --max-diff-ratio <0..1>           Override raw-pixel diagnostic ratio threshold
  --max-region-diff-ratio <0..1>    Override raw-pixel critical-region threshold
  --output <report.json>             Write JSON report
  --diff <diff.png>                  Write a red difference heatmap
  --evidence-dir <directory>         Write critical/important target crops for repair packets
  --verbose                          Print the full report instead of a compact summary
  --help                             Show this help

Only scope-aligned, equal-size, 8-bit, non-interlaced grayscale/RGB/RGBA PNG files are accepted.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  const valueOptions = new Map([
    ['--alignment-report', 'alignmentReport'],
    ['--acceptance-policy', 'acceptancePolicy'],
    ['--profile', 'profile'],
    ['--regions', 'regions'],
    ['--threshold', 'threshold'],
    ['--max-mae', 'maxMae'],
    ['--max-diff-ratio', 'maxDiffRatio'],
    ['--max-region-diff-ratio', 'maxRegionDiffRatio'],
    ['--output', 'output'],
    ['--diff', 'diff'],
    ['--evidence-dir', 'evidenceDir']
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') usage(0);
    if (arg === '--verbose') { options.verbose = true; continue; }
    if (arg.startsWith('--')) {
      const key = valueOptions.get(arg);
      if (!key) throw new Error(`Unknown option: ${arg}`);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[key] = value;
      index += 1;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) usage(2);
  if (!options.alignmentReport) throw new Error('--alignment-report is required; pixel comparison cannot run before scope alignment passes');
  if (!options.acceptancePolicy) throw new Error('--acceptance-policy is required; raw pixel thresholds must not silently become final acceptance criteria');
  for (const key of ['threshold', 'maxMae', 'maxDiffRatio', 'maxRegionDiffRatio']) {
    if (options[key] === undefined) continue;
    options[key] = Number(options[key]);
    if (!Number.isFinite(options[key])) throw new Error(`${key} must be a number`);
  }
  if (options.threshold !== undefined && (options.threshold < 0 || options.threshold > 255)) throw new Error('threshold must be between 0 and 255');
  for (const key of ['maxMae', 'maxDiffRatio', 'maxRegionDiffRatio']) {
    if (options[key] !== undefined && (options[key] < 0 || options[key] > 1)) throw new Error(`${key} must be between 0 and 1`);
  }
  return { reference: positional[0], actual: positional[1], ...options };
}

function loadAcceptancePolicy(file, overrideProfile) {
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read acceptance policy: ${error.message}`);
  }
  if (policy.kind !== 'visual-acceptance-policy') throw new Error('Acceptance policy kind must be visual-acceptance-policy');
  const profileName = overrideProfile ?? policy.activeProfile;
  if (!profileName || !policy.profiles?.[profileName]) throw new Error(`Acceptance profile ${profileName ?? 'missing'} does not exist in policy`);
  return { policy, profileName, profile: policy.profiles[profileName] };
}

function loadPassingAlignmentReport(file, reference, actual) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read alignment report: ${error.message}`);
  }
  if (report.kind !== 'alignment-report') throw new Error('Alignment gate rejected: report kind must be alignment-report');
  if (report.status !== 'pass') throw new Error(`Alignment gate rejected: status is ${report.status ?? 'missing'}`);
  if (report.scopeType === 'unknown') throw new Error('Alignment gate rejected: comparison scope is unknown');
  const failedChecks = Object.entries(report.checks ?? {}).filter(([, value]) => value !== true).map(([key]) => key);
  const requiredChecks = [
    'scopeConfirmed',
    'targetResolved',
    'captureContractMatched',
    'applicationShellPreserved',
    'sizeMatched',
    'originNormalized',
    'cropMatched',
    'stateMatched',
    'fontsReady',
    'assetsReady',
    'fixtureLockVerified',
    'fixtureSetMatched',
    'expectedRequestsMatched',
    'noUnmatchedBusinessRequests',
    'runtimeDeterministic',
    'visibleDataMatched',
    'dataSettled',
    'visualLabLockVerified',
    'visualLabFilesMatched',
    'visualLabObservationMatched',
    'visualLabBoundaryPreserved',
    'captureMutationsLayoutSafe'
  ];
  const missingChecks = requiredChecks.filter((key) => !(key in (report.checks ?? {})));
  if (missingChecks.length > 0) throw new Error(`Alignment gate rejected: missing checks ${missingChecks.join(', ')}`);
  if (failedChecks.length > 0) throw new Error(`Alignment gate rejected: failed checks ${failedChecks.join(', ')}`);
  if ((report.blockers ?? []).length > 0) throw new Error('Alignment gate rejected: blockers are present');
  if ((report.anchors ?? []).some((anchor) => anchor.passed !== true || anchor.delta > anchor.tolerance)) {
    throw new Error('Alignment gate rejected: one or more anchors failed');
  }
  if ((report.captureOnlyMutations ?? []).some((mutation) => mutation.passed !== true || mutation.layoutDelta > report.tolerance)) {
    throw new Error('Alignment gate rejected: a capture-only mutation changed layout');
  }
  if (report.reference?.canvasWidth !== reference.width || report.reference?.canvasHeight !== reference.height) {
    throw new Error(`Alignment gate rejected: reference PNG is ${reference.width}x${reference.height}, report declares ${report.reference?.canvasWidth}x${report.reference?.canvasHeight}`);
  }
  if (report.actual?.canvasWidth !== actual.width || report.actual?.canvasHeight !== actual.height) {
    throw new Error(`Alignment gate rejected: actual PNG is ${actual.width}x${actual.height}, report declares ${report.actual?.canvasWidth}x${report.actual?.canvasHeight}`);
  }
  if (report.reference.canvasWidth !== report.actual.canvasWidth || report.reference.canvasHeight !== report.actual.canvasHeight) {
    throw new Error('Alignment gate rejected: reference and actual canvas dimensions differ');
  }
  return report;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(file) {
  const input = fs.readFileSync(file);
  if (input.length < 8 || !input.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${file} is not a PNG file`);
  }
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > input.length) throw new Error(`${file} has a truncated ${type} chunk`);
    const data = input.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12]
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!header) throw new Error(`${file} is missing IHDR`);
  if (header.bitDepth !== 8) throw new Error(`${file} uses unsupported bit depth ${header.bitDepth}; expected 8`);
  if (!COLOR_CHANNELS.has(header.colorType)) {
    throw new Error(`${file} uses unsupported color type ${header.colorType}; palette PNG is not supported`);
  }
  if (header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw new Error(`${file} must use standard compression/filter and be non-interlaced`);
  }
  if (idat.length === 0) throw new Error(`${file} is missing IDAT`);
  const channels = COLOR_CHANNELS.get(header.colorType);
  const stride = header.width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const expected = header.height * (stride + 1);
  if (inflated.length !== expected) {
    throw new Error(`${file} decoded to ${inflated.length} bytes; expected ${expected}`);
  }

  const reconstructed = Buffer.alloc(header.height * stride);
  let sourceOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filterType = inflated[sourceOffset];
    sourceOffset += 1;
    if (filterType > 4) throw new Error(`${file} uses invalid PNG filter ${filterType}`);
    const rowOffset = y * stride;
    const previousOffset = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left = x >= channels ? reconstructed[rowOffset + x - channels] : 0;
      const up = y > 0 ? reconstructed[previousOffset + x] : 0;
      const upLeft = y > 0 && x >= channels ? reconstructed[previousOffset + x - channels] : 0;
      let value;
      switch (filterType) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + up; break;
        case 3: value = raw + Math.floor((left + up) / 2); break;
        case 4: value = raw + paethPredictor(left, up, upLeft); break;
        default: value = raw;
      }
      reconstructed[rowOffset + x] = value & 0xff;
    }
    sourceOffset += stride;
  }

  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let pixel = 0; pixel < header.width * header.height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (header.colorType === 0) {
      rgba[target] = reconstructed[source];
      rgba[target + 1] = reconstructed[source];
      rgba[target + 2] = reconstructed[source];
      rgba[target + 3] = 255;
    } else if (header.colorType === 2) {
      rgba[target] = reconstructed[source];
      rgba[target + 1] = reconstructed[source + 1];
      rgba[target + 2] = reconstructed[source + 2];
      rgba[target + 3] = 255;
    } else if (header.colorType === 4) {
      rgba[target] = reconstructed[source];
      rgba[target + 1] = reconstructed[source];
      rgba[target + 2] = reconstructed[source];
      rgba[target + 3] = reconstructed[source + 1];
    } else {
      rgba[target] = reconstructed[source];
      rgba[target + 1] = reconstructed[source + 1];
      rgba[target + 2] = reconstructed[source + 2];
      rgba[target + 3] = reconstructed[source + 3];
    }
  }
  return { width: header.width, height: header.height, data: rgba };
}

function compositeChannel(channel, alpha) {
  return Math.round(channel * alpha + 255 * (1 - alpha));
}

function pixelDelta(left, right, index) {
  const leftAlpha = left[index + 3] / 255;
  const rightAlpha = right[index + 3] / 255;
  const dr = Math.abs(compositeChannel(left[index], leftAlpha) - compositeChannel(right[index], rightAlpha));
  const dg = Math.abs(compositeChannel(left[index + 1], leftAlpha) - compositeChannel(right[index + 1], rightAlpha));
  const db = Math.abs(compositeChannel(left[index + 2], leftAlpha) - compositeChannel(right[index + 2], rightAlpha));
  return { dr, dg, db, max: Math.max(dr, dg, db) };
}

function normalizeRect(rect, width, height) {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function normalizeMasks(masks, width, height) {
  return (masks ?? []).map((mask) => ({ ...mask, bbox: normalizeRect(mask.bbox, width, height) })).filter((mask) => mask.bbox);
}

function isMasked(x, y, masks) {
  return masks.some((mask) => x >= mask.bbox.x && x < mask.bbox.x + mask.bbox.width
    && y >= mask.bbox.y && y < mask.bbox.y + mask.bbox.height);
}

function computeMetrics(reference, actual, rect, threshold, masks = []) {
  const normalized = normalizeRect(rect, reference.width, reference.height);
  if (!normalized) return null;
  let sum = 0;
  let differingPixels = 0;
  let maskedPixels = 0;
  let evaluatedPixels = 0;
  let minX = reference.width;
  let minY = reference.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = normalized.y; y < normalized.y + normalized.height; y += 1) {
    for (let x = normalized.x; x < normalized.x + normalized.width; x += 1) {
      if (isMasked(x, y, masks)) {
        maskedPixels += 1;
        continue;
      }
      evaluatedPixels += 1;
      const index = (y * reference.width + x) * 4;
      const delta = pixelDelta(reference.data, actual.data, index);
      sum += delta.dr + delta.dg + delta.db;
      if (delta.max > threshold) {
        differingPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const totalPixels = normalized.width * normalized.height;
  return {
    bbox: normalized,
    pixelCount: evaluatedPixels,
    totalPixels,
    evaluatedPixels,
    maskedPixels,
    fullyMasked: evaluatedPixels === 0,
    meanAbsoluteError: evaluatedPixels === 0 ? null : Number((sum / (evaluatedPixels * 3 * 255)).toFixed(6)),
    differingPixels,
    differentPixelRatio: evaluatedPixels === 0 ? null : Number((differingPixels / evaluatedPixels).toFixed(6)),
    differenceBounds: differingPixels === 0 ? null : {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    }
  };
}

function compositedRgb(data, index) {
  const alpha = data[index + 3] / 255;
  return [
    compositeChannel(data[index], alpha),
    compositeChannel(data[index + 1], alpha),
    compositeChannel(data[index + 2], alpha)
  ];
}

function computePerceptualMetrics(reference, actual, rect, factor, masks = []) {
  const normalized = normalizeRect(rect, reference.width, reference.height);
  if (!normalized) return null;
  const cells = [];
  const columns = Math.ceil(normalized.width / factor);
  const rows = Math.ceil(normalized.height / factor);
  let maskedPixels = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const startX = normalized.x + column * factor;
      const startY = normalized.y + row * factor;
      const endX = Math.min(normalized.x + normalized.width, startX + factor);
      const endY = Math.min(normalized.y + normalized.height, startY + factor);
      const referenceSum = [0, 0, 0];
      const actualSum = [0, 0, 0];
      let count = 0;
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          if (isMasked(x, y, masks)) {
            maskedPixels += 1;
            continue;
          }
          const index = (y * reference.width + x) * 4;
          const referenceRgb = compositedRgb(reference.data, index);
          const actualRgb = compositedRgb(actual.data, index);
          for (let channel = 0; channel < 3; channel += 1) {
            referenceSum[channel] += referenceRgb[channel];
            actualSum[channel] += actualRgb[channel];
          }
          count += 1;
        }
      }
      if (count === 0) {
        cells.push(null);
        continue;
      }
      const referenceRgb = referenceSum.map((value) => value / count);
      const actualRgb = actualSum.map((value) => value / count);
      cells.push({
        referenceRgb,
        actualRgb,
        referenceLuma: 0.2126 * referenceRgb[0] + 0.7152 * referenceRgb[1] + 0.0722 * referenceRgb[2],
        actualLuma: 0.2126 * actualRgb[0] + 0.7152 * actualRgb[1] + 0.0722 * actualRgb[2]
      });
    }
  }
  const evaluated = cells.filter(Boolean);
  if (evaluated.length === 0) {
    return {
      bbox: normalized,
      downsampleFactor: factor,
      evaluatedBlocks: 0,
      maskedPixels,
      fullyMasked: true,
      colorSimilarity: null,
      edgeSimilarity: null,
      similarity: null
    };
  }
  const colorError = evaluated.reduce((sum, cell) => sum
    + Math.abs(cell.referenceRgb[0] - cell.actualRgb[0])
    + Math.abs(cell.referenceRgb[1] - cell.actualRgb[1])
    + Math.abs(cell.referenceRgb[2] - cell.actualRgb[2]), 0) / (evaluated.length * 3 * 255);
  let edgeErrorSum = 0;
  let edgeCount = 0;
  const compareEdge = (left, right) => {
    if (!left || !right) return;
    const referenceEdge = Math.abs(left.referenceLuma - right.referenceLuma);
    const actualEdge = Math.abs(left.actualLuma - right.actualLuma);
    edgeErrorSum += Math.abs(referenceEdge - actualEdge) / 255;
    edgeCount += 1;
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (column + 1 < columns) compareEdge(cells[index], cells[index + 1]);
      if (row + 1 < rows) compareEdge(cells[index], cells[index + columns]);
    }
  }
  const colorSimilarity = Math.max(0, 1 - colorError);
  const edgeSimilarity = edgeCount === 0 ? colorSimilarity : Math.max(0, 1 - edgeErrorSum / edgeCount);
  const similarity = 0.75 * colorSimilarity + 0.25 * edgeSimilarity;
  return {
    bbox: normalized,
    downsampleFactor: factor,
    evaluatedBlocks: evaluated.length,
    maskedPixels,
    fullyMasked: false,
    colorSimilarity: Number(colorSimilarity.toFixed(6)),
    edgeSimilarity: Number(edgeSimilarity.toFixed(6)),
    similarity: Number(similarity.toFixed(6))
  };
}

function collectRegions(file, width, height) {
  if (!file) return [];
  const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  const crop = contract.source?.crop ?? { x: 0, y: 0 };
  const toCanvasRect = (bbox) => ({
    x: bbox.x - crop.x,
    y: bbox.y - crop.y,
    width: bbox.width,
    height: bbox.height
  });
  const records = [];
  for (const region of contract.regions ?? []) {
    const bbox = normalizeRect(toCanvasRect(region.bbox), width, height);
    if (bbox) records.push({ id: region.id, type: 'region', criticality: region.criticality ?? 'normal', bbox });
    for (const element of region.elements ?? []) {
      const elementBbox = normalizeRect(toCanvasRect(element.bbox), width, height);
      if (elementBbox) records.push({
        id: element.id,
        type: 'element',
        criticality: element.required ? 'important' : 'normal',
        bbox: elementBbox
      });
    }
  }
  return records;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function encodeRgbaPng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const outputOffset = y * (stride + 1);
    raw[outputOffset] = 0;
    rgba.copy(raw, outputOffset + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function createDiffRgba(reference, actual, masks = []) {
  const output = Buffer.alloc(reference.width * reference.height * 4);
  for (let pixel = 0; pixel < reference.width * reference.height; pixel += 1) {
    const index = pixel * 4;
    const x = pixel % reference.width;
    const y = Math.floor(pixel / reference.width);
    if (isMasked(x, y, masks)) {
      output[index] = 160;
      output[index + 1] = 160;
      output[index + 2] = 160;
      output[index + 3] = 255;
      continue;
    }
    const delta = pixelDelta(reference.data, actual.data, index).max;
    const intensity = Math.max(0, 255 - delta);
    output[index] = 255;
    output[index + 1] = intensity;
    output[index + 2] = intensity;
    output[index + 3] = 255;
  }
  return output;
}

function createDiff(reference, actual, masks = []) {
  return encodeRgbaPng(reference.width, reference.height, createDiffRgba(reference, actual, masks));
}

function cropRgba(image, rect) {
  const output = Buffer.alloc(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = ((rect.y + y) * image.width + rect.x) * 4;
    const targetStart = y * rect.width * 4;
    image.data.copy(output, targetStart, sourceStart, sourceStart + rect.width * 4);
  }
  return output;
}

function safeTargetId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'target';
}

function writeEvidenceCrops(directory, records, reference, actual, diffRgba) {
  const resolvedDirectory = path.resolve(directory);
  fs.mkdirSync(resolvedDirectory, { recursive: true });
  const diffImage = { width: reference.width, height: reference.height, data: diffRgba };
  const output = new Map();
  for (const record of records.filter((item) => item.criticality === 'critical' || item.criticality === 'important')) {
    const name = safeTargetId(record.id);
    const paths = {
      reference: path.join(resolvedDirectory, `${name}.reference.png`),
      actual: path.join(resolvedDirectory, `${name}.actual.png`),
      diff: path.join(resolvedDirectory, `${name}.diff.png`)
    };
    writeFileEnsuringDirectory(paths.reference, encodeRgbaPng(record.bbox.width, record.bbox.height, cropRgba(reference, record.bbox)));
    writeFileEnsuringDirectory(paths.actual, encodeRgbaPng(record.bbox.width, record.bbox.height, cropRgba(actual, record.bbox)));
    writeFileEnsuringDirectory(paths.diff, encodeRgbaPng(record.bbox.width, record.bbox.height, cropRgba(diffImage, record.bbox)));
    output.set(record.id, Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, path.resolve(file)])));
  }
  return output;
}

function writeFileEnsuringDirectory(file, content) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, content);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const acceptance = loadAcceptancePolicy(options.acceptancePolicy, options.profile);
  const rawPolicy = acceptance.profile.rawPixel;
  const perceptualPolicy = acceptance.profile.perceptual;
  const threshold = options.threshold ?? rawPolicy.threshold;
  const maxMae = options.maxMae ?? rawPolicy.maximumMeanAbsoluteError;
  const maxDiffRatio = options.maxDiffRatio ?? rawPolicy.maximumDifferentPixelRatio;
  const maxRegionDiffRatio = options.maxRegionDiffRatio ?? rawPolicy.maximumCriticalRegionDifferentPixelRatio;
  const reference = decodePng(options.reference);
  const actual = decodePng(options.actual);
  const alignment = loadPassingAlignmentReport(options.alignmentReport, reference, actual);
  if (reference.width !== actual.width || reference.height !== actual.height) {
    throw new Error(`PNG dimensions differ: reference=${reference.width}x${reference.height}, actual=${actual.width}x${actual.height}. Fix viewport/crop; implicit resizing is forbidden.`);
  }
  const masks = normalizeMasks(alignment.masks, reference.width, reference.height);
  const declaredMaskedArea = masks.reduce((sum, mask) => sum + mask.bbox.width * mask.bbox.height, 0);
  const declaredMaskRatio = declaredMaskedArea / (reference.width * reference.height);
  if (declaredMaskRatio > (alignment.maskPolicy?.maxAreaRatio ?? 0.05) && alignment.maskPolicy?.allowOverLimit !== true) {
    throw new Error(`Alignment gate rejected: masked area ratio ${declaredMaskRatio.toFixed(4)} exceeds policy limit`);
  }
  const canvas = { x: 0, y: 0, width: reference.width, height: reference.height };
  const global = computeMetrics(reference, actual, canvas, threshold, masks);
  const perceptualGlobal = computePerceptualMetrics(reference, actual, canvas, perceptualPolicy.downsampleFactor, masks);
  let regionMetrics = collectRegions(options.regions, reference.width, reference.height).map((record) => {
    const rawPixel = computeMetrics(reference, actual, record.bbox, threshold, masks);
    const perceptual = computePerceptualMetrics(reference, actual, record.bbox, perceptualPolicy.downsampleFactor, masks);
    return { ...record, metrics: rawPixel, rawPixel, perceptual };
  });
  const rawCriticalFailures = regionMetrics.filter((record) =>
    record.type === 'region' && record.criticality === 'critical'
      && (record.rawPixel.fullyMasked || record.rawPixel.differentPixelRatio > maxRegionDiffRatio)
  );
  const perceptualCriticalFailures = regionMetrics.filter((record) =>
    record.type === 'region' && record.criticality === 'critical'
      && (record.perceptual.fullyMasked || record.perceptual.similarity < perceptualPolicy.minimumCriticalRegionSimilarity)
  );
  const rawPassed = !global.fullyMasked
    && global.meanAbsoluteError <= maxMae
    && global.differentPixelRatio <= maxDiffRatio
    && rawCriticalFailures.length === 0;
  const perceptualPassed = !perceptualGlobal.fullyMasked
    && perceptualGlobal.similarity >= perceptualPolicy.minimumGlobalSimilarity
    && perceptualCriticalFailures.length === 0;
  const passed = (rawPolicy.role === 'diagnostic-only' || rawPassed)
    && (perceptualPolicy.role === 'diagnostic-only' || perceptualPassed);
  const diffRgba = createDiffRgba(reference, actual, masks);
  const evidence = options.evidenceDir
    ? writeEvidenceCrops(options.evidenceDir, regionMetrics, reference, actual, diffRgba)
    : new Map();
  regionMetrics = regionMetrics.map((record) => ({ ...record, evidence: evidence.get(record.id) ?? null }));
  const report = {
    kind: 'pixel-report',
    schemaVersion: '2.0',
    acceptancePolicy: path.resolve(options.acceptancePolicy),
    profile: acceptance.profileName,
    reference: path.resolve(options.reference),
    actual: path.resolve(options.actual),
    alignment: {
      report: path.resolve(options.alignmentReport),
      scopeType: alignment.scopeType,
      captureMode: alignment.actual.captureMode,
      selector: alignment.actual.selector ?? null,
      fixtureSetId: alignment.dataFixture?.fixtureSetId ?? null,
      fixtureSetDigest: alignment.dataFixture?.fixtureSetDigest ?? null
    },
    dimensions: { width: reference.width, height: reference.height },
    masks: masks.map((mask) => ({ id: mask.id, reason: mask.reason, bbox: mask.bbox })),
    threshold,
    gates: {
      maxMeanAbsoluteError: maxMae,
      maxDifferentPixelRatio: maxDiffRatio,
      maxCriticalRegionDifferentPixelRatio: maxRegionDiffRatio
    },
    global,
    regions: regionMetrics,
    rawPixel: {
      role: rawPolicy.role,
      threshold,
      thresholds: {
        maximumMeanAbsoluteError: maxMae,
        maximumDifferentPixelRatio: maxDiffRatio,
        maximumCriticalRegionDifferentPixelRatio: maxRegionDiffRatio
      },
      global,
      passedThresholds: rawPassed,
      criticalFailures: rawCriticalFailures.map((record) => record.id)
    },
    perceptual: {
      role: perceptualPolicy.role,
      method: 'alpha-composite-white + block-average-low-pass + color/edge similarity',
      downsampleFactor: perceptualPolicy.downsampleFactor,
      thresholds: {
        minimumGlobalSimilarity: perceptualPolicy.minimumGlobalSimilarity,
        minimumCriticalRegionSimilarity: perceptualPolicy.minimumCriticalRegionSimilarity
      },
      global: perceptualGlobal,
      passedThresholds: perceptualPassed,
      criticalFailures: perceptualCriticalFailures.map((record) => record.id)
    },
    gate: {
      status: passed ? 'pass' : 'needs-review',
      rawPixelRole: rawPolicy.role,
      perceptualRole: perceptualPolicy.role,
      criticalFailures: [...new Set([
        ...(rawPolicy.role === 'diagnostic-only' ? [] : rawCriticalFailures.map((record) => record.id)),
        ...(perceptualPolicy.role === 'diagnostic-only' ? [] : perceptualCriticalFailures.map((record) => record.id))
      ])],
      note: rawPolicy.role === 'diagnostic-only'
        ? 'Raw pixel metrics and diff heatmap are diagnostic-only for this profile. Final authority is visual-evaluation.'
        : 'Raw pixel metrics participate in this profile. Final authority is visual-evaluation.'
    }
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) writeFileEnsuringDirectory(options.output, json);
  if (options.diff) writeFileEnsuringDirectory(options.diff, encodeRgbaPng(reference.width, reference.height, diffRgba));
  printResult(report, reportSummary('pixel-report', report.gate.status, options.output, {
    profile: report.profile,
    failedTargets: report.gate.criticalFailures,
    rawPixelRole: report.rawPixel.role,
    perceptualSimilarity: report.perceptual.global.similarity,
    evidenceDirectory: options.evidenceDir ? path.resolve(options.evidenceDir) : null
  }), { verbose: options.verbose === true });
} catch (error) {
  console.error(JSON.stringify({ kind: 'pixel-report-error', error: error.message }, null, 2));
  process.exit(1);
}
