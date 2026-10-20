#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { sha256File, validateVisualLab } from './visual-lab-integrity.mjs';
import { printResult, reportSummary } from './cli-output.mjs';

function usage(exitCode = 0) {
  console.error('Usage: node seal-visual-lab.mjs <visual-lab-directory> --output <visual-lab-lock.json>');
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
      if (!output || output.startsWith('--')) throw new Error('--output requires a value');
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1 || !output) usage(2);
  return { directory: positional[0], output: path.resolve(output), verbose };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const validation = validateVisualLab(options.directory);
  if (!validation.valid) throw new Error(`Visual Lab validation failed: ${validation.errors.join('; ')}`);
  const root = validation.root;
  const fixturePath = validation.manifest.fixture.path.replaceAll('\\', '/');
  const filesToSeal = [...validation.files];
  const packageLockFile = path.join(root, 'package-lock.json');
  if (fs.existsSync(packageLockFile) && !filesToSeal.some((item) => item.relativePath === 'package-lock.json')) {
    filesToSeal.push({ relativePath: 'package-lock.json', file: packageLockFile });
  }
  const files = filesToSeal
    .map(({ relativePath, file }) => ({
      path: relativePath,
      bytes: fs.statSync(file).size,
      sha256: sha256File(file)
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const lock = {
    kind: 'visual-lab-lock',
    schemaVersion: '1.0',
    labId: validation.manifest.labId,
    executionScope: 'sandbox-only',
    manifest: 'visual-lab.json',
    fixture: {
      path: fixturePath,
      sha256: sha256File(validation.fixtureFile)
    },
    files,
    networkAccessVerifiedForbidden: true,
    boundary: validation.manifest.boundary,
    status: 'sealed'
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(lock, null, 2)}\n`);
  const lockFileSha256 = sha256File(options.output);
  printResult({ ...lock, lockFileSha256 }, reportSummary('visual-lab-lock', 'sealed', options.output, {
    labId: lock.labId,
    lockFileSha256,
    sealedFileCount: lock.files.length
  }), { verbose: options.verbose });
} catch (error) {
  console.error(JSON.stringify({ kind: 'visual-lab-seal-error', error: error.message }, null, 2));
  process.exit(1);
}
