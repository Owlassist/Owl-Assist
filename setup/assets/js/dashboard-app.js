/**
 * Owl Assist - Shared Dashboard Logic
 * Handles data fetching, state management, and shared app features.
 */

let profileMounted = false;
let currentUser = null;

window.app = {
    // --- Helper: Format Time to 12h (AM/PM) ---
    formatTime12h: function (time24) {
        if (!time24) return '--';
        const [hours, minutes] = time24.split(':');
        let h = parseInt(hours);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h}:${minutes.substring(0, 2)} ${ampm}`;
    },

    viewConversation: function (sessionId) {
        if (!sessionId || sessionId === 'null') {
            if (window.OwlModal) OwlModal.alert('No History', 'This lead was captured without an associated chat session.');
            return;
        }
        app.navigate('conversations');
        setTimeout(() => {
            const item = document.querySelector(`div[data-session-id="${sessionId}"]`);
            if (item) item.click();
        }, 600);
    },

    fetchRecentConversations: async function () {
        if (!currentUser) return;
        const sessions = await window.owlDb.fetchChatSessions(currentUser.id);
        renderConversations(sessions);
    },

    navigate: function (viewId) {
        // Handle Desktop Sidebar toggle
        const sidebar = document.getElementById('main-sidebar');
        if (sidebar) sidebar.classList.remove('mobile-open');

        // Handle Desktop Sidebar Bottom Nav (.bottom-nav-item)
        document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));
        const bottomNavItem = document.querySelector(`.bottom-nav-item[data-target="${viewId}"]`);
        if (bottomNavItem) bottomNavItem.classList.add('active');

        // Handle Mobile Bottom Nav (.mob-nav-item) — new premium mobile UI
        document.querySelectorAll('.mob-nav-item').forEach(el => el.classList.remove('active'));
        const mobNavItem = document.querySelector(`.mob-nav-item[data-target="${viewId}"]`);
        if (mobNavItem) mobNavItem.classList.add('active');

        // Reset conversation panels on mobile
        if (viewId === 'conversations') {
            const sPanel = document.getElementById('session-panel');
            const cPanel = document.getElementById('chat-panel');
            if (sPanel) { sPanel.classList.add('panel-active'); sPanel.classList.add('mob-conv-panel'); }
            if (cPanel) { cPanel.classList.remove('panel-active'); }
        }

        // Hide all views — support both .app-view (desktop) and .mob-view (mobile)
        document.querySelectorAll('.app-view, .mob-view').forEach(el => el.classList.remove('active-view'));
        // Show target view
        const targetView = document.getElementById(`view-${viewId}`);
        if (targetView) targetView.classList.add('active-view');

        // Update Sidebar active state (Desktop)
        document.querySelectorAll('.db-nav-item').forEach(el => el.classList.remove('active'));
        const navItem = document.querySelector(`.db-nav-item[data-target="${viewId}"]`);
        if (navItem) navItem.classList.add('active');

        // Fetch Fresh Data when navigating
        if (['bookings', 'overview', 'conversations'].includes(viewId)) {
            fetchDataFromCloud();
        }

        // Scroll to top
        window.scrollTo(0, 0);
    },

    toggleSidebar: function () {
        const sidebar = document.getElementById('main-sidebar');
        if (sidebar) sidebar.classList.toggle('mobile-open');
    },

    showSessionList: function () {
        const sPanel = document.getElementById('session-panel');
        const cPanel = document.getElementById('chat-panel');
        if (sPanel) sPanel.classList.add('panel-active');
        if (cPanel) cPanel.classList.remove('panel-active');
    },

    // Alias used by the mobile back button in chat panel
    showSessionPanel: function () {
        this.showSessionList();
    },

    setSettingsTab: function (tabId) {
        const tabs = ['account', 'ai', 'billing'];
        tabs.forEach(t => {
            const el = document.getElementById(`settings-tab-${t}`);
            if (el) el.style.display = 'none';
            const nav = document.getElementById(`tab-nav-${t}`);
            if (nav) nav.classList.remove('active');
        });

        const activeTab = document.getElementById(`settings-tab-${tabId}`);
        if (activeTab) activeTab.style.display = 'block';
        const activeNav = document.getElementById(`tab-nav-${tabId}`);
        if (activeNav) activeNav.classList.add('active');
    },

    terminateSessionPrompt: async function (sessionId) {
        const modal = document.getElementById('custom-modal');
        if (!modal) return;
        const iconEl = document.getElementById('modal-icon');
        const titleEl = document.getElementById('modal-title');
        const msgEl = document.getElementById('modal-message');
        const confirmBtn = document.getElementById('modal-confirm-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');

        // Configure modal for session termination
        if (iconEl) {
            iconEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:2rem;">cancel</span>';
            iconEl.style.background = 'rgba(239, 68, 68, 0.1)';
            iconEl.style.color = '#ef4444';
        }
        if (titleEl) titleEl.innerText = 'End Chat Session?';
        if (msgEl) msgEl.innerText = 'Are you sure you want to end this chat session? The customer will be notified in real-time, and all progress will be permanently cleared.';
        if (confirmBtn) {
            confirmBtn.innerText = 'Yes, End Session';
            confirmBtn.style.background = '#ef4444';
            confirmBtn.style.borderColor = '#ef4444';
        }

        modal.classList.add('active');
        modal.style.display = 'flex';

        return new Promise((resolve) => {
            const cleanup = () => {
                modal.classList.remove('active');
                setTimeout(() => modal.style.display = 'none', 300);
                confirmBtn.onclick = null;
                cancelBtn.onclick = null;
                // Reset modal content defaults
                if (iconEl) {
                    iconEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:2rem;">delete</span>';
                }
                if (titleEl) titleEl.innerText = 'Delete Lead?';
                if (confirmBtn) {
                    confirmBtn.innerText = 'Delete';
                }
            };

            confirmBtn.onclick = async () => {
                confirmBtn.innerText = 'Ending...';
                confirmBtn.disabled = true;
                try {
                    await window.owlDb.terminateSession(sessionId, currentUser.id);
                    await fetchDataFromCloud();
                    cleanup();
                    // Reload active conversation view to show ended state
                    const activeItem = document.querySelector(`.session-item.active`);
                    if (activeItem) activeItem.click();
                } catch (err) {
                    alert('Error ending session: ' + err.message);
                    cleanup();
                } finally {
                    confirmBtn.disabled = false;
                }
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve(false);
            };
        });
    },

    updateLeadStatusPrompt: function (id, currentStatus) {
        const statuses = ['pending', 'contacted', 'qualified', 'lost', 'won'];
        
        if (window.OwlModal && OwlModal.prompt) {
            OwlModal.prompt(
                'Update Status',
                `Enter new status (options: ${statuses.join(', ')}):`,
                currentStatus,
                async (newStatus) => {
                    if (!newStatus || newStatus === currentStatus) return;
                    if (!statuses.includes(newStatus.toLowerCase())) {
                        OwlModal.alert('Error', 'Invalid status. Please enter one of: ' + statuses.join(', '));
                        return;
                    }
                    try {
                        await window.owlDb.updateLeadStatus(id, newStatus.toLowerCase());
                        if (typeof fetchDataFromCloud === 'function') fetchDataFromCloud();
                    } catch (err) {
                        OwlModal.alert('Error', 'Error updating status: ' + err.message);
                    }
                }
            );
        } else {
            // Fallback just in case
            const newStatus = prompt(`Enter new status (options: ${statuses.join(', ')}):`, currentStatus);
            if (!newStatus || newStatus === currentStatus) return;
            
            if (!statuses.includes(newStatus.toLowerCase())) {
                alert('Invalid status. Please enter one of: ' + statuses.join(', '));
                return;
            }

            window.owlDb.updateLeadStatus(id, newStatus.toLowerCase())
                .then(() => {
                    if (typeof fetchDataFromCloud === 'function') fetchDataFromCloud();
                })
                .catch(err => {
                    alert('Error updating status: ' + err.message);
                });
        }
    },

    deleteLead: async function (id) {
        const modal = document.getElementById('custom-modal');
        if (!modal) return;
        const confirmBtn = document.getElementById('modal-confirm-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');

        modal.classList.add('active');
        modal.style.display = 'flex';

        return new Promise((resolve) => {
            const cleanup = () => {
                modal.classList.remove('active');
                setTimeout(() => modal.style.display = 'none', 300);
                confirmBtn.onclick = null;
                cancelBtn.onclick = null;
            };

            confirmBtn.onclick = async () => {
                confirmBtn.innerText = 'Deleting...';
                confirmBtn.disabled = true;
                try {
                    await window.owlDb.deleteLead(id);
                    fetchDataFromCloud();
                    cleanup();
                    confirmBtn.innerText = 'Delete';
                    confirmBtn.disabled = false;
                } catch (err) {
                    alert('Error deleting: ' + err.message);
                    cleanup();
                }
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve(false);
            };
        });
    },

    copyShareLink: function () {
        const input = document.getElementById('share-link-input');
        if (!input) return;

        // Use Clipboard API if available; fallback to execCommand
        const text = input.value;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
        } else {
            input.select();
            document.execCommand('copy');
        }

        const btn = document.getElementById('btn-copy-link');
        if (!btn) return;

        // Desktop has text label; mobile has icon. Handle both gracefully.
        const iconEl = btn.querySelector('.material-symbols-outlined');
        if (iconEl) {
            const orig = iconEl.textContent;
            iconEl.textContent = 'check';
            setTimeout(() => iconEl.textContent = orig, 2000);
        } else {
            const orig = btn.innerText;
            btn.innerText = 'Copied!';
            setTimeout(() => btn.innerText = orig, 2000);
        }
    },

    copyWidgetSnippet: function () {
        const snippetDesk = document.getElementById('snippet-code');
        const snippetMob = document.getElementById('snippet-code-mobile');
        const text = snippetDesk ? snippetDesk.innerText : (snippetMob ? snippetMob.innerText : '');
        if (!text) return;

        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
        } else {
            const tempInput = document.createElement("textarea");
            tempInput.value = text;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand("copy");
            document.body.removeChild(tempInput);
        }

        const btnDesk = document.getElementById('btn-copy-widget');
        if (btnDesk) {
            const orig = btnDesk.innerText;
            btnDesk.innerText = 'Copied!';
            setTimeout(() => btnDesk.innerText = orig, 2000);
        }
        
        const btnMob = document.getElementById('btn-copy-widget-mobile');
        if (btnMob) {
            const orig = btnMob.innerText;
            btnMob.innerText = 'Copied!';
            setTimeout(() => btnMob.innerText = orig, 2000);
        }
    },

    updateProfile: async function () {
        const btn = document.getElementById('btn-save-profile');
        const originalText = btn.innerText;
        btn.innerText = 'Saving...';
        btn.disabled = true;

        try {
            const clerk = await window.owlAuth.getSession();
            const user = clerk.user;

            const firstName = document.getElementById('settings-first-name').value;
            const lastName = document.getElementById('settings-last-name').value;
            const businessName = document.getElementById('settings-business-name').value;
            const username = document.getElementById('settings-username').value.trim();

            const updateFields = {
                firstName: firstName,
                lastName: lastName,
                unsafeMetadata: {
                    ...user.unsafeMetadata,
                    business_name: businessName,
                    business_username: username
                }
            };
            
            await user.update(updateFields);

            await window.owlDb.updateBusinessSettings(user.id, {
                name: businessName || `${firstName} ${lastName}`,
                username: username || null
            });

            await initDashboard();
            if (window.OwlModal) OwlModal.alert('Success', 'Profile updated successfully!');

        } catch (err) {
            console.error("Profile update failed:", err);
            if (window.OwlModal) OwlModal.alert('Error', 'Failed to update profile: ' + (err.message || err));
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    },

    saveSettings: async function (btnElement) {
        if (btnElement) {
            btnElement.dataset.originalText = btnElement.innerText;
            btnElement.innerText = 'Saving...';
            btnElement.disabled = true;
        }

        const url = document.getElementById('settings-url').value;
        const instructions = document.getElementById('settings-instructions').value;
        const bookingUrl = document.getElementById('settings-booking-url').value;

        try {
            const clerk = await window.owlAuth.getSession();
            const businessId = clerk.user.id;

            await window.owlDb.updateBusinessSettings(businessId, {
                website_url: url,
                ai_instructions: instructions,
                booking_url: bookingUrl,
                name: document.getElementById('settings-business-name').value || clerk.user.fullName
            });

            if (window.OwlModal) OwlModal.alert('Success', 'AI Knowledge Base updated successfully!');
            else alert('AI Knowledge Base updated successfully!');
        } catch (err) {
            console.error("Save settings error:", err);
            if (window.OwlModal) OwlModal.alert('Error', 'Error saving settings: ' + (err.message || err));
            else alert('Error saving settings: ' + (err.message || err));
        } finally {
            if (btnElement) {
                btnElement.innerText = btnElement.dataset.originalText;
                btnElement.disabled = false;
            }
        }
    },

    // --- Analytics Feature ---
    loadAnalytics: async function(businessId, bookings) {
        try {
            const supabase = await window.owlDb.getSupabase();
            const { data: logs } = await supabase.from('chat_logs').select('id, role, session_id').eq('business_id', businessId);
            
            const aiMessages = logs ? logs.filter(l => l.role === 'bot').length : 0;
            const totalSessions = new Set((logs || []).map(l => l.session_id)).size;
            const timeSaved = Math.round((aiMessages * 2) / 60); // 2 mins per AI message
            
            // Desktop
            if(document.getElementById('stat-bookings')) document.getElementById('stat-bookings').innerText = bookings.length;
            if(document.getElementById('stat-sessions')) document.getElementById('stat-sessions').innerText = totalSessions;
            if(document.getElementById('stat-messages')) document.getElementById('stat-messages').innerText = aiMessages;
            if(document.getElementById('stat-time-saved')) document.getElementById('stat-time-saved').innerText = `${timeSaved} hrs`;
            
            // Mobile
            if(document.getElementById('stat-messages-mobile')) document.getElementById('stat-messages-mobile').innerText = aiMessages;
            if(document.getElementById('stat-time-saved-mobile')) document.getElementById('stat-time-saved-mobile').innerText = `${timeSaved} hrs`;
        } catch(e) { console.error("Error loading analytics:", e); }
    },

    // --- Document Upload Feature ---
    handleDocumentUpload: async function(event, isMobile = false) {
        const file = event.target.files[0];
        if (!file) return;

        const statusEl = document.getElementById(isMobile ? 'document-upload-status-mobile' : 'document-upload-status');
        const instEl = document.getElementById('settings-instructions');
        if (statusEl) statusEl.innerText = "Extracting text... please wait.";

        try {
            const reader = new FileReader();
            reader.onload = async function() {
                const typedarray = new Uint8Array(this.result);
                const pdf = await pdfjsLib.getDocument(typedarray).promise;
                let fullText = "";
                
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + "\\n\\n";
                    if(fullText.length > 5000) break; // Limit to 5000 chars to avoid prompt bloat
                }

                const docKnowledge = "\\n\\n--- UPLOADED DOCUMENT KNOWLEDGE ---\\n" + fullText.substring(0, 5000) + "\\n-----------------------------------";
                if(instEl) {
                    if(!instEl.value.includes("--- UPLOADED DOCUMENT KNOWLEDGE ---")) {
                        instEl.value = instEl.value + docKnowledge;
                    } else {
                        instEl.value = instEl.value.replace(/--- UPLOADED DOCUMENT KNOWLEDGE ---[\\s\\S]*-----------------------------------/, docKnowledge.trim());
                    }
                }
                
                if (statusEl) statusEl.innerText = "Extracted! Click Save below.";
            };
            reader.readAsArrayBuffer(file);
        } catch (err) {
            console.error("PDF Parsing Error:", err);
            if (statusEl) statusEl.innerText = "Error reading PDF. Make sure it's valid.";
        }
    },

};

// --- Data Fetching Logic ---
async function fetchDataFromCloud() {
    if (!currentUser) return;
    const businessId = currentUser.id;

    try {
        let settings = await window.owlDb.fetchBusinessData(businessId);
        if (!settings) {
            settings = await window.owlDb.provisionBusiness(businessId, {
                name: currentUser.fullName || currentUser.username || "New Business",
                email: currentUser.primaryEmailAddress?.emailAddress || '',
                username: currentUser.username || null
            });
        }

        if (settings) {
            const urlEl = document.getElementById('settings-url');
            if (urlEl) urlEl.value = settings.website_url || '';
            const instEl = document.getElementById('settings-instructions');
            if (instEl) instEl.value = settings.ai_instructions || '';
            const calEl = document.getElementById('settings-booking-url');
            if (calEl) calEl.value = settings.booking_url || '';

            const snippetCode = document.getElementById('snippet-code');
            const snippetCodeMobile = document.getElementById('snippet-code-mobile');
            if (snippetCode || snippetCodeMobile) {
                const scriptUrl = window.location.origin + '/widget/owl-assist.js';
                const tag = `<script src="${scriptUrl}" data-business="${businessId}" defer><\/script>`;
                if (snippetCode) snippetCode.innerText = tag;
                if (snippetCodeMobile) snippetCodeMobile.innerText = tag;
            }

            const shareInput = document.getElementById('share-link-input');
            if (shareInput) {
                const origin = window.location.origin;
                // Clean URL: /chat/username — falls back to /chat?id= if no username set
                const actualUsername = settings.username || currentUser.username;
                const isLocalEnv = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                
                let shareUrl;
                if (actualUsername) {
                    shareUrl = isLocalEnv 
                        ? `${origin}/chat/?u=${actualUsername}` 
                        : `${origin}/chat/${actualUsername}`;
                } else {
                    shareUrl = `${origin}/chat/?id=${businessId}`;
                }
                shareInput.value = shareUrl;
            }
            
            const usernameInput = document.getElementById('settings-username');
            if (usernameInput) usernameInput.value = settings.username || '';
        }

        const bookings = await window.owlDb.fetchBookings(businessId);
        renderBookings(bookings);
        app.loadAnalytics(businessId, bookings);
        // Mobile sparkline — only runs on dashboard-mobile.html where the fn is defined
        if (typeof window.buildSparklineFromBookings === 'function') {
            window.buildSparklineFromBookings(bookings);
        }

        const sessions = await window.owlDb.fetchChatSessions(businessId);
        renderStats(bookings, sessions);
        renderConversations(sessions);

    } catch (err) {
        console.error("Cloud data fetch error:", err);
    }
}

function renderStats(bookings, sessions = []) {
    const statBookings = document.getElementById('stat-bookings');
    if (statBookings) statBookings.innerText = bookings.length;
    
    const statSessions = document.getElementById('stat-sessions');
    if (statSessions) statSessions.innerText = sessions.length;
    
    const statStatus = document.getElementById('stat-status');
    if (statStatus) statStatus.innerText = 'Active';
}

function renderBookings(bookings) {
    const recentList    = document.getElementById('recent-bookings-list');
    const allList       = document.getElementById('all-bookings-list');
    const mobileList    = document.getElementById('mobile-leads-list');  // Overview recent (mobile)
    const allLeadsList  = document.getElementById('all-leads-list');     // All Leads view (mobile)
    const allLeadsEmpty = document.getElementById('all-leads-empty');    // Empty state (mobile)

    if (recentList)   recentList.innerHTML = '';
    if (allList)      allList.innerHTML = '';
    if (mobileList)   mobileList.innerHTML = '';
    if (allLeadsList) allLeadsList.innerHTML = '';

    if (bookings.length === 0) {
        // Show empty states
        ['recent-bookings-empty', 'all-bookings-empty', 'mobile-leads-empty'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });
        if (allLeadsEmpty) allLeadsEmpty.style.display = '';
        // Hide desktop tables
        ['recent-bookings-table', 'all-bookings-table'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        return;
    }

    // Hide empty states when there are bookings
    ['recent-bookings-empty', 'all-bookings-empty', 'mobile-leads-empty'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    if (allLeadsEmpty) allLeadsEmpty.style.display = 'none';
    ['recent-bookings-table', 'all-bookings-table'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('hidden');
    });

    bookings.forEach((booking, idx) => {
        const dateObj = new Date(booking.booking_time);
        const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Desktop Table Row
        const rowHtml = `
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
            <td data-label="Contact">
              <div style="font-weight:600; color: white;">${booking.name || booking.customer_name || 'Anonymous'}</div>
              <div style="font-size:0.75rem; color:var(--text-dim)">${booking.email || booking.customer_email || 'No email'}</div>
              <div style="font-size:0.75rem; color:var(--text-dim)">${booking.phone || ''}</div>
              ${booking.access_code ? `<div style="font-size:0.75rem; color:var(--primary); font-weight:600; margin-top:0.25rem; display: flex; align-items: center; gap: 0.25rem;"><span class="material-symbols-outlined" style="font-size: 0.9rem;">vpn_key</span>Code: ${booking.access_code}</div>` : ''}
            </td>
            <td data-label="Intent/Summary">
               <span style="font-size: 0.85rem; color: var(--text-dim);">${booking.summary || booking.service_name || '--'}</span>
            </td>
            <td data-label="Captured At" style="font-size: 0.85rem; color: var(--text-dim);">${dateStr}</td>
            <td data-label="Status"><span class="status-badge status-${booking.status}">${booking.status}</span></td>
            <td style="text-align: center;">
               <div class="action-dropdown" style="display: inline-block;">
                  <button class="btn-icon action-trigger" onclick="event.stopPropagation(); this.nextElementSibling.classList.toggle('active')">
                    <span class="material-symbols-outlined">more_vert</span>
                  </button>
                  <div class="action-menu" style="right: 0;">
                    <div class="action-item" onclick="app.viewConversation('${booking.session_id}')">
                      <span class="material-symbols-outlined">forum</span>
                      View Chat
                    </div>
                    <div class="action-item" onclick="window.location.href='mailto:${booking.email || booking.customer_email}'">
                      <span class="material-symbols-outlined">mail</span>
                      Email Lead
                    </div>
                    <div class="action-item" onclick="app.updateLeadStatusPrompt('${booking.id}', '${booking.status}')">
                      <span class="material-symbols-outlined">edit</span>
                      Update Status
                    </div>
                    <div class="action-item" style="color: var(--error);" onclick="app.deleteLead('${booking.id}')">
                      <span class="material-symbols-outlined">delete</span>
                      Delete Lead
                    </div>
                  </div>
               </div>
            </td>
          </tr>
        `;

        if (idx < 5 && recentList) recentList.innerHTML += rowHtml;
        if (allList) allList.innerHTML += rowHtml;

        // Mobile Lead Card — shared builder for both overview recent list & all-leads view
        const buildMobileCard = () => {
            const card = document.createElement('div');
            card.className = 'mobile-lead-card';
            card.innerHTML = `
                <div class="card-header">
                    <div class="card-title">${booking.name || booking.customer_name || 'Anonymous'}</div>
                    <span class="status-badge status-${booking.status || 'new'}">${booking.status || 'new'}</span>
                </div>
                <p class="summary">${booking.summary || booking.service_name || 'No summary available'}</p>
                <div class="meta">
                    <span>
                        <span class="material-symbols-outlined">mail</span>
                        ${booking.email || booking.customer_email || 'N/A'}
                    </span>
                    <span>
                        <span class="material-symbols-outlined">schedule</span>
                        ${dateStr}
                    </span>
                    ${booking.access_code ? `
                    <span>
                        <span class="material-symbols-outlined" style="font-size: 0.95rem;">vpn_key</span>
                        Code: ${booking.access_code}
                    </span>
                    ` : ''}
                </div>
                <div class="card-actions">
                    <button onclick="app.viewConversation('${booking.session_id}')" class="btn-small">
                        <span class="material-symbols-outlined">forum</span> Chat
                    </button>
                    <button onclick="window.location.href='mailto:${booking.email || booking.customer_email}'" class="btn-small">
                        <span class="material-symbols-outlined">mail</span> Email
                    </button>
                    <button onclick="app.updateLeadStatusPrompt('${booking.id}', '${booking.status}')" class="btn-small">
                        <span class="material-symbols-outlined">edit</span> Status
                    </button>
                </div>
            `;
            return card;
        };

        // Recent leads on overview (mobile) — show up to 5
        if (idx < 5 && mobileList) mobileList.appendChild(buildMobileCard());

        // All leads view (new mobile UI)
        if (allLeadsList) allLeadsList.appendChild(buildMobileCard());
    });
}

async function renderConversations(sessions) {
    const sessionList = document.getElementById('session-list');
    if (!sessionList) return;
    sessionList.innerHTML = '';

    if (sessions.length === 0) {
        sessionList.innerHTML = '<div style="text-align: center; color: var(--text-dim); padding: 2rem;">No conversations yet.</div>';
        return;
    }

    sessions.forEach(session => {
        const date = new Date(session.created_at);
        const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const isTerminated = session.session_status === 'terminated';
        const statusBadge = isTerminated 
          ? `<span style="font-size: 0.65rem; padding: 0.1rem 0.4rem; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 0.5rem; margin-left: 0.5rem;">Ended</span>` 
          : '';

        const item = document.createElement('div');
        item.className = 'session-item';
        if (isTerminated) {
            item.className += ' terminated';
        }
        item.style = `padding: 1rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; margin-bottom: 0.5rem;${isTerminated ? ' opacity: 0.6;' : ''}`;

        item.setAttribute('data-session-id', session.session_id);
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="flex-grow: 1; overflow: hidden; padding-right: 0.5rem;">
              <div style="font-weight: 700; font-size: 0.85rem; color: ${isTerminated ? 'var(--text-dim)' : 'var(--primary)'}; margin-bottom: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; justify-content: space-between;">
                <span>${session.summary || 'Active Chat'}</span>
                ${statusBadge}
              </div>
              <div style="display: flex; gap: 0.5rem; align-items: center; justify-content: space-between;">
                <span style="font-size: 0.75rem; color: ${isTerminated ? 'var(--text-dim)' : 'white'};">${session.customer_name}</span>
                <span style="font-size: 0.65rem; color: var(--text-dim);">${timeStr}</span>
              </div>
            </div>
          </div>
        `;

        item.onclick = async () => {
            document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            
            // Handle Mobile Layout Switch
            if (window.innerWidth <= 768) {
                const sPanel = document.getElementById('session-panel');
                const cPanel = document.getElementById('chat-panel');
                if (sPanel) sPanel.classList.remove('panel-active');
                if (cPanel) cPanel.classList.add('panel-active');
            }

            await loadTranscript(session.session_id, session.customer_name, session.summary, timeStr, session.session_status);
        };

        sessionList.appendChild(item);
    });
}

async function loadTranscript(sessionId, name, summary, timeStr, sessionStatus = 'active') {
    const chatHeader = document.getElementById('chat-header');
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    const backBtn = window.innerWidth <= 768 ? `<button onclick="app.showSessionList()" class="back-btn"><span class="material-symbols-outlined">arrow_back</span></button>` : '';

    const isTerminated = sessionStatus === 'terminated';
    const headerName = isTerminated ? `${name} <span style="font-size: 0.75rem; padding: 0.1rem 0.5rem; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 0.5rem; margin-left: 0.5rem; vertical-align: middle;">Ended</span>` : name;

    let headerButtons = '';
    if (!isTerminated) {
        headerButtons = `
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                <button id="btn-end-session" class="btn btn-outline" style="border-color: rgba(239, 68, 68, 0.4); color: #ef4444; padding: 0.5rem 1rem; font-size: 0.8rem; display: flex; align-items: center; gap: 0.5rem;" onclick="app.terminateSessionPrompt('${sessionId}')">
                  <span class="material-symbols-outlined" style="font-size: 1.1rem; color: #ef4444;">cancel</span> End Session
                </button>
            </div>
        `;
    }

    if (chatHeader) {
        chatHeader.innerHTML = `
            <div style="display: flex; align-items: center; width: 100%;">
                ${backBtn}
                <div style="flex: 1">
                    <h3 style="font-size: 1rem; margin: 0; color: white;">${headerName}</h3>
                    <p style="font-size: 0.75rem; color: var(--primary); margin: 0;">${summary}</p>
                </div>
            </div>
            ${headerButtons}
        `;
    }
    
    chatMessages.innerHTML = '<div style="text-align: center; color: var(--text-dim); padding: 2rem;">Loading...</div>';

    const logs = await window.owlDb.fetchChatLogs(sessionId);
    chatMessages.innerHTML = '';

    logs.forEach(log => {
        // Skip system messages
        if (log.role === 'system') return;
        
        const isUser = log.role === 'user';
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user' : 'bot'}`;
        msgDiv.innerHTML = log.content;
        chatMessages.appendChild(msgDiv);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function initDashboard() {
    try {
        // Wait up to 2 seconds for Clerk script to set window.owlAuth
        let retries = 0;
        while (!window.owlAuth && retries < 20) {
            await new Promise(r => setTimeout(r, 100));
            retries++;
        }

        if (!window.owlAuth) {
            throw new Error("Authentication module (owlAuth) failed to load.");
        }

        const clerk = await window.owlAuth.getSession();
        if (!clerk.session) {
            window.location.href = '/auth/login';
            return;
        }

        currentUser = clerk.user;
        const user = currentUser;

        // Update UI Elements
        const displayName = user.firstName || user.unsafeMetadata?.business_name || user.username || 'Business User';
        const email = user.primaryEmailAddress?.emailAddress || '';
        
        // Update name elements — class-based (.ui-name) + single IDs (#ui-name)
        document.querySelectorAll('.ui-name').forEach(el => el.innerText = displayName);
        const nameById = document.getElementById('ui-name');
        if (nameById) nameById.innerText = displayName;

        // Update email elements
        document.querySelectorAll('.ui-email').forEach(el => el.innerText = email);
        const emailById = document.getElementById('ui-email');
        if (emailById) emailById.innerText = email;

        // Update avatar elements — class-based + single ID (#ui-avatar) for mobile header
        const updateAvatar = (el) => {
            if (!el) return;
            if (user.hasImage) {
                el.innerHTML = `<img src="${user.imageUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            } else {
                el.innerText = displayName[0]?.toUpperCase() || 'B';
            }
        };
        document.querySelectorAll('.ui-avatar').forEach(updateAvatar);
        updateAvatar(document.getElementById('ui-avatar'));

        // Prepopulate Settings
        const fn = document.getElementById('settings-first-name');
        if (fn) fn.value = user.firstName || '';
        const ln = document.getElementById('settings-last-name');
        if (ln) ln.value = user.lastName || '';
        const bn = document.getElementById('settings-business-name');
        if (bn) bn.value = user.unsafeMetadata?.business_name || '';
        const un = document.getElementById('settings-username');
        if (un) un.value = user.unsafeMetadata?.business_username || user.username || '';
        
        // --- Avatar Upload Logic ---
        const avatarUpload = document.getElementById('settings-avatar-upload');
        if (avatarUpload) {
            avatarUpload.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const preview = document.getElementById('settings-avatar-preview');
                const originalContent = preview.innerHTML;

                try {
                    preview.innerHTML = '<span class="material-symbols-outlined rotating" style="font-size: 2rem;">sync</span>';
                    
                    // Upload to Clerk
                    await user.setProfileImage({ file });
                    
                    // Refresh UI
                    await initDashboard();
                    if (window.OwlModal) OwlModal.alert('Success', 'Profile picture updated!');
                } catch (err) {
                    console.error("Avatar upload failed:", err);
                    preview.innerHTML = originalContent;
                    if (window.OwlModal) OwlModal.alert('Error', 'Failed to upload image: ' + err.message);
                }
            });
        }

        await fetchDataFromCloud();

        // Realtime Subscriptions
        const supabase = await window.owlDb.getSupabase();
        if (supabase) {
            if (!window.dbSubscription) {
                window.dbSubscription = supabase.channel('db-changes');
                window.dbSubscription
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `business_id=eq.${user.id}` }, () => fetchDataFromCloud())
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_logs', filter: `business_id=eq.${user.id}` }, () => app.fetchRecentConversations())
                    .subscribe();
            }
        }

    } catch (err) {
        console.error('Init dashboard error:', err);
    }
}

async function handleLogout() {
    await window.owlAuth.signOut();
}

// Global Close for Action Dropdowns
window.addEventListener('click', (e) => {
    if (!e.target.closest('.action-dropdown')) {
        document.querySelectorAll('.action-menu.active').forEach(m => m.classList.remove('active'));
    }
});

initDashboard();


