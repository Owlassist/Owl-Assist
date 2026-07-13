/**
 * Owl Assist - Chat Widget Library
 * Usage: <script src=".../owl-assist.js" data-business="YOUR_BIZ_ID" data-name="Business Name"></script>
 */

(function() {
  const currentScript = document.currentScript;
  const businessId = currentScript.getAttribute('data-business');
  const businessName = currentScript.getAttribute('data-name') || "Business AI";
  const widgetUrl = currentScript.src.replace('owl-assist.js', '');

  // Session is now handled securely via HTTP-Only cookies from the backend.

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

  // Load marked.js dynamically
  if (!window.marked) {
    const markedScript = document.createElement('script');
    markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
    markedScript.onload = () => {
      if (window.marked) {
        const renderer = new marked.Renderer();
        renderer.link = function(href, title, text) {
          let linkHref = href;
          let linkTitle = title;
          let linkText = text;
          
          if (typeof href === 'object' && href !== null) {
            linkHref = href.href || '';
            linkTitle = href.title || '';
            linkText = href.text || '';
          }
          
          let cleanHref = linkHref;
          if (cleanHref && !cleanHref.startsWith('http://') && !cleanHref.startsWith('https://') && !cleanHref.startsWith('mailto:') && !cleanHref.startsWith('tel:')) {
            cleanHref = 'https://' + cleanHref;
          }
          
          const titleAttr = linkTitle ? ` title="${linkTitle}"` : '';
          return `<a href="${cleanHref}" target="_blank" rel="noopener noreferrer"${titleAttr}>${linkText}</a>`;
        };
        
        if (typeof marked.use === 'function') {
          marked.use({ renderer, gfm: true, breaks: true });
        } else {
          marked.setOptions({ renderer: renderer, gfm: true, breaks: true });
        }
      }
    };
    document.head.appendChild(markedScript);
  }

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

  function formatMessage(text) {
    if (!text) return '';
    
    if (window.marked && typeof window.marked.parse === 'function') {
      try {
        return window.marked.parse(text);
      } catch (e) {
        console.error("Marked parsing error:", e);
      }
    }

    const lines = text.split('\n');
    let formattedLines = [];
    
    lines.forEach(line => {
        let trimmed = line.trim();
        let processedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        processedLine = processedLine.replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
        
        if (numMatch) {
            const num = numMatch[1];
            const content = numMatch[2].replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
            formattedLines.push(`<div style="margin-left: 0.5rem; margin-bottom: 0.35rem; display: flex; align-items: flex-start; gap: 0.4rem;"><span style="color: #8b5cf6; font-weight: 700; flex-shrink: 0;">${num}.</span><div style="flex: 1;">${content}</div></div>`);
        } else if (bulletMatch) {
            const content = bulletMatch[1].replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
            formattedLines.push(`<div style="margin-left: 0.5rem; margin-bottom: 0.3rem; display: flex; align-items: flex-start; gap: 0.4rem;"><span style="color: #8b5cf6; font-size: 1.1rem; line-height: 1; flex-shrink: 0;">•</span><div style="flex: 1; color: #a1a1aa;">${content}</div></div>`);
        } else {
            formattedLines.push(processedLine);
        }
    });
    
    let html = formattedLines.join('<br>');
    html = html.replace(/<\/div><br><div/g, '</div><div');
    html = html.replace(/<br><div/g, '<div');
    html = html.replace(/<\/div><br>/g, '</div>');

    const linkStyle = 'color: #8b5cf6; text-decoration: underline; font-weight: 600; cursor: pointer;';
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    html = html.replace(urlRegex, (url) => {
        let cleanUrl = url;
        let trailing = '';
        while (cleanUrl.length > 0 && ['.', ',', ')', '!', '?', ';', ']'].includes(cleanUrl[cleanUrl.length - 1])) {
            trailing = cleanUrl[cleanUrl.length - 1] + trailing;
            cleanUrl = cleanUrl.slice(0, -1);
        }
        const href = cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`;
        return `<a href="${href}" target="_blank" style="${linkStyle}">${cleanUrl}</a>${trailing}`;
    });

    return html;
  }

  function addMessage(text, type = 'bot') {
    const msg = document.createElement('div');
    msg.className = `owl-msg ${type}`;
    
    // Clean up technical tags
    let displayText = text
        .replace(/\[\[CONFIRM_BOOKING:.*?\]\]/g, '')
        .replace(/\[\[BOOK_SLOT:.*?\]\]/g, '')
        .replace('[[SHOW_SLOTS]]', '')
        .trim();
    msg.innerHTML = formatMessage(displayText);
    
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  async function loadGreeting() {
    const typingMsg = document.createElement('div');
    typingMsg.className = 'owl-msg bot typing-indicator';
    typingMsg.innerText = '...';
    messages.appendChild(typingMsg);

    try {
      const response = await fetch('/api/chat-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ business_id: businessId, message: null, getGreeting: true })
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

    console.log("📤 Sending message to AI:", { businessId, text });
    try {
      const response = await fetch('/api/chat-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          business_id: businessId,
          message: text,
          history: widgetChatHistory
        })
      });

      const data = await response.json();
      typingMsg.remove();

      if (data.reply) {
        let aiReply = data.reply;
        
        // 1. Check for conversational native booking
        const bookMatch = aiReply.match(/\[\[BOOK_SLOT:(.*?)\]\]/);
        
        if (bookMatch) {
          try {
            const bookingData = JSON.parse(bookMatch[1]);
            addMessage(aiReply, 'bot');
            
            const slotWrap = document.createElement('div');
            slotWrap.className = 'owl-slots-container';
            slotWrap.innerHTML = '<div class="owl-slots-loading">Booking slot...</div>';
            messages.appendChild(slotWrap);
            messages.scrollTop = messages.scrollHeight;

            const bookingRes = await fetch('/api/manage-slots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    operation: 'create_booking',
                    business_id: businessId,
                    slot_id: bookingData.slot_id,
                    customer_name: bookingData.customer_name,
                    customer_email: bookingData.customer_email,
                    phone: bookingData.phone || '',
                    service_name: bookingData.intent || 'Conversational Appointment'
                })
            });

            const bookingResult = await bookingRes.json();
            if (bookingResult && bookingResult.id) {
              slotWrap.innerHTML = `
                <div style="background: rgba(46, 213, 115, 0.1); border: 1px solid rgba(46, 213, 115, 0.25); padding: 0.8rem; border-radius: 0.5rem; color: #2ed573; font-size: 0.85rem;">
                  <strong>🎉 Booking Confirmed!</strong>
                  <div style="font-size: 0.75rem; margin-top: 0.2rem;">Your slot is reserved. A confirmation email has been sent to ${bookingData.customer_email}.</div>
                </div>
              `;
            } else if (bookingResult && bookingResult.error) {
              slotWrap.innerHTML = `<div style="color: #ff9966; text-align: center; font-size: 0.85rem;">Booking failed: ${bookingResult.details || bookingResult.error}</div>`;
            } else {
              slotWrap.innerHTML = '<div style="color: #ff9966; text-align: center; font-size: 0.85rem;">Booking failed. Please try again.</div>';
            }
          } catch (e) {
            console.error("Widget booking error", e);
            addMessage(aiReply, 'bot');
          }
          messages.scrollTop = messages.scrollHeight;
        } else if (aiReply.includes('[[SHOW_SLOTS]]')) {
          addMessage(aiReply, 'bot');
          renderBookingSlots(messages);
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

  async function renderBookingSlots(container, existingWrap = null) {
    const slotsWrap = existingWrap || document.createElement('div');
    if (!existingWrap) {
      slotsWrap.className = 'owl-slots-container';
      container.appendChild(slotsWrap);
    }
    slotsWrap.innerHTML = '<div class="owl-slots-loading">Loading available times...</div>';
    container.scrollTop = container.scrollHeight;

    try {
      const res = await fetch('/api/manage-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          operation: 'get_available_slots',
          business_id: businessId
        })
      });
      const slotsList = await res.json();
      
      if (!slotsList || slotsList.length === 0) {
        slotsWrap.innerHTML = '<div class="owl-slots-empty">No available time slots found. Please leave your details to get in touch!</div>';
        return;
      }

      slotsWrap.innerHTML = `
        <div class="owl-slots-title">Select a time:</div>
        <div class="owl-slots-grid"></div>
      `;
      const grid = slotsWrap.querySelector('.owl-slots-grid');
      
      slotsList.forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'owl-slot-btn';
        const dateObj = new Date(s.slot_date + 'T' + s.slot_time);
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
        
        btn.innerHTML = `<strong>${timeStr}</strong><span>${dateStr}</span>`;
        btn.onclick = () => selectSlot(s, slotsWrap, container);
        grid.appendChild(btn);
      });

    } catch (err) {
      console.error(err);
      slotsWrap.innerHTML = '<div class="owl-slots-empty">Failed to load booking times.</div>';
    }
  }

  async function selectSlot(slot, wrap, container) {
    let name = sessionStorage.getItem('owl_customer_name') || '';
    let email = sessionStorage.getItem('owl_customer_email') || '';

    const dateObj = new Date(slot.slot_date + 'T' + slot.slot_time);
    const dateFormatted = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' @ ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    wrap.innerHTML = `
      <div class="owl-booking-confirm-card">
        <div class="confirm-header">Confirm Appointment</div>
        <div class="confirm-time">${dateFormatted}</div>
        
        <div class="confirm-inputs">
          <input type="text" id="owl-book-name" placeholder="Your Name" value="${name}">
          <input type="email" id="owl-book-email" placeholder="Your Email" value="${email}">
          <input type="text" id="owl-book-phone" placeholder="Phone Number (Optional)">
          <textarea id="owl-book-intent" placeholder="Reason for booking..." rows="2" style="resize: none;"></textarea>
        </div>
        
        <div class="confirm-actions">
          <button class="confirm-btn btn-primary" id="owl-confirm-booking-btn">Confirm Booking</button>
          <button class="confirm-btn btn-secondary" id="owl-cancel-booking-btn">Cancel</button>
        </div>
      </div>
    `;

    const confirmBtn = document.getElementById('owl-confirm-booking-btn');
    const cancelBtn = document.getElementById('owl-cancel-booking-btn');

    cancelBtn.onclick = () => {
      renderBookingSlots(container, wrap);
    };

    confirmBtn.onclick = async () => {
      const nameInput = document.getElementById('owl-book-name');
      const emailInput = document.getElementById('owl-book-email');
      const phoneInput = document.getElementById('owl-book-phone');
      const intentInput = document.getElementById('owl-book-intent');
      
      name = nameInput ? nameInput.value.trim() : name;
      email = emailInput ? emailInput.value.trim() : email;
      const phone = phoneInput ? phoneInput.value.trim() : '';
      const intent = intentInput ? intentInput.value.trim() : 'AI Appointed Session';
      
      if (!name || !email) {
        alert('Please enter both your name and email.');
        return;
      }
      
      sessionStorage.setItem('owl_customer_name', name);
      sessionStorage.setItem('owl_customer_email', email);

      confirmBtn.disabled = true;
      confirmBtn.innerText = 'Booking...';

      try {
        const res = await fetch('/api/manage-slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            operation: 'create_booking',
            business_id: businessId,
            slot_id: slot.id,
            customer_name: name,
            customer_email: email,
            phone: phone,
            service_name: intent
          })
        });
        
        if (res.ok) {
          wrap.innerHTML = `
            <div class="owl-booking-success">
              <span class="material-symbols-outlined" style="font-size: 2.5rem; color: #10b981; margin-bottom: 0.5rem; font-variation-settings: 'FILL' 1;">check_circle</span>
              <div style="font-weight: 700; color: white;">Booking Confirmed!</div>
              <div style="font-size: 0.85rem; color: #908fa0; margin-top: 0.25rem;">${dateFormatted}</div>
              <div style="font-size: 0.8rem; color: #10b981; margin-top: 0.5rem; font-weight: 500;">Details sent to your email.</div>
            </div>
          `;
          
          widgetChatHistory.push({ role: 'user', content: `[Booked appointment for ${dateFormatted}]` });
          widgetChatHistory.push({ role: 'bot', content: `Success booking on ${dateFormatted}` });
        } else {
          let errorMsg = 'Booking failed. Please try again.';
          try {
            const errJson = await res.json();
            if (errJson && errJson.details) {
              errorMsg = errJson.details;
            }
          } catch(e) {}
          throw new Error(errorMsg);
        }
      } catch (err) {
        console.error(err);
        wrap.innerHTML = `<div class="owl-slots-empty" style="color: #ff9966;">${err.message || 'Booking failed. Please try again.'}</div>`;
      }
    };
  }

  sendBtn.onclick = handleSend;
  input.onkeypress = (e) => { if (e.key === 'Enter') handleSend(); };

  sendBtn.onclick = handleSend;
  input.onkeypress = (e) => { if (e.key === 'Enter') handleSend(); };

})();
