import { PluginContext } from "emdash/plugin";

//#region src/sandbox-entry.d.ts
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
type EmailDeliverEvent = {
  message: EmailMessage;
  source: string;
};
type EmailDeliverHandler = (event: EmailDeliverEvent, ctx: PluginContext) => Promise<void>;
/**
 * Standard/sandbox-format entrypoint: a bare `{ hooks, routes }` object
 * annotated with `satisfies SandboxedPlugin` — EmDash 0.19 standard plugins
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
          fields: {
            type: string;
            action_id: string;
            label: string;
            placeholder: string;
            initial_value: string;
            required: boolean;
          }[];
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