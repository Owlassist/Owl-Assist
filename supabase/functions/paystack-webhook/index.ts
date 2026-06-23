import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_TEST_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Read the raw body as text for signature verification
    const payload = await req.text();
    const signature = req.headers.get('x-paystack-signature');

    if (!signature) {
      console.error("Missing Paystack signature");
      return new Response("Missing signature", { status: 400 });
    }

    // Verify signature
    const hash = createHmac('sha512', PAYSTACK_SECRET_KEY!)
      .update(payload)
      .digest('hex');

    if (hash !== signature) {
      console.error("Invalid Paystack signature");
      return new Response("Invalid signature", { status: 400 });
    }

    // Parse event
    const event = JSON.parse(payload);
    console.log(`Received Paystack Webhook: ${event.event}`);

    // We only care about successful charges
    if (event.event === 'charge.success') {
      const metadata = event.data.metadata || {};
      const customFields = metadata.custom_fields || [];
      const bIdField = customFields.find((f: any) => f.variable_name === 'business_id');

      const actionField = customFields.find((f: any) => f.variable_name === 'action');
      const bundleField = customFields.find((f: any) => f.variable_name === 'bundle_amount');

      if (bIdField && bIdField.value) {
        const business_id = bIdField.value;
        const action = actionField ? actionField.value : 'upgrade_pro'; // default to upgrade for backward compatibility
        const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
        
        // Fetch current business state to increment credits correctly
        const { data: business } = await supabase.from('businesses').select('*').eq('id', business_id).single();
        if (!business) return new Response("Business not found", { status: 404 });

        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 1);

        if (action === 'buy_credits') {
          const bundleAmount = bundleField ? parseFloat(bundleField.value) : 0;
          const currentPurchased = parseFloat(String(business.purchased_credits ?? '0'));
          const newPurchased = currentPurchased + bundleAmount;

          const { error } = await supabase
            .from('businesses')
            .update({ 
              purchased_credits: newPurchased,
              purchased_credits_expires_at: expiry.toISOString()
            })
            .eq('id', business_id);

          if (error) {
            console.error("Supabase webhook update error:", error);
            return new Response("Database update failed", { status: 500 });
          }
          console.log(`Successfully added ${bundleAmount} credits to business ${business_id}`);

        } else {
          // Default: upgrade_pro
          const planLimit = parseFloat(String(business.plan_credit_limit ?? '500'));
          
          const { error } = await supabase
            .from('businesses')
            .update({ 
              subscription_tier: 'pro',
              subscription_expires_at: expiry.toISOString(),
              credits: planLimit // Reset credits to the plan's defined limit
            })
            .eq('id', business_id);

          if (error) {
            console.error("Supabase webhook update error:", error);
            return new Response("Database update failed", { status: 500 });
          }
          console.log(`Successfully upgraded business ${business_id} to pro via webhook`);
        }
      } else {
        console.warn("No business_id found in webhook metadata");
      }
    }

    return new Response("Webhook processed", { status: 200 });
  } catch (error) {
    console.error('Error processing Paystack webhook:', error);
    return new Response("Internal server error", { status: 500 });
  }
});
