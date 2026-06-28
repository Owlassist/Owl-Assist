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
        const tabs = ['account', 'ai', 'customization', 'billing'];
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

        const sessions = await window.owlDb.fetchChatSessions(businessId);
        renderStats(bookings, sessions);
        renderConversations(sessions);

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

            // On mobile: slide to the chat panel
            if (typeof app.showChatPanel === 'function') app.showChatPanel();

            await loadTranscript(session.session_id, session.customer_name, session.summary, timeStr, session.session_status);
        };

        sessionList.appendChild(item);
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
            return;
        }
        
        const isUser = log.role === 'user';
        const isOwner = log.role === 'owner';
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user' : 'bot'}`;
        if (isOwner) {
            msgDiv.style.borderLeft = '4px solid var(--primary)';
            msgDiv.style.background = 'rgba(82, 107, 245, 0.05)';
        }
        
        let label = '';
        if (!isUser) {
            label = `<div style="font-size: 0.65rem; color: var(--text-dim); margin-bottom: 0.2rem;">${isOwner ? 'You' : 'Noctra'}</div>`;
        }
        msgDiv.innerHTML = label + log.content;
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
        // Refresh transcript to show new system logs properly if needed, but not necessary since UI is updated
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


