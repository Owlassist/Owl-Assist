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
        // Show target view
        const targetView = document.getElementById(`view-${viewId}`);
        if (targetView) targetView.classList.add('active-view');

        // Show/hide notification bell based on active tab (only show on Overview)
        const deskNotif = document.querySelector('.global-notif-container');
        const mobNotif = document.querySelector('.mob-notif-wrap');
        if (deskNotif) {
            deskNotif.style.display = viewId === 'overview' ? 'flex' : 'none';
        }
        if (mobNotif) {
            mobNotif.style.display = viewId === 'overview' ? 'flex' : 'none';
        }

        if (viewId === 'assistant') {
            app.loadAssistantChat();
        }

        // Update Sidebar active state (Desktop)
        document.querySelectorAll('.db-nav-item').forEach(el => el.classList.remove('active'));
        const navItem = document.querySelector(`.db-nav-item[data-target="${viewId}"]`);
        if (navItem) navItem.classList.add('active');

        // Intercept legacy widget setup redirects
        if (viewId === 'widget') {
            this.navigate('settings');
            this.setSettingsTab('widget');
            return;
        }

        // Fetch Fresh Data when navigating
        if (['bookings', 'appointments', 'assistant', 'overview', 'conversations', 'slots'].includes(viewId)) {
            if (viewId === 'slots') {
                (async () => {
                    try {
                        const avail = await window.owlDb.fetchAvailability(currentUser.id);
                        app._availability = avail;
                        const availList = document.getElementById('availability-hours-list');
                        if (availList) app.renderAvailabilitySettings(availList);
                        await app.loadSlots();
                    } catch(e) { console.error('Slots load error:', e); }
                })();
            }
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
        const tabs = ['account', 'ai', 'customization', 'billing', 'widget'];
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

        // Show/hide pro lock on customization tab
        if (tabId === 'customization') {
            app.applyCustomizationLock();
            app.loadThemePickers();
        }
        // Load FAQs when switching to AI tab
        if (tabId === 'ai' || tabId === 'customization') {
            app.renderFaqs();
        }
    },

    // --- FAQ MANAGEMENT ---
    _faqs: [],
    _isPro: false,
    FAQ_FREE_LIMIT: 3,

    renderFaqs: function() {
        const renderToContainer = (list) => {
            if (!list) return;
            if (app._faqs.length === 0) {
                list.innerHTML = '<div style="text-align:center; color:var(--text-dim); padding:2rem 0; font-size:0.9rem;">No FAQs yet. Click "Add FAQ" to get started.</div>';
                return;
            }
            list.innerHTML = '';
            app._faqs.forEach((faq, idx) => {
                const card = document.createElement('div');
                card.style.cssText = 'padding:1rem; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:var(--radius-sm); margin-bottom:0.5rem;';
                card.innerHTML = `
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem;">
                    <div style="flex:1;">
                      <div style="font-weight:600; margin-bottom:0.35rem; color:white;">${faq.question}</div>
                      <div style="font-size:0.85rem; color:var(--text-dim); white-space:pre-wrap;">${faq.answer}</div>
                    </div>
                    <div style="display:flex; gap:0.5rem; flex-shrink:0;">
                      <button onclick="app.openFaqModal(${idx})" style="background:rgba(82,107,245,0.1); border:1px solid rgba(82,107,245,0.3); color:var(--primary); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer; font-size:0.8rem;">Edit</button>
                      <button onclick="app.deleteFaq(${idx})" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); color:#ef4444; border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer; font-size:0.8rem;">Delete</button>
                    </div>
                  </div>
                `;
                list.appendChild(card);
            });
        };

        // Render to desktop faq-list
        const desktopList = document.getElementById('faq-list');
        renderToContainer(desktopList);

        // Render to mobile faq-list-mobile
        const mobileList = document.getElementById('faq-list-mobile');
        renderToContainer(mobileList);

        // Update badge and disable Add button at free limit
        const badge = document.getElementById('faq-count-badge');
        const addBtn = document.getElementById('add-faq-btn');
        const max = app._isPro ? '∞' : app.FAQ_FREE_LIMIT;
        if (badge) badge.textContent = `${app._faqs.length} / ${max}`;
        if (addBtn) addBtn.disabled = !app._isPro && app._faqs.length >= app.FAQ_FREE_LIMIT;
    },

    openFaqModal: function(editIndex = -1) {
        if (!app._isPro && editIndex === -1 && app._faqs.length >= app.FAQ_FREE_LIMIT) {
            if (window.OwlModal) OwlModal.alert('Free Plan Limit', `You can add up to ${app.FAQ_FREE_LIMIT} FAQs on the Free plan. Upgrade to Pro for unlimited FAQs.`);
            return;
        }
        const modal = document.getElementById('faq-modal');
        const title = document.getElementById('faq-modal-title');
        const qInput = document.getElementById('faq-question-input');
        const aInput = document.getElementById('faq-answer-input');
        const editIdx = document.getElementById('faq-edit-index');
        if (!modal) return;
        if (editIndex >= 0 && app._faqs[editIndex]) {
            title.textContent = 'Edit FAQ';
            qInput.value = app._faqs[editIndex].question;
            aInput.value = app._faqs[editIndex].answer;
            editIdx.value = editIndex;
        } else {
            title.textContent = 'Add FAQ';
            qInput.value = '';
            aInput.value = '';
            editIdx.value = -1;
        }
        modal.style.display = 'flex';
        setTimeout(() => qInput.focus(), 100);
    },

    closeFaqModal: function() {
        const modal = document.getElementById('faq-modal');
        if (modal) modal.style.display = 'none';
    },

    saveFaqFromModal: async function() {
        const q = (document.getElementById('faq-question-input')?.value || '').trim();
        const a = (document.getElementById('faq-answer-input')?.value || '').trim();
        const editIdx = parseInt(document.getElementById('faq-edit-index')?.value ?? '-1');
        if (!q || !a) { if (window.OwlModal) OwlModal.alert('Incomplete', 'Please fill in both the question and answer.'); return; }

        if (editIdx >= 0) {
            app._faqs[editIdx] = { question: q, answer: a };
        } else {
            app._faqs.push({ question: q, answer: a });
        }
        app.closeFaqModal();
        app.renderFaqs();
        try {
            await window.owlDb.saveFaqs(currentUser.id, app._faqs);
        } catch(e) { console.error('Save FAQs error:', e); }
    },

    deleteFaq: async function(idx) {
        app._faqs.splice(idx, 1);
        app.renderFaqs();
        try {
            await window.owlDb.saveFaqs(currentUser.id, app._faqs);
        } catch(e) { console.error('Delete FAQ error:', e); }
    },

    // --- THEME MANAGEMENT ---
    loadThemePickers: function() {
        const settings = window._currentBusinessSettings;
        if (!settings) return;
        const primary = settings.theme_primary || '#c0c1ff';
        const bg = settings.theme_bg || '#0e0e1a';
        const bubble = settings.theme_chat_bubble || '#1e1e32';
        const pp = document.getElementById('theme-primary-picker');
        const ph = document.getElementById('theme-primary-hex');
        const bp = document.getElementById('theme-bg-picker');
        const bh = document.getElementById('theme-bg-hex');
        const bup = document.getElementById('theme-bubble-picker');
        const buh = document.getElementById('theme-bubble-hex');
        if (pp) pp.value = primary; if (ph) ph.value = primary;
        if (bp) bp.value = bg; if (bh) bh.value = bg;
        if (bup) bup.value = bubble; if (buh) buh.value = bubble;
        app.previewTheme();
    },

    previewTheme: function() {
        const primary = document.getElementById('theme-primary-picker')?.value || '#c0c1ff';
        const bg = document.getElementById('theme-bg-picker')?.value || '#0e0e1a';
        const bubble = document.getElementById('theme-bubble-picker')?.value || '#1e1e32';
        const hex1 = document.getElementById('theme-primary-hex'); if (hex1) hex1.value = primary;
        const hex2 = document.getElementById('theme-bg-hex'); if (hex2) hex2.value = bg;
        const hex3 = document.getElementById('theme-bubble-hex'); if (hex3) hex3.value = bubble;
        // Update preview
        const pBody = document.getElementById('preview-body'); if (pBody) pBody.style.background = bg;
        const pBot = document.getElementById('preview-bot-bubble'); if (pBot) pBot.style.background = bubble;
        const pUser = document.getElementById('preview-user-bubble'); if (pUser) pUser.style.background = primary;
        const pHeader = document.getElementById('preview-header'); if (pHeader) pHeader.style.background = bubble;
    },

    syncHexInput: function(key, val) {
        if (!/^#[0-9A-Fa-f]{0,6}$/.test(val)) return;
        const picker = document.getElementById(`${key}-picker`);
        if (picker && val.length === 7) { picker.value = val; app.previewTheme(); }
    },

    saveTheme: async function(btn) {
        if (!currentUser) return;
        const original = btn.textContent;
        btn.textContent = 'Saving...';
        btn.disabled = true;
        const primary = document.getElementById('theme-primary-picker')?.value || '#c0c1ff';
        const bg = document.getElementById('theme-bg-picker')?.value || '#0e0e1a';
        const bubble = document.getElementById('theme-bubble-picker')?.value || '#1e1e32';
        try {
            await window.owlDb.saveTheme(currentUser.id, { theme_primary: primary, theme_bg: bg, theme_chat_bubble: bubble });
            // Apply primary to current dashboard
            document.documentElement.style.setProperty('--primary', primary);
            if (window.OwlModal) OwlModal.alert('Theme Saved', 'Your brand colors have been saved and will appear in your customer chat widget.');
        } catch(e) {
            if (window.OwlModal) OwlModal.alert('Error', 'Could not save theme. Please try again.');
        }
        btn.textContent = original;
        btn.disabled = false;
    },

    resetTheme: async function() {
        if (!currentUser) return;
        const defaults = { theme_primary: '#c0c1ff', theme_bg: '#0e0e1a', theme_chat_bubble: '#1e1e32' };
        const pp = document.getElementById('theme-primary-picker'); if (pp) pp.value = defaults.theme_primary;
        const bp = document.getElementById('theme-bg-picker'); if (bp) bp.value = defaults.theme_bg;
        const bup = document.getElementById('theme-bubble-picker'); if (bup) bup.value = defaults.theme_chat_bubble;
        const ph = document.getElementById('theme-primary-hex'); if (ph) ph.value = defaults.theme_primary;
        const bh = document.getElementById('theme-bg-hex'); if (bh) bh.value = defaults.theme_bg;
        const buh = document.getElementById('theme-bubble-hex'); if (buh) buh.value = defaults.theme_chat_bubble;
        app.previewTheme();
        try {
            await window.owlDb.saveTheme(currentUser.id, defaults);
            document.documentElement.style.setProperty('--primary', defaults.theme_primary);
            if (window.OwlModal) OwlModal.alert('Reset', 'Theme reset to defaults.');
        } catch(e) { console.error('Reset theme error:', e); }
    },

    applyCustomizationLock: function() {
        const lock = document.getElementById('customization-pro-lock');
        if (!lock) return;
        lock.style.display = app._isPro ? 'none' : 'flex';
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

            const verifiedBadgeEl = document.getElementById('settings-verified-badge');
            const verifiedBadgeEnabled = verifiedBadgeEl ? verifiedBadgeEl.checked : true;

            const removeBrandingEl = document.getElementById('settings-remove-branding');
            const removeBrandingEnabled = removeBrandingEl ? removeBrandingEl.checked : false;

            await window.owlDb.updateBusinessSettings(user.id, {
                name: businessName || `${firstName} ${lastName}`,
                username: username || null,
                verified_badge_enabled: verifiedBadgeEnabled,
                remove_branding: removeBrandingEnabled
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

        const url = document.getElementById('settings-url')?.value || '';
        const instructions = document.getElementById('settings-instructions')?.value || '';
        const bookingUrl = document.getElementById('settings-booking-url')?.value || '';

        try {
            const clerk = await window.owlAuth.getSession();
            const businessId = clerk.user.id;

            await window.owlDb.updateBusinessSettings(businessId, {
                website_url: url,
                ai_instructions: instructions,
                booking_url: bookingUrl,
                name: document.getElementById('settings-business-name')?.value || clerk.user.fullName || ''
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
            const { data: logs } = await supabase.from('chat_logs').select('id, role, session_id, created_at').eq('business_id', businessId);
            
            // Helper to get local date string YYYY-MM-DD
            const getLocalDateString = (d) => new Date(d).toLocaleDateString('en-CA');
            const todayStr = getLocalDateString(new Date());

            // 1. Calculate Today's Stats
            const todayLogs = (logs || []).filter(l => getLocalDateString(l.created_at) === todayStr);
            const todayBookings = (bookings || []).filter(b => getLocalDateString(b.booking_time || b.created_at) === todayStr);

            const aiMessagesToday = todayLogs.filter(l => l.role === 'bot').length;
            const totalSessionsToday = new Set(todayLogs.map(l => l.session_id)).size;
            const timeSavedToday = Math.round((aiMessagesToday * 2) / 60); // 2 mins per AI message
            
            // Render Today's Stats
            if(document.getElementById('stat-bookings')) document.getElementById('stat-bookings').innerText = todayBookings.length;
            if(document.getElementById('stat-sessions')) document.getElementById('stat-sessions').innerText = totalSessionsToday;
            if(document.getElementById('stat-messages')) document.getElementById('stat-messages').innerText = aiMessagesToday;
            if(document.getElementById('stat-time-saved')) document.getElementById('stat-time-saved').innerText = `${timeSavedToday} hrs`;
            
            // Mobile (if they exist)
            if(document.getElementById('stat-messages-mobile')) document.getElementById('stat-messages-mobile').innerText = aiMessagesToday;
            if(document.getElementById('stat-time-saved-mobile')) document.getElementById('stat-time-saved-mobile').innerText = `${timeSavedToday} hrs`;

            // 2. Prepare 7-Day Chart Data
            const labels = [];
            const dataLeads = [];
            const dataSessions = [];
            const dataMessages = [];
            const dataTimeSaved = [];

            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dateStr = getLocalDateString(d);
                const shortLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
                labels.push(shortLabel);

                const dayLogs = (logs || []).filter(l => getLocalDateString(l.created_at) === dateStr);
                const dayBookings = (bookings || []).filter(b => getLocalDateString(b.booking_time || b.created_at) === dateStr);

                const dayAiMessages = dayLogs.filter(l => l.role === 'bot').length;
                dataLeads.push(dayBookings.length);
                dataSessions.push(new Set(dayLogs.map(l => l.session_id)).size);
                dataMessages.push(dayAiMessages);
                dataTimeSaved.push(Math.round((dayAiMessages * 2) / 60));
            }

            // 3. Render Chart.js Charts
            const renderChart = (id, color, data) => {
                const canvas = document.getElementById(id);
                if (!canvas) return;
                const ctx = canvas.getContext('2d');
                if (window[`chart_${id}`]) window[`chart_${id}`].destroy();
                
                window[`chart_${id}`] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: data,
                            borderColor: color,
                            backgroundColor: color + '20',
                            borderWidth: 2,
                            pointRadius: 0,
                            fill: true,
                            tension: 0.4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false }, tooltip: { enabled: false } },
                        scales: {
                            x: { display: false },
                            y: { display: false, min: 0 }
                        },
                        layout: { padding: 0 }
                    }
                });
            };

            renderChart('chart-leads', '#526bf5', dataLeads);
            renderChart('chart-sessions', '#22c55e', dataSessions);
            renderChart('chart-messages', '#f59e0b', dataMessages);
            renderChart('chart-time-saved', '#ec4899', dataTimeSaved);

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
                    fullText += pageText + "\n\n";
                    if(fullText.length > 5000) break; // Limit to 5000 chars to avoid prompt bloat
                }

                const docKnowledge = "\n\n--- UPLOADED DOCUMENT KNOWLEDGE ---\n" + fullText.substring(0, 5000) + "\n-----------------------------------";
                if(instEl) {
                    if(!instEl.value.includes("--- UPLOADED DOCUMENT KNOWLEDGE ---")) {
                        instEl.value = instEl.value + docKnowledge;
                    } else {
                        instEl.value = instEl.value.replace(/--- UPLOADED DOCUMENT KNOWLEDGE ---[\s\S]*-----------------------------------/, docKnowledge.trim());
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

    // --- Paystack Integration ---
    initiatePaystackCheckout: async function(options = {}) {
        if (!currentUser) return;
        
        let userCountry = localStorage.getItem('owl_assist_country') || 'US';
        let currency = userCountry === 'NG' ? 'NGN' : 'USD';
        
        // Fix for amount depending on currency
        let amountValue;
        if (options.amount) {
            // Backward compatibility
            amountValue = options.amount;
        } else if (options.ngnAmount && options.usdAmount) {
            amountValue = userCountry === 'NG' ? options.ngnAmount : options.usdAmount;
        } else {
            // Default to Pro Upgrade pricing if not specified
            amountValue = userCountry === 'NG' ? 15999 * 100 : 19.99 * 100;
        }
        
        let action = options.action || 'upgrade_pro';
        let bundleAmount = options.bundleAmount || 0;
        
        // Force test key to NGN if USD is not allowed by Paystack on this test key
        // For now, let's keep it dynamic but log it
        console.log(`Starting Paystack checkout for ${currency} ${amountValue/100}`);

        const handler = PaystackPop.setup({
            key: 'pk_test_96ed56610d64b80ed020559feae1f8d5957890bd', // Paystack Publishable Test Key
            email: currentUser.primaryEmailAddress?.emailAddress || 'support@owlassist.app',
            amount: amountValue,
            currency: currency,
            ref: 'OWL_' + Math.floor((Math.random() * 1000000000) + 1),
            metadata: {
                custom_fields: [
                    { display_name: "Business ID", variable_name: "business_id", value: currentUser.id },
                    { display_name: "Action", variable_name: "action", value: action },
                    { display_name: "Bundle Amount", variable_name: "bundle_amount", value: bundleAmount }
                ]
            },
            callback: function(response){
                const btnId = action === 'upgrade_pro' ? 'btn-upgrade-pro' : null; // Dynamic button if needed
                const btn = btnId ? document.getElementById(btnId) : null;
                
                if(btn) {
                   btn.innerText = 'Verifying...';
                   btn.disabled = true;
                } else if (window.OwlModal) {
                   // Show a loader modal if no specific button
                   OwlModal.alert('Verifying', 'Please wait while we confirm your payment...');
                }
                
                fetch('https://fensjqscutikgccajwkh.supabase.co/functions/v1/paystack-verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reference: response.reference, business_id: currentUser.id })
                })
                .then(res => res.json())
                .then(data => {
                    if(data.success) {
                        const successMsg = action === 'buy_credits' ? `Successfully added ${bundleAmount} credits!` : 'Upgrade successful! You are now a Pro user.';
                        if (window.OwlModal) OwlModal.alert('Success', successMsg);
                        else alert(successMsg);
                        setTimeout(() => window.location.reload(), 2000);
                    } else {
                        if (window.OwlModal) OwlModal.alert('Error', 'Verification failed: ' + data.error);
                        else alert('Verification failed: ' + data.error);
                        if(btn) { btn.innerText = 'Upgrade Now'; btn.disabled = false; }
                    }
                })
                .catch(err => {
                    if (window.OwlModal) OwlModal.alert('Error', 'Verification error: ' + err.message);
                    else alert('Verification error: ' + err.message);
                    if(btn) { btn.innerText = 'Upgrade Now'; btn.disabled = false; }
                });
            },
            onClose: function(){
                console.log('Payment modal closed');
            }
        });
        handler.openIframe();
    }

};

// --- Centralized Feature Registry ---
window.OwlFeatures = {
    features: {
        // type:'widget_section' handles both hiding the overlay AND unlocking the content div
        'widget_setup': { tier: 'pro', type: 'widget_section', overlaySelector: '#widget-pro-overlay', contentSelector: '#widget-content' },
        'document_upload_desktop': { tier: 'pro', type: 'disable_input', selector: '#settings-document-upload' },
        'document_upload_mobile': { tier: 'pro', type: 'disable_input', selector: '#settings-document-upload-mobile' },
        'remove_branding': { tier: 'pro', type: 'disable_input', selector: '#settings-remove-branding' },
        'settings_url': { tier: 'pro', type: 'disable_input', selector: '#settings-url' }
    },
    
    applyAccessControl: function(userTier, expiryDate) {
        // Enforce expiry logic
        let effectiveTier = userTier;
        if (userTier === 'pro' && expiryDate) {
            const expiry = new Date(expiryDate);
            if (new Date() > expiry) {
                effectiveTier = 'free'; // Sub expired — revert to free
            }
        }
        
        const isPro = effectiveTier === 'pro';

        // Update Billing UI Text (all elements with id current-plan-name, covers desktop + mobile)
        document.querySelectorAll('#current-plan-name').forEach(el => {
            el.innerText = isPro ? 'Pro Plan' : 'Free Trial';
        });
        
        // Update billing card buttons — show correct "Current Plan" on the right card
        document.querySelectorAll('#btn-free-current-plan').forEach(btn => {
            if (isPro) {
                btn.style.display = 'none'; // Hide "Current Plan" on Free card for Pro users
            } else {
                btn.style.display = '';
                btn.innerText = 'Current Plan';
                btn.disabled = true;
            }
        });

        document.querySelectorAll('#btn-upgrade-pro-billing').forEach(btn => {
            if (isPro) {
                btn.innerText = '✓ Current Plan';
                btn.disabled = true;
                btn.classList.add('outline');
                btn.classList.remove('primary');
                btn.onclick = null;
                btn.style.display = '';
            } else {
                btn.innerText = 'Upgrade to Pro';
                btn.disabled = false;
                btn.classList.remove('outline');
                btn.classList.add('primary');
                btn.onclick = () => app.initiatePaystackCheckout();
            }
        });

        // Apply visual locks based on registry
        Object.entries(this.features).forEach(([key, config]) => {
            const isAllowed = isPro || config.tier === 'free';

            if (config.type === 'widget_section') {
                // Hide/show the lock overlay
                const overlay = document.querySelector(config.overlaySelector);
                if (overlay) overlay.style.display = isAllowed ? 'none' : 'flex';
                // Unlock/lock the content below
                const content = document.querySelector(config.contentSelector);
                if (content) {
                    if (isAllowed) {
                        content.classList.remove('locked');
                    } else {
                        content.classList.add('locked');
                    }
                }
            } else if (config.type === 'ui_overlay') {
                const elements = document.querySelectorAll(config.selector);
                elements.forEach(el => { el.style.display = isAllowed ? 'none' : 'flex'; });
            } else if (config.type === 'disable_input') {
                const elements = document.querySelectorAll(config.selector);
                elements.forEach(el => {
                    el.disabled = !isAllowed;
                    el.style.opacity = isAllowed ? '1' : '0.6';
                    if (isAllowed) {
                        el.style.cursor = (el.type === 'checkbox' || el.tagName === 'BUTTON' || el.tagName === 'LABEL') ? 'pointer' : 'text';
                    } else {
                        el.style.cursor = 'not-allowed';
                    }
                    if (!isAllowed && el.type === 'checkbox') {
                        el.checked = false;
                    }
                    const labelParent = el.closest('.btn') || el.closest('label');
                    if (labelParent) {
                        labelParent.style.opacity = isAllowed ? '1' : '0.6';
                        labelParent.style.cursor = isAllowed ? 'pointer' : 'not-allowed';
                        labelParent.title = isAllowed ? '' : 'Requires Pro Plan';
                    }
                });
            }
        });
    }
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

            const creditsEls = document.querySelectorAll('#ui-credits, .ui-credits');
            if (creditsEls.length > 0) {
                let planCredits = parseFloat(settings.credits || '0');
                let purchasedCredits = parseFloat(settings.purchased_credits || '0');
                
                // Ensure expired purchased credits are not shown in UI before DB updates it
                if (settings.purchased_credits_expires_at && new Date() > new Date(settings.purchased_credits_expires_at)) {
                    purchasedCredits = 0;
                }
                
                let totalCredits = planCredits + purchasedCredits;
                let displayStr = Number.isInteger(totalCredits) ? totalCredits.toString() : totalCredits.toFixed(1);
                
                creditsEls.forEach(el => { el.innerText = displayStr; });
            }

            const verifiedBadgeEl = document.getElementById('settings-verified-badge');
            if (verifiedBadgeEl) verifiedBadgeEl.checked = settings.verified_badge_enabled !== false;

            const removeBrandingEl = document.getElementById('settings-remove-branding');
            if (removeBrandingEl) removeBrandingEl.checked = settings.remove_branding === true;

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
            
            // Apply Centralized Access Control
            if (window.OwlFeatures && typeof window.OwlFeatures.applyAccessControl === 'function') {
                window.OwlFeatures.applyAccessControl(settings.subscription_tier, settings.subscription_expires_at);
            }

            // Store settings globally for theme picker access
            window._currentBusinessSettings = settings;

            // Track pro status for FAQ limits and customization lock
            const now = new Date();
            app._isPro = settings.subscription_tier === 'pro' &&
                (!settings.subscription_expires_at || new Date(settings.subscription_expires_at) > now);

            // Load FAQs into state
            app._faqs = Array.isArray(settings.faqs) ? settings.faqs : [];

            // Apply saved custom theme colors if Pro
            if (app._isPro && settings.theme_primary) {
                document.documentElement.style.setProperty('--primary', settings.theme_primary);
            }
        }

        const bookings = await window.owlDb.fetchBookings(businessId);
        renderBookings(bookings);
        app.loadAnalytics(businessId, bookings);
        // Mobile sparkline — only runs on dashboard-mobile.html where the fn is defined
        if (typeof window.buildSparklineFromBookings === 'function') {
            window.buildSparklineFromBookings(bookings);
        }

        if (typeof window.app.loadNotifications === 'function') {
            await window.app.loadNotifications();
        }

        // Fetch customers to map short_id
        const supabase = await window.owlDb.getSupabase();
        let customersMap = {};
        if (supabase) {
            const { data: cData } = await supabase.from('customers').select('email, short_id').eq('business_id', businessId);
            if (cData) {
                cData.forEach(c => {
                    if (c.email) customersMap[c.email.toLowerCase()] = c.short_id;
                });
            }
        }
        window.app.customersMap = customersMap;

        const sessions = await window.owlDb.fetchChatSessions(businessId);
        renderStats(bookings, sessions);
        renderConversations(sessions);

        // Setup real-time listener for incoming messages to highlight new conversations/messages
        if (supabase) {
            if (window.app.globalLogsChannel) {
                window.app.globalLogsChannel.unsubscribe();
            }
            window.app.globalLogsChannel = supabase.channel(`global_logs_${businessId}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_logs', filter: `business_id=eq.${businessId}` }, async (payload) => {
                    const log = payload.new;
                    if (log.role === 'user') {
                        // If we are currently viewing this session, mark it read immediately
                        if (window.app.currentSessionId === log.session_id) {
                            try {
                                await window.owlDb.markSessionAsRead(log.session_id, businessId);
                            } catch(e) {
                                console.error(e);
                            }
                            return;
                        }
                        
                        // Otherwise, re-fetch sessions to update unread badges on the sidebar in real time!
                        const updated = await window.owlDb.fetchChatSessions(businessId);
                        renderConversations(updated);
                    }
                })
                .subscribe();
        }

    } catch (err) {
        console.error("Cloud data fetch error:", err);
    }
}

window.app.fetchRecentConversations = async function() {
    if (!currentUser) return;
    try {
        const sessions = await window.owlDb.fetchChatSessions(currentUser.id);
        renderConversations(sessions);
    } catch (err) {
        console.error("Error fetching recent conversations:", err);
    }
};

function renderStats(bookings, sessions = []) {
    // statBookings and statSessions are now handled daily in loadAnalytics
    const statStatus = document.getElementById('stat-status');
    if (statStatus) statStatus.innerText = 'Active';
}

function renderBookings(bookings) {
    // 1. Separate Leads from Confirmed Appointments
    const leads = bookings.filter(b => b.status !== 'chat' && b.status !== 'confirmed');
    const appointments = bookings.filter(b => b.status === 'confirmed');

    // --- RENDER LEADS ---
    const allList       = document.getElementById('all-bookings-list');
    const allLeadsList  = document.getElementById('all-leads-list');     // All Leads view (mobile)
    const allLeadsEmpty = document.getElementById('all-leads-empty');    // Empty state (mobile)

    if (allList)      allList.innerHTML = '';
    if (allLeadsList) allLeadsList.innerHTML = '';

    if (leads.length === 0) {
        // Show empty states
        ['all-bookings-empty'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });
        if (allLeadsEmpty) allLeadsEmpty.style.display = '';
        // Hide desktop tables
        ['all-bookings-table'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    } else {
        // Hide empty states when there are leads
        ['all-bookings-empty'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        if (allLeadsEmpty) allLeadsEmpty.style.display = 'none';
        ['all-bookings-table'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });

        leads.forEach((booking, idx) => {
            const dateObj = new Date(booking.booking_time);
            const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const cEmail = (booking.customer_email || '').toLowerCase();
            const shortId = window.app.customersMap && window.app.customersMap[cEmail] ? window.app.customersMap[cEmail] : '';
            const nameDisplay = shortId ? `${booking.name || booking.customer_name || 'Anonymous'} <span style="font-size:0.75rem; color:var(--text-dim); background:rgba(255,255,255,0.1); padding:0.1rem 0.4rem; border-radius:4px; margin-left:0.3rem;">${shortId}</span>` : (booking.name || booking.customer_name || 'Anonymous');

            const rowHtml = `
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                <td data-label="Contact">
                  <div style="font-weight:600; color: white;">${nameDisplay}</div>
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

            if (allList) allList.innerHTML += rowHtml;

            const buildMobileCard = () => {
                const card = document.createElement('div');
                card.className = 'mobile-lead-card';
                card.innerHTML = `
                    <div class="card-header">
                        <div class="card-title">${nameDisplay}</div>
                        <span class="status-badge status-${booking.status || 'new'}">${booking.status || 'new'}</span>
                    </div>
                    <p class="summary">${booking.summary || booking.service_name || 'No summary available'}</p>
                    <div class="meta">
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
                        <button onclick="app.updateLeadStatusPrompt('${booking.id}', '${booking.status}')" class="btn-small">
                            <span class="material-symbols-outlined">edit</span> Status
                        </button>
                    </div>
                `;
                return card;
            };

            if (allLeadsList) allLeadsList.appendChild(buildMobileCard());
        });
    }

    // --- RENDER BOOKED SLOTS (APPOINTMENTS) ---
    const recentList = document.getElementById('recent-bookings-list'); // Used for Overview Appointments
    const mobileList = document.getElementById('mobile-leads-list');    // Used for Overview Appointments mobile
    
    const appList = document.getElementById('all-appointments-list');
    const appTable = document.getElementById('all-appointments-table');
    const appEmpty = document.getElementById('all-appointments-empty');
    const appMobileList = document.getElementById('all-appointments-mobile-list');
    const appMobileEmpty = document.getElementById('all-appointments-mobile-empty');

    if (recentList) recentList.innerHTML = '';
    if (mobileList) mobileList.innerHTML = '';
    if (appList) appList.innerHTML = '';
    if (appMobileList) appMobileList.innerHTML = '';

    if (appointments.length === 0) {
        ['recent-bookings-empty', 'all-appointments-empty'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });
        ['recent-bookings-table', 'all-appointments-table'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        if (appMobileEmpty) appMobileEmpty.style.display = '';
    } else {
        ['recent-bookings-empty', 'all-appointments-empty'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        ['recent-bookings-table', 'all-appointments-table'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });
        if (appMobileEmpty) appMobileEmpty.style.display = 'none';

        appointments.forEach((booking, idx) => {
            const dateObj = new Date(booking.booking_time);
            const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const cEmail = (booking.customer_email || '').toLowerCase();
            const shortId = window.app.customersMap && window.app.customersMap[cEmail] ? window.app.customersMap[cEmail] : '';
            const nameDisplay = shortId ? `${booking.customer_name || 'Anonymous'} <span style="font-size:0.75rem; color:var(--text-dim); background:rgba(255,255,255,0.1); padding:0.1rem 0.4rem; border-radius:4px; margin-left:0.3rem;">${shortId}</span>` : (booking.customer_name || 'Anonymous');

            const rowHtml = `
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                <td data-label="Client">
                  <div style="font-weight:600; color: white;">${nameDisplay}</div>
                  <div style="font-size:0.75rem; color:var(--text-dim); margin-top: 0.15rem;">Email: ${booking.customer_email || '--'}</div>
                  <div style="font-size:0.75rem; color:var(--text-dim)">Phone: ${booking.phone || '--'}</div>
                </td>
                <td data-label="Appt Time" style="font-size: 0.85rem; color: white; font-weight: 500;">
                  ${dateStr}
                </td>
                <td data-label="Reason/Intent">
                   <span style="font-size: 0.85rem; color: var(--text-dim); font-weight: 500;">${booking.service_name || 'Premium Session'}</span>
                </td>
                <td data-label="Status"><span class="status-badge status-confirmed">Confirmed</span></td>
                <td style="text-align: center;">
                   <div class="action-dropdown" style="display: inline-block;">
                      <button class="btn-icon action-trigger" onclick="event.stopPropagation(); this.nextElementSibling.classList.toggle('active')">
                        <span class="material-symbols-outlined">more_vert</span>
                      </button>
                      <div class="action-menu" style="right: 0;">
                        ${booking.session_id ? `
                        <div class="action-item" onclick="app.viewConversation('${booking.session_id}')">
                          <span class="material-symbols-outlined">forum</span>
                          View Chat
                        </div>
                        ` : ''}
                        <div class="action-item" style="color: var(--error);" onclick="app.cancelBookingSlot('${booking.id}', '')">
                          <span class="material-symbols-outlined">cancel</span>
                          Cancel Booking
                        </div>
                      </div>
                   </div>
                </td>
              </tr>
            `;

            if (idx < 5 && recentList) recentList.innerHTML += rowHtml;
            if (appList) appList.innerHTML += rowHtml;

            const buildMobileCard = () => {
                const card = document.createElement('div');
                card.className = 'mobile-lead-card';
                card.innerHTML = `
                    <div class="card-header">
                        <div class="card-title">${nameDisplay}</div>
                        <span class="status-badge status-confirmed">Confirmed</span>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 0.25rem;">
                       <div>Email: ${booking.customer_email || '--'}</div>
                       <div>Phone: ${booking.phone || '--'}</div>
                    </div>
                    <p class="summary" style="margin-top: 0.5rem; font-weight: 500;">Intent: ${booking.service_name || 'Premium Session'}</p>
                    <div class="meta">
                        <span>
                            <span class="material-symbols-outlined">schedule</span>
                            ${dateStr}
                        </span>
                    </div>
                    <div class="card-actions">
                        ${booking.session_id ? `
                        <button onclick="app.viewConversation('${booking.session_id}')" class="btn-small">
                            <span class="material-symbols-outlined">forum</span> Chat
                        </button>
                        ` : ''}
                        <button onclick="app.cancelBookingSlot('${booking.id}', '')" class="btn-small" style="color: var(--error); border-color: rgba(239, 68, 68, 0.25);">
                            <span class="material-symbols-outlined">cancel</span> Cancel
                        </button>
                    </div>
                `;
                return card;
            };

            if (idx < 5 && mobileList) mobileList.appendChild(buildMobileCard());
            if (appMobileList) appMobileList.appendChild(buildMobileCard());
        });
    }
}

let expandedCustomerName = null;

async function renderConversations(sessions) {
    const sessionList = document.getElementById('session-list');
    if (!sessionList) return;
    sessionList.innerHTML = '';

    if (sessions.length === 0) {
        sessionList.innerHTML = '<div style="text-align: center; color: var(--text-dim); padding: 2rem;">No conversations yet.</div>';
        return;
    }

    // Group by customer_name
    const groups = {};
    sessions.forEach(session => {
        const name = session.customer_name || 'Anonymous Visitor';
        if (!groups[name]) groups[name] = [];
        groups[name].push(session);
    });

    Object.keys(groups).forEach(customerName => {
        const customerSessions = groups[customerName];
        
        // Sum unread messages for this customer
        const customerUnreadTotal = customerSessions.reduce((sum, s) => sum + (s.unread_count || 0), 0);
        
        // Find short_id from map
        const sampleS = customerSessions[0];
        const cEmail = (sampleS.customer_email || '').toLowerCase();
        const shortId = window.app.customersMap && window.app.customersMap[cEmail] ? window.app.customersMap[cEmail] : '';
        const nameDisplay = shortId ? `${customerName} <span style="font-size:0.7rem; color:var(--text-dim); background:rgba(255,255,255,0.1); padding:0.1rem 0.3rem; border-radius:3px; margin-left:0.3rem;">${shortId}</span>` : customerName;

        // Create a customer header/group container
        const groupContainer = document.createElement('div');
        groupContainer.style = 'margin-bottom: 0.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: rgba(255,255,255,0.01);';
        
        const header = document.createElement('div');
        header.style = 'padding: 0.75rem 1rem; background: rgba(255,255,255,0.03); display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background 0.2s;';
        
        const leftSide = document.createElement('div');
        leftSide.style = 'display: flex; align-items: center; gap: 0.5rem; font-weight: 700; font-size: 0.85rem; color: white;';
        leftSide.innerHTML = `<span class="material-symbols-outlined" style="font-size: 1.1rem; color: var(--primary);">person</span><span>${customerName}</span>`;
        header.appendChild(leftSide);

        const rightSide = document.createElement('div');
        rightSide.style = 'display: flex; align-items: center; gap: 0.5rem;';

        if (customerUnreadTotal > 0) {
            const unreadBadge = document.createElement('span');
            unreadBadge.style = 'background: #f43f5e; color: white; font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.4rem; border-radius: 9999px; line-height: 1;';
            unreadBadge.innerText = customerUnreadTotal;
            rightSide.appendChild(unreadBadge);
        }

        const arrow = document.createElement('span');
        arrow.className = 'material-symbols-outlined';
        arrow.style = 'font-size: 1.1rem; color: var(--text-dim); transition: transform 0.2s;';
        arrow.innerText = expandedCustomerName === customerName ? 'expand_less' : 'expand_more';
        rightSide.appendChild(arrow);

        header.appendChild(rightSide);
        groupContainer.appendChild(header);

        const subList = document.createElement('div');
        subList.style = `padding: 0.5rem; flex-direction: column; gap: 0.35rem; display: ${expandedCustomerName === customerName ? 'flex' : 'none'};`;

        customerSessions.forEach(session => {
            const date = new Date(session.created_at);
            const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const isTerminated = session.session_status === 'terminated';
            const statusBadge = isTerminated 
              ? `<span style="font-size: 0.6rem; padding: 0.05rem 0.3rem; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 0.4rem;">Ended</span>` 
              : `<span style="font-size: 0.6rem; padding: 0.05rem 0.3rem; background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 0.4rem;">Active</span>`;

            const item = document.createElement('div');
            item.className = 'session-item';
            if (isTerminated) {
                item.className += ' terminated';
            }
            const isSelected = window.app.currentSessionId === session.session_id;
            item.style = `padding: 0.65rem; background: rgba(255,255,255,0.02); border: 1px solid ${isSelected ? 'var(--primary)' : 'transparent'}; border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; justify-content: center;${isTerminated ? ' opacity: 0.75;' : ''}`;

            item.setAttribute('data-session-id', session.session_id);
            
            const sessionUnreadBadge = session.unread_count > 0 
              ? `<span style="background: #f43f5e; color: white; font-size: 0.6rem; font-weight: 700; padding: 0.05rem 0.3rem; border-radius: 9999px; margin-left: 0.25rem;">${session.unread_count}</span>`
              : '';

            item.innerHTML = `
              <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div style="font-weight: 600; font-size: 0.8rem; color: ${isTerminated ? 'var(--text-dim)' : 'white'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 135px; display: flex; align-items: center;">
                  ${session.summary || 'Chat Session'} ${sessionUnreadBadge}
                </div>
                ${statusBadge}
              </div>
              <div style="font-size: 0.65rem; color: var(--text-dim); margin-top: 0.15rem; text-align: right; width: 100%;">
                ${timeStr}
              </div>
            `;

            item.onclick = async (e) => {
                e.stopPropagation();

                // Optimistic UI update: hide unread badges immediately
                const sBadge = item.querySelector('span[style*="background: #f43f5e"]');
                if (sBadge) sBadge.style.display = 'none';

                const hBadge = groupContainer.querySelector('span[style*="background: #f43f5e"]');
                if (hBadge) {
                    const currentCount = parseInt(hBadge.innerText) || 0;
                    const sessionCount = session.unread_count || 0;
                    const newCount = Math.max(0, currentCount - sessionCount);
                    if (newCount === 0) {
                        hBadge.style.display = 'none';
                    } else {
                        hBadge.innerText = newCount;
                    }
                }

                document.querySelectorAll('.session-item').forEach(el => el.style.borderColor = 'transparent');
                item.style.borderColor = 'var(--primary)';
                window.app.currentSessionId = session.session_id;
                
                // Handle Mobile Layout Switch
                if (window.innerWidth <= 768) {
                    const sPanel = document.getElementById('session-panel');
                    const cPanel = document.getElementById('chat-panel');
                    if (sPanel) sPanel.classList.remove('panel-active');
                    if (cPanel) cPanel.classList.add('panel-active');
                }

                if (typeof app.showChatPanel === 'function') app.showChatPanel();

                await loadTranscript(session.session_id, customerName, session.summary || 'Chat Session', timeStr, session.session_status);
            };

            subList.appendChild(item);
        });

        header.onclick = () => {
            expandedCustomerName = expandedCustomerName === customerName ? null : customerName;
            renderConversations(sessions);
        };

        groupContainer.appendChild(subList);
        sessionList.appendChild(groupContainer);
    });
}

async function loadTranscript(sessionId, name, summary, timeStr, sessionStatus = 'active') {
    const chatHeader = document.getElementById('chat-header');
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    const backBtn = `<button onclick="app.showSessionPanel()" class="mob-back-btn" style="margin-right:0.5rem;"><span class="material-symbols-outlined" style="font-size:1.2rem;">arrow_back_ios</span></button>`;

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
    
    chatMessages.innerHTML = '<div style="text-align: center; color: var(--text-dim); padding: 2rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;"><span class="material-symbols-outlined rotating" style="font-size: 1.2rem;">sync</span> Loading transcript...</div>';

    let logs;
    try {
        logs = await window.owlDb.fetchChatLogsForDashboard(sessionId);
        
        // Mark session as read
        await window.owlDb.markSessionAsRead(sessionId, currentUser.id);
        
        // Refresh sidebar unread counts silently
        const updatedSessions = await window.owlDb.fetchChatSessions(currentUser.id);
        renderConversations(updatedSessions);
    } catch (err) {
        console.error('❌ Transcript load failed:', err);
        chatMessages.innerHTML = '<div style="text-align:center; padding:2rem;"><span class="material-symbols-outlined" style="font-size:2.5rem; color:#ef4444; display:block; margin-bottom:0.75rem;">error_outline</span><p style="color:#ef4444; font-weight:600; margin-bottom:0.5rem;">Failed to load conversation</p><p style="color:var(--text-dim); font-size:0.85rem;">Please try again or refresh the page.</p></div>';
        return;
    }
    chatMessages.innerHTML = '';

    let hasHandoffActive = false;

    logs.forEach(log => {
        if (log.role === 'system') {
            if (log.content === 'HANDOFF_ACTIVE') hasHandoffActive = true;
            if (log.content === 'HANDOFF_INACTIVE') hasHandoffActive = false;
            
            if (log.content.startsWith('[SYSTEM: User submitted lead form.') || log.content.startsWith('[SYSTEM: User booked slot.')) {
                const infoDiv = document.createElement('div');
                infoDiv.className = 'system-info-bubble';
                let cleanText = log.content.replace('[SYSTEM: ', '').replace(']', '');
                cleanText = cleanText.replace(/Name: /g, '<strong>Name:</strong> ')
                                     .replace(/Email: /g, '<br><strong>Email:</strong> ')
                                     .replace(/Phone: /g, '<br><strong>Phone:</strong> ')
                                     .replace(/Inquiry: /g, '<br><strong>Inquiry:</strong> ')
                                     .replace(/Time: /g, '<br><strong>Time:</strong> ')
                                     .replace(/Service: /g, '<br><strong>Service:</strong> ');
                
                infoDiv.style = "margin: 1rem auto; padding: 0.75rem 1rem; background: rgba(82, 107, 245, 0.08); border: 1px dashed var(--primary); border-radius: 0.5rem; font-size: 0.8rem; color: #a5b4fc; max-width: 90%; text-align: left; line-height: 1.5;";
                infoDiv.innerHTML = `<div style="font-weight: 700; color: white; margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.35rem;"><span class="material-symbols-outlined" style="font-size: 1.1rem; color: var(--primary);">info</span> ${log.content.includes('lead') ? 'Contact Details Submitted' : 'Appointment Booked'}</div>` + cleanText;
                chatMessages.appendChild(infoDiv);
            }
            return;
        }
        
        const isUser = log.role === 'user';
        const isOwner = log.role === 'owner';
        const isUnread = isUser && !log.is_read;
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user' : 'bot'}`;
        if (isOwner) {
            msgDiv.style.borderLeft = '4px solid var(--primary)';
            msgDiv.style.background = 'rgba(82, 107, 245, 0.05)';
        } else if (isUnread) {
            msgDiv.style.borderRight = '4px solid #f43f5e';
            msgDiv.style.background = 'rgba(244, 63, 94, 0.05)';
        }
        
        let label = '';
        if (!isUser) {
            label = `<div style="font-size: 0.65rem; color: var(--text-dim); margin-bottom: 0.2rem;">${isOwner ? 'You' : 'Noctra'}</div>`;
        }
        
        const unreadLabel = isUnread 
          ? `<div style="font-size: 0.6rem; color: #f43f5e; font-weight: 700; text-align: right; margin-top: 0.25rem;">● Unread</div>`
          : '';
        msgDiv.innerHTML = label + log.content + unreadLabel;
        chatMessages.appendChild(msgDiv);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;

    // --- Handoff UI Update ---
    const inputArea = document.getElementById('chat-input-area');
    const toggleBtn = document.getElementById('toggle-handoff-btn');
    const statusText = document.getElementById('handoff-status-text');
    const inputWrapper = document.getElementById('chat-input-wrapper');
    const ownerInput = document.getElementById('owner-chat-input');

    if (inputArea) {
        if (isTerminated) {
            inputArea.style.display = 'none';
            const suggestionsContainer = document.getElementById('copilot-suggestions-container');
            if (suggestionsContainer) suggestionsContainer.style.display = 'none';
        } else {
            inputArea.style.display = 'block';
            toggleBtn.checked = hasHandoffActive;
            
            // Set input disabled state based on toggle
            inputWrapper.style.opacity = hasHandoffActive ? '1' : '0.5';
            inputWrapper.style.pointerEvents = hasHandoffActive ? 'auto' : 'none';
            ownerInput.disabled = !hasHandoffActive;

            statusText.innerText = hasHandoffActive 
                ? 'You are replying. AI is paused.' 
                : 'AI is replying. Turn on to take over.';

            // Load suggestions if handoff is active
            if (hasHandoffActive) {
                window.app.loadCopilotSuggestions(sessionId);
            } else {
                const suggestionsContainer = document.getElementById('copilot-suggestions-container');
                if (suggestionsContainer) suggestionsContainer.style.display = 'none';
            }
        }
    }

    // Attach current sessionId for handoff functions to use
    window.app.currentSessionId = sessionId;

    // --- DEDICATED REALTIME CHANNEL FOR OPEN TRANSCRIPT ---
    const supabase = await window.owlDb.getSupabase();
    if (supabase) {
        if (window.app.transcriptChannel) {
            window.app.transcriptChannel.unsubscribe();
        }
        window.app.transcriptChannel = supabase.channel(`dashboard_transcript_${sessionId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_logs', filter: `session_id=eq.${sessionId}` }, (payload) => {
                const log = payload.new;
                
                // Skip system messages
                if (log.role === 'system') {
                    if (log.content === 'HANDOFF_ACTIVE' || log.content === 'HANDOFF_INACTIVE') {
                        const toggleBtn = document.getElementById('toggle-handoff-btn');
                        const statusText = document.getElementById('handoff-status-text');
                        const inputWrapper = document.getElementById('chat-input-wrapper');
                        const ownerInput = document.getElementById('owner-chat-input');
                        if (toggleBtn && inputWrapper && ownerInput) {
                            const isActive = log.content === 'HANDOFF_ACTIVE';
                            toggleBtn.checked = isActive;
                            inputWrapper.style.opacity = isActive ? '1' : '0.5';
                            inputWrapper.style.pointerEvents = isActive ? 'auto' : 'none';
                            ownerInput.disabled = !isActive;
                            if (statusText) statusText.innerText = isActive ? 'You are replying. AI is paused.' : 'AI is replying. Turn on to take over.';
                            
                            // Load suggestions if toggled on
                            const suggestionsContainer = document.getElementById('copilot-suggestions-container');
                            if (suggestionsContainer) {
                                if (isActive) {
                                    window.app.loadCopilotSuggestions(sessionId);
                                } else {
                                    suggestionsContainer.style.display = 'none';
                                }
                            }
                        }
                    }
                    if (log.content.startsWith('[SYSTEM: User submitted lead form.') || log.content.startsWith('[SYSTEM: User booked slot.')) {
                        const chatMessages = document.getElementById('chat-messages');
                        if (chatMessages) {
                            const infoDiv = document.createElement('div');
                            infoDiv.className = 'system-info-bubble';
                            let cleanText = log.content.replace('[SYSTEM: ', '').replace(']', '');
                            cleanText = cleanText.replace(/Name: /g, '<strong>Name:</strong> ')
                                                 .replace(/Email: /g, '<br><strong>Email:</strong> ')
                                                 .replace(/Phone: /g, '<br><strong>Phone:</strong> ')
                                                 .replace(/Inquiry: /g, '<br><strong>Inquiry:</strong> ')
                                                 .replace(/Time: /g, '<br><strong>Time:</strong> ')
                                                 .replace(/Service: /g, '<br><strong>Service:</strong> ');
                            
                            infoDiv.style = "margin: 1rem auto; padding: 0.75rem 1rem; background: rgba(82, 107, 245, 0.08); border: 1px dashed var(--primary); border-radius: 0.5rem; font-size: 0.8rem; color: #a5b4fc; max-width: 90%; text-align: left; line-height: 1.5;";
                            infoDiv.innerHTML = `<div style="font-weight: 700; color: white; margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.35rem;"><span class="material-symbols-outlined" style="font-size: 1.1rem; color: var(--primary);">info</span> ${log.content.includes('lead') ? 'Contact Details Submitted' : 'Appointment Booked'}</div>` + cleanText;
                            chatMessages.appendChild(infoDiv);
                            chatMessages.scrollTop = chatMessages.scrollHeight;
                        }
                    }
                    return;
                }

                // Avoid duplicating our own owner messages (they are optimistically added)
                if (log.role === 'owner') return;

                const chatMessages = document.getElementById('chat-messages');
                if (!chatMessages) return;

                const isUser = log.role === 'user';
                const msgDiv = document.createElement('div');
                msgDiv.className = `message ${isUser ? 'user' : 'bot'}`;
                let label = '';
                if (!isUser) {
                    label = `<div style="font-size: 0.65rem; color: var(--text-dim); margin-bottom: 0.2rem;">Noctra</div>`;
                }
                msgDiv.innerHTML = label + log.content;
                chatMessages.appendChild(msgDiv);
                chatMessages.scrollTop = chatMessages.scrollHeight;

                // Load suggestions on new user message if handoff is active
                if (isUser) {
                    const toggleBtn = document.getElementById('toggle-handoff-btn');
                    if (toggleBtn && toggleBtn.checked) {
                        window.app.loadCopilotSuggestions(sessionId);
                    }
                }
            })
            .subscribe();
    }
}

window.app.handleToggleHandoff = async function(checkbox) {
    if (!window.app.currentSessionId || !currentUser) return;
    const isActive = checkbox.checked;
    
    const inputWrapper = document.getElementById('chat-input-wrapper');
    const ownerInput = document.getElementById('owner-chat-input');
    const statusText = document.getElementById('handoff-status-text');

    // Optimistic UI update
    inputWrapper.style.opacity = isActive ? '1' : '0.5';
    inputWrapper.style.pointerEvents = isActive ? 'auto' : 'none';
    ownerInput.disabled = !isActive;
    statusText.innerText = isActive 
        ? 'You are replying. AI is paused.' 
        : 'AI is replying. Turn on to take over.';

    try {
        await window.owlDb.toggleHandoff(window.app.currentSessionId, currentUser.id, isActive);
        
        // Show/hide copilot suggestions
        const suggestionsContainer = document.getElementById('copilot-suggestions-container');
        if (suggestionsContainer) {
            if (isActive) {
                window.app.loadCopilotSuggestions(window.app.currentSessionId);
            } else {
                suggestionsContainer.style.display = 'none';
            }
        }
    } catch (err) {
        console.error("Error toggling handoff:", err);
        if (window.OwlModal) OwlModal.alert('Error', 'Failed to toggle handoff. Please try again.');
        checkbox.checked = !isActive; // Revert
        app.handleToggleHandoff(checkbox); // Re-run to fix UI
    }
};

window.app.handleSendOwnerMessage = async function() {
    if (!window.app.currentSessionId || !currentUser) return;
    const input = document.getElementById('owner-chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = ''; // clear input

    // Optimistic UI insert
    const chatMessages = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message bot`;
    msgDiv.style.borderLeft = '4px solid var(--primary)';
    msgDiv.style.background = 'rgba(82, 107, 245, 0.05)';
    msgDiv.innerHTML = `<div style="font-size: 0.65rem; color: var(--text-dim); margin-bottom: 0.2rem;">You</div>${text}`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const ownerName = currentUser.fullName || currentUser.username || "Business Owner";
        await window.owlDb.sendOwnerMessage(window.app.currentSessionId, currentUser.id, text, ownerName);
    } catch (err) {
        console.error("Error sending message:", err);
        if (window.OwlModal) OwlModal.alert('Error', 'Failed to send message.');
    }
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
            if (user.hasImage && user.imageUrl) {
                el.innerHTML = `<img src="${user.imageUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            } else {
                el.innerText = displayName[0]?.toUpperCase() || 'B';
            }
        };
        document.querySelectorAll('.ui-avatar').forEach(updateAvatar);
        updateAvatar(document.getElementById('ui-avatar'));

        // Also update the settings page avatar preview
        const settingsPreview = document.getElementById('settings-avatar-preview');
        if (settingsPreview) {
            if (user.hasImage && user.imageUrl) {
                settingsPreview.innerHTML = `<img src="${user.imageUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            } else {
                settingsPreview.innerText = displayName[0]?.toUpperCase() || 'B';
            }
        }

        // Prepopulate Settings
        const fn = document.getElementById('settings-first-name');
        if (fn) fn.value = user.firstName || '';
        const ln = document.getElementById('settings-last-name');
        if (ln) ln.value = user.lastName || '';
        const bn = document.getElementById('settings-business-name');
        if (bn) bn.value = user.unsafeMetadata?.business_name || '';
        const un = document.getElementById('settings-username');
        if (un) un.value = user.unsafeMetadata?.business_username || user.username || '';

        // Silently sync profile picture to Supabase on every login so chat UI shows it too.
        // We do this fire-and-forget to not block the dashboard load.
        if (user.imageUrl && window.owlDb && typeof window.owlDb.syncImageUrl === 'function') {
            window.owlDb.syncImageUrl(user.id, user.imageUrl)
                .catch(e => console.warn('Background image sync skipped:', e.message));
        }
        
        // --- Avatar Upload Logic ---
        const avatarUpload = document.getElementById('settings-avatar-upload');
        if (avatarUpload) {
            // Remove any previously-bound listeners to prevent duplicates on re-init
            const newUpload = avatarUpload.cloneNode(true);
            avatarUpload.parentNode.replaceChild(newUpload, avatarUpload);

            newUpload.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const preview = document.getElementById('settings-avatar-preview');
                const originalContent = preview.innerHTML;

                try {
                    preview.innerHTML = '<span class="material-symbols-outlined rotating" style="font-size: 2rem;">sync</span>';
                    
                    // 1. Upload to Clerk
                    await user.setProfileImage({ file });

                    // 2. Reload the Clerk user to get the brand new imageUrl
                    await user.reload();
                    const freshImageUrl = user.imageUrl || '';

                    // 3. Sync the new image URL to Supabase via the secure edge function
                    if (freshImageUrl && currentUser?.id) {
                        await window.owlDb.syncImageUrl(currentUser.id, freshImageUrl);
                    }
                    
                    // 4. Refresh whole dashboard UI with fresh user data
                    await initDashboard();
                    if (window.OwlModal) OwlModal.alert('Success', 'Profile picture updated!');
                } catch (err) {
                    console.error('Avatar upload failed:', err);
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
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_logs', filter: `business_id=eq.${user.id}` }, (payload) => {
                        // Always refresh the session list sidebar
                        if (window.app && typeof window.app.fetchRecentConversations === 'function') {
                            window.app.fetchRecentConversations();
                        }
                    })
                    .subscribe();

                if (window.owlDb && window.owlDb.subscribeToNotifications) {
                    window.owlDb.subscribeToNotifications(user.id, (payload) => {
                        if (typeof window.app.loadNotifications === 'function') {
                            window.app.loadNotifications();
                        }
                    });
                }
            }
        }

    } catch (err) {
        console.error('Init dashboard error:', err);
    }
}

async function handleLogout() {
    await window.owlAuth.signOut();
}

// Global Close for Action Dropdowns and Notification Dropdown
window.addEventListener('click', (e) => {
    if (!e.target.closest('.action-dropdown')) {
        document.querySelectorAll('.action-menu.active').forEach(m => m.classList.remove('active'));
    }
    if (!e.target.closest('.notif-wrap') && !e.target.closest('.notif-dropdown') && !e.target.closest('.mob-notif-wrap')) {
        const notifDropdown = document.getElementById('notif-dropdown');
        if (notifDropdown) notifDropdown.style.display = 'none';
    }
});

// --- NOTIFICATIONS LOGIC ---
window.app.notifications = [];
window.app.loadNotifications = async function() {
    if (!currentUser || !window.owlDb) return;
    const data = await window.owlDb.fetchNotifications(currentUser.id);
    window.app.notifications = data || [];
    window.app.renderNotifications();
};

window.app.renderNotifications = function() {
    const unread = window.app.notifications.filter(n => !n.is_read).length;
    
    // Update Badges
    const deskBadge = document.getElementById('desk-notif-badge');
    const mobBadge = document.getElementById('mob-notif-badge');
    if (deskBadge) { deskBadge.textContent = unread; deskBadge.style.display = unread > 0 ? 'flex' : 'none'; }
    if (mobBadge) { mobBadge.textContent = unread; mobBadge.style.display = unread > 0 ? 'flex' : 'none'; }

    // Dropdown (max 5)
    const dropdownList = document.getElementById('notif-dropdown-list');
    if (dropdownList) {
        dropdownList.innerHTML = '';
        if (window.app.notifications.length === 0) {
            dropdownList.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-dim); font-size: 0.9rem;">No new notifications</div>`;
        } else {
            window.app.notifications.slice(0, 5).forEach(n => {
                const item = document.createElement('div');
                item.style.cssText = `padding: 1rem; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: background 0.2s; background: ${n.is_read ? 'transparent' : 'rgba(82, 107, 245, 0.1)'};`;
                item.innerHTML = `
                  <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.2rem; color: ${n.is_read ? 'var(--text-sub)' : 'white'};">${n.title}</div>
                  <div style="font-size: 0.8rem; color: var(--text-dim); line-height: 1.4;">${n.message}</div>
                `;
                item.onmouseover = () => item.style.background = 'rgba(255,255,255,0.05)';
                item.onmouseout = () => item.style.background = n.is_read ? 'transparent' : 'rgba(82, 107, 245, 0.1)';
                item.onclick = () => {
                    document.getElementById('notif-dropdown').style.display = 'none';
                    if (n.link) app.navigate(n.link.replace('#view-', ''));
                };
                dropdownList.appendChild(item);
            });
        }
    }

    // All Notifications View
    const allList = document.getElementById('all-notifs-list');
    const emptyState = document.getElementById('all-notifs-empty');
    if (allList && emptyState) {
        if (window.app.notifications.length === 0) {
            allList.style.display = 'none';
            emptyState.style.display = 'block';
        } else {
            allList.style.display = 'flex';
            emptyState.style.display = 'none';
            allList.innerHTML = '';
            window.app.notifications.forEach(n => {
                const item = document.createElement('div');
                item.style.cssText = `padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: ${n.is_read ? 'transparent' : 'rgba(82, 107, 245, 0.05)'}; cursor: pointer; transition: all 0.2s;`;
                item.innerHTML = `
                  <div>
                    <div style="font-weight: 600; font-size: 1rem; margin-bottom: 0.25rem; color: ${n.is_read ? 'var(--text-sub)' : 'white'};">${n.title}</div>
                    <div style="font-size: 0.85rem; color: var(--text-dim);">${n.message}</div>
                    <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.5rem; opacity: 0.7;">${new Date(n.created_at).toLocaleString()}</div>
                  </div>
                  <span class="material-symbols-outlined" style="color: var(--text-dim); font-size: 1.2rem;">chevron_right</span>
                `;
                item.onmouseover = () => { item.style.background = 'rgba(255,255,255,0.03)'; };
                item.onmouseout = () => { item.style.background = n.is_read ? 'transparent' : 'rgba(82, 107, 245, 0.05)'; };
                item.onclick = () => {
                    if (n.link) app.navigate(n.link.replace('#view-', ''));
                };
                allList.appendChild(item);
            });
        }
    }
};

window.app.toggleNotifications = function() {
    const dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;
    if (dropdown.style.display === 'none') {
        dropdown.style.display = 'block';
    } else {
        dropdown.style.display = 'none';
    }
};

window.app.markAllNotificationsRead = async function() {
    if (!currentUser || !window.owlDb) return;
    try {
        await window.owlDb.markNotificationsRead(currentUser.id);
        if (window.app.notifications) {
            window.app.notifications.forEach(n => n.is_read = true);
            window.app.renderNotifications();
        }
    } catch (e) {
        console.error('Failed to mark read', e);
    }
};

initDashboard();

// --- COPILOT SUGGESTIONS & NOCTRA ASSISTANT FEATURES ---
window.app.loadCopilotSuggestions = async function(sessionId) {
    const container = document.getElementById('copilot-suggestions-container');
    if (!container) return;
    
    const toggleBtn = document.getElementById('toggle-handoff-btn');
    if (!toggleBtn || !toggleBtn.checked) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    container.innerHTML = '<div style="color: var(--text-dim); font-size: 0.75rem; font-style: italic; display: flex; align-items: center; gap: 0.35rem;"><span class="material-symbols-outlined rotating" style="font-size: 0.9rem;">sync</span> Loading suggestions...</div>';
    
    try {
        const response = await fetch('/api/chat-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operation: 'generate_copilot_suggestions',
                session_id: sessionId,
                business_id: currentUser.id
            })
        });
        const suggestions = await response.json();
        
        container.innerHTML = '';
        if (Array.isArray(suggestions) && suggestions.length > 0) {
            suggestions.forEach(text => {
                const chip = document.createElement('div');
                chip.style.cssText = 'background: rgba(82, 107, 245, 0.08); border: 1px solid rgba(82, 107, 245, 0.25); color: var(--primary); padding: 0.35rem 0.75rem; border-radius: 12px; font-size: 0.75rem; cursor: pointer; transition: all 0.2s; white-space: nowrap; max-width: 250px; overflow: hidden; text-overflow: ellipsis; font-weight: 500;';
                chip.innerText = text;
                chip.title = text;
                chip.onmouseover = () => { chip.style.background = 'rgba(82, 107, 245, 0.15)'; chip.style.borderColor = 'var(--primary)'; };
                chip.onmouseout = () => { chip.style.background = 'rgba(82, 107, 245, 0.08)'; chip.style.borderColor = 'rgba(82, 107, 245, 0.25)'; };
                chip.onclick = () => {
                    const input = document.getElementById('owner-chat-input');
                    if (input) {
                        input.value = text;
                        input.focus();
                    }
                };
                container.appendChild(chip);
            });
        } else {
            container.style.display = 'none';
        }
    } catch (err) {
        console.error("Failed to load suggestions:", err);
        container.style.display = 'none';
    }
};

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
            formattedLines.push(`<div style="margin-left: 0.5rem; margin-bottom: 0.4rem; display: flex; align-items: flex-start; gap: 0.5rem;"><span style="color: var(--primary); font-weight: 700; flex-shrink: 0;">${num}.</span><div style="flex: 1;">${content}</div></div>`);
        } else if (bulletMatch) {
            const content = bulletMatch[1].replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
            formattedLines.push(`<div style="margin-left: 0.5rem; margin-bottom: 0.35rem; display: flex; align-items: flex-start; gap: 0.5rem;"><span style="color: var(--primary); font-size: 1.1rem; line-height: 1; flex-shrink: 0;">•</span><div style="flex: 1; color: var(--text-sub);">${content}</div></div>`);
        } else {
            formattedLines.push(processedLine);
        }
    });
    
    let html = formattedLines.join('<br>');
    html = html.replace(/<\/div><br><div/g, '</div><div');
    html = html.replace(/<br><div/g, '<div');
    html = html.replace(/<\/div><br>/g, '</div>');

    const linkStyle = 'color: var(--primary); text-decoration: underline; font-weight: 600; cursor: pointer;';
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

window.app.assistantChatHistory = [];
window.app.currentCopilotSessionId = null;

window.app.loadAssistantSessions = async function() {
    const sessionListContainer = document.getElementById('copilot-session-list');
    if (!sessionListContainer) return;

    try {
        const supabase = await window.owlDb.getSupabase();
        
        // Fetch all copilot logs for this business.
        // IMPORTANT: business_id filter is required — anon RLS policy needs it.
        const { data: logs, error } = await supabase
            .from('chat_logs')
            .select('session_id, content, role, created_at')
            .eq('business_id', currentUser.id)
            .like('session_id', 'copilot_' + currentUser.id + '%')
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Group by session_id
        const sessions = {};
        (logs || []).forEach(log => {
            if (!sessions[log.session_id]) {
                sessions[log.session_id] = {
                    session_id: log.session_id,
                    title: 'New Chat',
                    created_at: new Date(log.created_at),
                    messages: []
                };
            }
            sessions[log.session_id].messages.push(log);
            if (log.role === 'user' && sessions[log.session_id].title === 'New Chat') {
                sessions[log.session_id].title = log.content.substring(0, 22) + (log.content.length > 22 ? '...' : '');
            }
        });

        // Convert to array and sort descending by newest message
        const sortedSessions = Object.values(sessions).sort((a, b) => {
            const aTime = a.messages.length > 0 ? new Date(a.messages[a.messages.length - 1].created_at) : a.created_at;
            const bTime = b.messages.length > 0 ? new Date(b.messages[b.messages.length - 1].created_at) : b.created_at;
            return bTime - aTime;
        });

        sessionListContainer.innerHTML = '';

        if (sortedSessions.length === 0) {
            sessionListContainer.innerHTML = `<div style="text-align: center; color: var(--text-dim); font-size: 0.8rem; padding: 1rem;">No previous chats</div>`;
            return;
        }

        if (!window.app.currentCopilotSessionId) {
            window.app.currentCopilotSessionId = sortedSessions[0].session_id;
        }

        sortedSessions.forEach(session => {
            const isActive = session.session_id === window.app.currentCopilotSessionId;
            const btn = document.createElement('div');
            btn.style.cssText = `
                padding: 0.65rem 0.75rem;
                border-radius: var(--radius-sm);
                cursor: pointer;
                font-size: 0.8rem;
                color: ${isActive ? 'white' : 'var(--text-sub)'};
                background: ${isActive ? 'rgba(255,255,255,0.08)' : 'transparent'};
                border: 1px solid ${isActive ? 'var(--border)' : 'transparent'};
                display: flex;
                align-items: center;
                gap: 0.5rem;
                transition: all 0.2s;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            
            btn.onmouseover = () => {
                if (!isActive) btn.style.background = 'rgba(255,255,255,0.03)';
            };
            btn.onmouseout = () => {
                if (!isActive) btn.style.background = 'transparent';
            };
            
            btn.onclick = () => app.switchCopilotSession(session.session_id);
            
            btn.innerHTML = `
                <span class="material-symbols-outlined" style="font-size: 1rem; color: var(--primary);">chat_bubble</span>
                <span>${session.title}</span>
            `;
            sessionListContainer.appendChild(btn);
        });

    } catch (err) {
        console.error("Failed to load assistant sessions:", err);
    }
};

window.app.startNewCopilotSession = function() {
    const newSessionId = 'copilot_' + currentUser.id + '_' + Date.now();
    window.app.currentCopilotSessionId = newSessionId;
    window.app.assistantChatHistory = [];
    
    // Clear chat pane and render backdrop watermark
    const messagesContainer = document.getElementById('assistant-messages');
    if (messagesContainer) {
        messagesContainer.innerHTML = `
          <div class="copilot-watermark" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); opacity: 0.45; text-align: center; pointer-events: none; user-select: none;">
            <img src="../assets/img/logo/logo.png" style="width: 4.5rem; height: 4.5rem; margin-bottom: 1.25rem; object-fit: contain; filter: drop-shadow(0 0 10px rgba(82, 107, 245, 0.45));" alt="Noctra Copilot Logo">
            <h2 style="font-size: 1.5rem; font-weight: 600; margin: 0; color: white;">welcome back</h2>
            <p style="font-size: 0.95rem; margin: 0.5rem 0 0 0;">How can i assist you today?</p>
          </div>
        `;
    }
    
    app.loadAssistantSessions();
};

window.app.switchCopilotSession = function(sessionId) {
    window.app.currentCopilotSessionId = sessionId;
    app.loadAssistantChat();
};

window.app.loadAssistantChat = async function() {
    const messagesContainer = document.getElementById('assistant-messages');
    if (!messagesContainer) return;

    try {
        const supabase = await window.owlDb.getSupabase();

        // Trigger learnings consolidation in the background silently
        fetch('/api/chat-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation: 'consolidate_learnings', business_id: currentUser.id })
        }).catch(err => console.error("Silent consolidation failed:", err));

        // Make sure we have loaded previous sessions at least once
        await app.loadAssistantSessions();

        const copilotSessionId = window.app.currentCopilotSessionId || ('copilot_' + currentUser.id + '_' + Date.now());
        window.app.currentCopilotSessionId = copilotSessionId;

        // Fetch logs for the active session.
        // IMPORTANT: business_id filter is required — anon RLS policy needs it.
        const { data: logs, error } = await supabase
            .from('chat_logs')
            .select('role, content, created_at')
            .eq('business_id', currentUser.id)
            .eq('session_id', copilotSessionId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        messagesContainer.innerHTML = '';
        
        // If no logs, insert watermark in background
        if (!logs || logs.length === 0) {
            messagesContainer.innerHTML = `
              <div class="copilot-watermark" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); opacity: 0.45; text-align: center; pointer-events: none; user-select: none;">
                <img src="../assets/img/logo/logo.png" style="width: 4.5rem; height: 4.5rem; margin-bottom: 1.25rem; object-fit: contain; filter: drop-shadow(0 0 10px rgba(82, 107, 245, 0.45));" alt="Noctra Copilot Logo">
                <h2 style="font-size: 1.5rem; font-weight: 600; margin: 0; color: white;">welcome back</h2>
                <p style="font-size: 0.95rem; margin: 0.5rem 0 0 0;">How can i assist you today?</p>
              </div>
            `;
            window.app.assistantChatHistory = [];
            return;
        }

        window.app.assistantChatHistory = [];
        logs.forEach(log => {
            const roleName = log.role === 'user' ? 'user' : 'bot';
            window.app.assistantChatHistory.push({ role: roleName, content: log.content });

            const isUser = log.role === 'user';
            const div = document.createElement('div');
            div.className = isUser ? 'message user' : 'message bot';
            if (isUser) {
                div.style.cssText = 'display: flex; gap: 1rem; max-width: 80%; align-self: flex-end; justify-content: flex-end; margin-left: auto;';
                div.innerHTML = `
                  <div style="background: var(--primary); padding: 1rem; border-radius: 1rem 0 1rem 1rem; color: white; font-size: 0.9rem; line-height: 1.5; font-weight: 500;">
                    ${log.content}
                  </div>
                `;
            } else {
                const cleanContent = log.content
                    .replace(/\[\[UPDATE_SETTINGS:.*?\]\]/g, '')
                    .replace(/\[\[ADD_FAQ:.*?\]\]/g, '')
                    .replace(/\[\[CANCEL_BOOKING:.*?\]\]/g, '')
                    .trim();
                    
                div.style.cssText = 'max-width: 80%;';
                div.innerHTML = `
                  <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); padding: 1rem; border-radius: 0 1rem 1rem 1rem; color: #dce1fb; font-size: 0.9rem; line-height: 1.5;">
                    ${formatMessage(cleanContent)}
                  </div>
                `;
            }
            messagesContainer.appendChild(div);
        });

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        if (window.app.assistantChatHistory.length > 10) {
            window.app.assistantChatHistory = window.app.assistantChatHistory.slice(-10);
        }
    } catch (err) {
        console.error("Failed to load assistant chat:", err);
    }
};

window.app.toggleCopilotSize = function(mode) {
    const view = document.getElementById('view-assistant');
    if (!view) return;

    const minIcon = document.getElementById('copilot-min-icon');
    const maxIcon = document.getElementById('copilot-max-icon');

    if (mode === 'minimize') {
        if (view.classList.contains('copilot-minimized')) {
            view.classList.remove('copilot-minimized');
            if (minIcon) minIcon.innerText = 'picture_in_picture_alt';
        } else {
            view.classList.remove('copilot-maximized');
            view.classList.add('copilot-minimized');
            if (minIcon) minIcon.innerText = 'open_in_full';
            if (maxIcon) maxIcon.innerText = 'fullscreen';
        }
    } else if (mode === 'maximize') {
        if (view.classList.contains('copilot-maximized')) {
            view.classList.remove('copilot-maximized');
            if (maxIcon) maxIcon.innerText = 'fullscreen';
        } else {
            view.classList.remove('copilot-minimized');
            view.classList.add('copilot-maximized');
            if (maxIcon) maxIcon.innerText = 'close_fullscreen';
            if (minIcon) minIcon.innerText = 'picture_in_picture_alt';
        }
    }
};

window.app.assistantAbortController = null;

window.app.sendAssistantMessage = async function() {
    const input = document.getElementById('assistant-chat-input');
    const messagesContainer = document.getElementById('assistant-messages');
    const sendBtn = document.getElementById('btn-send-assistant-msg');
    if (!input || !messagesContainer) return;

    if (window.app.assistantAbortController) {
        window.app.assistantAbortController.abort();
        window.app.assistantAbortController = null;
        return;
    }
    
    const text = input.value.trim();
    if (!text) return;
    
    input.value = '';
    input.disabled = true;
    input.placeholder = 'Noctra is processing...';

    if (sendBtn) {
        sendBtn.innerHTML = '<span>Stop</span><span class="material-symbols-outlined" style="color: #ef4444;">stop_circle</span>';
        sendBtn.title = 'Stop generating';
    }
    
    const copilotSessionId = window.app.currentCopilotSessionId || ('copilot_' + currentUser.id + '_' + Date.now());
    window.app.currentCopilotSessionId = copilotSessionId;

    // Clear watermark if it exists
    const watermark = messagesContainer.querySelector('.copilot-watermark');
    if (watermark) {
        messagesContainer.innerHTML = '';
    }

    // Append user message
    const userDiv = document.createElement('div');
    userDiv.className = 'message user';
    userDiv.style.cssText = 'display: flex; gap: 1rem; max-width: 80%; align-self: flex-end; justify-content: flex-end; margin-left: auto;';
    userDiv.innerHTML = `
      <div style="background: var(--primary); padding: 1rem; border-radius: 1rem 0 1rem 1rem; color: white; font-size: 0.9rem; line-height: 1.5; font-weight: 500;">
        ${text}
      </div>
    `;
    messagesContainer.appendChild(userDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Append typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot typing-indicator';
    typingDiv.style.cssText = 'max-width: 80%;';
    typingDiv.innerHTML = `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); padding: 1rem; border-radius: 0 1rem 1rem 1rem; color: #dce1fb; font-size: 0.9rem; font-style: italic; display: flex; align-items: center; gap: 0.35rem;">
        <span class="material-symbols-outlined rotating" style="font-size: 1.1rem;">sync</span> Noctra is thinking...
      </div>
    `;
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    window.app.assistantAbortController = new AbortController();

    try {
        const response = await fetch('/api/chat-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: window.app.assistantAbortController.signal,
            body: JSON.stringify({
                operation: 'dashboard_chat',
                business_id: currentUser.id,
                message: text,
                history: window.app.assistantChatHistory,
                session_id: copilotSessionId
            })
        });
        const data = await response.json();
        typingDiv.remove();
        
        if (data.reply) {
            let reply = data.reply;
            
            // Parse and execute commands
            await parseAssistantCommands(reply);
            
            // Strip tags for display
            const cleanReply = reply
                .replace(/\[\[UPDATE_SETTINGS:.*?\]\]/g, '')
                .replace(/\[\[ADD_FAQ:.*?\]\]/g, '')
                .replace(/\[\[CANCEL_BOOKING:.*?\]\]/g, '')
                .trim();
                
            const botDiv = document.createElement('div');
            botDiv.className = 'message bot';
            botDiv.style.cssText = 'max-width: 80%;';
            botDiv.innerHTML = `
              <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); padding: 1rem; border-radius: 0 1rem 1rem 1rem; color: #dce1fb; font-size: 0.9rem; line-height: 1.5;">
                ${formatMessage(cleanReply)}
              </div>
            `;
            messagesContainer.appendChild(botDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
            window.app.assistantChatHistory.push({ role: 'user', content: text });
            window.app.assistantChatHistory.push({ role: 'bot', content: reply });
            if (window.app.assistantChatHistory.length > 10) window.app.assistantChatHistory.splice(0, 2);

            app.loadAssistantSessions();
        } else {
            throw new Error("No response from assistant");
        }
    } catch (err) {
        typingDiv.remove();
        if (err.name === 'AbortError') {
            const stopDiv = document.createElement('div');
            stopDiv.className = 'message bot';
            stopDiv.style.cssText = 'max-width: 80%;';
            stopDiv.innerHTML = `
              <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); padding: 1rem; border-radius: 0 1rem 1rem 1rem; color: var(--text-dim); font-size: 0.9rem; font-style: italic;">
                Generation stopped by user.
              </div>
            `;
            messagesContainer.appendChild(stopDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } else {
            console.error(err);
            const errDiv = document.createElement('div');
            errDiv.className = 'message bot';
            errDiv.style.cssText = 'max-width: 80%;';
            errDiv.innerHTML = `
              <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); padding: 1rem; border-radius: 0 1rem 1rem 1rem; color: #ef4444; font-size: 0.9rem;">
                I encountered an error connecting to dashboard services. Please try again.
              </div>
            `;
            messagesContainer.appendChild(errDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    } finally {
        window.app.assistantAbortController = null;
        input.disabled = false;
        input.placeholder = 'Ask Noctra to summarize bookings, update settings...';
        if (sendBtn) {
            sendBtn.innerHTML = '<span>Send</span><span class="material-symbols-outlined" style="font-size: 1.1rem;">send</span>';
            sendBtn.title = '';
        }
    }
};

async function parseAssistantCommands(reply) {
    // 1. Update Settings
    const updateMatch = reply.match(/\[\[UPDATE_SETTINGS:(.*?)\]\]/);
    if (updateMatch) {
        try {
            const settingsObj = JSON.parse(updateMatch[1]);
            
            // Map keys appropriately
            const mappedSettings = {};
            if (settingsObj.website_url !== undefined) mappedSettings.website_url = settingsObj.website_url;
            if (settingsObj.booking_url !== undefined) mappedSettings.booking_url = settingsObj.booking_url;
            if (settingsObj.ai_instructions !== undefined) mappedSettings.ai_instructions = settingsObj.ai_instructions;
            
            if (Object.keys(mappedSettings).length > 0) {
                await window.owlDb.updateBusinessSettings(currentUser.id, mappedSettings);
                showToast("Noctra: Business settings updated successfully!");
                // Update inputs on the settings view
                if (mappedSettings.website_url !== undefined) {
                    const el = document.getElementById('settings-url');
                    if (el) el.value = mappedSettings.website_url;
                }
                if (mappedSettings.booking_url !== undefined) {
                    const el = document.getElementById('settings-booking-url');
                    if (el) el.value = mappedSettings.booking_url;
                }
                if (mappedSettings.ai_instructions !== undefined) {
                    const el = document.getElementById('settings-instructions');
                    if (el) el.value = mappedSettings.ai_instructions;
                }
            }
        } catch (e) { console.error("Update settings command failed", e); }
    }
    
    // 2. Add FAQ
    const faqMatch = reply.match(/\[\[ADD_FAQ:(.*?)\]\]/);
    if (faqMatch) {
        try {
            const newFaq = JSON.parse(faqMatch[1]);
            if (newFaq.question && newFaq.answer) {
                const bizRes = await fetch(`/api/get-business?id=${currentUser.id}`);
                const biz = await bizRes.json();
                let currentFaqs = biz.faqs || [];
                if (!Array.isArray(currentFaqs)) currentFaqs = [];
                
                currentFaqs.push(newFaq);
                
                await window.owlDb.saveFaqs(currentUser.id, currentFaqs);
                showToast("Noctra: New FAQ added to your knowledge base!");
                
                // Refresh FAQ list UI by calling local loadFaqs or app load
                if (window.app && typeof window.app.loadFaqs === 'function') {
                    window.app.loadFaqs();
                } else if (typeof loadFaqs === 'function') {
                    loadFaqs();
                }
            }
        } catch (e) { console.error("Add FAQ command failed", e); }
    }

    // 3. Cancel Booking
    const cancelMatch = reply.match(/\[\[CANCEL_BOOKING:(.*?)\]\]/);
    if (cancelMatch) {
        try {
            const bookingId = cancelMatch[1].trim().replace(/['"]/g, '');
            await window.owlDb.deleteLead(bookingId);
            showToast("Noctra: Booking cancelled successfully!");
            // Refresh bookings UI
            if (typeof fetchDataFromCloud === 'function') {
                await fetchDataFromCloud();
            }
        } catch (e) { console.error("Cancel booking command failed", e); }
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position: fixed; bottom: 2rem; right: 2rem; background: rgba(10,15,30,0.9); border: 1px solid var(--primary); color: white; padding: 1rem 1.5rem; border-radius: var(--radius-md); box-shadow: 0 10px 30px rgba(0,0,0,0.5); z-index: 10000; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; animation: slideInRight 0.3s ease-out; backdrop-filter: blur(8px);';
    toast.innerHTML = `<span class="material-symbols-outlined" style="color: var(--primary); font-size: 1.2rem;">info</span><span>${message}</span>`;
    document.body.appendChild(toast);
    
    if (!document.getElementById('toast-animation-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-animation-styles';
        style.innerHTML = `
          @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `;
        document.head.appendChild(style);
    }

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- BOOKING SYSTEM DASHBOARD CONTROLLERS ---
window.app.renderAvailabilitySettings = function(availList) {
    const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    availList.innerHTML = '';
    
    // Sort so Monday is first
    const sortedIndexes = [1, 2, 3, 4, 5, 6, 0];
    
    sortedIndexes.forEach(dayIndex => {
        const dayName = DAYS_OF_WEEK[dayIndex];
        const existing = app._availability ? app._availability.find(a => a.day_of_week === dayIndex) : null;
        const isEnabled = existing ? existing.is_enabled : (dayIndex !== 0 && dayIndex !== 6); // default mon-fri enabled
        const startVal = existing ? existing.start_time.substring(0, 5) : "09:00";
        const endVal = existing ? existing.end_time.substring(0, 5) : "17:00";

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.03);';
        
        row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem; min-width: 140px;">
              <label class="switch" style="position: relative; display: inline-block; width: 34px; height: 20px;">
                <input type="checkbox" class="day-enable-toggle" data-day="${dayIndex}" ${isEnabled ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                <span class="slider" style="position: absolute; cursor: pointer; inset: 0; background-color: rgba(255,255,255,0.15); transition: .3s; border-radius: 10px;"></span>
              </label>
              <span style="font-weight: 600; font-size: 0.9rem; color: white;">${dayName}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <input type="time" class="day-start-time" data-day="${dayIndex}" value="${startVal}" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: var(--radius-sm); color: white; padding: 0.25rem 0.5rem; outline: none; font-size: 0.85rem;" ${isEnabled ? '' : 'disabled'}>
              <span style="color: var(--text-dim); font-size: 0.85rem;">to</span>
              <input type="time" class="day-end-time" data-day="${dayIndex}" value="${endVal}" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: var(--radius-sm); color: white; padding: 0.25rem 0.5rem; outline: none; font-size: 0.85rem;" ${isEnabled ? '' : 'disabled'}>
            </div>
        `;

        const toggle = row.querySelector('.day-enable-toggle');
        const startInput = row.querySelector('.day-start-time');
        const endInput = row.querySelector('.day-end-time');
        const slider = row.querySelector('.slider');
        
        if (isEnabled) {
            slider.style.backgroundColor = 'var(--primary)';
        }

        toggle.addEventListener('change', (e) => {
            const active = e.target.checked;
            startInput.disabled = !active;
            endInput.disabled = !active;
            slider.style.backgroundColor = active ? 'var(--primary)' : 'rgba(255,255,255,0.15)';
        });

        availList.appendChild(row);
    });
};

window.app.saveWeeklyHours = async function(btn) {
    if (btn) { btn.disabled = true; btn.innerText = "Saving..."; }
    try {
        const slotsPayload = [];
        document.querySelectorAll('.day-enable-toggle').forEach(toggle => {
            const dayIndex = parseInt(toggle.dataset.day);
            const enabled = toggle.checked;
            const startInput = document.querySelector(`.day-start-time[data-day="${dayIndex}"]`);
            const endInput = document.querySelector(`.day-end-time[data-day="${dayIndex}"]`);
            
            slotsPayload.push({
                day: dayIndex,
                start: `${startInput.value}:00`,
                end: `${endInput.value}:00`,
                enabled: enabled
            });
        });

        await window.owlDb.saveAvailability(currentUser.id, slotsPayload);
        showToast("Weekly working hours saved successfully!");
        app._availability = slotsPayload.map(s => ({
            day_of_week: s.day,
            start_time: s.start,
            end_time: s.end,
            is_enabled: s.enabled
        }));
    } catch (err) {
        console.error("Save weekly hours failed:", err);
        alert("Failed to save working hours: " + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Save Weekly Hours"; }
    }
};

window.app.loadSlots = async function() {
    const listBody = document.getElementById('dashboard-slots-list-body');
    const emptyState = document.getElementById('slots-empty-state');
    const tableWrapper = document.getElementById('slots-list-table-wrapper');
    if (!listBody || !emptyState || !tableWrapper) return;

    try {
        const slots = await window.owlDb.fetchAllFutureSlots(currentUser.id);
        const bookings = await window.owlDb.fetchBookings(currentUser.id);
        
        const bookingMap = {};
        (bookings || []).forEach(b => {
            if (b.status === 'confirmed') {
                const key = b.booking_time;
                bookingMap[key] = {
                    id: b.id,
                    name: b.customer_name,
                    email: b.customer_email
                };
            }
        });

        if (!slots || slots.length === 0) {
            emptyState.style.display = 'block';
            tableWrapper.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        tableWrapper.style.display = 'block';
        listBody.innerHTML = '';

        slots.forEach(s => {
            const tr = document.createElement('tr');
            
            const dateObj = new Date(`${s.slot_date}T${s.slot_time}`);
            const dateStr = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const statusBadge = s.is_booked
                ? `<span style="font-size: 0.75rem; padding: 0.15rem 0.5rem; background: rgba(82, 107, 245, 0.15); color: var(--primary); border: 1px solid rgba(82, 107, 245, 0.25); border-radius: var(--radius-sm);">Booked</span>`
                : `<span style="font-size: 0.75rem; padding: 0.15rem 0.5rem; background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.25); border-radius: var(--radius-sm);">Available</span>`;

            const bookingKey = `${s.slot_date}T${s.slot_time}`;
            const bookedInfo = bookingMap[bookingKey];
            const bookedHtml = bookedInfo
                ? `<div style="font-weight:600; color:white;">${bookedInfo.name}</div><div style="font-size:0.75rem; color:var(--text-dim);">${bookedInfo.email}</div>`
                : `<span style="color:var(--text-dim); font-style:italic;">--</span>`;

            let actionBtn = '';
            if (s.is_booked && bookedInfo) {
                actionBtn = `<button class="btn btn-outline" style="border-color: rgba(239, 68, 68, 0.4); color: #ef4444; font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="app.cancelBookingSlot('${bookedInfo.id}', '${s.id}')">Cancel Booking</button>`;
            } else {
                actionBtn = `<button class="btn btn-outline" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="app.handleDeleteSlot('${s.id}')">Delete</button>`;
            }

            tr.innerHTML = `
                <td><strong>${dateStr}</strong></td>
                <td>${timeStr}</td>
                <td>${statusBadge}</td>
                <td>${bookedHtml}</td>
                <td style="text-align: center;">${actionBtn}</td>
            `;
            listBody.appendChild(tr);
        });
    } catch (err) {
        console.error("Load slots failed:", err);
    }
};

window.app.autoGenerateSlots = async function(btn) {
    if (btn) { btn.disabled = true; btn.innerText = "Generating..."; }
    try {
        const availability = await window.owlDb.fetchAvailability(currentUser.id);
        if (!availability || availability.length === 0) {
            alert("Please configure and save your weekly working hours first!");
            return;
        }

        const existingSlots = await window.owlDb.fetchAllFutureSlots(currentUser.id);
        const existingSet = new Set(existingSlots.map(s => `${s.slot_date}T${s.slot_time.substring(0, 5)}`));

        const supabase = await window.owlDb.getSupabase();
        const slotsToCreate = [];

        for (let i = 1; i <= 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            const dayOfWeek = date.getDay();

            const dayConfig = availability.find(a => a.day_of_week === dayOfWeek);
            if (dayConfig && dayConfig.is_enabled) {
                const startHour = parseInt(dayConfig.start_time.split(':')[0]);
                const endHour = parseInt(dayConfig.end_time.split(':')[0]);

                for (let hour = startHour; hour < endHour; hour++) {
                    const timeStr = `${hour.toString().padStart(2, '0')}:00`;
                    const fullStr = `${dateStr}T${timeStr}`;
                    if (!existingSet.has(fullStr)) {
                        slotsToCreate.push({
                            business_id: currentUser.id,
                            slot_date: dateStr,
                            slot_time: `${timeStr}:00`,
                            is_booked: false
                        });
                    }
                }
            }
        }

        if (slotsToCreate.length > 0) {
            const sessionToken = await window.owlAuth.getToken();
            const { error } = await supabase.functions.invoke('manage-slots', {
                body: {
                    operation: 'add',
                    business_id: currentUser.id,
                    slots: slotsToCreate
                },
                headers: {
                    Authorization: `Bearer ${sessionToken}`
                }
            });
            if (error) throw error;
            showToast(`Generated ${slotsToCreate.length} new slots for the upcoming week!`);
        } else {
            showToast("No new slots to generate.");
        }

        await app.loadSlots();
    } catch (err) {
        console.error("Auto generate failed:", err);
        alert("Failed to auto-generate slots: " + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Auto-Gen 7 Days"; }
    }
};

window.app.handleAddSlot = async function(btn) {
    const dateInput = document.getElementById('new-slot-date');
    const timeInput = document.getElementById('new-slot-time');
    if (!dateInput || !timeInput) return;

    const dateVal = dateInput.value;
    const timeVal = timeInput.value;
    if (!dateVal || !timeVal) {
        alert("Please select both a date and a time!");
        return;
    }

    if (btn) { btn.disabled = true; btn.innerText = "Adding..."; }
    try {
        await window.owlDb.addSlot(currentUser.id, dateVal, `${timeVal}:00`);
        showToast("Custom slot added successfully!");
        dateInput.value = '';
        timeInput.value = '';
        await app.loadSlots();
    } catch (err) {
        alert(err.message || "Failed to add slot.");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "+ Add"; }
    }
};

window.app.handleDeleteSlot = async function(slotId) {
    if (!confirm("Are you sure you want to delete this available slot?")) return;
    try {
        await window.owlDb.deleteSlot(slotId);
        showToast("Slot deleted successfully.");
        await app.loadSlots();
    } catch (err) {
        console.error("Delete slot failed:", err);
    }
};

window.app.cancelBookingSlot = async function(bookingId, slotId) {
    if (!confirm("Are you sure you want to cancel this booking? This will remove the booking and make the slot available again.")) return;
    try {
        const supabase = await window.owlDb.getSupabase();
        
        let targetSlotId = slotId;
        
        // If slotId is not provided, find the slot by querying the booking details
        if (!targetSlotId) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('booking_time, business_id')
                .eq('id', bookingId)
                .single();
                
            if (booking && booking.booking_time) {
                const datePart = booking.booking_time.split('T')[0];
                let timePart = booking.booking_time.split('T')[1];
                if (timePart.includes('.')) timePart = timePart.split('.')[0];
                if (timePart.split(':').length === 2) timePart = timePart + ':00';
                
                const { data: slot } = await supabase
                    .from('business_slots')
                    .select('id')
                    .eq('business_id', booking.business_id)
                    .eq('slot_date', datePart)
                    .eq('slot_time', timePart)
                    .maybeSingle();
                    
                if (slot) {
                    targetSlotId = slot.id;
                }
            }
        }
        
        await window.owlDb.deleteLead(bookingId);
        
        if (targetSlotId) {
            await supabase.from('business_slots').update({ is_booked: false }).eq('id', targetSlotId);
        }
        
        showToast("Booking cancelled and slot freed!");
        await app.loadSlots();
        if (typeof fetchDataFromCloud === 'function') {
            await fetchDataFromCloud();
        }
    } catch (err) {
        console.error("Cancel booking slot failed:", err);
    }
};


