/**
 * Owl Assist - Supabase Cloud Storage Client
 * Handles all database interactions for Business Settings and Bookings.
 */

const SUPABASE_URL = 'https://fensjqscutikgccajwkh.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6ka5nIYTL4k4mBQ3DuSvWQ_n0BK-LjF';

// Initialize Supabase Client
// Note: We use the global 'supabase' object from the CDN script
let supabaseClient = null;

async function getSupabase() {
  if (supabaseClient) return supabaseClient;
  
  if (typeof window.supabase === 'undefined') {
    // If script hasn't loaded yet, wait a bit
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

/**
 * Fetch business details (Instructions, URL, etc.) from Supabase
 */
async function fetchBusinessData(identifier) {
  if (!identifier) return null;
  
  try {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const url = isLocal ? 'https://fensjqscutikgccajwkh.supabase.co/functions/v1/get-business' : '/api/get-business';

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier })
    });
    
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Error fetching business data:', err);
    return null;
  }
}

/**
 * Update business settings via Edge Function to bypass RLS restrictions for Clerk users
 */
async function updateBusinessSettings(businessId, settings) {
  const supabase = await getSupabase();

  // Build update object - only include fields that are actually defined
  const updateData = {};
  if (settings.name !== undefined)             updateData.name = settings.name;
  if (settings.username !== undefined)         updateData.username = settings.username;
  if (settings.ai_instructions !== undefined)  updateData.ai_instructions = settings.ai_instructions;
  if (settings.website_url !== undefined)       updateData.website_url = settings.website_url;
  if (settings.image_url !== undefined)         updateData.image_url = settings.image_url;
  if (settings.session_duration !== undefined)  updateData.session_duration = settings.session_duration;
  if (settings.booking_url !== undefined)      updateData.booking_url = settings.booking_url;
  if (settings.verified_badge_enabled !== undefined) updateData.verified_badge_enabled = settings.verified_badge_enabled;
  if (settings.remove_branding !== undefined)   updateData.remove_branding = settings.remove_branding;

  if (Object.keys(updateData).length === 0) return; // nothing to update

  const sessionToken = await window.owlAuth.getToken();
  console.log('🔑 Calling manage-slots with token present:', !!sessionToken);

  const { error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'update_business',
      business_id: businessId,
      settings: updateData
    },
    headers: { Authorization: `Bearer ${sessionToken}` }
  });

  if (error) {
    console.error('updateBusinessSettings error:', error);
    throw error;
  }
}

/**
 * Sync ONLY the image_url via Edge Function
 */
async function syncImageUrl(businessId, imageUrl) {
  const supabase = await getSupabase();
  const sessionToken = await window.owlAuth.getToken();

  const { error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'sync_image',
      business_id: businessId,
      image_url: imageUrl
    },
    headers: { Authorization: `Bearer ${sessionToken}` }
  });

  if (error) {
    console.error('syncImageUrl error:', error);
    throw error;
  }
}

/**
 * Provision a business record if it doesn't exist.
 * Useful as a fallback if the Clerk webhook fails.
 */
async function provisionBusiness(businessId, data) {
  const supabase = await getSupabase();
  const sessionToken = await window.owlAuth.getToken();
  
  console.log("🛠️ Provisioning business record for:", businessId);
  const { data: result, error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'provision_business',
      business_id: businessId,
      settings: {
        name: data.name || 'New Business',
        email: data.email,
        username: data.username
      }
    },
    headers: { Authorization: `Bearer ${sessionToken}` }
  });

  if (error) {
    console.error("❌ Provisioning error:", error);
    throw error;
  }
  return result;
}

/**
 * Fetch bookings for a specific business
 */
async function fetchBookings(businessId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('business_id', businessId)
    .order('booking_time', { ascending: false });

  if (error) {
    console.error('Error fetching bookings:', error);
    return [];
  }
  return data;
}

/**
 * Fetch weekly availability
 */
async function fetchAvailability(businessId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('business_availability')
    .select('*')
    .eq('business_id', businessId)
    .order('day_of_week', { ascending: true });

  if (error) {
    console.error('Error fetching availability:', error);
    return [];
  }
  return data;
}

/**
 * Save/Update weekly availability
 */
async function saveAvailability(businessId, slots) {
  const supabase = await getSupabase();
  const sessionToken = await window.owlAuth.getToken();
  
  const { error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'save_availability',
      business_id: businessId,
      slots: slots
    },
    headers: { Authorization: `Bearer ${sessionToken}` }
  });

  if (error) throw error;
}

/**
 * Slots Management
 */
async function fetchSlotsByDate(businessId, date) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('business_slots')
    .select('*')
    .eq('business_id', businessId)
    .eq('slot_date', date)
    .order('slot_time', { ascending: true });

  if (error) {
    console.error('Error fetching slots:', error);
    return [];
  }
  return data;
}

async function fetchAllFutureSlots(businessId) {
  const supabase = await getSupabase();
  const today = new Date().toISOString().split('T')[0];
  
  const { data, error } = await supabase
    .from('business_slots')
    .select('*')
    .eq('business_id', businessId)
    .gte('slot_date', today) // Only future or today
    .order('slot_date', { ascending: true })
    .order('slot_time', { ascending: true });

  if (error) {
    console.error('Error fetching all slots:', error);
    return [];
  }
  return data;
}

/**
 * Slots Management (via Edge Function to solve RLS/401)
 */
async function addSlot(businessId, date, time) {
  // 1. Safety Check: Is it in the past?
  const selectedDateTime = new Date(`${date}T${time}`);
  const now = new Date();
  if (selectedDateTime < now) {
    throw new Error("You cannot create a slot in the past!");
  }

  const supabase = await getSupabase();
  const sessionToken = await window.owlAuth.getToken();
  
  const { data, error } = await supabase.functions.invoke('manage-slots', {
    body: { 
      operation: 'add',
      business_id: businessId,
      date: date,
      time: time
    },
    headers: {
      Authorization: `Bearer ${sessionToken}`
    }
  });

  if (error) throw error;
  return data;
}

async function deleteSlot(slotId) {
  const supabase = await getSupabase();
  const sessionToken = await window.owlAuth.getToken();
  
  const { error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'delete',
      slot_id: slotId
    },
    headers: {
      Authorization: `Bearer ${sessionToken}`
    }
  });

  if (error) throw error;
}

/**
 * Public Lead Creation (Used by Customers on business.html)
 */
async function createLead(leadData) {
  const supabase = await getSupabase();
  console.log("📝 Creating lead via Edge Function:", leadData);
  
  const { data, error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'create_lead',
      business_id: leadData.business_id,
      customer_name: leadData.customer_name,
      customer_email: leadData.customer_email,
      phone: leadData.phone,
      service_name: leadData.service_name || 'Inquiry',
      session_id: leadData.session_id,
      access_code: leadData.access_code,
      customer_passcode: leadData.customer_passcode || null
    }
  });

  if (error) {
    console.error("❌ Edge Function Lead Error:", error);
    throw error;
  }
  return data;
}

/**
 * Retrieve session ID using email, access code, and business ID
 */
/**
 * Retrieve session by email + access_code OR email + passcode.
 * @param {string} email - Customer email
 * @param {string|null} accessCode - Backup access code (OWL-XXXXXX)
 * @param {string} businessId - Business ID for scoping
 * @param {string|null} passcode - Customer-set passcode (optional)
 */
async function fetchSessionByCode(email, accessCode, businessId, passcode = null) {
  const supabase = await getSupabase();
  console.log("🔑 Checking session credentials via Edge Function");
  
  const body = {
    operation: 'get_session_by_code',
    customer_email: email,
    business_id: businessId
  };

  // Support either passcode or access code (passcode takes priority if both supplied)
  if (passcode) {
    body.customer_passcode = passcode;
  } else {
    body.access_code = accessCode;
  }
  
  const { data, error } = await supabase.functions.invoke('manage-slots', { body });

  if (error) {
    console.error("❌ Edge Function Session Fetch Error:", error);
    throw error;
  }
  return data;
}

/**
 * Terminate a tracked session — business only.
 * Inserts a SESSION_TERMINATED system log so the customer's realtime
 * listener is notified instantly.
 */
async function terminateSession(sessionId, businessId) {
  const supabase = await getSupabase();
  const token = await window.owlAuth.getToken();

  const { data, error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'terminate_session',
      session_id: sessionId,
      business_id: businessId
    },
    headers: { Authorization: `Bearer ${token}` }
  });

  if (error) {
    console.error('❌ terminateSession error:', error);
    throw error;
  }
  return data;
}

/**
 * Public Booking Creation (Used by Customers on business.html)
 */
async function deleteLead(bookingId) {
  const supabase = await getSupabase();
  const token = await window.owlAuth.getToken();
  
  const { error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'delete_lead',
      booking_id: bookingId
    },
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (error) throw error;
}

async function updateLeadStatus(bookingId, status) {
  const supabase = await getSupabase();
  const token = await window.owlAuth.getToken();
  const session = await window.owlAuth.getSession();
  const businessId = session.user.id;
  
  const { error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'update_lead_status',
      booking_id: bookingId,
      status: status,
      business_id: businessId
    },
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (error) throw error;
}

async function createBooking(details) {
   const supabase = await getSupabase();
   const { data, error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'create_booking',
      ...details
    }
  });
  if (error) throw error;
  return data;
}

/**
 * Chat with Gemini Flash AI using our secure Edge Function
 */
async function chatWithAI(businessId, message, history = [], getGreeting = false, sessionId = null) {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const url = isLocal ? 'https://fensjqscutikgccajwkh.supabase.co/functions/v1/chat-ai' : '/api/chat-ai';

  // Use proxy for HttpOnly cookies instead of supabase.functions.invoke
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      business_id: businessId,
      message: message,
      history: history,
      getGreeting: getGreeting
    })
  });
  
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch from AI");
  return { data };
}

/**
 * Fetch unique chat sessions for a business
 */
async function fetchChatSessions(businessId) {
  const supabase = await getSupabase();
  
  // 1. Get unique session IDs from logs
  const { data: logs, error: logErr } = await supabase
    .from('chat_logs')
    .select('session_id, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  if (logErr) return [];

  // Deduplicate sessions manually
  const uniqueSessions = [];
  const seen = new Set();
  logs.forEach(item => {
    if (!seen.has(item.session_id)) {
      seen.add(item.session_id);
      uniqueSessions.push(item);
    }
  });

  // 2. Get lead names + session status for these sessions to help business identify them
  const { data: leads } = await supabase
    .from('bookings')
    .select('session_id, customer_name, summary, session_status')
    .eq('business_id', businessId);

  // Map lead data to sessions
  return uniqueSessions.map(sess => {
    const lead = (leads || []).find(l => l.session_id === sess.session_id);
    return {
      ...sess,
      customer_name: lead ? lead.customer_name : 'Visitor Session',
      summary: lead ? lead.summary : 'General Inquiry',
      session_status: lead ? lead.session_status : 'active'
    };
  });
}

async function fetchChatLogs(businessId) {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const url = isLocal ? 'https://fensjqscutikgccajwkh.supabase.co/functions/v1/chat-ai' : '/api/chat-ai';

  // Use proxy for HttpOnly cookies instead of supabase client directly
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ business_id: businessId, getLogs: true })
    });
    
    if (!res.ok) return [];
    const data = await res.json();
    return data.logs || [];
  } catch (err) {
    console.error('Error fetching chat logs:', err);
    return [];
  }
}

// Expose to window
/**
 * Delete a specific chat session and all its logs
 */
async function deleteChatSession(sessionId) {
  const supabase = await getSupabase();
  const sessionToken = await window.owlAuth.getToken();
  
  const { data, error } = await supabase.functions.invoke('manage-slots', {
    body: {
      operation: 'delete_session',
      session_id: sessionId
    },
    headers: {
      Authorization: `Bearer ${sessionToken}`
    }
  });

  if (error) throw error;
  return data;
}

window.owlDb = {
  getSupabase,
  fetchBusinessData,
  provisionBusiness,
  updateBusinessSettings,
  syncImageUrl,
  fetchBookings,
  fetchAvailability,
  saveAvailability,
  fetchSlotsByDate,
  fetchAllFutureSlots,
  addSlot,
  deleteSlot,
  createBooking,
  createLead,
  deleteLead,
  updateLeadStatus,
  chatWithAI,
  fetchChatSessions,
  fetchChatLogs,
  deleteChatSession,
  fetchSessionByCode,
  terminateSession
};


