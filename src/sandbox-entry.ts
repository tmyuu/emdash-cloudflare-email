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
import en from './locales/en.json';
import ja from './locales/ja.json';

/**
 * Admin UI locale. Source code stays English-only — all translated strings
 * live in the JSON catalogs under `./locales`, keyed identically.
 */
type Locale = 'en' | 'ja';
type Messages = Record<keyof typeof en, string>;
const CATALOGS: Record<Locale, Messages> = { en, ja };

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
const KV_LOCALE = 'settings:locale';
const DEFAULT_BINDING = 'EMAIL';
const DEFAULT_LOCALE: Locale = 'en';

async function getLocale(ctx: PluginContext): Promise<Locale> {
  return (await ctx.kv.get<string>(KV_LOCALE)) === 'ja' ? 'ja' : DEFAULT_LOCALE;
}

/** Resolve the admin UI message catalog for the configured locale. */
async function getMessages(ctx: PluginContext): Promise<Messages> {
  return CATALOGS[await getLocale(ctx)];
}

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
  const locale = await getLocale(ctx);
  const m = CATALOGS[locale];
  const siteName = ctx.site?.name?.trim();
  return {
    blocks: [
      {
        type: 'section',
        text: m.intro,
      },
      {
        type: 'form',
        submit: { label: m.saveButton, action_id: 'save_settings' },
        fields: [
          {
            type: 'select',
            action_id: 'locale',
            label: m.languageLabel,
            options: [
              { label: m.langEnglish, value: 'en' },
              { label: m.langJapanese, value: 'ja' },
            ],
            initial_value: locale,
          },
          {
            type: 'text_input',
            action_id: 'displayName',
            label: m.displayNameLabel,
            placeholder: siteName
              ? `${siteName} ${m.displayNameSiteHint}`
              : m.displayNameFallbackPlaceholder,
            initial_value: displayName,
            required: false,
          },
          {
            type: 'text_input',
            action_id: 'fromAddress',
            label: m.fromLabel,
            placeholder: 'noreply@yourdomain.com',
            initial_value: fromAddress,
            required: true,
          },
          {
            type: 'text_input',
            action_id: 'replyTo',
            label: m.replyToLabel,
            placeholder: 'support@yourdomain.com',
            initial_value: replyTo,
            required: false,
          },
          {
            type: 'text_input',
            action_id: 'bindingName',
            label: m.bindingLabel,
            placeholder: DEFAULT_BINDING,
            initial_value: bindingName,
            required: false,
          },
        ],
      },
      {
        type: 'section',
        text: m.testIntro,
      },
      {
        type: 'form',
        submit: { label: m.testButton, action_id: 'test_email' },
        fields: [
          {
            type: 'text_input',
            action_id: 'testEmailAddress',
            label: m.testRecipientLabel,
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
    // Persist the locale first so the returned page and toasts reflect it.
    if (values.locale === 'en' || values.locale === 'ja') {
      await ctx.kv.set(KV_LOCALE, values.locale);
    }
    const m = await getMessages(ctx);
    if (typeof values.fromAddress === 'string') {
      const parsed = parseFrom(values.fromAddress);
      if (!parsed) {
        return {
          ...(await buildSettingsPage(ctx)),
          toast: { message: m.toastFromInvalid, type: 'error' },
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
          toast: { message: m.toastReplyToInvalid, type: 'error' },
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
      toast: { message: m.toastSaved, type: 'success' },
    };
  } catch (err) {
    ctx.log.error('Failed to save Cloudflare Email settings', err as Error);
    return {
      ...(await buildSettingsPage(ctx)),
      toast: { message: (await getMessages(ctx)).toastSaveFailed, type: 'error' },
    };
  }
}

async function sendTestEmail(
  ctx: PluginContext,
  values: Record<string, unknown>,
) {
  const m = await getMessages(ctx);
  try {
    const fromRaw = await ctx.kv.get<string>(KV_FROM);
    const recipient = values.testEmailAddress as string | undefined;
    if (!fromRaw) {
      return {
        ...(await buildSettingsPage(ctx)),
        toast: { message: m.toastTestNoFrom, type: 'error' },
      };
    }
    if (!isValidEmail(recipient)) {
      return {
        ...(await buildSettingsPage(ctx)),
        toast: { message: m.toastTestInvalidRecipient, type: 'error' },
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
      toast: { message: m.toastTestSent, type: 'success' },
    };
  } catch (err) {
    return {
      ...(await buildSettingsPage(ctx)),
      toast: {
        message: `${m.toastErrorPrefix}${(err as Error).message}`,
        type: 'error',
      },
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
