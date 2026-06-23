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

    const actionField = customFields.find((f: any) => f.variable_name === 'action');
    const bundleField = customFields.find((f: any) => f.variable_name === 'bundle_amount');

    const action = actionField ? actionField.value : 'upgrade_pro';
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Fetch current business state
    const { data: business } = await supabase.from('businesses').select('*').eq('id', business_id).single();
    if (!business) {
       return new Response(JSON.stringify({ success: false, error: 'Business not found' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404
      });
    }

    // Calculate expiry (1 month from now)
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
        console.error("Supabase error:", error);
        return new Response(JSON.stringify({ success: false, error: 'Database update failed' }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        });
      }

      return new Response(JSON.stringify({ success: true, message: `Successfully purchased ${bundleAmount} credits` }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });

    } else {
      // Default: upgrade_pro
      const planLimit = parseFloat(String(business.plan_credit_limit ?? '500'));

      const { error } = await supabase
        .from('businesses')
        .update({ 
          subscription_tier: 'pro',
          subscription_expires_at: expiry.toISOString(),
          credits: planLimit
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
