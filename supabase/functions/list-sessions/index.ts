import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Owl Assist - list-sessions Edge Function
 * Returns all chat sessions for a given business_id, with a last-message preview.
 * Used by the customer chat widget's "Conversations" history panel.
 * No auth token required — reads using the service role key (safe, no PII exposed beyond what the customer already has).
 */

const getCorsHeaders = (req: Request) => {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, cookie',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true',
  };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SRK!);

    const { business_id, customer_email } = await req.json();
    if (!business_id || !customer_email) {
      return new Response(JSON.stringify({ error: 'Missing business_id or customer_email' }), {
        status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    // 1. Fetch only session IDs belonging to this customer
    const { data: customerSessions, error: sessionErr } = await supabase
      .from('bookings')
      .select('session_id')
      .eq('business_id', business_id)
      .eq('customer_email', customer_email.trim().toLowerCase());

    if (sessionErr) {
      console.error('Error fetching customer sessions:', sessionErr);
      return new Response(JSON.stringify({ sessions: [] }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    const sessionIds = (customerSessions || []).map(s => s.session_id).filter(Boolean);
    if (sessionIds.length === 0) {
      return new Response(JSON.stringify({ sessions: [] }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    // 2. Fetch chat logs for these sessions
    const { data: logs, error } = await supabase
      .from('chat_logs')
      .select('session_id, role, content, created_at')
      .eq('business_id', business_id)
      .in('session_id', sessionIds)
      .not('role', 'eq', 'system') // exclude system messages like SESSION_TERMINATED
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching logs:', error);
      return new Response(JSON.stringify({ sessions: [] }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    // Deduplicate into unique sessions, capturing the first (most recent) message per session
    const sessionMap = new Map<string, { session_id: string; last_message: string; last_role: string; last_ts: string }>();
    for (const log of (logs || [])) {
      if (!sessionMap.has(log.session_id)) {
        sessionMap.set(log.session_id, {
          session_id: log.session_id,
          last_message: log.content,
          last_role: log.role,
          last_ts: log.created_at,
        });
      }
    }

    const sessions = Array.from(sessionMap.values());

    return new Response(JSON.stringify({ sessions }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('list-sessions error:', err);
    return new Response(JSON.stringify({ sessions: [] }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
