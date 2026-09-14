const url = "http://127.0.0.1:5000"

// ── Vue App ──────────────────────────────────────────────────────────────────
const app = Vue.createApp({
  data() {
    return {
      username: '',
      password: '',
      site: '',
      sites: [],
      error: '',
      errorIsHint: false
    };
  },
  watch: {
    // 換帳號時重置廠區選擇
    username() { this.sites = []; this.site = ''; this.error = ''; },
    // 廠區選單出現/消失時，讓登入按鈕重新對齊佔位區
    sites() { Vue.nextTick(() => window.dispatchEvent(new Event('resize'))); }
  },
  methods: {
    async login() {
      this.errorIsHint = false;
      if (!this.username || !this.password) {
        this.error = '請輸入帳號與密碼';
        return;
      }

      try {
        const res = await fetch(`${url}/api/getAllLoginer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: this.username })
        });

        if (!res.ok) {
          this.error = '您無權登入，謝謝';
          return;
        }
        const info = await res.json();
        this.sites = info.sites || [info.site];
        // 可進入多個廠區：第一次先顯示下拉讓使用者選，選好再按一次登入
        if (this.sites.length > 1 && !this.sites.includes(this.site)) {
          this.site = this.sites[0];
          this.errorIsHint = true;
          this.error = '您可進入多個廠區，請選擇後再按一次登入';
          return;
        }
        if (this.sites.length === 1) this.site = this.sites[0];
      } catch (err) {
        console.error(err);
        this.error = '您無權登入，謝謝';
        return;
      }

      try {
        const res = await fetch(`${url}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: this.username,
            password: this.password,
            site: this.site
          })
        });

        const result = await res.json();

        if (res.ok) {
          localStorage.setItem('username', this.username);
          localStorage.setItem('site', this.site);
          window.location.href = 'frontend/Procurement_Dynamic_360_Dashboard.html';
        } else {
          this.errorIsHint = false;
          this.error = result.message || '登入失敗';
        }
      } catch (err) {
        console.error(err);
        this.error = '伺服器連線錯誤';
      }
    }
  }
});

const vm = app.mount('#app');


// ── 逃跑按鈕 ─────────────────────────────────────────────────────────────────
(() => {
  const MARGIN  = 24;
  const btn     = document.getElementById('escape-btn');
  const tooltip = document.getElementById('tooltip');
  let tooltipTimer = null;
  let isFloating   = false;

  /* 判斷帳密是否都有填 */
  function isReady() {
    return vm && vm.username.trim() && vm.password.trim();
  }

  /* 根據狀態切換按鈕樣式 */
  function syncStyle() {
    if (isReady()) {
      btn.className = 'px-8 py-2.5 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 cursor-pointer transition-colors duration-200';
    } else {
      btn.className = 'px-8 py-2.5 rounded-xl font-semibold text-white bg-gray-400 cursor-not-allowed';
    }
  }

  /* 按鈕飛回卡片佔位區 */
  function snapToAnchor() {
    const rect = document.getElementById('btn-anchor').getBoundingClientRect();
    btn.style.left = (rect.left + rect.width  / 2 - btn.offsetWidth  / 2) + 'px';
    btn.style.top  = (rect.top  + rect.height / 2 - btn.offsetHeight / 2) + 'px';
    isFloating = false;
  }

  /* 按鈕逃離游標 */
  function flee(cx, cy) {
    const r = btn.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;

    let dx = (r.left + r.width  / 2) - cx || 1;
    let dy = (r.top  + r.height / 2) - cy || 1;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;

    const dist = 160 + Math.random() * 120;
    let nx = (r.left + r.width  / 2) + dx * dist - r.width  / 2;
    let ny = (r.top  + r.height / 2) + dy * dist - r.height / 2;

    // 超出螢幕邊緣就反彈到對面
    if (nx < MARGIN)                nx = W - r.width  - MARGIN - Math.random() * 80;
    if (nx + r.width  > W - MARGIN) nx = MARGIN + Math.random() * 80;
    if (ny < MARGIN)                ny = H - r.height - MARGIN - Math.random() * 60;
    if (ny + r.height > H - MARGIN) ny = MARGIN + Math.random() * 60;

    btn.style.left = Math.max(MARGIN, Math.min(nx, W - r.width  - MARGIN)) + 'px';
    btn.style.top  = Math.max(MARGIN, Math.min(ny, H - r.height - MARGIN)) + 'px';
    isFloating = true;
  }

  /* 提示泡泡 */
  function showTip(x, y, msg) {
    tooltip.textContent = msg;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
    tooltip.classList.add('show');
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => tooltip.classList.remove('show'), 1800);
  }

  /* 事件綁定 */
  btn.addEventListener('mouseenter', e => { if (!isReady()) flee(e.clientX, e.clientY); });
  btn.addEventListener('mousemove',  e => { if (!isReady()) flee(e.clientX, e.clientY); });
  btn.addEventListener('click', e => {
    if (!isReady()) {
      const u  = vm?.username?.trim();
      const p  = vm?.password?.trim();
      const msg = !u && !p ? '請先填寫帳號和密碼！ 🏃'
                : !u       ? '還差帳號喔！ 👤'
                :            '還差密碼喔！ 🔑';
      flee(e.clientX, e.clientY);
      showTip(e.clientX, e.clientY, msg);
      return;
    }
    vm.login();
  });

  /* 輸入時同步樣式，填完就飛回來 */
  document.getElementById('app').addEventListener('input', () => {
    syncStyle();
    if (isReady() && isFloating) snapToAnchor();
  });

  /* 初始定位 */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    snapToAnchor();
    syncStyle();
  }));

  window.addEventListener('resize', () => { if (!isFloating) snapToAnchor(); });
})();