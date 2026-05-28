/**
 * Owl Assist - Premium Modal System
 * Replaces standard browser alert() and confirm()
 */

const OwlModal = {
  create: function() {
    if (document.getElementById('owl-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'owl-modal-overlay';
    overlay.style = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(2, 6, 23, 0.85); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; opacity: 0; transition: opacity 0.3s ease;
    `;

    const modal = document.createElement('div');
    modal.id = 'owl-modal-box';
    modal.className = 'glass-card';
    modal.style = `
      width: 90%; max-width: 400px; padding: 2rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      transform: scale(0.9) translateY(20px); transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      text-align: center;
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Trigger animation
    setTimeout(() => {
      overlay.style.opacity = '1';
      modal.style.transform = 'scale(1) translateY(0)';
    }, 10);
  },

  alert: function(title, message) {
    this.create();
    const box = document.getElementById('owl-modal-box');
    box.innerHTML = `
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem;">${title}</h3>
      <p style="color: var(--text-dim); margin-bottom: 2rem; font-size: 0.95rem;">${message}</p>
      <button class="btn btn-primary" style="width: 100%;" onclick="OwlModal.close()">Got it!</button>
    `;
  },

  confirm: function(title, message, onConfirm, confirmText = 'Confirm', confirmColor = 'var(--primary)', cancelText = 'Cancel') {
    this.create();
    const box = document.getElementById('owl-modal-box');
    box.innerHTML = `
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem;">${title}</h3>
      <p style="color: var(--text-dim); margin-bottom: 2rem; font-size: 0.95rem;">${message}</p>
      <div style="display: flex; gap: 1rem;">
        <button class="btn btn-outline" style="flex: 1;" onclick="OwlModal.close()">${cancelText}</button>
        <button class="btn btn-primary" id="owl-modal-confirm-btn" style="flex: 1; background: ${confirmColor};">${confirmText}</button>
      </div>
    `;

    document.getElementById('owl-modal-confirm-btn').onclick = () => {
      onConfirm();
      this.close();
    };
  },

  close: function() {
    const overlay = document.getElementById('owl-modal-overlay');
    const modal = document.getElementById('owl-modal-box');
    if (!overlay) return;

    overlay.style.opacity = '0';
    modal.style.transform = 'scale(0.9) translateY(20px)';
    setTimeout(() => overlay.remove(), 300);
  }
};

window.alert = (msg) => OwlModal.alert('Notice', msg);
window.confirm = (msg, onConfirm) => {
    // Note: This override is async, so usage will differ from native confirm() if used synchronously.
    // We will use OwlModal.confirm directly in the dashboard.
    return OwlModal.confirm('Confirm Action', msg, onConfirm);
};
