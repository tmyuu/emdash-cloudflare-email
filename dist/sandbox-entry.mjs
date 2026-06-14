import { env } from "cloudflare:workers";
//#region src/sandbox-entry.ts
/** KV keys for runtime configuration (set via the admin settings page). */
const KV_FROM = "settings:fromAddress";
const KV_BINDING = "settings:bindingName";
const DEFAULT_BINDING = "EMAIL";
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
async function buildSettingsPage(ctx) {
	const fromAddress = await ctx.kv.get(KV_FROM) ?? "";
	const bindingName = await ctx.kv.get(KV_BINDING) ?? "";
	return { blocks: [
		{
			type: "section",
			text: "Send transactional email through the Cloudflare Email Sending Workers binding. No API token is required — authentication happens via the binding. The From domain must be onboarded to Cloudflare Email Sending (`wrangler email sending enable yourdomain.com` or the dashboard)."
		},
		{
			type: "form",
			submit: {
				label: "Save Settings",
				action_id: "save_settings"
			},
			fields: [{
				type: "text_input",
				action_id: "fromAddress",
				label: "From Address",
				placeholder: "Your App <noreply@yourdomain.com>",
				initial_value: fromAddress,
				required: true
			}, {
				type: "text_input",
				action_id: "bindingName",
				label: "Binding Name",
				placeholder: DEFAULT_BINDING,
				initial_value: bindingName,
				required: false
			}]
		},
		{
			type: "section",
			text: "Send a test email through the binding to verify your setup."
		},
		{
			type: "form",
			submit: {
				label: "Send Test Email",
				action_id: "test_email"
			},
			fields: [{
				type: "text_input",
				action_id: "testEmailAddress",
				label: "Test Recipient",
				placeholder: "you@example.com",
				initial_value: ""
			}]
		}
	] };
}
async function saveSettings(ctx, values) {
	try {
		if (typeof values.fromAddress === "string") {
			if (!parseFrom(values.fromAddress)) return {
				...await buildSettingsPage(ctx),
				toast: {
					message: "From Address must be \"name@domain\" or \"Display <name@domain>\"",
					type: "error"
				}
			};
			await ctx.kv.set(KV_FROM, values.fromAddress);
		}
		if (typeof values.bindingName === "string") {
			const trimmed = values.bindingName.trim();
			if (trimmed) await ctx.kv.set(KV_BINDING, trimmed);
			else await ctx.kv.delete(KV_BINDING);
		}
		return {
			...await buildSettingsPage(ctx),
			toast: {
				message: "Settings saved",
				type: "success"
			}
		};
	} catch (err) {
		ctx.log.error("Failed to save Cloudflare Email settings", err);
		return {
			...await buildSettingsPage(ctx),
			toast: {
				message: "Failed to save settings",
				type: "error"
			}
		};
	}
}
async function sendTestEmail(ctx, values) {
	try {
		const fromRaw = await ctx.kv.get(KV_FROM);
		const recipient = values.testEmailAddress;
		if (!fromRaw) return {
			...await buildSettingsPage(ctx),
			toast: {
				message: "Save the From address before sending a test",
				type: "error"
			}
		};
		if (!isValidEmail(recipient)) return {
			...await buildSettingsPage(ctx),
			toast: {
				message: "Enter a valid recipient",
				type: "error"
			}
		};
		const from = parseFrom(fromRaw);
		if (!from) return {
			...await buildSettingsPage(ctx),
			toast: {
				message: "Invalid From address — re-save settings",
				type: "error"
			}
		};
		await getBinding(await getBindingName(ctx)).send({
			to: recipient,
			from,
			subject: "EmDash Cloudflare Email test",
			text: "Hello from your EmDash Cloudflare Email plugin. Delivery via the Workers binding is working.",
			html: "<p>Hello from your EmDash Cloudflare Email plugin. Delivery via the Workers binding is working.</p>"
		});
		return {
			...await buildSettingsPage(ctx),
			toast: {
				message: "Test email sent",
				type: "success"
			}
		};
	} catch (err) {
		return {
			...await buildSettingsPage(ctx),
			toast: {
				message: `Error: ${err.message}`,
				type: "error"
			}
		};
	}
}
const deliverHandler = async (event, ctx) => {
	const fromRaw = await ctx.kv.get(KV_FROM);
	if (!fromRaw) throw new Error("Cloudflare Email plugin not configured. Set the From address in plugin settings.");
	const from = parseFrom(fromRaw);
	if (!from) throw new Error("Invalid From address in plugin settings");
	const { message } = event;
	await getBinding(await getBindingName(ctx)).send({
		to: message.to,
		from,
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
