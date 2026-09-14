// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

const app = Vue.createApp({
  data() {
    return {
      username: '',
      editItemData: '',
      editingIndex: '',
      setRule: '',
      order: "",
      reason: "",
      requester: "",
      phone: "",
      vender: "",
      venderList: [], // 新增供應商清單
      newVender: "", // 新供應商名稱
      showAddVenderCard: false, // ✅ 控制新增供應商彈窗
      venderMessage: "", // 顯示新增結果
      venderSearch: "", // ✅ 搜尋關鍵字
      showDropdown: false, // 控制下拉選單顯示
      copied1: false,
      copied2: false,
      prevOrderNo: "", // 新增「前購單單號」
      vendorType: "",   // "none" | "project" | "market"
      editItemData: [],
      tableRows: [], // ✅ 儲存細項資料
    };
  },
  watch: {
    vendorType(newVal, oldVal) {
      // 如果切換到 none，就清空供應商名稱
      if (newVal === 'none') {
        this.vender = '';
        this.showDropdown = false;
      }

      // 如果回到未選擇狀態，也清空供應商
      if (newVal === '') {
        this.vender = '';
        this.showDropdown = false;
      }
    }
  },
  computed: {
    template1() {
      const prevText = this.prevOrderNo
        ? `前購單：${this.prevOrderNo}，`
        : "";
      let venderText = '';
      const venderTrimmed = (this.vender ?? '').trim();

      if (this.vendorType === 'cooperate' && venderTrimmed) {
        venderText = `合作廠商：${venderTrimmed}`;
      } else if (this.vendorType === 'cooperate2' && venderTrimmed) {
        venderText = `2nd合作開發：${venderTrimmed}`;
      } else if (this.vendorType === 'parts' && venderTrimmed) {
        venderText = `零件商：${venderTrimmed}`;
      } else if (this.vendorType === 'suggestion' && venderTrimmed) {
        venderText = `建議廠商：${venderTrimmed}`;
      } else if (this.vendorType === 'equipment_vendor' && venderTrimmed) {
        venderText = `設備原廠：${venderTrimmed}`;
      }

      return `${this.order} - ${this.reason}。(${prevText}詳如附件)。需求工程師：${this.requester}(CT4:${this.phone})。${venderText}`;
    },
    template2() {
      const prevText = this.prevOrderNo
        ? `前購單：${this.prevOrderNo}，`
        : "";
      let venderText = '';
      const venderTrimmed = (this.vender ?? '').trim();

      if (this.vendorType === 'cooperate' && venderTrimmed) {
        venderText = `合作廠商：${venderTrimmed}。`;
      } else if (this.vendorType === 'cooperate2' && venderTrimmed) {
        venderText = `2nd合作開發：${venderTrimmed}。`;
      } else if (this.vendorType === 'parts' && venderTrimmed) {
        venderText = `零件商：${venderTrimmed}。`;
      } else if (this.vendorType === 'suggestion' && venderTrimmed) {
        venderText = `建議廠商：${venderTrimmed}。`;
      } else if (this.vendorType === 'equipment_vendor' && venderTrimmed) {
        venderText = `設備原廠：${venderTrimmed}。`;
      }

      return `${this.order} - ${this.reason}。(${prevText}詳如附件)。需求工程師：${this.requester}(CT4:${this.phone})。${venderText}煩請長官撥空協助簽核，謝謝。`;
    },
    filteredVenders() {
      const keyword = (this.vender ?? "").trim().toLowerCase();
      let result = keyword === '' 
        ? this.venderList 
        : this.venderList.filter(v => v.toLowerCase().includes(keyword));
      
      // ✅ 去除重複的廠商名稱
      return [...new Set(result)];
    },
  },

  async mounted() {
    const username = localStorage.getItem("username");
    this.username = username;
    const editItemData = localStorage.getItem("editItemData");
    this.editItemData = editItemData;
    const setRule = localStorage.getItem('setRule');
    this.setRule = setRule

    await this.loadTXTdata();
    await this.loadVenders();
    await this.loadTableRows(); // ✅ 載入細項資料
    document.addEventListener("click", (e) => this.handleClickOutside(e));
  },

  beforeUnmount() {
    document.removeEventListener("click", (e) => this.handleClickOutside(e));
  },
  methods: {
    handleClickOutside(event) {
      const dropdown = document.querySelector(".dropdown-wrapper");
      if (dropdown && !dropdown.contains(event.target)) {
        this.showDropdown = false;
      }
    },

    selectVender(v) {
      this.vender = v; // 設定選擇
      this.showDropdown = false; // 選完關閉下拉
    },
    enableDropdown() {
      // 只有在選擇了非 none 和非空的類型時，才打開下拉
      if (this.vendorType !== 'none' && this.vendorType !== '') {
        this.showDropdown = true;
      } else {
        this.showDropdown = false;
      }
    },
    async confirmAddVender() {
      if (!this.newVender.trim()) {
        alert("請輸入供應商名稱");
        return;
      }
      const newName = this.newVender.trim();
      try {
        const response = await fetch(`http://localhost:5000/api/venders?${siteQuery()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vender: newName }),
        });
        const res = await response.json();

        if (response.ok) {
          await this.loadVenders();
          this.vender = newName;
          this.venderSearch = newName;
          this.showAddVenderCard = false;
          this.showDropdown = false;
          this.newVender = "";
          alert("✅ 已成功新增並選擇供應商！");
        } else {
          alert("❌ 新增失敗：" + (res.error || "未知錯誤"));
        }
      } catch (error) {
        console.error("後端錯誤：", error);
        alert("❌ 新增失敗，請檢查後端是否正常運作");
      }
    },

    async loadTXTdata() {
      this.editItemData = JSON.parse(this.editItemData);
      const orderValue = this.editItemData["請購順序"];
      const orderMap = {
        1: "超急件",
        2: "急件",
        3: "一般件",
      };
      let reasonText = this.editItemData["需求原因"] || "";
      if (reasonText.endsWith("。")) {
        reasonText = reasonText.slice(0, -1);
      }
      this.reason = reasonText;
      this.order = orderMap[orderValue] || orderValue;
      this.requester = this.editItemData["需求者"];
      

      const vendorTypeMap = {
        none: 'none',
        cooperate: 'cooperate',
        cooperate2: 'cooperate2',
        parts: 'parts',
        suggestion: 'suggestion',
        equipment_vendor: 'equipment_vendor',
      };

      this.vendorType = vendorTypeMap[this.editItemData["合作類別"]] || '';
      this.vender = this.editItemData['合作廠商']
      this.prevOrderNo = this.editItemData['前購單單號']



      try {
        const response = await fetch(`http://localhost:5000/api/get_phone?${siteQuery()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: this.requester }),
        });
        const phone = await response.json();
        this.phone = phone["phone"];
      } catch (error) {
        console.log(error);
      }
    },

    async loadVenders() {
      try {
        const response = await fetch(`http://localhost:5000/api/venders?${siteQuery()}`);
        const venders = await response.json();
        if (Array.isArray(venders)) {
          // ✅ 去除重複的廠商名稱
          this.venderList = [...new Set(venders)];
          console.log('✅ 已載入廠商:', this.venderList.length, '筆（已去重）');
        }
      } catch (error) {
        console.log(error);
      }
    },

    async loadTableRows() {
      try {
        // 取得細項資料
        const id = this.editItemData['Id'];
        if (!id) {
          console.log('沒有Id，無法載入細項');
          return;
        }

        const response = await fetch(`http://localhost:5000/api/get_detail/${id}?${siteQuery()}`);
        const data = await response.json();
        
        if (Array.isArray(data)) {
          this.tableRows = data;
          console.log('✅ 已載入細項資料:', this.tableRows.length, '筆');
        } else {
          this.tableRows = [];
        }
      } catch (error) {
        console.log('載入細項失敗:', error);
        this.tableRows = [];
      }
    },

    async copyTemplate1() {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          // ✅ 先用現代 API
          await navigator.clipboard.writeText(this.template1);
        } else {
          // ✅ 不支援 Clipboard API → 用舊方法
          const textarea = this.$refs.template1;
          textarea.focus();
          textarea.select();
          document.execCommand("copy");
        }

        // ✅ 成功後提示
        this.copied1 = true;
        setTimeout(() => (this.copied1 = false), 2000);
      } catch (err) {
        console.error("複製失敗:", err);
        alert("⚠️ 你的瀏覽器不支援自動複製，請手動選取文字 Ctrl+C");
      }
    },

    async copyTemplate2() {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          // ✅ 先用現代 API
          await navigator.clipboard.writeText(this.template2);
        } else {
          // ✅ 不支援 Clipboard API → 用舊方法
          const textarea = this.$refs.template2;
          textarea.focus();
          textarea.select();
          document.execCommand("copy");
        }

        // ✅ 成功後提示
        this.copied2 = true;
        setTimeout(() => (this.copied2 = false), 2000);
      } catch (err) {
        console.error("複製失敗:", err);
        alert("⚠️ 你的瀏覽器不支援自動複製，請手動選取文字 Ctrl+C");
      }
    },

    async saveChanges() {
      // 更新主資料
      this.editItemData['合作類別'] = this.vendorType;
      this.editItemData['合作廠商'] = this.vender;
      this.editItemData['前購單單號'] = this.prevOrderNo;

      try {
        // ✅ 直接儲存到資料庫（包含細項）
        const payload = {
          ...this.editItemData,
          tableRows: this.tableRows  // 包含細項資料
        };

        const response = await fetch(`http://localhost:5000/update?${siteQuery()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok) {
          console.log('✅ 資料已儲存到資料庫');
          
          // 更新 localStorage
          localStorage.setItem('editItemData', JSON.stringify(this.editItemData));
          
          // 設置返回標記
          this.setRule = "copymsg"
          localStorage.setItem('username', this.username);
          localStorage.setItem('setRule', this.setRule);
          
          // ✅ 儲存成功後跳轉回360
          window.location.href = "Procurement_Dynamic_360_Dashboard.html";
        } else {
          alert('❌ 儲存失敗：' + (result.message || '未知錯誤'));
        }
      } catch (error) {
        console.error('儲存錯誤：', error);
        alert('❌ 儲存失敗，請檢查網路連線');
      }
    },

    async goBack() {
      // 更新主資料
      this.editItemData['合作類別'] = this.vendorType;
      this.editItemData['合作廠商'] = this.vender;
      this.editItemData['前購單單號'] = this.prevOrderNo;

      try {
        // ✅ 直接儲存到資料庫（包含細項）
        const payload = {
          ...this.editItemData,
          tableRows: this.tableRows  // 包含細項資料
        };

        const response = await fetch(`http://localhost:5000/update?${siteQuery()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          console.error('儲存失敗');
          alert('❌ 儲存失敗，請檢查後重試');
          return;
        }

        console.log('✅ 資料已儲存到資料庫');
      } catch (error) {
        console.error('儲存錯誤：', error);
        alert('❌ 儲存失敗，請檢查網路連線');
        return;
      }

      // 設置返回標記
      this.setRule = "copymsg"
      localStorage.setItem('username', this.username);
      localStorage.setItem('setRule', this.setRule);
      localStorage.setItem('editItemData', JSON.stringify(this.editItemData));
      
      window.location.href = "Procurement_Dynamic_360_Dashboard.html";
    },
  },
});
app.mount("#app");