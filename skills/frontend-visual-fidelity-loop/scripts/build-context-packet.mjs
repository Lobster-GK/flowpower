#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { printResult, reportSummary } from './cli-output.mjs';

function usage(exitCode = 0) {
  console.error('Usage: node build-context-packet.mjs <run-state.json> --output <context-packet.json> [--target <id>] [--max-targets <n>] [--max-images <n>] [--max-text-tokens <n>] [--verbose]');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const positional = [];
  const options = { targets: [], verbose: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') usage(0);
    if (arg === '--verbose') { options.verbose = true; continue; }
    if (['--output', '--target', '--max-targets', '--max-images', '--max-text-tokens'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--target') options.targets.push(value);
      else options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1 || !options.output) usage(2);
  for (const key of ['maxTargets', 'maxImages', 'maxTextTokens']) {
    if (options[key] !== undefined) {
      options[key] = Number(options[key]);
      if (!Number.isInteger(options[key]) || options[key] < 0) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} must be a non-negative integer`);
    }
  }
  return { stateFile: path.resolve(positional[0]), output: path.resolve(options.output), ...options };
}

function readJson(file, label) {
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`Cannot read ${label}: ${error.message}`); }
}

function sha256(file) {
  return file && fs.existsSync(file) && fs.statSync(file).isFile()
    ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
}

function resolveArtifact(stateFile, state, key) {
  const root = path.resolve(path.dirname(stateFile), state.artifactRoot ?? '.');
  const value = state.artifacts?.[key];
  if (!value) return null;
  const resolved = path.resolve(root, value);
  const relation = path.relative(root, resolved);
  if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error(`Artifact ${key} escapes artifactRoot`);
  return resolved;
}

function flattenContract(contract) {
  const targets = [];
  for (const region of contract?.regions ?? []) {
    targets.push({
      id: region.id, type: 'region', role: region.role, parentId: region.parentId, criticality: region.criticality,
      bbox: region.bbox, layout: region.layout, appearance: region.appearance
    });
    for (const element of region.elements ?? []) targets.push({
      id: element.id, type: 'element', role: element.role, parentId: region.id,
      criticality: element.required ? 'important' : 'normal', required: element.required,
      bbox: element.bbox, content: element.content, typography: element.typography, appearance: element.appearance, asset: element.asset
    });
  }
  return targets;
}

function canonicalEntries(stateFile, state) {
  return Object.fromEntries(Object.keys(state.artifacts ?? {}).map((key) => {
    const file = resolveArtifact(stateFile, state, key);
    return [key, file ? { path: file, sha256: sha256(file) } : null];
  }).filter(([, value]) => value?.path));
}

function goalFor(phase) {
  const goals = {
    contract: 'measure the reference and create the canonical visual contract',
    generation: 'generate the static-fixture Visual Lab UI from compact target facts',
    capture: 'capture and measure the sealed Visual Lab without changing UI code',
    repair: 'repair only the active failed target using local evidence',
    acceptance: 'review hard gates and remaining critical targets, then stop',
    blocked: 'resolve only the reported environment blocker',
    complete: 'stop; sandbox acceptance is complete'
  };
  return goals[phase] ?? 'perform only the current phase';
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
  const state = readJson(options.stateFile, 'run state');
  if (state?.kind !== 'visual-run-state') throw new Error('Input must be a visual-run-state');
  const budget = {
    maximumTextTokens: options.maxTextTokens ?? state.budget?.maximumTextTokens ?? 16000,
    maximumImages: options.maxImages ?? state.budget?.maximumImages ?? 3,
    maximumTargets: options.maxTargets ?? state.budget?.maximumTargets ?? 1
  };
  if (state.phase === 'repair' && budget.maximumTargets > 3) {
    throw new Error('Repair context cannot exceed three targets; keep the default of one unless targets share one parent root cause');
  }
  const contract = readJson(resolveArtifact(options.stateFile, state, 'visualContract'), 'visual contract');
  const evaluation = readJson(resolveArtifact(options.stateFile, state, 'visualEvaluation'), 'visual evaluation');
  const pixel = readJson(resolveArtifact(options.stateFile, state, 'pixelReport'), 'pixel report');
  const previousDelta = readJson(resolveArtifact(options.stateFile, state, 'iterationDelta'), 'iteration delta');
  const expected = new Map(flattenContract(contract).map((target) => [target.id, target]));
  const evaluated = new Map((evaluation?.targets ?? []).map((target) => [target.id, target]));
  const pixelTargets = new Map((pixel?.regions ?? []).map((target) => [target.id, target]));
  let selectedIds = options.targets.length > 0 ? options.targets : state.activeTargets ?? [];
  if (state.phase === 'generation' && selectedIds.length === 0) {
    selectedIds = [...expected.values()].filter((target) => target.criticality !== 'normal').map((target) => target.id);
  }
  if (state.phase === 'contract') selectedIds = [];
  if (selectedIds.length > budget.maximumTargets) {
    throw new Error(`Context target count ${selectedIds.length} exceeds budget ${budget.maximumTargets}; select a region or use --target/--max-targets explicitly`);
  }
  const targets = selectedIds.map((id) => ({
    id,
    expected: expected.get(id) ?? null,
    evaluation: evaluated.get(id) ?? null,
    pixel: pixelTargets.has(id) ? {
      perceptual: pixelTargets.get(id).perceptual,
      rawPixel: pixelTargets.get(id).rawPixel,
      evidence: pixelTargets.get(id).evidence ?? null
    } : null
  }));
  const evidenceImages = [];
  const reference = resolveArtifact(options.stateFile, state, 'reference');
  if (state.phase === 'contract' || state.phase === 'generation') {
    if (reference) evidenceImages.push({ role: 'reference', path: reference });
  } else {
    for (const target of targets) {
      for (const [role, imagePath] of Object.entries(target.pixel?.evidence ?? {})) {
        if (imagePath && fs.existsSync(imagePath)) evidenceImages.push({ targetId: target.id, role, path: imagePath });
      }
    }
  }
  if (evidenceImages.length > budget.maximumImages) {
    throw new Error(`Context image count ${evidenceImages.length} exceeds budget ${budget.maximumImages}; reduce targets or increase --max-images explicitly`);
  }
  const packet = {
    kind: 'visual-context-packet', schemaVersion: '1.0', phase: state.phase, iteration: state.iteration,
    goal: goalFor(state.phase),
    invariants: [
      'do not read scripts or unrelated historical reports',
      'treat canonicalArtifacts as paths; open only files explicitly needed by this phase',
      'do not change viewport, crop, fixture, acceptance profile or sandbox boundary during repair',
      'modify only allowedFiles'
    ],
    allowedFiles: state.phase === 'generation' || state.phase === 'repair'
      ? ['visual-lab/src/visual-fixture.json', 'visual-lab/src/generated-ui.js', 'visual-lab/src/generated-ui.css'] : [],
    canonicalArtifacts: canonicalEntries(options.stateFile, state),
    activeTargets: targets,
    evidenceImages,
    previousDelta: previousDelta ? {
      iteration: previousDelta.iteration, resolved: previousDelta.resolved, remaining: previousDelta.remaining,
      regressions: previousDelta.regressions, nextRepair: previousDelta.nextRepair, gate: previousDelta.gate
    } : null
  };
  const estimatedTextTokens = Math.ceil(JSON.stringify(packet).length / 3);
  packet.budget = {
    estimatedTextTokens, imageCount: evidenceImages.length, targetCount: targets.length, ...budget,
    passed: estimatedTextTokens <= budget.maximumTextTokens
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(packet, null, 2)}\n`);
  if (!packet.budget.passed) throw new Error(`Context packet estimates ${estimatedTextTokens} text tokens, above budget ${budget.maximumTextTokens}`);
  printResult(packet, reportSummary('visual-context-packet', 'ready', options.output, {
    phase: packet.phase, targetCount: targets.length, imageCount: evidenceImages.length, estimatedTextTokens
  }), { verbose: options.verbose });
} catch (error) {
  console.error(JSON.stringify({ kind: 'visual-context-packet-error', error: error.message, report: options?.output ?? null }));
  process.exit(1);
}
