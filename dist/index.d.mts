import { PluginDescriptor } from "emdash";

//#region src/index.d.ts
/**
 * Build the EmDash plugin descriptor for the Cloudflare Email Sending
 * transport. Takes no arguments — From address and binding name are
 * configured from the admin settings page (see sandbox-entry).
 */
declare function cloudflareEmail(): PluginDescriptor;
//#endregion
export { cloudflareEmail, cloudflareEmail as default };