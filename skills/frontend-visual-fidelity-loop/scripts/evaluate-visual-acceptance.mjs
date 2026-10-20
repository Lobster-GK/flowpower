#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { compactMessages, printResult, reportSummary } from './cli-output.mjs';

function usage(exitCode = 0) {
  console.error(`Usage:
  node evaluate-visual-acceptance.mjs <policy.json> <visual-contract.json> <component-adaptation.json> <alignment-report.json> <pixel-report.json> --output <visual-evaluation.json> [--profile <name>]`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const positional = [];
  let output;
  let profile;
  let verbose = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') usage(0);
    if (arg === '--verbose') { verbose = true; continue; }
    if (arg === '--output' || arg === '--profile') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--output') output = value;
      else profile = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 5 || !output) usage(2);
  return {
    policyFile: positional[0],
    contractFile: positional[1],
    adaptationFile: positional[2],
    alignmentFile: positional[3],
    pixelFile: positional[4],
    output,
    profile,
    verbose
  };
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error.message}`);
  }
}

function round(value) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(6));
}

function finiteOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeBbox(bbox, crop) {
  return {
    x: bbox.x - crop.x,
    y: bbox.y - crop.y,
    width: bbox.width,
    height: bbox.height
  };
}

function intersectionOverUnion(left, right) {
  if (!left || !right) return 0;
  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(left.x + left.width, right.x + right.width);
  const y1 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function toleranceScore(delta, tolerance) {
  if (delta <= tolerance) return 1;
  if (tolerance === 0) return 0;
  return tolerance / delta;
}

function geometryEvaluation(expected, actual, geometryPolicy, criticality, override = {}) {
  const positionTolerance = override.position ?? geometryPolicy.positionTolerancePx;
  const sizeTolerance = override.size ?? geometryPolicy.sizeTolerancePx;
  const minimumIou = override.minimumIou
    ?? (criticality === 'critical' ? geometryPolicy.minimumCriticalIou : geometryPolicy.minimumIou);
  if (!actual) {
    return {
      positionDeltaPx: Math.max(expected.x, expected.y, expected.width, expected.height),
      sizeDeltaPx: Math.max(expected.width, expected.height),
      iou: 0,
      tolerances: { positionPx: positionTolerance, sizePx: sizeTolerance, minimumIou },
      score: 0,
      passed: false
    };
  }
  const positionDelta = Math.max(Math.abs(expected.x - actual.x), Math.abs(expected.y - actual.y));
  const sizeDelta = Math.max(Math.abs(expected.width - actual.width), Math.abs(expected.height - actual.height));
  const iou = intersectionOverUnion(expected, actual);
  const score = (
    toleranceScore(positionDelta, positionTolerance)
    + toleranceScore(sizeDelta, sizeTolerance)
    + Math.min(1, minimumIou === 0 ? 1 : iou / minimumIou)
  ) / 3;
  return {
    positionDeltaPx: Number(positionDelta.toFixed(3)),
    sizeDeltaPx: Number(sizeDelta.toFixed(3)),
    iou: round(iou),
    tolerances: { positionPx: positionTolerance, sizePx: sizeTolerance, minimumIou },
    score: round(score),
    passed: positionDelta <= positionTolerance && sizeDelta <= sizeTolerance && iou >= minimumIou
  };
}

function primaryFont(value) {
  return String(value ?? '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
}

function typographyEvaluation(expected, actual, policy, override = {}) {
  if (!expected || policy.enabled !== true) return null;
  const tolerances = {
    fontSize: override.fontSizePx ?? policy.fontSizeTolerancePx,
    lineHeight: override.lineHeightPx ?? policy.lineHeightTolerancePx,
    fontWeight: override.fontWeight ?? policy.fontWeightTolerance
  };
  if (!actual) {
    return { score: 0, passed: false, familyMatched: false, deltas: {}, tolerances };
  }
  const comparisons = [
    ['fontSize', expected.fontSize, actual.fontSize, tolerances.fontSize],
    ['lineHeight', expected.lineHeight, actual.lineHeight, tolerances.lineHeight],
    ['fontWeight', expected.fontWeight, actual.fontWeight, tolerances.fontWeight]
  ].filter(([, target, observed]) => Number.isFinite(target) && Number.isFinite(observed));
  const deltas = Object.fromEntries(comparisons.map(([key, target, observed]) => [key, Number(Math.abs(target - observed).toFixed(3))]));
  const numericScores = comparisons.map(([key, , , tolerance]) => toleranceScore(deltas[key], tolerance));
  const familyMatched = primaryFont(expected.fontFamily) === primaryFont(actual.fontFamily);
  const scores = [...numericScores, familyMatched ? 1 : 0];
  const score = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const numericPassed = comparisons.length === 3 && comparisons.every(([key, , , tolerance]) => deltas[key] <= tolerance);
  return {
    score: round(score),
    passed: numericPassed && familyMatched,
    familyMatched,
    expectedFontFamily: expected.fontFamily,
    actualFontFamily: actual.fontFamily ?? null,
    deltas,
    tolerances
  };
}

function rawPixelEvaluation(metrics, profile, criticality) {
  const threshold = criticality === 'critical'
    ? profile.maximumCriticalRegionDifferentPixelRatio
    : profile.maximumDifferentPixelRatio;
  const mae = metrics?.meanAbsoluteError ?? null;
  const ratio = metrics?.differentPixelRatio ?? null;
  const available = mae !== null && ratio !== null && metrics?.fullyMasked !== true;
  const passed = available && mae <= profile.maximumMeanAbsoluteError && ratio <= threshold;
  const maeScore = available ? toleranceScore(mae, profile.maximumMeanAbsoluteError) : 0;
  const ratioScore = available ? toleranceScore(ratio, threshold) : 0;
  return {
    role: profile.role,
    meanAbsoluteError: mae,
    differentPixelRatio: ratio,
    passedDiagnosticThresholds: passed,
    score: round((maeScore + ratioScore) / 2)
  };
}

function weightedScore(parts, weights) {
  const available = parts.filter((part) => part.value !== null && weights[part.key] > 0);
  const totalWeight = available.reduce((sum, part) => sum + weights[part.key], 0);
  if (totalWeight === 0) return 0;
  return round(available.reduce((sum, part) => sum + part.value * weights[part.key], 0) / totalWeight);
}

function flattenTargets(contract) {
  const crop = contract.source?.crop ?? { x: 0, y: 0 };
  const targets = [];
  for (const region of contract.regions ?? []) {
    targets.push({
      id: region.id,
      type: 'region',
      criticality: region.criticality ?? 'normal',
      bbox: normalizeBbox(region.bbox, crop),
      typography: null,
      contentRequired: false
    });
    for (const element of region.elements ?? []) {
      targets.push({
        id: element.id,
        type: 'element',
        criticality: element.required ? 'important' : 'normal',
        bbox: normalizeBbox(element.bbox, crop),
        typography: element.typography,
        contentRequired: element.required === true && element.content !== null
      });
    }
  }
  return targets;
}

function allChecksTrue(checks, keys) {
  return keys.every((key) => checks?.[key] === true);
}

function writeOutput(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const policy = readJson(options.policyFile, 'acceptance policy');
  const contract = readJson(options.contractFile, 'visual contract');
  const adaptation = readJson(options.adaptationFile, 'component adaptation');
  const alignment = readJson(options.alignmentFile, 'alignment report');
  const pixel = readJson(options.pixelFile, 'pixel report');
  if (policy.kind !== 'visual-acceptance-policy') throw new Error('Policy kind must be visual-acceptance-policy');
  if (contract.kind !== 'visual-contract') throw new Error('Contract kind must be visual-contract');
  if (adaptation.kind !== 'component-adaptation') throw new Error('Adaptation kind must be component-adaptation');
  if (alignment.kind !== 'alignment-report') throw new Error('Alignment kind must be alignment-report');
  if (pixel.kind !== 'pixel-report') throw new Error('Pixel input kind must be pixel-report');
  const profileName = options.profile ?? policy.activeProfile;
  const globalProfile = policy.profiles?.[profileName];
  if (!globalProfile) throw new Error(`Acceptance profile ${profileName ?? 'missing'} is not defined`);
  if (pixel.profile !== profileName) throw new Error(`Pixel report profile ${pixel.profile ?? 'missing'} does not match evaluation profile ${profileName}`);

  const scopeChecks = [
    'scopeConfirmed', 'targetResolved', 'captureContractMatched', 'applicationShellPreserved',
    'sizeMatched', 'originNormalized', 'cropMatched', 'fontsReady', 'assetsReady',
    'visualLabLockVerified', 'visualLabFilesMatched', 'visualLabObservationMatched',
    'visualLabBoundaryPreserved', 'captureMutationsLayoutSafe'
  ];
  const dataChecks = [
    'fixtureLockVerified', 'fixtureSetMatched', 'expectedRequestsMatched',
    'noUnmatchedBusinessRequests', 'runtimeDeterministic', 'visibleDataMatched', 'dataSettled'
  ];
  const measurements = new Map((alignment.visualMeasurements ?? []).map((item) => [item.id, item]));
  const pixelTargets = new Map((pixel.regions ?? []).map((item) => [item.id, item]));
  const mappings = new Map((adaptation.mappings ?? []).map((item) => [item.elementId, item]));
  const targetResults = [];

  for (const target of flattenTargets(contract)) {
    const measurement = measurements.get(target.id);
    const mappingPolicy = mappings.get(target.id)?.acceptancePolicy;
    const targetProfileName = mappingPolicy?.profile ?? profileName;
    const targetProfile = policy.profiles?.[targetProfileName] ?? globalProfile;
    const geometry = geometryEvaluation(target.bbox, measurement?.bbox, targetProfile.geometry, {
      position: mappingPolicy?.geometryTolerancePx?.position,
      size: mappingPolicy?.geometryTolerancePx?.size,
      minimumIou: mappingPolicy?.minimumIou
    });
    const typography = typographyEvaluation(target.typography, measurement?.computedStyle, targetProfile.typography, mappingPolicy?.typographyTolerance);
    const pixelTarget = pixelTargets.get(target.id);
    const perceptualSimilarity = pixelTarget?.perceptual?.similarity ?? null;
    const perceptualMinimum = target.criticality === 'critical'
      ? targetProfile.perceptual.minimumCriticalRegionSimilarity
      : targetProfile.perceptual.minimumGlobalSimilarity;
    const perceptual = perceptualSimilarity === null ? null : {
      similarity: perceptualSimilarity,
      minimum: perceptualMinimum,
      passed: perceptualSimilarity >= perceptualMinimum
    };
    const rawPixel = rawPixelEvaluation(pixelTarget?.rawPixel ?? pixelTarget?.metrics, targetProfile.rawPixel, target.criticality);
    const score = weightedScore([
      { key: 'geometry', value: geometry.score },
      { key: 'typography', value: typography?.score ?? null },
      { key: 'perceptual', value: targetProfile.perceptual.role === 'diagnostic-only' ? null : perceptualSimilarity },
      { key: 'rawPixel', value: targetProfile.rawPixel.role === 'diagnostic-only' ? null : rawPixel.score }
    ], targetProfile.scoring.weights);
    const required = target.criticality === 'critical' || target.criticality === 'important';
    const failures = [];
    if (required && measurement?.present !== true) failures.push('required target is not present');
    if (required && measurement?.visible !== true) failures.push('required target is not visible');
    if (target.contentRequired && measurement?.contentMatched !== true) failures.push('required content does not match');
    if (required && measurement?.stateMatched !== true) failures.push('required target state does not match');
    if (measurement?.overflow?.clipped === true) failures.push('target has unintended clipped overflow');
    if ((measurement?.occlusion?.ratio ?? 0) > policy.hardGates.maximumOcclusionRatio) failures.push('target exceeds maximum occlusion ratio');
    if (!geometry.passed) failures.push('geometry is outside target tolerance');
    if (typography && !typography.passed) failures.push('typography is outside target tolerance');
    if (targetProfile.perceptual.role !== 'diagnostic-only' && (!perceptual || !perceptual.passed)) failures.push('perceptual similarity is below target minimum');
    if (targetProfile.rawPixel.role === 'hard-gate' && !rawPixel.passedDiagnosticThresholds) failures.push('raw pixel hard gate failed');
    const minimumScore = target.criticality === 'critical'
      ? targetProfile.scoring.minimumCriticalRegion
      : target.criticality === 'important'
        ? targetProfile.scoring.minimumImportantElement
        : targetProfile.scoring.minimumNormalTarget;
    if (score < minimumScore) failures.push(`weighted score ${score} is below ${minimumScore}`);
    targetResults.push({
      id: target.id,
      type: target.type,
      criticality: target.criticality,
      profile: targetProfileName,
      score,
      minimumScore,
      passed: failures.length === 0,
      measurement: {
        present: measurement?.present === true,
        visible: measurement?.visible === true,
        contentMatched: measurement?.contentMatched === true,
        stateMatched: measurement?.stateMatched === true,
        overflowClipped: measurement?.overflow?.clipped === true,
        occlusionRatio: finiteOr(measurement?.occlusion?.ratio, 0)
      },
      geometry,
      typography,
      perceptual,
      rawPixel,
      allowedLibraryVariations: mappingPolicy?.allowedLibraryVariations ?? [],
      failures
    });
  }

  const requiredTargets = targetResults.filter((target) => target.criticality === 'critical' || target.criticality === 'important');
  const hardGates = {
    scopeAligned: policy.hardGates.scopeAligned !== true || (
      alignment.status === 'pass'
      && (alignment.blockers ?? []).length === 0
      && allChecksTrue(alignment.checks, scopeChecks)
    ),
    dataFixtureMatched: policy.hardGates.dataFixtureMatched !== true || allChecksTrue(alignment.checks, dataChecks),
    stateMatched: policy.hardGates.stateMatched !== true || (
      alignment.checks?.stateMatched === true && requiredTargets.every((target) => target.measurement.stateMatched)
    ),
    requiredElementsComplete: policy.hardGates.requiredElementsComplete !== true || requiredTargets.every((target) => target.measurement.present && target.measurement.visible),
    contentMatched: policy.hardGates.contentMatched !== true || requiredTargets.every((target) => target.measurement.contentMatched),
    noOverflowOrOcclusion: policy.hardGates.noOverflowOrOcclusion !== true || targetResults.every((target) => (
      !target.measurement.overflowClipped && target.measurement.occlusionRatio <= policy.hardGates.maximumOcclusionRatio
    ))
  };
  const weightedTargets = targetResults.map((target) => ({
    value: target.score,
    weight: target.criticality === 'critical' ? 2 : target.criticality === 'important' ? 1.5 : 1
  }));
  const totalTargetWeight = weightedTargets.reduce((sum, target) => sum + target.weight, 0);
  const overall = totalTargetWeight === 0 ? 0 : round(weightedTargets.reduce((sum, target) => sum + target.value * target.weight, 0) / totalTargetWeight);
  const criticalScores = targetResults.filter((target) => target.criticality === 'critical').map((target) => target.score);
  const importantScores = targetResults.filter((target) => target.criticality === 'important').map((target) => target.score);
  const minimumCriticalRegion = criticalScores.length > 0 ? Math.min(...criticalScores) : 1;
  const minimumImportantElement = importantScores.length > 0 ? Math.min(...importantScores) : 1;
  const perceptualGlobal = finiteOr(pixel.perceptual?.global?.similarity, 0);
  const failures = [];
  for (const [key, passed] of Object.entries(hardGates)) {
    if (!passed) failures.push({ category: 'hard-gate', target: key, message: `${key} failed` });
  }
  for (const target of targetResults.filter((item) => !item.passed)) {
    failures.push({ category: 'target', target: target.id, message: target.failures.join('; ') });
  }
  if (overall < globalProfile.scoring.minimumOverall) {
    failures.push({ category: 'score', target: 'overall', message: `overall score ${overall} is below ${globalProfile.scoring.minimumOverall}` });
  }
  if (globalProfile.perceptual.role !== 'diagnostic-only'
    && perceptualGlobal < globalProfile.perceptual.minimumGlobalSimilarity) {
    failures.push({ category: 'image', target: 'global', message: `perceptual similarity ${perceptualGlobal} is below ${globalProfile.perceptual.minimumGlobalSimilarity}` });
  }
  if (globalProfile.rawPixel.role === 'hard-gate' && pixel.rawPixel?.passedThresholds !== true) {
    failures.push({ category: 'image', target: 'global', message: 'global raw pixel hard gate failed' });
  }
  const environmentBlocked = !hardGates.scopeAligned || !hardGates.dataFixtureMatched || !hardGates.stateMatched;
  const status = environmentBlocked ? 'blocked' : failures.length === 0 ? 'pass' : 'needs-repair';
  const report = {
    kind: 'visual-evaluation',
    schemaVersion: '1.0',
    profile: profileName,
    inputs: {
      policy: path.resolve(options.policyFile),
      visualContract: path.resolve(options.contractFile),
      componentAdaptation: path.resolve(options.adaptationFile),
      alignmentReport: path.resolve(options.alignmentFile),
      pixelReport: path.resolve(options.pixelFile)
    },
    hardGates,
    scores: {
      overall,
      minimumCriticalRegion: round(minimumCriticalRegion),
      minimumImportantElement: round(minimumImportantElement),
      perceptualGlobal: round(perceptualGlobal)
    },
    targets: targetResults,
    failures,
    diagnostics: {
      rawPixelRole: globalProfile.rawPixel.role,
      rawPixelThresholdsPassed: pixel.rawPixel?.passedThresholds === true,
      note: globalProfile.rawPixel.role === 'diagnostic-only'
        ? 'Raw pixel differences are retained for heatmap diagnosis and do not affect final status.'
        : 'Raw pixel differences participate in this profile according to the configured role.'
    },
    status
  };
  writeOutput(options.output, report);
  printResult(report, reportSummary('visual-evaluation', status, options.output, {
    profile: profileName,
    overallScore: report.scores.overall,
    failedTargets: targetResults.filter((target) => !target.passed).map((target) => target.id),
    failureCount: failures.length,
    failures: compactMessages(failures.map((failure) => `${failure.target}: ${failure.message}`))
  }), { verbose: options.verbose });
  process.exit(status === 'pass' ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ kind: 'visual-evaluation-error', error: error.message }, null, 2));
  process.exit(2);
}
