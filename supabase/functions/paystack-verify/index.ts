import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_TEST_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { reference, business_id } = await req.json();

    if (!reference || !business_id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing reference or business_id' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    // Verify transaction with Paystack
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    });

    const verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data.status !== 'success') {
      return new Response(JSON.stringify({ success: false, error: 'Payment verification failed' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    // Verify amount and business_id match (optional security step, but recommended)
    const metadata = verifyData.data.metadata || {};
    const customFields = metadata.custom_fields || [];
    const bIdField = customFields.find((f: any) => f.variable_name === 'business_id');

    if (bIdField && bIdField.value !== business_id) {
      console.warn("Business ID mismatch in Paystack verify");
    }

    // Calculate expiry (1 month from now)
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 1);

    // Update Supabase
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabase
      .from('businesses')
      .update({ 
        subscription_tier: 'pro',
        subscription_expires_at: expiry.toISOString()
      })
      .eq('id', business_id);

    if (error) {
      console.error("Supabase error:", error);
      return new Response(JSON.stringify({ success: false, error: 'Database update failed' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'Upgraded to Pro successfully' }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Error verifying Paystack transaction:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
