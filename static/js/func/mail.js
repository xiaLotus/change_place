// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

const app = Vue.createApp({
    data() {
        return {
            admins: '',
            username: '',
            editItemData: '',
            editingIndex: '',
            setRule: '',
            recipient: "Zilong",
            reportFolderPath: `\\\\cim300\\FT01_CIM\\FT01_4000\\11.RR班人員-ePR請購管理\\D1442_趙祥富\\=開單完畢=\\2506300249_20250411_摺疊桌&塑膠椅_Zilong\\`,
            reportFolderPPTPath: `\\\\cim300\\FT01_CIM\\FT01_4000\\11.RR班人員-ePR請購管理\\D1442_趙祥富\\=開單完畢=\\2506300249_20250411_摺疊桌&塑膠椅_Zilong\\會議室摺疊收納桌椅需求請購_20250630_(Security C).pptx`,
            tableHeaders: ['開單狀態', 'WBS', '請購順序', '需求者', '請購項目', '需求原因', '總金額', '需求日', '已開單日期', 'ePR No.', '簽核中關卡', 'Status', '備註'],
            tableData: ['V', '10', '1,000', '10,000', 'V', '10', '1,000', '10,000', 'V', '10', '1,000', '10,000', 'V'],
            eprNo: "2506300249",
            priority: "一般",
            itemTitle: "【摺疊收納桌椅】會議室摺疊收納桌椅",
            inputWidth: 100, // 初始寬度
            important: "",
            reason: "",
            ccList: ""
        };
    },

    async mounted(){
        const username = localStorage.getItem('username');
        this.username = username
        await this.fetchAdmins();
        if(!this.admins.includes(this.username)){
            alert("你沒有權限進入！");
            window.location.href = '../index.html'; 
        }
        if (!username) {
            alert("請從系統入口進入！");
            window.location.href = '../index.html'; 
        }
        const editItemData = localStorage.getItem('editItemData');
        this.editItemData = editItemData
        console.log(this.editItemData);
        const setRule = localStorage.getItem('setRule');
        this.setRule = setRule
        console.log(setRule)
        this.updateInputWidth();
        await this.fillUp();
        await this.checkUserName();
    },
    watch: {
        itemTitle() {
            this.updateInputWidth();
        }
    },

    methods: {

        async fetchAdmins() {
            try {
                const res = await fetch(`http://127.0.0.1:5000/api/admins?${siteQuery()}`);
                this.admins = await res.json();
                console.log("有權限者工號", this.admins)
            } catch (e) {
                console.error("取得需求者清單失敗", e);
            }
        },

        async checkUserName() {
            try {
                const res = await fetch(`http://127.0.0.1:5000/api/getUsername?${siteQuery()}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        username: this.editItemData["需求者"]  // 假設 this.username 有值
                    })
                });

                const result = await res.json();
                this.recipient = result.name;  // 或根據後端回傳格式
                console.log("需求者名字: ", this.recipient);

            } catch (e) {
                console.error("取得需求者名稱失敗", e);
            }
        },

        
        async fillUp(){
            const raw = localStorage.getItem('editItemData');
            if (raw) {
                try {
                    this.editItemData = JSON.parse(raw);
                    console.log("✅ editItemData 解析成功：", this.editItemData);

                    // 確保 tableHeaders 有值再執行轉換
                    this.tableData = this.tableHeaders.map(header => {
                        const val = this.editItemData[header];
                        if (val === undefined || val === null) return '';
                        if (header === '需求日' && typeof val === 'string' && /^\d{8}$/.test(val)) {
                            return `${val.slice(0, 4)}/${val.slice(4, 6)}/${val.slice(6, 8)}`;
                        }
                        if (header === '已開單日期' && typeof val === 'string' && /^\d{8}$/.test(val)) {
                            return `${val.slice(0, 4)}/${val.slice(4, 6)}/${val.slice(6, 8)}`;
                        }
                        if (header === "請購順序" && val === "1") {
                            this.important = "超急件";
                        }
                        if( header === "需求原因"){
                            this.reason = val
                        }
                        if (typeof val === 'number') return val.toLocaleString();
                        return val;
                    });

                    console.log("✅ tableData 對應完成：", this.tableData);
                } catch (e) {
                    console.error("❌ editItemData JSON 解析失敗：", e);
                }
            }

            // 這邊處理雜項

            // 報告資料夾路徑
            this.reportFolderPath = this.editItemData['報告路徑']
            // 報告資料路徑
            this.reportFolderPPTPath = this.editItemData['報告路徑']
            // ePR No.
            this.eprNo = this.editItemData['ePR No.']
            // 等級
            const priorityMap = {
                '1': '超急件',
                '2': '急件',
                '3': '一般件'
            };
            this.priority = priorityMap[String(this.editItemData['請購順序'])?.trim()] || '未分類';
            // itemTitle
            this.itemTitle = this.editItemData['請購項目']
        },
        // 默認增加寬度
        updateInputWidth() {
            this.$nextTick(() => {
                const sizer = this.$refs.sizer;
                const input = this.$refs.autoInput;
                if (sizer && input) {
                    const newWidth = sizer.offsetWidth + 1; // 加1避免剪斷
                    this.inputWidth = Math.max(newWidth, 100); // 最小寬度保底
                }
            });
        },

        handleBack() {
            localStorage.setItem('username', this.username);
            localStorage.setItem('editItemData', JSON.stringify(this.editItemData));
            localStorage.setItem('setRule', this.setRule);
            window.location.href = 'Procurement_Dynamic_360_Dashboard.html';
        },


        async saveEdit() {
            try {
                // 顯示加載狀態
                this.isLoading = true;
                
                const response = await fetch(`http://127.0.0.1:5000/update_for_mail?${siteQuery()}`, {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify(this.editItemData)
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
                }

                const result = await response.json();
            
                // 成功回饋
                this.$toast?.success?.("更新成功！") || alert("更新成功！");
                
            } catch (error) {
                console.error("更新失敗：", error);
                this.$toast?.error?.(`更新失敗：${error.message}`) || alert(`更新失敗：${error.message}`);
            } finally {
                this.isLoading = false;
            }
        },
        async fetchData() {
            fetch(`http://127.0.0.1:5000/data?${siteQuery()}`)
                .then(res => res.json())
                .then(data => {
                    console.log("取得資料：", data);
                    this.items = data
                    this.sortByAllConditions()
            });
            
        },
        async fetchNoneBuy() {
            const res = await fetch(`http://127.0.0.1:5000/api/unordered-count?${siteQuery()}`);
            const data = await res.json();
            this.unorderedCount = data.count_X;
            this.orderedCount = data.count_V;
            this.total_money_by_month_data = data.monthly_expenses;

            const months = Object.keys(data.monthly_expenses).sort();
            
            // ✅ 若目前選取值不存在，就自動選最近月份 ( selectedMonth )
            if (!months.includes(this.selectedMonth)) {
                this.selectedMonth = months[months.length - 1] || '';
            }

            // ✅ 自動選最新「已開單」月份（來自 issuedMonthOptions）
            const issuedMonths = this.issuedMonthOptions;
            if (!issuedMonths.includes(this.selectedIssuedMonth)) {
                this.selectedIssuedMonth = issuedMonths[issuedMonths.length - 1] || '';
            }
        },

        async handleSubmit() {
    
            if(!this.reportFolderPath){
                alert("您的報告路徑為空，請輸入路徑，感謝")
                return
            }

            if (this.editItemData["報告路徑"] === "") {
                const result = confirm("確認路徑是否更改完畢？");
                if (!result) {
                    // 使用者按了「取消」
                    console.log("使用者取消操作");
                    return;
                }
                // 使用者按了「確定」
                console.log("使用者確認");
                this.editItemData["報告路徑"] = this.reportFolderPath
                await this.saveEdit();
            }

            // if(!this.username.includes(this.admins)){
            //     alert("你沒有權限使用按鈕 !")
            //     localStorage.setItem('username', this.username);
            //     window.location.href = 'Procurement_Dynamic_360_Dashboard.html';
            //     return
            // }
            try {
                const payload = {
                    username: this.username,
                    data: this.editItemData,
                    recipient: this.recipient,
                    cc: this.ccList
                };

                const response = await fetch(`http://127.0.0.1:5000/api/sendmail?${siteQuery()}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (response.ok) {
                    alert("送出成功！");
                    localStorage.setItem('username', this.username);
                    localStorage.setItem('editItemData', JSON.stringify(this.editItemData));
                    localStorage.setItem('setRule', this.setRule);
                    window.location.href = 'Procurement_Dynamic_360_Dashboard.html';
                } else {
                    alert("送出失敗：" + (result.error || result.message || "未知錯誤"));
                }

            } catch (error) {
                console.error("發送錯誤：", error);
                alert("系統錯誤，請稍後再試");
            }
        },
          addCommaToCC() {
            // 先移除多餘空白
            this.ccList = this.ccList.trim();

            // 如果目前有內容且最後不是逗號，就補一個 ", "
            if (this.ccList !== "" && !this.ccList.endsWith(",")) {
                this.ccList += ", ";
            }
        }
    }
});
app.mount("#app");