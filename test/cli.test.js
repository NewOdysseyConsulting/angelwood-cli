import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/angelwood.js', import.meta.url));
const requests = [];
let server;
let env;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body && JSON.parse(body) });
      const send = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.headers.authorization !== 'Bearer sk_live_good') {
        return send(401, { error: { code: 'INVALID_API_KEY', message: 'Invalid, revoked or expired API key' } });
      }
      const path = req.url.split('?')[0];
      if (path === '/api/v1/me') {
        return send(200, { organization: { id: 1, name: 'Studio' }, user: { id: 7, name: 'Sam', email: 'sam@studio.test' }, role: 'admin', permissions: ['read', 'write'] });
      }
      if (path === '/api/v1/invoices') {
        return send(200, {
          data: [{ invoice_number: 'INV-1', client: { name: 'Acme' }, status: 'overdue', amount: 1200, balance_due: 200.5, currency: 'USD', due_date: '2026-10-01T00:00:00.000Z' }],
          total: 3,
          has_more: true,
          next_offset: 1,
        });
      }
      if (path === '/api/v1/tasks' && req.method === 'POST') {
        return send(201, { id: 9, title: JSON.parse(body).title, project: { id: 3, name: 'Website' } });
      }
      send(404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'angelwood-cli-'));
  env = {
    PATH: process.env.PATH,
    ANGELWOOD_API_URL: `http://127.0.0.1:${server.address().port}/api/v1`,
    ANGELWOOD_CONFIG: join(dir, 'nested', 'config.json'),
  };
});

after(() => server.close());

function run(args, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { env: { ...env, ...extraEnv } }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr })
    );
  });
}

test('prints help with no arguments', async () => {
  const result = await run([]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: angelwood <command>/);
});

test('refuses to run without a key', async () => {
  const result = await run(['whoami']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /No API key/);
});

test('login rejects a bad key and saves nothing', async () => {
  const result = await run(['login', '--key', 'sk_live_bad']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Invalid, revoked or expired API key/);
  await assert.rejects(stat(env.ANGELWOOD_CONFIG));
});

test('login saves an accepted key in a private file', async () => {
  const result = await run(['login', '--key', 'sk_live_good']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Signed in to Studio as sam@studio.test/);
  assert.deepEqual(JSON.parse(await readFile(env.ANGELWOOD_CONFIG, 'utf8')), { apiKey: 'sk_live_good' });
  assert.equal((await stat(env.ANGELWOOD_CONFIG)).mode & 0o777, 0o600);
});

test('lists invoices as a table with the filters sent as query parameters', async () => {
  const result = await run(['invoices', 'list', '--status', 'overdue', '--client', '5', '--limit', '1']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /INV-1\s+Acme\s+overdue\s+1200\.00 USD\s+200\.50\s+2026-10-01/);
  assert.match(result.stdout, /Showing 1 of 3\. Next page: --offset 1/);
  const request = requests.at(-1);
  assert.equal(request.auth, 'Bearer sk_live_good');
  assert.equal(request.url, '/api/v1/invoices?limit=1&client_id=5&status=overdue');
});

test('--json prints the API response unchanged', async () => {
  const result = await run(['invoices', 'list', '--json']);
  assert.equal(JSON.parse(result.stdout).total, 3);
});

test('creates a task and converts a plain date to a timestamp', async () => {
  const result = await run(['tasks', 'create', '--project', '3', '--title', 'Send brief', '--due', '2026-12-01']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Created task "Send brief" \(#9\) in Website\./);
  assert.deepEqual(requests.at(-1).body, { project_id: 3, title: 'Send brief', due_date: '2026-12-01T00:00:00.000Z' });
});

test('validates arguments before calling the API', async () => {
  const before = requests.length;
  const missing = await run(['tasks', 'create', '--title', 'No project']);
  const notNumber = await run(['projects', 'list', '--client', 'acme']);
  const unknown = await run(['invoices', 'delete']);
  assert.match(missing.stderr, /--project and --title are required/);
  assert.match(notNumber.stderr, /--client must be a whole number/);
  assert.match(unknown.stderr, /Unknown command "invoices delete"/);
  assert.equal(requests.length, before);
});

test('the environment variable overrides the saved key, and logout removes the file', async () => {
  const result = await run(['whoami'], { ANGELWOOD_API_KEY: 'sk_live_bad' });
  assert.equal(result.code, 1);
  await run(['logout']);
  await assert.rejects(stat(env.ANGELWOOD_CONFIG));
});
