#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-fidelity-loop-'));

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

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return output;
}

function makePng(width, height, pixelAt) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const rgba = pixelAt(x, y);
      const offset = row + 1 + x * 4;
      raw[offset] = rgba[0];
      raw[offset + 1] = rgba[1];
      raw[offset + 2] = rgba[2];
      raw[offset + 3] = rgba[3];
    }
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function run(script, args) {
  return spawnSync(process.execPath, [path.join(scriptDir, script), ...args], { encoding: 'utf8' });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

try {
  for (const file of [
    'source-manifest.template.json',
    'visual-lab-source-manifest.template.json',
    'data-fixture-contract.template.json',
    'data-fixture-lock.template.json',
    'capture-observation.template.json',
    'visual-lab-capture-observation.template.json',
    'alignment-report.template.json',
    'visual-contract.template.json',
    'component-adaptation.template.json',
    'visual-acceptance-policy.template.json',
    'visual-evaluation.template.json',
    'visual-lab-lock.template.json',
    'visual-lab-acceptance.template.json',
    'visual-lab/vanilla-vite/visual-lab.json',
    'iteration-report.template.json',
    'run-state.template.json',
    'context-packet.template.json',
    'iteration-delta.template.json',
    'visual-acceptance.template.json'
  ]) {
    const result = run('validate-artifacts.mjs', [path.join(skillDir, 'assets', file)]);
    assert.equal(result.status, 0, `${file} should validate:\n${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).valid, true);
  }

  const visualLabDirectory = path.join(tempDir, 'visual-lab');
  const createLab = run('create-visual-lab.mjs', [visualLabDirectory, '--lab-id', 'users-page']);
  assert.equal(createLab.status, 0, createLab.stderr);
  assert.equal(JSON.parse(createLab.stdout).labId, 'users-page');
  assert.equal(fs.existsSync(path.join(visualLabDirectory, 'index.html')), true);
  assert.equal(fs.existsSync(path.join(visualLabDirectory, 'src', 'visual-fixture.json')), true);
  const createdManifest = JSON.parse(fs.readFileSync(path.join(visualLabDirectory, 'visual-lab.json'), 'utf8'));
  assert.equal(createdManifest.boundary.targetProjectRead, false);
  assert.equal(createdManifest.boundary.targetProjectModified, false);
  const validateLab = run('validate-visual-lab.mjs', [visualLabDirectory]);
  assert.equal(validateLab.status, 0, validateLab.stdout || validateLab.stderr);
  assert.equal(JSON.parse(validateLab.stdout).valid, true);
  for (const file of ['main.js', 'generated-ui.js']) {
    const syntax = spawnSync(process.execPath, ['--check', path.join(visualLabDirectory, 'src', file)], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  const visualLabLockFile = path.join(tempDir, 'visual-lab-lock.json');
  const sealLab = run('seal-visual-lab.mjs', [visualLabDirectory, '--output', visualLabLockFile]);
  assert.equal(sealLab.status, 0, sealLab.stderr);
  const sealLabSummary = JSON.parse(sealLab.stdout);
  assert.equal(sealLabSummary.kind, 'visual-lab-lock-summary');
  const visualLabLock = readJson(visualLabLockFile);
  assert.equal(visualLabLock.status, 'sealed');
  assert.equal(visualLabLock.executionScope, 'sandbox-only');
  assert.equal(visualLabLock.files.length, createdManifest.sourceFiles.length);
  const validateLabLock = run('validate-artifacts.mjs', [visualLabLockFile]);
  assert.equal(validateLabLock.status, 0, validateLabLock.stdout);

  const visualLabLockSha256 = crypto.createHash('sha256').update(fs.readFileSync(visualLabLockFile)).digest('hex');
  assert.equal(sealLabSummary.lockFileSha256, visualLabLockSha256);
  const visualLabSourceManifest = JSON.parse(fs.readFileSync(path.join(skillDir, 'assets', 'visual-lab-source-manifest.template.json'), 'utf8'));
  visualLabSourceManifest.visualLab.expectedLabId = 'users-page';
  visualLabSourceManifest.visualLab.expectedLockSha256 = visualLabLockSha256;
  const visualLabSourceManifestFile = path.join(tempDir, 'visual-lab-source-manifest.json');
  fs.writeFileSync(visualLabSourceManifestFile, JSON.stringify(visualLabSourceManifest));
  const visualLabObservation = JSON.parse(fs.readFileSync(path.join(skillDir, 'assets', 'visual-lab-capture-observation.template.json'), 'utf8'));
  visualLabObservation.visualLabReadiness.labId = 'users-page';
  visualLabObservation.visualLabReadiness.lockSha256 = visualLabLockSha256;
  const visualLabObservationFile = path.join(tempDir, 'visual-lab-capture-observation.json');
  fs.writeFileSync(visualLabObservationFile, JSON.stringify(visualLabObservation));
  const visualLabAlignmentFile = path.join(tempDir, 'visual-lab-alignment.json');
  const visualLabAlignment = run('build-alignment-report.mjs', [
    visualLabSourceManifestFile,
    visualLabObservationFile,
    '--output', visualLabAlignmentFile
  ]);
  assert.equal(visualLabAlignment.status, 0, visualLabAlignment.stderr || visualLabAlignment.stdout);
  const visualLabAlignmentReport = readJson(visualLabAlignmentFile);
  assert.equal(visualLabAlignmentReport.checks.visualLabLockVerified, true);
  assert.equal(visualLabAlignmentReport.checks.visualLabFilesMatched, true);
  assert.equal(visualLabAlignmentReport.checks.visualLabObservationMatched, true);

  fs.appendFileSync(path.join(visualLabDirectory, 'src', 'generated-ui.js'), '\nfetch("/api/users");\n');
  const networkLab = run('validate-visual-lab.mjs', [visualLabDirectory]);
  assert.equal(networkLab.status, 1);
  assert.match(networkLab.stdout, /fetch is forbidden/);
  const changedLabAlignmentFile = path.join(tempDir, 'changed-lab-alignment.json');
  const changedLabAlignment = run('build-alignment-report.mjs', [
    visualLabSourceManifestFile,
    visualLabObservationFile,
    '--output', changedLabAlignmentFile
  ]);
  assert.equal(changedLabAlignment.status, 1);
  assert.equal(readJson(changedLabAlignmentFile).checks.visualLabFilesMatched, false);

  const invalidLabAcceptance = JSON.parse(fs.readFileSync(path.join(skillDir, 'assets', 'visual-lab-acceptance.template.json'), 'utf8'));
  invalidLabAcceptance.boundary.targetProjectModified = true;
  const invalidLabAcceptanceFile = path.join(tempDir, 'invalid-lab-acceptance.json');
  fs.writeFileSync(invalidLabAcceptanceFile, JSON.stringify(invalidLabAcceptance));
  const invalidLabAcceptanceResult = run('validate-artifacts.mjs', [invalidLabAcceptanceFile]);
  assert.equal(invalidLabAcceptanceResult.status, 1);
  assert.match(invalidLabAcceptanceResult.stdout, /sandbox-only version/);

  const invalid = JSON.parse(fs.readFileSync(path.join(skillDir, 'assets', 'component-adaptation.template.json'), 'utf8'));
  invalid.mappings[0].styleCompatibility = 0.2;
  invalid.mappings[0].decision = 'use-library-as-is';
  const invalidFile = path.join(tempDir, 'invalid-adaptation.json');
  fs.writeFileSync(invalidFile, JSON.stringify(invalid));
  const invalidResult = run('validate-artifacts.mjs', [invalidFile]);
  assert.equal(invalidResult.status, 1);
  assert.match(invalidResult.stdout, /cannot use library as-is/);

  const invalidScope = JSON.parse(fs.readFileSync(path.join(skillDir, 'assets', 'source-manifest.template.json'), 'utf8'));
  invalidScope.comparisonScope.actual.captureMode = 'viewport';
  const invalidScopeFile = path.join(tempDir, 'invalid-scope.json');
  fs.writeFileSync(invalidScopeFile, JSON.stringify(invalidScope));
  const invalidScopeResult = run('validate-artifacts.mjs', [invalidScopeFile]);
  assert.equal(invalidScopeResult.status, 1);
  assert.match(invalidScopeResult.stdout, /must not use a full viewport capture/);

  const oversizedMask = JSON.parse(fs.readFileSync(path.join(skillDir, 'assets', 'source-manifest.template.json'), 'utf8'));
  oversizedMask.comparisonScope.masks.push({
    id: 'header-mask',
    reason: 'user-approved',
    bbox: { x: 0, y: 0, width: 1200, height: 100 },
    evidence: 'attempted whole header exclusion'
  });
  const oversizedMaskFile = path.join(tempDir, 'oversized-mask.json');
  fs.writeFileSync(oversizedMaskFile, JSON.stringify(oversizedMask));
  const oversizedMaskResult = run('validate-artifacts.mjs', [oversizedMaskFile]);
  assert.equal(oversizedMaskResult.status, 1);
  assert.match(oversizedMaskResult.stdout, /masked area ratio/);

  const referenceFile = path.join(tempDir, 'reference.png');
  const actualFile = path.join(tempDir, 'actual.png');
  const mismatchFile = path.join(tempDir, 'mismatch.png');
  const reportFile = path.join(tempDir, 'report.json');
  const diffFile = path.join(tempDir, 'diff.png');
  const alignmentFile = path.join(tempDir, 'alignment.json');
  const policyFile = path.join(skillDir, 'assets', 'visual-acceptance-policy.template.json');
  fs.writeFileSync(referenceFile, makePng(4, 4, () => [255, 255, 255, 255]));
  fs.writeFileSync(actualFile, makePng(4, 4, (x, y) => x === 1 && y === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  fs.writeFileSync(mismatchFile, makePng(3, 4, () => [255, 255, 255, 255]));
  const regionsFile = path.join(tempDir, 'regions.json');
  fs.writeFileSync(regionsFile, JSON.stringify({
    kind: 'visual-contract',
    schemaVersion: '1.0',
    source: { crop: { x: 0, y: 0, width: 4, height: 4 } },
    regions: [{
      id: 'critical',
      criticality: 'critical',
      bbox: { x: 0, y: 0, width: 4, height: 4 },
      elements: [{ id: 'title', required: true, content: 'Title', typography: null, bbox: { x: 0, y: 0, width: 4, height: 4 } }]
    }]
  }));
  const alignment = {
    kind: 'alignment-report',
    schemaVersion: '1.0',
    sourceManifest: '00-source-manifest.json',
    scopeType: 'page-content',
    reference: {
      path: referenceFile,
      crop: { x: 0, y: 0, width: 4, height: 4 },
      canvasWidth: 4,
      canvasHeight: 4
    },
    actual: {
      path: actualFile,
      debugViewportScreenshot: 'debug.png',
      captureMode: 'locator',
      selector: "[data-visual-id='content-root']",
      box: 'border-box',
      bboxInViewport: { x: 2, y: 1, width: 4, height: 4 },
      canvasWidth: 4,
      canvasHeight: 4,
      viewport: { width: 6, height: 5 },
      dpr: 1,
      applicationShellPresent: true
    },
    checks: {
      scopeConfirmed: true,
      targetResolved: true,
      captureContractMatched: true,
      applicationShellPreserved: true,
      sizeMatched: true,
      originNormalized: true,
      cropMatched: true,
      stateMatched: true,
      fontsReady: true,
      assetsReady: true,
      fixtureLockVerified: true,
      fixtureSetMatched: true,
      expectedRequestsMatched: true,
      noUnmatchedBusinessRequests: true,
      runtimeDeterministic: true,
      visibleDataMatched: true,
      dataSettled: true,
      visualLabLockVerified: true,
      visualLabFilesMatched: true,
      visualLabObservationMatched: true,
      visualLabBoundaryPreserved: true,
      captureMutationsLayoutSafe: true
    },
    dataFixture: {
      required: true,
      fixtureSetId: 'users-table-default-v1',
      fixtureSetDigest: 'd0fcf0eaa6fba4c77558fe5d1b1c1c1ac6b34d8e7f5bf637d4fde171302feb95',
      contract: '00-data-fixture-contract.json',
      lock: '00-data-fixture-lock.json',
      lockErrors: [],
      requestResults: [],
      unmatchedBusinessRequests: [],
      runtimeResults: [],
      visibleAssertionResults: []
    },
    visualLab: {
      required: false,
      labId: null,
      root: null,
      lock: null,
      lockSha256: null,
      lockErrors: [],
      fileResults: [],
      externalNetworkRequests: []
    },
    anchors: [],
    measurementSpace: { origin: 'comparison-canvas', units: 'image-px', dprApplied: true },
    visualMeasurements: ['critical', 'title'].map((id) => ({
      id,
      type: id === 'critical' ? 'region' : 'element',
      selector: `[data-visual-id='${id}']`,
      present: true,
      visible: true,
      contentMatched: true,
      stateMatched: true,
      state: 'default',
      bbox: { x: 0, y: 0, width: 4, height: 4 },
      overflow: { x: false, y: false, clipped: false },
      occlusion: { ratio: 0, blockers: [] },
      computedStyle: null
    })),
    captureOnlyMutations: [],
    tolerance: 1,
    status: 'pass',
    blockers: []
  };
  fs.writeFileSync(alignmentFile, JSON.stringify(alignment));

  const smallManifest = JSON.parse(fs.readFileSync(path.join(skillDir, 'assets', 'source-manifest.template.json'), 'utf8'));
  smallManifest.reference.path = referenceFile;
  smallManifest.reference.imageWidth = 4;
  smallManifest.reference.imageHeight = 4;
  smallManifest.reference.crop = { x: 0, y: 0, width: 4, height: 4 };
  smallManifest.render.viewport = { width: 6, height: 5 };
  const fixtureDir = path.join(tempDir, 'fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixtureContractFile = path.join(tempDir, '00-data-fixture-contract.json');
  const fixtureLockFile = path.join(tempDir, '00-data-fixture-lock.json');
  const fixtureResponseFile = path.join(fixtureDir, 'users-table-default.response.json');
  fs.copyFileSync(path.join(skillDir, 'assets', 'data-fixture-contract.template.json'), fixtureContractFile);
  fs.copyFileSync(path.join(skillDir, 'assets', 'fixtures', 'users-table-default.response.json'), fixtureResponseFile);
  const sealFixture = run('seal-data-fixtures.mjs', [fixtureContractFile, '--output', fixtureLockFile]);
  assert.equal(sealFixture.status, 0, sealFixture.stderr);
  assert.equal(JSON.parse(sealFixture.stdout).fixtureSetDigest, smallManifest.dataFixture.expectedFixtureSetDigest);
  const smallManifestFile = path.join(tempDir, 'source-manifest.json');
  fs.writeFileSync(smallManifestFile, JSON.stringify(smallManifest));
  const observation = {
    kind: 'capture-observation',
    schemaVersion: '1.0',
    actual: alignment.actual,
    readiness: {
      targetResolved: true,
      originNormalized: true,
      cropMatched: true,
      stateMatched: true,
      fontsReady: true,
      assetsReady: true
    },
    dataReadiness: JSON.parse(fs.readFileSync(path.join(skillDir, 'assets', 'capture-observation.template.json'), 'utf8')).dataReadiness,
    measurementSpace: alignment.measurementSpace,
    visualMeasurements: alignment.visualMeasurements,
    anchors: [],
    captureOnlyMutations: [],
    blockers: []
  };
  const observationFile = path.join(tempDir, 'capture-observation.json');
  fs.writeFileSync(observationFile, JSON.stringify(observation));
  const builtAlignmentFile = path.join(tempDir, 'built-alignment.json');
  const buildAlignment = run('build-alignment-report.mjs', [smallManifestFile, observationFile, '--output', builtAlignmentFile]);
  assert.equal(buildAlignment.status, 0, buildAlignment.stderr);
  assert.equal(JSON.parse(buildAlignment.stdout).kind, 'alignment-report-summary');
  assert.equal(readJson(builtAlignmentFile).status, 'pass');
  assert.equal(fs.existsSync(builtAlignmentFile), true);

  const randomResponseObservation = JSON.parse(JSON.stringify(observation));
  randomResponseObservation.dataReadiness.requestMatches[0].responseSha256 = '0'.repeat(64);
  const randomResponseFile = path.join(tempDir, 'random-response-observation.json');
  const randomResponseReportFile = path.join(tempDir, 'random-response-alignment.json');
  fs.writeFileSync(randomResponseFile, JSON.stringify(randomResponseObservation));
  const randomResponse = run('build-alignment-report.mjs', [smallManifestFile, randomResponseFile, '--output', randomResponseReportFile]);
  assert.equal(randomResponse.status, 1);
  assert.match(randomResponse.stdout, /response hashes did not match/);

  const escapedRequestObservation = JSON.parse(JSON.stringify(observation));
  escapedRequestObservation.dataReadiness.unmatchedBusinessRequests.push({ method: 'GET', url: '/api/live-users' });
  const escapedRequestFile = path.join(tempDir, 'escaped-request-observation.json');
  const escapedRequestReportFile = path.join(tempDir, 'escaped-request-alignment.json');
  fs.writeFileSync(escapedRequestFile, JSON.stringify(escapedRequestObservation));
  const escapedRequest = run('build-alignment-report.mjs', [smallManifestFile, escapedRequestFile, '--output', escapedRequestReportFile]);
  assert.equal(escapedRequest.status, 1);
  assert.match(escapedRequest.stdout, /escaped the fixture contract/);

  const randomRowsObservation = JSON.parse(JSON.stringify(observation));
  randomRowsObservation.dataReadiness.visibleAssertions[0].actual = 5;
  const randomRowsFile = path.join(tempDir, 'random-rows-observation.json');
  const randomRowsReportFile = path.join(tempDir, 'random-rows-alignment.json');
  fs.writeFileSync(randomRowsFile, JSON.stringify(randomRowsObservation));
  const randomRows = run('build-alignment-report.mjs', [smallManifestFile, randomRowsFile, '--output', randomRowsReportFile]);
  assert.equal(randomRows.status, 1);
  assert.match(randomRows.stdout, /visible table\/list data assertions did not match/);

  fs.appendFileSync(fixtureResponseFile, ' ');
  const tamperedFixtureReportFile = path.join(tempDir, 'tampered-fixture-alignment.json');
  const tamperedFixture = run('build-alignment-report.mjs', [smallManifestFile, observationFile, '--output', tamperedFixtureReportFile]);
  assert.equal(tamperedFixture.status, 1);
  assert.match(tamperedFixture.stdout, /do not match the sealed lock/);
  fs.copyFileSync(path.join(skillDir, 'assets', 'fixtures', 'users-table-default.response.json'), fixtureResponseFile);

  const shellMissingObservation = JSON.parse(JSON.stringify(observation));
  shellMissingObservation.actual.applicationShellPresent = false;
  const shellMissingFile = path.join(tempDir, 'shell-missing-observation.json');
  const shellMissingReportFile = path.join(tempDir, 'shell-missing-alignment.json');
  fs.writeFileSync(shellMissingFile, JSON.stringify(shellMissingObservation));
  const shellMissing = run('build-alignment-report.mjs', [smallManifestFile, shellMissingFile, '--output', shellMissingReportFile]);
  assert.equal(shellMissing.status, 1);
  assert.equal(readJson(shellMissingReportFile).status, 'blocked');
  assert.match(shellMissing.stdout, /application shell required for layout was not preserved/);
  const invalidAlignment = JSON.parse(JSON.stringify(alignment));
  invalidAlignment.actual.canvasWidth = 3;
  const invalidAlignmentFile = path.join(tempDir, 'invalid-alignment.json');
  fs.writeFileSync(invalidAlignmentFile, JSON.stringify(invalidAlignment));
  const invalidAlignmentResult = run('validate-artifacts.mjs', [invalidAlignmentFile]);
  assert.equal(invalidAlignmentResult.status, 1);
  assert.match(invalidAlignmentResult.stdout, /must exactly match reference canvas width/);

  const unsafeMutation = JSON.parse(JSON.stringify(alignment));
  unsafeMutation.checks.captureMutationsLayoutSafe = false;
  unsafeMutation.captureOnlyMutations.push({
    selector: '.fixed-header',
    property: 'visibility',
    value: 'hidden',
    reason: 'fixed overlay outside comparison scope',
    targetBboxBefore: { x: 2, y: 1, width: 4, height: 4 },
    targetBboxAfter: { x: 2, y: 2, width: 4, height: 4 },
    layoutDelta: 1,
    passed: false
  });
  const unsafeMutationFile = path.join(tempDir, 'unsafe-mutation.json');
  fs.writeFileSync(unsafeMutationFile, JSON.stringify(unsafeMutation));
  const unsafeMutationResult = run('validate-artifacts.mjs', [unsafeMutationFile]);
  assert.equal(unsafeMutationResult.status, 1);
  assert.match(unsafeMutationResult.stdout, /captureMutationsLayoutSafe/);

  const evidenceDirectory = path.join(tempDir, 'evidence');
  const compare = run('compare-png.mjs', [
    referenceFile,
    actualFile,
    '--alignment-report', builtAlignmentFile,
    '--acceptance-policy', policyFile,
    '--regions', regionsFile,
    '--output', reportFile,
    '--diff', diffFile,
    '--evidence-dir', evidenceDirectory
  ]);
  assert.equal(compare.status, 0, compare.stderr);
  assert.equal(JSON.parse(compare.stdout).kind, 'pixel-report-summary');
  const report = readJson(reportFile);
  assert.equal(report.global.differingPixels, 1);
  assert.equal(report.global.differentPixelRatio, 0.0625);
  assert.equal(report.global.meanAbsoluteError, 0.0625);
  assert.equal(report.regions[0].metrics.differentPixelRatio, 0.0625);
  assert.equal(report.rawPixel.role, 'diagnostic-only');
  assert.equal(report.rawPixel.passedThresholds, false);
  assert.equal(report.perceptual.passedThresholds, true);
  assert.equal(report.gate.status, 'pass');
  assert.equal(fs.existsSync(reportFile), true);
  assert.equal(fs.existsSync(diffFile), true);
  assert.equal(fs.existsSync(report.regions[0].evidence.reference), true);
  assert.equal(fs.existsSync(report.regions[0].evidence.actual), true);
  assert.equal(fs.existsSync(report.regions[0].evidence.diff), true);

  const adaptationFile = path.join(tempDir, 'component-adaptation.json');
  const adaptation = JSON.parse(fs.readFileSync(path.join(skillDir, 'assets', 'component-adaptation.template.json'), 'utf8'));
  adaptation.mappings[0].elementId = 'title';
  fs.writeFileSync(adaptationFile, JSON.stringify(adaptation));
  const evaluationFile = path.join(tempDir, 'visual-evaluation.json');
  const evaluation = run('evaluate-visual-acceptance.mjs', [
    policyFile,
    regionsFile,
    adaptationFile,
    builtAlignmentFile,
    reportFile,
    '--output', evaluationFile
  ]);
  assert.equal(evaluation.status, 0, evaluation.stderr || evaluation.stdout);
  assert.equal(JSON.parse(evaluation.stdout).kind, 'visual-evaluation-summary');
  const evaluationReport = readJson(evaluationFile);
  assert.equal(evaluationReport.status, 'pass');
  assert.equal(evaluationReport.diagnostics.rawPixelRole, 'diagnostic-only');
  assert.equal(evaluationReport.diagnostics.rawPixelThresholdsPassed, false);
  assert.equal(evaluationReport.hardGates.noOverflowOrOcclusion, true);
  const evaluationValidation = run('validate-artifacts.mjs', [evaluationFile]);
  assert.equal(evaluationValidation.status, 0, evaluationValidation.stdout);

  const overflowAlignment = JSON.parse(fs.readFileSync(builtAlignmentFile, 'utf8'));
  overflowAlignment.visualMeasurements.find((item) => item.id === 'title').overflow.clipped = true;
  const overflowAlignmentFile = path.join(tempDir, 'overflow-alignment.json');
  fs.writeFileSync(overflowAlignmentFile, JSON.stringify(overflowAlignment));
  const overflowEvaluationFile = path.join(tempDir, 'overflow-evaluation.json');
  const overflowEvaluation = run('evaluate-visual-acceptance.mjs', [
    policyFile,
    regionsFile,
    adaptationFile,
    overflowAlignmentFile,
    reportFile,
    '--output', overflowEvaluationFile
  ]);
  assert.equal(overflowEvaluation.status, 1);
  assert.equal(readJson(overflowEvaluationFile).hardGates.noOverflowOrOcclusion, false);

  const pixelFaithfulReportFile = path.join(tempDir, 'pixel-faithful-report.json');
  const pixelFaithfulCompare = run('compare-png.mjs', [
    referenceFile,
    actualFile,
    '--alignment-report', builtAlignmentFile,
    '--acceptance-policy', policyFile,
    '--profile', 'pixel-faithful',
    '--regions', regionsFile,
    '--output', pixelFaithfulReportFile
  ]);
  assert.equal(pixelFaithfulCompare.status, 0, pixelFaithfulCompare.stderr);
  assert.equal(readJson(pixelFaithfulReportFile).gate.status, 'needs-review');
  const pixelFaithfulEvaluationFile = path.join(tempDir, 'pixel-faithful-evaluation.json');
  const pixelFaithfulEvaluation = run('evaluate-visual-acceptance.mjs', [
    policyFile,
    regionsFile,
    adaptationFile,
    builtAlignmentFile,
    pixelFaithfulReportFile,
    '--profile', 'pixel-faithful',
    '--output', pixelFaithfulEvaluationFile
  ]);
  assert.equal(pixelFaithfulEvaluation.status, 1);
  assert.equal(readJson(pixelFaithfulEvaluationFile).status, 'needs-repair');

  const maskedAlignment = JSON.parse(fs.readFileSync(builtAlignmentFile, 'utf8'));
  maskedAlignment.maskPolicy.allowOverLimit = true;
  maskedAlignment.masks.push({
    id: 'dynamic-pixel',
    reason: 'user-approved',
    bbox: { x: 1, y: 1, width: 1, height: 1 },
    evidence: 'synthetic test fixture'
  });
  const maskedAlignmentFile = path.join(tempDir, 'masked-alignment.json');
  fs.writeFileSync(maskedAlignmentFile, JSON.stringify(maskedAlignment));
  const maskedReportFile = path.join(tempDir, 'masked-report.json');
  const maskedCompare = run('compare-png.mjs', [referenceFile, actualFile, '--alignment-report', maskedAlignmentFile, '--acceptance-policy', policyFile, '--output', maskedReportFile]);
  assert.equal(maskedCompare.status, 0, maskedCompare.stderr);
  const maskedReport = readJson(maskedReportFile);
  assert.equal(maskedReport.global.maskedPixels, 1);
  assert.equal(maskedReport.global.evaluatedPixels, 15);
  assert.equal(maskedReport.global.differingPixels, 0);
  assert.equal(maskedReport.gate.status, 'pass');

  const identicalFile = path.join(tempDir, 'identical-report.json');
  const identical = run('compare-png.mjs', [referenceFile, referenceFile, '--alignment-report', alignmentFile, '--acceptance-policy', policyFile, '--output', identicalFile]);
  assert.equal(identical.status, 0, identical.stderr);
  assert.equal(readJson(identicalFile).gate.status, 'pass');

  const noAlignment = run('compare-png.mjs', [referenceFile, actualFile]);
  assert.equal(noAlignment.status, 1);
  assert.match(noAlignment.stderr, /--alignment-report is required/);

  const noPolicy = run('compare-png.mjs', [referenceFile, actualFile, '--alignment-report', alignmentFile]);
  assert.equal(noPolicy.status, 1);
  assert.match(noPolicy.stderr, /--acceptance-policy is required/);

  const blockedAlignment = { ...alignment, status: 'blocked', blockers: ['scope unresolved'] };
  const blockedAlignmentFile = path.join(tempDir, 'blocked-alignment.json');
  fs.writeFileSync(blockedAlignmentFile, JSON.stringify(blockedAlignment));
  const blocked = run('compare-png.mjs', [referenceFile, actualFile, '--alignment-report', blockedAlignmentFile, '--acceptance-policy', policyFile]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /status is blocked/);

  const mismatchAlignment = JSON.parse(JSON.stringify(alignment));
  mismatchAlignment.actual.path = mismatchFile;
  mismatchAlignment.actual.canvasWidth = 3;
  const mismatchAlignmentFile = path.join(tempDir, 'mismatch-alignment.json');
  fs.writeFileSync(mismatchAlignmentFile, JSON.stringify(mismatchAlignment));
  const mismatch = run('compare-png.mjs', [referenceFile, mismatchFile, '--alignment-report', mismatchAlignmentFile, '--acceptance-policy', policyFile]);
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /reference and actual canvas dimensions differ/);

  const contextRoot = path.join(tempDir, 'context-root');
  const contextIteration = path.join(contextRoot, 'iterations', 'iteration-01');
  fs.mkdirSync(contextIteration, { recursive: true });
  fs.copyFileSync(referenceFile, path.join(contextRoot, 'reference.png'));
  fs.copyFileSync(smallManifestFile, path.join(contextRoot, '00-source-manifest.json'));
  fs.copyFileSync(regionsFile, path.join(contextRoot, '01-visual-contract.json'));
  fs.copyFileSync(adaptationFile, path.join(contextRoot, '02-component-adaptation.json'));
  fs.copyFileSync(policyFile, path.join(contextRoot, 'visual-acceptance-policy.json'));
  fs.cpSync(visualLabDirectory, path.join(contextRoot, 'visual-lab'), { recursive: true });
  fs.copyFileSync(visualLabLockFile, path.join(contextRoot, 'visual-lab-lock.json'));
  fs.copyFileSync(builtAlignmentFile, path.join(contextIteration, 'alignment-report.json'));
  fs.copyFileSync(reportFile, path.join(contextIteration, 'pixel-report.json'));
  const repairEvaluation = JSON.parse(JSON.stringify(evaluationReport));
  repairEvaluation.status = 'needs-repair';
  repairEvaluation.targets[0].passed = false;
  fs.writeFileSync(path.join(contextIteration, 'visual-evaluation.json'), JSON.stringify(repairEvaluation));
  const delta = readJson(path.join(skillDir, 'assets', 'iteration-delta.template.json'));
  delta.activeTargets = [repairEvaluation.targets[0].id];
  delta.remaining[0].targetId = repairEvaluation.targets[0].id;
  delta.nextRepair.targetIds = [repairEvaluation.targets[0].id];
  fs.writeFileSync(path.join(contextIteration, 'iteration-delta.json'), JSON.stringify(delta));

  const runStateFile = path.join(contextRoot, 'run-state.json');
  const runStateResult = run('build-run-state.mjs', [contextRoot, '--phase', 'repair', '--iteration', '1', '--output', runStateFile]);
  assert.equal(runStateResult.status, 0, runStateResult.stderr || runStateResult.stdout);
  assert.equal(JSON.parse(runStateResult.stdout).kind, 'visual-run-state-summary');
  assert.deepEqual(readJson(runStateFile).activeTargets, [repairEvaluation.targets[0].id]);
  assert.equal(run('validate-artifacts.mjs', [runStateFile]).status, 0);

  const contextPacketFile = path.join(contextRoot, 'context-packet.json');
  const contextPacketResult = run('build-context-packet.mjs', [runStateFile, '--output', contextPacketFile]);
  assert.equal(contextPacketResult.status, 0, contextPacketResult.stderr || contextPacketResult.stdout);
  const packetSummary = JSON.parse(contextPacketResult.stdout);
  const packet = readJson(contextPacketFile);
  assert.equal(packetSummary.kind, 'visual-context-packet-summary');
  assert.equal(packet.activeTargets.length, 1);
  assert.equal(packet.evidenceImages.length, 3);
  assert.equal(packet.budget.passed, true);
  assert.equal(run('validate-artifacts.mjs', [contextPacketFile]).status, 0);
  const overBudget = run('build-context-packet.mjs', [runStateFile, '--output', path.join(contextRoot, 'over-budget.json'), '--max-targets', '0']);
  assert.equal(overBudget.status, 1);
  assert.match(overBudget.stderr, /exceeds budget/);

  assert.ok(compare.stdout.length < fs.readFileSync(reportFile, 'utf8').length, 'default CLI output should be smaller than the canonical report');

  console.log('All frontend-visual-fidelity-loop script tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
