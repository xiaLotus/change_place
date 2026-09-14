// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

Chart.register(ChartDataLabels);

const app = Vue.createApp({
    data() {
        return {
            username: '',
            // 数据
            normalData: {}, // 正常花费 { '2024-01': 10000, ... }
            wbsData: {}, // WBS花费
            allMonths: [], // 所有可用月份

            // 时间筛选
            startMonth: '',
            endMonth: '',
            currentMonth: '',
            filteredMonths: [],

            // 自定義月份選擇器
            startYear: '',
            startMonthNum: '',
            endYear: '',
            endMonthNum: '',
            yearOptions: [],
            monthOptions: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],

            // 图表实例
            normalChart: null,
            wbsChart: null,

            // 状态
            isLoading: false,
            error: '',
            info: '',
            dateWarning: '',

            // 防止連續操作
            isButtonDisabled: false,
            countdown: 0,

            // 視窗 resize 處理
            resizeTimer: null,

            rtData: {},
        }
    },
    computed: {
        // 正常花费总计
        totalNormalExpense() {
            return this.filteredMonths.reduce((sum, month) => {
                return sum + (this.normalData[month] || 0);
            }, 0);
        },

        // WBS花费总计
        totalWBSExpense() {
            return this.filteredMonths.reduce((sum, month) => {
                return sum + (this.wbsData[month] || 0);
            }, 0);
        },

        // 正常花费平均值
        avgNormalExpense() {
            if (this.filteredMonths.length === 0) return 0;
            return this.totalNormalExpense / this.filteredMonths.length;
        },

        // WBS花费平均值
        avgWBSExpense() {
            if (this.filteredMonths.length === 0) return 0;
            return this.totalWBSExpense / this.filteredMonths.length;
        }
    },
    methods: {
        // 初始化年份選項
        initYearOptions() {
            const currentYear = new Date().getFullYear();
            this.yearOptions = [];
            for (let year = 2020; year <= currentYear; year++) {
                this.yearOptions.push(year);
            }
        },

        // 更新開始月份
        updateStartMonth() {
            if (this.startYear && this.startMonthNum) {
                this.startMonth = `${this.startYear}-${this.startMonthNum}`;

                // ✅ 自動將結尾設為開始月份後第 8 個月
                const end = new Date(`${this.startYear}-${this.startMonthNum}-01`);
                end.setMonth(end.getMonth() + 7);
                const endYear = end.getFullYear();
                const endMonth = String(end.getMonth() + 1).padStart(2, '0');
                this.endMonth = `${endYear}-${endMonth}`;
                this.endYear = String(endYear);
                this.endMonthNum = endMonth;

                this.validateDateRange();
            }
        },

        // 更新結束月份
        updateEndMonth() {
            if (this.endYear && this.endMonthNum) {
                this.endMonth = `${this.endYear}-${this.endMonthNum}`;
                this.validateDateRange();
            }
        },

        // 從 YYYY-MM 格式解析到選擇器
        parseMonthToSelectors() {
            if (this.startMonth) {
                const [year, month] = this.startMonth.split('-');
                this.startYear = year;
                this.startMonthNum = month;
            }
            if (this.endMonth) {
                const [year, month] = this.endMonth.split('-');
                this.endYear = year;
                this.endMonthNum = month;
            }
        },

        // 格式化货币
        formatCurrency(value) {
            if (!value) return '0';
            return new Intl.NumberFormat('zh-TW', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(Math.round(value));
        },

        // 获取日期范围CSS类
        getChangeClass(change) {
            if (change === 0) return 'change-neutral';
            return change > 0 ? 'change-positive' : 'change-negative';
        },

        // 计算正常花费环比
        getNormalChange(month, index) {
            if (index === 0) return 0;
            const prevMonth = this.filteredMonths[index - 1];
            const current = this.normalData[month] || 0;
            const previous = this.normalData[prevMonth] || 0;

            if (previous === 0) return 0;
            return ((current - previous) / previous) * 100;
        },

        // 计算WBS花费环比
        getWBSChange(month, index) {
            if (index === 0) return 0;
            const prevMonth = this.filteredMonths[index - 1];
            const current = this.wbsData[month] || 0;
            const previous = this.wbsData[prevMonth] || 0;

            if (previous === 0) return 0;
            return ((current - previous) / previous) * 100;
        },

        // 环比文本显示
        getNormalChangeText(change) {
            if (change === 0) return '→ 0%';
            const symbol = change > 0 ? '↑' : '↓';
            return `${symbol} ${Math.abs(change).toFixed(1)}%`;
        },

        getWBSChangeText(change) {
            if (change === 0) return '→ 0%';
            const symbol = change > 0 ? '↑' : '↓';
            return `${symbol} ${Math.abs(change).toFixed(1)}%`;
        },

        // 验证日期范围
        validateDateRange() {
            this.dateWarning = '';
            this.error = '';

            if (!this.startMonth || !this.endMonth) {
                return;
            }

            if (this.startMonth > this.endMonth) {
                this.dateWarning = '開始月份不能晚於結束月份';
                return;
            }

            // 计算月份差异
            const [startY, startM] = this.startMonth.split('-').map(Number);
            const [endY, endM] = this.endMonth.split('-').map(Number);
            const monthDiff = (endY - startY) * 12 + (endM - startM);

            if (monthDiff > 48) {
                this.dateWarning = '時間範圍超過24個月(48個月份)，請縮小查詢範圍';
                return;
            }

            this.dateWarning = '';
        },

        // 生成完整的月份範圍（包含所有月份，即使沒有資料）
        generateMonthRange(startMonth, endMonth) {
            const months = [];
            let current = new Date(startMonth + '-01');
            const end = new Date(endMonth + '-01');

            while (current <= end) {
                const year = current.getFullYear();
                const month = String(current.getMonth() + 1).padStart(2, '0');
                months.push(`${year}-${month}`);

                // 移到下個月
                current.setMonth(current.getMonth() + 1);
            }

            return months;
        },

        // 应用筛选
        applyFilter() {
            if (this.isButtonDisabled) {
                return;
            }

            this.validateDateRange();

            if (this.dateWarning) {
                return;
            }

            if (!this.startMonth || !this.endMonth) {
                this.error = '請選擇開始和結束月份';
                return;
            }

            // 禁用按鈕並開始倒數計時
            this.isButtonDisabled = true;
            this.countdown = 3;

            const timer = setInterval(() => {
                this.countdown--;
                if (this.countdown <= 0) {
                    clearInterval(timer);
                    this.isButtonDisabled = false;
                }
            }, 1000);

            this.error = '';
            // ✅ 重打 API，確保拿到正確範圍的資料
            this.fetchMonthlyExpenses();
        },

        // 重置筛选
        resetFilter() {
            this.startMonth = '';
            this.endMonth = '';
            this.filteredMonths = this.allMonths.slice(-6);
            this.error = '';
            this.info = '';
            this.dateWarning = '';

            this.$nextTick(() => {
                this.updateCharts();
            });
        },

        // 获取当前月份（YYYY-MM格式）
        getCurrentMonth() {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            return `${year}-${month}`;
        },

        // 獲取N個月前的月份（YYYY-MM格式）
        getMonthsAgo(n) {
            const now = new Date();
            now.setMonth(now.getMonth() - n + 1);
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            return `${year}-${month}`;
        },

        // 从后端获取月度花费数据
        async fetchMonthlyExpenses() {
            this.destroyCharts();

            this.isLoading = true;
            this.error = '';

            try {
                const startMonth = this.startMonth || this.getMonthsAgo(8);
                const endMonth = this.endMonth || this.getCurrentMonth();

                const response = await fetch(`http://localhost:5000/api/monthly_expense_analysis?${siteQuery()}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        start_month: startMonth,
                        end_month: endMonth
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();

                if (!result.success) {
                    this.error = result.message || '數據加載失敗';
                    return;
                }

                const data = result.data;

                // ✅ 處理正常花費數據
                this.normalData = {};
                if (data.normal && data.normal.trend) {
                    data.normal.trend.forEach(item => {
                        this.normalData[item.month] = item.amount;
                    });
                }

                // ✅ 處理WBS花費數據
                this.wbsData = {};
                if (data.wbs && data.wbs.trend) {
                    data.wbs.trend.forEach(item => {
                        this.wbsData[item.month] = item.amount;
                    });
                }

                // ✅ 處理 RT 驗收資料
                this.rtData = {};
                if (data.rt && data.rt.trend) {
                    data.rt.trend.forEach(item => {
                        this.rtData[item.month] = item.amount;
                    });
                }

                // 获取所有月份
                const normalMonths = Object.keys(this.normalData).sort();
                const wbsMonths = Object.keys(this.wbsData).sort();
                this.allMonths = Array.from(new Set([...normalMonths, ...wbsMonths])).sort();

                if (this.allMonths.length === 0) {
                    this.error = '選定範圍內無數據';
                } else {
                    this.filteredMonths = this.generateMonthRange(startMonth, endMonth);
                    this.info = `共載入 ${this.filteredMonths.length} 個月的數據`;

                    this.$nextTick(() => {
                        this.updateCharts();
                    });
                }
            } catch (err) {
                console.error('Error fetching monthly expenses:', err);
                this.error = `數據加載失敗: ${err.message}`;
            } finally {
                this.isLoading = false;
            }
        },

        // 銷毀所有圖表
        destroyCharts() {
            if (this.normalChart) {
                this.normalChart.destroy();
                this.normalChart = null;
            }
            if (this.wbsChart) {
                this.wbsChart.destroy();
                this.wbsChart = null;
            }
        },

        // 更新图表
        updateCharts() {
            this.destroyCharts();

            this.$nextTick(() => {
                this.updateNormalChart();
                this.updateWBSChart();
            });
        },

        // 處理視窗大小改變
        handleResize() {
            if (this.resizeTimer) {
                clearTimeout(this.resizeTimer);
            }

            this.resizeTimer = setTimeout(() => {
                if (this.normalChart) {
                    this.normalChart.resize();
                }
                if (this.wbsChart) {
                    this.wbsChart.resize();
                }
            }, 300);
        },

        // 每月花費
        updateNormalChart() {
            const ctx = document.getElementById('normalChart');
            if (!ctx) return;

            const labels = this.filteredMonths;
            const normalData = labels.map(month => this.normalData[month] || 0);
            const rtData = labels.map(month => this.rtData[month] || 0);

            this.normalChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '每月開單 (元)',
                        type: 'bar',
                        data: normalData,
                        backgroundColor: 'rgba(102, 126, 234, 0.85)',
                        borderColor: 'rgba(102, 126, 234, 1)',
                        borderWidth: 1,
                        borderRadius: 6,
                        yAxisID: 'y'
                    }, {
                        label: '每月驗收 (元)',
                        type: 'bar',
                        data: rtData,
                        backgroundColor: 'rgba(249, 115, 22, 0.85)',
                        borderColor: 'rgba(249, 115, 22, 1)',
                        borderWidth: 1,
                        borderRadius: 6,
                        yAxisID: 'y'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                font: {
                                    size: 12
                                },
                                padding: 15
                            }
                        },
                        datalabels: {
                            color: '#1a202c',
                            font: {
                                weight: 'bold',
                                size: 13
                            },
                            formatter: (value) => {
                                if (value === 0) return '';
                                return this.formatCurrency(value / 10000) + '萬';
                            },
                            anchor: 'end',
                            align: 'top',
                            offset: 3
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: (value) => this.formatCurrency(value / 10000) + '萬',
                                font: {
                                    size: 11
                                }
                            },
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)'
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        },

        // 更新WBS花费图表
        updateWBSChart() {
            const ctx = document.getElementById('wbsChart');
            if (!ctx) return;

            const labels = this.filteredMonths;
            const data = labels.map(month => this.wbsData[month] || 0);
            const maxValue = Math.max(...data);

            const colors = data.map(value => {
                const ratio = maxValue > 0 ? value / maxValue : 0;
                const hue = 300 - (ratio * 60);
                return `hsl(${hue}, 75%, 60%)`;
            });

            this.wbsChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'WBS花費 (元)',
                        data: data,
                        backgroundColor: colors,
                        borderColor: colors,
                        borderWidth: 1,
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                font: {
                                    size: 12
                                },
                                padding: 15
                            }
                        },
                        datalabels: {
                            color: '#1a202c',
                            font: {
                                weight: 'bold',
                                size: 13
                            },
                            formatter: (value) => {
                                if (value === 0) return '';
                                return this.formatCurrency(value / 10000) + '萬';
                            },
                            anchor: 'end',
                            align: 'top',
                            offset: 3
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: (value) => {
                                    return this.formatCurrency(value / 10000) + '萬';
                                },
                                font: {
                                    size: 11
                                }
                            },
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)'
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        },

        goPurchaseRequestSystem() {
            if (this.username) {
                localStorage.setItem('username', this.username);
            }
            window.location.href = 'Procurement_Dynamic_360_Dashboard.html';
        },
    },
    mounted() {
        this.username = localStorage.getItem('username') || '';

        // 初始化年份選項
        this.initYearOptions();

        // 初始化当前月份
        this.currentMonth = this.getCurrentMonth();

        // ✅ 初始化預設顯示最近8個月
        this.startMonth = this.getMonthsAgo(8);
        this.endMonth = this.getCurrentMonth();

        // 解析到選擇器
        this.parseMonthToSelectors();

        // 获取数据
        this.fetchMonthlyExpenses();

        // 監聽視窗大小改變
        window.addEventListener('resize', this.handleResize);
    },

    beforeUnmount() {
        // 移除 resize 事件監聽
        window.removeEventListener('resize', this.handleResize);

        // 清除計時器
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
        }

        // 銷毀圖表
        this.destroyCharts();
    }
});

app.mount('#app');

// 10.11.104.247:7001