import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Manage Slots - Secure Bridge
 * Verifies business identity via Clerk and updates the database.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE, PUT',
};

Deno.serve(async (req) => {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Initialize Supabase Admin Client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload = await req.json();
    const { operation, business_id, settings, date, time, slot_id, image_url, slots, booking_id, session_id } = payload;
    
    console.log(`🚀 Operation: ${operation} | Business: ${business_id}`);

    // Security Check: Only public operations are allowed without an Auth header
    const publicOps = ['create_booking', 'create_lead', 'get_session_by_code'];
    if (!publicOps.includes(operation)) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        console.error("❌ Missing Authorization Header");
        return new Response('Missing Authorization header (Internal)', { status: 401, headers: corsHeaders });
      }
      console.log("✅ Authorization Header Present");
    }

    // ─────────────────────────────────────────────────────────
    // CREATE LEAD — now persists customer_passcode
    // ─────────────────────────────────────────────────────────
    if (operation === 'create_lead') {
      const { customer_name, customer_email, phone, service_name, access_code, customer_passcode } = payload;
      
      const { data: lead, error: leadErr } = await supabase
        .from('bookings')
        .insert([{
          business_id: business_id,
          customer_name: customer_name,
          customer_email: customer_email ? customer_email.trim().toLowerCase() : null,
          phone: phone || '',
          service_name: service_name || "Lead Inquiry",
          summary: service_name || "Lead Inquiry",
          booking_time: new Date().toISOString(),
          session_id: session_id || null,
          status: 'pending',
          session_status: 'active',
          access_code: access_code || null,
          customer_passcode: customer_passcode || null
        }])
        .select()
        .single();

      if (leadErr) throw leadErr;
      return new Response(JSON.stringify(lead), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─────────────────────────────────────────────────────────
    // GET SESSION BY CODE — supports passcode OR access_code,
    // scoped to business_id + email, and returns session_status
    // ─────────────────────────────────────────────────────────
    if (operation === 'get_session_by_code') {
      const { access_code, customer_passcode, customer_email, business_id: req_biz_id } = payload;

      if (!customer_email || !req_biz_id) {
        return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (!access_code && !customer_passcode) {
        return new Response(JSON.stringify({ error: "Provide either an access code or passcode" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Build query — email + business are always required; auth is code OR passcode
      let query = supabase
        .from('bookings')
        .select('session_id, customer_name, service_name, summary, session_status, access_code')
        .eq('customer_email', customer_email.trim().toLowerCase())
        .eq('business_id', req_biz_id);

      if (access_code) {
        query = query.eq('access_code', access_code.trim());
      } else {
        query = query.eq('customer_passcode', customer_passcode.trim());
      }

      const { data: booking, error: err } = await query.maybeSingle();

      if (err) throw err;

      if (!booking) {
        return new Response(JSON.stringify({ error: "No matching session found" }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Return full booking info (incl. session_status so UI can react)
      return new Response(JSON.stringify(booking), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─────────────────────────────────────────────────────────
    // TERMINATE SESSION — business-only; marks session ended
    // and broadcasts a realtime event to the customer
    // ─────────────────────────────────────────────────────────
    if (operation === 'terminate_session') {
      if (!session_id || !business_id) {
        return new Response(JSON.stringify({ error: "Missing session_id or business_id" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Update session_status to 'terminated' — scoped to the owning business
      const { error: updateErr } = await supabase
        .from('bookings')
        .update({ session_status: 'terminated' })
        .eq('session_id', session_id)
        .eq('business_id', business_id);

      if (updateErr) throw updateErr;

      // Insert a special system message into chat_logs so the customer's
      // realtime listener picks it up and shows the termination overlay
      await supabase.from('chat_logs').insert({
        business_id: business_id,
        session_id: session_id,
        role: 'system',
        content: 'SESSION_TERMINATED'
      });

      console.log(`✅ Session ${session_id} terminated by business ${business_id}`);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─────────────────────────────────────────────────────────
    // Remaining existing operations (unchanged)
    // ─────────────────────────────────────────────────────────

    if (operation === 'add') {
      const { data, error } = await supabase
        .from('business_slots')
        .insert([{ business_id, slot_date: date, slot_time: time }]);
      if (error) throw error;
      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'delete') {
      const { error } = await supabase
        .from('business_slots')
        .delete()
        .eq('id', slot_id);
      if (error) throw error;
      return new Response('Deleted', { status: 200, headers: corsHeaders });
    }

    if (operation === 'create_booking') {
      const { customer_name, customer_email, service_name } = payload;

      const { data: slot, error: slotErr } = await supabase
        .from('business_slots')
        .select('*')
        .eq('id', slot_id)
        .single();
      
      if (slotErr || !slot || slot.is_booked) {
        throw new Error("This slot is already booked or doesn't exist.");
      }

      const { data: booking, error: bookErr } = await supabase
        .from('bookings')
        .insert([{
          business_id: business_id,
          customer_name: customer_name,
          customer_email: customer_email,
          service_name: service_name || "Premium Session",
          booking_time: `${slot.slot_date}T${slot.slot_time}`,
          session_id: session_id || null,
          status: 'confirmed'
        }])
        .select()
        .single();

      if (bookErr) throw bookErr;

      await supabase
        .from('business_slots')
        .update({ is_booked: true })
        .eq('id', slot_id);

      return new Response(JSON.stringify(booking), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'update_business') {
      console.log(`📝 Updating business ${business_id} with settings:`, JSON.stringify(settings));
      const { data, error } = await supabase
        .from('businesses')
        .update(settings)
        .eq('id', business_id)
        .select();

      if (error) {
        console.error(`❌ Update Error for ${business_id}:`, error);
        throw error;
      }
      console.log(`✅ Update Successful for ${business_id}. Rows affected:`, data?.length);
      return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'sync_image') {
      const { error } = await supabase
        .from('businesses')
        .update({ image_url: image_url })
        .eq('id', business_id);
      if (error) throw error;
      return new Response('Image Synced', { status: 200, headers: corsHeaders });
    }

    if (operation === 'provision_business') {
      if (!business_id) throw new Error("Missing business_id");
      
      const bizName = settings?.name || 'New Business';
      const bizEmail = settings?.email || null;
      const bizUsername = settings?.username || null;

      const { data: result, error } = await supabase
        .from('businesses')
        .upsert({
          id: business_id,
          name: bizName,
          email: bizEmail,
          username: bizUsername,
          role: 'business'
        }, { onConflict: 'id' })
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'save_availability') {
      const { error } = await supabase
        .from('business_availability')
        .upsert(slots.map((s: any) => ({
          business_id: business_id,
          day_of_week: s.day,
          start_time: s.start,
          end_time: s.end,
          is_enabled: s.enabled
        })), { onConflict: 'business_id, day_of_week' });

      if (error) throw error;
      return new Response('Availability Saved', { status: 200, headers: corsHeaders });
    }

    if (operation === 'delete_lead') {
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', booking_id);
      if (error) throw error;
      return new Response('Deleted', { status: 200, headers: corsHeaders });
    }

    if (operation === 'delete_session') {
      const { error } = await supabase
        .from('chat_logs')
        .delete()
        .eq('session_id', session_id);
      if (error) throw error;
      return new Response('Session Deleted', { status: 200, headers: corsHeaders });
    }

    return new Response('Invalid operation', { status: 400, headers: corsHeaders });

  } catch (err) {
    console.error("Function Error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ 
      error: "Edge Function Error", 
      details: errorMessage
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
