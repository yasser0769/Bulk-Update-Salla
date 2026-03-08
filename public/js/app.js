// ========================================
// Salla Bulk Update App - Shared Utilities
// ========================================

const App = {
  // ---- Toast Notifications ----
  toast(message, type = 'default', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-danger' : type === 'warning' ? 'toast-warning' : ''}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // ---- Number Formatting ----
  formatNumber(n) {
    if (n === null || n === undefined || n === '') return '-';
    return Number(n).toLocaleString('ar-SA');
  },

  formatPrice(n) {
    if (n === null || n === undefined || n === '') return '-';
    return Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  // ---- API Helper ----
  async api(method, url, data = null) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) options.body = JSON.stringify(data);

    const res = await fetch(url, options);
    const json = await res.json();

    if (!res.ok) {
      throw new Error(json.error || 'حدث خطأ في الطلب');
    }

    return json;
  },

  // ---- Session Storage Helpers ----
  save(key, value) {
    try {
      sessionStorage.setItem('bulk_' + key, JSON.stringify(value));
    } catch {}
  },

  load(key) {
    try {
      const val = sessionStorage.getItem('bulk_' + key);
      return val ? JSON.parse(val) : null;
    } catch { return null; }
  },

  // ---- Stepper Update ----
  setActiveStep(stepNumber) {
    document.querySelectorAll('.step').forEach((step, index) => {
      const num = index + 1;
      step.classList.remove('active', 'completed');
      if (num < stepNumber) step.classList.add('completed');
      else if (num === stepNumber) step.classList.add('active');
    });
  },

  // ---- Button Loading State ----
  setButtonLoading(btn, loading, text = null) {
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = `<span class="spinner"></span> ${text || 'جاري التحميل...'}`;
    } else {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalText || (text || btn.innerHTML);
    }
  },

  // ---- Get status badge HTML ----
  statusBadge(status) {
    const map = {
      will_update:  ['badge-success', 'سيتم التحديث'],
      no_change:    ['badge-gray', 'لا يوجد تغيير'],
      not_found:    ['badge-danger', 'SKU غير موجود'],
      updated:      ['badge-success', 'تم التحديث'],
      failed:       ['badge-danger', 'فشل'],
      running:      ['badge-primary', 'جاري التنفيذ'],
      completed:    ['badge-success', 'مكتمل'],
      pending:      ['badge-warning', 'معلق']
    };
    const [cls, label] = map[status] || ['badge-gray', status];
    return `<span class="badge ${cls}">${label}</span>`;
  },

  // ---- Header HTML ----
  header(title) {
    return `
      <header class="app-header">
        <a href="/pages/upload.html" class="app-logo">
          <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="8" fill="#5B8DEF"/>
            <path d="M8 22h16M8 16l4-4 4 4 4-8 4 8" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          تحديث جماعي - سلة
        </a>
        <div class="header-actions">
          <a href="/pages/history.html" class="btn btn-ghost btn-sm">السجل</a>
          <a href="/auth/logout" class="btn btn-ghost btn-sm">تسجيل الخروج</a>
        </div>
      </header>`;
  },

  // ---- Stepper HTML ----
  stepper(activeStep) {
    const steps = [
      { n: 1, label: 'رفع الملف' },
      { n: 2, label: 'تحديد الأعمدة' },
      { n: 3, label: 'المعاينة' },
      { n: 4, label: 'التنفيذ' },
      { n: 5, label: 'النتائج' }
    ];

    return `<div class="stepper">
      ${steps.map((s, i) => `
        <div class="step ${s.n < activeStep ? 'completed' : s.n === activeStep ? 'active' : ''}">
          <div class="step-circle">${s.n < activeStep ? '✓' : s.n}</div>
          <span class="step-label">${s.label}</span>
          ${i < steps.length - 1 ? '<div class="step-line"></div>' : ''}
        </div>
      `).join('')}
    </div>`;
  }
};
