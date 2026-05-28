import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Owl Assist - Optimized AI Receptionist
 */

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
const MISTRAL_API_KEY = Deno.env.get('MISTRAL_API_KEY');

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE, PUT',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

async function hashMessage(text: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(text.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { business_id, message, history, getGreeting, session_id } = await req.json();

    if (!business_id) throw new Error("Missing business_id");
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // --- FETCH BUSINESS DATA ---
    const { data: business } = await supabase.from('businesses').select('*').eq('id', business_id).single();
    if (!business) throw new Error("Business not found");

    // --- STATIC GREETING ---
    if (getGreeting) {
      return new Response(JSON.stringify({ 
        reply: `Good to have you here. I'm the assistant for ${business.name}. How may i assist you today?` 
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!message) throw new Error("Missing message");

    // --- HUMAN HANDOFF CHECK ---
    const isHandoffActive = (history || []).some((h: any) => h.role === 'system' && h.content === 'HANDOFF_ACTIVE');
    if (isHandoffActive) {
        // AI is paused, let the human owner chat.
        return new Response(JSON.stringify({ reply: "" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- LOG USER MESSAGE ---
    if (session_id) {
       await supabase.from('chat_logs').insert({ business_id, session_id, role: 'user', content: message });
    }

    // --- RATE LIMITING ---
    if (session_id) {
       const { data: usage } = await supabase.from('ai_usage_limit').select('*').eq('session_id', session_id).maybeSingle();
       if (usage && usage.message_count > 50) {
          return new Response(JSON.stringify({ reply: "You've reached the message limit for this session. Please try again later." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
       }
       await supabase.from('ai_usage_limit').upsert({ session_id, message_count: (usage?.message_count || 0) + 1, last_active: new Date().toISOString() });
    }

    // --- CACHE LOOKUP ---
    const messageHash = await hashMessage(message);
    const { data: cached } = await supabase.from('ai_chat_cache').select('response').eq('business_id', business_id).eq('query_hash', messageHash).maybeSingle();
    if (cached) {
      if (session_id) { await supabase.from('chat_logs').insert({ business_id, session_id, role: 'bot', content: cached.response }); }
      return new Response(JSON.stringify({ reply: cached.response }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    const handleSuccess = async (reply: string) => {
       await Promise.all([
         supabase.from('ai_chat_cache').insert({ business_id, query_hash: messageHash, response: reply }),
         session_id ? supabase.from('chat_logs').insert({ business_id, session_id, role: 'bot', content: reply }) : Promise.resolve()
       ]);
       return new Response(JSON.stringify({ reply }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    };

    // Fallback chain (Groq -> Gemini)
    if (GROQ_API_KEY) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "system", content: systemPrompt }, ...truncatedHistory, { role: "user", content: message }],
            max_tokens: 500,
            temperature: 0.1
          })
        });
        const data = await res.json();
        if (data.choices?.[0]?.message?.content) return await handleSuccess(data.choices[0].message.content);
      } catch (e) { console.error("Groq fallback failed"); }
    }

    if (GEMINI_API_KEY) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [...truncatedHistory.map((h: any) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })), { role: 'user', parts: [{ text: message }] }],
            generationConfig: { temperature: 0.1 }
          })
        });
        const data = await res.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) return await handleSuccess(reply);
      } catch (e) { console.error("Gemini fallback failed"); }
    }

    return new Response(JSON.stringify({ reply: "I'm experiencing high traffic. Please leave your details and I'll get back to you!" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error("Function Error:", err);
    return new Response(JSON.stringify({ 
      error: "Edge Function Error", 
      details: err.message || "Internal error"
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
