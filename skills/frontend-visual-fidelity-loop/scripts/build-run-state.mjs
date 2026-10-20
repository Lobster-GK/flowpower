#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { printResult, reportSummary } from './cli-output.mjs';

const phases = new Set(['contract', 'generation', 'capture', 'repair', 'acceptance', 'complete', 'blocked']);

function usage(exitCode = 0) {
  console.error('Usage: node build-run-state.mjs <artifact-root> --phase <phase> --iteration <n> --output <run-state.json> [--profile <name>] [--verbose]');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const positional = [];
  const options = { iteration: 0, profile: 'component-faithful', verbose: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') usage(0);
    if (arg === '--verbose') { options.verbose = true; continue; }
    if (['--phase', '--iteration', '--output', '--profile'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1 || !options.phase || !options.output) usage(2);
  options.iteration = Number(options.iteration);
  if (!Number.isInteger(options.iteration) || options.iteration < 0) throw new Error('--iteration must be a non-negative integer');
  if (!phases.has(options.phase)) throw new Error(`Unsupported phase: ${options.phase}`);
  return { artifactRoot: path.resolve(positional[0]), ...options, output: path.resolve(options.output) };
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function sha256(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile()
    ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    : null;
}

function relative(root, file) {
  return file && fs.existsSync(file) ? path.relative(root, file).replaceAll('\\', '/') : null;
}

function iterationDirectory(root, iteration) {
  const candidates = [
    path.join(root, 'iterations', `iteration-${String(iteration).padStart(2, '0')}`),
    path.join(root, 'iterations', `iteration-${iteration}`)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function budgetFor(phase) {
  if (phase === 'contract') return { maximumTextTokens: 16000, maximumImages: 1, maximumTargets: 0 };
  if (phase === 'generation') return { maximumTextTokens: 24000, maximumImages: 1, maximumTargets: 60 };
  if (phase === 'repair') return { maximumTextTokens: 12000, maximumImages: 3, maximumTargets: 1 };
  return { maximumTextTokens: 10000, maximumImages: 3, maximumTargets: 3 };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const iterationRoot = iterationDirectory(options.artifactRoot, options.iteration);
  const files = {
    reference: path.join(options.artifactRoot, 'reference.png'),
    sourceManifest: path.join(options.artifactRoot, '00-source-manifest.json'),
    visualContract: path.join(options.artifactRoot, '01-visual-contract.json'),
    renderPlan: path.join(options.artifactRoot, '02-component-adaptation.json'),
    acceptancePolicy: path.join(options.artifactRoot, 'visual-acceptance-policy.json'),
    visualLab: path.join(options.artifactRoot, 'visual-lab'),
    visualLabLock: path.join(options.artifactRoot, 'visual-lab-lock.json'),
    alignmentReport: path.join(iterationRoot, 'alignment-report.json'),
    pixelReport: path.join(iterationRoot, 'pixel-report.json'),
    visualEvaluation: path.join(iterationRoot, 'visual-evaluation.json'),
    iterationDelta: path.join(iterationRoot, 'iteration-delta.json')
  };
  const alignment = readJsonIfExists(files.alignmentReport);
  const evaluation = readJsonIfExists(files.visualEvaluation);
  const labLock = readJsonIfExists(files.visualLabLock);
  const budget = budgetFor(options.phase);
  const failedTargets = evaluation?.targets
    ?.filter((target) => target.passed !== true)
    .sort((left, right) => {
      const rank = { critical: 0, important: 1, normal: 2 };
      return (rank[left.criticality] ?? 3) - (rank[right.criticality] ?? 3) || (left.score ?? 1) - (right.score ?? 1);
    })
    .map((target) => target.id) ?? [];
  const activeTargets = failedTargets.slice(0, budget.maximumTargets);
  const nextActions = {
    contract: 'build-visual-contract', generation: 'generate-visual-lab-ui', capture: 'capture-visual-lab',
    repair: 'repair-active-target', acceptance: 'review-and-accept', complete: 'stop', blocked: 'resolve-blocker'
  };
  const state = {
    kind: 'visual-run-state', schemaVersion: '1.0', phase: options.phase, iteration: options.iteration,
    artifactRoot: '.', profile: options.profile,
    artifacts: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, key === 'visualLab' ? relative(options.artifactRoot, file) ?? 'visual-lab' : relative(options.artifactRoot, file)])),
    digests: Object.fromEntries(Object.entries(files).filter(([, file]) => fs.existsSync(file) && fs.statSync(file).isFile()).map(([key, file]) => [key, sha256(file)])),
    activeTargets,
    gates: {
      visualLab: labLock?.status === 'sealed' ? 'pass' : 'pending',
      alignment: alignment?.status ?? 'pending',
      visualEvaluation: evaluation?.status ?? 'pending'
    },
    failureSummary: { total: failedTargets.length, deferred: Math.max(0, failedTargets.length - activeTargets.length) },
    budget,
    nextAction: nextActions[options.phase]
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(state, null, 2)}\n`);
  printResult(state, reportSummary('visual-run-state', 'ready', options.output, {
    phase: state.phase, iteration: state.iteration, activeTargetCount: activeTargets.length,
    deferredTargetCount: state.failureSummary.deferred, nextAction: state.nextAction
  }), { verbose: options.verbose });
} catch (error) {
  console.error(JSON.stringify({ kind: 'visual-run-state-error', error: error.message }));
  process.exit(1);
}
