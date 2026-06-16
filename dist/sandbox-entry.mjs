import { env } from "cloudflare:workers";
//#endregion
//#region src/sandbox-entry.ts
const CATALOGS = {
	en: {
		intro: "Send transactional email through the Cloudflare Email Sending Workers binding. No API token is required — authentication happens via the binding. The From domain must be onboarded to Cloudflare Email Sending (`wrangler email sending enable yourdomain.com` or the dashboard).",
		languageLabel: "Language",
		langEnglish: "English",
		langJapanese: "日本語",
		displayNameLabel: "Display Name",
		displayNameSiteHint: "(site name, used when blank)",
		displayNameFallbackPlaceholder: "Your App",
		fromLabel: "From Address",
		replyToLabel: "Reply-To",
		bindingLabel: "Binding Name",
		saveButton: "Save Settings",
		testIntro: "Send a test email through the binding to verify your setup.",
		testRecipientLabel: "Test Recipient",
		testButton: "Send Test Email",
		toastSaved: "Settings saved",
		toastSaveFailed: "Failed to save settings",
		toastFromInvalid: "From Address must be a valid email (e.g. noreply@yourdomain.com)",
		toastReplyToInvalid: "Reply-To must be a valid email or left empty",
		toastTestNoFrom: "Save the From address before sending a test",
		toastTestInvalidRecipient: "Enter a valid recipient",
		toastTestSent: "Test email sent",
		toastErrorPrefix: "Error: "
	},
	ja: {
		intro: "Cloudflare Email Sending の Workers バインディング経由でトランザクションメールを送信します。バインディングで認証されるため API トークンは不要です。差出人ドメインは Cloudflare Email Sending にオンボード済みである必要があります（`wrangler email sending enable yourdomain.com` またはダッシュボード）。",
		languageLabel: "言語",
		langEnglish: "English",
		langJapanese: "日本語",
		displayNameLabel: "表示名",
		displayNameSiteHint: "（サイト名・空欄時に使用）",
		displayNameFallbackPlaceholder: "アプリ名",
		fromLabel: "差出人アドレス",
		replyToLabel: "返信先 (Reply-To)",
		bindingLabel: "バインディング名",
		saveButton: "設定を保存",
		testIntro: "設定を確認するため、バインディング経由でテストメールを送信します。",
		testRecipientLabel: "テスト送信先",
		testButton: "テストメールを送信",
		toastSaved: "設定を保存しました",
		toastSaveFailed: "設定の保存に失敗しました",
		toastFromInvalid: "差出人アドレスは有効なメールアドレスを入力してください（例: noreply@yourdomain.com）",
		toastReplyToInvalid: "返信先は有効なメールアドレスか、空欄にしてください",
		toastTestNoFrom: "テスト送信の前に差出人アドレスを保存してください",
		toastTestInvalidRecipient: "有効な送信先を入力してください",
		toastTestSent: "テストメールを送信しました",
		toastErrorPrefix: "エラー: "
	}
};
/** KV keys for runtime configuration (set via the admin settings page). */
const KV_FROM = "settings:fromAddress";
const KV_DISPLAY_NAME = "settings:displayName";
const KV_REPLY_TO = "settings:replyTo";
const KV_BINDING = "settings:bindingName";
const KV_LOCALE = "settings:locale";
const DEFAULT_BINDING = "EMAIL";
const DEFAULT_LOCALE = "en";
async function getLocale(ctx) {
	return await ctx.kv.get(KV_LOCALE) === "ja" ? "ja" : DEFAULT_LOCALE;
}
/** Resolve the admin UI message catalog for the configured locale. */
async function getMessages(ctx) {
	return CATALOGS[await getLocale(ctx)];
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (v) => typeof v === "string" && EMAIL_RE.test(v);
/** Parse `"name@domain"` or `"Display Name <name@domain>"`. */
function parseFrom(input) {
	const m = input.match(/^\s*(?:(.+?)\s*<\s*([^>]+?)\s*>|([^\s<>]+))\s*$/);
	if (!m) return null;
	const email = (m[2] ?? m[3] ?? "").trim();
	if (!isValidEmail(email)) return null;
	const name = m[1]?.trim().replace(/^"|"$/g, "");
	return name ? {
		email,
		name
	} : { email };
}
function getBinding(name) {
	const binding = env[name];
	if (!binding || typeof binding.send !== "function") throw new Error(`Cloudflare Email Sending binding "${name}" not found on env. Add it to your wrangler config: { "send_email": [{ "name": "${name}" }] }, then redeploy. The plugin must run via emdash \`plugins:\` (in-process), not \`sandboxed:\`, so the binding is in scope.`);
	return binding;
}
async function getBindingName(ctx) {
	const name = await ctx.kv.get(KV_BINDING);
	return name && name.trim() ? name.trim() : DEFAULT_BINDING;
}
/**
* Resolve the configured sender into a Cloudflare `from` value. Combines the
* From email with the optional display name. Throws if the From address is
* missing or invalid (so callers surface a clear setup error).
*/
async function resolveFrom(ctx) {
	const fromRaw = await ctx.kv.get(KV_FROM);
	if (!fromRaw) throw new Error("Cloudflare Email plugin not configured. Set the From address in plugin settings.");
	const parsed = parseFrom(fromRaw);
	if (!parsed) throw new Error("Invalid From address in plugin settings");
	const displayName = (await ctx.kv.get(KV_DISPLAY_NAME))?.trim() || parsed.name || ctx.site?.name?.trim();
	return displayName ? {
		email: parsed.email,
		name: displayName
	} : { email: parsed.email };
}
/** Optional Reply-To address, validated. Returns undefined when unset. */
async function getReplyTo(ctx) {
	const raw = (await ctx.kv.get(KV_REPLY_TO))?.trim();
	return raw && isValidEmail(raw) ? raw : void 0;
}
async function buildSettingsPage(ctx) {
	const fromAddress = await ctx.kv.get(KV_FROM) ?? "";
	const displayName = await ctx.kv.get(KV_DISPLAY_NAME) ?? "";
	const replyTo = await ctx.kv.get(KV_REPLY_TO) ?? "";
	const bindingName = await ctx.kv.get(KV_BINDING) ?? "";
	const locale = await getLocale(ctx);
	const m = CATALOGS[locale];
	const siteName = ctx.site?.name?.trim();
	return { blocks: [
		{
			type: "section",
			text: m.intro
		},
		{
			type: "form",
			submit: {
				label: m.saveButton,
				action_id: "save_settings"
			},
			fields: [
				{
					type: "select",
					action_id: "locale",
					label: m.languageLabel,
					options: [{
						label: m.langEnglish,
						value: "en"
					}, {
						label: m.langJapanese,
						value: "ja"
					}],
					initial_value: locale
				},
				{
					type: "text_input",
					action_id: "displayName",
					label: m.displayNameLabel,
					placeholder: siteName ? `${siteName} ${m.displayNameSiteHint}` : m.displayNameFallbackPlaceholder,
					initial_value: displayName,
					required: false
				},
				{
					type: "text_input",
					action_id: "fromAddress",
					label: m.fromLabel,
					placeholder: "noreply@yourdomain.com",
					initial_value: fromAddress,
					required: true
				},
				{
					type: "text_input",
					action_id: "replyTo",
					label: m.replyToLabel,
					placeholder: "support@yourdomain.com",
					initial_value: replyTo,
					required: false
				},
				{
					type: "text_input",
					action_id: "bindingName",
					label: m.bindingLabel,
					placeholder: DEFAULT_BINDING,
					initial_value: bindingName,
					required: false
				}
			]
		},
		{
			type: "section",
			text: m.testIntro
		},
		{
			type: "form",
			submit: {
				label: m.testButton,
				action_id: "test_email"
			},
			fields: [{
				type: "text_input",
				action_id: "testEmailAddress",
				label: m.testRecipientLabel,
				placeholder: "you@example.com",
				initial_value: ""
			}]
		}
	] };
}
async function saveSettings(ctx, values) {
	try {
		if (values.locale === "en" || values.locale === "ja") await ctx.kv.set(KV_LOCALE, values.locale);
		const m = await getMessages(ctx);
		if (typeof values.fromAddress === "string") {
			const parsed = parseFrom(values.fromAddress);
			if (!parsed) return {
				...await buildSettingsPage(ctx),
				toast: {
					message: m.toastFromInvalid,
					type: "error"
				}
			};
			await ctx.kv.set(KV_FROM, parsed.email);
		}
		if (typeof values.displayName === "string") {
			const trimmed = values.displayName.trim();
			if (trimmed) await ctx.kv.set(KV_DISPLAY_NAME, trimmed);
			else await ctx.kv.delete(KV_DISPLAY_NAME);
		}
		if (typeof values.replyTo === "string") {
			const trimmed = values.replyTo.trim();
			if (trimmed && !isValidEmail(trimmed)) return {
				...await buildSettingsPage(ctx),
				toast: {
					message: m.toastReplyToInvalid,
					type: "error"
				}
			};
			if (trimmed) await ctx.kv.set(KV_REPLY_TO, trimmed);
			else await ctx.kv.delete(KV_REPLY_TO);
		}
		if (typeof values.bindingName === "string") {
			const trimmed = values.bindingName.trim();
			if (trimmed) await ctx.kv.set(KV_BINDING, trimmed);
			else await ctx.kv.delete(KV_BINDING);
		}
		return {
			...await buildSettingsPage(ctx),
			toast: {
				message: m.toastSaved,
				type: "success"
			}
		};
	} catch (err) {
		ctx.log.error("Failed to save Cloudflare Email settings", err);
		return {
			...await buildSettingsPage(ctx),
			toast: {
				message: (await getMessages(ctx)).toastSaveFailed,
				type: "error"
			}
		};
	}
}
async function sendTestEmail(ctx, values) {
	const m = await getMessages(ctx);
	try {
		const fromRaw = await ctx.kv.get(KV_FROM);
		const recipient = values.testEmailAddress;
		if (!fromRaw) return {
			...await buildSettingsPage(ctx),
			toast: {
				message: m.toastTestNoFrom,
				type: "error"
			}
		};
		if (!isValidEmail(recipient)) return {
			...await buildSettingsPage(ctx),
			toast: {
				message: m.toastTestInvalidRecipient,
				type: "error"
			}
		};
		const from = await resolveFrom(ctx);
		const replyTo = await getReplyTo(ctx);
		await getBinding(await getBindingName(ctx)).send({
			to: recipient,
			from,
			...replyTo && { replyTo },
			subject: "EmDash Cloudflare Email test",
			text: "Hello from your EmDash Cloudflare Email plugin. Delivery via the Workers binding is working.",
			html: "<p>Hello from your EmDash Cloudflare Email plugin. Delivery via the Workers binding is working.</p>"
		});
		return {
			...await buildSettingsPage(ctx),
			toast: {
				message: m.toastTestSent,
				type: "success"
			}
		};
	} catch (err) {
		return {
			...await buildSettingsPage(ctx),
			toast: {
				message: `${m.toastErrorPrefix}${err.message}`,
				type: "error"
			}
		};
	}
}
const deliverHandler = async (event, ctx) => {
	const from = await resolveFrom(ctx);
	const replyTo = await getReplyTo(ctx);
	const { message } = event;
	await getBinding(await getBindingName(ctx)).send({
		to: message.to,
		from,
		...replyTo && { replyTo },
		subject: message.subject,
		html: message.html,
		text: message.text
	});
	ctx.log.info("Email delivered via Cloudflare Email Sending", {
		to: message.to,
		source: event.source
	});
};
const adminHandler = async (routeCtx, ctx) => {
	const interaction = routeCtx.input;
	if (interaction.type === "page_load" && interaction.page === "/settings") return buildSettingsPage(ctx);
	if (interaction.type === "form_submit" && interaction.action_id === "save_settings") return saveSettings(ctx, interaction.values ?? {});
	if (interaction.type === "form_submit" && interaction.action_id === "test_email") return sendTestEmail(ctx, interaction.values ?? {});
	return { blocks: [] };
};
/**
* Standard/sandbox-format entrypoint: a bare `{ hooks, routes }` object
* annotated with `satisfies SandboxedPlugin` — EmDash 0.19 standard plugins
* do NOT call `definePlugin` (that is the native-format API).
*/
var sandbox_entry_default = {
	hooks: { "email:deliver": {
		exclusive: true,
		handler: deliverHandler
	} },
	routes: { admin: { handler: adminHandler } }
};
//#endregion
export { sandbox_entry_default as default };
