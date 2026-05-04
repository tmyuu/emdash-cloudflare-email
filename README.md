# emdash-cloudflare-email

EmDash plugin that delivers system emails (magic link / invite / password reset)
through [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/)
(Public Beta).

Registers an exclusive `email:deliver` provider on the EmDash hook pipeline,
so that any time EmDash needs to send an email it goes through
`env.EMAIL.send()` on a Cloudflare Worker — no API keys, no SMTP, no
external SaaS dependencies.

## Requirements

- An EmDash project on **0.9.0 or newer**.
- Hosting on **Cloudflare Workers** (not Pages, not Node).
- Your sender domain must be onboarded to Cloudflare Email Service:
  Dashboard → **Compute → Email Service → Email Sending → Onboard Domain**.
  Cloudflare auto-installs the SPF / DKIM / DMARC records.
- Cloudflare Email Sending is currently **Public Beta** and requires the
  Workers Paid plan to send to arbitrary recipients (the free tier is
  limited to verified destinations only).

## Installation

```sh
# From the GitHub source repo (recommended while npm publishing is pending):
pnpm add github:tmyuu/emdash-cloudflare-email

# Or once published to npm:
pnpm add emdash-cloudflare-email
```

## Setup

### 1. Add the `send_email` binding to `wrangler.jsonc`

```jsonc
{
  "send_email": [
    { "name": "EMAIL" }
  ]
}
```

### 2. Create a thin entrypoint file in your project

`src/plugins/email-cf.ts`:

```ts
import { createCfEmailPlugin } from 'emdash-cloudflare-email';

export default createCfEmailPlugin({
  from: 'noreply@example.com', // must be on a verified Email Sending domain
});
```

### 3. Register the plugin in `astro.config.mjs`

```js
import emdash from 'emdash/astro';

export default defineConfig({
  integrations: [
    emdash({
      // ... your other config
      plugins: [
        {
          id: 'cf-email-sending',
          version: '0.1.0',
          format: 'standard',
          entrypoint: new URL('./src/plugins/email-cf.ts', import.meta.url).pathname,
          capabilities: ['hooks.email-transport:register'],
        },
      ],
    }),
  ],
});
```

The `capabilities: ['hooks.email-transport:register']` line is required —
without it, EmDash silently skips the `email:deliver` hook registration.

### 4. Bootstrap the plugin state (one-time, on first deploy)

EmDash does **not** auto-install configured plugins. You need to insert a
row into the `_plugin_state` table so the plugin transitions from
`registered` → `active` and shows up in the admin Email Settings page:

```sh
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
wrangler d1 execute YOUR_DB --remote --command="
  INSERT OR REPLACE INTO _plugin_state
  (plugin_id, version, status, installed_at, activated_at, source, display_name, description)
  VALUES
  ('cf-email-sending', '0.1.0', 'active', '$NOW', '$NOW', 'config',
   'Cloudflare Email Sending', 'Sends EmDash system email via CF Email Sending');
"
wrangler d1 execute YOUR_DB --remote --command="
  INSERT OR REPLACE INTO options (name, value)
  VALUES ('emdash:exclusive_hook:email:deliver', '\"cf-email-sending\"');
"
```

(The plugin id in both rows must match the `id` you set in
`astro.config.mjs`.)

## API

### `createCfEmailPlugin(options)`

Returns an EmDash standard plugin definition.

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `from` | `string` | — | **Required.** Sender address. Must be on a verified Email Sending domain. |
| `bindingName` | `string` | `'EMAIL'` | Name of the `send_email` binding in your wrangler config. |

The plugin's hook is registered as `exclusive: true` so it occupies the
single-provider slot for `email:deliver`. If multiple providers are
registered EmDash will surface a chooser in the admin UI.

## How it works

EmDash's auth flow (magic link, invite, password reset) calls
`ctx.email.send()`. The pipeline:

1. Runs `email:beforeSend` middleware hooks.
2. Dispatches to **exactly one** `email:deliver` provider — that's this
   plugin.
3. Runs `email:afterSend` fire-and-forget hooks.

This plugin's `email:deliver` handler:

1. Reads the `EMAIL` binding off `cloudflare:workers`'s `env`.
2. Calls `binding.send({ to, from, subject, text, html })` with the
   message that EmDash assembled.
3. Throws on missing binding or send error so EmDash records the
   failure.

## Caveats

- EmDash's `EmailMessage` type does not carry a `from` field, so this
  plugin must inject one — that's why `options.from` is required.
- Public Beta of Cloudflare Email Sending may have quota / rate limits
  that aren't publicly documented yet. Check the
  [Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/)
  for the latest.
- This plugin uses the `env.EMAIL.send()` Worker binding, **not** the
  legacy Email Routing path. If your Email Sending isn't enabled on the
  zone, sends will fail with `destination address is not a verified
  address`.

## License

MIT © Yushi Matsui
