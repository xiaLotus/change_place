// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

const app = Vue.createApp({
    data() {
        return {
            username: '',
            mismatches: []
        }
    },
    methods: {
        // 載入資料
        loadData() {
            const dataStr = localStorage.getItem('quantity_mismatch_data');
            this.username = localStorage.getItem('username') || '';
            
            if (!dataStr) {
                Swal.fire({
                    icon: 'error',
                    title: '找不到資料',
                    text: '請返回上一頁重新上傳檔案',
                    confirmButtonText: '返回'
                }).then(() => {
                    this.goBack();
                });
                return;
            }
            
            const data = JSON.parse(dataStr);
            
            // 初始化可編輯的資料
            this.mismatches = data.mismatches.map(item => ({
                ...item,
                edited_xls_data: JSON.parse(JSON.stringify(item.xls_data)), // 深拷貝
                validation_error: null,
                validation_success: null
            }));
            
            // 初始驗證
            this.mismatches.forEach(item => {
                this.validateItem(item);
            });
        },
        
        // 新增一列
        addRow(item) {
            item.edited_xls_data.push({
                description: '',
                delivery: '',
                sod_qty: 0
            });
            this.validateItem(item);
        },
        
        // 刪除一列
        deleteRow(item, index) {
            if (item.edited_xls_data.length <= 1) {
                Swal.fire({
                    icon: 'warning',
                    title: '無法刪除',
                    text: '至少需要保留一列資料',
                    confirmButtonText: '知道了'
                });
                return;
            }
            
            Swal.fire({
                icon: 'question',
                title: '確認刪除',
                text: '確定要刪除這一列嗎？',
                showCancelButton: true,
                confirmButtonText: '確定刪除',
                cancelButtonText: '取消',
                confirmButtonColor: '#dc3545'
            }).then((result) => {
                if (result.isConfirmed) {
                    item.edited_xls_data.splice(index, 1);
                    this.validateItem(item);
                }
            });
        },
        
        // 計算小計
        calculateSubtotal(item) {
            this.validateItem(item);
        },
        
        // 計算總計
        calculateTotal(rows) {
            return rows.reduce((sum, row) => sum + (parseFloat(row.sod_qty) || 0), 0);
        },
        
        // 驗證單個項目
        validateItem(item) {
            const total = this.calculateTotal(item.edited_xls_data);
            const expectedTotal = parseFloat(item.total_sod);
            
            // 檢查是否所有欄位都已填寫
            const hasEmptyFields = item.edited_xls_data.some(row => 
                !row.description || !row.delivery || !row.sod_qty
            );
            
            if (hasEmptyFields) {
                item.validation_error = '請填寫所有欄位';
                item.validation_success = null;
                return false;
            }
            
            // 🆕 修改驗證訊息
            if (Math.abs(total - expectedTotal) > 0.01) {
                const rowCount = item.edited_xls_data.length;
                item.validation_error = `該品項的廠商承諾數量總和不符，預期為分批交件，目前總數 ${total} 件（共 ${rowCount} 批），原系統記錄為 ${expectedTotal} 件，請確認是否為分批交件？`;
                item.validation_success = null;
                return false;
            }
            
            item.validation_error = null;
            item.validation_success = `✅ 廠商承諾數量總和正確：${total} 件（共 ${item.edited_xls_data.length} 批次）`;
            return true;
        },
        
        // 驗證所有項目
        validateAll() {
            let allValid = true;
            this.mismatches.forEach(item => {
                if (!this.validateItem(item)) {
                    allValid = false;
                }
            });
            return allValid;
        },
        
        // 驗證樣式
        validationClass(item) {
            if (item.validation_error) return 'validation-error';
            if (item.validation_success) return 'validation-success';
            return '';
        },
        
        // 驗證訊息
        validationMessage(item) {
            if (item.validation_error) return item.validation_error;
            if (item.validation_success) return item.validation_success;
            return '等待驗證...';
        },
        
        // 儲存所有調整
        // 在 batch_adjustment.js 中,完整替換 saveAllAdjustments 方法
        async saveAllAdjustments() {
            // 🆕 檢查驗證狀態(但不阻止)
            const validationResults = this.mismatches.map(item => ({
                po_no: item.po_no,
                item_no: item.item,
                is_valid: this.validateItem(item),
                current_total: this.calculateTotal(item.edited_xls_data),
                expected_total: parseFloat(item.total_sod),
                row_count: item.edited_xls_data.length
            }));
            
            const invalidItems = validationResults.filter(r => !r.is_valid);
            const hasInvalid = invalidItems.length > 0;
            
            // 🆕 如果有驗證失敗的項目,顯示警告但仍允許繼續
            if (hasInvalid) {
                const warningResult = await Swal.fire({
                    icon: 'warning',
                    title: '⚠️ 發現數量總和不符',
                    html: `
                        <div style="text-align: left;">
                            <p style="margin-bottom: 15px; color: #856404; font-size: 16px;">
                                <strong>以下品項的廠商承諾數量總和與原系統記錄不符:</strong>
                            </p>
                            <div style="max-height: 300px; overflow-y: auto; background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                                <table style="width: 100%; font-size: 14px;">
                                    <thead>
                                        <tr style="background: #ffc107; color: #000;">
                                            <th style="padding: 8px; border: 1px solid #e0a800;">PO No</th>
                                            <th style="padding: 8px; border: 1px solid #e0a800;">Item</th>
                                            <th style="padding: 8px; border: 1px solid #e0a800;">分批數</th>
                                            <th style="padding: 8px; border: 1px solid #e0a800;">目前總數</th>
                                            <th style="padding: 8px; border: 1px solid #e0a800;">原記錄</th>
                                            <th style="padding: 8px; border: 1px solid #e0a800;">差異</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${invalidItems.map(r => `
                                            <tr style="background: white;">
                                                <td style="padding: 8px; border: 1px solid #dee2e6;">${r.po_no}</td>
                                                <td style="padding: 8px; border: 1px solid #dee2e6;">${r.item_no}</td>
                                                <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">${r.row_count} 批</td>
                                                <td style="padding: 8px; border: 1px solid #dee2e6; text-align: right; color: #dc3545; font-weight: bold;">${r.current_total} 件</td>
                                                <td style="padding: 8px; border: 1px solid #dee2e6; text-align: right; color: #28a745; font-weight: bold;">${r.expected_total} 件</td>
                                                <td style="padding: 8px; border: 1px solid #dee2e6; text-align: right; color: #dc3545; font-weight: bold;">
                                                    ${(r.current_total - r.expected_total).toFixed(2)}
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div style="background: #f8d7da; padding: 15px; border-radius: 8px; border-left: 4px solid #dc3545; margin-bottom: 15px;">
                                <p style="margin: 0; color: #721c24; font-size: 14px;">
                                    <strong>⚠️ 請確認:</strong><br>
                                    • 這是否為分批交件的正確數量?<br>
                                    • 數量總和不符可能導致後續驗收問題<br>
                                    • 建議確認廠商承諾的實際交貨數量
                                </p>
                            </div>
                            <div style="background: #d1ecf1; padding: 15px; border-radius: 8px; border-left: 4px solid #17a2b8;">
                                <p style="margin: 0; color: #0c5460; font-size: 14px;">
                                    <strong>💡 說明:</strong><br>
                                    • 如果確認這是正確的分批交貨數量,請點擊「確認儲存」<br>
                                    • 如需修正數量,請點擊「回去修改」
                                </p>
                            </div>
                        </div>
                    `,
                    showCancelButton: true,
                    showDenyButton: true,
                    confirmButtonText: '✅ 確認儲存(分批交件)',
                    denyButtonText: '🔙 回去修改',
                    cancelButtonText: '❌ 取消',
                    confirmButtonColor: '#28a745',
                    denyButtonColor: '#ffc107',
                    cancelButtonColor: '#6c757d',
                    width: '900px'
                });
                
                if (warningResult.isDenied || warningResult.isDismissed) {
                    // 使用者選擇回去修改或取消
                    return;
                }
                
                // 使用者選擇「確認儲存」,繼續往下執行
            }
            
            // ✅ 第二層確認:顯示完整調整摘要
            const confirmResult = await Swal.fire({
                icon: hasInvalid ? 'warning' : 'question',
                title: hasInvalid ? '⚠️ 最後確認(分批交件)' : '✅ 確認儲存',
                html: `
                    <div style="text-align: left;">
                        <p style="margin-bottom: 15px; font-size: 16px;">
                            ${hasInvalid 
                                ? '<strong style="color: #dc3545;">即將儲存分批交件調整(數量與原記錄不符)</strong>' 
                                : '<strong>確定要儲存以下調整嗎?</strong>'
                            }
                        </p>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                            <table style="width: 100%; font-size: 14px;">
                                <thead>
                                    <tr style="background: #e9ecef;">
                                        <th style="padding: 8px; border: 1px solid #dee2e6;">PO No</th>
                                        <th style="padding: 8px; border: 1px solid #dee2e6;">Item</th>
                                        <th style="padding: 8px; border: 1px solid #dee2e6;">分批數</th>
                                        <th style="padding: 8px; border: 1px solid #dee2e6;">總數量</th>
                                        <th style="padding: 8px; border: 1px solid #dee2e6;">狀態</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${validationResults.map(r => `
                                        <tr style="background: ${r.is_valid ? '#d4edda' : '#f8d7da'};">
                                            <td style="padding: 8px; border: 1px solid #dee2e6;">${r.po_no}</td>
                                            <td style="padding: 8px; border: 1px solid #dee2e6;">${r.item_no}</td>
                                            <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">${r.row_count} 批</td>
                                            <td style="padding: 8px; border: 1px solid #dee2e6; text-align: right;">
                                                <span style="color: ${r.is_valid ? '#28a745' : '#dc3545'}; font-weight: bold;">
                                                    ${r.current_total} 件
                                                </span>
                                                ${r.is_valid ? '' : ` <span style="color: #666;">(原 ${r.expected_total} 件)</span>`}
                                            </td>
                                            <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">
                                                ${r.is_valid ? '✅ 數量相符' : '⚠️ 分批交件'}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
                            <p style="margin: 0; color: #856404; font-size: 14px;">
                                <strong>📌 注意:</strong><br>
                                • 這將刪除舊的 ${this.mismatches.reduce((sum, m) => sum + m.csv_count, 0)} 筆資料<br>
                                • 新增調整後的 ${validationResults.reduce((sum, r) => sum + r.row_count, 0)} 筆分批資料<br>
                                • 此操作無法復原
                            </p>
                        </div>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: hasInvalid ? '✅ 確定儲存(分批交件)' : '✅ 確定儲存',
                cancelButtonText: '❌ 取消',
                confirmButtonColor: hasInvalid ? '#ffc107' : '#28a745',
                cancelButtonColor: '#6c757d',
                width: '900px'
            });
            
            if (!confirmResult.isConfirmed) return;
            
            // ✅✅✅ 第三層確認:再三確認(最後一道防線)
            const finalConfirm = await Swal.fire({
                icon: 'warning',
                title: '⚠️ 最後確認',
                html: `
                    <div style="text-align: center;">
                        <p style="font-size: 20px; margin: 20px 0; font-weight: bold; color: #dc3545;">
                            ⚠️ 此操作無法復原!
                        </p>
                        <div style="background: #fff3cd; padding: 20px; border-radius: 10px; border: 2px solid #ffc107; margin: 20px 0;">
                            <p style="margin: 0; color: #856404; font-size: 16px; line-height: 1.8;">
                                <strong>即將執行以下操作:</strong><br><br>
                                🗑️ 刪除 <strong style="color: #dc3545;">${this.mismatches.reduce((sum, m) => sum + m.csv_count, 0)} 筆</strong> 舊資料<br>
                                ➕ 新增 <strong style="color: #28a745;">${validationResults.reduce((sum, r) => sum + r.row_count, 0)} 筆</strong> 分批資料<br><br>
                                ${hasInvalid ? '<span style="color: #dc3545; font-weight: bold;">⚠️ 包含數量不符的項目</span>' : '✅ 所有數量已驗證'}
                            </p>
                        </div>
                        <div style="background: #f8d7da; padding: 15px; border-radius: 8px; border-left: 4px solid #dc3545; margin-top: 15px;">
                            <p style="margin: 0; color: #721c24; font-size: 15px;">
                                <strong>⚠️ 請再次確認:</strong><br>
                                • 您確定要執行此操作嗎?<br>
                                • 此操作完成後無法撤銷<br>
                                • 請確保資料已仔細檢查
                            </p>
                        </div>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: '🔒 確定執行(無法復原)',
                cancelButtonText: '❌ 取消',
                confirmButtonColor: '#dc3545',
                cancelButtonColor: '#6c757d',
                width: '700px',
                backdrop: `
                    rgba(0,0,0,0.7)
                    left top
                    no-repeat
                `
            });
            
            if (!finalConfirm.isConfirmed) {
                await Swal.fire({
                    icon: 'info',
                    title: '已取消',
                    text: '操作已取消,資料未變更',
                    timer: 2000,
                    showConfirmButton: false
                });
                return;
            }
            
            // 顯示載入中
            Swal.fire({
                title: '處理中...',
                html: '正在儲存調整資料,請稍候',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });
            
            // 逐一處理每個項目
            let successCount = 0;
            let failCount = 0;
            const failedItems = [];
            const successItems = []; // ✅ 新增:記錄成功的項目
            
            for (const item of this.mismatches) {
                try {
                    const response = await fetch(`http://127.0.0.1:5000/api/confirm_quantity_update?${siteQuery()}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            po_no: item.po_no,
                            item: item.item,
                            rows: item.edited_xls_data,
                            expected_total: item.total_sod
                        })
                    });
                    
                    const data = await response.json();
                    
                    if (data.status === 'success') {
                        successCount++;
                        successItems.push({ // ✅ 記錄成功項目
                            po_no: item.po_no,
                            item: item.item
                        });
                        console.log(`✅ 成功處理 ${item.po_no} - ${item.item}`);
                    } else {
                        failCount++;
                        failedItems.push({
                            po_no: item.po_no,
                            item: item.item,
                            error: data.message
                        });
                        console.error(`❌ 處理 ${item.po_no} - ${item.item} 失敗:`, data.message);
                    }
                } catch (error) {
                    failCount++;
                    failedItems.push({
                        po_no: item.po_no,
                        item: item.item,
                        error: error.toString()
                    });
                    console.error(`❌ 處理 ${item.po_no} - ${item.item} 錯誤:`, error);
                }
            }
            
            // 顯示結果
            Swal.fire({
                icon: failCount === 0 ? 'success' : 'warning',
                title: failCount === 0 ? '🎉 全部完成' : '⚠️ 部分完成',
                html: `
                    <div style="text-align: left;">
                        <p style="font-size: 16px; margin-bottom: 15px;">處理結果:</p>
                        <div style="background: #d4edda; padding: 15px; border-radius: 5px; margin-bottom: 10px; border: 1px solid #c3e6cb;">
                            <strong style="color: #155724; font-size: 16px;">✅ 成功: ${successCount} 個項目</strong>
                        </div>
                        ${failCount > 0 ? `
                            <div style="background: #f8d7da; padding: 15px; border-radius: 5px; border: 1px solid #f5c6cb; margin-bottom: 10px;">
                                <strong style="color: #721c24; font-size: 16px;">❌ 失敗: ${failCount} 個項目</strong>
                                <div style="margin-top: 10px; max-height: 150px; overflow-y: auto;">
                                    <ul style="margin: 5px 0; padding-left: 20px; font-size: 13px;">
                                        ${failedItems.map(f => `
                                            <li style="margin: 3px 0;">
                                                <strong>${f.po_no} - ${f.item}:</strong> ${f.error}
                                            </li>
                                        `).join('')}
                                    </ul>
                                </div>
                            </div>
                        ` : ''}
                        ${hasInvalid && failCount === 0 ? `
                            <div style="background: #d1ecf1; padding: 15px; border-radius: 5px; border: 1px solid #bee5eb;">
                                <p style="margin: 0; color: #0c5460; font-size: 14px;">
                                    ℹ️ 已成功儲存分批交件資料<br>
                                    請注意後續驗收時確認各批次交貨數量
                                </p>
                            </div>
                        ` : ''}
                    </div>
                `,
                confirmButtonText: '返回列表',
                confirmButtonColor: '#667eea',
                width: '600px'
            }).then(() => {
                // 清除資料並返回
                localStorage.removeItem('quantity_mismatch_data');
                
                // ✅✅✅ 關鍵修改:只記錄成功處理的項目
                let processedItems = JSON.parse(
                    localStorage.getItem('processed_batch_items') || '[]'
                );
                
                console.log(`📝 開始記錄 ${successItems.length} 個成功的分批項目...`);
                
                // ✅ 只記錄成功處理的項目
                successItems.forEach((successItem) => {
                    // 檢查是否已存在
                    const exists = processedItems.some(item => 
                        item.po_no === successItem.po_no && 
                        item.item === successItem.item && 
                        item.type === 'batch'
                    );
                    
                    if (!exists) {
                        processedItems.push({
                            po_no: successItem.po_no,
                            item: successItem.item,
                            type: 'batch',
                            status: 'completed',
                            timestamp: new Date().toISOString()
                        });
                        
                        console.log(`  ✅ 已記錄: PO ${successItem.po_no} - Item ${successItem.item}`);
                    } else {
                        console.log(`  ⚠️ 已存在: PO ${successItem.po_no} - Item ${successItem.item}`);
                    }
                });
                
                // ❌ 失敗的項目不記錄
                if (failedItems.length > 0) {
                    console.log(`❌ 以下項目處理失敗,未記錄:`);
                    failedItems.forEach(f => {
                        console.log(`  ❌ PO ${f.po_no} - Item ${f.item}`);
                    });
                }
                
                localStorage.setItem('processed_batch_items', JSON.stringify(processedItems));
                
                const batchItemsCount = processedItems.filter(i => i.type === 'batch').length;
                console.log(`✅ 共記錄 ${batchItemsCount} 個分批項目到 localStorage`);
                console.log(`📋 完整記錄:`, processedItems);
                
                // 返回
                window.location.href = 'eHubUploadFile.html';
            });
        },
        
        // 返回上一頁
        goBack() {
            // 清除資料
            localStorage.removeItem('quantity_mismatch_data');
            
            // 直接返回
            window.location.href = 'eHubUploadFile.html';
        },
    },
    mounted() {
        this.loadData();
    }
});

app.mount('#app');