/**
 * emdash-cloudflare-email
 *
 * EmDash CMS plugin (standard format) that delivers system email
 * (magic link / invite / password reset) through the native Cloudflare
 * Email Sending Workers binding — no API token, no SMTP, no external SaaS.
 *
 * Targets the EmDash 0.19 plugin model:
 *
 *   - `src/index.ts`        → this descriptor factory (`PluginDescriptor`)
 *   - `src/sandbox-entry.ts`→ `definePlugin({ hooks, routes })` (the runtime)
 *
 * Register it in `astro.config.mjs`:
 *
 *   import emdash from 'emdash/astro';
 *   import cloudflareEmail from 'emdash-cloudflare-email';
 *
 *   export default defineConfig({
 *     integrations: [
 *       emdash({
 *         // Must be `plugins:` (in-process), NOT `sandboxed:` — the plugin
 *         // needs the host Worker's `send_email` binding, which is not
 *         // exposed inside an isolate.
 *         plugins: [cloudflareEmail()],
 *       }),
 *     ],
 *   });
 *
 * Required wrangler config (host Worker):
 *
 *   "send_email": [{ "name": "EMAIL" }]
 *
 * The From domain must be onboarded to Cloudflare Email Sending
 * (Dashboard → Compute → Email Service → Email Sending → Onboard Domain,
 * or `wrangler email sending enable yourdomain.com`).
 *
 * Configuration (From address, binding name) is done at runtime from the
 * plugin's admin settings page — EmDash 0.19 standard-format plugins do not
 * receive descriptor `options` inside the sandbox entrypoint.
 */

import type { PluginDescriptor } from 'emdash';

/**
 * Build the EmDash plugin descriptor for the Cloudflare Email Sending
 * transport. Takes no arguments — From address and binding name are
 * configured from the admin settings page (see sandbox-entry).
 */
export function cloudflareEmail(): PluginDescriptor {
  return {
    id: 'cf-email-sending',
    version: '0.2.0',
    format: 'standard',
    entrypoint: 'emdash-cloudflare-email/sandbox',
    capabilities: ['email:provide'],
    adminPages: [
      { path: '/settings', label: 'Cloudflare Email', icon: 'email' },
    ],
  };
}

export default cloudflareEmail;
