# Angelwood CLI

A command-line client for [Angelwood](https://angelwood.io), the client portal and client operations platform for
agencies, consultancies and other service businesses. List your clients, projects, tasks and invoices, and create
clients and tasks, from a terminal or a script.

## Install

```bash
npm install -g angelwood-cli
```

Needs Node.js 20 or later. It has no dependencies.

## Sign in

Create an API key in Angelwood under **Settings** (choose **write** permission if you want to create clients or
tasks), then:

```bash
angelwood login
```

The key is checked with Angelwood before it is saved, to `~/.config/angelwood/config.json`, readable only by you.
In scripts and CI, set `ANGELWOOD_API_KEY` instead. No account yet?
[Start a 14-day free trial](https://app.angelwood.io/sign-up).

## Commands

```text
angelwood whoami

angelwood clients list [--search <text>]
angelwood clients get <id>
angelwood clients create --name <name> [--email <email>] [--phone <phone>] [--address <address>]

angelwood projects list [--client <id>] [--status active|completed|on_hold|cancelled]

angelwood tasks list [--project <id>] [--status todo|in_progress|completed|blocked]
angelwood tasks create --project <id> --title <title> [--description <text>]
                       [--priority low|medium|high|critical] [--due 2026-12-31]

angelwood invoices list [--client <id>] [--project <id>] [--status <status>]

angelwood logout
```

Every list command takes `--limit` (1 to 100, default 25), `--offset` and `--json`.

## Examples

```bash
# Which invoices are overdue?
angelwood invoices list --status overdue

# Add a task to project 42, due at the end of the year
angelwood tasks create --project 42 --title "Send the Q4 report" --priority high --due 2026-12-31

# Total outstanding balance, with jq
angelwood invoices list --status sent --limit 100 --json | jq '[.data[].balance_due] | add'
```

## Notes

- A key works inside the one Angelwood organization it was created in.
- Nothing can be updated or deleted from the CLI.
- Angelwood allows 120 API requests per minute per organization.

## Links

- [Angelwood](https://angelwood.io) · [Pricing](https://angelwood.io/pricing) ·
  [API description (OpenAPI)](https://angelwood-api-uzil.onrender.com/api/v1/openapi.json)
- Support: support@angelwood.io
- Licence: MIT
