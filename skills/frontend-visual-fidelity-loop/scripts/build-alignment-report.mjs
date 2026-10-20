#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, verifyFixtureLock } from './fixture-integrity.mjs';
import { resolveInside, sha256File, validateVisualLab } from './visual-lab-integrity.mjs';
import { compactMessages, printResult, reportSummary } from './cli-output.mjs';

function usage(exitCode = 0) {
  console.error('Usage: node build-alignment-report.mjs <source-manifest.json> <capture-observation.json> --output <alignment-report.json>');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const positional = [];
  let output;
  let verbose = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') usage(0);
    if (arg === '--verbose') { verbose = true; continue; }
    if (arg === '--output') {
      output = argv[index + 1];
      if (!output) throw new Error('--output requires a file path');
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2 || !output) usage(2);
  return { manifestFile: positional[0], observationFile: positional[1], output, verbose };
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error.message}`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isFiniteBbox(value) {
  return value && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]));
}

function bboxDelta(before, after) {
  if (!isFiniteBbox(before) || !isFiniteBbox(after)) return Number.POSITIVE_INFINITY;
  return Math.max(...['x', 'y', 'width', 'height'].map((key) => Math.abs(before[key] - after[key])));
}

function addBlocker(blockers, condition, message) {
  if (!condition) blockers.push(message);
}

function writeOutput(file, report) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}

function valuesEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function evaluateDataFixture(manifest, observation, manifestFile) {
  const declaration = manifest.dataFixture ?? { required: false };
  const required = declaration.required === true;
  const defaultResult = {
    checks: {
      fixtureLockVerified: !required,
      fixtureSetMatched: !required,
      expectedRequestsMatched: !required,
      noUnmatchedBusinessRequests: !required,
      runtimeDeterministic: !required,
      visibleDataMatched: !required,
      dataSettled: !required
    },
    report: {
      required,
      fixtureSetId: null,
      fixtureSetDigest: null,
      contract: declaration.contract ?? null,
      lock: declaration.lock ?? null,
      lockErrors: [],
      requestResults: [],
      unmatchedBusinessRequests: [],
      runtimeResults: [],
      visibleAssertionResults: []
    },
    blockers: []
  };
  if (!required) return defaultResult;

  const manifestDir = path.dirname(path.resolve(manifestFile));
  const contractFile = path.resolve(manifestDir, declaration.contract ?? '');
  const lockFile = path.resolve(manifestDir, declaration.lock ?? '');
  let verification;
  try {
    verification = verifyFixtureLock(contractFile, lockFile);
  } catch (error) {
    verification = { valid: false, errors: [error.message], expected: null, actual: null };
  }
  const expected = verification.expected;
  const observed = observation.dataReadiness ?? {};
  const lockErrors = [...(verification.errors ?? [])];
  const lockMatchesManifest = verification.valid
    && expected?.fixtureSetId === declaration.expectedFixtureSetId
    && expected?.fixtureSetDigest === declaration.expectedFixtureSetDigest;
  if (verification.valid && !lockMatchesManifest) lockErrors.push('fixture lock does not match source manifest expected fixture set id/digest');

  const fixtureSetMatched = lockMatchesManifest
    && observed.fixtureSetId === expected.fixtureSetId
    && observed.fixtureSetDigest === expected.fixtureSetDigest;
  const observedRequests = new Map((observed.requestMatches ?? []).map((request) => [request.requestId, request]));
  const requestResults = (expected?.requests ?? []).map((request) => {
    const actual = observedRequests.get(request.id);
    const actualCount = actual?.count ?? 0;
    const countPassed = Number.isInteger(actualCount)
      && actualCount >= request.minMatches
      && actualCount <= request.maxMatches;
    const hashPassed = actualCount === 0 && request.minMatches === 0
      ? true
      : actual?.responseSha256 === request.response.sha256;
    const passed = countPassed && hashPassed;
    return {
      requestId: request.id,
      expectedMin: request.minMatches,
      expectedMax: request.maxMatches,
      actualCount,
      expectedResponseSha256: request.response.sha256,
      actualResponseSha256: actual?.responseSha256 ?? null,
      passed
    };
  });
  const expectedRequestIds = new Set((expected?.requests ?? []).map((request) => request.id));
  const unexpectedRequestIds = [...observedRequests.keys()].filter((id) => !expectedRequestIds.has(id));
  const expectedRequestsMatched = requestResults.every((result) => result.passed) && unexpectedRequestIds.length === 0;

  const unmatchedBusinessRequests = observed.unmatchedBusinessRequests ?? [];
  const rejectUnmatched = expected?.network?.rejectUnmatchedBusinessRequests !== false;
  const noUnmatchedBusinessRequests = !rejectUnmatched || unmatchedBusinessRequests.length === 0;

  const runtimeFieldMap = [
    ['freezeTime', 'timeFrozen'],
    ['now', 'now'],
    ['freezeRandom', 'randomFrozen'],
    ['randomSeed', 'randomSeed'],
    ['timezone', 'timezone'],
    ['locale', 'locale'],
    ['storageSeeded', 'storageSeeded']
  ];
  const runtimeResults = runtimeFieldMap.map(([expectedKey, actualKey]) => ({
    field: expectedKey,
    expected: expected?.runtime?.[expectedKey],
    actual: observed.runtime?.[actualKey],
    passed: valuesEqual(expected?.runtime?.[expectedKey], observed.runtime?.[actualKey])
  }));
  const runtimeDeterministic = runtimeResults.every((result) => result.passed);

  const observedAssertions = new Map((observed.visibleAssertions ?? []).map((assertion) => [assertion.id, assertion]));
  const visibleAssertionResults = (expected?.visibleAssertions ?? []).map((assertion) => {
    const actual = observedAssertions.get(assertion.id)?.actual;
    return {
      id: assertion.id,
      expected: assertion.expected,
      actual: actual ?? null,
      passed: valuesEqual(assertion.expected, actual)
    };
  });
  const expectedAssertionIds = new Set((expected?.visibleAssertions ?? []).map((assertion) => assertion.id));
  const unexpectedAssertionIds = [...observedAssertions.keys()].filter((id) => !expectedAssertionIds.has(id));
  const visibleDataMatched = visibleAssertionResults.every((result) => result.passed) && unexpectedAssertionIds.length === 0;
  const dataSettled = observed.networkSettled === true && observed.dataSettled === true;

  const checks = {
    fixtureLockVerified: verification.valid && lockMatchesManifest,
    fixtureSetMatched,
    expectedRequestsMatched,
    noUnmatchedBusinessRequests,
    runtimeDeterministic,
    visibleDataMatched,
    dataSettled
  };
  const blockers = [];
  addBlocker(blockers, checks.fixtureLockVerified, 'data fixture contract/response files do not match the sealed lock and source manifest');
  addBlocker(blockers, checks.fixtureSetMatched, 'browser observation used a different fixture set id or digest');
  addBlocker(blockers, checks.expectedRequestsMatched, 'expected mock requests, match counts, or response hashes did not match');
  addBlocker(blockers, checks.noUnmatchedBusinessRequests, 'one or more business requests escaped the fixture contract');
  addBlocker(blockers, checks.runtimeDeterministic, 'time, random, locale, timezone, or storage runtime did not match the fixture contract');
  addBlocker(blockers, checks.visibleDataMatched, 'visible table/list data assertions did not match the fixture contract');
  addBlocker(blockers, checks.dataSettled, 'network or visible data was not settled before capture');

  return {
    checks,
    blockers,
    report: {
      required,
      fixtureSetId: expected?.fixtureSetId ?? null,
      fixtureSetDigest: expected?.fixtureSetDigest ?? null,
      contract: declaration.contract,
      lock: declaration.lock,
      lockErrors,
      requestResults,
      unexpectedRequestIds,
      unmatchedBusinessRequests,
      runtimeResults,
      visibleAssertionResults,
      unexpectedAssertionIds
    }
  };
}

function evaluateVisualLab(manifest, observation, manifestFile) {
  const declaration = manifest.visualLab ?? { required: false };
  const required = declaration.required === true;
  const defaultResult = {
    checks: {
      visualLabLockVerified: !required,
      visualLabFilesMatched: !required,
      visualLabObservationMatched: !required,
      visualLabBoundaryPreserved: !required
    },
    report: {
      required,
      labId: null,
      root: declaration.root ?? null,
      lock: declaration.lock ?? null,
      lockSha256: null,
      lockErrors: [],
      fileResults: [],
      externalNetworkRequests: []
    },
    blockers: []
  };
  if (!required) return defaultResult;

  const manifestDirectory = path.dirname(path.resolve(manifestFile));
  const labRoot = path.resolve(manifestDirectory, declaration.root ?? '');
  const lockFile = path.resolve(manifestDirectory, declaration.lock ?? '');
  const lockErrors = [];
  let lock = null;
  let lockSha256 = null;
  try {
    lock = readJson(lockFile, 'Visual Lab lock');
    lockSha256 = sha256File(lockFile);
  } catch (error) {
    lockErrors.push(error.message);
  }
  const labValidation = validateVisualLab(labRoot);
  if (!labValidation.valid) lockErrors.push(...labValidation.errors.map((error) => `Visual Lab validation: ${error}`));
  if (lock?.kind !== 'visual-lab-lock' || lock?.status !== 'sealed') lockErrors.push('Visual Lab lock kind/status is invalid');
  if (lock?.labId !== declaration.expectedLabId) lockErrors.push('Visual Lab lock labId does not match source manifest');
  if (lockSha256 !== declaration.expectedLockSha256) lockErrors.push('Visual Lab lock SHA-256 does not match source manifest');

  const lockedFiles = new Map((lock?.files ?? []).map((file) => [file.path, file]));
  const fileResults = [];
  for (const locked of lock?.files ?? []) {
    let file;
    let actualSha256 = null;
    let actualBytes = null;
    let passed = false;
    try {
      file = resolveInside(labRoot, locked.path, `Visual Lab locked file ${locked.path}`);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        actualSha256 = sha256File(file);
        actualBytes = fs.statSync(file).size;
        passed = actualSha256 === locked.sha256 && actualBytes === locked.bytes;
      }
    } catch (error) {
      lockErrors.push(error.message);
    }
    fileResults.push({
      path: locked.path,
      expectedSha256: locked.sha256,
      actualSha256,
      expectedBytes: locked.bytes,
      actualBytes,
      passed
    });
  }
  for (const declaredFile of labValidation.files ?? []) {
    if (!lockedFiles.has(declaredFile.relativePath)) {
      lockErrors.push(`Visual Lab source file is not sealed: ${declaredFile.relativePath}`);
    }
  }
  let fixturePassed = false;
  if (lock?.fixture?.path && labValidation.fixtureFile) {
    fixturePassed = lock.fixture.path === labValidation.manifest?.fixture?.path
      && sha256File(labValidation.fixtureFile) === lock.fixture.sha256;
  }
  if (!fixturePassed) lockErrors.push('Visual Lab static fixture does not match the sealed lock');

  const boundaryKeys = ['targetProjectRead', 'targetProjectModified', 'migrationIncluded', 'integrationValidationIncluded'];
  const visualLabBoundaryPreserved = boundaryKeys.every((key) => lock?.boundary?.[key] === false)
    && boundaryKeys.every((key) => labValidation.manifest?.boundary?.[key] === false)
    && lock?.networkAccessVerifiedForbidden === true;
  const observed = observation.visualLabReadiness ?? {};
  const externalNetworkRequests = observed.externalNetworkRequests ?? [];
  const visualLabObservationMatched = observed.labId === declaration.expectedLabId
    && observed.lockSha256 === lockSha256
    && observed.readyMarker === true
    && observed.captureModeEnabled === true
    && Array.isArray(externalNetworkRequests)
    && externalNetworkRequests.length === 0;
  const checks = {
    visualLabLockVerified: lockErrors.length === 0,
    visualLabFilesMatched: labValidation.valid && fileResults.every((result) => result.passed) && fixturePassed,
    visualLabObservationMatched,
    visualLabBoundaryPreserved
  };
  const blockers = [];
  addBlocker(blockers, checks.visualLabLockVerified, 'Visual Lab lock does not match the source manifest');
  addBlocker(blockers, checks.visualLabFilesMatched, 'Visual Lab source or static fixture changed after sealing');
  addBlocker(blockers, checks.visualLabObservationMatched, 'browser capture did not observe the sealed Visual Lab ready state or made an external network request');
  addBlocker(blockers, checks.visualLabBoundaryPreserved, 'Visual Lab sandbox boundary or network policy was violated');
  return {
    checks,
    blockers,
    report: {
      required,
      labId: declaration.expectedLabId,
      root: declaration.root,
      lock: declaration.lock,
      lockSha256,
      lockErrors,
      fileResults,
      externalNetworkRequests
    }
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readJson(options.manifestFile, 'source manifest');
  const observation = readJson(options.observationFile, 'capture observation');
  if (manifest.kind !== 'source-manifest') throw new Error('First input must be a source-manifest');
  if (observation.kind !== 'capture-observation') throw new Error('Second input must be a capture-observation');
  const reference = requireObject(manifest.reference, 'manifest.reference');
  const scope = requireObject(manifest.comparisonScope, 'manifest.comparisonScope');
  const contractActual = requireObject(scope.actual, 'manifest.comparisonScope.actual');
  const actual = requireObject(observation.actual, 'observation.actual');
  const readiness = requireObject(observation.readiness, 'observation.readiness');
  const tolerance = scope.alignment?.tolerance;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('manifest comparisonScope.alignment.tolerance must be a non-negative number');
  if (!isFiniteBbox(reference.crop)) throw new Error('manifest reference.crop must be a finite bbox');

  if (!isFiniteBbox(actual.bboxInViewport)) throw new Error('observation actual.bboxInViewport must be a finite bbox');
  if (!Number.isFinite(actual.dpr) || actual.dpr <= 0) throw new Error('observation actual.dpr must be a positive number');
  const inset = contractActual.clipInset ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const bleed = contractActual.bleed ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const expectedCanvasWidth = Math.round((actual.bboxInViewport.width - inset.left - inset.right + bleed.left + bleed.right) * actual.dpr);
  const expectedCanvasHeight = Math.round((actual.bboxInViewport.height - inset.top - inset.bottom + bleed.top + bleed.bottom) * actual.dpr);
  const captureGeometryMatched = expectedCanvasWidth > 0 && expectedCanvasHeight > 0
    && actual.canvasWidth === expectedCanvasWidth && actual.canvasHeight === expectedCanvasHeight;
  const captureContractMatched = actual.captureMode === contractActual.captureMode
    && actual.box === contractActual.box
    && (actual.captureMode === 'viewport' || actual.selector === contractActual.selector)
    && captureGeometryMatched;
  const applicationShellPreserved = contractActual.keepApplicationShell !== true || actual.applicationShellPresent === true;
  const sizeMatched = actual.canvasWidth === reference.crop.width && actual.canvasHeight === reference.crop.height;
  const processedMutations = (observation.captureOnlyMutations ?? []).map((mutation) => {
    const layoutDelta = bboxDelta(mutation.targetBboxBefore, mutation.targetBboxAfter);
    return { ...mutation, layoutDelta, passed: Number.isFinite(layoutDelta) && layoutDelta <= tolerance };
  });
  const captureMutationsLayoutSafe = processedMutations.every((mutation) => mutation.passed);
  const processedAnchors = (observation.anchors ?? []).map((anchor) => ({
    ...anchor,
    passed: Number.isFinite(anchor.delta) && Number.isFinite(anchor.tolerance) && anchor.delta <= anchor.tolerance
  }));

  const dataEvaluation = evaluateDataFixture(manifest, observation, options.manifestFile);
  const visualLabEvaluation = evaluateVisualLab(manifest, observation, options.manifestFile);
  const checks = {
    scopeConfirmed: scope.status === 'confirmed' && scope.type !== 'unknown',
    targetResolved: readiness.targetResolved === true,
    captureContractMatched,
    applicationShellPreserved,
    sizeMatched,
    originNormalized: readiness.originNormalized === true,
    cropMatched: readiness.cropMatched === true,
    stateMatched: readiness.stateMatched === true,
    fontsReady: readiness.fontsReady === true,
    assetsReady: readiness.assetsReady === true,
    ...dataEvaluation.checks,
    ...visualLabEvaluation.checks,
    captureMutationsLayoutSafe
  };

  const blockers = [
    ...(manifest.blockers ?? []),
    ...(observation.blockers ?? []),
    ...dataEvaluation.blockers,
    ...visualLabEvaluation.blockers
  ];
  addBlocker(blockers, checks.scopeConfirmed, 'comparison scope is not confirmed');
  addBlocker(blockers, checks.targetResolved, 'target selector or clip did not resolve');
  addBlocker(blockers, checks.captureContractMatched, `capture observation does not match the declared selector/clip contract or expected ${expectedCanvasWidth}x${expectedCanvasHeight} PNG geometry`);
  addBlocker(blockers, checks.applicationShellPreserved, 'application shell required for layout was not preserved');
  addBlocker(blockers, checks.sizeMatched, `actual canvas ${actual.canvasWidth}x${actual.canvasHeight} does not match reference crop ${reference.crop.width}x${reference.crop.height}`);
  addBlocker(blockers, checks.originNormalized, 'actual screenshot origin was not normalized to the comparison target');
  addBlocker(blockers, checks.cropMatched, 'actual crop does not match the declared comparison box');
  addBlocker(blockers, checks.stateMatched, 'rendered state does not match the reference state');
  addBlocker(blockers, checks.fontsReady, 'fonts were not ready at capture time');
  addBlocker(blockers, checks.assetsReady, 'assets were not ready at capture time');
  addBlocker(blockers, checks.captureMutationsLayoutSafe, 'a capture-only mutation changed target layout');
  addBlocker(blockers, processedAnchors.every((anchor) => anchor.passed), 'one or more alignment anchors failed');

  const report = {
    kind: 'alignment-report',
    schemaVersion: '1.0',
    sourceManifest: path.resolve(options.manifestFile),
    scopeType: scope.type,
    reference: {
      path: reference.path,
      crop: reference.crop,
      canvasWidth: reference.crop.width,
      canvasHeight: reference.crop.height
    },
    actual,
    checks,
    dataFixture: dataEvaluation.report,
    visualLab: visualLabEvaluation.report,
    anchors: processedAnchors,
    maskPolicy: scope.maskPolicy ?? { maxAreaRatio: 0.05, allowOverLimit: false },
    masks: scope.masks ?? [],
    measurementSpace: observation.measurementSpace ?? null,
    visualMeasurements: observation.visualMeasurements ?? [],
    captureOnlyMutations: processedMutations,
    tolerance,
    status: blockers.length === 0 ? 'pass' : 'blocked',
    blockers
  };

  writeOutput(options.output, report);
  const failedChecks = Object.entries(report.checks).filter(([, passed]) => passed !== true).map(([key]) => key);
  printResult(report, reportSummary('alignment-report', report.status, options.output, {
    failedChecks,
    blockerCount: report.blockers.length,
    blockers: compactMessages(report.blockers)
  }), { verbose: options.verbose });
  process.exit(report.status === 'pass' ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ kind: 'alignment-report-error', error: error.message }, null, 2));
  process.exit(2);
}
