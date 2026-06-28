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
    let { operation, business_id, settings, date, time, slot_id, image_url, slots, booking_id, session_id } = payload;

    // --- SESSION COOKIE PARSING (only as fallback when session_id not in payload) ---
    const cookieHeader = req.headers.get('cookie');
    if (cookieHeader && business_id && !session_id) {
      const match = cookieHeader.match(new RegExp(`owl_session_${business_id}=([^;]+)`));
      if (match) {
        session_id = match[1];
      }
    }

    console.log(`🚀 Operation: ${operation} | Business: ${business_id}`);

    // Security Check: Only public operations are allowed without an Auth header
    const publicOps = ['create_booking', 'create_lead', 'get_session_by_code', 'check_customer', 'get_customer_sessions'];
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
      const { customer_name, customer_email, phone, service_name, access_code, customer_passcode, session_id, status } = payload;

      // Register customer in customers table so they can retrieve their history later
      if (customer_email && customer_name) {
        const emailLower = customer_email.trim().toLowerCase();
        const { error: custErr } = await supabase
          .from('customers')
          .upsert({
            business_id: business_id,
            email: emailLower,
            name: customer_name.trim()
          }, { onConflict: 'business_id,email' });

        if (custErr) {
          console.error("❌ Error upserting customer:", custErr);
        }
      }

      const targetStatus = status || 'pending';

      // Check if a booking/session already exists for this session_id AND status type
      // This prevents a 'pending' lead from overwriting the identity of the 'chat' session
      let existingBooking = null;
      if (session_id) {
        const { data } = await supabase
          .from('bookings')
          .select('*')
          .eq('session_id', session_id)
          .eq('status', targetStatus)
          .maybeSingle();
        existingBooking = data;
      }

      let result;
      if (existingBooking) {
        // Update existing booking
        const { data: updated, error: updateErr } = await supabase
          .from('bookings')
          .update({
            customer_name: customer_name || existingBooking.customer_name,
            customer_email: customer_email ? customer_email.trim().toLowerCase() : existingBooking.customer_email,
            phone: phone !== undefined ? phone : existingBooking.phone,
            service_name: service_name || existingBooking.service_name,
            summary: service_name || existingBooking.summary,
            status: targetStatus,
            customer_passcode: customer_passcode || existingBooking.customer_passcode
          })
          .eq('id', existingBooking.id)
          .select()
          .single();
        
        if (updateErr) throw updateErr;
        result = updated;
      } else {
        // Insert new booking/session
        const { data: inserted, error: insertErr } = await supabase
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
            status: targetStatus,
            session_status: 'active',
            access_code: access_code || null,
            customer_passcode: customer_passcode || null
          }])
          .select()
          .single();
        
        if (insertErr) throw insertErr;
        result = inserted;
      }

      // ─────────────────────────────────────────────────────────
      // Mark Lead Form as Submitted in Chat Logs (for UI state)
      // ─────────────────────────────────────────────────────────
      if (session_id && targetStatus !== 'chat') {
        const { error: logErr } = await supabase
          .from('chat_logs')
          .insert([{
            session_id: session_id,
            business_id: business_id,
            role: 'system',
            content: `[SYSTEM: User submitted lead form. Name: ${customer_name}]`
          }]);
        if (logErr) console.error("❌ Error inserting lead chat log:", logErr);
      }

      return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─────────────────────────────────────────────────────────
    // CHECK CUSTOMER — checks if customer email exists for business
    // ─────────────────────────────────────────────────────────
    if (operation === 'check_customer') {
      const { customer_email } = payload;
      if (!customer_email || !business_id) {
        return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: customer, error: custErr } = await supabase
        .from('customers')
        .select('name')
        .eq('business_id', business_id)
        .eq('email', customer_email.trim().toLowerCase())
        .maybeSingle();

      if (custErr) throw custErr;

      return new Response(JSON.stringify({
        registered: !!customer,
        name: customer ? customer.name : null
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─────────────────────────────────────────────────────────
    // GET CUSTOMER SESSIONS — get list of sessions for customer
    // ─────────────────────────────────────────────────────────
    if (operation === 'get_customer_sessions') {
      const { customer_email } = payload;
      if (!customer_email || !business_id) {
        return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: sessions, error: sessErr } = await supabase
        .from('bookings')
        .select('session_id, created_at, status, summary, session_status, customer_name')
        .eq('business_id', business_id)
        .eq('customer_email', customer_email.trim().toLowerCase())
        .order('created_at', { ascending: false });

      if (sessErr) throw sessErr;

      return new Response(JSON.stringify({ sessions: sessions || [] }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

      // Try to INSERT — if the row already exists, ignore the conflict.
      // This guarantees new users get correct defaults but existing users
      // NEVER have their credits / subscription data overwritten.
      const { error: insertErr } = await supabase
        .from('businesses')
        .insert({
          id: business_id,
          name: bizName,
          email: bizEmail,
          username: bizUsername,
          role: 'business',
          credits: 20,
          plan_credit_limit: 500,
          credits_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });

      // Code 23505 = duplicate key — row already exists, that's fine.
      // Any other error (e.g. missing column before migration) must be thrown.
      if (insertErr && insertErr.code !== '23505') {
        throw insertErr;
      }

      // Always return the full, current row (including credits/subscription fields)
      const { data: result, error: fetchErr } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', business_id)
        .single();

      if (fetchErr) throw fetchErr;
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

    if (operation === 'update_lead_status') {
      const { booking_id, status } = payload;
      const { error } = await supabase
        .from('bookings')
        .update({ status: status })
        .eq('id', booking_id)
        .eq('business_id', business_id);
      if (error) throw error;
      return new Response('Status Updated', { status: 200, headers: corsHeaders });
    }

    if (operation === 'delete_session') {
      const { error } = await supabase
        .from('chat_logs')
        .delete()
        .eq('session_id', session_id);
      if (error) throw error;
      return new Response('Session Deleted', { status: 200, headers: corsHeaders });
    }

    if (operation === 'send_owner_message') {
      const { session_id, message, owner_name } = payload;
      const { error } = await supabase
        .from('chat_logs')
        .insert([{
          business_id: business_id,
          session_id: session_id,
          role: 'owner',
          content: message
          // we could store owner_name in a metadata column if we had one, 
          // but for now, we'll format the content or the client will handle it.
        }]);
      if (error) throw error;
      return new Response('Owner message sent', { status: 200, headers: corsHeaders });
    }

    if (operation === 'toggle_handoff') {
      const { session_id, is_active } = payload;
      const { error } = await supabase
        .from('chat_logs')
        .insert([{
          business_id: business_id,
          session_id: session_id,
          role: 'system',
          content: is_active ? 'HANDOFF_ACTIVE' : 'HANDOFF_INACTIVE'
        }]);
      if (error) throw error;
      return new Response('Handoff toggled', { status: 200, headers: corsHeaders });
    }

    if (operation === 'mark_session_as_read') {
      const { session_id } = payload;
      const { error } = await supabase
        .from('chat_logs')
        .update({ is_read: true })
        .eq('session_id', session_id)
        .eq('business_id', business_id)
        .eq('role', 'user');
      if (error) throw error;
      return new Response('Session marked as read', { status: 200, headers: corsHeaders });
    }

    // ─────────────────────────────────────────────────────────
    // SAVE THEME COLORS
    // ─────────────────────────────────────────────────────────
    if (operation === 'save_theme') {
      const { theme_primary, theme_bg, theme_chat_bubble } = payload;
      const updateObj: Record<string, string> = {};
      if (theme_primary !== undefined) updateObj.theme_primary = theme_primary;
      if (theme_bg !== undefined) updateObj.theme_bg = theme_bg;
      if (theme_chat_bubble !== undefined) updateObj.theme_chat_bubble = theme_chat_bubble;

      const { error } = await supabase
        .from('businesses')
        .update(updateObj)
        .eq('id', business_id);
      if (error) throw error;
      return new Response('Theme Saved', { status: 200, headers: corsHeaders });
    }

    // ─────────────────────────────────────────────────────────
    // SAVE FAQs
    // ─────────────────────────────────────────────────────────
    if (operation === 'save_faqs') {
      const { faqs } = payload;
      const { error } = await supabase
        .from('businesses')
        .update({ faqs: faqs })
        .eq('id', business_id);
      if (error) throw error;
      return new Response('FAQs Saved', { status: 200, headers: corsHeaders });
    }

    return new Response('Invalid operation', { status: 400, headers: corsHeaders });

  } catch (err) {
    console.error("Function Error:", err);
    let errorMessage = "";
    if (err && typeof err === 'object') {
      errorMessage = (err as any).message || JSON.stringify(err);
    } else {
      errorMessage = String(err);
    }
    return new Response(JSON.stringify({
      error: "Edge Function Error",
      details: errorMessage
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
