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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
    const MISTRAL_API_KEY = Deno.env.get('MISTRAL_API_KEY');
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const { business_id, message, history, getGreeting, getLogs, session_id } = await req.json();

    if (!business_id) throw new Error('Missing business_id');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SRK!);

    // ── FETCH BUSINESS ──────────────────────────────────────────────
    const { data: business } = await supabase
      .from('businesses').select('*').eq('id', business_id).single();
    if (!business) throw new Error('Business not found');

    // ── SESSION COOKIE HANDLING ──────────────────────────────────────
    let actual_session_id = session_id;
    const cookieHeader = req.headers.get('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`owl_session_${business_id}=([^;]+)`));
      if (match) actual_session_id = match[1];
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
      return new Response(
        JSON.stringify({ reply: `Good to have you here. I'm the assistant for ${business.name}. How may I assist you today?` }),
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

    // ── SYSTEM PROMPT ────────────────────────────────────────────────
    const bookingInstructions = business.booking_url
      ? `- BOOKING APPOINTMENTS: If the user asks to book or see availability, DO NOT trigger the lead form. Offer this booking link: ${business.booking_url}.`
      : `- FORM TRIGGER: When a user wants to book, get a quote, or leave details, trigger the form using [[SHOW_LEAD_FORM]].`;

    const noDataWarning = (!business.ai_instructions && !websiteContext)
      ? `\nCRITICAL WARNING: You currently have ZERO information about the specific services, pricing, or details of this business because the owner hasn't added any training data yet. If the user asks what services you offer, you MUST NOT invent or guess any services. You MUST reply: "I'm still being set up and my team hasn't added my knowledge base yet. Could you please leave your contact details so my team can get back to you personally?"`
      : ``;

    const systemPrompt = `You are the professional AI Assistant for "${business.name}".

CORE IDENTITY & LIMITS:
- You are an ASSISTANT, not the owner or ${business.name} themselves.
- NEVER impersonate the business owner. Refer to "the team" or "the owner" when needed.
- NEVER say "I am a large language model" or "I cannot click links". You are a professional assistant.
- If asked "Who are you?", reply: "I'm the assistant for ${business.name}."${noDataWarning}

STRICT ANTI-HALLUCINATION RULES:
- ONLY answer using the BUSINESS DATA and WEBSITE CONTEXT below.
- If you don't know something, say: "I don't have verified information on that yet. Could you please leave your contact details so my team can get back to you personally?"
- NEVER invent URLs. Only refer to: ${business.website_url || 'the team once you leave your details'}.
- ON no occasion should you ever give informations out of your head or hallucinate, if you don't have an answer for anything because the business didn't provide you with that information, toggle the contact form and tell the person/customer to submit thier contact so the team can reach out later or tell em to hold on while you handover the chat to the team.

BUSINESS DATA:
${business.ai_instructions || 'Basic AI Assistant mode active.'}
${websiteContext}

CONVERSATION HISTORY:
${(history || []).map((h: any) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n')}

LEAD & BOOKING INSTRUCTIONS:
${bookingInstructions}
- Only use [[SHOW_LEAD_FORM]] ONCE. Do not repeat if form was already shown or submitted.`;

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
