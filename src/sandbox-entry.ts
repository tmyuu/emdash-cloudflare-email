/**
 * Sandbox entrypoint for emdash-cloudflare-email.
 *
 * Implements the exclusive `email:deliver` hook (the single active transport
 * selected in EmDash → Settings → Email) plus a Block Kit admin settings
 * page for configuring the From address and the binding name, with a
 * test-send action.
 *
 * Delivery goes through the host Worker's Cloudflare Email Sending binding
 * (`env.EMAIL.send(...)` by default) — no API token required.
 */

import type { PluginContext, SandboxedPlugin } from 'emdash/plugin';
import { env as cfEnv } from 'cloudflare:workers';

/**
 * Mirror of EmDash's internal `EmailMessage` shape. EmDash 0.19 does not
 * re-export it from the public entrypoint, so we restate the contract here.
 * Keep in sync with upstream if the message grows new fields.
 */
type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

type EmailDeliverEvent = { message: EmailMessage; source: string };
type EmailDeliverHandler = (
  event: EmailDeliverEvent,
  ctx: PluginContext,
) => Promise<void>;

/** KV keys for runtime configuration (set via the admin settings page). */
const KV_FROM = 'settings:fromAddress';
const KV_DISPLAY_NAME = 'settings:displayName';
const KV_REPLY_TO = 'settings:replyTo';
const KV_BINDING = 'settings:bindingName';
const DEFAULT_BINDING = 'EMAIL';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (v: unknown): v is string =>
  typeof v === 'string' && EMAIL_RE.test(v);

type FromAddress = { email: string; name?: string };

/** Parse `"name@domain"` or `"Display Name <name@domain>"`. */
function parseFrom(input: string): FromAddress | null {
  const m = input.match(/^\s*(?:(.+?)\s*<\s*([^>]+?)\s*>|([^\s<>]+))\s*$/);
  if (!m) return null;
  const email = (m[2] ?? m[3] ?? '').trim();
  if (!isValidEmail(email)) return null;
  const name = m[1]?.trim().replace(/^"|"$/g, '');
  return name ? { email, name } : { email };
}

/**
 * Minimal structural type for Cloudflare's `send_email` binding. Typed here
 * so the plugin does not depend on the host Worker's generated `Env`.
 * https://developers.cloudflare.com/email-service/email-sending/
 */
type EmailAddressInput = FromAddress | string;

type SendEmailBinding = {
  send(message: {
    to: string | string[];
    from: EmailAddressInput;
    replyTo?: EmailAddressInput;
    subject: string;
    html?: string;
    text?: string;
  }): Promise<{ messageId?: string }>;
};

function getBinding(name: string): SendEmailBinding {
  const env = cfEnv as unknown as Record<string, unknown>;
  const binding = env[name] as SendEmailBinding | undefined;
  if (!binding || typeof binding.send !== 'function') {
    throw new Error(
      `Cloudflare Email Sending binding "${name}" not found on env. ` +
        `Add it to your wrangler config: { "send_email": [{ "name": "${name}" }] }, ` +
        `then redeploy. The plugin must run via emdash \`plugins:\` (in-process), ` +
        `not \`sandboxed:\`, so the binding is in scope.`,
    );
  }
  return binding;
}

async function getBindingName(ctx: PluginContext): Promise<string> {
  const name = await ctx.kv.get<string>(KV_BINDING);
  return name && name.trim() ? name.trim() : DEFAULT_BINDING;
}

/**
 * Resolve the configured sender into a Cloudflare `from` value. Combines the
 * From email with the optional display name. Throws if the From address is
 * missing or invalid (so callers surface a clear setup error).
 */
async function resolveFrom(ctx: PluginContext): Promise<FromAddress> {
  const fromRaw = await ctx.kv.get<string>(KV_FROM);
  if (!fromRaw) {
    throw new Error(
      'Cloudflare Email plugin not configured. Set the From address in plugin settings.',
    );
  }
  const parsed = parseFrom(fromRaw);
  if (!parsed) throw new Error('Invalid From address in plugin settings');
  const explicit = (await ctx.kv.get<string>(KV_DISPLAY_NAME))?.trim();
  // Display-name precedence: explicit setting → name embedded in the From
  // value → EmDash's site name (`ctx.site.name`) as a sensible default.
  const displayName = explicit || parsed.name || ctx.site?.name?.trim();
  return displayName ? { email: parsed.email, name: displayName } : { email: parsed.email };
}

/** Optional Reply-To address, validated. Returns undefined when unset. */
async function getReplyTo(ctx: PluginContext): Promise<string | undefined> {
  const raw = (await ctx.kv.get<string>(KV_REPLY_TO))?.trim();
  return raw && isValidEmail(raw) ? raw : undefined;
}

// ---------------------------------------------------------------------------
// Admin settings page (Block Kit)
// ---------------------------------------------------------------------------

async function buildSettingsPage(ctx: PluginContext) {
  const fromAddress = (await ctx.kv.get<string>(KV_FROM)) ?? '';
  const displayName = (await ctx.kv.get<string>(KV_DISPLAY_NAME)) ?? '';
  const replyTo = (await ctx.kv.get<string>(KV_REPLY_TO)) ?? '';
  const bindingName = (await ctx.kv.get<string>(KV_BINDING)) ?? '';
  const siteName = ctx.site?.name?.trim();
  return {
    blocks: [
      {
        type: 'section',
        text: 'Send transactional email through the Cloudflare Email Sending Workers binding. No API token is required — authentication happens via the binding. The From domain must be onboarded to Cloudflare Email Sending (`wrangler email sending enable yourdomain.com` or the dashboard).',
      },
      {
        type: 'form',
        submit: { label: 'Save Settings', action_id: 'save_settings' },
        fields: [
          {
            type: 'text_input',
            action_id: 'displayName',
            label: 'Display Name',
            placeholder: siteName
              ? `${siteName} (site name, used when blank)`
              : 'Your App',
            initial_value: displayName,
            required: false,
          },
          {
            type: 'text_input',
            action_id: 'fromAddress',
            label: 'From Address',
            placeholder: 'noreply@yourdomain.com',
            initial_value: fromAddress,
            required: true,
          },
          {
            type: 'text_input',
            action_id: 'replyTo',
            label: 'Reply-To',
            placeholder: 'support@yourdomain.com',
            initial_value: replyTo,
            required: false,
          },
          {
            type: 'text_input',
            action_id: 'bindingName',
            label: 'Binding Name',
            placeholder: DEFAULT_BINDING,
            initial_value: bindingName,
            required: false,
          },
        ],
      },
      {
        type: 'section',
        text: 'Send a test email through the binding to verify your setup.',
      },
      {
        type: 'form',
        submit: { label: 'Send Test Email', action_id: 'test_email' },
        fields: [
          {
            type: 'text_input',
            action_id: 'testEmailAddress',
            label: 'Test Recipient',
            placeholder: 'you@example.com',
            initial_value: '',
          },
        ],
      },
    ],
  };
}

async function saveSettings(
  ctx: PluginContext,
  values: Record<string, unknown>,
) {
  try {
    if (typeof values.fromAddress === 'string') {
      const parsed = parseFrom(values.fromAddress);
      if (!parsed) {
        return {
          ...(await buildSettingsPage(ctx)),
          toast: {
            message: 'From Address must be a valid email (e.g. noreply@yourdomain.com)',
            type: 'error',
          },
        };
      }
      // Store the bare email; the display name lives in its own field.
      await ctx.kv.set(KV_FROM, parsed.email);
    }
    if (typeof values.displayName === 'string') {
      const trimmed = values.displayName.trim();
      if (trimmed) await ctx.kv.set(KV_DISPLAY_NAME, trimmed);
      else await ctx.kv.delete(KV_DISPLAY_NAME);
    }
    if (typeof values.replyTo === 'string') {
      const trimmed = values.replyTo.trim();
      if (trimmed && !isValidEmail(trimmed)) {
        return {
          ...(await buildSettingsPage(ctx)),
          toast: {
            message: 'Reply-To must be a valid email or left empty',
            type: 'error',
          },
        };
      }
      if (trimmed) await ctx.kv.set(KV_REPLY_TO, trimmed);
      else await ctx.kv.delete(KV_REPLY_TO);
    }
    if (typeof values.bindingName === 'string') {
      const trimmed = values.bindingName.trim();
      // Empty → fall back to the default binding name.
      if (trimmed) await ctx.kv.set(KV_BINDING, trimmed);
      else await ctx.kv.delete(KV_BINDING);
    }
    return {
      ...(await buildSettingsPage(ctx)),
      toast: { message: 'Settings saved', type: 'success' },
    };
  } catch (err) {
    ctx.log.error('Failed to save Cloudflare Email settings', err as Error);
    return {
      ...(await buildSettingsPage(ctx)),
      toast: { message: 'Failed to save settings', type: 'error' },
    };
  }
}

async function sendTestEmail(
  ctx: PluginContext,
  values: Record<string, unknown>,
) {
  try {
    const fromRaw = await ctx.kv.get<string>(KV_FROM);
    const recipient = values.testEmailAddress as string | undefined;
    if (!fromRaw) {
      return {
        ...(await buildSettingsPage(ctx)),
        toast: {
          message: 'Save the From address before sending a test',
          type: 'error',
        },
      };
    }
    if (!isValidEmail(recipient)) {
      return {
        ...(await buildSettingsPage(ctx)),
        toast: { message: 'Enter a valid recipient', type: 'error' },
      };
    }
    const from = await resolveFrom(ctx);
    const replyTo = await getReplyTo(ctx);
    const binding = getBinding(await getBindingName(ctx));
    await binding.send({
      to: recipient,
      from,
      ...(replyTo && { replyTo }),
      subject: 'EmDash Cloudflare Email test',
      text: 'Hello from your EmDash Cloudflare Email plugin. Delivery via the Workers binding is working.',
      html: '<p>Hello from your EmDash Cloudflare Email plugin. Delivery via the Workers binding is working.</p>',
    });
    return {
      ...(await buildSettingsPage(ctx)),
      toast: { message: 'Test email sent', type: 'success' },
    };
  } catch (err) {
    return {
      ...(await buildSettingsPage(ctx)),
      toast: { message: `Error: ${(err as Error).message}`, type: 'error' },
    };
  }
}

// ---------------------------------------------------------------------------
// email:deliver hook (exclusive transport)
// ---------------------------------------------------------------------------

const deliverHandler: EmailDeliverHandler = async (event, ctx) => {
  const from = await resolveFrom(ctx);
  const replyTo = await getReplyTo(ctx);

  const { message } = event;
  const binding = getBinding(await getBindingName(ctx));
  await binding.send({
    to: message.to,
    from,
    ...(replyTo && { replyTo }),
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  ctx.log.info('Email delivered via Cloudflare Email Sending', {
    to: message.to,
    source: event.source,
  });
};

// ---------------------------------------------------------------------------
// Admin route dispatcher
// ---------------------------------------------------------------------------

type AdminInteraction = {
  type: 'page_load' | 'form_submit' | string;
  page?: string;
  action_id?: string;
  values?: Record<string, unknown>;
};

const adminHandler = async (
  routeCtx: { input: unknown },
  ctx: PluginContext,
) => {
  const interaction = routeCtx.input as AdminInteraction;
  if (interaction.type === 'page_load' && interaction.page === '/settings') {
    return buildSettingsPage(ctx);
  }
  if (
    interaction.type === 'form_submit' &&
    interaction.action_id === 'save_settings'
  ) {
    return saveSettings(ctx, interaction.values ?? {});
  }
  if (
    interaction.type === 'form_submit' &&
    interaction.action_id === 'test_email'
  ) {
    return sendTestEmail(ctx, interaction.values ?? {});
  }
  return { blocks: [] };
};

/**
 * Standard/sandbox-format entrypoint: a bare `{ hooks, routes }` object
 * annotated with `satisfies SandboxedPlugin` — EmDash 0.19 standard plugins
 * do NOT call `definePlugin` (that is the native-format API).
 */
export default {
  hooks: {
    'email:deliver': {
      exclusive: true,
      handler: deliverHandler,
    },
  },
  routes: {
    admin: { handler: adminHandler },
  },
} satisfies SandboxedPlugin;
