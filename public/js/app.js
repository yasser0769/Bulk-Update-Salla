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

  // ---- Script Loader ----
  _scriptPromises: {},
  loadScriptOnce(src) {
    if (this._scriptPromises[src]) return this._scriptPromises[src];

    this._scriptPromises[src] = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load script: ' + src));
      document.head.appendChild(script);
    });

    return this._scriptPromises[src];
  },

  // ---- Embedded SDK Bootstrap ----
  _embeddedInitPromise: null,
  initEmbedded() {
    if (this._embeddedInitPromise) return this._embeddedInitPromise;
    this._embeddedInitPromise = this._initEmbeddedInternal();
    return this._embeddedInitPromise;
  },

  async _initEmbeddedInternal() {
    const params = new URLSearchParams(window.location.search);
    const tokenFromQuery = params.get('token');
    const lang = params.get('lang');
    const theme = params.get('theme');
    let isIframe = false;

    try {
      isIframe = window.self !== window.top;
    } catch {
      isIframe = true;
    }

    if (!isIframe && !tokenFromQuery) {
      return { enabled: false };
    }

    try {
      await this.loadScriptOnce('https://unpkg.com/@salla.sa/embedded-sdk/dist/umd/index.js');
      const embedded = window.Salla?.embedded;
      if (!embedded) return { enabled: false };

      const initResult = await embedded.init({ debug: false });
      const token = embedded.auth?.getToken?.() || tokenFromQuery;
      const appId = embedded.auth?.getAppId?.() || params.get('app_id') || params.get('appId');

      if (lang) {
        document.documentElement.lang = lang;
        if (lang === 'ar') document.documentElement.dir = 'rtl';
        if (lang === 'en') document.documentElement.dir = 'ltr';
      }

      if (theme) {
        document.documentElement.dataset.sallaTheme = theme;
      }

      if (!token) {
        embedded.ready?.();
        return { enabled: true, verified: false, reason: 'missing-token' };
      }

      const verifyRes = await fetch('/auth/embedded/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, appId })
      });
      const verifyJson = await verifyRes.json().catch(() => ({}));

      if (!verifyRes.ok || !verifyJson.success) {
        embedded.destroy?.();
        return { enabled: true, verified: false, reason: 'verify-failed' };
      }

      if (embedded.page?.setTitle) {
        embedded.page.setTitle(document.title);
      }
      if (embedded.page?.autoResize) {
        embedded.page.autoResize();
      }
      embedded.ready?.();

      if (!verifyJson.authenticated) {
        this.toast('تم التحقق داخل سلة. سجّل الدخول مرة واحدة لربط المتجر قبل رفع الملفات.', 'warning', 7000);
      }

      return {
        enabled: true,
        verified: true,
        merchantId: verifyJson.merchantId || null,
        authenticated: !!verifyJson.authenticated,
        layout: initResult?.layout || null
      };
    } catch (err) {
      console.error('Embedded bootstrap failed:', err);
      return { enabled: false, error: err.message };
    }
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
    const path = window.location.pathname || '';
    const isHistory = path.includes('/pages/history.html');

    return `
      <header class="app-header">
        <div class="app-header-inner">
          <a href="/pages/upload.html" class="app-logo">
            <span class="app-logo-mark">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 2v4a2 2 0 0 0 2 2h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8.5 13h2M13.5 13h2M8.5 17h2M13.5 17h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </span>
            <span>محدث سلة الجماعي</span>
          </a>
          <nav class="header-actions" aria-label="التنقل الرئيسي">
            <a href="/pages/upload.html" class="nav-btn ${!isHistory ? 'nav-btn-active' : ''}">التحديث</a>
            <a href="/pages/history.html" class="nav-btn ${isHistory ? 'nav-btn-active' : ''}">السجل</a>
            <a href="/auth/logout" class="nav-btn nav-btn-ghost">خروج</a>
          </nav>
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
          <div class="step-head">
            <div class="step-circle">${s.n < activeStep ? '✓' : s.n}</div>
            ${i < steps.length - 1 ? '<div class="step-line"></div>' : ''}
          </div>
          <span class="step-label">${s.label}</span>
        </div>
      `).join('')}
    </div>`;
  }
};

window.addEventListener('DOMContentLoaded', () => {
  App.initEmbedded();
});
