//#region src/index.ts
/**
* Build the EmDash plugin descriptor for the Cloudflare Email Sending
* transport. Takes no arguments — From address and binding name are
* configured from the admin settings page (see sandbox-entry).
*/
function cloudflareEmail() {
	return {
		id: "cf-email-sending",
		version: "0.2.0",
		format: "standard",
		entrypoint: "emdash-cloudflare-email/sandbox",
		capabilities: ["email:provide"],
		adminPages: [{
			path: "/settings",
			label: "Cloudflare Email",
			icon: "email"
		}]
	};
}
//#endregion
export { cloudflareEmail, cloudflareEmail as default };
