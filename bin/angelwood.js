#!/usr/bin/env node
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

const DEFAULT_API_URL = 'https://angelwood-api-uzil.onrender.com/api/v1';
const configPath = () =>
  process.env.ANGELWOOD_CONFIG ||
  join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'angelwood', 'config.json');

const HELP = `Angelwood CLI

Usage: angelwood <command> [options]

  login [--key <key>]                 Save an API key (asks for it if --key is not given)
  logout                              Remove the saved API key
  whoami                              Show the organization and user the key belongs to

  clients list [--search <text>]      List clients, newest first
  clients get <id>                    Show one client
  clients create --name <name> [--email <email>] [--phone <phone>] [--address <address>]

  projects list [--client <id>] [--status active|completed|on_hold|cancelled]

  tasks list [--project <id>] [--status todo|in_progress|completed|blocked]
  tasks create --project <id> --title <title> [--description <text>]
               [--priority low|medium|high|critical] [--due <YYYY-MM-DD or ISO time>]

  invoices list [--client <id>] [--project <id>] [--status <status>]

Options for every list command:
  --limit <n>     How many to return (1-100, default 25)
  --offset <n>    How many to skip
  --json          Print the API response as JSON

Create an API key in Angelwood under Settings. Creating clients and tasks needs a
key with write permission. The key can also be given as ANGELWOOD_API_KEY.

No account yet? https://app.angelwood.io/sign-up`;

class CliError extends Error {}

async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function apiKey() {
  const key = process.env.ANGELWOOD_API_KEY || (await readConfig()).apiKey;
  if (!key) throw new CliError('No API key. Run "angelwood login" or set ANGELWOOD_API_KEY.');
  return key;
}

async function api(path, { method = 'GET', query, body, key } = {}) {
  const base = (process.env.ANGELWOOD_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
  const url = new URL(base + path);
  for (const [name, value] of Object.entries(query || {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key || (await apiKey())}`,
        Accept: 'application/json',
        'User-Agent': 'angelwood-cli',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('Could not reach Angelwood. Check your connection and try again.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Angelwood returned an error (${response.status}).`;
    throw new CliError(message);
  }
  return payload;
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

function table(rows, columns) {
  if (rows.length === 0) return 'Nothing found.';
  const cells = rows.map((row) => columns.map(([, get]) => String(get(row) ?? '')));
  const widths = columns.map(([title], i) => Math.max(title.length, ...cells.map((line) => line[i].length)));
  const line = (values) => values.map((value, i) => value.padEnd(widths[i])).join('  ').trimEnd();
  return [line(columns.map(([title]) => title)), ...cells.map(line)].join('\n');
}

const day = (value) => (value ? value.slice(0, 10) : '');
const number = (value, name) => {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new CliError(`${name} must be a whole number.`);
  return Number(value);
};
function dueDate(value) {
  if (value === undefined) return undefined;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) throw new CliError('--due must be a date like 2026-12-31.');
  return date.toISOString();
}

function printList(result, flags, columns) {
  if (flags.json) return console.log(JSON.stringify(result, null, 2));
  console.log(table(result.data, columns));
  if (result.has_more) {
    console.log(`\nShowing ${result.data.length} of ${result.total}. Next page: --offset ${result.next_offset}`);
  }
}

const print = (value, flags, text) => console.log(flags.json ? JSON.stringify(value, null, 2) : text);

const paging = (flags) => ({ limit: number(flags.limit, '--limit'), offset: number(flags.offset, '--offset') });

const commands = {
  async login(_args, flags) {
    const key = flags.key || process.env.ANGELWOOD_API_KEY || (await ask('Angelwood API key: '));
    if (!key) throw new CliError('No key given.');
    // The key is saved only after Angelwood has accepted it.
    const me = await api('/me', { key });
    const file = configPath();
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify({ apiKey: key }, null, 2) + '\n', { mode: 0o600 });
    await chmod(file, 0o600);
    console.log(`Signed in to ${me.organization.name} as ${me.user.email}. Key saved to ${file}`);
  },
  async logout() {
    await rm(configPath(), { force: true });
    console.log('The saved API key was removed.');
  },
  async whoami(_args, flags) {
    const me = await api('/me');
    print(
      me,
      flags,
      `${me.user.name || me.user.email} <${me.user.email}>\nOrganization: ${me.organization.name} (${me.role})\nKey permissions: ${me.permissions.join(', ')}`
    );
  },
  'clients list': async (_args, flags) =>
    printList(await api('/clients', { query: { ...paging(flags), search: flags.search } }), flags, [
      ['ID', (c) => c.id],
      ['NAME', (c) => c.name],
      ['EMAIL', (c) => c.email],
      ['CREATED', (c) => day(c.created_at)],
    ]),
  'clients get': async ([id], flags) => {
    if (number(id, 'The client id') === undefined) throw new CliError('Usage: angelwood clients get <id>');
    const c = await api(`/clients/${id}`);
    print(c, flags, [`${c.name} (#${c.id})`, c.email, c.phone, c.address].filter(Boolean).join('\n'));
  },
  'clients create': async (_args, flags) => {
    if (!flags.name) throw new CliError('--name is required.');
    const { name, email, phone, address } = flags;
    const c = await api('/clients', { method: 'POST', body: { name, email, phone, address } });
    print(c, flags, `Created client ${c.name} (#${c.id}).`);
  },
  'projects list': async (_args, flags) =>
    printList(
      await api('/projects', {
        query: { ...paging(flags), client_id: number(flags.client, '--client'), status: flags.status },
      }),
      flags,
      [
        ['ID', (p) => p.id],
        ['NAME', (p) => p.name],
        ['CLIENT', (p) => p.client?.name],
        ['STATUS', (p) => p.status],
      ]
    ),
  'tasks list': async (_args, flags) =>
    printList(
      await api('/tasks', {
        query: { ...paging(flags), project_id: number(flags.project, '--project'), status: flags.status },
      }),
      flags,
      [
        ['ID', (t) => t.id],
        ['TITLE', (t) => t.title],
        ['PROJECT', (t) => t.project.name],
        ['STATUS', (t) => t.status],
        ['DUE', (t) => day(t.due_date)],
      ]
    ),
  'tasks create': async (_args, flags) => {
    const projectId = number(flags.project, '--project');
    if (projectId === undefined || !flags.title) throw new CliError('--project and --title are required.');
    const t = await api('/tasks', {
      method: 'POST',
      body: {
        project_id: projectId,
        title: flags.title,
        description: flags.description,
        priority: flags.priority,
        due_date: dueDate(flags.due),
      },
    });
    print(t, flags, `Created task "${t.title}" (#${t.id}) in ${t.project.name}.`);
  },
  'invoices list': async (_args, flags) =>
    printList(
      await api('/invoices', {
        query: {
          ...paging(flags),
          client_id: number(flags.client, '--client'),
          project_id: number(flags.project, '--project'),
          status: flags.status,
        },
      }),
      flags,
      [
        ['NUMBER', (i) => i.invoice_number],
        ['CLIENT', (i) => i.client.name],
        ['STATUS', (i) => i.status],
        ['AMOUNT', (i) => `${i.amount.toFixed(2)} ${i.currency}`],
        ['BALANCE', (i) => i.balance_due.toFixed(2)],
        ['DUE', (i) => day(i.due_date)],
      ]
    ),
};

async function main(argv) {
  const { values: flags, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: Object.fromEntries(
      [
        'key', 'search', 'name', 'email', 'phone', 'address', 'client', 'project', 'status',
        'title', 'description', 'priority', 'due', 'limit', 'offset',
      ]
        .map((name) => [name, { type: 'string' }])
        .concat([['json', { type: 'boolean' }], ['help', { type: 'boolean', short: 'h' }], ['version', { type: 'boolean', short: 'v' }]])
    ),
  });

  if (flags.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(pkg.version);
  }
  if (flags.help || positionals.length === 0 || positionals[0] === 'help') return console.log(HELP);

  const two = positionals.slice(0, 2).join(' ');
  const [name, rest] = commands[two] ? [two, positionals.slice(2)] : [positionals[0], positionals.slice(1)];
  const command = commands[name];
  if (!command) throw new CliError(`Unknown command "${positionals.join(' ')}". Run "angelwood help".`);
  await command(rest, flags);
}

main(process.argv.slice(2)).catch((error) => {
  const expected = error instanceof CliError || String(error?.code).startsWith('ERR_PARSE_ARGS');
  console.error(expected ? error.message : error);
  process.exitCode = 1;
});
