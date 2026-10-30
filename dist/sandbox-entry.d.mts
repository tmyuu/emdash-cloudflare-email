import { PluginContext } from "emdash/plugin";

//#region src/sandbox-entry.d.ts
/**
 * Admin UI locale. Source code stays English-only — all translated strings
 * live in the JSON catalogs under `./locales`, keyed identically.
 */
type Locale = 'en' | 'ja';
/**
 * Mirror of EmDash's `EmailMessage` shape, restated here so the same build
 * typechecks against every supported EmDash version (0.x does not re-export
 * it). `cc` and `replyTo` were added in EmDash 1.x and are absent on 0.x.
 * Keep in sync with upstream if the message grows new fields.
 */
type EmailMessage = {
  to: string;
  cc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
};
type EmailDeliverEvent = {
  message: EmailMessage;
  source: string;
};
type EmailDeliverHandler = (event: EmailDeliverEvent, ctx: PluginContext) => Promise<void>;
/**
 * Standard/sandbox-format entrypoint: a bare `{ hooks, routes }` object
 * annotated with `satisfies SandboxedPlugin` — EmDash standard plugins
 * do NOT call `definePlugin` (that is the native-format API).
 */
declare const _default: {
  hooks: {
    'email:deliver': {
      exclusive: true;
      handler: EmailDeliverHandler;
    };
  };
  routes: {
    admin: {
      handler: (routeCtx: {
        input: unknown;
      }, ctx: PluginContext) => Promise<{
        blocks: ({
          type: string;
          text: string;
          submit?: undefined;
          fields?: undefined;
        } | {
          type: string;
          submit: {
            label: string;
            action_id: string;
          };
          fields: ({
            type: string;
            action_id: string;
            label: string;
            options: {
              label: string;
              value: string;
            }[];
            initial_value: Locale;
            placeholder?: undefined;
            required?: undefined;
          } | {
            type: string;
            action_id: string;
            label: string;
            placeholder: string;
            initial_value: string;
            required: boolean;
            options?: undefined;
          })[];
          text?: undefined;
        } | {
          type: string;
          submit: {
            label: string;
            action_id: string;
          };
          fields: {
            type: string;
            action_id: string;
            label: string;
            placeholder: string;
            initial_value: string;
          }[];
          text?: undefined;
        })[];
      }>;
    };
  };
};
//#endregion
export { _default as default };