import path from 'node:path';

export function hasVerboseFlag(argv) {
  return argv.includes('--verbose');
}

export function printResult(fullValue, summary, { verbose = false } = {}) {
  const value = verbose ? fullValue : summary;
  process.stdout.write(`${JSON.stringify(value, null, verbose ? 2 : 0)}\n`);
}

export function reportSummary(kind, status, reportFile, extra = {}) {
  return {
    kind: `${kind}-summary`,
    status,
    report: reportFile ? path.resolve(reportFile) : null,
    ...extra
  };
}

export function compactMessages(values, maximum = 3) {
  return (values ?? []).slice(0, maximum).map((value) => String(value).slice(0, 240));
}
