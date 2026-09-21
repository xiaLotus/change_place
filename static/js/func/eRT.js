// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

const app = Vue.createApp({
    data() {
        return {
            username: '',
            admins: [],
            data: [],
            items: [],
            tableHeaders: [
                "交貨驗證",
                "驗收狀態",
                "ePR No.",
                "PO No.",
                "Item",
                "品項",
                "規格",
                "數量",
                "總數",
                "單價",
                "總價",
                "RT金額",
                "RT總金額",
                "備註",
                "Delivery Date 廠商承諾交期",
                "SOD Qty 廠商承諾數量",
                "驗收數量",
                "拒收數量",
                "發票月份",
                "WBS",
                "需求日"
            ],
            globalSearch: '',

            showAcceptanceFilter: false,
            showEPRFilter: false,
            showPOFilter: false,
            showITEMFilter: false,
            showNAMEFilter: false,
            showSPECFilter: false,
            showQTYFilter: false,
            showTOTALQTYFilter: false,
            showPRICEFilter: false,
            showTOTALFilter: false,
            showREMARKFilter: false,
            showDELIVERYFilter: false,
            showSODFilter: false,
            showACCEPTFilter: false,
            showREJECTFilter: false,
            showINVOICEFilter: false,

            showWBSFilter: false,        // 新增
            showDEMANDDATEFilter: false, // 新增
            showRTFilter: false,
            showReceiveStatusFilter: false,
            showRTTOTALFilter: false,

            checkedAcceptances: [],
            checkedEPRs: [],
            checkedPOs: [],
            checkedItems: [],
            checkedNames: [],
            checkedSpecs: [],
            checkedQtys: [],
            checkedTotalQtys: [],
            checkedPrices: [],
            checkedTotals: [],
            checkedRemarks: [],
            checkedDeliverys: [],
            checkedSods: [],
            checkedAccepts: [],
            checkedRejects: [],
            checkedInvoices: [],
            checkedWBSs: [],        // 新增
            checkedDemandDates: [], // 新增
            checkedRTs: [],
            checkedReceiveStatuses: [],
            checkedRTTotals: [],

            unaccounted_amount: 0,
            accounting_summary: {}, // 3.py
            lastmonthcurent: 0, // 2_4.py
            nowmonthcurent: 0, // 2_4.py
            purchasebudget: 0,
            supplementarybudget: 0,
            totalused: 0,
            remaining: 0,
            maxpurchasebudget: 0,

            unaccountedDetails: '',
            // 添加彈窗控制變數
            // 添加未入帳彈窗控制變數
            showUnaccountedModal: false,
            
            // 確保這些變數存在並初始化
            unaccounted_amount: 0,
            unaccountedDetails: [],
            isLoadingDetails: false,
            // 第二個彈窗：上月/本月實際入帳共用
            showActualModal: false,
            actualModalType: '', // 'lastMonth' 或 'currentMonth'
            isLoadingActual: false,
            lastMonthDetails: [],
            currentMonthDetails: [],
            
            // 第三個彈窗：本月尚未入帳
            showCurrentNoneModal: false,
            isLoadingCurrentNone: false,
            currentNoneDetails: [],
            accounting_summary: {}, // 原有的摘要資料
            accounting_full_data: null, // 完整的 API 回傳資料

              // 原有變數
            currentMonthData: [],           // 從 fetchAccountingSummary 提取的資料
            currentMonthAmount: 0,          // 從 fetchAccountingSummary 提取的金額
            
            // 模態框專用變數（要和 HTML 中的變數名稱一致）
            currentNoneDetails: [],         // 模態框中使用的詳細資料
            currentNoneMonthAmount: 0,      // 模態框中使用的金額
            showCurrentNoneModal: false,    // 控制模態框顯示
            isLoadingCurrentNone: false,    // 載入狀態

            // 新增欄位選擇器相關屬性
            showColumnSelector: false,
            visibleColumns: [
                "交貨驗證",
                "驗收狀態", 
                "ePR No.",
                "PO No.",
                "Item",
                "品項",
                "規格",
                "數量",
                "總數",
                "單價",
                "總價",
                "RT金額",
                "RT總金額",
                "備註",
                "WBS",
                "需求日"
            ], // 預設顯示的欄位
            // 編輯功能相關
            // 修改後：
            showEditModal: false,
            editingItems: [],  // ⭐ 改成陣列，存放同 Id 的所有資料
            editingId: null,   // ⭐ 記錄當前編輯的 Id
            editingIndex: -1,
            // ========== 新增：防止載入時觸發保存的標記 ==========
            _isLoadingFilters: false,
            _saveTimeout: null,

            // ⭐ 新增：下個月預計入帳相關變數（在最後添加這 4 個）
            nextMonthAmount: 0,
            nextMonthDetails: [],
            showNextMonthModal: false,
            isLoadingNextMonth: false,
        };
    },

    computed: {
        // 判斷是否為 admin
        isAdmin() {
            return this.admins.includes(this.username);
        },
            // ========== 加在這裡 ========== 
    hasFilterActive() {
        return {
            '交貨驗證': this.checkedAcceptances.length > 0,
            '驗收狀態': this.checkedReceiveStatuses.length > 0,
            'ePR No.': this.checkedEPRs.length > 0,
            'PO No.': this.checkedPOs.length > 0,
            'Item': this.checkedItems.length > 0,
            '品項': this.checkedNames.length > 0,
            '規格': this.checkedSpecs.length > 0,
            '數量': this.checkedQtys.length > 0,
            '總數': this.checkedTotalQtys.length > 0,
            '單價': this.checkedPrices.length > 0,
            '總價': this.checkedTotals.length > 0,
            'RT金額': this.checkedRTs.length > 0,
            'RT總金額': this.checkedRTTotals.length > 0,
            '備註': this.checkedRemarks.length > 0,
            'Delivery Date 廠商承諾交期': this.checkedDeliverys.length > 0,
            'SOD Qty 廠商承諾數量': this.checkedSods.length > 0,
            '驗收數量': this.checkedAccepts.length > 0,
            '拒收數量': this.checkedRejects.length > 0,
            '發票月份': this.checkedInvoices.length > 0,
            'WBS': this.checkedWBSs.length > 0,
            '需求日': this.checkedDemandDates.length > 0
        };
    },

    getHeaderClass() {
        return (columnName) => {
            const baseClass = 'relative py-3 px-4 text-sm font-semibold text-gray-700 text-center whitespace-nowrap bg-gray-100 z-30';
            const filteredClass = 'bg-blue-200 text-blue-900 shadow-inner';
            return this.hasFilterActive[columnName] 
                ? `${baseClass} ${filteredClass}` 
                : baseClass;
        };
    },

        filteredData() {
            const baseData = this.items;
            return baseData.filter(i => {
                const keyword = this.globalSearch.trim().toLowerCase();
                if (keyword) {
                    const matched = Object.values(i).some(val =>
                        String(val).toLowerCase().includes(keyword)
                    );
                    if (!matched) return false;
                }
                // const matchAcceptance = this.checkedAcceptances.length === 0 || this.checkedAcceptances.includes(i['交貨驗證']);
                // 修改交貨驗證的匹配邏輯
                let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const actualValue = i['交貨驗證'];
                    if ((actualValue === null || actualValue === undefined || actualValue === '') 
                        && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(actualValue)) {
                        matchAcceptance = true;
                    }
                }
                let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const eprValue = i['ePR No.'];
                    if ((eprValue === null || eprValue === undefined || eprValue === '') 
                        && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(eprValue).trim())) {
                        matchEPR = true;
                    }
                }
                let matchPO = false;
                if (this.checkedPOs.length === 0) {
                    matchPO = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');

                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPO = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPO = true;
                    }
                }
                // Item 的匹配邏輯
                let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const itemValue = i['Item'];
                    if ((itemValue === null || itemValue === undefined || itemValue === '') 
                        && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(itemValue).trim())) {
                        matchItem = true;
                    }
                }
                let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const nameValue = i['品項'];
                    if ((nameValue === null || nameValue === undefined || nameValue === '') 
                        && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(String(nameValue).trim())) {
                        matchName = true;
                    }
                }
                let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const specValue = i['規格'];
                    if ((specValue === null || specValue === undefined || specValue === '') 
                        && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(String(specValue).trim())) {
                        matchSpec = true;
                    }
                }
                const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                let matchDelivery = false;
                const raw = i['Delivery Date 廠商承諾交期'];

                if (this.checkedDeliverys.length === 0) {
                    matchDelivery = true;
                } else if (!raw || String(raw).trim() === '') {
                    matchDelivery = this.checkedDeliverys.includes('(空白)');
                } else {
                    const str = String(raw).trim();
                    let formatted = '';

                    if (/^\d{8}$/.test(str)) {
                        const year = str.slice(0, 4);
                        const month = parseInt(str.slice(4, 6), 10);
                        formatted = `${year}/${month}`;
                    } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                        const [y, m] = str.split('/');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                        const [y, m] = str.split('-');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                        formatted = str;
                    }

                    matchDelivery = this.checkedDeliverys.includes(formatted);
                }
                const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                let matchReceiveStatus = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatus = true;
                } else {
                    const val = i['驗收狀態'];
                    if (val === null || val === undefined || val === '') {
                        matchReceiveStatus = this.checkedReceiveStatuses.includes('(空白)');
                    } else {
                        matchReceiveStatus = this.checkedReceiveStatuses.includes(val);
                    }
                }
                let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                let matchInvoice = false;
                if (this.checkedInvoices.length === 0) {
                    matchInvoice = true;
                } else {
                    const invoiceValue = i['發票月份'];

                    if ((invoiceValue === null || invoiceValue === undefined || invoiceValue === '') 
                        && this.checkedInvoices.includes('(空白)')) {
                        matchInvoice = true;
                    } else if (invoiceValue) {
                        // 格式轉換：轉成 YYYY/M
                        const str = String(invoiceValue).trim();
                        let yearMonth = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            yearMonth = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            yearMonth = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            yearMonth = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            yearMonth = str; // 已經是 YYYY/M 格式
                        }

                        if (this.checkedInvoices.includes(yearMonth)) {
                            matchInvoice = true;
                        }
                    }
                }
                // 新增 WBS 和需求日的匹配
                let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const wbsValue = i['WBS'];
                    if ((wbsValue === null || wbsValue === undefined || wbsValue === '') 
                        && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(wbsValue)) {
                        matchWBS = true;
                    }
                }
                
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }
                let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                return matchAcceptance && matchEPR && matchPO && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice 
                    && matchTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject
                    && matchInvoice && matchWBS && matchDemandDate && matchRT
                    && matchReceiveStatus && matchRTTotal;
            });
        },

// ========== 21個互相連動的 Unique 函數 ==========

    // uniqueAcceptance (交貨驗證)
    uniqueAcceptance() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                let matchDelivery = false;
                const raw = i['Delivery Date 廠商承諾交期'];

                if (this.checkedDeliverys.length === 0) {
                    matchDelivery = true;
                } else if (!raw || String(raw).trim() === '') {
                    matchDelivery = this.checkedDeliverys.includes('(空白)');
                } else {
                    const str = String(raw).trim();
                    let formatted = '';

                    if (/^\d{8}$/.test(str)) {
                        const year = str.slice(0, 4);
                        const month = parseInt(str.slice(4, 6), 10);
                        formatted = `${year}/${month}`;
                    } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                        const [y, m] = str.split('/');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                        const [y, m] = str.split('-');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                        formatted = str;
                    }

                    matchDelivery = this.checkedDeliverys.includes(formatted);
                }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['交貨驗證'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueReceiveStatuses (驗收狀態)
    uniqueReceiveStatuses() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['驗收狀態'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueEPR (ePR No.)
    uniqueEPR() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                let matchDelivery = false;
                const raw = i['Delivery Date 廠商承諾交期'];

                if (this.checkedDeliverys.length === 0) {
                    matchDelivery = true;
                } else if (!raw || String(raw).trim() === '') {
                    matchDelivery = this.checkedDeliverys.includes('(空白)');
                } else {
                    const str = String(raw).trim();
                    let formatted = '';

                    if (/^\d{8}$/.test(str)) {
                        const year = str.slice(0, 4);
                        const month = parseInt(str.slice(4, 6), 10);
                        formatted = `${year}/${month}`;
                    } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                        const [y, m] = str.split('/');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                        const [y, m] = str.split('-');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                        formatted = str;
                    }

                    matchDelivery = this.checkedDeliverys.includes(formatted);
                }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['ePR No.'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return String(value).trim();
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniquePo (PO No.)
    uniquePo() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                let matchDelivery = false;
                const raw = i['Delivery Date 廠商承諾交期'];

                if (this.checkedDeliverys.length === 0) {
                    matchDelivery = true;
                } else if (!raw || String(raw).trim() === '') {
                    matchDelivery = this.checkedDeliverys.includes('(空白)');
                } else {
                    const str = String(raw).trim();
                    let formatted = '';

                    if (/^\d{8}$/.test(str)) {
                        const year = str.slice(0, 4);
                        const month = parseInt(str.slice(4, 6), 10);
                        formatted = `${year}/${month}`;
                    } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                        const [y, m] = str.split('/');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                        const [y, m] = str.split('-');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                        formatted = str;
                    }

                    matchDelivery = this.checkedDeliverys.includes(formatted);
                }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }
                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .flatMap(i => {
                    const poValue = i['PO No.'];
                    if (poValue === null || poValue === undefined || poValue === '') {
                        return ['(空白)'];
                    }
                    return String(poValue)
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueItem (Item)
    uniqueItem() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['Item'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return String(value).trim();
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueName (品項)
    uniqueName() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                let matchDelivery = false;
                const raw = i['Delivery Date 廠商承諾交期'];

                if (this.checkedDeliverys.length === 0) {
                    matchDelivery = true;
                } else if (!raw || String(raw).trim() === '') {
                    matchDelivery = this.checkedDeliverys.includes('(空白)');
                } else {
                    const str = String(raw).trim();
                    let formatted = '';

                    if (/^\d{8}$/.test(str)) {
                        const year = str.slice(0, 4);
                        const month = parseInt(str.slice(4, 6), 10);
                        formatted = `${year}/${month}`;
                    } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                        const [y, m] = str.split('/');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                        const [y, m] = str.split('-');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                        formatted = str;
                    }

                    matchDelivery = this.checkedDeliverys.includes(formatted);
                }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }
                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['品項'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueSpec (規格)
    uniqueSpec() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['規格'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueQty (數量)
    uniqueQty() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['數量'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueTotalQty (總數)
    uniqueTotalQty() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['總數'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniquePrice (單價)
    uniquePrice() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['單價'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueTotal (總價)
    uniqueTotal() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['總價'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueRT (RT金額)
    uniqueRT() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }
                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['RT金額'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return (parseFloat(String(value).replace(/,/g, '')) || 0).toLocaleString();
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            const numA = parseFloat(a.replace(/,/g, '')) || 0;
            const numB = parseFloat(b.replace(/,/g, '')) || 0;
            return numA - numB;
        });
    },

    // uniqueRTTotal (RT總金額)
    uniqueRTTotal() {
        const baseData = this.items;
        console.log("點")
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && 
                    matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && 
                    matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const raw = i['RT總金額'];
                    // 🚨 強化空值與無效值處理（包含 "nan" 字串）
                    if (raw == null || raw === '' || String(raw).trim() === '') {
                        return '(空白)';
                    }
                    const str = String(raw).trim().toLowerCase();
                    if (str === 'nan' || str === 'null' || str === 'undefined') {
                        return '(空白)';
                    }
                    const num = parseFloat(str.replace(/,/g, ''));
                    if (isNaN(num)) {
                        return '(空白)';
                    }
                    return num.toLocaleString();
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            const numA = parseFloat(a.replace(/,/g, '')) || 0;
            const numB = parseFloat(b.replace(/,/g, '')) || 0;
            return numA - numB;
        });
        
    },

    // uniqueRemark (備註)
    uniqueRemark() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                let matchDelivery = false;
                const raw = i['Delivery Date 廠商承諾交期'];

                if (this.checkedDeliverys.length === 0) {
                    matchDelivery = true;
                } else if (!raw || String(raw).trim() === '') {
                    matchDelivery = this.checkedDeliverys.includes('(空白)');
                } else {
                    const str = String(raw).trim();
                    let formatted = '';

                    if (/^\d{8}$/.test(str)) {
                        const year = str.slice(0, 4);
                        const month = parseInt(str.slice(4, 6), 10);
                        formatted = `${year}/${month}`;
                    } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                        const [y, m] = str.split('/');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                        const [y, m] = str.split('-');
                        formatted = `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                        formatted = str;
                    }

                    matchDelivery = this.checkedDeliverys.includes(formatted);
                }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }
                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['備註'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueDelivery (Delivery Date 廠商承諾交期)
    uniqueDelivery() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchSod && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const raw = i['Delivery Date 廠商承諾交期'];
                    if (!raw || String(raw).trim() === '') return '(空白)';

                    const str = String(raw).trim();
                    if (/^\d{8}$/.test(str)) {
                        const year = str.slice(0, 4);
                        const month = parseInt(str.slice(4, 6), 10);
                        return `${year}/${month}`;
                    } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                        const [y, m] = str.split('/');
                        return `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                        const [y, m] = str.split('-');
                        return `${y}/${parseInt(m, 10)}`;
                    } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                        return str;
                    }

                    return '(空白)';
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            const [ay, am] = a.split('/').map(Number);
            const [by, bm] = b.split('/').map(Number);
            return by - ay || bm - am; // 最新在上
        });
    },

    // uniqueSod (SOD Qty 廠商承諾數量)
    uniqueSod() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }
                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchAccept && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['SOD Qty 廠商承諾數量'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueAccept (驗收數量)
    uniqueAccept() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchReject && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['驗收數量'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueReject (拒收數量)
    uniqueReject() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchInvoice && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['拒收數量'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueInvoice (發票月份)
    uniqueInvoice() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchWBS && matchDemandDate;
                })
                .map(i => {
                    const value = i['發票月份'];
                    if (!value || String(value).trim() === '') return '(空白)';

                    const str = String(value).trim();
                    const parts = str.split('/');
                    if (parts.length >= 2) {
                        const year = parts[0];
                        const month = parseInt(parts[1], 10); // 去除前導 0
                        return `${year}/${month}`;
                    }

                    return '(空白)';
                })
        )).sort((a, b) => {
            // ✅ 將 '(空白)' 排在最後
            if (a === '(空白)') return 1;
            if (b === '(空白)') return -1;

            const [ay, am] = a.split('/').map(Number);
            const [by, bm] = b.split('/').map(Number);

            // ✅ 年份大 → 前面，年份相同 月份大 → 前面
            if (ay !== by) return by - ay;
            return bm - am;
        });
    },

    // uniqueWBS (WBS)
    uniqueWBS() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                let matchDemandDate = false;
                if (this.checkedDemandDates.length === 0) {
                    matchDemandDate = true;
                } else {
                    const raw = i['需求日'];
                    if (raw === null || raw === undefined || String(raw).trim() === '') {
                        matchDemandDate = this.checkedDemandDates.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = str.slice(4, 6);
                            const formatted = `${year}/${month}`;
                            matchDemandDate = this.checkedDemandDates.includes(formatted);
                        } else {
                            matchDemandDate = false;
                        }
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchDemandDate;
                })
                .map(i => {
                    const value = i['WBS'];
                    if (value === null || value === undefined || value === '') {
                        return '(空白)';
                    }
                    return value;
                })
        )).sort((a, b) => {
            if (a === '(空白)') return -1;
            if (b === '(空白)') return 1;
            return a.localeCompare(b, 'zh-TW');
        });
    },

    // uniqueDemandDate (需求日)
    uniqueDemandDate() {
        const baseData = this.items;
        return Array.from(new Set(
            baseData
                .filter(i => {
                    let matchAcceptance = false;
                if (this.checkedAcceptances.length === 0) {
                    matchAcceptance = true;
                } else {
                    const val = i['交貨驗證'];
                    if ((val === null || val === undefined || val === '') && this.checkedAcceptances.includes('(空白)')) {
                        matchAcceptance = true;
                    } else if (this.checkedAcceptances.includes(val)) {
                        matchAcceptance = true;
                    }
                }
                    let matchReceiveStatuses = false;
                if (this.checkedReceiveStatuses.length === 0) {
                    matchReceiveStatuses = true;
                } else {
                    const val = i['驗收狀態'];
                    if ((val === null || val === undefined || val === '') && this.checkedReceiveStatuses.includes('(空白)')) {
                        matchReceiveStatuses = true;
                    } else if (this.checkedReceiveStatuses.includes(val)) {
                        matchReceiveStatuses = true;
                    }
                }
                    let matchEPR = false;
                if (this.checkedEPRs.length === 0) {
                    matchEPR = true;
                } else {
                    const val = i['ePR No.'];
                    if ((val === null || val === undefined || val === '') && this.checkedEPRs.includes('(空白)')) {
                        matchEPR = true;
                    } else if (this.checkedEPRs.includes(String(val).trim())) {
                        matchEPR = true;
                    }
                }
                    let matchPo = false;
                if (this.checkedPOs.length === 0) {
                    matchPo = true;
                } else {
                    const poValues = String(i['PO No.'] || '')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .split(/\n|,|;/)
                        .map(v => v.trim())
                        .filter(v => v !== '');
                    if (poValues.length === 0 && this.checkedPOs.includes('(空白)')) {
                        matchPo = true;
                    } else if (poValues.some(v => this.checkedPOs.includes(v))) {
                        matchPo = true;
                    }
                }
                    let matchItem = false;
                if (this.checkedItems.length === 0) {
                    matchItem = true;
                } else {
                    const val = i['Item'];
                    if ((val === null || val === undefined || val === '') && this.checkedItems.includes('(空白)')) {
                        matchItem = true;
                    } else if (this.checkedItems.includes(String(val).trim())) {
                        matchItem = true;
                    }
                }
                    let matchName = false;
                if (this.checkedNames.length === 0) {
                    matchName = true;
                } else {
                    const val = i['品項'];
                    if ((val === null || val === undefined || val === '') && this.checkedNames.includes('(空白)')) {
                        matchName = true;
                    } else if (this.checkedNames.includes(val)) {
                        matchName = true;
                    }
                }
                    let matchSpec = false;
                if (this.checkedSpecs.length === 0) {
                    matchSpec = true;
                } else {
                    const val = i['規格'];
                    if ((val === null || val === undefined || val === '') && this.checkedSpecs.includes('(空白)')) {
                        matchSpec = true;
                    } else if (this.checkedSpecs.includes(val)) {
                        matchSpec = true;
                    }
                }
                    const matchQty = this.checkedQtys.length === 0 || this.checkedQtys.includes(i['數量']);
                    const matchTotalQty = this.checkedTotalQtys.length === 0 || this.checkedTotalQtys.includes(i['總數']);
                    const matchPrice = this.checkedPrices.length === 0 || this.checkedPrices.includes(i['單價']);
                    const matchTotal = this.checkedTotals.length === 0 || this.checkedTotals.includes(i['總價']);
                    let matchRT = false;
                if (this.checkedRTs.length === 0) {
                    matchRT = true;
                } else {
                    const val = i['RT金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRT = this.checkedRTs.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRT = this.checkedRTs.includes(formatted);
                    }
                }
                    let matchRTTotal = false;
                if (this.checkedRTTotals.length === 0) {
                    matchRTTotal = true;
                } else {
                    const val = i['RT總金額'];
                    if (val === null || val === undefined || val === '') {
                        matchRTTotal = this.checkedRTTotals.includes('(空白)');
                    } else {
                        const formatted = (parseFloat(String(val).replace(/,/g, '')) || 0).toLocaleString();
                        matchRTTotal = this.checkedRTTotals.includes(formatted);
                    }
                }
                    const matchRemark = this.checkedRemarks.length === 0 || this.checkedRemarks.includes(i['備註']);
                    let matchDelivery = false;
                    const raw = i['Delivery Date 廠商承諾交期'];

                    if (this.checkedDeliverys.length === 0) {
                        matchDelivery = true;
                    } else if (!raw || String(raw).trim() === '') {
                        matchDelivery = this.checkedDeliverys.includes('(空白)');
                    } else {
                        const str = String(raw).trim();
                        let formatted = '';

                        if (/^\d{8}$/.test(str)) {
                            const year = str.slice(0, 4);
                            const month = parseInt(str.slice(4, 6), 10);
                            formatted = `${year}/${month}`;
                        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                            const [y, m] = str.split('/');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                            const [y, m] = str.split('-');
                            formatted = `${y}/${parseInt(m, 10)}`;
                        } else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                            formatted = str;
                        }

                        matchDelivery = this.checkedDeliverys.includes(formatted);
                    }
                    const matchSod = this.checkedSods.length === 0 || this.checkedSods.includes(i['SOD Qty 廠商承諾數量']);
                    const matchAccept = this.checkedAccepts.length === 0 || this.checkedAccepts.includes(i['驗收數量']);
                    const matchReject = this.checkedRejects.length === 0 || this.checkedRejects.includes(i['拒收數量']);
                    let matchInvoice = false;

                    if (this.checkedInvoices.length === 0) {
                        matchInvoice = true;
                    } else {
                        const raw = i['發票月份'];

                        if (!raw || String(raw).trim() === '') {
                            matchInvoice = this.checkedInvoices.includes('(空白)');
                        } else {
                            const str = String(raw).trim();
                            let ym = '';

                            // 20250812 → 2025/8
                            if (/^\d{8}$/.test(str)) {
                                ym = `${str.slice(0, 4)}/${parseInt(str.slice(4, 6), 10)}`;
                            }
                            // 2025/08/12 → 2025/8
                            else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
                                const [y, m] = str.split('/');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 2025-08-12 → 2025/8
                            else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                                const [y, m] = str.split('-');
                                ym = `${y}/${parseInt(m, 10)}`;
                            }
                            // 如果已經是 YYYY/M 或 YYYY/MM → 直接用
                            else if (/^\d{4}\/\d{1,2}$/.test(str)) {
                                ym = str;
                            }

                            matchInvoice = this.checkedInvoices.includes(ym);
                        }
                    }
                    let matchWBS = false;
                if (this.checkedWBSs.length === 0) {
                    matchWBS = true;
                } else {
                    const val = i['WBS'];
                    if ((val === null || val === undefined || val === '') && this.checkedWBSs.includes('(空白)')) {
                        matchWBS = true;
                    } else if (this.checkedWBSs.includes(val)) {
                        matchWBS = true;
                    }
                }

                    return matchAcceptance && matchReceiveStatuses && matchEPR && matchPo && matchItem && matchName && matchSpec && matchQty && matchTotalQty && matchPrice && matchTotal && matchRT && matchRTTotal && matchRemark && matchDelivery && matchSod && matchAccept && matchReject && matchInvoice && matchWBS;
                })
            .map(i => {
                const value = i['需求日'];
                if (!value || String(value).trim() === '') return '(空白)';

                const str = String(value).trim();
                if (/^\d{8}$/.test(str)) {
                    const year = str.slice(0, 4);
                    const month = str.slice(4, 6);
                    return `${year}/${month}`;
                }
                return '(空白)';
            })
        )).sort((a, b) => {
            if (a === '(空白)') return 1;
            if (b === '(空白)') return -1;
            return a.localeCompare(b, 'zh-TW');
        }).reverse()
    },

        // 修正：上限管制 = 預算上限 - 100,000 (預留管制額度)
        budgetControlAmount() {
            const limit = this.maxpurchasebudget;           // 1,500,000
            const controlReserve = 100000;               // 預留 10 萬管制額度
            const controlLimit = limit - controlReserve; // 1,400,000
            return Math.max(0, controlLimit);
        },

        // 修正後的 currentMonthBalance 計算：只有當兩個月份選擇一致時才計算餘額
        currentMonthBalance() {
            const balance = (this.maxpurchasebudget || 0) - (this.nowmonthcurent || 0);
            return Math.max(0, balance);
        },

        currentMonthStatus() {
            const actualUsed = this.nowmonthcurent || 0;
            const maxBudget = this.maxpurchasebudget || 0;
            
            // 如果實際入帳為 0，顯示安全狀態
            if (actualUsed === 0) {
                return 'safe';
            }
            
            // 根據已使用金額判斷
            if (actualUsed < 1300000) {
                return 'safe';      // 綠燈
            } else if (actualUsed < 1400000) {
                return 'warning';   // 黃燈  
            } else {
                return 'danger';    // 紅燈
            }
        },
        
        // 取得本月的 key，例如 "2025年8月"
        currentNoneMonthKey() {
            const now = new Date();
            return `${now.getFullYear()}年${now.getMonth() + 1}月`;
        },
        // 取得本月的金額，沒有的話就 0
        currentNoneMonthAmount() {
            return this.accounting_summary?.[this.currentNoneMonthKey] ?? 0;
        },
        


    },

    methods: {

        async fetchCurrentMonthDetails() {
            try {
                // 如果已經有本月資料，直接使用
                if (this.currentMonthDetails && this.currentMonthDetails.length > 0) {
                    console.log("本月實際入帳明細已存在:", this.currentMonthDetails.length, "筆");
                    return;
                }
                
                // 重新載入月度實際入帳資料
                await this.fetchMonthlyActualAccounting();
                console.log("本月實際入帳明細已重新載入:", this.currentMonthDetails.length, "筆");
                
            } catch (error) {
                console.error("載入本月實際入帳明細失敗:", error);
                this.currentMonthDetails = [];
            }
        },

        async fetchLastMonthDetails() {
            try {
                // 如果已經有上月資料，直接使用
                if (this.lastMonthDetails && this.lastMonthDetails.length > 0) {
                    console.log("上月實際入帳明細已存在:", this.lastMonthDetails.length, "筆");
                    return;
                }
                
                // 重新載入月度實際入帳資料
                await this.fetchMonthlyActualAccounting();
                console.log("上月實際入帳明細已重新載入:", this.lastMonthDetails.length, "筆");
                
            } catch (error) {
                console.error("載入上月實際入帳明細失敗:", error);
                this.lastMonthDetails = [];
            }
        },

        async fetchCurrentNoneDetails() {
            try {
                // 這個函數似乎是用於「本月尚未入帳」
                // 根據你現有的 fetchAccountingSummary 邏輯
                if (this.currentNoneDetails && this.currentNoneDetails.length > 0) {
                    console.log("本月尚未入帳明細已存在:", this.currentNoneDetails.length, "筆");
                    return;
                }
                
                // 重新載入會計摘要資料
                await this.fetchAccountingSummary();
                console.log("本月尚未入帳明細已重新載入:", this.currentNoneDetails.length, "筆");
                
            } catch (error) {
                console.error("載入本月尚未入帳明細失敗:", error);
                this.currentNoneDetails = [];
                this.currentNoneMonthAmount = 0;
            }
        },
        getActualDetails() {
            if (this.actualModalType === 'lastMonth') {
                return this.lastMonthDetails || [];
            } else if (this.actualModalType === 'currentMonth') {
                return this.currentMonthDetails || [];
            }
            // 如果類型無效，返回空陣列
            return [];
        },

        // 💰 根據 actualModalType 返回對應的總金額
        // 如果你希望金額是即時計算的，可以用這個方法
        // 如果你更信任從後端直接傳來的金額，可以改用 this.lastmonthcurent / this.nowmonthcurent
        getActualAmount() {
            const details = this.getActualDetails();
            // 如果你希望使用後端計算的金額，請使用這行：
            return this.actualModalType === 'lastMonth' ? this.lastmonthcurent : this.nowmonthcurent;
            
            // 如果你希望前端根據明細重新計算金額，請使用下面這段（請選擇其中一種方式）
            /*
            const total = details.reduce((sum, row) => {
                const rtAmount = row['RT總金額'] || '0';
                const num = parseFloat(rtAmount.replace(/,/g, '')) || 0;
                return sum + num;
            }, 0);
            return Math.round(total);
            */
        },

        // 格式化貨幣顯示
        formatCurrency(value) {
            // 處理 null, undefined, 空字串, 'nan' 等情況
            if (!value || value === '' || value === 'nan' || value === 'null') {
                return '-';
            }
            
            // 如果是字串，移除逗號和貨幣符號，然後轉為數字
            let numValue;
            if (typeof value === 'string') {
                numValue = parseFloat(value.replace(/,/g, '').replace(/[$￥]/g, ''));
            } else {
                numValue = parseFloat(value);
            }
            
            // 如果轉換後不是有效數字，返回 '-'
            if (isNaN(numValue)) {
                return '-';
            }
            
            // 格式化為千位分隔符
            return numValue.toLocaleString();
        },
        
        // 格式化日期顯示  
        formatDate(dateStr) {
            if (!dateStr || dateStr === '' || dateStr === 'nan' || dateStr === 'null') {
                return '-';
            }
            
            // 如果是 YYYYMMDD 格式，轉換為 YYYY/MM/DD
            const str = dateStr.toString();
            if (str.length === 8 && /^\d{8}$/.test(str)) {
                return `${str.substr(0,4)}/${str.substr(4,2)}/${str.substr(6,2)}`;
            }
            
            // 如果是 YYYY/MM/DD 格式，直接返回
            if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) {
                return str;
            }
            
            return str;
        },

        // 添加點擊本月尚未入帳時的處理方法
        showCurrentNoneModalHandler() {
            // 確保有資料再顯示模態框
            if (this.currentNoneDetails.length > 0 || this.currentNoneMonthAmount > 0) {
                this.showCurrentNoneModal = true;
                console.log("📋 顯示本月尚未入帳模態框:", {
                    amount: this.currentNoneMonthAmount,
                    records: this.currentNoneDetails.length,
                    data: this.currentNoneDetails
                });
            } else {
                alert("目前沒有本月尚未入帳的資料");
            }
        },
        // 顯示實際入帳彈窗（上月/本月共用）
        async showActualAccountingModal(type) {
            this.actualModalType = type;
            this.showActualModal = true;
            
            // 根據類型載入對應資料
            if (type === 'lastMonth' && this.lastMonthDetails.length === 0) {
                this.isLoadingActual = true;
                await this.fetchLastMonthDetails();
                this.isLoadingActual = false;
            } else if (type === 'currentMonth' && this.currentMonthDetails.length === 0) {
                this.isLoadingActual = true;
                await this.fetchCurrentMonthDetails();
                this.isLoadingActual = false;
            }
        },
            // 顯示本月尚未入帳彈窗
        async showCurrentNoneAccountingModal() {
            this.showCurrentNoneModal = true;
            
            if (this.currentNoneDetails.length === 0) {
                this.isLoadingCurrentNone = true;
                await this.fetchCurrentNoneDetails();
                this.isLoadingCurrentNone = false;
            }
        },
        // 新增欄位選擇器相關方法
        toggleColumnSelector() {
            this.showColumnSelector = !this.showColumnSelector;
        },

        toggleColumn(column) {
            const index = this.visibleColumns.indexOf(column);
            if (index > -1) {
                this.visibleColumns.splice(index, 1);
            } else {
                // 修復：按照 tableHeaders 的順序插入欄位
                const headerIndex = this.tableHeaders.indexOf(column);
                let insertIndex = 0;
                
                for (let i = 0; i < headerIndex; i++) {
                    if (this.visibleColumns.includes(this.tableHeaders[i])) {
                        insertIndex++;
                    }
                }
                
                this.visibleColumns.splice(insertIndex, 0, column);
            }
            
            // 強制 Vue 重新渲染表格
            this.$nextTick(() => {
                console.log('🔄 欄位重新排序完成:', this.visibleColumns);
            });
        },

        // 2. 添加欄位排序方法，確保 visibleColumns 按照 tableHeaders 的順序
        sortVisibleColumns() {
            const sortedColumns = [];
            
            // 按照 tableHeaders 的順序重新排列 visibleColumns
            this.tableHeaders.forEach(header => {
                if (this.visibleColumns.includes(header)) {
                    sortedColumns.push(header);
                }
            });
            
            this.visibleColumns = sortedColumns;
            console.log('📊 欄位已重新排序:', this.visibleColumns);
        },

        // 3. 修復 selectAllColumns 方法
        selectAllColumns() {
            // 按照 tableHeaders 的順序選擇所有欄位
            this.visibleColumns = [...this.tableHeaders];
            this.sortVisibleColumns(); // 確保順序正確
        },

        deselectAllColumns() {
            this.visibleColumns = [];
        },

        // 4. 修復 resetDefaultColumns 方法
        resetDefaultColumns() {
            const defaultColumns = [
                "交貨驗證",
                "驗收狀態", 
                "ePR No.",
                "PO No.",
                "Item",
                "品項",
                "規格",
                "數量",
                "總數",
                "單價",
                "總價",
                "RT金額",
                "RT總金額",
                "備註",
                "WBS",
                "需求日"
            ];
            
            // 只選擇存在於 tableHeaders 中的欄位
            this.visibleColumns = defaultColumns.filter(col => this.tableHeaders.includes(col));
            this.sortVisibleColumns(); // 確保順序正確
        },

        // 5. 添加調試方法
        debugColumnOrder() {
            console.log('=== 欄位順序調試 ===');
            console.log('📋 tableHeaders 順序:', this.tableHeaders);
            console.log('✅ visibleColumns 順序:', this.visibleColumns);
            console.log('🔍 順序是否正確:', this.isColumnOrderCorrect());
            
            // 檢查每個 visibleColumn 在 tableHeaders 中的位置
            this.visibleColumns.forEach((col, index) => {
                const headerIndex = this.tableHeaders.indexOf(col);
                console.log(`${index + 1}. ${col} -> tableHeaders[${headerIndex}]`);
            });
        },
        
        // 6. 檢查欄位順序是否正確
        isColumnOrderCorrect() {
            let lastHeaderIndex = -1;
            
            for (let i = 0; i < this.visibleColumns.length; i++) {
                const currentHeaderIndex = this.tableHeaders.indexOf(this.visibleColumns[i]);
                
                if (currentHeaderIndex <= lastHeaderIndex) {
                    return false; // 順序不正確
                }
                
                lastHeaderIndex = currentHeaderIndex;
            }
            
            return true; // 順序正確
        },


        async fetchData() {
            try {
                const res = await axios.get(`http://127.0.0.1:5000/api/buyer_detail?${siteQuery()}`);
                this.data = res.data;
                this.items = res.data;
                console.log('📊 載入資料:', this.items.length, '筆');
                
            } catch (error) {
                console.error('❌ 載入資料失敗:', error);
            }
        },

        async fetchUnaccountedData() {
            try {
                const response = await axios.get(`http://127.0.0.1:5000/api/get_unaccounted_amount?${siteQuery()}`);
                
                // 同時設定總金額和詳細資料
                this.unaccounted_amount = response.data.unaccounted_amount || 0;
                this.unaccountedDetails = response.data.rows || [];
                
                console.log(`目前尚未入帳 ${this.unaccounted_amount.toLocaleString()} 元`);
                console.log('未入帳詳細資料:', this.unaccountedDetails.length, '筆');
                
            } catch (error) {
                console.error('載入未入帳資料失敗:', error);
                this.unaccounted_amount = 0;
                this.unaccountedDetails = [];
            }
        },

        // 簡化彈窗顯示方法：
        async showAccountingDetail(type) {
            if (type === 'unaccounted') {
                this.modalType = 'unaccounted';
                this.showModal = true;
                
                // 如果還沒有詳細資料，才重新載入
                if (this.unaccountedDetails.length === 0) {
                    this.isLoadingDetails = true;
                    await this.fetchUnaccountedData();
                    this.isLoadingDetails = false;
                }
                
                console.log('顯示未入帳詳細資料，共', this.unaccountedDetails.length, '筆');
            }
        },

        async fetchAccountingSummary() {
            try {
                const res = await axios.get(`http://127.0.0.1:5000/api/accounting_summary?${siteQuery()}`);
                this.accounting_summary = res.data.summary; // 取得摘要資料
                // 儲存完整的回應資料以備後用
                this.accounting_full_data = res.data;

                console.log("📊 會計摘要:");
                for (const [month, amount] of Object.entries(this.accounting_summary)) {
                    console.log(`   ${month} 👉 ${amount.toLocaleString()} 元`);
                }

                // 列出所有可用的資訊
                console.log("\n=== 完整 API 回傳資訊 ===");
                
                console.log("1. 摘要資料 (summary):");
                console.log(this.accounting_summary);
                
                console.log("\n2. 詳細資料 (detailed_data) - 完整內容:");
                for (const [month, rows] of Object.entries(res.data.detailed_data)) {
                    console.log(`\n   📅 ${month} (共 ${rows.length} 筆):`);
                    if (rows.length > 0) {
                        // 輸出所有詳細資料，不只是第一筆
                        rows.forEach((row, index) => {
                            console.log(`     第 ${index + 1} 筆:`, {
                                "ePR No.": row["ePR No."],
                                "PO No.": row["PO No."],
                                "品項": row["品項"],
                                "總價": row["總價"],
                                "RT總金額": row["RT總金額"],
                                "承諾交期": row["承諾交期"],
                                "需求日": row["需求日"],
                                "發票月份": row["發票月份"],
                                "WBS": row["WBS"],
                                "計算金額": row["計算金額"]
                            });
                        });
                    } else {
                        console.log(`     ⚠️ 無資料`);
                    }
                }
                
                console.log("\n3. 條件統計 (conditions):");
                console.log(res.data.conditions);
                
                console.log("\n4. 日期範圍 (date_ranges):");
                console.log(res.data.date_ranges);
                
                console.log("\n5. 元資料 (meta):");
                console.log("   總月份數:", res.data.meta.total_months);
                console.log("   所有年月:", res.data.meta.all_year_months);
                console.log("   原始資料筆數:", res.data.meta.original_df_count);
                console.log("   篩選後資料筆數:", res.data.meta.filtered_df_count);
                console.log("   CSV檔案路徑:", res.data.meta.csv_path);
                
                // 顯示每個月份的詳細統計
                console.log("\n6. 各月份詳細統計:");
                for (const [month, conditions] of Object.entries(res.data.conditions)) {
                    console.log(`   📅 ${month}:`);
                    console.log(`     - 條件1(ePR&PO有值): ${conditions.condition1_count}`);
                    console.log(`     - 條件2(WBS為空): ${conditions.condition2_count}`);
                    console.log(`     - 條件3(承諾交期): ${conditions.condition3_count}`);
                    console.log(`     - 條件4(需求日): ${conditions.condition4_count}`);
                    console.log(`     - 已入帳筆數: ${conditions.already_paid_count}`);
                    console.log(`     - 最終符合筆數: ${conditions.final_condition_count}`);
                }
                
                // 完整的詳細資料結構展示
                console.log("\n7. 完整詳細資料結構:");
                console.log("res.data.detailed_data 完整物件:", res.data.detailed_data);
                
                // 額外：按月份展示完整物件結構
                console.log("\n8. 按月份展示完整物件:");
                Object.entries(res.data.detailed_data).forEach(([month, rows]) => {
                    console.log(`\n=== ${month} 完整資料 ===`);
                    console.log(`月份: ${month}`);
                    console.log(`資料筆數: ${rows.length}`);
                    console.log(`完整資料陣列:`, rows);
                    
                    // 如果有資料，顯示每筆的完整結構
                    if (rows.length > 0) {
                        console.log(`\n   詳細breakdown:`);
                        rows.forEach((item, idx) => {
                            console.log(`   [${idx}]`, item);
                        });
                    }
                });

                // 額外：所有資料的統計摘要
                console.log("\n9. 統計摘要:");
                let totalRecords = 0;
                let totalAmount = 0;
                
                Object.entries(res.data.detailed_data).forEach(([month, rows]) => {
                    totalRecords += rows.length;
                    const monthAmount = rows.reduce((sum, row) => sum + (row["計算金額"] || 0), 0);
                    totalAmount += monthAmount;
                    console.log(`   ${month}: ${rows.length} 筆, 金額: ${monthAmount.toLocaleString()} 元`);
                });
                
                console.log(`\n   🔢 總計: ${totalRecords} 筆記錄`);
                console.log(`   💰 總金額: ${totalAmount.toLocaleString()} 元`);

                // ===== 提取當月資料 =====
                const currentMonth = new Date().getMonth() + 1;
                const currentYear = new Date().getFullYear();
                const currentMonthKey = `${currentYear}年${currentMonth}月`;
                
                if (res.data.detailed_data[currentMonthKey]) {
                    // 設定兩組變數（為了向後相容和模態框使用）
                    this.currentMonthData = res.data.detailed_data[currentMonthKey];
                    this.currentMonthAmount = res.data.summary[currentMonthKey] || 0;
                    
                    // 同時設定模態框專用的變數
                    this.currentNoneDetails = res.data.detailed_data[currentMonthKey];
                    this.currentNoneMonthAmount = res.data.summary[currentMonthKey] || 0;
                    
                    console.log(`\n✅ 當月資料已提取 (${currentMonthKey}):`);
                    console.log(`   筆數: ${this.currentMonthData.length}`);
                    console.log(`   金額: ${this.currentMonthAmount.toLocaleString()} 元`);
                } else {
                    this.currentMonthData = [];
                    this.currentMonthAmount = 0;
                    this.currentNoneDetails = [];
                    this.currentNoneMonthAmount = 0;
                    console.log(`\n❌ 找不到當月資料 (${currentMonthKey})`);
                    console.log(`可用月份:`, Object.keys(res.data.detailed_data));
                }

            } catch (error) {
                console.error("❌ 載入會計摘要失敗:", error);
                console.error("錯誤詳情:", error.response?.data || error.message);
            }
        },


        sortDetailsByInvoiceDate(details) {
            // 複製陣列避免直接修改原資料
            return [...details].sort((a, b) => {
                const dateA = this.parseInvoiceDate(a['發票月份']);
                const dateB = this.parseInvoiceDate(b['發票月份']);
                
                // 如果日期無法解析，放在最後
                if (isNaN(dateA)) return 1;
                if (isNaN(dateB)) return -1;
                
                // 日期從「舊到新」排序（降序）
                return dateA - dateB;
            });
        },

        // 將「發票月份」字串轉為 Date 物件
        parseInvoiceDate(invoiceStr) {
            if (!invoiceStr) return NaN;

            const str = String(invoiceStr).trim();

            // 情況1: YYYY/MM/DD 或 YYYY/M/D
            const match1 = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
            if (match1) {
                const [, year, month, day] = match1;
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }

            // 情況2: YYYYMMDD
            if (/^\d{8}$/.test(str)) {
                const year = str.substr(0, 4);
                const month = str.substr(4, 2);
                const day = str.substr(6, 2);
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }

            // 無法解析，回傳 NaN
            return NaN;
        },


        async fetchMonthlyActualAccounting() {
            try {
                const res = await axios.get(`http://127.0.0.1:5000/api/monthly_actual_accounting?${siteQuery()}`);
                
                const data = res.data;

                // ✅ 正確取出本月與上月的「金額」與「明細」
                const thisMonthData = data["本月"] || { amount: 0, details: [] };
                const lastMonthData = data["上月"] || { amount: 0, details: [] };

                // 📊 設定金額（如果後續有用到）
                this.nowmonthcurent = thisMonthData.amount;   // 本月金額
                this.lastmonthcurent = lastMonthData.amount;  // 上月金額

                // 📄 設定明細（使用你定義的變數名稱）
                this.currentMonthDetails = this.sortDetailsByInvoiceDate(thisMonthData.details);
                this.lastMonthDetails = this.sortDetailsByInvoiceDate(lastMonthData.details);

                // 🔍 印出確認
                console.log("📊 本月入帳金額:", this.nowmonthcurent);
                console.log("📋 本月明細筆數:", this.currentMonthDetails.length);
                console.log("📊 上月入帳金額:", this.lastmonthcurent);
                console.log("📋 上月明細筆數:", this.lastMonthDetails.length);

            } catch (error) {
                console.error("❌ 載入每月實際入帳失敗:", error);
                
                // 錯誤時給預設值
                this.nowmonthcurent = 0;
                this.lastmonthcurent = 0;
                this.currentMonthDetails = [];
                this.lastMonthDetails = [];
            }
        },

        async fetchgetrestofmoney(){
            try {
                const res = await axios.get(`http://127.0.0.1:5000/api/getrestofmoney?${siteQuery()}`);
                console.log("🔎 API 回傳:", res.data);

                this.purchasebudget = res.data["當月請購預算"] ?? 0;
                this.supplementarybudget = res.data["當月追加預算"] ?? 0;
                this.totalused = res.data["已開單總額"] ?? 0;
                this.remaining = res.data["剩餘金額"] ?? 0;

                console.log("📊 當月請購預算:", this.purchasebudget,
                            "📊 當月追加預算:", this.supplementarybudget,
                            "📊 已開單總額:", this.totalused,
                            "📊 剩餘金額:", this.remaining);
                this.maxpurchasebudget = this.purchasebudget + this.supplementarybudget

            } catch (error) {
                console.error("❌ 載入本月/上月入帳失敗:", error);
            }
        },

        handleClickOutside(event) {
            if (this.$refs.columnSelectorRef && !this.$refs.columnSelectorRef.contains(event.target)) {
                this.showColumnSelector = false;
            }
            const isACCEPTANCE = this.$refs.ACCEPTANCEFilter?.contains(event.target);
            const isEPR = this.$refs.EPRFilter?.contains(event.target);
            const isPO = this.$refs.POFilter?.contains(event.target);
            const isITEM = this.$refs.ITEMFilter?.contains(event.target);
            const isNAME = this.$refs.NAMEFilter?.contains(event.target);
            const isSPEC = this.$refs.SPECFilter?.contains(event.target);
            const isQTY = this.$refs.QTYFilter?.contains(event.target);
            const isTOTALQTY = this.$refs.TOTALQTYFilter?.contains(event.target);
            const isPRICE = this.$refs.PRICEFilter?.contains(event.target);
            const isTOTAL = this.$refs.TOTALFilter?.contains(event.target);
            const isREMARK = this.$refs.REMARKFilter?.contains(event.target);
            const isDELIVERY = this.$refs.DELIVERYFilter?.contains(event.target);
            const isSOD = this.$refs.SODFilter?.contains(event.target);
            const isACCEPT = this.$refs.ACCEPTFilter?.contains(event.target);
            const isREJECT = this.$refs.REJECTFilter?.contains(event.target);
            const isINVOICE = this.$refs.INVOICEFilter?.contains(event.target);
            const isWBS = this.$refs.WBSFilter?.contains(event.target);
            const isDEMANDDATE = this.$refs.DEMANDDATEFilter?.contains(event.target);
            const isRT = this.$refs.RTFilter?.contains(event.target);
            const isReceiveStatus = this.$refs.ReceiveStatusFilter?.contains(event.target);
            const isRTTOTAL = this.$refs.RTTOTALFilter?.contains(event.target);

            if (!isACCEPTANCE) this.showAcceptanceFilter = false;
            if (!isEPR) this.showEPRFilter = false;
            if (!isPO) this.showPOFilter = false;
            if (!isITEM) this.showITEMFilter = false;
            if (!isNAME) this.showNAMEFilter = false;  // 修正拼寫
            if (!isSPEC) this.showSPECFilter = false;
            if (!isQTY) this.showQTYFilter = false;
            if (!isTOTALQTY) this.showTOTALQTYFilter = false;
            if (!isPRICE) this.showPRICEFilter = false;
            if (!isTOTAL) this.showTOTALFilter = false;
            if (!isREMARK) this.showREMARKFilter = false;
            if (!isDELIVERY) this.showDELIVERYFilter = false;  // 修正拼寫
            if (!isSOD) this.showSODFilter = false;
            if (!isACCEPT) this.showACCEPTFilter = false;
            if (!isREJECT) this.showREJECTFilter = false;
            if (!isINVOICE) this.showINVOICEFilter = false;
            if (!isWBS) this.showWBSFilter = false;
            if (!isDEMANDDATE) this.showDEMANDDATEFilter = false;
            if (!isRT) this.showRTFilter = false;
            if (!isReceiveStatus) this.showReceiveStatusFilter = false;
            if (!isRTTOTAL) this.showRTTOTALFilter = false;
        },

        beforeUnmount() {
            document.removeEventListener('click', this.handleClickOutside);
        },

        closeAllDropdowns() {            
            // 關閉所有篩選下拉選單
            this.showAcceptanceFilter = false;
            this.showEPRFilter = false;
            this.showPOFilter = false;
            this.showITEMFilter = false;
            this.showNAMEFilter = false;  // 修正拼寫
            this.showSPECFilter = false;
            this.showQTYFilter = false;
            this.showTOTALQTYFilter = false;
            this.showPRICEFilter = false;
            this.showTOTALFilter = false;
            this.showREMARKFilter = false;
            this.showDELIVERYFilter = false;  // 修正拼寫
            this.showSODFilter = false;
            this.showACCEPTFilter = false;
            this.showREJECTFilter = false;
            this.showINVOICEFilter = false;
            this.showWBSFilter = false;
            this.showDEMANDDATEFilter = false;
            this.showRTFilter = false;
            this.showReceiveStatusFilter = false;
            this.showRTTOTALFilter = false;
        },

        // 251104

            
    // ========== 加在這裡 ==========
async saveERTFilters() {
    try {
        // 讀取現有的 filters（包含主頁面的篩選條件）
        let allFilters = {};
        
        try {
            const response = await axios.get(`http://127.0.0.1:5000/api/get-filters-json/${this.username}?${siteQuery()}`);
            if (response.data) {
                allFilters = response.data;
            }
        } catch (error) {
            // 如果檔案不存在，就用空物件
            console.log('建立新的篩選條件檔案');
        }
        
        // 先移除所有舊的 eRT 篩選條件（避免累積重複）
        const cleanedFilters = {};
        for (let key in allFilters) {
            if (!key.startsWith('ert_')) {
                cleanedFilters[key] = allFilters[key];
            }
        }
        
        // 加入新的 eRT 篩選條件（用 ert_ 開頭區分）
        cleanedFilters.username = this.username;
        cleanedFilters.ert_checkedAcceptances = this.checkedAcceptances;
        cleanedFilters.ert_checkedEPRs = this.checkedEPRs;
        cleanedFilters.ert_checkedPOs = this.checkedPOs;
        cleanedFilters.ert_checkedItems = this.checkedItems;
        cleanedFilters.ert_checkedNames = this.checkedNames;
        cleanedFilters.ert_checkedSpecs = this.checkedSpecs;
        cleanedFilters.ert_checkedQtys = this.checkedQtys;
        cleanedFilters.ert_checkedTotalQtys = this.checkedTotalQtys;
        cleanedFilters.ert_checkedPrices = this.checkedPrices;
        cleanedFilters.ert_checkedTotals = this.checkedTotals;
        cleanedFilters.ert_checkedRemarks = this.checkedRemarks;
        cleanedFilters.ert_checkedDeliverys = this.checkedDeliverys;
        cleanedFilters.ert_checkedSods = this.checkedSods;
        cleanedFilters.ert_checkedAccepts = this.checkedAccepts;
        cleanedFilters.ert_checkedRejects = this.checkedRejects;
        cleanedFilters.ert_checkedInvoices = this.checkedInvoices;
        cleanedFilters.ert_checkedWBSs = this.checkedWBSs;
        cleanedFilters.ert_checkedDemandDates = this.checkedDemandDates;
        cleanedFilters.ert_checkedRTs = this.checkedRTs;
        cleanedFilters.ert_checkedReceiveStatuses = this.checkedReceiveStatuses;
        cleanedFilters.ert_checkedRTTotals = this.checkedRTTotals;

        // ====== 新增：保存 globalSearch ======
        cleanedFilters.ert_globalSearch = this.globalSearch;
        
        // 保存回去
        await axios.post(`http://127.0.0.1:5000/api/save-filters-json?${siteQuery()}`, cleanedFilters);
        
        console.log('✅ eRT 篩選條件已保存（保留主頁面篩選）');
    } catch (error) {
        console.error('❌ 保存 eRT 篩選條件失敗:', error);
    }
},

    // ========== 新增：防抖保存方法 ==========
    debounceSaveERTFilters() {
        // 清除之前的計時器
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }
        
        // 500ms 後才保存（防止頻繁保存）
        this._saveTimeout = setTimeout(() => {
            this.saveERTFilters();
        }, 500);
    },
    

    async loadERTFilters() {
    try {
        // ========== 新增：設置載入標記，防止 watch 觸發保存 ==========
        this._isLoadingFilters = true;
        
        const response = await axios.get(`http://127.0.0.1:5000/api/get-filters-json/${this.username}?${siteQuery()}`);
        
        if (response.data) {
            const filters = response.data;

            // 還原 globalSearch
            if (filters.ert_globalSearch !== undefined) {
                this.globalSearch = filters.ert_globalSearch;
            }
            // 讀取 eRT 的篩選條件
            this.checkedAcceptances = filters.ert_checkedAcceptances || [];
            this.checkedEPRs = filters.ert_checkedEPRs || [];
            this.checkedPOs = filters.ert_checkedPOs || [];
            this.checkedItems = filters.ert_checkedItems || [];
            this.checkedNames = filters.ert_checkedNames || [];
            this.checkedSpecs = filters.ert_checkedSpecs || [];
            this.checkedQtys = filters.ert_checkedQtys || [];
            this.checkedTotalQtys = filters.ert_checkedTotalQtys || [];
            this.checkedPrices = filters.ert_checkedPrices || [];
            this.checkedTotals = filters.ert_checkedTotals || [];
            this.checkedRemarks = filters.ert_checkedRemarks || [];
            this.checkedDeliverys = filters.ert_checkedDeliverys || [];
            this.checkedSods = filters.ert_checkedSods || [];
            this.checkedAccepts = filters.ert_checkedAccepts || [];
            this.checkedRejects = filters.ert_checkedRejects || [];
            this.checkedInvoices = filters.ert_checkedInvoices || [];
            this.checkedWBSs = filters.ert_checkedWBSs || [];
            this.checkedDemandDates = filters.ert_checkedDemandDates || [];
            this.checkedRTs = filters.ert_checkedRTs || [];
            this.checkedReceiveStatuses = filters.ert_checkedReceiveStatuses || [];
            this.checkedRTTotals = filters.ert_checkedRTTotals || [];
            
            console.log('✅ eRT 篩選條件已恢復');
        }
    } catch (error) {
        console.log('ℹ️ 沒有找到保存的 eRT 篩選條件');
    } finally {
        // ========== 新增：等待一下再解除標記，確保所有 watch 都已執行 ==========
        setTimeout(() => {
            this._isLoadingFilters = false;
        }, 100);
    }
},


        toggleDropdown(target) {
            const wasOpen = this[target];
            this.closeAllDropdowns();
            this[target] = !wasOpen;
        },

        autoUpload(e) {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append("file", file);

            fetch(`http://127.0.0.1:5000/api/update_delivery_receipt?${siteQuery()}`, {
                method: "POST",
                body: formData,
            })
            .then(response => {
                if (!response.ok) throw new Error("上傳失敗");
                return response.json();
            })
            .then(result => {
                console.log("✅ 上傳完成", result);
                alert(`✅ 上傳成功，${result.msg}`);
                this.fetchData();
            })
            .catch(error => {
                console.error("❌ 上傳失敗", error);
                alert("❌ 上傳失敗");
            });
        },

        async fetchAdmins() {
            try {
                const res = await fetch(`http://127.0.0.1:5000/api/admins?${siteQuery()}`);
                this.admins = await res.json();
                console.log("有權限者工號", this.admins)
            } catch (e) {
                console.error("取得需求者清單失敗", e);
            }
        },

        goDashboard(){
            localStorage.setItem('username', this.username);
            window.location.href = 'Procurement_Dynamic_360_Dashboard.html'; 
        },

        goMaterialReceivingNoteUpload(){
            if(!this.admins.includes(this.username)){
                alert("你沒有權限進入！");
                return
            }
            localStorage.setItem('username', this.username);
            window.location.href = 'MaterialReceivingNoteUpload.html'; 
        },
        
        async goEHubpageInfo(){
            if(!this.admins.includes(this.username)){
                alert("你沒有權限進入！");
                return
            }
            localStorage.setItem('username', this.username);
            window.location.href = 'eHubUploadFile.html';
        },

        async goSendMail(){
            if(!this.admins.includes(this.username)){
                alert("你沒有權限進入！");
                return
            }
            localStorage.setItem('username', this.username);
            window.location.href = 'accCheck.html';
        },


        async downloadDetailData() {
            const tableData = this.filteredData.map(row => {
                const newRow = {};
                for (const key of this.tableHeaders) {
                    newRow[key] = row[key];
                }
                return newRow;
            });

            const ws = XLSX.utils.json_to_sheet(tableData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "篩選結果");

            const filename = `ERT清單_${new Date().toISOString().slice(0, 10)}_(Security C).xlsx`;
            XLSX.writeFile(wb, filename);
        },

        // ========== Lucide Icons 初始化 ==========
        initLucideIcons() {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        },
        
        refreshLucideIcons() {
            this.$nextTick(() => {
                this.initLucideIcons();
            });
        },
        
        // ========== 編輯功能 ==========
// 開啟編輯卡片 - 抓取同 Id 的所有資料
openEditModal(item) {
    try {
        if (!item || !item.Id) {
            console.error('Item is undefined or missing Id');
            return;
        }
        
        const itemId = item.Id;
        console.log('開啟編輯，Id:', itemId);
        
        // ⭐ 找出所有相同 Id 的資料
        const sameIdItems = this.items.filter(i => i.Id === itemId);
        console.log(`找到 ${sameIdItems.length} 筆相同 Id 的資料`);
        
        // ⭐ 深拷貝所有資料
        this.editingItems = sameIdItems.map(originalItem => {
            const copiedItem = { Id: originalItem.Id };
            
            for (let key in originalItem) {
                if (originalItem.hasOwnProperty(key)) {
                    // 跳過特殊欄位
                    if (key === 'backup' || key === 'isEditing' || key === '_alertedItemLimit') {
                        continue;
                    }
                    const value = originalItem[key];
                    copiedItem[key] = (value !== undefined && value !== null) ? value : '';
                }
            }
            
            return copiedItem;
        });
        
        this.editingId = itemId;
        this.showEditModal = true;
        
        this.$nextTick(() => {
            this.refreshLucideIcons();
        });
        
        console.log('編輯項目:', this.editingItems);
        
    } catch (error) {
        console.error('Error opening edit modal:', error);
        Swal.fire({
            icon: 'error',
            title: '❌ 開啟失敗',
            text: '無法開啟編輯視窗：' + error.message
        });
    }
},
                
// 關閉編輯卡片
closeEditModal() {
    this.showEditModal = false;
    this.editingItems = [];  // ⭐ 改成清空陣列
    this.editingId = null;
    this.refreshLucideIcons();
},

// 儲存編輯
async saveEdit() {
    try {
        console.log('=== 開始儲存 ===');
        
        if (!this.editingId || this.editingItems.length === 0) {
            throw new Error('資料錯誤：缺少 Id 或資料為空');
        }
        
        // ⭐ 準備要更新的資料
        const updateData = {
            Id: this.editingId,
            items: this.editingItems,  // ⭐ 發送所有同 Id 的資料
            username: this.username
        };
        
        console.log(`準備更新 Id: ${this.editingId}，共 ${this.editingItems.length} 筆資料`);
        
        // 顯示載入中
        Swal.fire({
            title: '處理中...',
            text: `正在儲存 ${this.editingItems.length} 筆資料...`,
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
        
        // ⭐ 呼叫後端 API
        const response = await axios.post(`http://127.0.0.1:5000/api/update-buyer-items?${siteQuery()}`, updateData, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        console.log('後端回應:', response);
        
        // 處理回應
        let responseData = response.data;
        if (typeof responseData === 'string') {
            responseData = JSON.parse(responseData);
        }
        
        const isSuccess = responseData.status === 'success' || responseData.success === true;
        
        if (isSuccess) {
            console.log('✅ 更新成功');
            
            // ⭐ 從本地數據中移除舊的同 Id 資料
            this.items = this.items.filter(item => item.Id !== this.editingId);
            
            // ⭐ 加入新的資料
            this.items.push(...this.editingItems);
            
            Swal.fire({
                icon: 'success',
                title: '✅ 儲存成功',
                text: `已更新 ${this.editingItems.length} 筆資料`,
                timer: 1500,
                showConfirmButton: false
            });
            
            this.closeEditModal();
            this.refreshLucideIcons();
            
        } else {
            throw new Error(responseData.message || '更新失敗');
        }
        
    } catch (error) {
        console.error('=== 儲存錯誤 ===', error);
        
        let errorMessage = '發生未知錯誤';
        let errorTitle = '❌ 儲存失敗';
        
        if (error.response?.status === 503) {
            errorTitle = '⏱️ 系統忙碌中';
            errorMessage = '檔案正在被其他程序使用，請稍後再試';
        } else if (error.response?.data) {
            const errorData = typeof error.response.data === 'string' 
                ? JSON.parse(error.response.data) 
                : error.response.data;
            errorMessage = errorData.message || errorData.msg || '更新失敗';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        Swal.fire({
            icon: 'error',
            title: errorTitle,
            text: errorMessage,
            confirmButtonText: '確定'
        });
    }
},

// 執行刪除
async deleteItem(item) {
    try {
        console.log('=== 開始刪除 ===');
        
        if (!item || !item.Id) {
            throw new Error('資料錯誤：缺少 Id');
        }
        
        // 顯示載入中
        Swal.fire({
            title: '處理中...',
            text: '正在刪除資料',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
        
        // 呼叫後端 API
        const response = await axios.post(`http://127.0.0.1:5000/api/delete-buyer-item?${siteQuery()}`, {
            Id: item.Id,
            username: this.username
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        console.log('後端回應:', response);
        
        // 處理可能的 JSON 字串回應
        let responseData = response.data;
        if (typeof responseData === 'string') {
            console.log('回應是字串，嘗試解析...');
            responseData = JSON.parse(responseData);
        }
        
        console.log('解析後的 responseData:', responseData);
        
        // 檢查 status 或 success
        const isSuccess = responseData.status === 'success' || responseData.success === true;
        
        if (isSuccess) {
            console.log('✅ 刪除成功');
            
            // 從本地數據中移除
            const itemsIndex = this.items.findIndex(i => i.Id === item.Id);
            if (itemsIndex > -1) {
                this.items.splice(itemsIndex, 1);
            }
            
            Swal.fire({
                icon: 'success',
                title: '🗑️ 刪除成功',
                text: responseData.msg || responseData.message || '資料已成功刪除',
                timer: 1500,
                showConfirmButton: false
            });
            
            this.refreshLucideIcons();
            
        } else {
            throw new Error(responseData.message || '刪除失敗');
        }
        
    } catch (error) {
        console.error('=== 刪除錯誤 ===', error);
        
        let errorMessage = '發生未知錯誤';
        let errorTitle = '❌ 刪除失敗';
        
        if (error.response?.status === 503) {
            errorTitle = '⏱️ 系統忙碌中';
            errorMessage = '檔案正在被其他程序使用，請稍後再試';
        } else if (error.response?.data) {
            const errorData = typeof error.response.data === 'string' 
                ? JSON.parse(error.response.data) 
                : error.response.data;
            errorMessage = errorData.message || errorData.msg || '刪除失敗';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        Swal.fire({
            icon: 'error',
            title: errorTitle,
            text: errorMessage,
            confirmButtonText: '確定'
        });
    }
},
        
        // ========== 刪除功能 ==========
// 確認刪除 - 精確比對所有欄位
confirmDelete(item) {
    if (!item || !item.Id) {
        Swal.fire({
            icon: 'error',
            title: '❌ 錯誤',
            text: '資料錯誤：缺少 Id'
        });
        return;
    }
    
    Swal.fire({
        title: '⚠️ 確認刪除',
        html: `
            <div class="text-left">
                <p class="text-lg mb-3">您確定要刪除這筆資料嗎？</p>
                <div class="bg-red-50 border-l-4 border-red-500 p-4 mb-3">
                    <p class="text-red-700 font-semibold">⚠️ 重要提醒：</p>
                    <p class="text-red-600 mt-1">刪除後將<span class="font-bold underline">無法復原</span>！</p>
                </div>
                <div class="bg-gray-50 p-3 rounded text-sm">
                    <p class="text-gray-700"><strong>Id:</strong> ${item.Id}</p>
                    <p class="text-gray-700"><strong>Item:</strong> ${item.Item || '-'}</p>
                    <p class="text-gray-700"><strong>ePR No.:</strong> ${item['ePR No.'] || '-'}</p>
                    <p class="text-gray-700"><strong>PO No.:</strong> ${(item['PO No.'] || '-').replace(/<br\s*\/?>/gi, ', ')}</p>
                    <p class="text-gray-700"><strong>品項:</strong> ${item['品項'] || '-'}</p>
                    <p class="text-gray-700"><strong>總價:</strong> ${item['總價'] || '-'}</p>
                </div>
            </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '🗑️ 確定刪除',
        cancelButtonText: '✖️ 取消',
        reverseButtons: true,
        width: '600px'
    }).then((result) => {
        if (result.isConfirmed) {
            this.deleteItem(item);
        }
    });
},

// 執行刪除 - 精確比對所有欄位
async deleteItem(item) {
    try {
        console.log('=== 開始刪除 ===');
        console.log('item:', item);
        
        if (!item || !item.Id) {
            throw new Error('資料錯誤：缺少 Id');
        }
        
        // 顯示載入中
        Swal.fire({
            title: '處理中...',
            text: '正在刪除資料...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
        
        // ⭐ 準備要刪除的資料（移除前端特殊欄位）
        const itemToDelete = {};
        for (let key in item) {
            if (item.hasOwnProperty(key)) {
                // 跳過前端特殊欄位
                if (key === 'backup' || key === 'isEditing' || key === '_alertedItemLimit') {
                    continue;
                }
                itemToDelete[key] = item[key];
            }
        }
        
        console.log('準備刪除的資料:', itemToDelete);
        
        // ⭐ 呼叫後端 API
        const response = await axios.post(`http://127.0.0.1:5000/api/delete-buyer-item-exact?${siteQuery()}`, {
            item: itemToDelete,
            username: this.username
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        console.log('後端回應:', response);
        
        // 處理回應
        let responseData = response.data;
        if (typeof responseData === 'string') {
            responseData = JSON.parse(responseData);
        }
        
        console.log('解析後的 responseData:', responseData);
        
        // 檢查成功
        const isSuccess = responseData.status === 'success' || responseData.success === true;
        
        if (isSuccess) {
            console.log('✅ 刪除成功');
            
            // ⭐ 從本地數據中移除該筆資料
            // 使用精確比對找到要刪除的項目
            const indexToRemove = this.items.findIndex(i => {
                // 比對所有重要欄位
                return i.Id === item.Id && 
                       i.Item === item.Item && 
                       i['品項'] === item['品項'];
            });
            
            if (indexToRemove > -1) {
                this.items.splice(indexToRemove, 1);
            }
            
            Swal.fire({
                icon: 'success',
                title: '🗑️ 刪除成功',
                text: '資料已成功刪除',
                timer: 1500,
                showConfirmButton: false
            });
            
            this.refreshLucideIcons();
            
        } else {
            throw new Error(responseData.message || '刪除失敗');
        }
        
    } catch (error) {
        console.error('=== 刪除錯誤 ===', error);
        
        let errorMessage = '發生未知錯誤';
        let errorTitle = '❌ 刪除失敗';
        
        if (error.response?.status === 503) {
            errorTitle = '⏱️ 系統忙碌中';
            errorMessage = '檔案正在被其他程序使用，請稍後再試';
        } else if (error.response?.status === 404) {
            errorTitle = '❌ 找不到資料';
            errorMessage = '找不到完全符合的資料，可能已被刪除或修改';
        } else if (error.response?.data) {
            const errorData = typeof error.response.data === 'string' 
                ? JSON.parse(error.response.data) 
                : error.response.data;
            errorMessage = errorData.message || errorData.msg || '刪除失敗';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        Swal.fire({
            icon: 'error',
            title: errorTitle,
            text: errorMessage,
            confirmButtonText: '確定'
        });
    }
},
    // ⭐ 新增：獲取下個月預計入帳資料
    async fetchNextMonthAmount() {
        try {
            console.log('📊 開始獲取下個月預計入帳資料...');
            const res = await axios.get(`http://127.0.0.1:5000/api/next_month_amount?${siteQuery()}`);
            console.log('✅ API 回應:', res.data);
            
            this.nextMonthAmount = res.data.next_month_amount || 0;
            this.nextMonthDetails = res.data.rows || [];
            
            console.log(`📊 下個月預計入帳: ${this.nextMonthAmount.toLocaleString()} 元`);
            console.log(`📋 明細筆數: ${this.nextMonthDetails.length}`);
        } catch (error) {
            console.error("❌ 載入下個月預計入帳失敗:", error);
            this.nextMonthAmount = 0;
            this.nextMonthDetails = [];
        }
    },

    // ⭐ 新增：顯示下個月預計入帳彈窗
    async showNextMonthModalHandler() {
        this.showNextMonthModal = true;
        this.isLoadingNextMonth = true;
        try {
            await this.fetchNextMonthAmount();
        } catch (error) {
            console.error("❌ 載入下個月明細失敗:", error);
            alert('載入下個月預計入帳資料失敗，請稍後再試');
        } finally {
            this.isLoadingNextMonth = false;
        }
    },

    },

    async mounted(){
        const username = localStorage.getItem('username');
        this.username = username
        console.log("👤 使用者名稱：", this.username);
        
        // ========== 修正：提前載入 eRT 篩選條件（在 fetchData 之前）==========
        await this.loadERTFilters();
        
        await this.fetchAdmins();
        await this.fetchData();
        await this.fetchUnaccountedData();
        await this.fetchAccountingSummary();
        await this.fetchMonthlyActualAccounting();
        await this.fetchgetrestofmoney()
        await this.fetchNextMonthAmount();  // ⭐ 新增這行
        
        document.addEventListener('click', this.handleClickOutside);
        // ========== 初始化 Lucide Icons ==========
        this.initLucideIcons();
        // 監聽數據變化，自動重新初始化 icons
        this.$watch('items', () => {
            this.refreshLucideIcons();
        }, { deep: true });
        
        this.$watch('filteredData', () => {
            this.refreshLucideIcons();
        });
    },

    // 修改 watch 監聽器：
    watch: {
        visibleColumns: {
            handler(newColumns, oldColumns) {
                console.log('📊 欄位變化:', {
                    old: oldColumns,
                    new: newColumns,
                    orderCorrect: this.isColumnOrderCorrect()
                });
                
                // 如果順序不正確，自動修復
                if (!this.isColumnOrderCorrect()) {
                    console.log('🔧 檢測到欄位順序錯誤，自動修復...');
                    this.$nextTick(() => {
                        this.sortVisibleColumns();
                    });
                }
            },
            deep: true
        },
    // ========== 監聽所有篩選條件（加上防抖）==========
    checkedAcceptances() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedEPRs() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedPOs() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedItems() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedNames() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedSpecs() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedQtys() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedTotalQtys() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedPrices() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedTotals() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedRemarks() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedDeliverys() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedSods() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedAccepts() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedRejects() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedInvoices() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedWBSs() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedDemandDates() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedRTs() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedReceiveStatuses() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    },
    checkedRTTotals() { 
        if (this._isLoadingFilters) return;
        this.debounceSaveERTFilters(); 
    }
  
    },

    updated() {
        // 每次組件更新後重新初始化 Lucide icons
        this.refreshLucideIcons();
    },

})
app.mount('#app');