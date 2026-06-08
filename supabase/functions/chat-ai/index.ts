import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Owl Assist - Optimized AI Receptionist
 */

// Keys will be fetched inside the request handler

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
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const { business_id, message, history, getGreeting, getLogs, session_id } = await req.json();

    if (!business_id) throw new Error("Missing business_id");
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // --- FETCH BUSINESS DATA ---
    const { data: business } = await supabase.from('businesses').select('*').eq('id', business_id).single();
    if (!business) throw new Error("Business not found");

    // --- SESSION COOKIE PARSING ---
    let actual_session_id = session_id;
    const cookieHeader = req.headers.get('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`owl_session_${business_id}=([^;]+)`));
      if (match) {
        actual_session_id = match[1];
      }
    }
    const isNewSession = !actual_session_id;
    if (isNewSession) {
      actual_session_id = crypto.randomUUID();
    }
    
    let resHeaders = new Headers(getCorsHeaders(req));
    resHeaders.set('Content-Type', 'application/json');
    if (isNewSession) {
      resHeaders.set('Set-Cookie', `owl_session_${business_id}=${actual_session_id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`); // 30 days
    }

    // --- STATIC GREETING OR LOGS FETCH ---
    if (getLogs) {
        if (!actual_session_id) return new Response(JSON.stringify({ logs: [] }), { headers: resHeaders });
        const { data: logs } = await supabase.from('chat_logs').select('*').eq('session_id', actual_session_id).order('created_at', { ascending: true });
        return new Response(JSON.stringify({ logs: logs || [] }), { headers: resHeaders });
    }

    // --- BUSINESS CREDIT LIMIT ENFORCEMENT ---
    const now = new Date();
    let currentCredits = business.credits || 0;
    let resetAt = business.credits_reset_at ? new Date(business.credits_reset_at) : null;
    const isPro = business.subscription_tier === 'pro' && (!business.subscription_expires_at || new Date(business.subscription_expires_at) > now);

    // Auto-renew Free tier every 30 days — 20 conversations per month (matches pricing page)
    if (resetAt && now > resetAt && !isPro) {
        currentCredits = 20;
        resetAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        await supabase.from('businesses').update({ credits: currentCredits, credits_reset_at: resetAt.toISOString() }).eq('id', business_id);
    }

    // Check if business has run out of credits
    if (currentCredits <= 0) {
        if (getGreeting || message) {
             return new Response(JSON.stringify({ 
                 reply: "I'm sorry, but this business is unavailable at the moment. Please Try again later or contact them directly." 
             }), { headers: resHeaders });
        }
    }

    // Decrement credits only on the first actual message of a session
    if (message) {
        const { count } = await supabase.from('chat_logs').select('*', { count: 'exact', head: true }).eq('session_id', actual_session_id).eq('role', 'user');
        if (count === 0) {
            await supabase.from('businesses').update({ credits: currentCredits - 1 }).eq('id', business_id);
        }
    }

    if (getGreeting) {
      return new Response(JSON.stringify({ 
        reply: `Good to have you here. I'm the assistant for ${business.name}. How may i assist you today?` 
      }), { headers: resHeaders });
    }

    // --- IP RATE LIMITING ---
    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
    let hoursSince = 0;
    if (ipAddress !== 'unknown') {
       const { data: ipUsage } = await supabase.from('ip_rate_limits').select('*').eq('ip_address', ipAddress).maybeSingle();
       
       // Limit to 100 messages. In a real system, you'd reset this periodically via cron or logic.
       if (ipUsage && ipUsage.message_count > 100) {
          // Check if last active was more than 1 hour ago to reset it
          const lastActive = new Date(ipUsage.last_active);
          const now = new Date();
          hoursSince = Math.abs(now.getTime() - lastActive.getTime()) / 36e5;
          if (hoursSince < 1) {
             return new Response(JSON.stringify({ reply: "You are sending too many requests. Please try again later." }), { status: 429, headers: resHeaders });
          } else {
             // Reset if it's been an hour
             await supabase.from('ip_rate_limits').update({ message_count: 0, last_active: now.toISOString() }).eq('ip_address', ipAddress);
          }
       }
       await supabase.from('ip_rate_limits').upsert({ ip_address: ipAddress, message_count: (ipUsage && hoursSince < 1 ? ipUsage.message_count : 0) + 1, last_active: new Date().toISOString() });
    }

    if (!message) throw new Error("Missing message");

    // --- HUMAN HANDOFF CHECK ---
    const isHandoffActive = (history || []).some((h: any) => h.role === 'system' && h.content === 'HANDOFF_ACTIVE');
    if (isHandoffActive) {
        // AI is paused, let the human owner chat.
        return new Response(JSON.stringify({ reply: "" }), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
    }

    // --- LOG USER MESSAGE ---
    if (actual_session_id) {
       await supabase.from('chat_logs').insert({ business_id, session_id: actual_session_id, role: 'user', content: message });
    }

    // --- RATE LIMITING ---
    if (actual_session_id) {
       const { data: usage } = await supabase.from('ai_usage_limit').select('*').eq('session_id', actual_session_id).maybeSingle();
       if (usage && usage.message_count > 50) {
          return new Response(JSON.stringify({ reply: "You've reached the message limit for this session. Please try again later." }), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
       }
       await supabase.from('ai_usage_limit').upsert({ session_id: actual_session_id, message_count: (usage?.message_count || 0) + 1, last_active: new Date().toISOString() });
    }

    // --- CONTEXT-AWARE CACHE LOOKUP ---
    const historyString = (history || []).map((h: any) => `${h.role}:${h.content}`).join('|');
    const messageHash = await hashMessage(message + historyString);
    const { data: cached } = await supabase.from('ai_chat_cache').select('response').eq('business_id', business_id).eq('query_hash', messageHash).maybeSingle();
    
    if (cached) {
      if (actual_session_id) { await supabase.from('chat_logs').insert({ business_id, session_id: actual_session_id, role: 'bot', content: cached.response }); }
      return new Response(JSON.stringify({ reply: cached.response }), { headers: resHeaders });
    }

    // --- SCRAPE WEBSITE (IF PROVIDED) ---
    let websiteContext = "";
    if (business.website_url) {
      try {
        const res = await fetch(business.website_url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }});
        if (res.ok) {
           const html = await res.text();
           const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
           if (bodyMatch) {
             let text = bodyMatch[1]
               .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
               .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
               .replace(/<[^>]+>/g, ' ')
               .replace(/\s+/g, ' ')
               .trim();
             websiteContext = "\n\nWEBSITE CONTEXT (Use this to answer questions):\n" + text.substring(0, 3000);
           }
        }
      } catch(e) {
        console.warn("Failed to scrape website:", e);
      }
    }

    let bookingInstructions = "";
    if (business.booking_url) {
       bookingInstructions = `- BOOKING APPOINTMENTS: The business uses an external booking link. If the user asks to book an appointment, schedule a meeting, or see availability, DO NOT trigger the lead form. INSTEAD, reply politely and offer them this exact direct booking link: ${business.booking_url}.`;
    }

    const systemPrompt = `You are the professional AI Assistant for "${business.name}".

CORE IDENTITY & LIMITS:
- You are an ASSISTANT. You are NOT the owner, CEO, or ${business.name} himself/herself. 
- NEVER impersonate the human business owner. NEVER say "book a meeting with me". Always refer to "the team" or "the owner" if needed (e.g. "book a meeting with the team").
- NEVER reveal that you are an AI model or say "I am a large language model" or say you "cannot click links" or "don't have access to external links". You are simply a professional assistant. Provide links confidently.
- If asked "Who are you?", reply: "I'm the assistant for ${business.name}."

STRICT ANTI-HALLUCINATION RULES:
- ONLY answer questions using the provided BUSINESS DATA and WEBSITE CONTEXT below.
- If information is NOT explicitly provided in the data, DO NOT assume, imagine, or hallucinate facts.
- MANDATORY FALLBACK: If a user asks something you don't know (e.g. specific prices, complex policies, or dates not in the data), you MUST say: "I don't have verified information on that yet. Could you please leave your contact details so my team can get back to you personally?"
- NEVER provide random URLs or website links. ONLY refer people to the official website: ${business.website_url || 'provided by the team once you leave your details'}.

GOAL:
- Be helpful and polite, but stay within the verified bounds.
- Prioritize capturing leads if you cannot answer a specific question.

BUSINESS DATA:
${business.ai_instructions || 'Basic AI Assistant mode active.'}
${websiteContext}

CONVERSATION LOGS (Use for context only):
${(history || []).map((h: any) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n')}

INSTRUCTIONS FOR LEADS & BOOKING:
${business.booking_url ? bookingInstructions : `- FORM TRIGGER: When a user wants to book, get a quote, or leave details, YOU MUST trigger the form using [[SHOW_LEAD_FORM]].`}
- IMPORTANT: Only use the [[SHOW_LEAD_FORM]] trigger ONCE. Do not repeat it in every message.
- If you have already shown the form or if the user has already submitted the form (you'll see a [SYSTEM] message about it), DO NOT use the trigger again.
`;

    const truncatedHistory = (history || []).slice(-10).map((h: any) => ({ 
      role: h.role === 'user' ? 'user' : (h.role === 'bot' ? 'assistant' : h.role), 
      content: h.content 
    }));

    const handleSuccess = (reply: string) => {
       // Fire-and-forget DB writes
       supabase.from('ai_chat_cache').insert({ business_id, query_hash: messageHash, response: reply }).then(res => { if (res.error) console.error(res.error) });
       if (actual_session_id) {
         supabase.from('chat_logs').insert({ business_id, session_id: actual_session_id, role: 'bot', content: reply }).then(res => { if (res.error) console.error(res.error) });
       }
       return new Response(JSON.stringify({ reply }), { headers: resHeaders });
    };

    // Helper: call Gemini with a given model name
    const callGemini = async (model: string) => {
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [...truncatedHistory.map((h: any) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })), { role: 'user', parts: [{ text: message }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
        })
      });
      const data = await geminiRes.json();
      return { status: geminiRes.status, data };
    };

    // --- AI FALLBACK CHAIN ---
    // Order: OpenRouter (Free) -> Mistral -> Gemini -> Groq
    let openRouterDebug: any = null;
    let mistralDebug: any = null;
    let geminiDebug: any = null;
    let groqDebug: any = null;

    if (OPENROUTER_API_KEY) {
      try {
        const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://owlassist.app', // Required for OpenRouter
            'X-Title': 'Owl Assist'
          },
          body: JSON.stringify({
            model: "google/gemini-2.0-flash-exp:free", // Using valid free model
            messages: [{ role: "system", content: systemPrompt }, ...truncatedHistory, { role: "user", content: message }],
            max_tokens: 500,
            temperature: 0.1
          })
        });
        const orData = await orRes.json();
        openRouterDebug = { status: orRes.status };
        const orReply = orData.choices?.[0]?.message?.content;
        if (orReply) return handleSuccess(orReply);
        openRouterDebug.body = orData;
      } catch (e: any) { 
        openRouterDebug = { error: e.message || String(e) };
      }
    } else {
      openRouterDebug = "OPENROUTER_API_KEY is missing";
    }

    if (MISTRAL_API_KEY) {
      try {
        const mistralRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: "mistral-small-latest",
            messages: [{ role: "system", content: systemPrompt }, ...truncatedHistory, { role: "user", content: message }],
            max_tokens: 500,
            temperature: 0.1
          })
        });
        const mistralData = await mistralRes.json();
        mistralDebug = { status: mistralRes.status };
        const mistralReply = mistralData.choices?.[0]?.message?.content;
        if (mistralReply) return handleSuccess(mistralReply);
        mistralDebug.body = mistralData;
      } catch (e: any) { 
        mistralDebug = { error: e.message || String(e) };
      }
    } else {
      mistralDebug = "MISTRAL_API_KEY is missing";
    }

    if (GEMINI_API_KEY) {
      const geminiModels = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
      for (const model of geminiModels) {
        try {
          const { status, data } = await callGemini(model);
          geminiDebug = { model, status };
          if (status === 404 || status === 503) continue; 
          const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (reply) return handleSuccess(reply);
          geminiDebug.body = data; 
          break;
        } catch (e: any) {
          geminiDebug = { model, error: e.message || String(e) };
        }
      }
    } else {
      geminiDebug = "GEMINI_API_KEY is missing";
    }

    if (GROQ_API_KEY) {
      try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "system", content: systemPrompt }, ...truncatedHistory, { role: "user", content: message }],
            max_tokens: 500,
            temperature: 0.1
          })
        });
        const groqData = await groqRes.json();
        groqDebug = { status: groqRes.status };
        const groqReply = groqData.choices?.[0]?.message?.content;
        if (groqReply) return handleSuccess(groqReply);
        groqDebug.body = groqData;
      } catch (e: any) { 
        groqDebug = { error: e.message || String(e) };
      }
    } else {
      groqDebug = "GROQ_API_KEY is missing";
    }

    return new Response(JSON.stringify({ 
      reply: "I'm experiencing high traffic. Please leave your details and I'll get back to you!",
      debug: { openrouter: openRouterDebug, mistral: mistralDebug, gemini: geminiDebug, groq: groqDebug }
    }), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error("Function Error:", err);
    return new Response(JSON.stringify({ 
      error: "Edge Function Error", 
      details: err.message || "Internal error"
    }), { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
  }
});
