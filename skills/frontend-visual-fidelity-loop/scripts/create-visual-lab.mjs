#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function usage(exitCode = 0) {
  console.error('Usage: node create-visual-lab.mjs <output-directory> --lab-id <id>');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const positional = [];
  let labId;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') usage(0);
    if (arg === '--lab-id') {
      labId = argv[index + 1];
      if (!labId || labId.startsWith('--')) throw new Error('--lab-id requires a value');
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1 || !labId) usage(2);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(labId)) throw new Error('lab id must contain lowercase letters, digits, and hyphens only');
  return { output: path.resolve(positional[0]), labId };
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (fs.existsSync(options.output) && fs.readdirSync(options.output).length > 0) {
    throw new Error(`Output directory is not empty: ${options.output}`);
  }
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const template = path.resolve(scriptDirectory, '..', 'assets', 'visual-lab', 'vanilla-vite');
  fs.mkdirSync(options.output, { recursive: true });
  fs.cpSync(template, options.output, { recursive: true, errorOnExist: true });
  const manifestFile = path.join(options.output, 'visual-lab.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.labId = options.labId;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const packageFile = path.join(options.output, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  packageJson.name = `visual-lab-${options.labId}`;
  fs.writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    kind: 'visual-lab-created',
    labId: options.labId,
    directory: options.output,
    next: 'Replace the static fixture and generated UI, then run validate-visual-lab.mjs.'
  }, null, 2)}\n`);
} catch (error) {
  console.error(JSON.stringify({ kind: 'visual-lab-create-error', error: error.message }, null, 2));
  process.exit(1);
}
