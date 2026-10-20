import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, label = file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error.message}`);
  }
}

export function resolveInside(root, relativePath, label = relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') throw new Error(`${label} must be a non-empty relative path`);
  if (path.isAbsolute(relativePath)) throw new Error(`${label} must be relative to the Visual Lab root`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relation = path.relative(resolvedRoot, resolved);
  if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error(`${label} escapes the Visual Lab root`);
  return resolved;
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sortedKeys(value) {
  return Object.keys(value ?? {}).sort();
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function collectImportSpecifiers(source) {
  const specifiers = [];
  for (const expression of [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]) {
    for (const match of source.matchAll(expression)) specifiers.push(match[1]);
  }
  return specifiers;
}

export function validateVisualLab(labDirectory) {
  const root = path.resolve(labDirectory);
  const errors = [];
  const addError = (message) => errors.push(message);
  const manifestFile = path.join(root, 'visual-lab.json');
  const packageFile = path.join(root, 'package.json');
  if (!fs.existsSync(manifestFile)) return { valid: false, root, errors: ['visual-lab.json is missing'], manifest: null, files: [] };
  if (!fs.existsSync(packageFile)) return { valid: false, root, errors: ['package.json is missing'], manifest: null, files: [] };
  let manifest;
  let packageJson;
  try {
    manifest = readJson(manifestFile, 'visual-lab.json');
    packageJson = readJson(packageFile, 'package.json');
  } catch (error) {
    return { valid: false, root, errors: [error.message], manifest: null, files: [] };
  }

  if (manifest.kind !== 'visual-lab-manifest') addError('manifest kind must be visual-lab-manifest');
  if (manifest.executionScope !== 'sandbox-only') addError('executionScope must be sandbox-only');
  if (manifest.template !== 'vanilla-vite') addError('template must be vanilla-vite in this version');
  if (manifest.fixture?.mode !== 'static-json') addError('fixture mode must be static-json');
  if (manifest.fixture?.networkAccess !== 'forbidden') addError('fixture networkAccess must be forbidden');
  if (manifest.server?.host !== '127.0.0.1') addError('server host must be 127.0.0.1');
  if (!Number.isInteger(manifest.server?.port) || manifest.server.port < 1024 || manifest.server.port > 65535) addError('server port must be an integer between 1024 and 65535');
  if (typeof manifest.rootSelector !== 'string' || !manifest.rootSelector.includes('data-visual-id')) addError('rootSelector must use a stable data-visual-id');
  for (const key of ['targetProjectRead', 'targetProjectModified', 'migrationIncluded', 'integrationValidationIncluded']) {
    if (manifest.boundary?.[key] !== false) addError(`boundary.${key} must be false`);
  }
  for (const key of ['freezeTime', 'freezeRandom', 'disableAnimations', 'localAssetsOnly']) {
    if (manifest.determinism?.[key] !== true) addError(`determinism.${key} must be true`);
  }

  const allowedRuntime = [...(manifest.dependencyPolicy?.allowedRuntimeDependencies ?? [])].sort();
  const allowedDev = [...(manifest.dependencyPolicy?.allowedDevDependencies ?? [])].sort();
  if (!sameSet(sortedKeys(packageJson.dependencies), allowedRuntime)) addError('package runtime dependencies do not exactly match dependencyPolicy');
  if (!sameSet(sortedKeys(packageJson.devDependencies), allowedDev)) addError('package dev dependencies do not exactly match dependencyPolicy');
  if (packageJson.private !== true) addError('package.json must be private');
  if (!/^\d+\.\d+\.\d+$/.test(packageJson.devDependencies?.vite ?? '')) addError('Vite must be pinned to an exact semantic version');
  if (typeof packageJson.engines?.node !== 'string' || packageJson.engines.node.trim() === '') addError('package.json must declare the Node.js engine required by Vite');
  if (!String(packageJson.scripts?.dev ?? '').includes('vite')) addError('package.json dev script must start Vite');
  if (!String(packageJson.scripts?.build ?? '').includes('vite build')) addError('package.json build script must run vite build');

  let fixtureFile;
  try {
    fixtureFile = resolveInside(root, manifest.fixture?.path, 'fixture.path');
    if (!fs.existsSync(fixtureFile)) addError('static fixture file is missing');
    else readJson(fixtureFile, 'static visual fixture');
  } catch (error) {
    addError(error.message);
  }

  const sourceFiles = [];
  const forbiddenPatterns = [
    [/\bfetch\s*\(/, 'fetch is forbidden'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest is forbidden'],
    [/\bWebSocket\b/, 'WebSocket is forbidden'],
    [/\bEventSource\b/, 'EventSource is forbidden'],
    [/\baxios\b/, 'axios is forbidden'],
    [/https?:\/\//, 'remote HTTP assets or requests are forbidden'],
    [/\bDate\.now\s*\(/, 'Date.now is forbidden'],
    [/\bMath\.random\s*\(/, 'Math.random is forbidden']
  ];
  if (!Array.isArray(manifest.sourceFiles) || manifest.sourceFiles.length === 0) addError('sourceFiles must be a non-empty array');
  for (const relativePath of manifest.sourceFiles ?? []) {
    let file;
    try {
      file = resolveInside(root, relativePath, `sourceFiles entry ${relativePath}`);
    } catch (error) {
      addError(error.message);
      continue;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      addError(`source file is missing: ${relativePath}`);
      continue;
    }
    sourceFiles.push({ relativePath: relativePath.replaceAll('\\', '/'), file });
    const source = fs.readFileSync(file, 'utf8');
    for (const [pattern, message] of forbiddenPatterns) {
      if (pattern.test(source)) addError(`${relativePath}: ${message}`);
    }
    if (relativePath.endsWith('.js')) {
      for (const specifier of collectImportSpecifiers(source)) {
        if (!specifier.startsWith('.')) {
          addError(`${relativePath}: external import ${specifier} is forbidden`);
          continue;
        }
        try {
          resolveInside(path.dirname(file), specifier, `${relativePath} import ${specifier}`);
        } catch (error) {
          addError(error.message);
        }
      }
    }
  }
  const rootId = typeof manifest.rootSelector === 'string'
    ? manifest.rootSelector.match(/data-visual-id=['"]([^'"]+)['"]/)?.[1]
    : null;
  if (rootId) {
    const rootMarker = `data-visual-id=\"${rootId}\"`;
    const singleQuotedRootMarker = `data-visual-id='${rootId}'`;
    const rootPresent = sourceFiles.some(({ file }) => {
      const source = fs.readFileSync(file, 'utf8');
      return source.includes(rootMarker) || source.includes(singleQuotedRootMarker);
    });
    if (!rootPresent) addError(`rootSelector visual id ${rootId} is not rendered by a declared source file`);
  }

  return { valid: errors.length === 0, root, errors, manifest, packageJson, fixtureFile, files: sourceFiles };
}
