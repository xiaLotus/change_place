// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

const { createApp } = Vue;
const API_BASE_URL = 'http://127.0.0.1:5000/api';
// const API_BASE_URL = 'http://10.11.104.247:7001/api';

// 標準化姓名函數
function normalizeName(name) {
 if (!name) return name;
 
 const nameStr = String(name).trim();
 
 // 將 郭任? 改為 郭任群
 if (nameStr.startsWith('郭任') && nameStr.length === 3) {
   // 如果第三個字不是群，就改為群
   if (nameStr[2] !== '群') {
     console.log(`姓名修正: '${nameStr}' -> '郭任群'`);
     return '郭任群';
   }
 }
 
 return nameStr;
}

createApp({
 data() {
   return {
     selectedItems: [],
     isSending: false,
     remarkOptions: []   // 由後台 accMailData.json 載入
   };
 },
 
 async mounted() {
   await this.loadRemarkOptions();
   await this.loadSelectedItems();
 },
 
 methods: {
   goBack() {
     window.location.href = 'accCheck.html';
   },
   
    // 判斷備註選項是否需要使用者補上內容（以「：」或「:」結尾）
    isFillInRemark(text) {
      const t = String(text || '').trim();
      return t === '尚未領料： 最後領料日為：' || /[:：]$/.test(t);
    },

    onRemarksChange(item) {
      if (this.isFillInRemark(item.remarks)) {
        // 切換為 textarea，讓使用者補日期 / 內容
        item.showTextarea = true;
        item.isCustomRemark = false;
      } else if (item.remarks === '__custom__') {
        // ✏️ 自行輸入：切換為空白 textarea 讓使用者自由輸入內文
        item.showTextarea = true;
        item.isCustomRemark = true;
        item.remarks = '';
      }
    },

    // 從 textarea 返回下拉選單（清空內容重新選擇）
    backToRemarkSelect(item) {
      item.showTextarea = false;
      item.isCustomRemark = false;
      item.remarks = '';
    },

    // ===== 備註選項（accMailData.json）=====
    async loadRemarkOptions() {
      try {
        const res = await fetch(`${API_BASE_URL}/acc-mail-remarks?${siteQuery()}`);
        if (!res.ok) throw new Error('無法取得備註選項');
        const result = await res.json();
        this.remarkOptions = result.remarks || [];
      } catch (err) {
        console.error('載入備註選項失敗:', err);
        this.remarkOptions = [];
        Swal.fire({ icon: 'error', title: '載入備註選項失敗', text: err.message, confirmButtonText: '確定' });
      }
    },

    async addRemarkOption(text) {
      const remark = String(text || '').trim();
      if (!remark) {
        await Swal.fire({ icon: 'warning', title: '備註內容不可為空', confirmButtonText: '確定' });
        return false;
      }
      try {
        const res = await fetch(`${API_BASE_URL}/acc-mail-remarks?${siteQuery()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remark })
        });
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.message || '新增失敗');
        this.remarkOptions = result.remarks || [];
        return true;
      } catch (err) {
        console.error('新增備註選項失敗:', err);
        await Swal.fire({ icon: 'error', title: '新增失敗', text: err.message, confirmButtonText: '確定' });
        return false;
      }
    },

    async removeRemarkOption(text) {
      try {
        const res = await fetch(`${API_BASE_URL}/acc-mail-remarks?${siteQuery()}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remark: text })
        });
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.message || '移除失敗');
        this.remarkOptions = result.remarks || [];
        return true;
      } catch (err) {
        console.error('移除備註選項失敗:', err);
        await Swal.fire({ icon: 'error', title: '移除失敗', text: err.message, confirmButtonText: '確定' });
        return false;
      }
    },

    // 自行輸入 textarea 旁的「＋」：把目前輸入內容存成備註選項
    async saveRemarkAsOption(item) {
      const ok = await this.addRemarkOption(item.remarks);
      if (ok) {
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: '已新增為備註選項', timer: 1500, showConfirmButton: false });
      }
    },

    // 管理備註選項視窗（SweetAlert2）
    openRemarkManager() {
      const escapeHtml = (s) => String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      const renderList = () => {
        if (this.remarkOptions.length === 0) {
          return '<div class="text-gray-400 text-sm py-4">目前沒有任何備註選項</div>';
        }
        return this.remarkOptions.map(opt => `
          <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 text-left text-sm">
            <span class="flex-1 break-all">${escapeHtml(opt)}</span>
            <button type="button"
              class="remark-del-btn shrink-0 text-red-500 hover:text-red-700 px-2"
              data-remark="${escapeHtml(opt)}"
              title="移除">
              <i class="fas fa-trash"></i>
            </button>
          </div>`).join('');
      };

      Swal.fire({
        title: '管理備註選項',
        width: 640,
        html: `
          <div class="flex gap-2 mb-3">
            <input id="remark-new-input" type="text"
              class="flex-1 px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
              placeholder="輸入新的備註內容（以「：」結尾可讓使用者補內容）">
            <button type="button" id="remark-add-btn"
              class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm">
              <i class="fas fa-plus mr-1"></i>新增
            </button>
          </div>
          <div id="remark-list" class="max-h-80 overflow-y-auto border rounded">${renderList()}</div>
        `,
        showConfirmButton: true,
        confirmButtonText: '關閉',
        confirmButtonColor: '#6B7280',
        didOpen: () => {
          const popup = Swal.getPopup();
          const listEl = popup.querySelector('#remark-list');
          const inputEl = popup.querySelector('#remark-new-input');
          const addBtn = popup.querySelector('#remark-add-btn');

          const refresh = () => { listEl.innerHTML = renderList(); };

          const doAdd = async () => {
            const ok = await this.addRemarkOption(inputEl.value);
            if (ok) { inputEl.value = ''; refresh(); }
            inputEl.focus();
          };

          addBtn.addEventListener('click', doAdd);
          inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });

          // 事件委派：刪除按鈕
          listEl.addEventListener('click', async (e) => {
            const btn = e.target.closest('.remark-del-btn');
            if (!btn) return;
            const remark = btn.dataset.remark;
            const ok = await this.removeRemarkOption(remark);
            if (ok) refresh();
          });
        }
      });
    },
   async loadSelectedItems() {
     const selectedItemsJson = localStorage.getItem('selectedItems');
     if (selectedItemsJson) {
       const items = JSON.parse(selectedItemsJson);
       
       // 批量查詢所有需要的 PO No.
       const poNumbers = items.map(item => item.poNo).filter(po => po);
       const userAndEprData = await this.fetchUserAndEprData(poNumbers);
       
       this.selectedItems = items.map((item, index) => {
         const poNo = item.poNo;
         const userData = userAndEprData[poNo] || { user: '查無此資訊', eprNo: '查無此資訊' };
         
         // 根據條件設定狀態
         const processedItem = {
           ...item,
           // 從後台資料設定 User 和 ePR No.
           user: userData.user,
           eprNo: userData.eprNo,
           // 修正取件者姓名
           pickupPerson: normalizeName(item.pickupPerson),
           totalQuantity: item.totalQuantity || item.quantity || '',
            remarks: item.remarks || this.remarkOptions[0] || '',
            showTextarea: this.isFillInRemark(item.remarks),
           // 預設狀態
           materialStatus: 'pending',
           receivedStatus: 'pending', 
           photoStatus: 'pending'
         };
         
          // 檢查取件者欄位來決定領料狀態（使用修正後的姓名）
          const pickupPerson = processedItem.pickupPerson || '';

          // 如果包含 "K7"、"智能櫃" 或符合 "X-1" 格式 → 未領料
          if (pickupPerson.includes('K7') || pickupPerson.includes('智能櫃') || /^[A-Z]-\d+$/.test(pickupPerson)) {
            processedItem.materialStatus = 'completed'; // 未領料
            processedItem.receivedStatus = 'pending';
          } else {
            // 其他 → 已領料
            processedItem.materialStatus = 'pending';
            processedItem.receivedStatus = 'completed';
          }
         
         return processedItem;
       });
     }
   },
   
   async fetchUserAndEprData(poNumbers) {
     try {
       console.log('發送查詢請求，PO Numbers:', poNumbers);
       
       // 呼叫後台API來查詢 User 和 ePR No.
       const response = await fetch(`${API_BASE_URL}/get-user-epr-data?${siteQuery()}`, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json'
         },
         body: JSON.stringify({ poNumbers: poNumbers })
       });
       
       if (!response.ok) {
         throw new Error('無法取得用戶和ePR資料');
       }
       
       const result = await response.json();
       console.log('後台返回的資料:', result);
       
       return result;
       
     } catch (error) {
       console.error('查詢用戶和ePR資料時發生錯誤:', error);
       // 如果API失敗，回傳預設值
       const fallbackData = {};
       poNumbers.forEach(poNo => {
         fallbackData[poNo] = { user: '查無此資訊', eprNo: '查無此資訊' };
       });
       return fallbackData;
     }
   },
   
   shouldSetMaterialStatus(pickupPerson) {
     if (!pickupPerson || pickupPerson === '-') return false;
     
     // 檢查是否包含 "K7" 或 "智能櫃"
     if (pickupPerson.includes('K7') || pickupPerson.includes('智能櫃')) {
       return true;
     }
     
     // 檢查是否符合 "D(任意英文字母)-(數字)" 格式
     const pattern = /D[A-Za-z]-\d+/;
     if (pattern.test(pickupPerson)) {
       return true;
     }
     
     return false;
   },
   
   hasValidIssueDate(issueDate) {
     if (!issueDate || issueDate === '-' || issueDate === '') return false;
     
     // 檢查是否為有效的日期格式
     const datePattern = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/;
     
     if (datePattern.test(issueDate)) {
       const date = new Date(issueDate);
       return !isNaN(date.getTime()) && date.getFullYear() > 1900;
     }
     
     return false;
   },
   
   formatPoItem(poItem) {
     if (!poItem) return '-';
     return parseInt(poItem, 10).toString();
   },
   
   toggleStatus(item, statusType) {
     if (statusType === 'materialStatus') {
       item.materialStatus = item.materialStatus === 'completed' ? 'pending' : 'completed';
     } else if (statusType === 'receivedStatus') {
       item.receivedStatus = item.receivedStatus === 'completed' ? 'pending' : 'completed';
     } else if (statusType === 'photoStatus') {
       item.photoStatus = item.photoStatus === 'provided' ? 'pending' : 'provided';
     }
   },
   
   
   async startSending() {
     if (this.isSending) return;
     
     // ✅ 發送前檢查：備註不可為空（含「自行輸入」後未填寫的情況）
     const emptyRemarkRows = this.selectedItems
       .filter(item => !String(item.remarks || '').trim() || item.remarks === '__custom__')
       .map(item => `PO: ${item.poNo || '-'} / Item: ${item.itemNo || '-'}`);
     if (emptyRemarkRows.length > 0) {
       await Swal.fire({
         icon: 'warning',
         title: '備註尚未填寫',
         html: `以下項目的備註為空，請填寫後再發送：<br><br>${emptyRemarkRows.join('<br>')}`,
         confirmButtonText: '我知道了'
       });
       return;
     }
     
     // 設定發送狀態
     this.isSending = true;
     
     try {
       // 準備要發送的資料
       const dataToSend = {
         action: 'save_changes',
         timestamp: new Date().toISOString(),
         data: this.selectedItems
       };
       
       // 發送到後台
       const response = await fetch(`${API_BASE_URL}/save-mail?${siteQuery()}`, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json'
         },
         body: JSON.stringify(dataToSend)
       });
       
       if (!response.ok) {
         throw new Error('保存失敗');
       }
       
       const result = await response.json();
       console.log('後台回應:', result);
       
       // 清除 localStorage
       localStorage.setItem('selectedItems', JSON.stringify({}));
       
       // 顯示成功訊息並跳轉
       await Swal.fire({
         title: '寄件成功！',
         text: '郵件已成功發送，即將返回主頁面',
         icon: 'success',
         confirmButtonText: '確定',
         confirmButtonColor: '#10B981',
         timer: 3000,
         timerProgressBar: true
       });
       
       // 跳轉回先前介面
       window.location.href = 'accCheck.html';
       
     } catch (error) {
       console.error('發送郵件失敗:', error);
       
       // 顯示錯誤訊息
       await Swal.fire({
         title: '發送失敗！',
         text: `發送郵件時發生錯誤：${error.message}`,
         icon: 'error',
         confirmButtonText: '確定',
         confirmButtonColor: '#EF4444'
       });
       
       // 仍然保存到本地
       localStorage.setItem('selectedItems', JSON.stringify(this.selectedItems));
       
     } finally {
       // 重置發送狀態
       this.isSending = false;
     }
   }
 }
}).mount('#app');