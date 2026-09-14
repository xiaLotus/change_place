// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

const app = Vue.createApp({
  data() {
    return {
      username: '',
      admins: [],

      requesters: [],
      newName: '',
      requesterErr: '',
      cfgLoading: false,
      refreshing: false,

      addModal: { show: false, name: '', empId: '', empErr: '', phone: '', phoneErr: '', notesId: '', notesErr: '' },

      toast: { show: false, msg: '', type: 'ok' },
      modal: { show: false, name: '' },
    };
  },

  async mounted() {
    this.username = localStorage.getItem('username') || '';

    if (!this.username) {
      alert('請從系統入口進入！');
      window.location.href = '../index.html';
      return;
    }

    await this.fetchAdmins();
  },

  methods: {

    goBack() {
      localStorage.setItem('username', this.username);
      window.location.href = 'Procurement_Dynamic_360_Dashboard.html';
    },

    showToast(msg, type = 'ok') {
      this.toast = { show: true, msg, type };
      setTimeout(() => { this.toast.show = false; }, 3200);
    },

    async fetchAdmins() {
      try {
        const res = await fetch(`http://127.0.0.1:5000/api/admins?${siteQuery()}`);
        if (!res.ok) throw new Error('取得失敗');
        this.admins = await res.json();

        if (!this.admins.includes(this.username)) {
          alert('你沒有權限進入此頁面！');
          window.location.href = '../index.html';
          return;
        }

        await this.fetchRequesters();

      } catch (e) {
        alert('權限驗證失敗，請重新登入。');
        window.location.href = '../index.html';
      }
    },

    async fetchRequesters() {
      this.refreshing = true;
      try {
        const res = await fetch(`http://127.0.0.1:5000/api/requesters?${siteQuery()}`);
        if (!res.ok) throw new Error('取得失敗');
        this.requesters = await res.json();
      } catch (e) {
        this.showToast('無法載入需求者清單：' + e.message, 'err');
      } finally {
        this.refreshing = false;
      }
    },

    openAddModal() {
      const name = this.newName.trim();
      this.requesterErr = '';
      if (!name)                          { this.requesterErr = '姓名不可為空'; return; }
      if (this.requesters.includes(name)) { this.requesterErr = '此人已在清單中'; return; }
      this.addModal = { show: true, name, empId: '', empErr: '', phone: '', phoneErr: '', notesId: '', notesErr: '' };
      Vue.nextTick(() => { this.$refs.empInput && this.$refs.empInput.focus(); });
    },

    cancelAdd() {
      this.addModal = { show: false, name: '', empId: '', empErr: '', phone: '', phoneErr: '', notesId: '', notesErr: '' };
    },

    // Notes_ID 輸入時即時修正：空格→下底線，若貼上含 @ 只保留 @ 前的部分
    onNotesInput(e) {
      let v = e.target.value.replace(/\s+/g, '_');
      if (v.includes('@')) v = v.split('@')[0];
      this.addModal.notesId = v;
    },

    async confirmAdd() {
      const empId   = this.addModal.empId.trim();
      const phone   = this.addModal.phone.trim();
      const prefix  = this.addModal.notesId.trim().replace(/_+$/, '');
      const notesId = prefix ? prefix + '@aseglobal.com' : '';

      this.addModal.empErr = this.addModal.phoneErr = this.addModal.notesErr = '';

      if (!empId) { this.addModal.empErr = '工號不可為空'; return; }
      if (!phone) { this.addModal.phoneErr = '電話分機不可為空'; return; }
      if (!notesId) { this.addModal.notesErr = 'Notes_ID 不可為空'; return; }

      this.cfgLoading = true;
      try {
        const res = await fetch(`http://127.0.0.1:5000/api/requesters/add?${siteQuery()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: this.addModal.name, emp_id: empId, phone, notes_id: notesId })
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || res.statusText); }
        this.requesters.push(this.addModal.name);
        this.newName = '';
        this.showToast(`已新增：${this.addModal.name}（分機 ${phone}）`);
        this.cancelAdd();
      } catch (e) {
        this.showToast('新增失敗：' + e.message, 'err');
      } finally {
        this.cfgLoading = false;
      }
    },

    confirmRemove(name) { this.modal = { show: true, name }; },

    async doRemove() {
      const name = this.modal.name;
      this.cfgLoading = true;
      try {
        const res = await fetch(`http://127.0.0.1:5000/api/requesters/remove?${siteQuery()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || res.statusText); }
        this.requesters = this.requesters.filter(r => r !== name);
        this.modal.show = false;
        this.showToast(`已移除：${name}`);
      } catch (e) {
        this.showToast('移除失敗：' + e.message, 'err');
      } finally {
        this.cfgLoading = false;
      }
    },
  }
});

app.mount('#app');