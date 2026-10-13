import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { handleInvitation } from "./handler.ts";

export default {
  fetch: withSupabase({auth: "user"}, (request, context) => handleInvitation(request, {
    supabase: context.supabase,
    resendKey: Deno.env.get("RESEND_API_KEY"),
    from: Deno.env.get("INVITE_FROM_EMAIL"),
    siteUrl: Deno.env.get("CRM_SITE_URL"),
    fetch,
  })),
};
