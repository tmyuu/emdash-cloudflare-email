/**
 * emdash-cloudflare-email
 *
 * EmDash plugin that registers a Cloudflare Email Sending transport
 * for the exclusive `email:deliver` hook.
 *
 * Usage (in your Astro entrypoint, e.g. src/plugins/email-cf.ts):
 *
 *   import { createCfEmailPlugin } from 'emdash-cloudflare-email';
 *   export default createCfEmailPlugin({ from: 'noreply@example.com' });
 *
 * Then in astro.config.mjs:
 *
 *   emdash({
 *     plugins: [{
 *       id: 'cf-email-sending',
 *       version: '0.1.0',
 *       format: 'standard',
 *       entrypoint: new URL('./src/plugins/email-cf.ts', import.meta.url).pathname,
 *       capabilities: ['hooks.email-transport:register'],
 *     }],
 *   })
 *
 * Required wrangler config:
 *
 *   "send_email": [{ "name": "EMAIL" }]
 *
 * The sender domain must be onboarded to Cloudflare Email Service:
 *   Dashboard → Compute → Email Service → Email Sending → Onboard Domain.
 */

import { definePlugin } from 'emdash';
import { env } from 'cloudflare:workers';

export interface CfEmailPluginOptions {
  /**
   * Default `From` address for outgoing emails.
   * EmDash's EmailMessage shape does not carry a `from` field, so the
   * plugin must inject one. Use a verified address on a domain that
   * has been onboarded to Cloudflare Email Sending.
   */
  from: string;

  /**
   * Override for the binding name. Defaults to `EMAIL`.
   * Useful if your wrangler config uses a different binding name.
   */
  bindingName?: string;
}

interface SendEmailBinding {
  send: (msg: {
    to: string | string[];
    from: string;
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
  }) => Promise<void>;
}

type CloudflareEnvWithEmail = Record<string, unknown>;

/**
 * Create a configured EmDash plugin that delivers emails through
 * Cloudflare Email Sending.
 */
export function createCfEmailPlugin(options: CfEmailPluginOptions) {
  if (!options.from) {
    throw new Error(
      'emdash-cloudflare-email: `from` option is required. Set it to a verified sender address (e.g., "noreply@example.com").',
    );
  }
  const bindingName = options.bindingName ?? 'EMAIL';

  return definePlugin({
    hooks: {
      'email:deliver': {
        exclusive: true,
        handler: async (event, ctx) => {
          const { message, source } = event;
          const cfEnv = env as CloudflareEnvWithEmail;
          const binding = cfEnv[bindingName] as SendEmailBinding | undefined;

          if (!binding || typeof binding.send !== 'function') {
            ctx.log.error(
              `Cloudflare Email binding "${bindingName}" is not available on env. Check wrangler.jsonc send_email.`,
              { source },
            );
            throw new Error(`EMAIL binding "${bindingName}" missing`);
          }

          ctx.log.info('Delivering email via Cloudflare Email Sending', {
            to: message.to,
            subject: message.subject,
            source,
          });

          await binding.send({
            to: message.to,
            from: options.from,
            subject: message.subject,
            html: message.html,
            text: message.text,
          });
        },
      },
    },
  });
}
