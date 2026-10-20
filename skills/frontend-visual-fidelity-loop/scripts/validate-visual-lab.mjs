#!/usr/bin/env node

import { validateVisualLab } from './visual-lab-integrity.mjs';

const directory = process.argv[2];
if (!directory || process.argv.includes('--help')) {
  console.error('Usage: node validate-visual-lab.mjs <visual-lab-directory>');
  process.exit(directory ? 0 : 2);
}

const result = validateVisualLab(directory);
process.stdout.write(`${JSON.stringify({
  kind: 'visual-lab-validation',
  directory: result.root,
  valid: result.valid,
  labId: result.manifest?.labId ?? null,
  checkedFiles: result.files.map((file) => file.relativePath),
  errors: result.errors
}, null, 2)}\n`);
process.exit(result.valid ? 0 : 1);
