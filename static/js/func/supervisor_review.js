// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

const { createApp } = Vue;

createApp({
    data() {
        return {
            allItems: [],
            selectedIds: [],
            currentTab: 'pending', // pending, all, approved, rejected
            loading: false,
            username: localStorage.getItem('username') || '',
            
            // ========== 細項展開相關 ==========
            expandedRows: {},       // { [itemId]: true/false }
            buyerDetailsMap: {},    // { [itemId]: [...rows] }
            
            // ========== 下拉篩選相關 ==========
            // 篩選器顯示狀態
            showPersonFilter: false,
            showItemFilter: false,
            showOrderFilter: false,
            showReasonFilter: false,
            showAmountFilter: false,
            
            // 已勾選的篩選值
            checkedPeople: [],
            checkedItems: [],
            checkedOrders: [],
            checkedReasons: [],
            checkedAmounts: [],
            
            // 模糊搜尋文字
            itemSearchText: '',
            reasonSearchText: '',
            
            // 排序狀態
            directorSortState: 'none',  // 'none', 'asc', 'desc'
            uncleSortState: 'none',     // 'none', 'asc', 'desc'
            orderSortState: 'none',     // 'none', 'asc', 'desc' - 請購順序
            amountSortState: 'none',    // 'none', 'asc', 'desc' - 總金額
            dateSortState: 'none',      // 'none', 'asc', 'desc' - 需求日
        };
    },
    
    computed: {
        // ========== 當前 Tab 的原始資料（不套用下拉篩選）==========
        currentTabRawItems() {
            return this.allItems.filter(item => {
                const reportPath = item['報告路徑'];
                const wbs = item['WBS'];
                const directorApproval = item['主任簽核'];
                const uncleApproval = item['叔叔簽核'];
                const eprNo = item['ePR No.'];
                
                // 基本條件：報告路徑和 WBS
                if (!reportPath || reportPath.trim() === '' || reportPath.trim() === '-') return false;
                if (wbs && wbs.trim() !== '' && wbs.trim() !== 'V') return false;
                
                // 根據當前 Tab 過濾
                switch(this.currentTab) {
                    case 'pending':
                        if (eprNo && eprNo.trim() !== '') return false;
                        if ((directorApproval && directorApproval.trim() === 'R') || 
                            (uncleApproval && uncleApproval.trim() === 'R')) return false;
                        const directorOk = directorApproval && directorApproval.trim() === 'V';
                        const uncleOk = uncleApproval && uncleApproval.trim() === 'V';
                        if (directorOk && uncleOk) return false;
                        return true;
                    case 'approved':
                        return (directorApproval && directorApproval.trim() === 'V') && 
                               (uncleApproval && uncleApproval.trim() === 'V');
                    case 'rejected':
                        return (directorApproval && directorApproval.trim() === 'R') || 
                               (uncleApproval && uncleApproval.trim() === 'R');
                    case 'all':
                    default:
                        return true;
                }
            });
        },
        
        // ========== 基礎資料篩選（套用下拉篩選後的資料）==========
        baseFilteredItems() {
            return this.currentTabRawItems.filter(item => {
                const matchPerson = this.checkedPeople.length === 0 || this.checkedPeople.includes(item['需求者']);
                const matchItem = this.checkedItems.length === 0 || this.checkedItems.includes(item['請購項目']);
                const matchOrder = this.checkedOrders.length === 0 || this.checkedOrders.includes(String(item['請購順序']).trim());
                const matchReason = this.checkedReasons.length === 0 || this.checkedReasons.includes(item['需求原因']);
                const matchAmount = this.checkedAmounts.length === 0 || this.checkedAmounts.includes(String(item['總金額']).trim());
                
                return matchPerson && matchItem && matchOrder && matchReason && matchAmount;
            });
        },
        
        // displayItems 直接使用 baseFilteredItems（因為 Tab 過濾已經在 currentTabRawItems 中處理）
        displayItems() {
            let items = this.baseFilteredItems;
            
            // 如果沒有任何排序，直接返回
            if (this.directorSortState === 'none' && 
                this.uncleSortState === 'none' && 
                this.orderSortState === 'none' && 
                this.amountSortState === 'none' && 
                this.dateSortState === 'none') {
                return items;
            }
            
            // 主任簽核排序
            if (this.directorSortState !== 'none') {
                return this.sortByDirector(items);
            }
            
            // 叔叔簽核排序
            if (this.uncleSortState !== 'none') {
                return this.sortByUncle(items);
            }
            
            // 請購順序排序
            if (this.orderSortState !== 'none') {
                return this.sortByOrder(items);
            }
            
            // 總金額排序
            if (this.amountSortState !== 'none') {
                return this.sortByAmount(items);
            }
            
            // 需求日排序
            if (this.dateSortState !== 'none') {
                return this.sortByDate(items);
            }
            
            return items;
        },
        
        // 為了保持計數正確，需要這些 computed（不套用下拉篩選）
        pendingItems() {
            return this.allItems.filter(item => {
                const directorApproval = item['主任簽核'];
                const uncleApproval = item['叔叔簽核'];
                const eprNo = item['ePR No.'];
                const reportPath = item['報告路徑'];
                const wbs = item['WBS'];
                
                if (eprNo && eprNo.trim() !== '') return false;
                if (!reportPath || reportPath.trim() === '' || reportPath.trim() === '-') return false;
                if (wbs && wbs.trim() !== '' && wbs.trim() !== 'V') return false;
                if ((directorApproval && directorApproval.trim() === 'R') || 
                    (uncleApproval && uncleApproval.trim() === 'R')) return false;
                
                const directorOk = directorApproval && directorApproval.trim() === 'V';
                const uncleOk = uncleApproval && uncleApproval.trim() === 'V';
                if (directorOk && uncleOk) return false;
                
                return true;
            });
        },
        
        approvedItems() {
            return this.allItems.filter(item => {
                const reportPath = item['報告路徑'];
                const wbs = item['WBS'];
                
                if (!reportPath || reportPath.trim() === '' || reportPath.trim() === '-') return false;
                if (wbs && wbs.trim() !== '' && wbs.trim() !== 'V') return false;
                
                const directorApproval = item['主任簽核'];
                const uncleApproval = item['叔叔簽核'];
                
                return (directorApproval && directorApproval.trim() === 'V') && 
                       (uncleApproval && uncleApproval.trim() === 'V');
            });
        },
        
        rejectedItems() {
            return this.allItems.filter(item => {
                const reportPath = item['報告路徑'];
                const wbs = item['WBS'];
                
                if (!reportPath || reportPath.trim() === '' || reportPath.trim() === '-') return false;
                if (wbs && wbs.trim() !== '' && wbs.trim() !== 'V') return false;
                
                const directorApproval = item['主任簽核'];
                const uncleApproval = item['叔叔簽核'];
                
                return (directorApproval && directorApproval.trim() === 'R') || 
                       (uncleApproval && uncleApproval.trim() === 'R');
            });
        },
        
        allFilteredItems() {
            return this.allItems.filter(item => {
                const reportPath = item['報告路徑'];
                const wbs = item['WBS'];
                
                if (!reportPath || reportPath.trim() === '' || reportPath.trim() === '-') return false;
                if (wbs && wbs.trim() !== '' && wbs.trim() !== 'V') return false;
                
                return true;
            });
        },
        
        isAllSelected() {
            const currentPendingIds = this.currentTab === 'pending' ? 
                this.baseFilteredItems.map(i => i.Id) : [];
            return currentPendingIds.length > 0 && 
                   this.selectedIds.length === currentPendingIds.length;
        },
        
        // ========== 連動篩選：unique 選項（根據當前 Tab 和其他篩選條件動態計算）==========
        // 需求者選項
        uniquePeople() {
            const filtered = this.currentTabRawItems.filter(item => {
                // 套用其他篩選（排除自己）
                const matchItem = this.checkedItems.length === 0 || this.checkedItems.includes(item['請購項目']);
                const matchOrder = this.checkedOrders.length === 0 || this.checkedOrders.includes(String(item['請購順序']).trim());
                const matchReason = this.checkedReasons.length === 0 || this.checkedReasons.includes(item['需求原因']);
                const matchAmount = this.checkedAmounts.length === 0 || this.checkedAmounts.includes(String(item['總金額']).trim());
                
                return matchItem && matchOrder && matchReason && matchAmount;
            });
            return Array.from(new Set(filtered.map(i => i['需求者']).filter(Boolean))).sort();
        },
        
        // 請購項目選項（套用模糊搜尋）
        uniqueItems() {
            const filtered = this.currentTabRawItems.filter(item => {
                const matchPerson = this.checkedPeople.length === 0 || this.checkedPeople.includes(item['需求者']);
                const matchOrder = this.checkedOrders.length === 0 || this.checkedOrders.includes(String(item['請購順序']).trim());
                const matchReason = this.checkedReasons.length === 0 || this.checkedReasons.includes(item['需求原因']);
                const matchAmount = this.checkedAmounts.length === 0 || this.checkedAmounts.includes(String(item['總金額']).trim());
                
                return matchPerson && matchOrder && matchReason && matchAmount;
            });
            
            let items = Array.from(new Set(filtered.map(i => i['請購項目']).filter(Boolean)));
            
            // 套用模糊搜尋
            if (this.itemSearchText) {
                items = items.filter(i => i.toLowerCase().includes(this.itemSearchText.toLowerCase()));
            }
            
            return items.sort();
        },
        
        // 請購順序選項
        uniqueOrders() {
            const filtered = this.currentTabRawItems.filter(item => {
                const matchPerson = this.checkedPeople.length === 0 || this.checkedPeople.includes(item['需求者']);
                const matchItem = this.checkedItems.length === 0 || this.checkedItems.includes(item['請購項目']);
                const matchReason = this.checkedReasons.length === 0 || this.checkedReasons.includes(item['需求原因']);
                const matchAmount = this.checkedAmounts.length === 0 || this.checkedAmounts.includes(String(item['總金額']).trim());
                
                return matchPerson && matchItem && matchReason && matchAmount;
            });
            return Array.from(new Set(filtered.map(i => String(i['請購順序']).trim()).filter(Boolean))).sort((a, b) => Number(a) - Number(b));
        },
        
        // 需求原因選項（套用模糊搜尋）
        uniqueReasons() {
            const filtered = this.currentTabRawItems.filter(item => {
                const matchPerson = this.checkedPeople.length === 0 || this.checkedPeople.includes(item['需求者']);
                const matchItem = this.checkedItems.length === 0 || this.checkedItems.includes(item['請購項目']);
                const matchOrder = this.checkedOrders.length === 0 || this.checkedOrders.includes(String(item['請購順序']).trim());
                const matchAmount = this.checkedAmounts.length === 0 || this.checkedAmounts.includes(String(item['總金額']).trim());
                
                return matchPerson && matchItem && matchOrder && matchAmount;
            });
            
            let reasons = Array.from(new Set(filtered.map(i => i['需求原因']).filter(Boolean)));
            
            // 套用模糊搜尋
            if (this.reasonSearchText) {
                reasons = reasons.filter(r => r.toLowerCase().includes(this.reasonSearchText.toLowerCase()));
            }
            
            return reasons.sort();
        },
        
        // 總金額選項
        uniqueAmounts() {
            const filtered = this.currentTabRawItems.filter(item => {
                const matchPerson = this.checkedPeople.length === 0 || this.checkedPeople.includes(item['需求者']);
                const matchItem = this.checkedItems.length === 0 || this.checkedItems.includes(item['請購項目']);
                const matchOrder = this.checkedOrders.length === 0 || this.checkedOrders.includes(String(item['請購順序']).trim());
                const matchReason = this.checkedReasons.length === 0 || this.checkedReasons.includes(item['需求原因']);
                
                return matchPerson && matchItem && matchOrder && matchReason;
            });
            return Array.from(new Set(filtered.map(i => String(i['總金額']).trim()).filter(Boolean)))
                .sort((a, b) => Number(a.replace(/,/g, '')) - Number(b.replace(/,/g, '')));
        },
        
        // ========== 篩選狀態指示器 ==========
        isPeopleFiltered() { return this.checkedPeople.length > 0; },
        isItemsFiltered() { return this.checkedItems.length > 0; },
        isOrdersFiltered() { return this.checkedOrders.length > 0; },
        isReasonsFiltered() { return this.checkedReasons.length > 0; },
        isAmountsFiltered() { return this.checkedAmounts.length > 0; },
        
        // 是否有任何篩選生效
        hasAnyFilter() {
            return this.checkedPeople.length > 0 ||
                   this.checkedItems.length > 0 ||
                   this.checkedOrders.length > 0 ||
                   this.checkedReasons.length > 0 ||
                   this.checkedAmounts.length > 0;
        },

        // 細項展開列的 colspan（依目前 Tab 的實際欄位數）
        detailColspan() {
            switch(this.currentTab) {
                case 'pending':  return 14;  // checkbox + # + 12欄
                case 'approved': return 12;  // # + 11欄（含退回）
                case 'rejected': return 14;  // # + 13欄（含處理）
                case 'all':      return 13;  // # + 12欄（含主任+管裡）
                default:         return 14;
            }
        }
    },
    
    methods: {
        // ========== 排序方法 ==========
        toggleDirectorSort() {
            // 重置叔叔簽核狀態（同一時間只能有一個排序）
            this.uncleSortState = 'none';
            this.orderSortState = 'none';
            this.amountSortState = 'none';
            this.dateSortState = 'none';
            
            if (this.directorSortState === 'none') {
                this.directorSortState = 'asc';
            } else if (this.directorSortState === 'asc') {
                this.directorSortState = 'desc';
            } else {
                this.directorSortState = 'none';
            }
        },
        
        toggleUncleSort() {
            // 重置主任簽核狀態（同一時間只能有一個排序）
            this.directorSortState = 'none';
            this.orderSortState = 'none';
            this.amountSortState = 'none';
            this.dateSortState = 'none';
            
            if (this.uncleSortState === 'none') {
                this.uncleSortState = 'asc';
            } else if (this.uncleSortState === 'asc') {
                this.uncleSortState = 'desc';
            } else {
                this.uncleSortState = 'none';
            }
        },
        
        // 請購順序排序切換
        toggleOrderSort() {
            // 重置其他排序
            this.directorSortState = 'none';
            this.uncleSortState = 'none';
            this.amountSortState = 'none';
            this.dateSortState = 'none';
            
            if (this.orderSortState === 'none') {
                this.orderSortState = 'asc';
            } else if (this.orderSortState === 'asc') {
                this.orderSortState = 'desc';
            } else {
                this.orderSortState = 'none';
            }
        },
        
        // 總金額排序切換
        toggleAmountSort() {
            // 重置其他排序
            this.directorSortState = 'none';
            this.uncleSortState = 'none';
            this.orderSortState = 'none';
            this.dateSortState = 'none';
            
            if (this.amountSortState === 'none') {
                this.amountSortState = 'asc';
            } else if (this.amountSortState === 'asc') {
                this.amountSortState = 'desc';
            } else {
                this.amountSortState = 'none';
            }
        },
        
        // 需求日排序切換
        toggleDateSort() {
            // 重置其他排序
            this.directorSortState = 'none';
            this.uncleSortState = 'none';
            this.orderSortState = 'none';
            this.amountSortState = 'none';
            
            if (this.dateSortState === 'none') {
                this.dateSortState = 'asc';
            } else if (this.dateSortState === 'asc') {
                this.dateSortState = 'desc';
            } else {
                this.dateSortState = 'none';
            }
        },
        
        // 主任簽核排序 function
        sortByDirector(items) {
            const sorted = [...items];
            
            sorted.sort((a, b) => {
                const aVal = a['主任簽核'] || '';
                const bVal = b['主任簽核'] || '';
                const aStatus = (aVal.trim() === 'V') ? 1 : (aVal.trim() === 'R' ? 2 : 0);
                const bStatus = (bVal.trim() === 'V') ? 1 : (bVal.trim() === 'R' ? 2 : 0);
                
                if (this.directorSortState === 'asc') {
                    // 未簽核在上: 0 < 1 < 2
                    return aStatus - bStatus;
                } else {
                    // 簽核完成在上: 1 < 2 < 0
                    const order = {1: 0, 2: 1, 0: 2};
                    return order[aStatus] - order[bStatus];
                }
            });
            
            return sorted;
        },
        
        // 叔叔簽核排序 function（按主任簽核狀態排序）
        sortByUncle(items) {
            const sorted = [...items];
            
            sorted.sort((a, b) => {
                // 取得主任簽核狀態（因為叔叔要等主任簽完）
                const aVal = a['主任簽核'] || '';
                const bVal = b['主任簽核'] || '';
                // V=已簽(1), 其他=未簽(0)
                const aStatus = (aVal.trim() === 'V') ? 1 : 0;
                const bStatus = (bVal.trim() === 'V') ? 1 : 0;
                
                if (this.uncleSortState === 'asc') {
                    // 箭頭向上：主任簽完的在上 (1 < 0)
                    return bStatus - aStatus;
                } else {
                    // 箭頭向下：主任沒簽的在上 (0 < 1)
                    return aStatus - bStatus;
                }
            });
            
            return sorted;
        },
        
        // 請購順序排序 function
        sortByOrder(items) {
            const sorted = [...items];
            
            sorted.sort((a, b) => {
                const aOrder = parseInt(a['請購順序']) || 0;
                const bOrder = parseInt(b['請購順序']) || 0;
                
                if (this.orderSortState === 'asc') {
                    // 小到大
                    return aOrder - bOrder;
                } else {
                    // 大到小
                    return bOrder - aOrder;
                }
            });
            
            return sorted;
        },
        
        // 總金額排序 function
        sortByAmount(items) {
            const sorted = [...items];
            
            sorted.sort((a, b) => {
                const aAmount = parseFloat(a['總金額']) || 0;
                const bAmount = parseFloat(b['總金額']) || 0;
                
                if (this.amountSortState === 'asc') {
                    // 小到大
                    return aAmount - bAmount;
                } else {
                    // 大到小
                    return bAmount - aAmount;
                }
            });
            
            return sorted;
        },
        
        // 需求日排序 function
        sortByDate(items) {
            const sorted = [...items];
            
            sorted.sort((a, b) => {
                const aDate = a['需求日'] || '';
                const bDate = b['需求日'] || '';
                
                if (this.dateSortState === 'asc') {
                    // 舊到新
                    return aDate.localeCompare(bDate);
                } else {
                    // 新到舊
                    return bDate.localeCompare(aDate);
                }
            });
            
            return sorted;
        },
        
        // ========== 下拉篩選相關 ==========
        toggleDropdown(filterName) {
            const wasOpen = this[filterName];
            this.closeAllDropdowns();
            this[filterName] = !wasOpen;
            
            // 下拉選單打開後重新渲染圖標
            if (this[filterName]) {
                this.$nextTick(() => {
                    if (typeof lucide !== 'undefined') {
                        lucide.createIcons();
                    }
                });
            }
        },
        
        closeAllDropdowns() {
            this.showPersonFilter = false;
            this.showItemFilter = false;
            this.showOrderFilter = false;
            this.showReasonFilter = false;
            this.showAmountFilter = false;
        },
        
        clearPersonFilter() {
            this.checkedPeople = [];
            this.showPersonFilter = false;
        },
        
        clearItemFilter() {
            this.checkedItems = [];
            this.itemSearchText = '';
            this.showItemFilter = false;
        },
        
        clearOrderFilter() {
            this.checkedOrders = [];
            this.showOrderFilter = false;
        },
        
        clearReasonFilter() {
            this.checkedReasons = [];
            this.reasonSearchText = '';
            this.showReasonFilter = false;
        },
        
        clearAmountFilter() {
            this.checkedAmounts = [];
            this.showAmountFilter = false;
        },
        
        resetAllFilters() {
            this.checkedPeople = [];
            this.checkedItems = [];
            this.checkedOrders = [];
            this.checkedReasons = [];
            this.checkedAmounts = [];
            this.itemSearchText = '';
            this.reasonSearchText = '';
            this.directorSortState = 'none';
            this.uncleSortState = 'none';
            this.orderSortState = 'none';
            this.amountSortState = 'none';
            this.dateSortState = 'none';
            this.closeAllDropdowns();
        },
        
        // ========== 資料載入 ==========
        async loadData() {
            this.loading = true;
            try {
                const response = await fetch(`http://127.0.0.1:5000/api/get-all-items-with-approval?${siteQuery()}`);
                const data = await response.json();
                
                if (data.status === 'success') {
                    this.allItems = data.items;
                    console.log('✅ 資料載入成功，共', data.items.length, '筆');
                } else {
                    console.error('❌ 資料載入失敗:', data.message);
                }
            } catch (error) {
                console.error('❌ 網路錯誤:', error);
            } finally {
                this.loading = false;
                this.$nextTick(() => {
                    if (typeof lucide !== 'undefined') {
                        lucide.createIcons();
                    }
                });
            }
        },
        
        // ========== 載入 Buyer_detail 細項資料 ==========
        async loadBuyerDetails() {
            try {
                const response = await fetch(`http://127.0.0.1:5000/api/buyer_detail?${siteQuery()}`);
                const data = await response.json();

                if (!Array.isArray(data)) {
                    console.error('❌ Buyer_detail 格式錯誤:', data);
                    return;
                }

                // 平面陣列依 Id 分組成 { [Id]: [...rows] }
                const grouped = {};
                for (const row of data) {
                    const id = String(row['Id'] ?? '').trim();
                    if (!id) continue;
                    if (!grouped[id]) grouped[id] = [];
                    grouped[id].push(row);
                }

                this.buyerDetailsMap = grouped;
                console.log('✅ Buyer_detail 細項載入成功，共', data.length, '筆');

            } catch (error) {
                console.error('❌ Buyer_detail 網路錯誤:', error);
            }
        },
        
        // ========== 展開 / 收合細項列 ==========
        toggleRow(itemId) {
            const id = String(itemId);
            this.expandedRows = {
                ...this.expandedRows,
                [id]: !this.expandedRows[id]
            };
        },
        
        isRowExpanded(itemId) {
            return !!this.expandedRows[String(itemId)];
        },
        
        // 取得某筆的 Buyer_detail 細項（依 Id 對應）
        getBuyerDetails(itemId) {
            return this.buyerDetailsMap[String(itemId)] || [];
        },
        
        // 驗收狀態 badge class
        getAcceptanceStatusClass(status) {
            const s = (status || '').trim();
            if (s === 'V' || s === '已驗收') return 'bg-green-100 text-green-800';
            if (s === 'R' || s === '拒收') return 'bg-red-100 text-red-800';
            if (s === 'X' || s === '未驗收') return 'bg-gray-100 text-gray-600';
            return 'bg-gray-100 text-gray-600';
        },
        
        // 開單狀態 badge class
        getOrderStatusClass(status) {
            const s = (status || '').trim();
            if (s === 'V') return 'bg-blue-100 text-blue-800';
            if (s === 'X') return 'bg-gray-100 text-gray-500';
            return 'bg-gray-100 text-gray-500';
        },
        
        // ========== 複製報告路徑 ==========
        async copyPath(path) {
            try {
                await navigator.clipboard.writeText(path);
            } catch {
                // Fallback for older browsers
                const el = document.createElement('textarea');
                el.value = path;
                el.style.position = 'fixed';
                el.style.opacity = '0';
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
            }
            Swal.fire({
                icon: 'success',
                title: '已複製路徑',
                text: path,
                timer: 1800,
                showConfirmButton: false,
                toast: true,
                position: 'top-end'
            });
        },
        
        // ========== 選擇相關 ==========
        selectAll() {
            // 只在待審核 Tab 時選取當前顯示的項目
            if (this.currentTab === 'pending') {
                this.selectedIds = this.displayItems.map(item => item.Id);
            }
        },
        
        clearSelection() {
            this.selectedIds = [];
        },
        
        toggleSelectAll(event) {
            if (event.target.checked) {
                this.selectAll();
            } else {
                this.clearSelection();
            }
        },
        
        // ========== 狀態顯示 ==========
        getOverallStatusClass(item) {
            const director = item['主任簽核'];
            const uncle = item['叔叔簽核'];
            
            if ((director && director.trim() === 'R') || (uncle && uncle.trim() === 'R')) {
                return 'status-badge status-rejected';
            }
            if ((director && director.trim() === 'V') && (uncle && uncle.trim() === 'V')) {
                return 'status-badge status-approved';
            }
            return 'status-badge status-pending';
        },
        
        getOverallStatusText(item) {
            const director = item['主任簽核'];
            const uncle = item['叔叔簽核'];
            
            if ((director && director.trim() === 'R') || (uncle && uncle.trim() === 'R')) {
                return '已退回';
            }
            if ((director && director.trim() === 'V') && (uncle && uncle.trim() === 'V')) {
                return '已確認';
            }
            return '待審核';
        },
        
        getApprovalStatusClass(status) {
            const s = status ? status.trim() : '';
            if (s === 'V') return 'bg-green-100 text-green-800';
            if (s === 'R') return 'bg-red-100 text-red-800';
            return 'bg-yellow-100 text-yellow-800';
        },
        
        getApprovalStatusText(status) {
            const s = status ? status.trim() : '';
            if (s === 'V') return '✓';
            if (s === 'R') return '✗';
            return '待審';
        },
        
        // ========== 格式化 ==========
        formatDate(dateStr) {
            if (!dateStr) return '-';
            const d = String(dateStr).trim();
            if (d.length === 8) {
                return `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
            }
            return d;
        },
        
        formatMoney(value) {
            if (!value) return '-';
            const num = Number(String(value).replace(/,/g, ''));
            if (isNaN(num)) return value;
            return num.toLocaleString();
        },
        
        // ========== 主任簽核 ==========
        async approveDirector(itemId) {
            try {
                const response = await fetch(`http://127.0.0.1:5000/api/approve-items?${siteQuery()}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        item_ids: [itemId],
                        approve_director: true,
                        approve_uncle: false
                    })
                });
                
                const data = await response.json();
                if (data.status === 'success') {
                    await this.loadData();
                    Swal.fire({ icon: 'success', title: '主任簽核通過', timer: 1500, showConfirmButton: false });
                }
            } catch (error) {
                console.error('主任簽核錯誤:', error);
                Swal.fire({ icon: 'error', title: '操作失敗', text: error.message });
            }
        },
        
        async rejectDirector(itemId) {
            const { value: reason } = await Swal.fire({
                title: '主任退回原因',
                input: 'textarea',
                inputPlaceholder: '請輸入退回原因...',
                showCancelButton: true,
                confirmButtonText: '確定退回',
                cancelButtonText: '取消',
                confirmButtonColor: '#ef4444',
                inputValidator: (value) => {
                    if (!value || !value.trim()) return '請輸入退回原因！';
                }
            });
            
            if (reason) {
                try {
                    const response = await fetch(`http://127.0.0.1:5000/api/reject-items?${siteQuery()}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            item_ids: [itemId],
                            reject_reason: reason,
                            reject_stage: 'director'
                        })
                    });
                    
                    const data = await response.json();
                    if (data.status === 'success') {
                        await this.loadData();
                        Swal.fire({ icon: 'success', title: '已退回', timer: 1500, showConfirmButton: false });
                    }
                } catch (error) {
                    console.error('退回錯誤:', error);
                    Swal.fire({ icon: 'error', title: '操作失敗', text: error.message });
                }
            }
        },
        
        // ========== 叔叔簽核 ==========
        async approveUncle(itemId) {
            try {
                const response = await fetch(`http://127.0.0.1:5000/api/approve-items?${siteQuery()}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        item_ids: [itemId],
                        approve_director: false,
                        approve_uncle: true
                    })
                });
                
                const data = await response.json();
                if (data.status === 'success') {
                    await this.loadData();
                    Swal.fire({ icon: 'success', title: '叔叔簽核通過', timer: 1500, showConfirmButton: false });
                }
            } catch (error) {
                console.error('叔叔簽核錯誤:', error);
                Swal.fire({ icon: 'error', title: '操作失敗', text: error.message });
            }
        },
        
        async rejectUncle(itemId) {
            const { value: reason } = await Swal.fire({
                title: '叔叔退回原因',
                input: 'textarea',
                inputPlaceholder: '請輸入退回原因...',
                showCancelButton: true,
                confirmButtonText: '確定退回',
                cancelButtonText: '取消',
                confirmButtonColor: '#ef4444',
                inputValidator: (value) => {
                    if (!value || !value.trim()) return '請輸入退回原因！';
                }
            });
            
            if (reason) {
                try {
                    const response = await fetch(`http://127.0.0.1:5000/api/reject-items?${siteQuery()}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            item_ids: [itemId],
                            reject_reason: reason,
                            reject_stage: 'uncle'
                        })
                    });
                    
                    const data = await response.json();
                    if (data.status === 'success') {
                        await this.loadData();
                        Swal.fire({ icon: 'success', title: '已退回', timer: 1500, showConfirmButton: false });
                    }
                } catch (error) {
                    console.error('退回錯誤:', error);
                    Swal.fire({ icon: 'error', title: '操作失敗', text: error.message });
                }
            }
        },
        
        // ========== 批次操作 ==========
        async approveSelected() {
            if (this.selectedIds.length === 0) return;
            
            const { value: stage } = await Swal.fire({
                title: '批次簽核確認',
                html: `
                    <p class="mb-4">確定要通過 <strong>${this.selectedIds.length}</strong> 筆資料嗎？</p>
                    <p class="text-sm text-gray-600 mb-2">請選擇要確認的簽核階段：</p>
                `,
                input: 'select',
                inputOptions: {
                    'director': '主任簽核',
                    'uncle': '叔叔簽核',
                    'both': '兩者都通過'
                },
                inputPlaceholder: '請選擇',
                showCancelButton: true,
                confirmButtonText: '確定',
                cancelButtonText: '取消',
                confirmButtonColor: '#22c55e',
                inputValidator: (value) => {
                    if (!value) return '請選擇簽核階段！';
                }
            });
            
            if (stage) {
                try {
                    const response = await fetch(`http://127.0.0.1:5000/api/approve-items?${siteQuery()}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            item_ids: this.selectedIds,
                            approve_director: stage === 'director' || stage === 'both',
                            approve_uncle: stage === 'uncle' || stage === 'both'
                        })
                    });
                    
                    const data = await response.json();
                    if (data.status === 'success') {
                        Swal.fire({ icon: 'success', title: '批次確認成功', text: data.message, timer: 2000, showConfirmButton: false });
                        await this.loadData();
                        this.clearSelection();
                    }
                } catch (error) {
                    console.error('批次確認錯誤:', error);
                    Swal.fire({ icon: 'error', title: '操作失敗', text: error.message });
                }
            }
        },
        
        async rejectSelected() {
            if (this.selectedIds.length === 0) return;
            
            const { value: formValues } = await Swal.fire({
                title: '批次退回',
                html: `
                    <p class="mb-4">確定要退回 <strong>${this.selectedIds.length}</strong> 筆資料嗎？</p>
                    <div class="text-left mb-3">
                        <label class="block text-sm font-medium text-gray-700 mb-1">退回階段</label>
                        <select id="swal-stage" class="w-full border border-gray-300 rounded px-3 py-2">
                            <option value="director">主任簽核退回</option>
                            <option value="uncle">叔叔簽核退回</option>
                        </select>
                    </div>
                    <div class="text-left">
                        <label class="block text-sm font-medium text-gray-700 mb-1">退回原因</label>
                        <textarea id="swal-reason" class="w-full border border-gray-300 rounded px-3 py-2" rows="3" placeholder="請輸入退回原因..."></textarea>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: '確定退回',
                cancelButtonText: '取消',
                confirmButtonColor: '#ef4444',
                preConfirm: () => {
                    const stage = document.getElementById('swal-stage').value;
                    const reason = document.getElementById('swal-reason').value;
                    if (!reason || !reason.trim()) {
                        Swal.showValidationMessage('請輸入退回原因！');
                        return false;
                    }
                    return { stage, reason };
                }
            });
            
            if (formValues) {
                try {
                    const response = await fetch(`http://127.0.0.1:5000/api/reject-items?${siteQuery()}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            item_ids: this.selectedIds,
                            reject_reason: formValues.reason,
                            reject_stage: formValues.stage
                        })
                    });
                    
                    const data = await response.json();
                    if (data.status === 'success') {
                        Swal.fire({ icon: 'success', title: '退回成功', text: data.message, timer: 2000, showConfirmButton: false });
                        await this.loadData();
                        this.clearSelection();
                    }
                } catch (error) {
                    console.error('退回錯誤:', error);
                    Swal.fire({ icon: 'error', title: '退回失敗', text: error.message });
                }
            }
        },
        
        // ========== 已確認頁面的退回功能 ==========
        async rejectFromApproved(itemId) {
            const item = this.allItems.find(i => String(i.Id).trim() === String(itemId).trim());
            if (!item) {
                Swal.fire({ icon: 'error', title: '找不到資料', text: `找不到 ID 為 ${itemId} 的資料` });
                return;
            }
            
            const formValues = await Swal.fire({
                icon: 'warning',
                title: '退回確認',
                html: `
                    <div class="text-left">
                        <p class="mb-3 text-sm text-gray-600">確定要退回此筆已確認的申請嗎？</p>
                        <div class="mb-3">
                            <label class="block text-sm font-medium text-gray-700 mb-1">退回原因 <span class="text-red-500">*</span></label>
                            <textarea id="swal-reject-reason" class="w-full border border-gray-300 rounded px-3 py-2 text-sm" 
                                      rows="3" placeholder="請輸入退回原因..."></textarea>
                        </div>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: '確認退回',
                cancelButtonText: '取消',
                confirmButtonColor: '#ef4444',
                cancelButtonColor: '#6b7280',
                preConfirm: () => {
                    const reason = document.getElementById('swal-reject-reason').value;
                    if (!reason || !reason.trim()) {
                        Swal.showValidationMessage('請輸入退回原因！');
                        return false;
                    }
                    return { reason };
                }
            });
            
            if (formValues.isConfirmed) {
                try {
                    const response = await fetch(`http://127.0.0.1:5000/api/reject-approved-to-pending?${siteQuery()}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            item_id: itemId,
                            reject_reason: formValues.value.reason
                        })
                    });
                    
                    const data = await response.json();
                    if (data.status === 'success') {
                        Swal.fire({ icon: 'success', title: '退回成功', text: '已退回至待簽核', timer: 2000, showConfirmButton: false });
                        await this.loadData();
                    } else {
                        Swal.fire({ icon: 'error', title: '退回失敗', text: data.message });
                    }
                } catch (error) {
                    console.error('退回錯誤:', error);
                    Swal.fire({ icon: 'error', title: '退回失敗', text: error.message });
                }
            }
        },
        
        // ========== 處理退回資料 ==========
        async clearRemarkAndApprove(itemId) {
            const item = this.allItems.find(i => String(i.Id).trim() === String(itemId).trim());
            if (!item) {
                Swal.fire({ icon: 'error', title: '找不到資料', text: `找不到 ID 為 ${itemId} 的資料` });
                return;
            }
            
            const directorStatus = item['主任簽核'] ? item['主任簽核'].trim() : 'X';
            const uncleStatus = item['叔叔簽核'] ? item['叔叔簽核'].trim() : 'X';
            
            let rejectStage = '';
            let confirmHtml = '';
            
            if (directorStatus === 'R') {
                rejectStage = 'director';
                confirmHtml = `
                    <p class="mb-2">確定此筆資料已處理完成嗎？</p>
                    <p class="text-sm text-gray-600">將會執行以下操作：</p>
                    <ul class="text-sm text-left mt-2 ml-8 list-disc text-gray-700">
                        <li>清除退回原因（保留原本備註）</li>
                        <li>主任簽核改為「✓ 通過」</li>
                        <li>叔叔簽核維持「待審」</li>
                    </ul>
                    <p class="text-sm text-blue-600 mt-2">※ 處理完成後由叔叔繼續簽核</p>
                `;
            } else if (uncleStatus === 'R') {
                rejectStage = 'uncle';
                confirmHtml = `
                    <p class="mb-2">確定此筆資料已處理完成嗎？</p>
                    <p class="text-sm text-gray-600">將會執行以下操作：</p>
                    <ul class="text-sm text-left mt-2 ml-8 list-disc text-gray-700">
                        <li>清除退回原因（保留原本備註）</li>
                        <li>主任簽核維持「✓ 通過」</li>
                        <li>叔叔簽核改為「✓ 通過」</li>
                    </ul>
                    <p class="text-sm text-green-600 mt-2">※ 處理完成後簽核流程完成</p>
                `;
            } else {
                rejectStage = 'unknown';
                confirmHtml = `
                    <p class="mb-2">確定此筆資料已處理完成嗎？</p>
                    <p class="text-sm text-gray-600">將會清除退回原因（保留原本備註）</p>
                `;
            }
            
            const result = await Swal.fire({
                icon: 'question',
                title: '處理完成確認',
                html: confirmHtml,
                showCancelButton: true,
                confirmButtonText: '確定',
                cancelButtonText: '取消',
                confirmButtonColor: '#8b5cf6',
                cancelButtonColor: '#6b7280'
            });
            
            if (result.isConfirmed) {
                try {
                    const response = await fetch(`http://127.0.0.1:5000/api/clear-remark-and-approve?${siteQuery()}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ item_id: itemId, reject_stage: rejectStage })
                    });
                    
                    const data = await response.json();
                    if (data.status === 'success') {
                        Swal.fire({ icon: 'success', title: '處理成功', text: data.message, timer: 2000, showConfirmButton: false });
                        await this.loadData();
                    }
                } catch (error) {
                    console.error('處理失敗:', error);
                    Swal.fire({ icon: 'error', title: '處理失敗', text: error.message });
                }
            }
        },
        
        // ========== 導航 ==========
        goBackToPurchaseHome() {
            window.location.href = 'Procurement_Dynamic_360_Dashboard.html';
        },
        
        // ========== 簽核權限檢查 ==========
        canApprove(item, stage) {
            const status = item[stage === 'director' ? '主任簽核' : '叔叔簽核'];
            const isNotApproved = !status || status.trim() === 'X' || status.trim() === '';
            
            if (stage === 'uncle') {
                const directorStatus = item['主任簽核'];
                const directorApproved = directorStatus && directorStatus.trim() === 'V';
                return isNotApproved && directorApproved;
            }
            
            return isNotApproved;
        },
        
        isWaitingForDirector(item) {
            const directorStatus = item['主任簽核'];
            const uncleStatus = item['叔叔簽核'];
            
            const directorNotApproved = !directorStatus || directorStatus.trim() === 'X' || directorStatus.trim() === '';
            const uncleNotApproved = !uncleStatus || uncleStatus.trim() === 'X' || uncleStatus.trim() === '';
            
            return directorNotApproved && uncleNotApproved;
        }
    },

    watch: {
        currentTab() {
            // 切換 Tab 時清除選擇和篩選
            this.selectedIds = [];
            this.resetAllFilters();
            
            this.$nextTick(() => {
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            });
        },
        
        // 當篩選狀態變化時，重新渲染圖標（特別是「清除篩選」按鈕的圖標）
        hasAnyFilter() {
            this.$nextTick(() => {
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            });
        }
    },
    
    mounted() {
        this.loadData();
        this.loadBuyerDetails();
        
        this.$nextTick(() => {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        });
        
        // 每30秒自動重新整理
        setInterval(() => {
            if (!this.loading) {
                this.loadData();
            }
        }, 30000);
        
        // 點擊其他地方關閉下拉選單
        document.addEventListener('click', (e) => {
            const isDropdownClick = e.target.closest('.filter-dropdown-wrapper');
            if (!isDropdownClick) {
                this.closeAllDropdowns();
            }
        });
    }
}).mount('#app');