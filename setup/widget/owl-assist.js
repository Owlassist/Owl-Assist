/**
 * Owl Assist - Chat Widget Library
 * Usage: <script src=".../owl-assist.js" data-business="YOUR_BIZ_ID" data-name="Business Name"></script>
 */

(function() {
  const currentScript = document.currentScript;
  const businessId = currentScript.getAttribute('data-business');
  const businessName = currentScript.getAttribute('data-name') || "Business AI";
  const widgetUrl = currentScript.src.replace('owl-assist.js', '');

  // Generate or retrieve a persistent session_id for rate limiting
  let sessionId = localStorage.getItem('owl_chat_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID?.() || Math.random().toString(36).substring(2, 15);
    localStorage.setItem('owl_chat_session_id', sessionId);
  }

  // 1. Inject Styles
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = widgetUrl + 'widget.css';
  document.head.appendChild(styleLink);

  // Material Symbols for the widget
  const materialLink = document.createElement('link');
  materialLink.rel = 'stylesheet';
  materialLink.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";
  document.head.appendChild(materialLink);

  // 2. Build Widget Container
  const widgetContainer = document.createElement('div');
  widgetContainer.id = 'owl-chat-widget';
  widgetContainer.innerHTML = `
    <div class="owl-bubble" id="owl-bubble">
      <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1, 'wght' 700;">owl</span>
    </div>
    
    <div class="owl-window" id="owl-window">
      <header class="owl-header">
        <div class="owl-header-title">
          <div class="icon">
            <span class="material-symbols-outlined" style="font-size: 1.25rem; font-variation-settings: 'FILL' 1;">owl</span>
          </div>
          <div>
            <h4>${businessName}</h4>
            <span class="status">● Online</span>
          </div>
        </div>
        <span class="owl-close material-symbols-outlined" id="owl-close">close</span>
      </header>

      <div class="owl-messages" id="owl-messages">
      </div>

      <div class="owl-input-area">
        <input type="text" id="owl-chat-input" placeholder="Ask anything...">
        <button id="owl-send">
          <span class="material-symbols-outlined">send</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(widgetContainer);

  const bubble = document.getElementById('owl-bubble');
  const window = document.getElementById('owl-window');
  const close = document.getElementById('owl-close');
  const input = document.getElementById('owl-chat-input');
  const sendBtn = document.getElementById('owl-send');
  const messages = document.getElementById('owl-messages');

  // 3. UI logic
  bubble.onclick = () => window.classList.add('open');
  close.onclick = () => window.classList.remove('open');

  function addMessage(text, type = 'bot') {
    const msg = document.createElement('div');
    msg.className = `owl-msg ${type}`;
    
    // Clean up technical tags
    let displayText = text.replace(/\[\[CONFIRM_BOOKING:.*?\]\]/g, '').trim();
    msg.innerText = displayText;
    
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  async function loadGreeting() {
    const typingMsg = document.createElement('div');
    typingMsg.className = 'owl-msg bot typing-indicator';
    typingMsg.innerText = '...';
    messages.appendChild(typingMsg);

    try {
      const response = await fetch('https://fensjqscutikgccajwkh.supabase.co/functions/v1/chat-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, message: null, getGreeting: true, session_id: sessionId })
      });
      const data = await response.json();
      typingMsg.remove();
      addMessage(data.reply || `Hello! Good to have you here. I'm Noctra, the assistant for ${businessName}. How may i assist you today?`);
    } catch (err) {
      typingMsg.remove();
      addMessage(`Hello! Good to have you here. I'm Noctra, the assistant for ${businessName}. How may i assist you today?`);
    }
  }

  // Fetch greeting dynamically
  loadGreeting();

  let widgetChatHistory = [];

  async function handleSend() {
    const text = input.value.trim();
    if (!text) return;
    
    addMessage(text, 'user');
    input.value = '';

    const typingMsg = document.createElement('div');
    typingMsg.className = 'owl-msg bot typing-indicator';
    typingMsg.innerText = '...';
    messages.appendChild(typingMsg);
    messages.scrollTop = messages.scrollHeight;

    console.log("📤 Sending message to AI:", { businessId, sessionId, text });
    try {
      const response = await fetch('https://fensjqscutikgccajwkh.supabase.co/functions/v1/chat-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          business_id: businessId,
          message: text,
          history: widgetChatHistory,
          session_id: sessionId
        })
      });

      const data = await response.json();
      typingMsg.remove();

      if (data.reply) {
        let aiReply = data.reply;
        
        // 1. Check for the Booking Confirmation Trigger
        const confirmMatch = aiReply.match(/\[\[CONFIRM_BOOKING:(.*?)\]\]/);
        
        if (confirmMatch) {
          try {
            const bookingData = JSON.parse(confirmMatch[1]);
            
            // Show the AI's reply first
            addMessage(aiReply, 'bot');
            
            // Execute the actual booking securely
            const bookingRes = await fetch('https://fensjqscutikgccajwkh.supabase.co/functions/v1/manage-slots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    operation: 'create_booking',
                    business_id: businessId,
                    slot_id: bookingData.slot_id,
                    customer_name: bookingData.name,
                    customer_email: bookingData.email,
                    service_name: bookingData.service
                })
            });

            const bookingResult = await bookingRes.json();
            if (bookingResult.success) {
                addMessage("✅ Booking Confirmed! We'll send you an email shortly.", 'bot');
            } else {
                addMessage("I was able to process your request, but there was an error saving the booking. Please contact us directly.", 'bot');
            }
          } catch (e) {
            console.error("Widget booking error", e);
            addMessage(aiReply, 'bot');
          }
        } else {
          addMessage(aiReply, 'bot');
        }

        // Save to history
        widgetChatHistory.push({ role: 'user', content: text });
        widgetChatHistory.push({ role: 'bot', content: aiReply });
        if (widgetChatHistory.length > 8) widgetChatHistory.splice(0, 2);

      } else {
        addMessage("Sorry, I'm having trouble thinking right now.", 'bot');
      }
    } catch (err) {
      typingMsg.remove();
      console.error(err);
      addMessage("Connection error. Please try again later.", 'bot');
    }
  }

  sendBtn.onclick = handleSend;
  input.onkeypress = (e) => { if (e.key === 'Enter') handleSend(); };

  sendBtn.onclick = handleSend;
  input.onkeypress = (e) => { if (e.key === 'Enter') handleSend(); };

})();
