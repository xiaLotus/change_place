// ── 廠區 / 使用者：登入時由後端回傳並存於 localStorage，每次 API 請求都帶在 query string ──
const SITE = localStorage.getItem('site') || '';
const SITE_USER = localStorage.getItem('username') || '';
const siteQuery = () => `site=${encodeURIComponent(SITE)}&username=${encodeURIComponent(SITE_USER)}`;

// ============================================================
//  Message_Board.js  —  Vue Options API
//  格式與 Planned_Purchase_Request_List.js 一致
// ============================================================

const _authorColorMap = {};
const _authorColorPalette = [
    '#6366f1', '#ec4899', '#14b8a6', '#f59e0b',
    '#10b981', '#3b82f6', '#8b5cf6', '#ef4444',
    '#0ea5e9', '#f97316',
];
let _authorColorIdx = 0;

const app = Vue.createApp({

    // ──────────────────────────────────────
    //  資料
    // ──────────────────────────────────────
    data() {
        return {
            username:      localStorage.getItem('username') || '',
            myChineseName: '',

            // 頻道
            selectedChannel: 'general',  // 實際值在 mounted() 取得 username 後才載入
            channels: [
                { id: 'general',    icon: '📢', name: '一般公告',   description: '一般事項與公告訊息' },
                { id: 'purchase',   icon: '📦', name: '採購討論',   description: '請購單、比價、訂單等討論' },
                { id: 'acceptance', icon: '✅', name: '驗收協調',   description: '到貨確認、驗收問題協調' },
                { id: 'budget',     icon: '💰', name: '預算追蹤',   description: '預算使用狀況與超支預警' },
                { id: 'urgent',     icon: '🚨', name: '緊急事項',   description: '需要立即處理的緊急問題' },
            ],

            // 訊息資料（由後端載入）
            messages: [],

            // 各頻道最新訊息時間戳（來自後端）
            latestTimestamps: {},

            // Discord 風格：每個頻道的已讀 last_read_id（從後端載入）
            lastReadIds: {},   // { general: 42, purchase: 17, ... }

            // 釘選欄展開狀態
            pinnedExpanded: {},

            // 輸入區
            newMessage:  '',
            selectedTag: '',
            replyingTo:  null,

            // 搜尋
            searchQuery:    '',
            searchMode:     'content',   // 'content' | 'author' | 'time'
            searchDateFrom: '',
            searchDateTo:   '',
            searchModes: [
                { key: 'content', label: '內容' },
                { key: 'author',  label: '人員' },
                { key: 'time',    label: '時間' },
            ],

            // 載入中
            isLoading: false,

            // 滑到最下方按鈕顯示控制
            showScrollBtn: false,

            // 未讀浮動提示
            hasScrolledToUnread: false,

            // 標籤選項
            tagOptions: [
                '📌 重要',
                '❓ 問題',
                '✅ 完成',
                '⚠️ 注意',
                '📦 採購',
                '💰 預算',
            ],

            // 快速 Emoji
            quickEmojis: ['👍', '❤️', '😄', '✅'],

            // 🔁 自動輪詢控制
            pollTimer: null,           // setInterval 參考
            pollInterval: 3000,        // 輪詢間隔（毫秒），建議生產環境改為 3000~5000
            isPolling: false,          // 避免重複啟動
        };
    },

    // ──────────────────────────────────────
    //  監聽
    // ──────────────────────────────────────
    watch: {
        selectedChannel(newCh) {
            this.hasScrolledToUnread = false;
            this.fetchMessages(newCh);
        },
    },

    // ──────────────────────────────────────
    //  計算屬性
    // ──────────────────────────────────────
    computed: {

        usernameInitial() {
            return this.getInitial(this.myChineseName || this.username);
        },

        displayName() {
            return this.myChineseName || this.username;
        },

        currentChannelObj() {
            return this.channels.find(c => c.id === this.selectedChannel) || this.channels[0];
        },

        pinnedMessages() {
            return this.messages
                .filter(m => m.channel === this.selectedChannel && m.pinned && m.type !== 'system')
                .sort((a, b) => {
                    // 用 pinned_at 排序（最新釘選在最上面），沒有 pinned_at 就用 timestamp
                    const ta = a.pinned_at || a.timestamp || '';
                    const tb = b.pinned_at || b.timestamp || '';
                    return tb.localeCompare(ta);
                });
        },

        isPinnedExpanded() {
            return !!this.pinnedExpanded[this.selectedChannel];
        },

        // 當前頻道未讀數（Discord 風格：id > last_read_id）
        unreadBannerCount() {
            const readId = this.lastReadIds[this.selectedChannel] ?? -1;
            return this.filteredMessages.filter(m =>
                m.type !== 'system' &&
                m.author !== (this.myChineseName || this.username) &&
                m.id > readId
            ).length;
        },

        filteredMessages() {
            let msgs = this.messages.filter(m => m.channel === this.selectedChannel);

            if (this.searchMode === 'content' && this.searchQuery.trim()) {
                const q = this.searchQuery.toLowerCase();
                msgs = msgs.filter(m => m.content.toLowerCase().includes(q));

            } else if (this.searchMode === 'author' && this.searchQuery.trim()) {
                const q = this.searchQuery.toLowerCase();
                msgs = msgs.filter(m =>
                    m.author.toLowerCase().includes(q) ||          // 姓名
                    (m.emp_id || '').toLowerCase().includes(q)     // 工號
                );

            } else if (this.searchMode === 'time') {
                const from = this.searchDateFrom;
                const to   = this.searchDateTo;
                if (from || to) {
                    msgs = msgs.filter(m => {
                        const d = m.timestamp ? m.timestamp.slice(0, 10) : '';
                        if (from && to) return d >= from && d <= to;
                        if (from)       return d >= from;
                        if (to)         return d <= to;
                        return true;
                    });
                }
            }

            return msgs;
        },
    },

    // ──────────────────────────────────────
    //  掛載
    // ──────────────────────────────────────
    async mounted() {
        this.username = localStorage.getItem('username') || '';
        console.log('👤 使用者名稱：', this.username);
        // 用 username 區分頻道記憶，避免跨使用者共用同一個 key
        const savedCh = localStorage.getItem(`mb_last_channel_${this.username}`);
        if (savedCh) this.selectedChannel = savedCh;

        // 1. 取得中文姓名
        try {
            const res = await axios.post(`http://127.0.0.1:5000/api/get-username-info?${siteQuery()}`, { emp_id: this.username });
            this.myChineseName = res.data?.name || '';
            console.log('👤 中文姓名：', this.myChineseName);
        } catch (err) {
            console.warn('❗ 無法取得使用者姓名：', err);
        }

        // 2. 從後端取得各頻道已讀 id（Ctrl+F5 後從後端重拿，永遠準確）
        await this.fetchLastRead();

        // 3. 取得各頻道最新訊息 id（用於顯示紅點）
        await this.fetchLatestTimestamps();

        // 4. 載入頻道訊息
        // 若 savedCh 與初始值 'general' 相同，watcher 不會觸發，需手動呼叫
        await this.fetchMessages(this.selectedChannel);

        // ✅ 初始化完成後啟動自動輪詢
        this.startPolling();
    },

    // 🧹 元件卸載時務必清除 timer，避免記憶體洩漏
    beforeUnmount() {
        this.stopPolling();
    },
    // ──────────────────────────────────────
    //  方法
    // ──────────────────────────────────────
    methods: {
    // 🔁 開始自動輪詢
        startPolling() {
            if (this.isPolling) return;
            this.isPolling = true;
            
            this.pollTimer = setInterval(() => {
                // 只輪詢「當前頻道」的新訊息（避免過度請求）
                this.fetchMessages(this.selectedChannel);
                
                // 同時更新各頻道最新時間戳（用於紅點提示）
                this.fetchLatestTimestamps();
            }, this.pollInterval);
            
            console.log(`🔄 開始輪詢，間隔：${this.pollInterval}ms`);
        },

        // ⏹️ 停止自動輪詢
        stopPolling() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
                this.isPolling = false;
                console.log('⏹️ 已停止輪詢');
            }
        },

        // 🔄 切換頻道時重置輪詢（可選）
        switchChannel(id) {
            this.selectedChannel = id;
            localStorage.setItem(`mb_last_channel_${this.username}`, id);
            
            // 切換頻道後立即撈取，並保持輪詢
            this.fetchMessages(id);
        },
        // ── 導覽 ──────────────────────────
        goBack() {
            localStorage.setItem('username', this.username);
            window.location.href = 'Procurement_Dynamic_360_Dashboard.html';
        },


        // ── 後端：取得各頻道已讀 id（Discord 風格）──
        async fetchLastRead() {
            try {
                const res = await axios.get(`http://127.0.0.1:5000/api/message-board/last-read/${this.username}?${siteQuery()}`);
                this.lastReadIds = res.data?.last_read || {};
                console.log('📖 已讀 ids：', this.lastReadIds);
            } catch (err) {
                console.warn('❗ 無法取得已讀記錄：', err);
            }
        },

        // ── 後端：標記已讀（捲到底時呼叫）────
        async markRead(channel) {
            const msgs = this.messages.filter(m => m.channel === channel);
            if (!msgs.length) return;
            const maxId = Math.max(...msgs.map(m => m.id || 0));
            const current = this.lastReadIds[channel] ?? -1;
            if (maxId <= current) return;  // 沒有新的，不必呼叫

            try {
                await axios.post(`http://127.0.0.1:5000/api/message-board/mark-read?${siteQuery()}`, {
                    username:    this.username,
                    channel:     channel,
                    last_msg_id: maxId,
                });
                this.lastReadIds = { ...this.lastReadIds, [channel]: maxId };
                console.log(`✅ [${channel}] 已讀到 #${maxId}`);
            } catch (err) {
                console.warn('❗ 標記已讀失敗：', err);
            }
        },

        // ── 後端：取得各頻道最新訊息 id（用於紅點）──
        async fetchLatestTimestamps() {
            try {
                const res = await axios.get(`http://127.0.0.1:5000/api/message-board/latest-timestamps?${siteQuery()}`);
                this.latestTimestamps = res.data || {};
            } catch (err) {
                console.warn('❗ 無法取得最新時間戳：', err);
            }
        },

        // ── 後端：載入頻道訊息 ────────────
        async fetchMessages(channel) {
            this.isLoading = true;
            try {
                const res = await axios.get(`http://127.0.0.1:5000/api/message-board/messages/${channel}?${siteQuery()}`);
                const incoming = res.data?.messages || [];
                // 更新 messages 中屬於此頻道的資料
                const otherChannelMsgs = this.messages.filter(m => m.channel !== channel);
                this.messages = [...otherChannelMsgs, ...incoming];
                this.hasScrolledToUnread = false;
                this.$nextTick(() => {
                    // 有未讀則捲到第一則未讀，否則捲到底
                    const anchor = document.getElementById('first-unread-anchor');
                    if (anchor) {
                        anchor.scrollIntoView({ block: 'center' });
                    } else {
                        this.scrollToBottom();
                    }
                });
            } catch (err) {
                console.warn('❗ 無法載入訊息：', err);
            } finally {
                this.isLoading = false;
            }
        },

        // ── 後端：發送訊息 ────────────────
        async sendMessage() {
            if (!this.newMessage.trim()) return;

            const payload = {
                channel: this.selectedChannel,
                author:  this.myChineseName || this.username,
                emp_id:  this.username,
                content: this.newMessage.trim(),
                tag:     this.selectedTag,
                replyTo: this.replyingTo ? this.replyingTo.id : null,
            };

            try {
                const res = await axios.post(`http://127.0.0.1:5000/api/message-board/send?${siteQuery()}`, payload);
                if (res.data?.success) {
                    this.messages.push(res.data.message);
                    // 更新此頻道的最新訊息 id
                    this.latestTimestamps = {
                        ...this.latestTimestamps,
                        [this.selectedChannel]: res.data.message.id,
                    };
                }
            } catch (err) {
                console.error('❗ 發送訊息失敗：', err);
                return;
            }

            this.newMessage  = '';
            this.selectedTag = '';
            this.replyingTo  = null;
            this.$nextTick(() => {
                this.scrollToBottom();
                this.markRead(this.selectedChannel);
            });
        },

        // ── 撤回訊息（10分鐘內）───────────
        async recallMessage(msg) {
            const sent = new Date(msg.timestamp).getTime();
            if (Date.now() - sent > 10 * 60 * 1000) {
                alert('已超過10分鐘，無法撤回此訊息');
                return;
            }
            if (!confirm('確認撤回這則訊息？\n撤回後所有人將看不到這則訊息。')) return;
            try {
                const res = await axios.post(`http://127.0.0.1:5000/api/message-board/recall?${siteQuery()}`, {
                    msg_id:   msg.id,
                    channel:  msg.channel,
                    username: this.username,
                });
                if (res.data?.success) {
                    const idx = this.messages.findIndex(m => m.id === msg.id && m.channel === msg.channel);
                    if (idx !== -1) this.messages.splice(idx, 1);
                }
            } catch (err) {
                alert('撤回失敗：' + (err.response?.data?.error || String(err)));
            }
        },

        // ── 後端：切換釘選 ────────────────
        async togglePin(msgId, channel) {
            const allowUsers = ["K18251", "C9228", "G9745"]

            // 權限檢查
            if (!allowUsers.includes(this.username)) {
                Swal.fire({
                    icon: "error",
                    title: "無權限",
                    text: "只有管理者可以釘選公告",
                    confirmButtonText: "確定"
                })
                return
            }

            try {
                const res = await axios.post(`http://127.0.0.1:5000/api/message-board/pin?${siteQuery()}`, { msg_id: msgId, channel: channel || this.selectedChannel });
                if (res.data?.success) {
                    const msg = this.messages.find(m => m.id === msgId && m.channel === channel);
                    if (msg) {
                        msg.pinned    = res.data.pinned;
                        msg.pinned_at = res.data.pinned_at || '';
                    }
                }
            } catch (err) {
                console.error('❗ 釘選操作失敗：', err);
            }
        },

        // ── 後端：新增 Emoji 反應 ──────────
        async addReaction(msgId, emoji, channel) {
            try {
                const res = await axios.post(`http://127.0.0.1:5000/api/message-board/reaction?${siteQuery()}`, {
                    msg_id: msgId,
                    emoji,
                    channel: channel || this.selectedChannel,
                });
                if (res.data?.success) {
                    const msg = this.messages.find(m => m.id === msgId && m.channel === (channel || this.selectedChannel));
                    if (msg) msg.reactions = { ...res.data.reactions };
                }
            } catch (err) {
                console.error('❗ 反應操作失敗：', err);
            }
        },

        setReply(msg) {
            this.replyingTo = msg;
        },

        togglePinnedExpanded() {
            const ch = this.selectedChannel;
            this.pinnedExpanded = { ...this.pinnedExpanded, [ch]: !this.pinnedExpanded[ch] };
        },

        scrollToPinned(msgId) {
            const el = document.getElementById('msg-' + msgId);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },

        // ── 新訊息判斷 ────────────────────
        // 某頻道是否有未讀訊息（紅點）
        hasNewMessages(channelId) {
            // latestTimestamps 現在存的是各頻道最新訊息的 id（從後端來，不依賴是否已載入）
            const latestId = this.latestTimestamps[channelId] ?? 0;
            const readId   = this.lastReadIds[channelId] ?? -1;
            return latestId > readId;
        },

        // 某頻道未讀數（已載入的頻道才能算出精確數字）
        newMessageCount(channelId) {
            const readId = this.lastReadIds[channelId] ?? -1;
            return this.messages.filter(
                m => m.channel === channelId && m.type !== 'system' && m.id > readId
            ).length;
        },

        // ── 訊息查詢工具 ──────────────────
        getMessageById(id) {
            return this.messages.find(m => m.id === id) || null;
        },

        getMessageAuthor(id) {
            const msg = this.getMessageById(id);
            return msg ? msg.author : '已刪除';
        },

        getMessageContent(id) {
            const msg = this.getMessageById(id);
            return msg ? msg.content : '（訊息已刪除）';
        },

        hasReactions(reactions) {
            if (!reactions) return false;
            return Object.values(reactions).some(v => v > 0);
        },

        canRecall(msg) {
            // 只有自己發的、且在10分鐘內才可撤回
            if (msg.author !== (this.myChineseName || this.username)) return false;
            if (!msg.timestamp) return false;
            const sent = new Date(msg.timestamp).getTime();
            const now  = Date.now();
            return (now - sent) <= 10 * 60 * 1000;  // 10 分鐘
        },

        isNewMessage(msg) {
            // id > last_read_id，且非自己發的
            if (msg.type === 'system') return false;
            if (msg.author === (this.myChineseName || this.username)) return false;
            const readId = this.lastReadIds[msg.channel] ?? -1;
            return msg.id > readId;
        },

        // ── 日期 / 時間格式化 ─────────────
        showDateDivider(index) {
            const msgs = this.filteredMessages;
            if (index === 0) return true;
            const prev = new Date(msgs[index - 1].timestamp);
            const curr = new Date(msgs[index].timestamp);
            return prev.toDateString() !== curr.toDateString();
        },

        formatDateLabel(ts) {
            const d         = new Date(ts);
            const today     = new Date();
            const yesterday = new Date();
            yesterday.setDate(today.getDate() - 1);

            if (d.toDateString() === today.toDateString())     return '今天';
            if (d.toDateString() === yesterday.toDateString()) return '昨天';

            const y  = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${y}/${mo}/${dd}`;
        },

        formatTime(ts) {
            const d = new Date(ts);
            const y  = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${y}/${mo}/${dd} ${hh}:${mm}`;
        },

        formatVisitTime(ts) {
            if (!ts) return '初次使用';
            const d = new Date(ts);
            return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        },

        // ── 捲動 ──────────────────────────
        scrollToBottom() {
            const container = document.getElementById('messageContainer');
            if (container) {
                container.scrollTop = container.scrollHeight;
                this.showScrollBtn = false;
            }
        },

        onScroll() {
            const container = document.getElementById('messageContainer');
            if (!container) return;
            const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            this.showScrollBtn = distFromBottom > 150;

            // 捲到底 → 標記已讀（Discord 行為）
            if (distFromBottom < 60) {
                this.hasScrolledToUnread = true;
                this.markRead(this.selectedChannel);
            }
        },

        jumpToFirstUnread() {
            const anchor = document.getElementById('first-unread-anchor');
            if (anchor) {
                anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            this.hasScrolledToUnread = true;
            // 點了「N則新訊息」= 已知道有新訊息，標記已讀
            this.markRead(this.selectedChannel);
        },

        scrollToMessage(id, channel) {
            // 若訊息在不同頻道先切換過去
            if (channel && channel !== this.selectedChannel) {
                this.switchChannel(channel);
                this.$nextTick(() => this.scrollToMessage(id));
                return;
            }
            const el = document.getElementById('msg-' + id);
            if (!el) return;
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // 閃爍高亮
            el.classList.remove('msg-highlight');
            void el.offsetWidth; // reflow 重置 animation
            el.classList.add('msg-highlight');
            setTimeout(() => el.classList.remove('msg-highlight'), 1300);
        },

        // ── 外觀輔助 ──────────────────────
        getInitial(name) {
            if (!name) return '?';
            return name.charAt(0).toUpperCase();
        },

        getAuthorColor(name) {
            if (!_authorColorMap[name]) {
                _authorColorMap[name] = _authorColorPalette[_authorColorIdx % _authorColorPalette.length];
                _authorColorIdx++;
            }
            return _authorColorMap[name];
        },

        tagClass(tag) {
            if (!tag) return 'bg-gray-100 text-gray-600';
            if (tag.includes('重要')) return 'bg-red-100 text-red-600';
            if (tag.includes('問題')) return 'bg-yellow-100 text-yellow-700';
            if (tag.includes('完成')) return 'bg-green-100 text-green-700';
            if (tag.includes('注意')) return 'bg-orange-100 text-orange-700';
            if (tag.includes('採購')) return 'bg-blue-100 text-blue-700';
            if (tag.includes('預算')) return 'bg-purple-100 text-purple-700';
            return 'bg-gray-100 text-gray-600';
        },
    },
});

app.mount('#app');