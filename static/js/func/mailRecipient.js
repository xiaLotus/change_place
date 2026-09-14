// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

const API_BASE = 'http://127.0.0.1:5000';

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 2200,
  timerProgressBar: true,
});

const app = Vue.createApp({
  data() {
    return {
      username: '',
      busy: false,
      recipients: {
        purchase: { to: [], cc: [] },
        acceptance: { cc: [] },
      },
      inputs: {
        purchase: { to: '', cc: '' },
        acceptance: { cc: '' },
      },
      purchaseFields: [
        { key: 'to', label: '收件人 To', note: '固定收件人，另外會加上需求者本人' },
        { key: 'cc', label: '副本 CC', note: '固定副本，另外會加上頁面勾選的 CC' },
      ],
    };
  },

  async mounted() {
    this.username = localStorage.getItem('username') || '';
    if (!this.username) {
      await Swal.fire({ icon: 'warning', title: '請從系統入口進入！' });
      window.location.href = '../index.html';
      return;
    }
    await this.load();
  },

  methods: {
    goBack() {
      localStorage.setItem('username', this.username);
      window.location.href = 'Procurement_Dynamic_360_Dashboard.html';
    },

    // 後端回傳的整份設定套回畫面（缺欄位時補空陣列，避免 template 取 length 出錯）
    applyData(data) {
      this.recipients = {
        purchase: {
          to: (data.purchase && data.purchase.to) || [],
          cc: (data.purchase && data.purchase.cc) || [],
        },
        acceptance: {
          cc: (data.acceptance && data.acceptance.cc) || [],
        },
      };
    },

    async load() {
      this.busy = true;
      try {
        const res = await fetch(`${API_BASE}/api/mail-recipients?${siteQuery()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || '讀取失敗');
        this.applyData(json.data);
      } catch (e) {
        Toast.fire({ icon: 'error', title: `讀取失敗：${e.message}` });
      } finally {
        this.busy = false;
      }
    },

    // 輸入時即時處理：去掉尾端 @aseglobal.com、空白自動轉底線（多個連續空白合成一個底線）
    onInput(group, field, e) {
      let v = e.target.value.replace(/@aseglobal\.com$/i, '');
      v = v.replace(/\s+/g, '_');
      this.inputs[group][field] = v;
      e.target.value = v;
    },

    async add(group, field) {
      const name = this.inputs[group][field].replace(/^_+|_+$/g, '');
      if (!name) return;
      await this.mutate('POST', group, field, name, () => {
        this.inputs[group][field] = '';
      });
    },

    async remove(group, field, name) {
      const { isConfirmed } = await Swal.fire({
        icon: 'warning',
        title: `移除 ${name}？`,
        text: `${name}@aseglobal.com 將不再固定收到這類信件`,
        showCancelButton: true,
        confirmButtonText: '移除',
        cancelButtonText: '取消',
        confirmButtonColor: '#ef4444',
        focusCancel: true,
      });
      if (!isConfirmed) return;
      await this.mutate('DELETE', group, field, name);
    },

    async mutate(method, group, field, name, onOk) {
      this.busy = true;
      try {
        const res = await fetch(`${API_BASE}/api/mail-recipients?${siteQuery()}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group, field, name }),
        });
        const json = await res.json();
        if (json.data) this.applyData(json.data);
        if (!json.success) {
          Toast.fire({ icon: 'warning', title: json.message || '操作失敗' });
          return;
        }
        if (onOk) onOk();
        Toast.fire({ icon: 'success', title: json.message });
      } catch (e) {
        Toast.fire({ icon: 'error', title: `連線失敗：${e.message}` });
      } finally {
        this.busy = false;
      }
    },
  },
});

app.mount('#app');