#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { printResult } from './cli-output.mjs';

const file = process.argv[2];
const verbose = process.argv.includes('--verbose');
if (!file || process.argv.includes('--help')) {
  console.error('Usage: node validate-artifacts.mjs <artifact.json>');
  process.exit(file ? 0 : 2);
}

const errors = [];
const warnings = [];

function issue(list, pointer, message) {
  list.push({ path: pointer, message });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, pointer) {
  if (!isObject(value)) {
    issue(errors, pointer, 'must be an object');
    return false;
  }
  return true;
}

function requireArray(value, pointer, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    issue(errors, pointer, 'must be an array');
    return false;
  }
  if (nonEmpty && value.length === 0) issue(errors, pointer, 'must not be empty');
  return true;
}

function requireString(value, pointer, { nonEmpty = true } = {}) {
  if (typeof value !== 'string' || (nonEmpty && value.trim() === '')) {
    issue(errors, pointer, 'must be a non-empty string');
    return false;
  }
  return true;
}

function requireBoolean(value, pointer) {
  if (typeof value !== 'boolean') {
    issue(errors, pointer, 'must be a boolean');
    return false;
  }
  return true;
}

function requireNumber(value, pointer, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issue(errors, pointer, 'must be a finite number');
    return false;
  }
  if (integer && !Number.isInteger(value)) issue(errors, pointer, 'must be an integer');
  if (value < min || value > max) issue(errors, pointer, `must be between ${min} and ${max}`);
  return true;
}

function requireEnum(value, pointer, allowed) {
  if (!allowed.includes(value)) {
    issue(errors, pointer, `must be one of: ${allowed.join(', ')}`);
    return false;
  }
  return true;
}

function requireSha256(value, pointer) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    issue(errors, pointer, 'must be a lowercase SHA-256 hex string');
    return false;
  }
  return true;
}

function validateBbox(bbox, pointer, bounds) {
  if (!requireObject(bbox, pointer)) return;
  for (const key of ['x', 'y', 'width', 'height']) {
    requireNumber(bbox[key], `${pointer}/${key}`, { min: 0 });
  }
  if (typeof bbox.width === 'number' && bbox.width <= 0) issue(errors, `${pointer}/width`, 'must be greater than 0');
  if (typeof bbox.height === 'number' && bbox.height <= 0) issue(errors, `${pointer}/height`, 'must be greater than 0');
  if (bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bbox[key]))) {
    if (bbox.x + bbox.width > bounds.width + 0.001) issue(errors, pointer, 'extends beyond image width');
    if (bbox.y + bbox.height > bounds.height + 0.001) issue(errors, pointer, 'extends beyond image height');
  }
}

function validateInsets(value, pointer) {
  if (!requireObject(value, pointer)) return;
  for (const key of ['top', 'right', 'bottom', 'left']) {
    requireNumber(value[key], `${pointer}/${key}`, { min: 0 });
  }
}

function validateEvidence(value, pointer) {
  if (!requireObject(value, pointer)) return;
  requireString(value.source, `${pointer}/source`);
  requireEnum(value.method, `${pointer}/method`, [
    'pixel-sample',
    'edge-measure',
    'crop-inspection',
    'ocr',
    'inferred'
  ]);
  requireString(value.detail, `${pointer}/detail`);
  if (value.tolerance !== null && value.tolerance !== undefined) {
    requireNumber(value.tolerance, `${pointer}/tolerance`, { min: 0 });
  }
}

function validateAppearance(value, pointer) {
  if (!requireObject(value, pointer)) return;
  for (const key of ['background', 'foreground', 'border', 'borderRadius', 'boxShadow', 'opacity']) {
    if (!(key in value)) issue(errors, `${pointer}/${key}`, 'is required');
  }
  if ('opacity' in value) requireNumber(value.opacity, `${pointer}/opacity`, { min: 0, max: 1 });
}

function validateMeasurementSpace(value, pointer) {
  if (!requireObject(value, pointer)) return;
  requireEnum(value.origin, `${pointer}/origin`, ['comparison-canvas']);
  requireEnum(value.units, `${pointer}/units`, ['image-px']);
  requireBoolean(value.dprApplied, `${pointer}/dprApplied`);
  if (value.dprApplied !== true) issue(errors, `${pointer}/dprApplied`, 'must be true so DOM measurements use comparison-canvas image pixels');
}

function validateVisualMeasurements(value, pointer, bounds) {
  const ids = new Set();
  if (!requireArray(value, pointer, { nonEmpty: true })) return;
  value.forEach((measurement, index) => {
    const itemPointer = `${pointer}/${index}`;
    if (!requireObject(measurement, itemPointer)) return;
    if (requireString(measurement.id, `${itemPointer}/id`)) {
      if (ids.has(measurement.id)) issue(errors, `${itemPointer}/id`, 'must be unique');
      ids.add(measurement.id);
    }
    requireEnum(measurement.type, `${itemPointer}/type`, ['region', 'element']);
    requireString(measurement.selector, `${itemPointer}/selector`);
    requireBoolean(measurement.present, `${itemPointer}/present`);
    requireBoolean(measurement.visible, `${itemPointer}/visible`);
    requireBoolean(measurement.contentMatched, `${itemPointer}/contentMatched`);
    requireBoolean(measurement.stateMatched, `${itemPointer}/stateMatched`);
    requireString(measurement.state, `${itemPointer}/state`);
    if (measurement.present === true) validateBbox(measurement.bbox, `${itemPointer}/bbox`, bounds);
    if (measurement.present === false && measurement.bbox !== null) {
      issue(errors, `${itemPointer}/bbox`, 'must be null when the target is not present');
    }
    if (requireObject(measurement.overflow, `${itemPointer}/overflow`)) {
      for (const key of ['x', 'y', 'clipped']) requireBoolean(measurement.overflow[key], `${itemPointer}/overflow/${key}`);
    }
    if (requireObject(measurement.occlusion, `${itemPointer}/occlusion`)) {
      requireNumber(measurement.occlusion.ratio, `${itemPointer}/occlusion/ratio`, { min: 0, max: 1 });
      requireArray(measurement.occlusion.blockers, `${itemPointer}/occlusion/blockers`);
    }
    if (measurement.computedStyle !== null && requireObject(measurement.computedStyle, `${itemPointer}/computedStyle`)) {
      for (const key of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'borderRadius']) {
        if (measurement.computedStyle[key] !== null && measurement.computedStyle[key] !== undefined) {
          requireNumber(measurement.computedStyle[key], `${itemPointer}/computedStyle/${key}`, { min: key === 'letterSpacing' ? -Infinity : 0 });
        }
      }
      for (const key of ['fontFamily', 'color', 'backgroundColor']) {
        if (measurement.computedStyle[key] !== null && measurement.computedStyle[key] !== undefined) {
          requireString(measurement.computedStyle[key], `${itemPointer}/computedStyle/${key}`);
        }
      }
    }
  });
}

function validateSourceManifest(data) {
  if (data.executionScope !== undefined) requireEnum(data.executionScope, '/executionScope', ['target-project', 'visual-lab']);
  const visualLab = data.executionScope === 'visual-lab';
  requireString(data.task, '/task');
  if (requireObject(data.reference, '/reference')) {
    requireString(data.reference.path, '/reference/path');
    requireNumber(data.reference.imageWidth, '/reference/imageWidth', { min: 1, integer: true });
    requireNumber(data.reference.imageHeight, '/reference/imageHeight', { min: 1, integer: true });
    validateBbox(data.reference.crop, '/reference/crop', {
      width: data.reference.imageWidth,
      height: data.reference.imageHeight
    });
    requireString(data.reference.state, '/reference/state');
  }
  if (requireObject(data.render, '/render')) {
    requireString(data.render.url, '/render/url');
    if (requireObject(data.render.viewport, '/render/viewport')) {
      requireNumber(data.render.viewport.width, '/render/viewport/width', { min: 1, integer: true });
      requireNumber(data.render.viewport.height, '/render/viewport/height', { min: 1, integer: true });
    }
    requireNumber(data.render.dpr, '/render/dpr', { min: 0.1 });
    requireNumber(data.render.zoom, '/render/zoom', { min: 0.1 });
  }
  if (requireObject(data.comparisonScope, '/comparisonScope')) {
    const scope = data.comparisonScope;
    requireEnum(scope.type, '/comparisonScope/type', ['full-viewport', 'page-content', 'region', 'component', 'unknown']);
    requireEnum(scope.status, '/comparisonScope/status', ['proposed', 'confirmed', 'blocked']);
    requireArray(scope.evidence, '/comparisonScope/evidence', { nonEmpty: scope.status === 'confirmed' });
    requireString(scope.referenceBox, '/comparisonScope/referenceBox');
    if (scope.status === 'confirmed' && scope.type === 'unknown') {
      issue(errors, '/comparisonScope/type', 'cannot be unknown when scope status is confirmed');
    }
    if (requireObject(scope.actual, '/comparisonScope/actual')) {
      const actual = scope.actual;
      requireEnum(actual.captureMode, '/comparisonScope/actual/captureMode', ['viewport', 'locator', 'dom-clip']);
      if (actual.captureMode === 'locator' || actual.captureMode === 'dom-clip') {
        requireString(actual.selector, '/comparisonScope/actual/selector');
      }
      if (scope.type === 'full-viewport' && actual.captureMode !== 'viewport') {
        issue(errors, '/comparisonScope/actual/captureMode', 'full-viewport scope must use viewport capture');
      }
      if (scope.type !== 'full-viewport' && scope.type !== 'unknown' && actual.captureMode === 'viewport') {
        issue(errors, '/comparisonScope/actual/captureMode', 'content, region, and component scopes must not use a full viewport capture');
      }
      requireEnum(actual.box, '/comparisonScope/actual/box', ['border-box', 'content-box', 'explicit-clip']);
      requireBoolean(actual.keepApplicationShell, '/comparisonScope/actual/keepApplicationShell');
      if (scope.type === 'page-content' && !visualLab && actual.keepApplicationShell !== true) {
        issue(errors, '/comparisonScope/actual/keepApplicationShell', 'page-content capture must preserve the application shell for layout');
      }
      if (visualLab && actual.keepApplicationShell !== false) {
        issue(errors, '/comparisonScope/actual/keepApplicationShell', 'Visual Lab capture must not claim an application shell');
      }
      validateInsets(actual.clipInset, '/comparisonScope/actual/clipInset');
      validateInsets(actual.bleed, '/comparisonScope/actual/bleed');
      if (actual.captureMode === 'locator') {
        const locatorAdjustment = [...Object.values(actual.clipInset ?? {}), ...Object.values(actual.bleed ?? {})]
          .some((value) => Number.isFinite(value) && value !== 0);
        if (locatorAdjustment) {
          issue(errors, '/comparisonScope/actual', 'locator capture cannot apply clipInset or bleed; use dom-clip for an adjusted box');
        }
      }
      if (requireArray(actual.captureOnlyMutations, '/comparisonScope/actual/captureOnlyMutations')) {
        actual.captureOnlyMutations.forEach((mutation, index) => {
          const pointer = `/comparisonScope/actual/captureOnlyMutations/${index}`;
          if (!requireObject(mutation, pointer)) return;
          for (const key of ['selector', 'property', 'value', 'reason']) requireString(mutation[key], `${pointer}/${key}`);
          requireBoolean(mutation.preserveLayout, `${pointer}/preserveLayout`);
          if (scope.status === 'confirmed' && mutation.preserveLayout !== true) {
            issue(errors, `${pointer}/preserveLayout`, 'must be true for a confirmed comparison scope');
          }
          if (mutation.property === 'display' && mutation.value === 'none') {
            issue(errors, pointer, 'display:none is forbidden because it can change layout; use a layout-preserving capture method');
          }
        });
      }
    }
    if (requireObject(scope.alignment, '/comparisonScope/alignment')) {
      requireEnum(scope.alignment.mode, '/comparisonScope/alignment/mode', ['viewport-origin', 'selector-origin', 'anchor-pairs', 'explicit-clip']);
      requireEnum(scope.alignment.sizePolicy, '/comparisonScope/alignment/sizePolicy', ['exact', 'calibrate-viewport', 'fixed-component', 'blocked']);
      requireNumber(scope.alignment.tolerance, '/comparisonScope/alignment/tolerance', { min: 0 });
      requireArray(scope.alignment.anchors, '/comparisonScope/alignment/anchors', { nonEmpty: scope.alignment.mode === 'anchor-pairs' });
      if (scope.status === 'confirmed' && scope.alignment.sizePolicy === 'blocked') {
        issue(errors, '/comparisonScope/alignment/sizePolicy', 'cannot be blocked when scope status is confirmed');
      }
    }
    if (requireObject(scope.maskPolicy, '/comparisonScope/maskPolicy')) {
      requireNumber(scope.maskPolicy.maxAreaRatio, '/comparisonScope/maskPolicy/maxAreaRatio', { min: 0, max: 1 });
      requireBoolean(scope.maskPolicy.allowOverLimit, '/comparisonScope/maskPolicy/allowOverLimit');
    }
    if (requireArray(scope.masks, '/comparisonScope/masks')) {
      scope.masks.forEach((mask, index) => {
        const pointer = `/comparisonScope/masks/${index}`;
        if (!requireObject(mask, pointer)) return;
        requireString(mask.id, `${pointer}/id`);
        requireEnum(mask.reason, `${pointer}/reason`, ['dynamic-time', 'dynamic-data', 'caret', 'random-asset', 'user-approved']);
        validateBbox(mask.bbox, `${pointer}/bbox`, {
          width: data.reference?.crop?.width,
          height: data.reference?.crop?.height
        });
        requireString(mask.evidence, `${pointer}/evidence`);
      });
      const canvasArea = data.reference?.crop?.width * data.reference?.crop?.height;
      const maskedArea = scope.masks.reduce((sum, mask) => sum + ((mask.bbox?.width ?? 0) * (mask.bbox?.height ?? 0)), 0);
      const ratio = canvasArea > 0 ? maskedArea / canvasArea : 0;
      if (ratio > (scope.maskPolicy?.maxAreaRatio ?? 0.05) && scope.maskPolicy?.allowOverLimit !== true) {
        issue(errors, '/comparisonScope/masks', `masked area ratio ${ratio.toFixed(4)} exceeds policy limit without explicit approval`);
      }
    }
  }
  if (requireObject(data.dataFixture, '/dataFixture')) {
    requireBoolean(data.dataFixture.required, '/dataFixture/required');
    if (data.dataFixture.required === true) {
      requireString(data.dataFixture.contract, '/dataFixture/contract');
      requireString(data.dataFixture.lock, '/dataFixture/lock');
      requireString(data.dataFixture.expectedFixtureSetId, '/dataFixture/expectedFixtureSetId');
      requireSha256(data.dataFixture.expectedFixtureSetDigest, '/dataFixture/expectedFixtureSetDigest');
    }
    if (visualLab && data.dataFixture.required !== false) {
      issue(errors, '/dataFixture/required', 'Visual Lab must use the static in-project visual fixture, not an API fixture');
    }
  }
  if (data.visualLab !== undefined && requireObject(data.visualLab, '/visualLab')) {
    requireBoolean(data.visualLab.required, '/visualLab/required');
    if (data.visualLab.required === true) {
      requireString(data.visualLab.root, '/visualLab/root');
      requireString(data.visualLab.lock, '/visualLab/lock');
      requireString(data.visualLab.expectedLabId, '/visualLab/expectedLabId');
      requireSha256(data.visualLab.expectedLockSha256, '/visualLab/expectedLockSha256');
      for (const key of ['root', 'lock']) {
        if (path.isAbsolute(data.visualLab[key]) || data.visualLab[key].split(/[\\/]/).includes('..')) {
          issue(errors, `/visualLab/${key}`, 'must stay inside the artifact directory');
        }
      }
    }
  }
  if (visualLab && data.visualLab?.required !== true) issue(errors, '/visualLab/required', 'must be true for executionScope=visual-lab');
  if (visualLab && !/^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(data.render?.url ?? '')) {
    issue(errors, '/render/url', 'Visual Lab render URL must use loopback host 127.0.0.1');
  }
  requireArray(data.blockers, '/blockers');
}

function validateDataFixtureContract(data) {
  requireString(data.fixtureSetId, '/fixtureSetId');
  requireEnum(data.mode, '/mode', ['static', 'record-replay']);
  if (requireObject(data.network, '/network')) {
    requireBoolean(data.network.rejectUnmatchedBusinessRequests, '/network/rejectUnmatchedBusinessRequests');
    requireArray(data.network.businessUrlPatterns, '/network/businessUrlPatterns', { nonEmpty: true });
    requireArray(data.network.allowUnmockedUrlPatterns, '/network/allowUnmockedUrlPatterns');
  }
  if (requireObject(data.runtime, '/runtime')) {
    requireBoolean(data.runtime.freezeTime, '/runtime/freezeTime');
    requireString(data.runtime.now, '/runtime/now');
    requireBoolean(data.runtime.freezeRandom, '/runtime/freezeRandom');
    requireString(data.runtime.randomSeed, '/runtime/randomSeed');
    requireString(data.runtime.timezone, '/runtime/timezone');
    requireString(data.runtime.locale, '/runtime/locale');
    requireBoolean(data.runtime.storageSeeded, '/runtime/storageSeeded');
  }
  const requestIds = new Set();
  if (requireArray(data.requests, '/requests', { nonEmpty: true })) {
    data.requests.forEach((request, index) => {
      const pointer = `/requests/${index}`;
      if (!requireObject(request, pointer)) return;
      if (requireString(request.id, `${pointer}/id`)) {
        if (requestIds.has(request.id)) issue(errors, `${pointer}/id`, 'must be unique');
        requestIds.add(request.id);
      }
      requireString(request.method, `${pointer}/method`);
      requireString(request.urlPattern, `${pointer}/urlPattern`);
      requireNumber(request.minMatches, `${pointer}/minMatches`, { min: 0, integer: true });
      requireNumber(request.maxMatches, `${pointer}/maxMatches`, { min: 0, integer: true });
      if (Number.isInteger(request.minMatches) && Number.isInteger(request.maxMatches) && request.maxMatches < request.minMatches) {
        issue(errors, `${pointer}/maxMatches`, 'must be greater than or equal to minMatches');
      }
      if (requireObject(request.response, `${pointer}/response`)) {
        requireString(request.response.fixture, `${pointer}/response/fixture`);
        if (path.isAbsolute(request.response.fixture ?? '')) issue(errors, `${pointer}/response/fixture`, 'must be relative');
        requireNumber(request.response.status, `${pointer}/response/status`, { min: 100, max: 599, integer: true });
        requireString(request.response.contentType, `${pointer}/response/contentType`);
      }
    });
  }
  const assertionIds = new Set();
  if (requireArray(data.visibleAssertions, '/visibleAssertions')) {
    data.visibleAssertions.forEach((assertion, index) => {
      const pointer = `/visibleAssertions/${index}`;
      if (!requireObject(assertion, pointer)) return;
      if (requireString(assertion.id, `${pointer}/id`)) {
        if (assertionIds.has(assertion.id)) issue(errors, `${pointer}/id`, 'must be unique');
        assertionIds.add(assertion.id);
      }
      requireString(assertion.selector, `${pointer}/selector`);
      requireEnum(assertion.kind, `${pointer}/kind`, ['count', 'text', 'attribute', 'value', 'checked']);
      if (!('expected' in assertion)) issue(errors, `${pointer}/expected`, 'is required');
      if (assertion.kind === 'attribute') requireString(assertion.attribute, `${pointer}/attribute`);
    });
  }
}

function validateDataFixtureLock(data) {
  requireString(data.fixtureSetId, '/fixtureSetId');
  requireEnum(data.mode, '/mode', ['static', 'record-replay']);
  requireSha256(data.contractSha256, '/contractSha256');
  requireSha256(data.fixtureSetDigest, '/fixtureSetDigest');
  requireObject(data.network, '/network');
  requireObject(data.runtime, '/runtime');
  requireArray(data.visibleAssertions, '/visibleAssertions');
  if (requireArray(data.requests, '/requests', { nonEmpty: true })) {
    data.requests.forEach((request, index) => {
      const pointer = `/requests/${index}`;
      if (!requireObject(request, pointer)) return;
      requireString(request.id, `${pointer}/id`);
      requireString(request.method, `${pointer}/method`);
      requireString(request.urlPattern, `${pointer}/urlPattern`);
      requireNumber(request.minMatches, `${pointer}/minMatches`, { min: 0, integer: true });
      requireNumber(request.maxMatches, `${pointer}/maxMatches`, { min: 0, integer: true });
      if (requireObject(request.response, `${pointer}/response`)) {
        requireString(request.response.fixture, `${pointer}/response/fixture`);
        requireNumber(request.response.status, `${pointer}/response/status`, { min: 100, max: 599, integer: true });
        requireString(request.response.contentType, `${pointer}/response/contentType`);
        requireNumber(request.response.bytes, `${pointer}/response/bytes`, { min: 0, integer: true });
        requireSha256(request.response.sha256, `${pointer}/response/sha256`);
      }
    });
  }
}

function validateAlignmentReport(data) {
  requireString(data.sourceManifest, '/sourceManifest');
  requireEnum(data.scopeType, '/scopeType', ['full-viewport', 'page-content', 'region', 'component', 'unknown']);
  if (requireObject(data.reference, '/reference')) {
    requireString(data.reference.path, '/reference/path');
    validateBbox(data.reference.crop, '/reference/crop');
    requireNumber(data.reference.canvasWidth, '/reference/canvasWidth', { min: 1, integer: true });
    requireNumber(data.reference.canvasHeight, '/reference/canvasHeight', { min: 1, integer: true });
    if (data.reference.crop?.width !== data.reference.canvasWidth || data.reference.crop?.height !== data.reference.canvasHeight) {
      issue(errors, '/reference', 'canvas dimensions must equal the declared reference crop dimensions');
    }
  }
  if (requireObject(data.actual, '/actual')) {
    requireString(data.actual.path, '/actual/path');
    requireString(data.actual.debugViewportScreenshot, '/actual/debugViewportScreenshot');
    requireEnum(data.actual.captureMode, '/actual/captureMode', ['viewport', 'locator', 'dom-clip']);
    if (data.actual.captureMode !== 'viewport') requireString(data.actual.selector, '/actual/selector');
    requireEnum(data.actual.box, '/actual/box', ['border-box', 'content-box', 'explicit-clip']);
    if (requireObject(data.actual.viewport, '/actual/viewport')) {
      requireNumber(data.actual.viewport.width, '/actual/viewport/width', { min: 1, integer: true });
      requireNumber(data.actual.viewport.height, '/actual/viewport/height', { min: 1, integer: true });
    }
    validateBbox(data.actual.bboxInViewport, '/actual/bboxInViewport', data.actual.viewport);
    requireNumber(data.actual.canvasWidth, '/actual/canvasWidth', { min: 1, integer: true });
    requireNumber(data.actual.canvasHeight, '/actual/canvasHeight', { min: 1, integer: true });
    requireNumber(data.actual.dpr, '/actual/dpr', { min: 0.1 });
    requireBoolean(data.actual.applicationShellPresent, '/actual/applicationShellPresent');
  }
  const checkKeys = [
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
  if (requireObject(data.checks, '/checks')) {
    for (const key of checkKeys) requireBoolean(data.checks[key], `/checks/${key}`);
  }
  if (requireObject(data.dataFixture, '/dataFixture')) {
    requireBoolean(data.dataFixture.required, '/dataFixture/required');
    if (data.dataFixture.required) {
      requireString(data.dataFixture.fixtureSetId, '/dataFixture/fixtureSetId');
      requireSha256(data.dataFixture.fixtureSetDigest, '/dataFixture/fixtureSetDigest');
      requireString(data.dataFixture.contract, '/dataFixture/contract');
      requireString(data.dataFixture.lock, '/dataFixture/lock');
    }
    requireArray(data.dataFixture.lockErrors, '/dataFixture/lockErrors');
    if (requireArray(data.dataFixture.requestResults, '/dataFixture/requestResults')) {
      data.dataFixture.requestResults.forEach((result, index) => {
        const pointer = `/dataFixture/requestResults/${index}`;
        if (!requireObject(result, pointer)) return;
        requireString(result.requestId, `${pointer}/requestId`);
        requireNumber(result.expectedMin, `${pointer}/expectedMin`, { min: 0, integer: true });
        requireNumber(result.expectedMax, `${pointer}/expectedMax`, { min: 0, integer: true });
        requireNumber(result.actualCount, `${pointer}/actualCount`, { min: 0, integer: true });
        requireSha256(result.expectedResponseSha256, `${pointer}/expectedResponseSha256`);
        if (result.actualResponseSha256 !== null) requireSha256(result.actualResponseSha256, `${pointer}/actualResponseSha256`);
        requireBoolean(result.passed, `${pointer}/passed`);
      });
    }
    requireArray(data.dataFixture.unmatchedBusinessRequests, '/dataFixture/unmatchedBusinessRequests');
    if (requireArray(data.dataFixture.runtimeResults, '/dataFixture/runtimeResults')) {
      data.dataFixture.runtimeResults.forEach((result, index) => {
        const pointer = `/dataFixture/runtimeResults/${index}`;
        if (!requireObject(result, pointer)) return;
        requireString(result.field, `${pointer}/field`);
        requireBoolean(result.passed, `${pointer}/passed`);
      });
    }
    if (requireArray(data.dataFixture.visibleAssertionResults, '/dataFixture/visibleAssertionResults')) {
      data.dataFixture.visibleAssertionResults.forEach((result, index) => {
        const pointer = `/dataFixture/visibleAssertionResults/${index}`;
        if (!requireObject(result, pointer)) return;
        requireString(result.id, `${pointer}/id`);
        requireBoolean(result.passed, `${pointer}/passed`);
      });
    }
  }
  if (requireObject(data.visualLab, '/visualLab')) {
    requireBoolean(data.visualLab.required, '/visualLab/required');
    if (data.visualLab.required) {
      requireString(data.visualLab.labId, '/visualLab/labId');
      requireString(data.visualLab.root, '/visualLab/root');
      requireString(data.visualLab.lock, '/visualLab/lock');
      requireSha256(data.visualLab.lockSha256, '/visualLab/lockSha256');
    }
    requireArray(data.visualLab.lockErrors, '/visualLab/lockErrors');
    if (data.visualLab.fileResults !== undefined && requireArray(data.visualLab.fileResults, '/visualLab/fileResults')) {
      data.visualLab.fileResults.forEach((result, index) => {
        const pointer = `/visualLab/fileResults/${index}`;
        if (!requireObject(result, pointer)) return;
        requireString(result.path, `${pointer}/path`);
        requireSha256(result.expectedSha256, `${pointer}/expectedSha256`);
        if (result.actualSha256 !== null) requireSha256(result.actualSha256, `${pointer}/actualSha256`);
        requireNumber(result.expectedBytes, `${pointer}/expectedBytes`, { min: 1, integer: true });
        if (result.actualBytes !== null) requireNumber(result.actualBytes, `${pointer}/actualBytes`, { min: 1, integer: true });
        requireBoolean(result.passed, `${pointer}/passed`);
      });
    }
    requireArray(data.visualLab.externalNetworkRequests, '/visualLab/externalNetworkRequests');
  }
  if (requireArray(data.anchors, '/anchors')) {
    data.anchors.forEach((anchor, index) => {
      const pointer = `/anchors/${index}`;
      if (!requireObject(anchor, pointer)) return;
      requireString(anchor.id, `${pointer}/id`);
      requireNumber(anchor.delta, `${pointer}/delta`, { min: 0 });
      requireNumber(anchor.tolerance, `${pointer}/tolerance`, { min: 0 });
      requireBoolean(anchor.passed, `${pointer}/passed`);
    });
  }
  if (requireObject(data.maskPolicy, '/maskPolicy')) {
    requireNumber(data.maskPolicy.maxAreaRatio, '/maskPolicy/maxAreaRatio', { min: 0, max: 1 });
    requireBoolean(data.maskPolicy.allowOverLimit, '/maskPolicy/allowOverLimit');
  }
  if (requireArray(data.masks, '/masks')) {
    data.masks.forEach((mask, index) => {
      const pointer = `/masks/${index}`;
      if (!requireObject(mask, pointer)) return;
      requireString(mask.id, `${pointer}/id`);
      requireEnum(mask.reason, `${pointer}/reason`, ['dynamic-time', 'dynamic-data', 'caret', 'random-asset', 'user-approved']);
      validateBbox(mask.bbox, `${pointer}/bbox`, {
        width: data.reference?.canvasWidth,
        height: data.reference?.canvasHeight
      });
      requireString(mask.evidence, `${pointer}/evidence`);
    });
    const canvasArea = data.reference?.canvasWidth * data.reference?.canvasHeight;
    const maskedArea = data.masks.reduce((sum, mask) => sum + ((mask.bbox?.width ?? 0) * (mask.bbox?.height ?? 0)), 0);
    const ratio = canvasArea > 0 ? maskedArea / canvasArea : 0;
    if (ratio > (data.maskPolicy?.maxAreaRatio ?? 0.05) && data.maskPolicy?.allowOverLimit !== true) {
      issue(errors, '/masks', `masked area ratio ${ratio.toFixed(4)} exceeds alignment report policy limit`);
    }
  }
  validateMeasurementSpace(data.measurementSpace, '/measurementSpace');
  validateVisualMeasurements(data.visualMeasurements, '/visualMeasurements', {
    width: data.reference?.canvasWidth,
    height: data.reference?.canvasHeight
  });
  if (requireArray(data.captureOnlyMutations, '/captureOnlyMutations')) {
    data.captureOnlyMutations.forEach((mutation, index) => {
      const pointer = `/captureOnlyMutations/${index}`;
      if (!requireObject(mutation, pointer)) return;
      for (const key of ['selector', 'property', 'value', 'reason']) requireString(mutation[key], `${pointer}/${key}`);
      validateBbox(mutation.targetBboxBefore, `${pointer}/targetBboxBefore`);
      validateBbox(mutation.targetBboxAfter, `${pointer}/targetBboxAfter`);
      requireNumber(mutation.layoutDelta, `${pointer}/layoutDelta`, { min: 0 });
      requireBoolean(mutation.passed, `${pointer}/passed`);
    });
  }
  requireNumber(data.tolerance, '/tolerance', { min: 0 });
  requireEnum(data.status, '/status', ['pass', 'blocked']);
  requireArray(data.blockers, '/blockers');

  if (data.status === 'pass') {
    if (data.scopeType === 'unknown') issue(errors, '/scopeType', 'cannot be unknown when alignment passes');
    const failedChecks = checkKeys.filter((key) => data.checks?.[key] !== true);
    if (failedChecks.length > 0) issue(errors, '/status', `cannot pass while checks fail: ${failedChecks.join(', ')}`);
    if ((data.blockers ?? []).length > 0) issue(errors, '/blockers', 'must be empty when alignment passes');
    const failedAnchors = (data.anchors ?? []).filter((anchor) => anchor.passed !== true || anchor.delta > anchor.tolerance);
    if (failedAnchors.length > 0) issue(errors, '/anchors', 'all anchors must pass when alignment passes');
    const failedMutations = (data.captureOnlyMutations ?? []).filter((mutation) => mutation.passed !== true || mutation.layoutDelta > data.tolerance);
    if (failedMutations.length > 0) issue(errors, '/captureOnlyMutations', 'all capture-only mutations must preserve layout within tolerance');
    if (Number.isFinite(data.reference?.canvasWidth) && Number.isFinite(data.actual?.canvasWidth)
      && data.reference.canvasWidth !== data.actual.canvasWidth) {
      issue(errors, '/actual/canvasWidth', 'must exactly match reference canvas width before pixel comparison');
    }
    if (Number.isFinite(data.reference?.canvasHeight) && Number.isFinite(data.actual?.canvasHeight)
      && data.reference.canvasHeight !== data.actual.canvasHeight) {
      issue(errors, '/actual/canvasHeight', 'must exactly match reference canvas height before pixel comparison');
    }
  }
}

function validateCaptureObservation(data) {
  if (requireObject(data.actual, '/actual')) {
    requireString(data.actual.path, '/actual/path');
    requireString(data.actual.debugViewportScreenshot, '/actual/debugViewportScreenshot');
    requireEnum(data.actual.captureMode, '/actual/captureMode', ['viewport', 'locator', 'dom-clip']);
    if (data.actual.captureMode !== 'viewport') requireString(data.actual.selector, '/actual/selector');
    requireEnum(data.actual.box, '/actual/box', ['border-box', 'content-box', 'explicit-clip']);
    validateBbox(data.actual.bboxInViewport, '/actual/bboxInViewport', data.actual.viewport);
    requireNumber(data.actual.canvasWidth, '/actual/canvasWidth', { min: 1, integer: true });
    requireNumber(data.actual.canvasHeight, '/actual/canvasHeight', { min: 1, integer: true });
    if (requireObject(data.actual.viewport, '/actual/viewport')) {
      requireNumber(data.actual.viewport.width, '/actual/viewport/width', { min: 1, integer: true });
      requireNumber(data.actual.viewport.height, '/actual/viewport/height', { min: 1, integer: true });
    }
    requireNumber(data.actual.dpr, '/actual/dpr', { min: 0.1 });
    requireBoolean(data.actual.applicationShellPresent, '/actual/applicationShellPresent');
  }
  if (requireObject(data.readiness, '/readiness')) {
    for (const key of ['targetResolved', 'originNormalized', 'cropMatched', 'stateMatched', 'fontsReady', 'assetsReady']) {
      requireBoolean(data.readiness[key], `/readiness/${key}`);
    }
  }
  if (data.dataReadiness !== undefined && requireObject(data.dataReadiness, '/dataReadiness')) {
    requireString(data.dataReadiness.fixtureSetId, '/dataReadiness/fixtureSetId');
    requireSha256(data.dataReadiness.fixtureSetDigest, '/dataReadiness/fixtureSetDigest');
    const requestIds = new Set();
    if (requireArray(data.dataReadiness.requestMatches, '/dataReadiness/requestMatches')) {
      data.dataReadiness.requestMatches.forEach((request, index) => {
        const pointer = `/dataReadiness/requestMatches/${index}`;
        if (!requireObject(request, pointer)) return;
        if (requireString(request.requestId, `${pointer}/requestId`)) {
          if (requestIds.has(request.requestId)) issue(errors, `${pointer}/requestId`, 'must be unique');
          requestIds.add(request.requestId);
        }
        requireNumber(request.count, `${pointer}/count`, { min: 0, integer: true });
        requireSha256(request.responseSha256, `${pointer}/responseSha256`);
      });
    }
    requireArray(data.dataReadiness.unmatchedBusinessRequests, '/dataReadiness/unmatchedBusinessRequests');
    if (requireObject(data.dataReadiness.runtime, '/dataReadiness/runtime')) {
      requireBoolean(data.dataReadiness.runtime.timeFrozen, '/dataReadiness/runtime/timeFrozen');
      requireString(data.dataReadiness.runtime.now, '/dataReadiness/runtime/now');
      requireBoolean(data.dataReadiness.runtime.randomFrozen, '/dataReadiness/runtime/randomFrozen');
      requireString(data.dataReadiness.runtime.randomSeed, '/dataReadiness/runtime/randomSeed');
      requireString(data.dataReadiness.runtime.timezone, '/dataReadiness/runtime/timezone');
      requireString(data.dataReadiness.runtime.locale, '/dataReadiness/runtime/locale');
      requireBoolean(data.dataReadiness.runtime.storageSeeded, '/dataReadiness/runtime/storageSeeded');
    }
    if (requireArray(data.dataReadiness.visibleAssertions, '/dataReadiness/visibleAssertions')) {
      data.dataReadiness.visibleAssertions.forEach((assertion, index) => {
        const pointer = `/dataReadiness/visibleAssertions/${index}`;
        if (!requireObject(assertion, pointer)) return;
        requireString(assertion.id, `${pointer}/id`);
        if (!('actual' in assertion)) issue(errors, `${pointer}/actual`, 'is required');
      });
    }
    requireBoolean(data.dataReadiness.networkSettled, '/dataReadiness/networkSettled');
    requireBoolean(data.dataReadiness.dataSettled, '/dataReadiness/dataSettled');
  }
  if (data.visualLabReadiness !== undefined && requireObject(data.visualLabReadiness, '/visualLabReadiness')) {
    requireString(data.visualLabReadiness.labId, '/visualLabReadiness/labId');
    requireSha256(data.visualLabReadiness.lockSha256, '/visualLabReadiness/lockSha256');
    requireBoolean(data.visualLabReadiness.readyMarker, '/visualLabReadiness/readyMarker');
    requireBoolean(data.visualLabReadiness.captureModeEnabled, '/visualLabReadiness/captureModeEnabled');
    requireArray(data.visualLabReadiness.externalNetworkRequests, '/visualLabReadiness/externalNetworkRequests');
  }
  validateMeasurementSpace(data.measurementSpace, '/measurementSpace');
  validateVisualMeasurements(data.visualMeasurements, '/visualMeasurements', {
    width: data.actual?.canvasWidth,
    height: data.actual?.canvasHeight
  });
  if (requireArray(data.anchors, '/anchors')) {
    data.anchors.forEach((anchor, index) => {
      const pointer = `/anchors/${index}`;
      if (!requireObject(anchor, pointer)) return;
      requireString(anchor.id, `${pointer}/id`);
      requireNumber(anchor.delta, `${pointer}/delta`, { min: 0 });
      requireNumber(anchor.tolerance, `${pointer}/tolerance`, { min: 0 });
    });
  }
  if (requireArray(data.captureOnlyMutations, '/captureOnlyMutations')) {
    data.captureOnlyMutations.forEach((mutation, index) => {
      const pointer = `/captureOnlyMutations/${index}`;
      if (!requireObject(mutation, pointer)) return;
      for (const key of ['selector', 'property', 'value', 'reason']) requireString(mutation[key], `${pointer}/${key}`);
      validateBbox(mutation.targetBboxBefore, `${pointer}/targetBboxBefore`);
      validateBbox(mutation.targetBboxAfter, `${pointer}/targetBboxAfter`);
    });
  }
  requireArray(data.blockers, '/blockers');
}

function validateVisualContract(data) {
  if (!requireObject(data.source, '/source')) return;
  const source = data.source;
  requireString(source.referenceImage, '/source/referenceImage');
  requireNumber(source.imageWidth, '/source/imageWidth', { min: 1, integer: true });
  requireNumber(source.imageHeight, '/source/imageHeight', { min: 1, integer: true });
  if (requireObject(source.viewport, '/source/viewport')) {
    requireNumber(source.viewport.width, '/source/viewport/width', { min: 1 });
    requireNumber(source.viewport.height, '/source/viewport/height', { min: 1 });
  }
  requireNumber(source.dpr, '/source/dpr', { min: 0.1 });
  requireNumber(source.pixelToCssScale, '/source/pixelToCssScale', { min: 0.0001 });
  requireString(source.state, '/source/state');
  validateBbox(source.crop, '/source/crop', { width: source.imageWidth, height: source.imageHeight });

  requireObject(data.tokens, '/tokens');
  const regionIds = new Set();
  const elementIds = new Set();
  const allowedConfidence = ['high', 'medium', 'low'];
  const allowedCriticality = ['critical', 'important', 'normal'];
  if (requireArray(data.regions, '/regions', { nonEmpty: true })) {
    data.regions.forEach((region, index) => {
      const pointer = `/regions/${index}`;
      if (!requireObject(region, pointer)) return;
      if (requireString(region.id, `${pointer}/id`)) {
        if (regionIds.has(region.id)) issue(errors, `${pointer}/id`, 'must be unique');
        regionIds.add(region.id);
      }
      if (region.parentId !== null && region.parentId !== undefined) requireString(region.parentId, `${pointer}/parentId`);
      requireString(region.role, `${pointer}/role`);
      validateBbox(region.bbox, `${pointer}/bbox`, { width: source.imageWidth, height: source.imageHeight });
      if (requireObject(region.layout, `${pointer}/layout`)) {
        for (const key of ['display', 'direction', 'sizing', 'alignItems', 'justifyContent', 'padding', 'gap', 'overflow']) {
          if (!(key in region.layout)) issue(errors, `${pointer}/layout/${key}`, 'is required');
        }
        if (Array.isArray(region.layout.padding) && region.layout.padding.length !== 4) {
          issue(errors, `${pointer}/layout/padding`, 'must contain [top, right, bottom, left]');
        }
      }
      validateAppearance(region.appearance, `${pointer}/appearance`);
      validateEvidence(region.evidence, `${pointer}/evidence`);
      requireEnum(region.confidence, `${pointer}/confidence`, allowedConfidence);
      requireEnum(region.criticality, `${pointer}/criticality`, allowedCriticality);
      if (requireArray(region.elements, `${pointer}/elements`)) {
        region.elements.forEach((element, elementIndex) => {
          const elementPointer = `${pointer}/elements/${elementIndex}`;
          if (!requireObject(element, elementPointer)) return;
          if (requireString(element.id, `${elementPointer}/id`)) {
            if (elementIds.has(element.id) || regionIds.has(element.id)) {
              issue(errors, `${elementPointer}/id`, 'must be globally unique across regions and elements');
            }
            elementIds.add(element.id);
          }
          requireString(element.role, `${elementPointer}/role`);
          validateBbox(element.bbox, `${elementPointer}/bbox`, { width: source.imageWidth, height: source.imageHeight });
          if (!('content' in element)) issue(errors, `${elementPointer}/content`, 'is required; use null for non-text elements');
          validateAppearance(element.appearance, `${elementPointer}/appearance`);
          if (!('typography' in element)) issue(errors, `${elementPointer}/typography`, 'is required; use null when not applicable');
          if (!('asset' in element)) issue(errors, `${elementPointer}/asset`, 'is required; use null when not applicable');
          validateEvidence(element.evidence, `${elementPointer}/evidence`);
          requireEnum(element.confidence, `${elementPointer}/confidence`, allowedConfidence);
          requireBoolean(element.required, `${elementPointer}/required`);
        });
      }
    });
  }
  data.regions?.forEach((region, index) => {
    if (region.parentId && !regionIds.has(region.parentId)) {
      issue(errors, `/regions/${index}/parentId`, 'must reference an existing region id');
    }
  });
  requireArray(data.uncertainties, '/uncertainties');
  if (requireObject(data.coverage, '/coverage')) {
    for (const key of [
      'allVisibleRegionsCaptured',
      'allRequiredElementsCaptured',
      'allCriticalGeometryMeasured',
      'allTypographyRisksRecorded'
    ]) requireBoolean(data.coverage[key], `/coverage/${key}`);
    requireNumber(data.coverage.unresolvedLowConfidenceCount, '/coverage/unresolvedLowConfidenceCount', { min: 0, integer: true });
    const lowCount = [...(data.regions ?? [])].reduce((count, region) => {
      const regionLow = region.confidence === 'low' ? 1 : 0;
      const elementLow = (region.elements ?? []).filter((element) => element.confidence === 'low').length;
      return count + regionLow + elementLow;
    }, 0);
    if (Number.isInteger(data.coverage.unresolvedLowConfidenceCount) && data.coverage.unresolvedLowConfidenceCount < lowCount) {
      issue(warnings, '/coverage/unresolvedLowConfidenceCount', `is lower than ${lowCount} low-confidence region/element records`);
    }
  }
  requireArray(data.changeLog, '/changeLog');
}

function validateComponentAdaptation(data) {
  requireString(data.visualContract, '/visualContract');
  if (requireObject(data.library, '/library')) requireString(data.library.name, '/library/name');
  const decisions = [
    'use-library-as-is',
    'use-library-with-overrides',
    'headless-or-native',
    'custom-wrapper',
    'revisit-visual-contract'
  ];
  const ids = new Set();
  if (requireArray(data.mappings, '/mappings', { nonEmpty: true })) {
    data.mappings.forEach((mapping, index) => {
      const pointer = `/mappings/${index}`;
      if (!requireObject(mapping, pointer)) return;
      if (requireString(mapping.elementId, `${pointer}/elementId`)) {
        if (ids.has(mapping.elementId)) issue(errors, `${pointer}/elementId`, 'must be unique');
        ids.add(mapping.elementId);
      }
      for (const key of ['component', 'source', 'composition', 'behaviorOwnership', 'dataOwnership']) {
        requireString(mapping[key], `${pointer}/${key}`);
      }
      requireNumber(mapping.semanticFit, `${pointer}/semanticFit`, { min: 0, max: 1 });
      requireNumber(mapping.styleCompatibility, `${pointer}/styleCompatibility`, { min: 0, max: 1 });
      requireEnum(mapping.decision, `${pointer}/decision`, decisions);
      requireObject(mapping.styleOwnership, `${pointer}/styleOwnership`);
      requireObject(mapping.requiredOverrides, `${pointer}/requiredOverrides`);
      requireArray(mapping.overrideEntrypoints, `${pointer}/overrideEntrypoints`);
      if (requireObject(mapping.acceptancePolicy, `${pointer}/acceptancePolicy`)) {
        requireEnum(mapping.acceptancePolicy.profile, `${pointer}/acceptancePolicy/profile`, ['structure-faithful', 'component-faithful', 'pixel-faithful']);
        if (requireObject(mapping.acceptancePolicy.geometryTolerancePx, `${pointer}/acceptancePolicy/geometryTolerancePx`)) {
          requireNumber(mapping.acceptancePolicy.geometryTolerancePx.position, `${pointer}/acceptancePolicy/geometryTolerancePx/position`, { min: 0 });
          requireNumber(mapping.acceptancePolicy.geometryTolerancePx.size, `${pointer}/acceptancePolicy/geometryTolerancePx/size`, { min: 0 });
        }
        requireNumber(mapping.acceptancePolicy.minimumIou, `${pointer}/acceptancePolicy/minimumIou`, { min: 0, max: 1 });
        if (requireObject(mapping.acceptancePolicy.typographyTolerance, `${pointer}/acceptancePolicy/typographyTolerance`)) {
          requireNumber(mapping.acceptancePolicy.typographyTolerance.fontSizePx, `${pointer}/acceptancePolicy/typographyTolerance/fontSizePx`, { min: 0 });
          requireNumber(mapping.acceptancePolicy.typographyTolerance.lineHeightPx, `${pointer}/acceptancePolicy/typographyTolerance/lineHeightPx`, { min: 0 });
          requireNumber(mapping.acceptancePolicy.typographyTolerance.fontWeight, `${pointer}/acceptancePolicy/typographyTolerance/fontWeight`, { min: 0 });
        }
        if (requireArray(mapping.acceptancePolicy.allowedLibraryVariations, `${pointer}/acceptancePolicy/allowedLibraryVariations`)) {
          const forbidden = new Set(['present', 'visible', 'content', 'state', 'overflow', 'occlusion']);
          mapping.acceptancePolicy.allowedLibraryVariations.forEach((variation, variationIndex) => {
            const variationPointer = `${pointer}/acceptancePolicy/allowedLibraryVariations/${variationIndex}`;
            if (!requireObject(variation, variationPointer)) return;
            requireString(variation.property, `${variationPointer}/property`);
            requireString(variation.invariant, `${variationPointer}/invariant`);
            requireString(variation.reason, `${variationPointer}/reason`);
            if (variation.maximumDelta !== null) requireNumber(variation.maximumDelta, `${variationPointer}/maximumDelta`, { min: 0 });
            if (forbidden.has(variation.property)) issue(errors, `${variationPointer}/property`, 'cannot relax a non-negotiable hard gate');
          });
        }
        if (requireArray(mapping.acceptancePolicy.nonNegotiable, `${pointer}/acceptancePolicy/nonNegotiable`, { nonEmpty: true })) {
          for (const required of ['present', 'visible', 'content', 'state', 'no-overflow', 'no-occlusion']) {
            if (!mapping.acceptancePolicy.nonNegotiable.includes(required)) {
              issue(errors, `${pointer}/acceptancePolicy/nonNegotiable`, `must include ${required}`);
            }
          }
        }
      }
      requireArray(mapping.visualRisks, `${pointer}/visualRisks`);
      requireArray(mapping.evidence, `${pointer}/evidence`, { nonEmpty: true });
      if (mapping.styleCompatibility < 0.5 && mapping.decision === 'use-library-as-is') {
        issue(errors, `${pointer}/decision`, 'cannot use library as-is when styleCompatibility is below 0.5');
      }
      if (Object.keys(mapping.requiredOverrides ?? {}).length > 0 && (mapping.overrideEntrypoints ?? []).length === 0) {
        issue(errors, `${pointer}/overrideEntrypoints`, 'must identify an entrypoint for required overrides');
      }
    });
  }
  requireArray(data.openQuestions, '/openQuestions');
  if (requireObject(data.validation, '/validation')) {
    for (const key of [
      'allRequiredElementsMapped',
      'allOverridesHaveEntrypoints',
      'noUnownedCriticalStyles',
      'noBlockingCompatibilityRisk'
    ]) requireBoolean(data.validation[key], `/validation/${key}`);
  }
}

function validateAcceptanceProfile(profile, pointer) {
  if (!requireObject(profile, pointer)) return;
  requireString(profile.description, `${pointer}/description`);
  if (requireObject(profile.geometry, `${pointer}/geometry`)) {
    requireNumber(profile.geometry.positionTolerancePx, `${pointer}/geometry/positionTolerancePx`, { min: 0 });
    requireNumber(profile.geometry.sizeTolerancePx, `${pointer}/geometry/sizeTolerancePx`, { min: 0 });
    requireNumber(profile.geometry.minimumIou, `${pointer}/geometry/minimumIou`, { min: 0, max: 1 });
    requireNumber(profile.geometry.minimumCriticalIou, `${pointer}/geometry/minimumCriticalIou`, { min: 0, max: 1 });
  }
  if (requireObject(profile.typography, `${pointer}/typography`)) {
    requireBoolean(profile.typography.enabled, `${pointer}/typography/enabled`);
    requireNumber(profile.typography.fontSizeTolerancePx, `${pointer}/typography/fontSizeTolerancePx`, { min: 0 });
    requireNumber(profile.typography.lineHeightTolerancePx, `${pointer}/typography/lineHeightTolerancePx`, { min: 0 });
    requireNumber(profile.typography.fontWeightTolerance, `${pointer}/typography/fontWeightTolerance`, { min: 0 });
  }
  if (requireObject(profile.perceptual, `${pointer}/perceptual`)) {
    requireEnum(profile.perceptual.role, `${pointer}/perceptual/role`, ['diagnostic-only', 'scored', 'hard-gate']);
    requireNumber(profile.perceptual.downsampleFactor, `${pointer}/perceptual/downsampleFactor`, { min: 1, max: 64, integer: true });
    requireNumber(profile.perceptual.minimumGlobalSimilarity, `${pointer}/perceptual/minimumGlobalSimilarity`, { min: 0, max: 1 });
    requireNumber(profile.perceptual.minimumCriticalRegionSimilarity, `${pointer}/perceptual/minimumCriticalRegionSimilarity`, { min: 0, max: 1 });
  }
  if (requireObject(profile.rawPixel, `${pointer}/rawPixel`)) {
    requireEnum(profile.rawPixel.role, `${pointer}/rawPixel/role`, ['diagnostic-only', 'scored', 'hard-gate']);
    requireNumber(profile.rawPixel.threshold, `${pointer}/rawPixel/threshold`, { min: 0, max: 255 });
    requireNumber(profile.rawPixel.maximumMeanAbsoluteError, `${pointer}/rawPixel/maximumMeanAbsoluteError`, { min: 0, max: 1 });
    requireNumber(profile.rawPixel.maximumDifferentPixelRatio, `${pointer}/rawPixel/maximumDifferentPixelRatio`, { min: 0, max: 1 });
    requireNumber(profile.rawPixel.maximumCriticalRegionDifferentPixelRatio, `${pointer}/rawPixel/maximumCriticalRegionDifferentPixelRatio`, { min: 0, max: 1 });
  }
  if (requireObject(profile.scoring, `${pointer}/scoring`)) {
    requireNumber(profile.scoring.minimumOverall, `${pointer}/scoring/minimumOverall`, { min: 0, max: 1 });
    requireNumber(profile.scoring.minimumCriticalRegion, `${pointer}/scoring/minimumCriticalRegion`, { min: 0, max: 1 });
    requireNumber(profile.scoring.minimumImportantElement, `${pointer}/scoring/minimumImportantElement`, { min: 0, max: 1 });
    requireNumber(profile.scoring.minimumNormalTarget, `${pointer}/scoring/minimumNormalTarget`, { min: 0, max: 1 });
    if (requireObject(profile.scoring.weights, `${pointer}/scoring/weights`)) {
      for (const key of ['geometry', 'typography', 'perceptual', 'rawPixel']) {
        requireNumber(profile.scoring.weights[key], `${pointer}/scoring/weights/${key}`, { min: 0, max: 1 });
      }
      const total = Object.values(profile.scoring.weights).reduce((sum, weight) => sum + (Number.isFinite(weight) ? weight : 0), 0);
      if (total <= 0) issue(errors, `${pointer}/scoring/weights`, 'must contain at least one positive weight');
    }
  }
}

function validateAcceptancePolicy(data) {
  requireEnum(data.activeProfile, '/activeProfile', ['structure-faithful', 'component-faithful', 'pixel-faithful']);
  if (requireObject(data.profiles, '/profiles')) {
    for (const name of ['structure-faithful', 'component-faithful', 'pixel-faithful']) {
      validateAcceptanceProfile(data.profiles[name], `/profiles/${name}`);
    }
    if (!(data.activeProfile in data.profiles)) issue(errors, '/activeProfile', 'must reference a profile in /profiles');
  }
  if (requireObject(data.hardGates, '/hardGates')) {
    for (const key of ['scopeAligned', 'dataFixtureMatched', 'stateMatched', 'requiredElementsComplete', 'contentMatched', 'noOverflowOrOcclusion']) {
      requireBoolean(data.hardGates[key], `/hardGates/${key}`);
    }
    requireNumber(data.hardGates.maximumOcclusionRatio, '/hardGates/maximumOcclusionRatio', { min: 0, max: 1 });
  }
}

function validateVisualEvaluation(data) {
  requireEnum(data.profile, '/profile', ['structure-faithful', 'component-faithful', 'pixel-faithful']);
  if (requireObject(data.inputs, '/inputs')) {
    for (const key of ['policy', 'visualContract', 'componentAdaptation', 'alignmentReport', 'pixelReport']) requireString(data.inputs[key], `/inputs/${key}`);
  }
  if (requireObject(data.hardGates, '/hardGates')) {
    for (const key of ['scopeAligned', 'dataFixtureMatched', 'stateMatched', 'requiredElementsComplete', 'contentMatched', 'noOverflowOrOcclusion']) {
      requireBoolean(data.hardGates[key], `/hardGates/${key}`);
    }
  }
  if (requireObject(data.scores, '/scores')) {
    for (const key of ['overall', 'minimumCriticalRegion', 'minimumImportantElement', 'perceptualGlobal']) {
      requireNumber(data.scores[key], `/scores/${key}`, { min: 0, max: 1 });
    }
  }
  if (requireArray(data.targets, '/targets', { nonEmpty: true })) {
    data.targets.forEach((target, index) => {
      const pointer = `/targets/${index}`;
      if (!requireObject(target, pointer)) return;
      requireString(target.id, `${pointer}/id`);
      requireEnum(target.type, `${pointer}/type`, ['region', 'element']);
      requireEnum(target.criticality, `${pointer}/criticality`, ['critical', 'important', 'normal']);
      requireNumber(target.score, `${pointer}/score`, { min: 0, max: 1 });
      requireBoolean(target.passed, `${pointer}/passed`);
      if (requireObject(target.geometry, `${pointer}/geometry`)) {
        requireNumber(target.geometry.positionDeltaPx, `${pointer}/geometry/positionDeltaPx`, { min: 0 });
        requireNumber(target.geometry.sizeDeltaPx, `${pointer}/geometry/sizeDeltaPx`, { min: 0 });
        requireNumber(target.geometry.iou, `${pointer}/geometry/iou`, { min: 0, max: 1 });
        requireNumber(target.geometry.score, `${pointer}/geometry/score`, { min: 0, max: 1 });
        requireBoolean(target.geometry.passed, `${pointer}/geometry/passed`);
      }
      if (target.typography !== null && requireObject(target.typography, `${pointer}/typography`)) {
        requireNumber(target.typography.score, `${pointer}/typography/score`, { min: 0, max: 1 });
        requireBoolean(target.typography.passed, `${pointer}/typography/passed`);
      }
      if (target.perceptual !== null && requireObject(target.perceptual, `${pointer}/perceptual`)) {
        requireNumber(target.perceptual.similarity, `${pointer}/perceptual/similarity`, { min: 0, max: 1 });
        requireBoolean(target.perceptual.passed, `${pointer}/perceptual/passed`);
      }
      if (requireObject(target.rawPixel, `${pointer}/rawPixel`)) {
        requireEnum(target.rawPixel.role, `${pointer}/rawPixel/role`, ['diagnostic-only', 'scored', 'hard-gate']);
        if (target.rawPixel.meanAbsoluteError !== null) requireNumber(target.rawPixel.meanAbsoluteError, `${pointer}/rawPixel/meanAbsoluteError`, { min: 0, max: 1 });
        if (target.rawPixel.differentPixelRatio !== null) requireNumber(target.rawPixel.differentPixelRatio, `${pointer}/rawPixel/differentPixelRatio`, { min: 0, max: 1 });
        requireBoolean(target.rawPixel.passedDiagnosticThresholds, `${pointer}/rawPixel/passedDiagnosticThresholds`);
      }
      requireArray(target.failures, `${pointer}/failures`);
      if (target.passed === true && (target.failures ?? []).length > 0) issue(errors, `${pointer}/passed`, 'cannot pass while failures are present');
    });
  }
  requireArray(data.failures, '/failures');
  if (requireObject(data.diagnostics, '/diagnostics')) {
    requireEnum(data.diagnostics.rawPixelRole, '/diagnostics/rawPixelRole', ['diagnostic-only', 'scored', 'hard-gate']);
    requireBoolean(data.diagnostics.rawPixelThresholdsPassed, '/diagnostics/rawPixelThresholdsPassed');
    requireString(data.diagnostics.note, '/diagnostics/note');
  }
  requireEnum(data.status, '/status', ['pass', 'needs-repair', 'blocked']);
  if (data.status === 'pass') {
    if (Object.values(data.hardGates ?? {}).some((value) => value !== true)) issue(errors, '/status', 'cannot pass while hard gates fail');
    if ((data.failures ?? []).length > 0) issue(errors, '/status', 'cannot pass while failures are present');
    if ((data.targets ?? []).some((target) => target.passed !== true)) issue(errors, '/status', 'cannot pass while a target fails');
  }
}

function validateSandboxBoundary(value, pointer) {
  if (!requireObject(value, pointer)) return;
  for (const key of ['targetProjectRead', 'targetProjectModified', 'migrationIncluded', 'integrationValidationIncluded']) {
    requireBoolean(value[key], `${pointer}/${key}`);
    if (value[key] !== false) issue(errors, `${pointer}/${key}`, 'must be false in the sandbox-only version');
  }
}

function validateVisualLabManifest(data) {
  if (requireString(data.labId, '/labId') && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(data.labId)) {
    issue(errors, '/labId', 'must contain lowercase letters, digits, and hyphens only');
  }
  requireEnum(data.executionScope, '/executionScope', ['sandbox-only']);
  requireEnum(data.template, '/template', ['vanilla-vite']);
  requireString(data.reference, '/reference');
  requireString(data.rootSelector, '/rootSelector');
  if (!String(data.rootSelector ?? '').includes('data-visual-id')) issue(errors, '/rootSelector', 'must use data-visual-id');
  if (requireObject(data.server, '/server')) {
    requireEnum(data.server.host, '/server/host', ['127.0.0.1']);
    requireNumber(data.server.port, '/server/port', { min: 1024, max: 65535, integer: true });
    requireString(data.server.path, '/server/path');
  }
  if (requireObject(data.render, '/render')) {
    if (requireObject(data.render.viewport, '/render/viewport')) {
      requireNumber(data.render.viewport.width, '/render/viewport/width', { min: 1, integer: true });
      requireNumber(data.render.viewport.height, '/render/viewport/height', { min: 1, integer: true });
    }
    requireNumber(data.render.dpr, '/render/dpr', { min: 0.1 });
    requireNumber(data.render.zoom, '/render/zoom', { min: 0.1 });
  }
  if (requireObject(data.fixture, '/fixture')) {
    requireString(data.fixture.path, '/fixture/path');
    requireEnum(data.fixture.mode, '/fixture/mode', ['static-json']);
    requireEnum(data.fixture.networkAccess, '/fixture/networkAccess', ['forbidden']);
  }
  const sourceFiles = new Set();
  if (requireArray(data.sourceFiles, '/sourceFiles', { nonEmpty: true })) {
    data.sourceFiles.forEach((file, index) => {
      if (requireString(file, `/sourceFiles/${index}`)) {
        if (sourceFiles.has(file)) issue(errors, `/sourceFiles/${index}`, 'must be unique');
        sourceFiles.add(file);
        if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) issue(errors, `/sourceFiles/${index}`, 'must stay inside the Visual Lab root');
      }
    });
  }
  if (requireObject(data.dependencyPolicy, '/dependencyPolicy')) {
    requireArray(data.dependencyPolicy.allowedRuntimeDependencies, '/dependencyPolicy/allowedRuntimeDependencies');
    requireArray(data.dependencyPolicy.allowedDevDependencies, '/dependencyPolicy/allowedDevDependencies', { nonEmpty: true });
    if ((data.dependencyPolicy.allowedRuntimeDependencies ?? []).length > 0) {
      issue(errors, '/dependencyPolicy/allowedRuntimeDependencies', 'must be empty in the basic UI sandbox');
    }
    if (JSON.stringify(data.dependencyPolicy.allowedDevDependencies) !== JSON.stringify(['vite'])) {
      issue(errors, '/dependencyPolicy/allowedDevDependencies', 'must contain only vite');
    }
  }
  if (requireObject(data.determinism, '/determinism')) {
    for (const key of ['freezeTime', 'freezeRandom', 'disableAnimations', 'localAssetsOnly']) {
      requireBoolean(data.determinism[key], `/determinism/${key}`);
      if (data.determinism[key] !== true) issue(errors, `/determinism/${key}`, 'must be true');
    }
  }
  validateSandboxBoundary(data.boundary, '/boundary');
}

function validateVisualLabLock(data) {
  requireString(data.labId, '/labId');
  requireEnum(data.executionScope, '/executionScope', ['sandbox-only']);
  requireString(data.manifest, '/manifest');
  if (requireObject(data.fixture, '/fixture')) {
    requireString(data.fixture.path, '/fixture/path');
    requireSha256(data.fixture.sha256, '/fixture/sha256');
  }
  const filePaths = new Set();
  if (requireArray(data.files, '/files', { nonEmpty: true })) {
    data.files.forEach((file, index) => {
      const pointer = `/files/${index}`;
      if (!requireObject(file, pointer)) return;
      if (requireString(file.path, `${pointer}/path`)) {
        if (filePaths.has(file.path)) issue(errors, `${pointer}/path`, 'must be unique');
        filePaths.add(file.path);
      }
      requireNumber(file.bytes, `${pointer}/bytes`, { min: 1, integer: true });
      requireSha256(file.sha256, `${pointer}/sha256`);
    });
  }
  requireBoolean(data.networkAccessVerifiedForbidden, '/networkAccessVerifiedForbidden');
  if (data.networkAccessVerifiedForbidden !== true) issue(errors, '/networkAccessVerifiedForbidden', 'must be true before sealing');
  validateSandboxBoundary(data.boundary, '/boundary');
  requireEnum(data.status, '/status', ['sealed']);
}

function validateVisualLabAcceptance(data) {
  requireString(data.labId, '/labId');
  requireEnum(data.executionScope, '/executionScope', ['sandbox-only']);
  requireString(data.reference, '/reference');
  requireString(data.visualLabLock, '/visualLabLock');
  requireString(data.evaluationReport, '/evaluationReport');
  requireNumber(data.acceptedIteration, '/acceptedIteration', { min: 0, integer: true });
  requireEnum(data.profile, '/profile', ['structure-faithful', 'component-faithful', 'pixel-faithful']);
  for (const key of ['scopeAlignmentVerified', 'staticFixtureVerified', 'environmentVerified', 'requiredElementsComplete', 'criticalRegionsPassing']) {
    requireBoolean(data[key], `/${key}`);
  }
  if (requireObject(data.hardGates, '/hardGates')) {
    for (const key of ['scopeAligned', 'dataFixtureMatched', 'stateMatched', 'requiredElementsComplete', 'contentMatched', 'noOverflowOrOcclusion']) {
      requireBoolean(data.hardGates[key], `/hardGates/${key}`);
    }
  }
  if (requireObject(data.scores, '/scores')) {
    for (const key of ['overall', 'minimumCriticalRegion', 'minimumImportantElement', 'perceptualGlobal']) {
      requireNumber(data.scores[key], `/scores/${key}`, { min: 0, max: 1 });
    }
  }
  validateSandboxBoundary(data.boundary, '/boundary');
  requireArray(data.remainingNonBlockingDifferences, '/remainingNonBlockingDifferences');
  requireEnum(data.status, '/status', ['pass', 'blocked']);
  if (data.status === 'pass') {
    for (const key of ['scopeAlignmentVerified', 'staticFixtureVerified', 'environmentVerified', 'requiredElementsComplete', 'criticalRegionsPassing']) {
      if (data[key] !== true) issue(errors, '/status', `cannot pass while ${key} is false`);
    }
    if (Object.values(data.hardGates ?? {}).some((value) => value !== true)) issue(errors, '/status', 'cannot pass while a hard gate is false');
  }
}

function validateIterationReport(data) {
  requireNumber(data.iteration, '/iteration', { min: 0, integer: true });
  if (requireObject(data.inputs, '/inputs')) {
    for (const key of ['reference', 'actual', 'diff', 'pixelReport', 'alignmentReport', 'visualEvaluation']) requireString(data.inputs[key], `/inputs/${key}`);
  }
  if (requireObject(data.environment, '/environment')) {
    for (const key of ['scopeAlignmentPassed', 'dataFixtureMatched', 'viewportMatch', 'dprMatch', 'cropMatch', 'stateMatch', 'fontsReady', 'assetsReady', 'animationsFrozen']) {
      requireBoolean(data.environment[key], `/environment/${key}`);
    }
  }
  if (requireObject(data.metrics, '/metrics')) {
    requireEnum(data.metrics.profile, '/metrics/profile', ['structure-faithful', 'component-faithful', 'pixel-faithful']);
    requireNumber(data.metrics.overallScore, '/metrics/overallScore', { min: 0, max: 1 });
    requireNumber(data.metrics.minimumCriticalRegionScore, '/metrics/minimumCriticalRegionScore', { min: 0, max: 1 });
    requireNumber(data.metrics.perceptualSimilarity, '/metrics/perceptualSimilarity', { min: 0, max: 1 });
    requireNumber(data.metrics.meanAbsoluteError, '/metrics/meanAbsoluteError', { min: 0, max: 1 });
    requireNumber(data.metrics.differentPixelRatio, '/metrics/differentPixelRatio', { min: 0, max: 1 });
    requireNumber(data.metrics.criticalRegionsPassing, '/metrics/criticalRegionsPassing', { min: 0, integer: true });
    requireNumber(data.metrics.criticalRegionsTotal, '/metrics/criticalRegionsTotal', { min: 0, integer: true });
  }
  const diagnosisIds = new Set();
  if (requireArray(data.diagnoses, '/diagnoses')) {
    data.diagnoses.forEach((diagnosis, index) => {
      const pointer = `/diagnoses/${index}`;
      if (!requireObject(diagnosis, pointer)) return;
      if (requireString(diagnosis.id, `${pointer}/id`)) {
        if (diagnosisIds.has(diagnosis.id)) issue(errors, `${pointer}/id`, 'must be unique');
        diagnosisIds.add(diagnosis.id);
      }
      requireString(diagnosis.regionId, `${pointer}/regionId`);
      requireEnum(diagnosis.category, `${pointer}/category`, ['environment', 'geometry', 'typography', 'surface', 'asset', 'state', 'unknown']);
      for (const key of ['targetEvidence', 'actualObservation', 'metricEvidence', 'rootCause', 'verification']) {
        requireString(diagnosis[key], `${pointer}/${key}`);
      }
      requireEnum(diagnosis.confidence, `${pointer}/confidence`, ['high', 'medium', 'low']);
    });
  }
  const repairIds = new Set();
  if (requireArray(data.repairs, '/repairs')) {
    data.repairs.forEach((repair, index) => {
      const pointer = `/repairs/${index}`;
      if (!requireObject(repair, pointer)) return;
      if (requireString(repair.id, `${pointer}/id`)) {
        if (repairIds.has(repair.id)) issue(errors, `${pointer}/id`, 'must be unique');
        repairIds.add(repair.id);
      }
      requireString(repair.diagnosisId, `${pointer}/diagnosisId`);
      if (!diagnosisIds.has(repair.diagnosisId)) issue(errors, `${pointer}/diagnosisId`, 'must reference a diagnosis in this report');
      requireArray(repair.files, `${pointer}/files`, { nonEmpty: true });
      requireArray(repair.targets, `${pointer}/targets`, { nonEmpty: true });
      requireArray(repair.properties, `${pointer}/properties`, { nonEmpty: true });
      requireString(repair.expectedEffect, `${pointer}/expectedEffect`);
      requireArray(repair.protectedRegions, `${pointer}/protectedRegions`);
      requireEnum(repair.status, `${pointer}/status`, ['proposed', 'applied', 'rejected']);
    });
  }
  if ((data.repairs ?? []).length > 3) issue(errors, '/repairs', 'must contain at most three repairs per iteration');
  requireArray(data.regressions, '/regressions');
  if (requireObject(data.gate, '/gate')) {
    requireEnum(data.gate.status, '/gate/status', ['needs-repair', 'regressed', 'blocked', 'pass']);
    requireArray(data.gate.reasons, '/gate/reasons', { nonEmpty: true });
    requireEnum(data.gate.authority, '/gate/authority', ['visual-evaluation']);
    const environmentOk = Object.values(data.environment ?? {}).every((value) => value === true);
    if (data.gate.status === 'pass' && !environmentOk) issue(errors, '/gate/status', 'cannot pass while render environment checks fail');
  }
}

function validateRunState(data) {
  requireEnum(data.phase, '/phase', ['contract', 'generation', 'capture', 'repair', 'acceptance', 'complete', 'blocked']);
  requireNumber(data.iteration, '/iteration', { min: 0, integer: true });
  requireString(data.artifactRoot, '/artifactRoot');
  requireEnum(data.profile, '/profile', ['structure-faithful', 'component-faithful', 'pixel-faithful']);
  if (requireObject(data.artifacts, '/artifacts')) {
    for (const key of ['reference', 'sourceManifest', 'visualContract', 'renderPlan', 'acceptancePolicy', 'visualLab', 'visualLabLock', 'alignmentReport', 'pixelReport', 'visualEvaluation', 'iterationDelta']) {
      if (data.artifacts[key] !== null) requireString(data.artifacts[key], `/artifacts/${key}`);
    }
  }
  if (requireObject(data.digests, '/digests')) {
    for (const [key, value] of Object.entries(data.digests)) requireSha256(value, `/digests/${key}`);
  }
  if (requireArray(data.activeTargets, '/activeTargets')) {
    const ids = new Set();
    data.activeTargets.forEach((id, index) => {
      if (requireString(id, `/activeTargets/${index}`)) {
        if (ids.has(id)) issue(errors, `/activeTargets/${index}`, 'must be unique');
        ids.add(id);
      }
    });
  }
  if (requireObject(data.gates, '/gates')) {
    for (const key of ['visualLab', 'alignment', 'visualEvaluation']) {
      requireEnum(data.gates[key], `/gates/${key}`, ['pending', 'pass', 'blocked', 'needs-repair', 'needs-review']);
    }
  }
  if (requireObject(data.budget, '/budget')) {
    for (const key of ['maximumTextTokens', 'maximumImages', 'maximumTargets']) {
      requireNumber(data.budget[key], `/budget/${key}`, { min: 0, integer: true });
    }
    if ((data.activeTargets ?? []).length > (data.budget.maximumTargets ?? Infinity)) {
      issue(errors, '/activeTargets', 'must not exceed budget.maximumTargets');
    }
    if (data.phase === 'repair' && data.budget.maximumTargets > 3) issue(errors, '/budget/maximumTargets', 'repair phase cannot exceed three targets');
  }
  requireString(data.nextAction, '/nextAction');
}

function validateContextPacket(data) {
  requireEnum(data.phase, '/phase', ['contract', 'generation', 'capture', 'repair', 'acceptance', 'complete', 'blocked']);
  requireNumber(data.iteration, '/iteration', { min: 0, integer: true });
  requireString(data.goal, '/goal');
  for (const [key, nonEmpty] of [['invariants', true], ['allowedFiles', false]]) {
    if (requireArray(data[key], `/${key}`, { nonEmpty })) {
      data[key].forEach((value, index) => requireString(value, `/${key}/${index}`));
    }
  }
  if (requireObject(data.canonicalArtifacts, '/canonicalArtifacts')) {
    for (const [key, artifact] of Object.entries(data.canonicalArtifacts)) {
      const pointer = `/canonicalArtifacts/${key}`;
      if (!requireObject(artifact, pointer)) continue;
      requireString(artifact.path, `${pointer}/path`);
      if (artifact.sha256 !== null) requireSha256(artifact.sha256, `${pointer}/sha256`);
    }
  }
  if (requireArray(data.activeTargets, '/activeTargets')) {
    const ids = new Set();
    data.activeTargets.forEach((target, index) => {
      const pointer = `/activeTargets/${index}`;
      if (!requireObject(target, pointer)) return;
      if (requireString(target.id, `${pointer}/id`)) {
        if (ids.has(target.id)) issue(errors, `${pointer}/id`, 'must be unique');
        ids.add(target.id);
      }
    });
  }
  if (requireArray(data.evidenceImages, '/evidenceImages')) {
    data.evidenceImages.forEach((image, index) => {
      const pointer = `/evidenceImages/${index}`;
      if (!requireObject(image, pointer)) return;
      requireString(image.role, `${pointer}/role`);
      requireString(image.path, `${pointer}/path`);
      if (image.targetId !== undefined) requireString(image.targetId, `${pointer}/targetId`);
    });
  }
  if (data.previousDelta !== null && data.previousDelta !== undefined) requireObject(data.previousDelta, '/previousDelta');
  if (requireObject(data.budget, '/budget')) {
    for (const key of ['estimatedTextTokens', 'imageCount', 'targetCount', 'maximumTextTokens', 'maximumImages', 'maximumTargets']) {
      requireNumber(data.budget[key], `/budget/${key}`, { min: 0, integer: true });
    }
    requireBoolean(data.budget.passed, '/budget/passed');
    if (data.budget.imageCount !== (data.evidenceImages ?? []).length) issue(errors, '/budget/imageCount', 'must equal evidenceImages length');
    if (data.budget.targetCount !== (data.activeTargets ?? []).length) issue(errors, '/budget/targetCount', 'must equal activeTargets length');
    const withinLimits = data.budget.estimatedTextTokens <= data.budget.maximumTextTokens
      && data.budget.imageCount <= data.budget.maximumImages
      && data.budget.targetCount <= data.budget.maximumTargets;
    if (data.budget.passed !== withinLimits) issue(errors, '/budget/passed', 'must reflect all declared context limits');
  }
}

function validateIterationDelta(data) {
  requireNumber(data.iteration, '/iteration', { min: 1, integer: true });
  requireNumber(data.basedOn, '/basedOn', { min: 0, integer: true });
  for (const key of ['activeTargets', 'changedFiles', 'resolved', 'remaining', 'regressions']) requireArray(data[key], `/${key}`);
  if ((data.activeTargets ?? []).length > 3) issue(errors, '/activeTargets', 'must contain at most three targets; prefer one');
  (data.activeTargets ?? []).forEach((value, index) => requireString(value, `/activeTargets/${index}`));
  (data.changedFiles ?? []).forEach((value, index) => requireString(value, `/changedFiles/${index}`));
  for (const key of ['remaining', 'regressions']) {
    (data[key] ?? []).forEach((item, index) => {
      const pointer = `/${key}/${index}`;
      if (!requireObject(item, pointer)) return;
      requireString(item.targetId, `${pointer}/targetId`);
      requireString(item.category, `${pointer}/category`);
      requireString(item.evidence, `${pointer}/evidence`);
      if (key === 'remaining') requireString(item.rootCause, `${pointer}/rootCause`);
    });
  }
  if (requireObject(data.nextRepair, '/nextRepair')) {
    for (const key of ['targetIds', 'files', 'properties']) {
      if (requireArray(data.nextRepair[key], `/nextRepair/${key}`)) {
        data.nextRepair[key].forEach((value, index) => requireString(value, `/nextRepair/${key}/${index}`));
      }
    }
    requireString(data.nextRepair.expectedEffect, '/nextRepair/expectedEffect');
  }
  requireEnum(data.gate, '/gate', ['needs-repair', 'regressed', 'blocked', 'pass']);
  if (data.iteration <= data.basedOn) issue(errors, '/iteration', 'must be greater than basedOn');
}

function validateAcceptance(data) {
  requireString(data.reference, '/reference');
  requireNumber(data.acceptedIteration, '/acceptedIteration', { min: 0, integer: true });
  requireEnum(data.profile, '/profile', ['structure-faithful', 'component-faithful', 'pixel-faithful']);
  requireString(data.evaluationReport, '/evaluationReport');
  requireBoolean(data.scopeAlignmentVerified, '/scopeAlignmentVerified');
  requireBoolean(data.dataFixtureRequired, '/dataFixtureRequired');
  requireBoolean(data.dataFixtureVerified, '/dataFixtureVerified');
  if (data.dataFixtureRequired === true && data.dataFixtureVerified === true && requireObject(data.dataFixture, '/dataFixture')) {
    requireString(data.dataFixture.fixtureSetId, '/dataFixture/fixtureSetId');
    requireSha256(data.dataFixture.fixtureSetDigest, '/dataFixture/fixtureSetDigest');
  }
  requireBoolean(data.environmentVerified, '/environmentVerified');
  requireBoolean(data.requiredElementsComplete, '/requiredElementsComplete');
  requireBoolean(data.criticalRegionsPassing, '/criticalRegionsPassing');
  if (requireObject(data.hardGates, '/hardGates')) {
    for (const key of ['scopeAligned', 'dataFixtureMatched', 'stateMatched', 'requiredElementsComplete', 'contentMatched', 'noOverflowOrOcclusion']) {
      requireBoolean(data.hardGates[key], `/hardGates/${key}`);
    }
  }
  if (requireObject(data.scores, '/scores')) {
    for (const key of ['overall', 'minimumCriticalRegion', 'minimumImportantElement', 'perceptualGlobal']) {
      requireNumber(data.scores[key], `/scores/${key}`, { min: 0, max: 1 });
    }
  }
  if (requireObject(data.metrics, '/metrics')) {
    requireNumber(data.metrics.meanAbsoluteError, '/metrics/meanAbsoluteError', { min: 0, max: 1 });
    requireNumber(data.metrics.differentPixelRatio, '/metrics/differentPixelRatio', { min: 0, max: 1 });
    requireNumber(data.metrics.threshold, '/metrics/threshold', { min: 0, max: 255 });
    requireEnum(data.metrics.rawPixelRole, '/metrics/rawPixelRole', ['diagnostic-only', 'scored', 'hard-gate']);
  }
  requireEnum(data.status, '/status', ['pass', 'blocked']);
  requireArray(data.acceptedPlatformDifferences, '/acceptedPlatformDifferences');
  requireArray(data.remainingNonBlockingDifferences, '/remainingNonBlockingDifferences');
  if (data.status === 'pass' && [data.scopeAlignmentVerified, data.dataFixtureVerified, data.environmentVerified, data.requiredElementsComplete, data.criticalRegionsPassing].some((value) => value !== true)) {
    issue(errors, '/status', 'cannot pass while an acceptance prerequisite is false');
  }
  if (data.status === 'pass' && Object.values(data.hardGates ?? {}).some((value) => value !== true)) {
    issue(errors, '/status', 'cannot pass while a component-aware hard gate is false');
  }
}

let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(JSON.stringify({ valid: false, file: path.resolve(file), errors: [{ path: '/', message: error.message }] }, null, 2));
  process.exit(1);
}

if (!requireObject(data, '/')) {
  // Root error already recorded.
} else {
  requireString(data.kind, '/kind');
  requireString(data.schemaVersion, '/schemaVersion');
  switch (data.kind) {
    case 'source-manifest':
      validateSourceManifest(data);
      break;
    case 'alignment-report':
      validateAlignmentReport(data);
      break;
    case 'capture-observation':
      validateCaptureObservation(data);
      break;
    case 'data-fixture-contract':
      validateDataFixtureContract(data);
      break;
    case 'data-fixture-lock':
      validateDataFixtureLock(data);
      break;
    case 'visual-contract':
      validateVisualContract(data);
      break;
    case 'component-adaptation':
      validateComponentAdaptation(data);
      break;
    case 'visual-acceptance-policy':
      validateAcceptancePolicy(data);
      break;
    case 'visual-evaluation':
      validateVisualEvaluation(data);
      break;
    case 'visual-lab-manifest':
      validateVisualLabManifest(data);
      break;
    case 'visual-lab-lock':
      validateVisualLabLock(data);
      break;
    case 'visual-lab-acceptance':
      validateVisualLabAcceptance(data);
      break;
    case 'iteration-report':
      validateIterationReport(data);
      break;
    case 'visual-run-state':
      validateRunState(data);
      break;
    case 'visual-context-packet':
      validateContextPacket(data);
      break;
    case 'iteration-delta':
      validateIterationDelta(data);
      break;
    case 'visual-acceptance':
      validateAcceptance(data);
      break;
    default:
      issue(errors, '/kind', 'unsupported artifact kind');
  }
}

const result = {
  valid: errors.length === 0,
  kind: data?.kind ?? null,
  file: path.resolve(file),
  errors,
  warnings,
  summary: errors.length === 0 ? 'artifact is valid' : `${errors.length} validation error(s)`
};

printResult(result, {
  kind: 'artifact-validation-summary',
  valid: result.valid,
  artifactKind: result.kind,
  file: result.file,
  errorCount: errors.length,
  warningCount: warnings.length,
  errors: errors.slice(0, 5),
  warnings: warnings.slice(0, 3)
}, { verbose });
process.exit(errors.length === 0 ? 0 : 1);
