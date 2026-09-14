// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

const { createApp } = Vue;
const API_BASE_URL = 'http://localhost:5000/api';

// 等待所有腳本載入完成
function waitForSwal() {
  return new Promise((resolve) => {
    const checkSwal = () => {
      if (typeof Swal !== 'undefined') {
        console.log('✅ SweetAlert2 已載入');
        resolve(true);
      } else {
        console.log('⏳ 等待 SweetAlert2 載入...');
        setTimeout(checkSwal, 100);
      }
    };
    checkSwal();
  });
}

// 安全的 SweetAlert2 包裝函數
async function showAlert(options) {
  await waitForSwal();
  
  if (typeof Swal !== 'undefined') {
    console.log('🎯 顯示 SweetAlert2 彈窗');
    return await Swal.fire(options);
  } else {
    console.error('❌ SweetAlert2 載入失敗，使用備用方案');
    const message = options.text || options.html?.replace(/<[^>]*>/g, '') || options.title || '操作完成';
    alert(message);
    return { isConfirmed: true };
  }
}

// SweetAlert2 Toast 樣式的通知
async function showSwalToast(message, type = 'success') {
  await waitForSwal();
  
  const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    didOpen: (toast) => {
      toast.addEventListener('mouseenter', Swal.stopTimer)
      toast.addEventListener('mouseleave', Swal.resumeTimer)
    }
  });

  const iconMap = {
    'success': 'success',
    'error': 'error',
    'warning': 'warning',
    'info': 'info'
  };

  return Toast.fire({
    icon: iconMap[type] || 'success',
    title: message
  });
}

// 等待 DOM 和所有腳本載入完成
document.addEventListener('DOMContentLoaded', async () => {
  await waitForSwal();
  
  createApp({
    data() {
      return {
        // 驗收資料
        acceptanceData: [],
        // 已上傳檔案
        uploadedFiles: [],
        // 處理狀態
        isProcessing: false,
        isCleaningUp: false,
        // 拖拽狀態
        isDragging: false
      }
    },
    
    computed: {
      hasData() {
        return this.acceptanceData.length > 0;
      },

      // 代領料數量：materialStatus = completed（未領料）
      getProxyPickupCount() {
        return this.acceptanceData.filter(
          item => item.materialStatus === 'completed' && item.receivedStatus === 'pending'
        ).length;
      },

      // 待驗收數量：receivedStatus = completed（已領料，待驗收）
      getPendingAcceptanceCount() {
        return this.acceptanceData.filter(
          item => item.receivedStatus === 'completed'
        ).length;
      },
      
      // 已發信數量（維持原邏輯）
      getSentCount() {
        return this.acceptanceData.filter(item => item.status === 'sent').length;
      },

      isAllSelected() {
        return this.acceptanceData.length > 0 && this.acceptanceData.every(item => item.selected);
      },
    },
    
    methods: {
      goBack() {
        window.location.href = 'eRT_page.html';
      },
      
      handleDrop(e) {
        e.preventDefault();
        this.isDragging = false;
        this.handleFiles(e.dataTransfer.files);
      },
      
      handleFileSelect(e) {
        this.handleFiles(e.target.files);
      },
      
      async handleFiles(fileList) {
        const files = Array.from(fileList);
        if (files.length === 0) return;
        
        // 檢查檔案格式
        const invalidFiles = files.filter(file => 
          !file.name.toLowerCase().match(/\.(mhtml|mht)$/)
        );
        
        if (invalidFiles.length > 0) {
          await showSwalToast(`以下檔案格式不正確: ${invalidFiles.map(f => f.name).join(', ')}`, 'error');
          return;
        }
        
        this.isProcessing = true;
        
        try {
          const allParsedData = [];
          const newUploadedFiles = [];
          
          for (const file of files) {
            const result = await this.sendFileToBackend(file);
            
            if (result.success && result.data.length > 0) {
              allParsedData.push(...result.data);
              
              newUploadedFiles.push({
                name: file.name,
                size: file.size,
                uploadTime: new Date().toLocaleString('zh-TW'),
                recordCount: result.data.length
              });
            }
          }
          
          this.uploadedFiles.push(...newUploadedFiles);
          this.acceptanceData = allParsedData.map(item => {
            const pickupPerson = item.pickupPerson || '';
            const processedItem = {
              ...item,
              materialStatus: 'pending',
              receivedStatus: 'pending'
            };

            // 判斷邏輯
            if (
              pickupPerson.includes('K7') ||
              pickupPerson.includes('智能櫃') ||
              /^[A-Z]-\d+$/.test(pickupPerson)
            ) {
              processedItem.materialStatus = 'completed'; // 代領料
              processedItem.receivedStatus = 'pending';
            } else {
              processedItem.materialStatus = 'pending';
              processedItem.receivedStatus = 'completed'; // 待驗收
            }

            return processedItem;
          });
          
          if (allParsedData.length > 0) {
            await showSwalToast(`成功解析 ${allParsedData.length} 筆驗收資料`, 'success');
          } else {
            await showSwalToast('沒有解析到有效資料', 'error');
          }
          
        } catch (error) {
          console.error('檔案處理錯誤:', error);
          await showSwalToast(`處理失敗: ${error.message}`, 'error');
        } finally {
          this.isProcessing = false;
          if (this.$refs.fileInput) {
            this.$refs.fileInput.value = '';
          }
        }
      },
      
      async sendFileToBackend(file) {
        const formData = new FormData();
        formData.append('file', file);
        
        try {
          const response = await fetch(`${API_BASE_URL}/parse-mhtml?${siteQuery()}`, {
            method: 'POST',
            body: formData
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '後台解析失敗');
          }
          
          return await response.json();
          
        } catch (error) {
          console.error('後台解析錯誤:', error);
          throw error;
        }
      },
      
      async approveItem(item) {
        item.status = 'approved';
        await showSwalToast(`${item.rtNo} 已核准`, 'success');
      },
      
      async rejectItem(item) {
        item.status = 'rejected';
        await showSwalToast(`${item.rtNo} 已拒絕`, 'error');
      },
      
      async sendSingleNotification(item) {
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          item.status = 'sent';
          await showSwalToast(`${item.rtNo} 通知已發送`, 'success');
        } catch (error) {
          await showSwalToast('發信失敗', 'error');
        }
      },
      
      selectAll(e) {
        const isChecked = e.target.checked;
        this.acceptanceData.forEach(item => {
          item.selected = isChecked;
        });
      },
      
      async selectAllItems() {
        const allSelected = this.acceptanceData.every(item => item.selected);
        const newSelectState = !allSelected;
        
        this.acceptanceData.forEach(item => {
          item.selected = newSelectState;
        });
        
        this.$nextTick(() => {
          const headerCheckbox = document.querySelector('table thead input[type="checkbox"]');
          if (headerCheckbox) {
            headerCheckbox.checked = newSelectState;
          }
        });
        
        const selectedCount = this.acceptanceData.filter(item => item.selected).length;
        if (selectedCount > 0) {
          await showSwalToast(`已選擇 ${selectedCount} 個項目`, 'success');
        } else {
          await showSwalToast('已取消所有選擇', 'info');
        }
      },

      async sendMail() {
        const selectedItems = this.acceptanceData.filter(item => item.selected);
        if (selectedItems.length === 0) {
          await showSwalToast('請先選擇要發MAIL的項目', 'error');
          return;
        }
        
        localStorage.setItem('selectedItems', JSON.stringify(selectedItems));
        window.location.href = 'sendAccMail.html';
      },
      
      async resetData() {
        const result = await showAlert({
          title: '確認重置',
          text: '是否要清除所有資料？',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: '確定重置',
          cancelButtonText: '取消',
          confirmButtonColor: '#d33'
        });

        if (result.isConfirmed) {
          this.isCleaningUp = true;
          
          // 模擬清理過程
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          this.acceptanceData = [];
          this.uploadedFiles = [];
          this.isCleaningUp = false;
          
          await showSwalToast('已重置，可重新上傳', 'info');
        }
      },
      
      async exportResults() {
        await showSwalToast('功能開發中', 'info');
      },
      
      getStatusText(status, item = null) {
        const statusMap = {
          'pending': '待驗收',
          'approved': '已核准',
          'rejected': '已拒絕',
          'sent': '已發信'
        };

        if (item) {
          if (item.materialStatus === 'completed' && item.receivedStatus === 'pending') {
            return '代領料';
          } else if (item.receivedStatus === 'completed') {
            return '待驗收';
          }
        }

        return statusMap[status] || '未知';
      },
          
      getAssignTypeClass(assignType) {
        const classes = {
          'K': 'bg-orange-100 text-orange-800',
          'R': 'bg-green-100 text-green-800',
          'A': 'bg-blue-100 text-blue-800',
          'I': 'bg-purple-100 text-purple-800',
          'O': 'bg-yellow-100 text-yellow-800',
          'H': 'bg-red-100 text-red-800',
          'T': 'bg-indigo-100 text-indigo-800'
        };
        return classes[assignType] || 'bg-gray-100 text-gray-800';
      },
      
      formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      },
      
      async showRuleExplanation() {
        await showAlert({
          icon: 'info',
          title: '驗收發信管理系統 - 操作指南',
          html: `
            <div style="text-align: left; max-height: 70vh; overflow-y: auto; font-family: 'Microsoft JhengHei', sans-serif;">
              
              <!-- 系統概述 -->
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 10px; margin-bottom: 15px; color: white; box-shadow: 0 3px 10px rgba(102, 126, 234, 0.3);">
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                  <span style="font-size: 20px; margin-right: 10px;">🚀</span>
                  <h4 style="margin: 0; font-size: 18px; font-weight: 600;">系統功能概述</h4>
                </div>
                <p style="margin: 0; font-size: 14px; line-height: 1.5; opacity: 0.95;">
                  本系統提供完整的驗收流程管理，從文件上傳到自動發信通知，讓驗收作業更加高效便捷。
                </p>
              </div>

              <!-- 操作流程 -->
              <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); padding: 20px; border-radius: 10px; margin-bottom: 15px; color: white; box-shadow: 0 3px 10px rgba(17, 153, 142, 0.3);">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                  <span style="font-size: 20px; margin-right: 10px;">⚡</span>
                  <h4 style="margin: 0; font-size: 18px; font-weight: 600;">快速操作流程</h4>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                  <div style="background: rgba(255,255,255,0.15); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 16px; margin-bottom: 5px;">📤</div>
                    <div style="font-weight: 600; font-size: 13px;">上傳 MHTML</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.15); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 16px; margin-bottom: 5px;">🔍</div>
                    <div style="font-weight: 600; font-size: 13px;">解析資料</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.15); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 16px; margin-bottom: 5px;">✅</div>
                    <div style="font-weight: 600; font-size: 13px;">狀態管理</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.15); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 16px; margin-bottom: 5px;">📧</div>
                    <div style="font-weight: 600; font-size: 13px;">發送通知</div>
                  </div>
                </div>
              </div>

              <!-- 操作說明圖解 -->
              <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 20px; border-radius: 10px; margin-bottom: 15px; color: white; box-shadow: 0 3px 10px rgba(79, 172, 254, 0.3);">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                  <span style="font-size: 20px; margin-right: 10px;">🖼️</span>
                  <h4 style="margin: 0; font-size: 18px; font-weight: 600;">操作說明圖解</h4>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 15px;">
                  <!-- 圖片1 -->
                  <div style="background: rgba(255,255,255,0.15); border-radius: 8px; padding: 15px;">
                    <div style="background: white; border-radius: 6px; padding: 10px; margin-bottom: 10px;">
                      <img src="../static/picture/acc_mhtml_page.png" 
                          alt="操作說明圖 1"
                          style="width: 100%; border-radius: 4px;" />
                    </div>
                    <div style="text-align: center; font-size: 13px; color: #333; font-weight: 500; background: rgba(255,255,255,0.9); padding: 8px; border-radius: 6px;">
                      來到此頁面後，直接儲存下來
                    </div>
                  </div>

                  <!-- 圖片2 -->
                  <div style="background: rgba(255,255,255,0.15); border-radius: 8px; padding: 15px;">
                    <div style="background: white; border-radius: 6px; padding: 10px; margin-bottom: 10px;">
                      <img src="../static/picture/acc_mhtml_download.png" 
                          alt="操作說明圖 2"
                          style="width: 100%; border-radius: 4px;" />
                    </div>
                    <div style="text-align: center; font-size: 13px; color: #333; font-weight: 500; background: rgba(255,255,255,0.9); padding: 8px; border-radius: 6px;">
                      選擇「網頁，單一檔案」格式進行下載
                    </div>
                  </div>
                </div>
              </div>

              <!-- 狀態說明 -->
              <div style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); padding: 20px; border-radius: 10px; margin-bottom: 15px; color: #333; box-shadow: 0 3px 10px rgba(250, 112, 154, 0.3);">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                  <span style="font-size: 20px; margin-right: 10px;">🎯</span>
                  <h4 style="margin: 0; font-size: 18px; font-weight: 600;">狀態類型說明</h4>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                  <div style="background: rgba(255,255,255,0.4); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 18px; margin-bottom: 5px;">⏳</div>
                    <div style="font-weight: 600; color: #ff6b35; font-size: 13px;">待驗收</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.4); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 18px; margin-bottom: 5px;">✅</div>
                    <div style="font-weight: 600; color: #28a745; font-size: 13px;">已核准</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.4); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 18px; margin-bottom: 5px;">❌</div>
                    <div style="font-weight: 600; color: #dc3545; font-size: 13px;">已拒絕</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.4); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 18px; margin-bottom: 5px;">📨</div>
                    <div style="font-weight: 600; color: #6f42c1; font-size: 13px;">已發信</div>
                  </div>
                </div>
              </div>

              <!-- 批量操作 -->
              <div style="background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%); padding: 20px; border-radius: 10px; margin-bottom: 15px; color: #333; box-shadow: 0 3px 10px rgba(168, 237, 234, 0.3);">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                  <span style="font-size: 20px; margin-right: 10px;">⚙️</span>
                  <h4 style="margin: 0; font-size: 18px; font-weight: 600;">批量操作功能</h4>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                  <div style="background: rgba(255,255,255,0.5); padding: 12px; border-radius: 8px; border-left: 3px solid #17a2b8;">
                    <div style="font-weight: 600; margin-bottom: 5px; color: #17a2b8; font-size: 13px;">全選功能</div>
                    <div style="font-size: 12px; color: #666;">一鍵選擇所有項目</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.5); padding: 12px; border-radius: 8px; border-left: 3px solid #28a745;">
                    <div style="font-weight: 600; margin-bottom: 5px; color: #28a745; font-size: 13px;">批量核准</div>
                    <div style="font-size: 12px; color: #666;">同時核准多個項目</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.5); padding: 12px; border-radius: 8px; border-left: 3px solid #ffc107;">
                    <div style="font-weight: 600; margin-bottom: 5px; color: #e0a800; font-size: 13px;">批量發信</div>
                    <div style="font-size: 12px; color: #666;">一次發送多個通知</div>
                  </div>
                  <div style="background: rgba(255,255,255,0.5); padding: 12px; border-radius: 8px; border-left: 3px solid #6f42c1;">
                    <div style="font-weight: 600; margin-bottom: 5px; color: #6f42c1; font-size: 13px;">混合選擇</div>
                    <div style="font-size: 12px; color: #666;">支援個別處理</div>
                  </div>
                </div>
              </div>

              <!-- 注意事項 -->
              <div style="background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%); padding: 20px; border-radius: 10px; border: 2px solid #ff8a65; box-shadow: 0 3px 10px rgba(255, 138, 101, 0.3);">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                  <span style="font-size: 20px; margin-right: 10px;">⚠️</span>
                  <h4 style="margin: 0; font-size: 18px; font-weight: 600; color: #d84315;">注意事項</h4>
                </div>
                
                <div style="background: rgba(255,255,255,0.6); padding: 15px; border-radius: 8px;">
                  <ul style="margin: 0; padding-left: 20px; color: #666; line-height: 1.6; font-size: 13px;">
                    <li>檔案大小限制：50MB</li>
                    <li>支援格式：.mhtml 和 .mht</li>
                    <li>已發信項目無法再次操作</li>
                    <li>建議先核准再發信，確保流程正確</li>
                    <li>系統會自動記錄所有操作歷程</li>
                  </ul>
                </div>
              </div>
            </div>
          `,
          confirmButtonText: '我知道了',
          confirmButtonColor: '#667eea',
          width: '800px',
          customClass: {
            popup: 'rule-explanation-popup'
          }
        });
      }
    }
  }).mount('#app');
  
});