# @livspect/emdash-cloudflare-email

EmDash CMS plugin that delivers system email (magic link / invite / password
reset) through the native [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/)
Workers binding.

It registers the exclusive `email:deliver` transport on EmDash's email
pipeline, so any time EmDash sends an email it goes through `env.EMAIL.send()`
on your Cloudflare Worker — **no API keys, no SMTP, no external SaaS.**

> Targets the **EmDash 0.19+** plugin model, including **EmDash 1.x** (verified
> on **0.27** and **1.4**). This is a full rewrite of the 0.9-era plugin and is
> **not backward compatible** — see [Migrating from 0.1.x](#migrating-from-01x).

## Requirements

- An EmDash project on **0.19.0 or newer**, up to 1.x (see [Compatibility](#compatibility)).
- Hosting on **Cloudflare Workers** (not Pages, not Node).
- Your sender domain must be onboarded to Cloudflare Email Sending:
  Dashboard → **Compute → Email Service → Email Sending → Onboard Domain**, or
  `wrangler email sending enable yourdomain.com`. Cloudflare auto-installs the
  SPF / DKIM / DMARC records.
- Cloudflare Email Sending requires the Workers Paid plan to send to arbitrary
  recipients (the free tier is limited to verified destinations only).

## Compatibility

| Plugin  | EmDash (peer range) | Verified with |
| ------- | ------------------- | ------------- |
| `0.5.x` | `>=0.19.0 <2.0.0`   | 0.27.0, 1.4.0 (typecheck / build); published on npm as `@livspect/emdash-cloudflare-email` |
| `0.4.x` | `>=0.19.0 <2.0.0`   | 0.27.0, 1.4.0 (typecheck / build); GitHub install only |
| `0.3.x` | `>=0.19.0`          | 0.27.0 |
| `0.2.x` | `>=0.19.0`          | 0.19.x (uses the deprecated `email:provide` capability name) |
| `0.1.x` | `>=0.9.0`           | 0.9.x (legacy plugin model) |

The same build serves both 0.27 and 1.x. On EmDash 1.x, the `cc` and
per-message `replyTo` fields that core passes to `email:deliver` are forwarded
to the binding; a per-message Reply-To takes precedence over the Reply-To
setting below.

## Installation

```sh
pnpm add @livspect/emdash-cloudflare-email
# or: npm i @livspect/emdash-cloudflare-email
```

### Migrating from a GitHub install (0.4.x and earlier)

Up to 0.4.x the plugin was installed straight from GitHub under the unscoped
name `emdash-cloudflare-email`. From 0.5.0 it is published on npm as `@livspect/emdash-cloudflare-email`, and
the plugin locates its sandbox entry by that name, so update every reference:

1. `package.json`: replace the `"emdash-cloudflare-email": "github:tmyuu/emdash-cloudflare-email#v…"`
   dependency with `"@livspect/emdash-cloudflare-email": "^0.5.0"`. If the package is listed under
   `pnpm.onlyBuiltDependencies`, remove it — the npm tarball ships a built `dist/`.
2. `astro.config.mjs`: import from `@livspect/emdash-cloudflare-email`, and rename any Vite
   `optimizeDeps.include` / `ssr.noExternal` entries to `@livspect/emdash-cloudflare-email` and
   `@livspect/emdash-cloudflare-email/sandbox`.
3. Reinstall and build. Settings and stored data carry over: they are keyed by
   the plugin id (`cf-email-sending`), which has not changed.

## Setup

### 1. Add the `send_email` binding to `wrangler.jsonc`

```jsonc
{
  "send_email": [
    { "name": "EMAIL" }
  ]
}
```

### 2. Register the plugin in `astro.config.mjs`

```js
import { defineConfig } from 'astro/config';
import emdash from 'emdash/astro';
import cloudflareEmail from '@livspect/emdash-cloudflare-email';

export default defineConfig({
  integrations: [
    emdash({
      // ...your other config
      // Must be `plugins:` (in-process), NOT `sandboxed:` — the plugin needs
      // the host Worker's `send_email` binding, which is not exposed inside an
      // isolate.
      plugins: [cloudflareEmail()],
    }),
  ],
});
```

That's it for code. EmDash discovers the plugin from the descriptor — there's
no manual `_plugin_state` / `options` SQL to run anymore (that was required on
0.9; it is gone on 0.19).

### 3. Configure the sender in the admin UI

Deploy, then open the EmDash admin → **Cloudflare Email** settings page:

- **Language** — admin UI language for this page. `English` (default) or
  `日本語`. Only affects the settings page; it does not localize the emails
  themselves (EmDash composes those).
- **Display Name** — optional. Shown as the sender name in the recipient's
  inbox (e.g. `Acme App`). When left blank, the EmDash site name
  (`ctx.site.name`) is used.
- **From Address** — required. The sender mailbox, e.g. `noreply@yourdomain.com`.
  Its domain must be onboarded to Cloudflare Email Sending.
- **Reply-To** — optional. Where replies go (e.g. `support@yourdomain.com`).
  Applied to every delivered message that does not carry its own Reply-To
  (EmDash 1.x senders can set one per message).
- **Binding Name** — optional; defaults to `EMAIL`. Set this only if your
  wrangler `send_email` binding uses a different name.

Use **Send Test Email** on the same page to verify delivery, then select this
provider under EmDash → **Settings → Email** (it claims the exclusive
`email:deliver` slot).

## API

### `cloudflareEmail()`

Returns an EmDash `PluginDescriptor` (standard format). Takes no arguments —
EmDash standard-format plugins are configured at runtime via the admin
settings page (stored in plugin KV), not via descriptor options.

| Descriptor field | Value |
| ---------------- | ----- |
| `id`             | `cf-email-sending` |
| `capabilities`   | `['hooks.email-transport:register']` — grants registration of the exclusive `email:deliver` hook |
| `format`         | `standard` |

## How it works

EmDash's auth flow (magic link, invite, password reset) and any plugin calling
`ctx.email.send()` feed into the email pipeline:

1. `email:beforeSend` middleware hooks run.
2. The message is dispatched to **exactly one** `email:deliver` provider —
   this plugin.
3. `email:afterSend` fire-and-forget hooks run.

This plugin's `email:deliver` handler:

1. Reads the configured From address (and binding name) from plugin KV.
2. Resolves the `send_email` binding off `cloudflare:workers`'s `env`.
3. Calls `binding.send({ to, from, subject, text, html })` with the message
   EmDash assembled.
4. Throws on a missing binding / missing config / send error so EmDash records
   the failure.

## Upgrading your site to EmDash 1.x

No plugin-related changes are needed:

- Keep `plugins: [cloudflareEmail()]` in `astro.config.mjs` and the
  `send_email` binding in `wrangler.jsonc` as they are. Any existing Vite
  `optimizeDeps` / `ssr.noExternal` entries for this package can also stay.
- Settings are stored under `settings:` KV keys, which EmDash 1.x's plugin KV
  migration does not move. No reconfiguration is needed after upgrading.
- Follow EmDash's [upgrade guide](https://docs.emdashcms.com/upgrade-to-v1/)
  for the site itself. If your deployment runs `emdash migrate`, run it against
  a build made after upgrading, before deploying that build.

## Migrating from 0.1.x

The plugin was rewritten for EmDash 0.19. If you used `0.1.x`:

- **Entrypoint** — `createCfEmailPlugin({ from })` is removed. Use
  `cloudflareEmail()` and set the From address in the admin UI instead.
- **astro.config** — drop the inline `{ id, version, format, entrypoint,
  capabilities }` plugin object and the `capabilities:
  ['hooks.email-transport:register']` line. Just pass `cloudflareEmail()` to
  `plugins:`.
- **Bootstrap SQL** — delete the manual `_plugin_state` / `options` D1 inserts.
  EmDash installs and activates the plugin from the admin UI now.

## Caveats

- EmDash's `EmailMessage` does not carry a `from` field, so this plugin injects
  one from the admin-configured From address.
- The plugin must run via `plugins:` (in-process), not `sandboxed:`. A sandbox
  isolate does not receive the host Worker's `send_email` binding.
- If Email Sending isn't enabled on the zone, sends fail with
  `destination address is not a verified address`.

## Releasing

1. Bump `version` in `package.json` and in the descriptor in `src/index.ts`.
2. Rebuild and commit `dist/` (`npm run build`); it stays committed so GitHub
   installs keep working.
3. Merge to `main`, then push a `vX.Y.Z` tag. The `Publish to npm` workflow
   checks the tag against `package.json`, rebuilds, verifies `dist/` and
   publishes with npm trusted publishing.

## License

MIT © Yushi Matsui
