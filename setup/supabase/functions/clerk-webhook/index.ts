import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "https://esm.sh/svix@1.21.0";

/**
 * Clerk User Sync Webhook
 * 
 * Verifies and handles 'user.created', 'user.updated', and 'user.deleted' events from Clerk.
 * Syncs the data to the 'public.businesses' table in Supabase.
 */

const CLERK_WEBHOOK_SECRET = Deno.env.get('CLERK_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // 1. Verify Webhook Signature
    const svix_id = req.headers.get("svix-id");
    const svix_timestamp = req.headers.get("svix-timestamp");
    const svix_signature = req.headers.get("svix-signature");

    if (!svix_id || !svix_timestamp || !svix_signature) {
      console.error("Missing svix headers");
      return new Response("Error: Missing svix headers", { status: 400 });
    }

    if (!CLERK_WEBHOOK_SECRET) {
      console.error("CLERK_WEBHOOK_SECRET is not set");
      return new Response("Error: Server configuration error", { status: 500 });
    }

    const payload = await req.text();
    const wh = new Webhook(CLERK_WEBHOOK_SECRET);

    let evt: any;
    try {
      evt = wh.verify(payload, {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("Verification failed:", errorMessage);
      return new Response("Error: Verification failed", { status: 400 });
    }

    const { data, type } = evt;
    console.log(`Received Clerk Webhook: ${type}`);

    // 2. Initialize Supabase Admin Client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 3. Handle Events
    if (type === 'user.created' || type === 'user.updated') {
      const { id, username, first_name, last_name, email_addresses, unsafe_metadata, image_url } = data;
      const email = email_addresses[0]?.email_address;

      // Sync metadata: business_name, country, website_url
      const name = unsafe_metadata?.business_name || `${first_name || ''} ${last_name || ''}`.trim() || 'New Business';
      const country = unsafe_metadata?.country || 'N/A';
      const website_url = unsafe_metadata?.website_url || null;
      const finalUsername = username || unsafe_metadata?.business_username || null;

      const { error } = await supabase
        .from('businesses')
        .upsert({
          id,
          username: finalUsername,
          name,
          email,
          country,
          website_url,
          image_url
        }, { onConflict: 'id' });

      if (error) {
        console.error("DB Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 400 });
      }
    }

    if (type === 'user.deleted') {
      const { id } = data;
      const { error } = await supabase.from('businesses').delete().eq('id', id);
      if (error) {
        console.error("DB Delete Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 400 });
      }
    }

    return new Response(JSON.stringify({ status: "Synced Successfully" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Webhook Processing Error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500 });
  }
});
