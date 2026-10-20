import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readJsonWithRaw(file, label) {
  const raw = fs.readFileSync(file);
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${label} ${file}: ${error.message}`);
  }
  return { raw, data };
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
}

function normalizeFixturePath(value) {
  requireNonEmptyString(value, 'response.fixture');
  if (path.isAbsolute(value)) throw new Error(`response.fixture must be relative for portable sealing: ${value}`);
  return value.replaceAll('\\', '/');
}

export function buildFixtureLock(contractFile) {
  const contractPath = path.resolve(contractFile);
  const { raw, data: contract } = readJsonWithRaw(contractPath, 'fixture contract');
  if (contract.kind !== 'data-fixture-contract') throw new Error('Fixture contract kind must be data-fixture-contract');
  if (contract.schemaVersion !== '1.0') throw new Error('Unsupported data fixture contract schemaVersion');
  requireNonEmptyString(contract.fixtureSetId, 'fixtureSetId');
  if (!['static', 'record-replay'].includes(contract.mode)) throw new Error('Fixture mode must be static or record-replay');
  if (!Array.isArray(contract.requests) || contract.requests.length === 0) throw new Error('Fixture contract requests must not be empty');
  if (!contract.runtime || typeof contract.runtime !== 'object') throw new Error('Fixture contract runtime must be an object');
  if (!contract.network || typeof contract.network !== 'object') throw new Error('Fixture contract network must be an object');
  if (!Array.isArray(contract.visibleAssertions)) throw new Error('Fixture contract visibleAssertions must be an array');

  const requestIds = new Set();
  const contractDir = path.dirname(contractPath);
  const requests = contract.requests.map((request, index) => {
    const label = `requests[${index}]`;
    requireNonEmptyString(request.id, `${label}.id`);
    if (requestIds.has(request.id)) throw new Error(`Duplicate request id: ${request.id}`);
    requestIds.add(request.id);
    requireNonEmptyString(request.method, `${label}.method`);
    requireNonEmptyString(request.urlPattern, `${label}.urlPattern`);
    if (!Number.isInteger(request.minMatches) || request.minMatches < 0) throw new Error(`${label}.minMatches must be a non-negative integer`);
    if (!Number.isInteger(request.maxMatches) || request.maxMatches < request.minMatches) {
      throw new Error(`${label}.maxMatches must be an integer greater than or equal to minMatches`);
    }
    if (!request.response || typeof request.response !== 'object') throw new Error(`${label}.response must be an object`);
    const fixture = normalizeFixturePath(request.response.fixture);
    const fixtureFile = path.resolve(contractDir, fixture);
    const body = fs.readFileSync(fixtureFile);
    return {
      id: request.id,
      method: request.method.toUpperCase(),
      urlPattern: request.urlPattern,
      minMatches: request.minMatches,
      maxMatches: request.maxMatches,
      response: {
        fixture,
        status: request.response.status,
        contentType: request.response.contentType,
        bytes: body.length,
        sha256: sha256(body)
      }
    };
  });

  const material = {
    fixtureSetId: contract.fixtureSetId,
    mode: contract.mode,
    contractSha256: sha256(raw),
    network: contract.network,
    runtime: contract.runtime,
    requests,
    visibleAssertions: contract.visibleAssertions
  };
  return {
    kind: 'data-fixture-lock',
    schemaVersion: '1.0',
    ...material,
    fixtureSetDigest: sha256(canonicalJson(material))
  };
}

export function verifyFixtureLock(contractFile, lockFile) {
  const expected = buildFixtureLock(contractFile);
  const { data: actual } = readJsonWithRaw(path.resolve(lockFile), 'fixture lock');
  const errors = [];
  if (actual.kind !== 'data-fixture-lock') errors.push('lock kind must be data-fixture-lock');
  if (actual.schemaVersion !== '1.0') errors.push('lock schemaVersion must be 1.0');
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    if (actual.contractSha256 !== expected.contractSha256) errors.push('fixture contract hash changed after sealing');
    if (actual.fixtureSetDigest !== expected.fixtureSetDigest) errors.push('fixture set digest does not match current contract and response files');
    for (const request of expected.requests) {
      const locked = (actual.requests ?? []).find((candidate) => candidate.id === request.id);
      if (!locked) errors.push(`lock is missing request ${request.id}`);
      else if (locked.response?.sha256 !== request.response.sha256) errors.push(`response fixture hash changed for request ${request.id}`);
    }
    if (errors.length === 0) errors.push('fixture lock content differs from deterministic sealed output');
  }
  return { valid: errors.length === 0, errors, expected, actual };
}
