import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Owl Assist - AI Receptionist Edge Function
 * Credits are now deducted per-message based on real token usage.
 * Rate: 1 credit = 1,000 tokens. Supports full decimal precision.
 */

const getCorsHeaders = (req: Request) => {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE, PUT',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cookie',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true',
  };
};

async function hashMessage(text: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(text.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function callLLM(
  systemPrompt: string, 
  history: { role: string, content: string }[], 
  userMessage: string, 
  keys: { GEMINI_API_KEY?: string, MISTRAL_API_KEY?: string, GROQ_API_KEY?: string, OPENROUTER_API_KEY?: string }
): Promise<{ reply: string, usage: any }> {
  const truncatedHistory = (history || []).slice(-10).map((h: any) => ({
    role: h.role === 'user' ? 'user' : (h.role === 'bot' || h.role === 'assistant' ? 'assistant' : 'user'),
    content: h.content,
  }));

  if (keys.OPENROUTER_API_KEY) {
    try {
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${keys.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://owlassist.app',
          'X-Title': 'Owl Assist',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-exp:free',
          messages: [{ role: 'system', content: systemPrompt }, ...truncatedHistory, { role: 'user', content: userMessage }],
          max_tokens: 500,
          temperature: 0.1,
        }),
      });
      const orData = await orRes.json();
      const orReply = orData.choices?.[0]?.message?.content;
      if (orReply) return { reply: orReply, usage: orData.usage };
    } catch (e: any) { console.error('OpenRouter error:', e.message); }
  }

  if (keys.MISTRAL_API_KEY) {
    try {
      const mRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${keys.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [{ role: 'system', content: systemPrompt }, ...truncatedHistory, { role: 'user', content: userMessage }],
          max_tokens: 500,
          temperature: 0.1,
        }),
      });
      const mData = await mRes.json();
      const mReply = mData.choices?.[0]?.message?.content;
      if (mReply) return { reply: mReply, usage: mData.usage };
    } catch (e: any) { console.error('Mistral error:', e.message); }
  }

  if (keys.GEMINI_API_KEY) {
    const geminiModels = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
    for (const model of geminiModels) {
      try {
        const gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [
                ...truncatedHistory.map((h: any) => ({
                  role: h.role === 'user' ? 'user' : 'model',
                  parts: [{ text: h.content }],
                })),
                { role: 'user', parts: [{ text: userMessage }] },
              ],
              generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
            }),
          }
        );
        if (gRes.status === 404 || gRes.status === 503) continue;
        const gData = await gRes.json();
        const gReply = gData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (gReply) return { reply: gReply, usage: gData.usageMetadata };
      } catch (e: any) { console.error(`Gemini (${model}) error:`, e.message); }
    }
  }

  if (keys.GROQ_API_KEY) {
    try {
      const grRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${keys.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'system', content: systemPrompt }, ...truncatedHistory, { role: 'user', content: userMessage }],
          max_tokens: 500,
          temperature: 0.1,
        }),
      });
      const grData = await grRes.json();
      const grReply = grData.choices?.[0]?.message?.content;
      if (grReply) return { reply: grReply, usage: grData.usage };
    } catch (e: any) { console.error('Groq error:', e.message); }
  }

  throw new Error("All AI providers failed.");
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
    const MISTRAL_API_KEY = Deno.env.get('MISTRAL_API_KEY');
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const { business_id, message, history, getGreeting, getLogs, session_id, operation } = await req.json();

    if (!business_id) throw new Error('Missing business_id');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SRK!);

    // ── FETCH BUSINESS ──────────────────────────────────────────────
    const { data: business } = await supabase
      .from('businesses').select('*').eq('id', business_id).single();
    if (!business) throw new Error('Business not found');

    // ── SESSION COOKIE HANDLING ──────────────────────────────────────
    let actual_session_id = session_id;
    if (!actual_session_id) {
      const cookieHeader = req.headers.get('cookie');
      if (cookieHeader) {
        const match = cookieHeader.match(new RegExp(`owl_session_${business_id}=([^;]+)`));
        if (match) actual_session_id = match[1];
      }
    }
    const isNewSession = !actual_session_id;
    if (isNewSession) actual_session_id = crypto.randomUUID();

    const resHeaders = new Headers(getCorsHeaders(req));
    resHeaders.set('Content-Type', 'application/json');
    if (isNewSession) {
      resHeaders.set(
        'Set-Cookie',
        `owl_session_${business_id}=${actual_session_id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`
      );
    }

    // ── FETCH COPILOT SESSIONS (service-role bypass for RLS) ─────────
    if (operation === 'get_copilot_sessions') {
      const { data: logs, error } = await supabase
        .from('chat_logs')
        .select('session_id, content, role, created_at')
        .eq('business_id', business_id)
        .like('session_id', `copilot_${business_id}%`)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Group into sessions
      const sessionsMap: Record<string, any> = {};
      for (const log of (logs || [])) {
        if (!sessionsMap[log.session_id]) {
          sessionsMap[log.session_id] = {
            session_id: log.session_id,
            title: 'New Chat',
            created_at: log.created_at,
            last_at: log.created_at,
          };
        }
        sessionsMap[log.session_id].last_at = log.created_at;
        if (log.role === 'user' && sessionsMap[log.session_id].title === 'New Chat') {
          sessionsMap[log.session_id].title = log.content.substring(0, 30) + (log.content.length > 30 ? '...' : '');
        }
      }

      const sessions = Object.values(sessionsMap).sort(
        (a: any, b: any) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime()
      );

      return new Response(JSON.stringify({ sessions }), {
        status: 200,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    // ── FETCH COPILOT CHAT LOGS (service-role bypass for RLS) ────────
    if (operation === 'get_copilot_chat') {
      if (!session_id) throw new Error('Missing session_id');

      const { data: logs, error } = await supabase
        .from('chat_logs')
        .select('role, content, created_at')
        .eq('business_id', business_id)
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return new Response(JSON.stringify({ logs: logs || [] }), {
        status: 200,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    // ── CONSOLIDATE LEARNINGS & PRUNE LOGS ───────────────────────────
    if (operation === 'consolidate_learnings') {
      const keys = { GEMINI_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY };
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Fetch unique customer session IDs from raw logs
      const { data: recentLogs } = await supabase
        .from('chat_logs')
        .select('session_id, created_at')
        .eq('business_id', business_id)
        .not('session_id', 'like', 'copilot_%')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      const uniqueSessions = [...new Set((recentLogs || []).map((l: any) => l.session_id))];
      const newInsights = [];

      for (const sId of uniqueSessions) {
        // Check if we already consolidated this session
        const { count } = await supabase
          .from('business_learnings')
          .select('*', { count: 'exact', head: true })
          .eq('source_session_id', sId);

        if (count && count > 0) continue; // Already consolidated

        // Fetch logs for this session
        const { data: sessionLogs } = await supabase
          .from('chat_logs')
          .select('role, content')
          .eq('session_id', sId)
          .order('created_at', { ascending: true });

        if (!sessionLogs || sessionLogs.length < 2) continue; // Skip sessions with too few messages

        const conversationText = sessionLogs.map((l: any) => `${l.role === 'user' ? 'Customer' : 'Assistant'}: ${l.content}`).join('\n');

        const extractionPrompt = `You are a Senior Operations Analyst. Analyze the following conversation between an AI Assistant and a Customer.
Extract any important business facts, newly answered FAQs, customer preferences, or corrections to existing knowledge that the AI should permanently memorize.
Only extract high-quality, verified, and permanent facts.
If there are no valuable new facts or learnings, return an empty list.

CONVERSATION:
${conversationText}

Output strictly as a JSON array of objects, with no other markdown or text:
[
  {"insight_type": "faq", "content": "Question: ... Answer: ..."},
  {"insight_type": "business_fact", "content": "..."}
]`;

        try {
          const { reply } = await callLLM(
            extractionPrompt,
            [],
            "Extract learnings",
            keys
          );

          const cleanJson = reply.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleanJson);

          if (Array.isArray(parsed) && parsed.length > 0) {
            for (const item of parsed) {
              const type = ['faq', 'preference', 'business_fact', 'correction'].includes(item.insight_type) ? item.insight_type : 'business_fact';
              const { data: inserted } = await supabase
                .from('business_learnings')
                .insert({
                  business_id,
                  insight_type: type,
                  content: item.content,
                  source_session_id: sId
                })
                .select()
                .single();
              if (inserted) {
                newInsights.push(inserted);
              }
            }
          }
        } catch (e) {
          console.error(`Failed to consolidate session ${sId}:`, e);
        }
      }

      // Delete customer logs older than 7 days
      const { error: pruneError } = await supabase
        .from('chat_logs')
        .delete()
        .eq('business_id', business_id)
        .not('session_id', 'like', 'copilot_%')
        .lt('created_at', sevenDaysAgo.toISOString());

      if (pruneError) console.error("Pruning logs failed:", pruneError);

      return new Response(JSON.stringify({ success: true, consolidated_count: newInsights.length, insights: newInsights }), {
        status: 200,
        headers: resHeaders
      });
    }

    // ── FETCH CHAT LOGS (dashboard viewer mode) ─────────────────────
    if (getLogs) {
      if (!actual_session_id) return new Response(JSON.stringify({ logs: [] }), { headers: resHeaders });
      const { data: logs } = await supabase
        .from('chat_logs').select('*')
        .eq('session_id', actual_session_id)
        .order('created_at', { ascending: true });
      return new Response(JSON.stringify({ logs: logs || [] }), { headers: resHeaders });
    }

    // ── CREDIT ENFORCEMENT ───────────────────────────────────────────
    const now = new Date();
    const isPro =
      business.subscription_tier === 'pro' &&
      (!business.subscription_expires_at || new Date(business.subscription_expires_at) > now);

    let currentCredits = parseFloat(String(business.credits ?? '0'));
    let purchasedCredits = parseFloat(String(business.purchased_credits ?? '0'));
    let resetAt = business.credits_reset_at ? new Date(business.credits_reset_at) : null;
    let purchasedExpiresAt = business.purchased_credits_expires_at ? new Date(business.purchased_credits_expires_at) : null;

    let dbUpdates: any = {};

    // Auto-renew Free tier every 30 days
    if (!isPro && resetAt && now > resetAt) {
      currentCredits = 20;
      resetAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      dbUpdates.credits = currentCredits;
      dbUpdates.credits_reset_at = resetAt.toISOString();
    }

    // Expire purchased credits if their 1-month window has passed
    if (purchasedCredits > 0 && purchasedExpiresAt && now > purchasedExpiresAt) {
      purchasedCredits = 0;
      dbUpdates.purchased_credits = 0;
    }

    if (Object.keys(dbUpdates).length > 0) {
      await supabase.from('businesses').update(dbUpdates).eq('id', business_id);
    }

    const totalAvailableCredits = currentCredits + purchasedCredits;

    // Block if no credits are left
    if (totalAvailableCredits <= 0 && (getGreeting || message)) {
      return new Response(
        JSON.stringify({ reply: "I'm sorry, but this business is unavailable at the moment. Please try again later or contact them directly." }),
        { headers: resHeaders }
      );
    }

    // ── GREETING (no AI call needed) ────────────────────────────────
    if (getGreeting) {
      const greetingReply = `Good to have you here. I'm the assistant for ${business.name}. How may I assist you today?`;
      if (actual_session_id) {
        await supabase.from('chat_logs').insert({
          business_id,
          session_id: actual_session_id,
          role: 'bot',
          content: greetingReply,
          is_read: true // Greetings are read by default
        });
      }
      return new Response(
        JSON.stringify({ reply: greetingReply, session_id: actual_session_id }),
        { headers: resHeaders }
      );
    }

    // ── IP RATE LIMITING ─────────────────────────────────────────────
    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
    if (ipAddress !== 'unknown') {
      const { data: ipUsage } = await supabase
        .from('ip_rate_limits').select('*').eq('ip_address', ipAddress).maybeSingle();
      if (ipUsage && ipUsage.message_count > 100) {
        const lastActive = new Date(ipUsage.last_active);
        const hoursSince = Math.abs(now.getTime() - lastActive.getTime()) / 36e5;
        if (hoursSince < 1) {
          return new Response(
            JSON.stringify({ reply: 'You are sending too many requests. Please try again later.' }),
            { status: 429, headers: resHeaders }
          );
        }
        await supabase
          .from('ip_rate_limits')
          .update({ message_count: 0, last_active: now.toISOString() })
          .eq('ip_address', ipAddress);
      }
      await supabase.from('ip_rate_limits').upsert({
        ip_address: ipAddress,
        message_count: (ipUsage?.message_count || 0) + 1,
        last_active: now.toISOString(),
      });
    }

    if (!message) throw new Error('Missing message');

    // ── HUMAN HANDOFF CHECK (authoritative DB lookup) ─────────────────
    // We NEVER trust the client-side history array for this — the handoff
    // state is written to chat_logs by the dashboard (role='system').
    // We read the most recent system entry for this session from the DB.
    if (actual_session_id) {
      const { data: systemLogs } = await supabase
        .from('chat_logs')
        .select('content')
        .eq('session_id', actual_session_id)
        .eq('role', 'system')
        .order('created_at', { ascending: false })
        .limit(1);

      const lastSystemMsg = systemLogs?.[0]?.content;
      const isHandoffActive = lastSystemMsg === 'HANDOFF_ACTIVE';

      if (isHandoffActive) {
        // Log the user's message so the owner can see it in the transcript, then stop
        await supabase.from('chat_logs').insert({
          business_id,
          session_id: actual_session_id,
          role: 'user',
          content: message,
        });
        return new Response(
          JSON.stringify({ reply: '', session_id: actual_session_id }),
          { headers: resHeaders }
        );
      }
    }

    // ── LOG USER MESSAGE ─────────────────────────────────────────────
    if (actual_session_id) {
      await supabase.from('chat_logs').insert({
        business_id,
        session_id: actual_session_id,
        role: 'user',
        content: message,
      });
    }

    // ── PER-SESSION MESSAGE RATE LIMITING ────────────────────────────
    if (actual_session_id) {
      const { data: usageRow } = await supabase
        .from('ai_usage_limit').select('*').eq('session_id', actual_session_id).maybeSingle();
      if (usageRow && usageRow.message_count > 50) {
        return new Response(
          JSON.stringify({ reply: "You've reached the message limit for this session. Please try again later." }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }
      await supabase.from('ai_usage_limit').upsert({
        session_id: actual_session_id,
        message_count: (usageRow?.message_count || 0) + 1,
        last_active: now.toISOString(),
      });
    }

    // ── TOKEN-BASED CREDIT DEDUCTION ─────────────────────────────────
    // Rate: 1 credit = 1,000 tokens (prompt + completion combined).
    // Decimals fully supported. Deducts from purchased credits first.
    const CREDITS_PER_1K_TOKENS = 1.0;

    // Define deductCredits HERE so the cache block below can call it safely
    function deductCredits(totalTokens: number) {
      const creditsToDeduct = parseFloat((totalTokens / 1000 * CREDITS_PER_1K_TOKENS).toFixed(4));
      let newPurchased = purchasedCredits;
      let newCredits = currentCredits;
      if (newPurchased >= creditsToDeduct) {
        newPurchased -= creditsToDeduct;
      } else {
        const remainder = creditsToDeduct - newPurchased;
        newPurchased = 0;
        newCredits = Math.max(0, newCredits - remainder);
      }
      newPurchased = parseFloat(newPurchased.toFixed(4));
      newCredits = parseFloat(newCredits.toFixed(4));
      supabase.from('businesses')
        .update({ credits: newCredits, purchased_credits: newPurchased })
        .eq('id', business_id)
        .then((res: any) => { if (res.error) console.error('Credit deduction error:', res.error); });
    }

    // ── COPILOT MODE: GENERATE SUGGESTIONS ────────────────────────────
    if (operation === 'generate_copilot_suggestions') {
      if (!session_id) throw new Error("Missing session_id");
      
      const { data: logs } = await supabase
        .from('chat_logs')
        .select('role, content')
        .eq('session_id', session_id)
        .order('created_at', { ascending: false })
        .limit(10);
      
      const sessionHistory = (logs || []).reverse().map((l: any) => ({
        role: l.role === 'bot' ? 'assistant' : (l.role === 'owner' ? 'assistant' : l.role),
        content: l.content
      }));

      const copilotSystemPrompt = `You are Noctra, an AI Copilot for the business owner of "${business.name}".
Read the chat history and draft EXACTLY 3 short, context-appropriate responses for the business owner to reply with.
Make the suggestions varied:
1. One friendly / acknowledging response.
2. One technical / detailed response addressing the issue/question directly based on FAQs or settings.
3. One action-oriented response (e.g. asking to schedule a booking or wrap up the chat).

Strict format: Output ONLY a JSON string array of 3 responses.
Example: ["Thanks for reaching out! What time works for you?", "Yes, we are open until 6 PM today.", "Would you like me to book that slot for you?"]
Do not add markdown formatting, backticks, or any surrounding text. Just the raw JSON.`;

      try {
        const { reply, usage } = await callLLM(
          copilotSystemPrompt,
          sessionHistory.slice(0, -1),
          sessionHistory[sessionHistory.length - 1]?.content || "",
          { GEMINI_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY }
        );

        const totalTokens = usage?.total_tokens || usage?.totalTokenCount || 500;
        deductCredits(totalTokens);

        let cleanReply = reply.trim();
        if (cleanReply.startsWith("```")) {
          cleanReply = cleanReply.replace(/^```json\s*/, '').replace(/```$/, '').trim();
        }

        return new Response(cleanReply, {
          status: 200,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        console.error("Suggestions error:", err);
        return new Response(JSON.stringify(["No suggestions available", "Please type manually", "Retry draft generation"]), {
          status: 200,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
        });
      }
    }

    // ── DASHBOARD OWNER CHAT ASSISTANT ────────────────────────────────
    if (operation === 'dashboard_chat') {
      if (!message) throw new Error("Missing message");

      const faqsList = Array.isArray(business.faqs) ? business.faqs : [];
      
      const { data: bookings } = await supabase
        .from('bookings')
        .select('customer_name, customer_email, service_name, booking_time, status')
        .eq('business_id', business_id)
        .order('booking_time', { ascending: false })
        .limit(5);

      const { data: customers } = await supabase
        .from('customers')
        .select('name, email, short_id')
        .eq('business_id', business_id)
        .limit(5);

      // Fetch learned memories & customer preferences
      const { data: learnedMemories } = await supabase
        .from('business_learnings')
        .select('insight_type, content')
        .eq('business_id', business_id)
        .order('created_at', { ascending: false });

      const learningsFormatted = (learnedMemories || []).map((l: any) => {
        return `- [${l.insight_type.toUpperCase()}]: ${l.content}`;
      }).join('\n');

      const dashboardSystemPrompt = `You are Noctra, the AI Operations Assistant for "${business.name}"'s dashboard.
You help the business owner manage operations, settings, and bookings.
You have access to their dashboard details:
- Website URL: ${business.website_url || 'Not set'}
- Booking URL: ${business.booking_url || 'Not set'}
- AI Instructions: ${business.ai_instructions || 'Not set'}
- FAQs: ${JSON.stringify(faqsList)}
- Learned Memories & Customer Preferences:
${learningsFormatted || 'No learned memories yet.'}
- Recent Bookings: ${JSON.stringify(bookings || [])}
- Recent Customers: ${JSON.stringify(customers || [])}

You can answer performance questions, summarize leads, write business strategies, or execute actions on their account.
To take actions, you MUST append a specific command tag to the VERY END of your response (only when the user explicitly requests to do it):
- Update settings: [[UPDATE_SETTINGS:{"website_url":"new_url"}]] or [[UPDATE_SETTINGS:{"booking_url":"new_url"}]] or [[UPDATE_SETTINGS:{"ai_instructions":"new_instructions"}]]
- Add FAQ: [[ADD_FAQ:{"question":"Q","answer":"A"}]]
- Cancel booking: [[CANCEL_BOOKING:booking_id]] (Note: get the booking_id from the bookings list if they specify a customer name, or ask for clarification if multiple match)

Be concise, helpful, and professional. Only output command tags when the user explicitly requests an action.`;

      // 1. Log the user's message to chat_logs using the service role client
      if (actual_session_id) {
        try {
          await supabase.from('chat_logs').insert({
            business_id: business_id,
            session_id: actual_session_id,
            role: 'user',
            content: message,
          });
        } catch (e) {
          console.error("Failed to log owner message to chat_logs:", e);
        }
      }

      try {
        const { reply, usage } = await callLLM(
          dashboardSystemPrompt,
          history || [],
          message,
          { GEMINI_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY }
        );

        const totalTokens = usage?.total_tokens || usage?.totalTokenCount || 500;
        deductCredits(totalTokens);

        // 2. Log the bot's response to chat_logs using the service role client
        if (actual_session_id) {
          try {
            await supabase.from('chat_logs').insert({
              business_id: business_id,
              session_id: actual_session_id,
              role: 'bot',
              content: reply,
            });
          } catch (e) {
            console.error("Failed to log bot response to chat_logs:", e);
          }
        }

        return new Response(JSON.stringify({ reply }), {
          status: 200,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        console.error("Dashboard assistant error:", err);
        return new Response(JSON.stringify({ reply: "I'm sorry, I'm having trouble connecting to my brain right now." }), {
          status: 500,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
        });
      }
    }

    // ── CONTEXT-AWARE CACHE LOOKUP ───────────────────────────────────
    const historyString = (history || []).map((h: any) => `${h.role}:${h.content}`).join('|');
    const messageHash = await hashMessage(message + historyString);
    const { data: cached } = await supabase
      .from('ai_chat_cache').select('response')
      .eq('business_id', business_id).eq('query_hash', messageHash).maybeSingle();

    if (cached) {
      // Cached replies save tokens but still cost a minimal amount (0.1 credits / 100 tokens)
      deductCredits(100);

      if (actual_session_id) {
        await supabase.from('chat_logs').insert({
          business_id, session_id: actual_session_id, role: 'bot', content: cached.response,
        });
      }
      return new Response(JSON.stringify({ reply: cached.response, session_id: actual_session_id }), { headers: resHeaders });
    }

    // ── WEBSITE SCRAPING (auto-context) ─────────────────────────────
    let websiteContext = '';
    if (business.website_url) {
      try {
        const siteRes = await fetch(business.website_url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OwlAssist/1.0)' },
        });
        if (siteRes.ok) {
          const html = await siteRes.text();
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          if (bodyMatch) {
            const text = bodyMatch[1]
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            websiteContext = '\n\nWEBSITE CONTEXT (Use this to answer questions):\n' + text.substring(0, 3000);
          }
        }
      } catch (e) {
        console.warn('Failed to scrape website:', e);
      }
    }

    // Fetch available slots from database
    const todayStr = new Date().toISOString().split('T')[0];
    const { data: availableSlots } = await supabase
      .from('business_slots')
      .select('id, slot_date, slot_time')
      .eq('business_id', business_id)
      .eq('is_booked', false)
      .gte('slot_date', todayStr)
      .order('slot_date', { ascending: true })
      .order('slot_time', { ascending: true })
      .limit(10);

    // Format slots for LLM prompt
    const slotsFormatted = (availableSlots || []).map((s: any) => {
      const d = new Date(`${s.slot_date}T${s.slot_time}`);
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return `Slot ID: ${s.id} at ${dateStr} - ${timeStr}`;
    }).join('\n');

    // Fetch learned memories & customer preferences
    const { data: learnedMemories } = await supabase
      .from('business_learnings')
      .select('insight_type, content')
      .eq('business_id', business_id)
      .order('created_at', { ascending: false });

    const learningsFormatted = (learnedMemories || []).map((l: any) => {
      return `- [${l.insight_type.toUpperCase()}]: ${l.content}`;
    }).join('\n');

    // ── SYSTEM PROMPT ────────────────────────────────────────────────
    const bookingInstructions = `- BOOKING APPOINTMENTS: You have access to a list of available native booking slots. If the customer wants to book a time, you can offer them choices from the list of available slots below.
    If the customer chooses one of the slots (or indicates a time that matches one), you must collect their Name, Email, and Intent (what the booking is for). Phone is optional.
    Once they provide these details, you MUST book the slot by appending this exact tag to the VERY END of your response:
    [[BOOK_SLOT:{"slot_id":"SLOT_ID_HERE", "customer_name":"NAME", "customer_email":"EMAIL", "phone":"PHONE", "intent":"INTENT"}]]
    Make sure to extract and use the correct Slot ID. Do not mention or explain the tag to the user.
    If they just want to see availability or book manually, you can also append the tag "[[SHOW_SLOTS]]" to the very end of your response to trigger the interactive slot picker.
    Do not recommend external booking links; always use the native slot booking.
    
    AVAILABLE BOOKING SLOTS:
    ${slotsFormatted || 'No available slots. Ask the user to leave their contact details so the team can reach out to schedule.'}`;

    const noDataWarning = (!business.ai_instructions && !websiteContext)
      ? `\nCRITICAL WARNING: You currently have ZERO information about the specific services, pricing, or details of this business because the owner hasn't added any training data yet. If the user asks what services you offer, you MUST NOT invent or guess any services. You MUST reply: "I'm still being set up and my team hasn't added my knowledge base yet. Could you please leave your contact details so my team can get back to you personally? [[SHOW_LEAD_FORM]]"`
      : ``;

    const systemPrompt = `You are the professional AI Assistant for "${business.name}".

CORE IDENTITY & LIMITS:
- You are an ASSISTANT, not the owner or ${business.name} themselves.
- NEVER impersonate the business owner. Refer to "the team" or "the owner" when needed.
- NEVER say "I am a large language model" or "I cannot click links". You are a professional assistant.
- If asked "Who are you?", reply: "I'm the assistant for ${business.name}."${noDataWarning}

STRICT ANTI-HALLUCINATION & FORM TRIGGER RULES:
- ONLY answer using the BUSINESS DATA and WEBSITE CONTEXT below.
- If you don't know something, or need to escalate, or want the user to leave their contact details so the team can reach out personally, you MUST ask them to leave their details and append the exact tag "[[SHOW_LEAD_FORM]]" to the very end of your response.
- Example: "I'm sorry, I don't have that information. Could you please leave your contact details so my team can reach out? [[SHOW_LEAD_FORM]]"
- NEVER invent URLs. Only refer to: ${business.website_url || 'the team once you leave your details'}.
- ON no occasion should you ever give information out of your head or hallucinate. If you don't have an answer for anything because the business didn't provide you with that information, tell the customer to leave their contact details so the team can reach out later, and trigger the form by appending "[[SHOW_LEAD_FORM]]" to the end of your response.

BUSINESS DATA:
${business.ai_instructions || 'Basic AI Assistant mode active.'}
${websiteContext}

LEARNED BUSINESS KNOWLEDGE & CUSTOMER PREFERENCES:
${learningsFormatted || 'No learned memories yet.'}

CONVERSATION HISTORY:
${(history || []).map((h: any) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n')}

LEAD & BOOKING INSTRUCTIONS:
${bookingInstructions}
- IMPORTANT: Whenever you invite the user to leave their name, email, phone, or details, you MUST append the exact tag "[[SHOW_LEAD_FORM]]" to the very end of your message.
- Only use [[SHOW_LEAD_FORM]] ONCE. Do not repeat if the form was already shown or submitted.`;

    const truncatedHistory = (history || []).slice(-10).map((h: any) => ({
      role: h.role === 'user' ? 'user' : (h.role === 'bot' ? 'assistant' : h.role),
      content: h.content,
    }));


    const handleSuccess = (reply: string, usageMeta: any): Response => {
      // Normalise token count across all providers:
      //   OpenRouter / Mistral / Groq → usage.total_tokens
      //   Gemini                      → usageMetadata.totalTokenCount
      //                                 or promptTokenCount + candidatesTokenCount
      const totalTokens =
        usageMeta?.total_tokens ||
        usageMeta?.totalTokenCount ||
        ((usageMeta?.promptTokenCount || 0) + (usageMeta?.candidatesTokenCount || 0)) ||
        ((usageMeta?.prompt_tokens || 0) + (usageMeta?.completion_tokens || 0)) ||
        500; // conservative fallback when provider returns nothing

      deductCredits(totalTokens);

      // Cache & log the bot reply (fire-and-forget)
      supabase.from('ai_chat_cache')
        .insert({ business_id, query_hash: messageHash, response: reply })
        .then((res: any) => { if (res.error) console.error(res.error); });
      if (actual_session_id) {
        supabase.from('chat_logs')
          .insert({ business_id, session_id: actual_session_id, role: 'bot', content: reply })
          .then((res: any) => { if (res.error) console.error(res.error); });
      }

      return new Response(JSON.stringify({ reply, session_id: actual_session_id }), { headers: resHeaders });
    };

    // ── AI FALLBACK CHAIN ────────────────────────────────────────────
    // Order: OpenRouter → Mistral → Gemini → Groq

    // 1. OpenRouter (free tier — Gemini 2.0 Flash)
    if (OPENROUTER_API_KEY) {
      try {
        const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://owlassist.app',
            'X-Title': 'Owl Assist',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.0-flash-exp:free',
            messages: [{ role: 'system', content: systemPrompt }, ...truncatedHistory, { role: 'user', content: message }],
            max_tokens: 500,
            temperature: 0.1,
          }),
        });
        const orData = await orRes.json();
        const orReply = orData.choices?.[0]?.message?.content;
        if (orReply) return handleSuccess(orReply, orData.usage);
      } catch (e: any) { console.error('OpenRouter error:', e.message); }
    }

    // 2. Mistral
    if (MISTRAL_API_KEY) {
      try {
        const mRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'mistral-small-latest',
            messages: [{ role: 'system', content: systemPrompt }, ...truncatedHistory, { role: 'user', content: message }],
            max_tokens: 500,
            temperature: 0.1,
          }),
        });
        const mData = await mRes.json();
        const mReply = mData.choices?.[0]?.message?.content;
        if (mReply) return handleSuccess(mReply, mData.usage);
      } catch (e: any) { console.error('Mistral error:', e.message); }
    }

    // 3. Gemini (direct API, multiple model fallbacks)
    if (GEMINI_API_KEY) {
      const geminiModels = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
      for (const model of geminiModels) {
        try {
          const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [
                  ...truncatedHistory.map((h: any) => ({
                    role: h.role === 'user' ? 'user' : 'model',
                    parts: [{ text: h.content }],
                  })),
                  { role: 'user', parts: [{ text: message }] },
                ],
                generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
              }),
            }
          );
          if (gRes.status === 404 || gRes.status === 503) continue;
          const gData = await gRes.json();
          const gReply = gData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (gReply) return handleSuccess(gReply, gData.usageMetadata);
        } catch (e: any) { console.error(`Gemini (${model}) error:`, e.message); }
      }
    }

    // 4. Groq (LLaMA fallback)
    if (GROQ_API_KEY) {
      try {
        const grRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'system', content: systemPrompt }, ...truncatedHistory, { role: 'user', content: message }],
            max_tokens: 500,
            temperature: 0.1,
          }),
        });
        const grData = await grRes.json();
        const grReply = grData.choices?.[0]?.message?.content;
        if (grReply) return handleSuccess(grReply, grData.usage);
      } catch (e: any) { console.error('Groq error:', e.message); }
    }

    // All providers failed
    return new Response(
      JSON.stringify({ reply: "I'm experiencing high traffic. Please leave your details and I'll get back to you!", session_id: actual_session_id }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('Function Error:', err);
    return new Response(
      JSON.stringify({ reply: 'ERROR: ' + err.stack }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
