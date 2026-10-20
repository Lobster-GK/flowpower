#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { buildFixtureLock } from './fixture-integrity.mjs';
import { printResult, reportSummary } from './cli-output.mjs';

function usage(exitCode = 0) {
  console.error('Usage: node seal-data-fixtures.mjs <data-fixture-contract.json> [--output <data-fixture-lock.json>]');
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
  if (positional.length !== 1) usage(2);
  return { contract: positional[0], output, verbose };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const lock = buildFixtureLock(options.contract);
  const output = `${JSON.stringify(lock, null, 2)}\n`;
  if (options.output) {
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(options.output, output);
  }
  printResult(lock, reportSummary('data-fixture-lock', 'sealed', options.output, {
    fixtureSetId: lock.fixtureSetId,
    fixtureSetDigest: lock.fixtureSetDigest,
    requestCount: lock.requests?.length ?? 0
  }), { verbose: options.verbose });
} catch (error) {
  console.error(JSON.stringify({ kind: 'data-fixture-lock-error', error: error.message }, null, 2));
  process.exit(1);
}
