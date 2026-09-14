# 請購動態360看板 — 多廠區（KH / KL / NL）改版 完整測試報告

測試日期：2026-09-14　　整體結果：**後端功能測試 142/142 通過；驗收 / RT / 承諾交期模擬 KH、KL、NL 三廠區全數通過**

## 0. 改版總覽

### 目的
配合擴廠，同一套請購看板要服務 KH / KL / NL 三個廠區，各廠區只看到自己的資料，表單與畫面完全相同。

### 設計
| 項目 | 做法 |
|---|---|
| 廠區定義 | 專案根目錄 `admin.json`：`{"KH": [工號...], "KL": [...], "NL": [...]}`；key 即廠區代碼，value 即該廠區管理者 |
| 廠區判定 | 登入時後端依工號比對：先查 `admin.json`，再逐廠區查 `static/data/<廠區>/<廠區>_Backend_data.json`；回傳 `{site, username}` 給前端存 localStorage |
| 請求帶入 | 前端所有 fetch / axios 一律在 query string 帶 `?site=&username=`（共 95 處）；不使用自訂 header |
| 後端路徑 | `SitePath` 物件依請求的 `site` 動態產生 `static/data/<廠區>/<廠區>_<檔名>`，原本用到路徑常數的 160 多處程式不用改 |
| 資料檔 | 全部加廠區前綴並放各自資料夾：Planned_Purchase_Request_List.csv、Buyer_detail.csv、Backend_data.json、config.cfg、money.json、phone.json、vender.ini、accMailData.json、mailRecipients.json、delivery_receipt.csv（暫存）；留言板與篩選狀態檔也帶廠區前綴 |
| 權限 | 管理者只看 `admin.json[廠區]`；`Backend_data.json` 的 `請購網頁後台` 不再讀取 |
| Log | 每筆請求寫 `[廠區] [工號] METHOD path` |
| 看板顯示 | 標題旁顯示 `廠區/工號-管理` 或 `-USER` |
| 未帶 site | 落回 `DEFAULT_SITE = "KH"` |

### 異動檔案
- `app.py`：SitePath / current_site / current_username / site_admin_ids / SiteJSONProvider / before_request log；登入、admins、get-username-info、check-edit-permission；Mail 呼叫改傳 `recipients_file`
- `MailFunction/normail.py`、`urgent.py`、`acceptanceMail.py`：`send_mail` / `read_configuration` 增加 `recipients_file` 參數
- `static/js/func/*.js`（15 支）與 `MaterialReceivingNoteUpload.html`：檔頭加 `SITE / SITE_USER / siteQuery()`，所有 API URL 帶 query
- `login.js`：存 `site`、`username`，`/api/login` body 帶 `site`
- `Procurement_Dynamic_360_Dashboard.html` + `Planned_Purchase_Request_List.js`：身分標籤
- `Member_manager.html` + `Member_manager.js`：移除「4000 組員」步驟，Notes_ID 直接填、空格即時轉 `_`、`@aseglobal.com` 固定後綴

### 部署目錄
```
專案根目錄/
  admin.json
  app.py  MailFunction/  acceptanceWeb/  ...
  static/data/KH/  KH_Backend_data.json  KH_config.cfg  KH_Planned_Purchase_Request_List.csv  KH_Buyer_detail.csv
                   KH_money.json  KH_phone.json  KH_vender.ini  KH_accMailData.json  KH_mailRecipients.json
  static/data/KL/  KL_ 同上
  static/data/NL/  NL_ 同上
```
資料夾需先建立；CSV 至少要有標題列，json 可先給 `[]` / `{}`。

### 過程中修掉的問題
| 現象 | 原因 | 處理 |
|---|---|---|
| `Object of type SitePath is not JSON serializable` | `/api/next_month_amount` 把路徑放進 jsonify | 註冊 `SiteJSONProvider` 自動轉字串 |
| `No such file: static/data\KL_...` | 舊版 app.py 未含子資料夾邏輯 | 更新 `SitePath.__str__` |
| `/api/requesters` 500、`admins.includes is not a function` | `KL_config.cfg` 未建立 | 建檔 |
| 發信 `No such file: static/data/mailRecipients.json` | MailFunction 三支寫死路徑 | 由 app.py 傳入廠區檔 |
| `No such file: KL_Backend_data.json` | 根目錄檔案搬進子資料夾後未更新常數 | `BACKEND_DATA` / `CONFIG_FILE` 改 `SitePath("static/data", ...)` |

---

## 第一部分：後端功能測試（run_tests.py）

測試日期：2026-09-14　　結果：**142/142 通過**

### 本版變更

1. 管理者權限只從 `admin.json[廠區]` 讀取；`Backend_data.json` 的 `請購網頁後台` 不再參與判斷（`/api/admins`、`/api/get-username-info`、`/api/check-edit-permission`）。
2. 所有廠區檔案（含 `Backend_data.json`、`config.cfg`）統一放在 `static/data/<廠區>/<廠區>_<檔名>`，根目錄只剩 `admin.json`。
3. 需求者新增：移除「是否為 4000 組員」步驟，改為單頁直接填 Notes_ID；輸入時空格即時轉 `_`，`@aseglobal.com` 固定顯示於框後，送出自動組合。
4. `MailFunction` 三支改由 app.py 傳入廠區的 `mailRecipients.json`。

### 測試環境

- KH：真實資料（請購 384 / 明細 964 筆）；KL：1 筆測試單（PO 4500123456，需求者「測試中」）；NL：空表
- `admin.json`：KH = K18251, C9228；KL = G9745；NL = C8849
- LDAP / SMTP 以假物件攔截；後端測試用 Flask test client 帶 `?site=&username=`；Notes_ID 邏輯以 node 直接驗證
- 執行：`python run_tests.py`（專案根目錄）

### 目錄結構

```
專案根目錄/
  admin.json
  static/data/KH/  KH_Backend_data.json  KH_config.cfg  KH_Planned_Purchase_Request_List.csv  KH_Buyer_detail.csv
                   KH_money.json  KH_phone.json  KH_vender.ini  KH_accMailData.json  KH_mailRecipients.json
  static/data/KL/  （同上，KL_ 前綴）
  static/data/NL/  （同上，NL_ 前綴）
```

### 1. 登入與廠區判定（9/9）

| 項目 | 結果 |
|---|---|
| login K18251 → KH | ✓ |
| login C9228 → KH | ✓ |
| login G9745 → KL | ✓ |
| login G9743 → KL | ✓ |
| login C8849 → NL | ✓ |
| login unknown → 404 | ✓ |
| /api/login KH | ✓ |
| /api/login KL | ✓ |
| /api/login NL | ✓ |

### 2. 各廠區 GET 端點（63/63）

| 項目 | 結果 |
|---|---|
| GET /data [KH] | ✓ |
| GET /api/unordered-count [KH] | ✓ |
| GET /api/getrestofmoney [KH] | ✓ |
| GET /api/budget_months [KH] | ✓ |
| GET /api/requesters [KH] | ✓ |
| GET /api/admins [KH] | ✓ |
| GET /api/venders [KH] | ✓ |
| GET /api/buyer_detail [KH] | ✓ |
| GET /api/get_unaccounted_amount [KH] | ✓ |
| GET /api/accounting_summary [KH] | ✓ |
| GET /api/monthly_actual_accounting [KH] | ✓ |
| GET /api/next_month_amount [KH] | ✓ |
| GET /api/get-pending-approval-items [KH] | ✓ |
| GET /api/get-all-items-with-approval [KH] | ✓ |
| GET /api/acc-mail-remarks [KH] | ✓ |
| GET /api/mail-recipients [KH] | ✓ |
| GET /api/message-board/latest-timestamps [KH] | ✓ |
| GET /api/message-board/messages/general [KH] | ✓ |
| GET last-read [KH] | ✓ |
| GET unread [KH] | ✓ |
| GET filters [KH] (無檔案 404 正常) | ✓ |
| GET /data [KL] | ✓ |
| GET /api/unordered-count [KL] | ✓ |
| GET /api/getrestofmoney [KL] | ✓ |
| GET /api/budget_months [KL] | ✓ |
| GET /api/requesters [KL] | ✓ |
| GET /api/admins [KL] | ✓ |
| GET /api/venders [KL] | ✓ |
| GET /api/buyer_detail [KL] | ✓ |
| GET /api/get_unaccounted_amount [KL] | ✓ |
| GET /api/accounting_summary [KL] | ✓ |
| GET /api/monthly_actual_accounting [KL] | ✓ |
| GET /api/next_month_amount [KL] | ✓ |
| GET /api/get-pending-approval-items [KL] | ✓ |
| GET /api/get-all-items-with-approval [KL] | ✓ |
| GET /api/acc-mail-remarks [KL] | ✓ |
| GET /api/mail-recipients [KL] | ✓ |
| GET /api/message-board/latest-timestamps [KL] | ✓ |
| GET /api/message-board/messages/general [KL] | ✓ |
| GET last-read [KL] | ✓ |
| GET unread [KL] | ✓ |
| GET filters [KL] (無檔案 404 正常) | ✓ |
| GET /data [NL] | ✓ |
| GET /api/unordered-count [NL] | ✓ |
| GET /api/getrestofmoney [NL] | ✓ |
| GET /api/budget_months [NL] | ✓ |
| GET /api/requesters [NL] | ✓ |
| GET /api/admins [NL] | ✓ |
| GET /api/venders [NL] | ✓ |
| GET /api/buyer_detail [NL] | ✓ |
| GET /api/get_unaccounted_amount [NL] | ✓ |
| GET /api/accounting_summary [NL] | ✓ |
| GET /api/monthly_actual_accounting [NL] | ✓ |
| GET /api/next_month_amount [NL] | ✓ |
| GET /api/get-pending-approval-items [NL] | ✓ |
| GET /api/get-all-items-with-approval [NL] | ✓ |
| GET /api/acc-mail-remarks [NL] | ✓ |
| GET /api/mail-recipients [NL] | ✓ |
| GET /api/message-board/latest-timestamps [NL] | ✓ |
| GET /api/message-board/messages/general [NL] | ✓ |
| GET last-read [NL] | ✓ |
| GET unread [NL] | ✓ |
| GET filters [NL] (無檔案 404 正常) | ✓ |

### 3. 資料隔離與權限來源（16/16）

| 項目 | 結果 |
|---|---|
| KH 384 筆 | ✓ |
| KL 1 筆 | ✓ |
| NL 0 筆 | ✓ |
| buyer KH/KL/NL = 964/2/0 | ✓ |
| requesters KL | ✓ |
| requesters NL | ✓ |
| admins KH 含 admin.json | ✓ |
| admins KL | ✓ |
| admins NL | ✓ |
| 無 site → 預設 KH | ✓ |
| 錯誤 site → 預設 KH | ✓ |
| get-username-info KL(site in body) | ✓ |
| KH 查不到 KL 工號 | ✓ |
| 後台權限只看 admin.json：G9743(KL 非 admin) → X | ✓ |
| 後台權限只看 admin.json：G9745(KL admin) → O | ✓ |
| /api/admins KL 僅 admin.json 名單 | ✓ |

### 4. NL 請購寫入流程（12/12）

| 項目 | 結果 |
|---|---|
| NL /api/add | ✓ |
| NL +1, KH/KL 不變 | ✓ |
| NL buyer +1 | ✓ |
| NL get_detail | ✓ |
| KH 看不到 NL 明細 | ✓ |
| NL /update | ✓ |
| NL admin 編輯權限 | ✓ |
| KL user 對 NL 無權限 | ✓ |
| NL 待簽核清單 | ✓ |
| NL approve-items | ✓ |
| NL /delete | ✓ |
| NL 刪除後回 0 | ✓ |

### 5. 設定檔寫入隔離（18/18）

| 項目 | 結果 |
|---|---|
| NL requesters/add | ✓ |
| NL config 含新人 | ✓ |
| KH config 不含新人 | ✓ |
| NL phone.json 含新人 | ✓ |
| NL Backend 含新人 | ✓ |
| NL requesters/remove | ✓ |
| NL uploadMoney | ✓ |
| NL money 有 2026/10 | ✓ |
| KH money 無 2026/10 追加=5 | ✓ |
| NL venders POST | ✓ |
| NL vender.ini 含新廠商 | ✓ |
| KH vender.ini 不含 | ✓ |
| NL acc-mail-remarks POST | ✓ |
| NL accMailData 含備註 | ✓ |
| KL accMailData 不含 | ✓ |
| NL mail-recipients POST | ✓ |
| NL mailRecipients 含 NL_Cc | ✓ |
| 驗收信 CC 來自 KL_mailRecipients | ✓ |

### 6. 篩選狀態 / 留言板（5/5）

| 項目 | 結果 |
|---|---|
| KL save-filters | ✓ |
| filters 檔案帶廠區 | ✓ |
| KL mb send | ✓ |
| KL 留言可見 / NL 不可見 | ✓ |
| 留言檔帶廠區 | ✓ |

### 7. 驗收 / 請購 Mail（7/7）

| 項目 | 結果 |
|---|---|
| KL PO→User/ePR | ✓ |
| KH 查不到 KL 的 PO | ✓ |
| KL save-mail(驗收) 200 | ✓ |
| 驗收信已交給 SMTP | ✓ |
| KL sendmail(請購) 200 | ✓ |
| 請購信已交給 SMTP | ✓ |
| KL update_for_mail | ✓ |

### 8. 統計 / 上傳（3/3）

| 項目 | 結果 |
|---|---|
| KH monthly_expense_analysis | ✓ |
| NL(空) monthly_expense_analysis 不炸 | ✓ |
| Status-upload 無檔案回 400 | ✓ |

### 9. Log（2/2）

| 項目 | 結果 |
|---|---|
| log 含 [KL] [G9743] | ✓ |
| log 含 [NL] [C8849] | ✓ |

### 10. 需求者新增 Notes_ID 自動修正（6/6）

| 項目 | 結果 |
|---|---|
| Notes_ID 修正「SDLF FFF」→ SDLF_FFF / SDLF_FFF@aseglobal.com | ✓ |
| Notes_ID 修正「xia kde」→ xia_kde / xia_kde@aseglobal.com | ✓ |
| Notes_ID 修正「Jie_Chiang@aseglobal.com」→ Jie_Chiang / Jie_Chiang@aseglobal.com | ✓ |
| Notes_ID 修正「a  b   c」→ a_b_c / a_b_c@aseglobal.com | ✓ |
| Notes_ID 修正「   」→ _ /  | ✓ |
| Notes_ID 修正「」→  /  | ✓ |

### 其他（1/1）

| 項目 | 結果 |
|---|---|
| NL 移除後不含新人 | ✓ |

### 既有行為備註（非 bug）

- `/api/get-filters-json` 尚未存過篩選時回 404，前端已 catch。
- `/api/venders` POST 新增成功回 201。
- 進看板時自動執行 Buyer_detail → 請購表的驗收狀態 / PO 回寫同步。
- 未帶 `site` 或 `site` 不在 `admin.json` 的請求落回 `DEFAULT_SITE = "KH"`。
- `Backend_data.json` 內 `請購網頁後台` 欄位新增時仍寫 `"X"`，僅為與其他系統共用格式，不影響權限。

---

## 第二部分：驗收 / RT 金額 / 承諾交期 模擬（sim_ert.py）

測試日期：2026-09-14　　廠區：KH（使用上傳的真實 `Buyer_detail.csv` 副本，原檔未動）　　結果：全部通過

### 測試檔案與對應流程

| 上傳檔案 | 對應頁面 / API | 更新欄位 |
|---|---|---|
| `sendMailforBadgeMailNoticeApproveESD_*.xls` × 5 | eHub 上傳 → `/api/save_csv` → 一鍵覆蓋 `/api/save_override_all` | `Delivery Date 廠商承諾交期`、`SOD Qty 廠商承諾數量` |
| `6100xxxxxx-*.mhtml` × 6（PO 單） | 物料收貨單上傳頁 → `/api/upload-mhtml` → `/api/update-buyer-csv` → `/api/cleanup-processed` | `RT金額`、`RT總金額` |
| `物料收貨單-20260727.mhtml` | 驗收檢核 accCheck → `/api/parse-mhtml` → `/api/get-user-epr-data` → sendAccMail `/api/save-mail` | 寄送驗收通知信 |

前置動作：先把 17 筆測試 PO 的 交期 / SOD / RT金額 / 驗收狀態 清空，確認更新是真的寫進去而不是本來就有值。

### 結果摘要

### A. 承諾交期 xls（5 個檔、9 個 PO 項）
- 5 個檔案全部 `status: ok`、`has_mismatch: false`，比對狀態皆為「✅ 相同」（xls 數量與 Buyer_detail 總數一致，無分批 / 合併）。
- 一鍵覆蓋後 9 筆全部寫入：交期由空白 → xls 的日期、SOD 由空白 → xls 數量，逐筆核對相符。
- 涉及 PO：6100839500、6100886903、6100882972、6100882854、6100882973、6100891106（2 項）、6100893173（2 項）。

### B. PO 單 MHTML → RT 金額（6 個檔、10 個品項）
- 6 個 MHTML 都解析到 GridView、`matched_count = total_items`、`unmatched_count = 0`。
- `update-buyer-csv` 每個檔案都回「成功更新 N 筆」，RT金額 / RT總金額 由空白 → 解析值，例如 6100879496 → 42,250 / 211,250；6100880421 三項 → 8,850/177,000、9,250/185,000、9,750/195,000。
- 六個檔案 RT 總額合計 1,307,970。

### C. 物料收貨單 MHTML → 驗收檢核
- 解析 10 筆（RT No 6000295435 ~ 6000302036），PO 對應到需求者 / ePR 全部找到：周彥良、郭任群、繆中明、林景陽。
- 注意：來源 MHTML 的「領料人」欄位本身就是 `郭任?`（企業系統輸出時字元遺失），非解析問題。

### D. 驗收 Mail
- 10 筆項目送 `/api/save-mail` 回 200「郵件發送成功」，SMTP 收到一封，收件人為四位需求者的 Notes_ID + `KH_mailRecipients.json` 的固定 CC。

### 完整輸出

```
前置：清空 17 筆測試 PO 的 交期/SOD/RT金額/驗收狀態，以驗證更新確實發生
======================================================================
A. eHub 上傳廠商承諾交期 xls → /api/save_csv
======================================================================

📄 sendMailforBadgeMailNoticeApproveESD_20260703  (1 列)  HTTP 200  has_mismatch=False
   group PO 6100839500 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   PO 6100839500 item 10 [CIM CT-CP001996 K11-5F Plasm] 狀態=V: 交期 - → 2026/07/31  SOD - → 1  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260707  (1 列)  HTTP 200  has_mismatch=False
   group PO 6100886903 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   PO 6100886903 item 10 [SICK S30B-3011GB 安全區域雷射掃描器] 狀態=V: 交期 - → 2026/07/10  SOD - → 3  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260715  (1 列)  HTTP 200  has_mismatch=False
   group PO 6100882972 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   PO 6100882972 item 10 [CIM S-Z2000000014  K11-6F 46] 狀態=V: 交期 - → 2026/08/14  SOD - → 6  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260717  (4 列)  HTTP 200  has_mismatch=False
   group PO 6100882854 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   group PO 6100882973 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   group PO 6100891106 rows=2 比對狀態=['✅ 相同', '✅ 相同'] → override HTTP 200 ✅ 更新 2 筆，新增 0 筆
   PO 6100882854 item 10 [CIM S-KMT66568 CURRENT COLLE] 狀態=V: 交期 - → 2026/08/21  SOD - → 10  ✅
   PO 6100882973 item 10 [CIM S-KMT60554 DC FLAT MOTOR] 狀態=V: 交期 - → 2026/08/21  SOD - → 12  ✅
   PO 6100891106 item 10 [Keyence GL-S24FH 安全光柵] 狀態=V: 交期 - → 2026/07/31  SOD - → 2  ✅
   PO 6100891106 item 20 [Keyence GL-SP5P 安全光柵用通訊纜線] 狀態=V: 交期 - → 2026/07/31  SOD - → 2  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260725  (2 列)  HTTP 200  has_mismatch=False
   group PO 6100893173 rows=2 比對狀態=['✅ 相同', '✅ 相同'] → override HTTP 200 ✅ 更新 2 筆，新增 0 筆
   PO 6100893173 item 10 [CIM 2020901CF0L01 抗靜電墊塊] 狀態=V: 交期 - → 2026/08/24  SOD - → 3  ✅
   PO 6100893173 item 20 [CIM 2020901CF0M01 抗靜電墊塊] 狀態=V: 交期 - → 2026/08/24  SOD - → 3  ✅

======================================================================
B. PO 單 MHTML → /api/upload-mhtml → /api/update-buyer-csv（RT 金額）
======================================================================

📄 6100879496-CIM_S-KMT68840SR_CONTROL_FRONT_S015_.  HTTP 200 success=True  GridView 1 列
   PO 6100879496 | CIM S-KMT68840SR CONTROL FRONT_S | RT金額 42250.0 | RT總 211250.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 1 筆資料
   PO 6100879496 CIM S-KMT68840SR CON: RT金額  → 42250 | RT總  → 211250 | 驗收狀態  → 

📄 6100880421-ASE-AS114000308-1_時規皮帶輪_AL-SUS__ASE-A  HTTP 200 success=True  GridView 3 列
   PO 6100880421 | ASE-AS114000308-1 時規皮帶輪(AL-SUS)  | RT金額 8850.0 | RT總 177000.0 | 已驗收  | match=True
   PO 6100880421 | ASE-AS114000308-2 時規皮帶輪(AL-SUS)  | RT金額 9250.0 | RT總 185000.0 | 已驗收  | match=True
   PO 6100880421 | ASE-AS11500054 時規皮帶輪(軸承)         | RT金額 9750.0 | RT總 195000.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 3 筆資料
   PO 6100880421 ASE-AS114000308-1 時規: RT金額  → 8850 | RT總  → 177000 | 驗收狀態  → 
   PO 6100880421 ASE-AS114000308-2 時規: RT金額  → 9250 | RT總  → 185000 | 驗收狀態  → 
   PO 6100880421 ASE-AS11500054 時規皮帶輪: RT金額  → 9750 | RT總  → 195000 | 驗收狀態  → 

📄 6100881435-TBD-06-3450-1541_K11-8F-3450_馬達軸心.mht  HTTP 200 success=True  GridView 1 列
   PO 6100881435 | TBD-06-3450-1541 K11-8F-3450 馬達軸 | RT金額 2400.0 | RT總 72000.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 1 筆資料
   PO 6100881435 TBD-06-3450-1541 K11: RT金額  → 2400 | RT總  → 72000 | 驗收狀態  → 

📄 6100882178-TBD-06-4110-1500_K11-8F_4110五合一烤盤.mht  HTTP 200 success=True  GridView 1 列
   PO 6100882178 | TBD-06-4110-1500 K11-8F 4110五合一烤 | RT金額 29500.0 | RT總 265500.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 1 筆資料
   PO 6100882178 TBD-06-4110-1500 K11: RT金額  → 29500 | RT總  → 265500 | 驗收狀態  → 

📄 6100882227-CIM_VX113-1002_Heary-weight_wheel_CIM  HTTP 200 success=True  GridView 2 列
   PO 6100882227 | CIM VX113-1002 Heary-weight whee | RT金額 32320.0 | RT總 129280.0 | 已驗收  | match=True
   PO 6100882227 | CIM VX113-1006 Timing belt 時規皮帶  | RT金額 3235.0 | RT總 12940.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 2 筆資料
   PO 6100882227 CIM VX113-1002 Heary: RT金額  → 32320 | RT總  → 129280 | 驗收狀態  → 
   PO 6100882227 CIM VX113-1006 Timin: RT金額  → 3235 | RT總  → 12940 | 驗收狀態  → 

📄 6100891106-Keyence_GL-S24FH_安全光柵_Keyence_GL-SP5P  HTTP 200 success=True  GridView 2 列
   PO 6100891106 | Keyence GL-S24FH 安全光柵            | RT金額 28000.0 | RT總 56000.0 | 已驗收  | match=True
   PO 6100891106 | Keyence GL-SP5P 安全光柵用通訊纜線        | RT金額 2000.0 | RT總 4000.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 2 筆資料
   PO 6100891106 Keyence GL-S24FH 安全光: RT金額  → 28000 | RT總  → 56000 | 驗收狀態  → 
   PO 6100891106 Keyence GL-SP5P 安全光柵: RT金額  → 2000 | RT總  → 4000 | 驗收狀態  → 

======================================================================
C. 物料收貨單 MHTML（驗收檢核 accCheck）→ /api/parse-mhtml → PO 對應需求者
======================================================================

📄 物料收貨單-20260727.mhtml  HTTP 200  解析 10 筆
    {'rtNo': '6000295435', 'itemNo': '0001', 'poNo': '6100879496', 'quantity': '5', 'pickupPerson': 'AB門'}
    {'rtNo': '6000297871', 'itemNo': '0001', 'poNo': '6100880421', 'quantity': '20', 'pickupPerson': '郭任?'}
    {'rtNo': '6000297871', 'itemNo': '0002', 'poNo': '6100880421', 'quantity': '20', 'pickupPerson': '郭任?'}
    {'rtNo': '6000297871', 'itemNo': '0003', 'poNo': '6100880421', 'quantity': '20', 'pickupPerson': '郭任?'}
    PO→需求者/ePR: {'6100879496': {'eprNo': '2604300394', 'user': '周彥良'}, '6100880421': {'eprNo': '2605220363', 'user': '郭任群'}, '6100881435': {'eprNo': '2606020606', 'user': '郭任群'}, '6100882178': {'eprNo': '2606020600', 'user': '繆中明'}, '6100882227': {'eprNo': '2605290303', 'user': '周彥良'}, '6100891106': {'eprNo': '2607060305', 'user': '林景陽'}}

======================================================================
D. 驗收 Mail：accCheck 選取 → sendAccMail /api/save-mail（SMTP 攔截）
======================================================================
待寄項目: 10 | 需求者: ['周彥良', '林景陽', '繆中明', '郭任群']
save-mail HTTP 200 郵件發送成功,已處理 10 筆資料
SMTP 收到: [('sendmail', ['YenLiang_Chou@aseglobal.com', 'Erix_Kuo@aseglobal.com', 'Otis_Wang@aseglobal.com', 'ChungMing_Miao@aseglobal.com', 'RuiYing_Chan@aseglobal.com', 'Otis_Wang@aseglobal.com'])]

```

### 備註
- 本次以 test client 模擬前端行為：xls 由 SheetJS 轉 CSV 的格式（表頭 `<br>` → 空白、去前兩列）在腳本內重現；MHTML 直接以 multipart 上傳。
- 多廠區改版後這三條流程都只讀寫 `static/data/KH/KH_Buyer_detail.csv` 與 `KH_mailRecipients.json`，路徑正確。
- `sim_ert.py` 可重複執行（每次先還原 Buyer_detail 副本並清空 uploads/）。


---

### 補充：同一組模擬資料放到 KL / NL 資料夾重跑

作法：把 KH 的 `Buyer_detail.csv`、`Planned_Purchase_Request_List.csv`、`Backend_data.json`、`config.cfg` 複製成 KL / NL 的模擬檔（`static/data/KL/KL_*`、`static/data/NL/NL_*`），分別以 `site=KL`（G9745）與 `site=NL`（C8849）重跑 A～D 四段流程。

| 檢查 | KL | NL |
|---|---|---|
| A. 承諾交期 xls 一鍵覆蓋，9 項交期 / SOD 寫入 | 9/9 ✓ | 9/9 ✓ |
| B. 6 個 PO 單 MHTML，RT 金額寫入 | 10/10 ✓ | 10/10 ✓ |
| C. 物料收貨單解析 10 筆 + PO→需求者 | ✓ | ✓ |
| D. 驗收 Mail 送出 | ✓（CC 讀 `KL_mailRecipients.json`：LC_Wang） | ✓（CC 讀 `NL_mailRecipients.json`：RuiYing_Chan / Otis_Wang） |
| 寫入檔案 | `static/data/KL/KL_Buyer_detail.csv` | `static/data/NL/NL_Buyer_detail.csv` |

隔離驗證（MD5）：三個廠區跑前 Buyer_detail 完全相同（`3a04d068…`）；跑完 KL / NL 後兩者變成 `7e6a797c…`，KH 仍為 `3a04d068…` 與原始上傳檔一致 → KL / NL 的流程完全沒有碰到 KH 的檔案。

KL 與 NL 的 D 段收件人 CC 不同，正好證明 mailRecipients 也是各廠區獨立讀取。

執行方式：`python sim_ert.py KL` / `python sim_ert.py NL`（不帶參數即 KH）。

### KL 完整輸出

```
########## 廠區 KL（G9745） 資料路徑 static/data/KL/KL_Buyer_detail.csv ##########
前置：清空 17 筆測試 PO 的 交期/SOD/RT金額/驗收狀態，以驗證更新確實發生
======================================================================
A. eHub 上傳廠商承諾交期 xls → /api/save_csv
======================================================================

📄 sendMailforBadgeMailNoticeApproveESD_20260703  (1 列)  HTTP 200  has_mismatch=False
   group PO 6100839500 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   PO 6100839500 item 10 [CIM CT-CP001996 K11-5F Plasm] 狀態=V: 交期 - → 2026/07/31  SOD - → 1  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260707  (1 列)  HTTP 200  has_mismatch=False
   group PO 6100886903 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   PO 6100886903 item 10 [SICK S30B-3011GB 安全區域雷射掃描器] 狀態=V: 交期 - → 2026/07/10  SOD - → 3  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260715  (1 列)  HTTP 200  has_mismatch=False
   group PO 6100882972 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   PO 6100882972 item 10 [CIM S-Z2000000014  K11-6F 46] 狀態=V: 交期 - → 2026/08/14  SOD - → 6  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260717  (4 列)  HTTP 200  has_mismatch=False
   group PO 6100882854 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   group PO 6100882973 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   group PO 6100891106 rows=2 比對狀態=['✅ 相同', '✅ 相同'] → override HTTP 200 ✅ 更新 2 筆，新增 0 筆
   PO 6100882854 item 10 [CIM S-KMT66568 CURRENT COLLE] 狀態=V: 交期 - → 2026/08/21  SOD - → 10  ✅
   PO 6100882973 item 10 [CIM S-KMT60554 DC FLAT MOTOR] 狀態=V: 交期 - → 2026/08/21  SOD - → 12  ✅
   PO 6100891106 item 10 [Keyence GL-S24FH 安全光柵] 狀態=V: 交期 - → 2026/07/31  SOD - → 2  ✅
   PO 6100891106 item 20 [Keyence GL-SP5P 安全光柵用通訊纜線] 狀態=V: 交期 - → 2026/07/31  SOD - → 2  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260725  (2 列)  HTTP 200  has_mismatch=False
   group PO 6100893173 rows=2 比對狀態=['✅ 相同', '✅ 相同'] → override HTTP 200 ✅ 更新 2 筆，新增 0 筆
   PO 6100893173 item 10 [CIM 2020901CF0L01 抗靜電墊塊] 狀態=V: 交期 - → 2026/08/24  SOD - → 3  ✅
   PO 6100893173 item 20 [CIM 2020901CF0M01 抗靜電墊塊] 狀態=V: 交期 - → 2026/08/24  SOD - → 3  ✅

======================================================================
B. PO 單 MHTML → /api/upload-mhtml → /api/update-buyer-csv（RT 金額）
======================================================================

📄 6100879496-CIM_S-KMT68840SR_CONTROL_FRONT_S015_.  HTTP 200 success=True  GridView 1 列
   PO 6100879496 | CIM S-KMT68840SR CONTROL FRONT_S | RT金額 42250.0 | RT總 211250.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 1 筆資料
   PO 6100879496 CIM S-KMT68840SR CON: RT金額  → 42250 | RT總  → 211250 | 驗收狀態  → 

📄 6100880421-ASE-AS114000308-1_時規皮帶輪_AL-SUS__ASE-A  HTTP 200 success=True  GridView 3 列
   PO 6100880421 | ASE-AS114000308-1 時規皮帶輪(AL-SUS)  | RT金額 8850.0 | RT總 177000.0 | 已驗收  | match=True
   PO 6100880421 | ASE-AS114000308-2 時規皮帶輪(AL-SUS)  | RT金額 9250.0 | RT總 185000.0 | 已驗收  | match=True
   PO 6100880421 | ASE-AS11500054 時規皮帶輪(軸承)         | RT金額 9750.0 | RT總 195000.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 3 筆資料
   PO 6100880421 ASE-AS114000308-1 時規: RT金額  → 8850 | RT總  → 177000 | 驗收狀態  → 
   PO 6100880421 ASE-AS114000308-2 時規: RT金額  → 9250 | RT總  → 185000 | 驗收狀態  → 
   PO 6100880421 ASE-AS11500054 時規皮帶輪: RT金額  → 9750 | RT總  → 195000 | 驗收狀態  → 

📄 6100881435-TBD-06-3450-1541_K11-8F-3450_馬達軸心.mht  HTTP 200 success=True  GridView 1 列
   PO 6100881435 | TBD-06-3450-1541 K11-8F-3450 馬達軸 | RT金額 2400.0 | RT總 72000.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 1 筆資料
   PO 6100881435 TBD-06-3450-1541 K11: RT金額  → 2400 | RT總  → 72000 | 驗收狀態  → 

📄 6100882178-TBD-06-4110-1500_K11-8F_4110五合一烤盤.mht  HTTP 200 success=True  GridView 1 列
   PO 6100882178 | TBD-06-4110-1500 K11-8F 4110五合一烤 | RT金額 29500.0 | RT總 265500.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 1 筆資料
   PO 6100882178 TBD-06-4110-1500 K11: RT金額  → 29500 | RT總  → 265500 | 驗收狀態  → 

📄 6100882227-CIM_VX113-1002_Heary-weight_wheel_CIM  HTTP 200 success=True  GridView 2 列
   PO 6100882227 | CIM VX113-1002 Heary-weight whee | RT金額 32320.0 | RT總 129280.0 | 已驗收  | match=True
   PO 6100882227 | CIM VX113-1006 Timing belt 時規皮帶  | RT金額 3235.0 | RT總 12940.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 2 筆資料
   PO 6100882227 CIM VX113-1002 Heary: RT金額  → 32320 | RT總  → 129280 | 驗收狀態  → 
   PO 6100882227 CIM VX113-1006 Timin: RT金額  → 3235 | RT總  → 12940 | 驗收狀態  → 

📄 6100891106-Keyence_GL-S24FH_安全光柵_Keyence_GL-SP5P  HTTP 200 success=True  GridView 2 列
   PO 6100891106 | Keyence GL-S24FH 安全光柵            | RT金額 28000.0 | RT總 56000.0 | 已驗收  | match=True
   PO 6100891106 | Keyence GL-SP5P 安全光柵用通訊纜線        | RT金額 2000.0 | RT總 4000.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 2 筆資料
   PO 6100891106 Keyence GL-S24FH 安全光: RT金額  → 28000 | RT總  → 56000 | 驗收狀態  → 
   PO 6100891106 Keyence GL-SP5P 安全光柵: RT金額  → 2000 | RT總  → 4000 | 驗收狀態  → 

======================================================================
C. 物料收貨單 MHTML（驗收檢核 accCheck）→ /api/parse-mhtml → PO 對應需求者
======================================================================

📄 物料收貨單-20260727.mhtml  HTTP 200  解析 10 筆
    {'rtNo': '6000295435', 'itemNo': '0001', 'poNo': '6100879496', 'quantity': '5', 'pickupPerson': 'AB門'}
    {'rtNo': '6000297871', 'itemNo': '0001', 'poNo': '6100880421', 'quantity': '20', 'pickupPerson': '郭任?'}
    {'rtNo': '6000297871', 'itemNo': '0002', 'poNo': '6100880421', 'quantity': '20', 'pickupPerson': '郭任?'}
    {'rtNo': '6000297871', 'itemNo': '0003', 'poNo': '6100880421', 'quantity': '20', 'pickupPerson': '郭任?'}
    PO→需求者/ePR: {'6100879496': {'eprNo': '2604300394', 'user': '周彥良'}, '6100880421': {'eprNo': '2605220363', 'user': '郭任群'}, '6100881435': {'eprNo': '2606020606', 'user': '郭任群'}, '6100882178': {'eprNo': '2606020600', 'user': '繆中明'}, '6100882227': {'eprNo': '2605290303', 'user': '周彥良'}, '6100891106': {'eprNo': '2607060305', 'user': '林景陽'}}

======================================================================
D. 驗收 Mail：accCheck 選取 → sendAccMail /api/save-mail（SMTP 攔截）
======================================================================
待寄項目: 10 | 需求者: ['周彥良', '林景陽', '繆中明', '郭任群']
save-mail HTTP 200 郵件發送成功,已處理 10 筆資料
SMTP 收到: [('sendmail', ['YenLiang_Chou@aseglobal.com', 'Erix_Kuo@aseglobal.com', 'Otis_Wang@aseglobal.com', 'ChungMing_Miao@aseglobal.com', 'LC_Wang@aseglobal.com'])]

```

### NL 完整輸出

```
########## 廠區 NL（C8849） 資料路徑 static/data/NL/NL_Buyer_detail.csv ##########
前置：清空 17 筆測試 PO 的 交期/SOD/RT金額/驗收狀態，以驗證更新確實發生
======================================================================
A. eHub 上傳廠商承諾交期 xls → /api/save_csv
======================================================================

📄 sendMailforBadgeMailNoticeApproveESD_20260703  (1 列)  HTTP 200  has_mismatch=False
   group PO 6100839500 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   PO 6100839500 item 10 [CIM CT-CP001996 K11-5F Plasm] 狀態=V: 交期 - → 2026/07/31  SOD - → 1  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260707  (1 列)  HTTP 200  has_mismatch=False
   group PO 6100886903 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   PO 6100886903 item 10 [SICK S30B-3011GB 安全區域雷射掃描器] 狀態=V: 交期 - → 2026/07/10  SOD - → 3  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260715  (1 列)  HTTP 200  has_mismatch=False
   group PO 6100882972 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   PO 6100882972 item 10 [CIM S-Z2000000014  K11-6F 46] 狀態=V: 交期 - → 2026/08/14  SOD - → 6  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260717  (4 列)  HTTP 200  has_mismatch=False
   group PO 6100882854 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   group PO 6100882973 rows=1 比對狀態=['✅ 相同'] → override HTTP 200 ✅ 更新 1 筆，新增 0 筆
   group PO 6100891106 rows=2 比對狀態=['✅ 相同', '✅ 相同'] → override HTTP 200 ✅ 更新 2 筆，新增 0 筆
   PO 6100882854 item 10 [CIM S-KMT66568 CURRENT COLLE] 狀態=V: 交期 - → 2026/08/21  SOD - → 10  ✅
   PO 6100882973 item 10 [CIM S-KMT60554 DC FLAT MOTOR] 狀態=V: 交期 - → 2026/08/21  SOD - → 12  ✅
   PO 6100891106 item 10 [Keyence GL-S24FH 安全光柵] 狀態=V: 交期 - → 2026/07/31  SOD - → 2  ✅
   PO 6100891106 item 20 [Keyence GL-SP5P 安全光柵用通訊纜線] 狀態=V: 交期 - → 2026/07/31  SOD - → 2  ✅

📄 sendMailforBadgeMailNoticeApproveESD_20260725  (2 列)  HTTP 200  has_mismatch=False
   group PO 6100893173 rows=2 比對狀態=['✅ 相同', '✅ 相同'] → override HTTP 200 ✅ 更新 2 筆，新增 0 筆
   PO 6100893173 item 10 [CIM 2020901CF0L01 抗靜電墊塊] 狀態=V: 交期 - → 2026/08/24  SOD - → 3  ✅
   PO 6100893173 item 20 [CIM 2020901CF0M01 抗靜電墊塊] 狀態=V: 交期 - → 2026/08/24  SOD - → 3  ✅

======================================================================
B. PO 單 MHTML → /api/upload-mhtml → /api/update-buyer-csv（RT 金額）
======================================================================

📄 6100879496-CIM_S-KMT68840SR_CONTROL_FRONT_S015_.  HTTP 200 success=True  GridView 1 列
   PO 6100879496 | CIM S-KMT68840SR CONTROL FRONT_S | RT金額 42250.0 | RT總 211250.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 1 筆資料
   PO 6100879496 CIM S-KMT68840SR CON: RT金額  → 42250 | RT總  → 211250 | 驗收狀態  → 

📄 6100880421-ASE-AS114000308-1_時規皮帶輪_AL-SUS__ASE-A  HTTP 200 success=True  GridView 3 列
   PO 6100880421 | ASE-AS114000308-1 時規皮帶輪(AL-SUS)  | RT金額 8850.0 | RT總 177000.0 | 已驗收  | match=True
   PO 6100880421 | ASE-AS114000308-2 時規皮帶輪(AL-SUS)  | RT金額 9250.0 | RT總 185000.0 | 已驗收  | match=True
   PO 6100880421 | ASE-AS11500054 時規皮帶輪(軸承)         | RT金額 9750.0 | RT總 195000.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 3 筆資料
   PO 6100880421 ASE-AS114000308-1 時規: RT金額  → 8850 | RT總  → 177000 | 驗收狀態  → 
   PO 6100880421 ASE-AS114000308-2 時規: RT金額  → 9250 | RT總  → 185000 | 驗收狀態  → 
   PO 6100880421 ASE-AS11500054 時規皮帶輪: RT金額  → 9750 | RT總  → 195000 | 驗收狀態  → 

📄 6100881435-TBD-06-3450-1541_K11-8F-3450_馬達軸心.mht  HTTP 200 success=True  GridView 1 列
   PO 6100881435 | TBD-06-3450-1541 K11-8F-3450 馬達軸 | RT金額 2400.0 | RT總 72000.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 1 筆資料
   PO 6100881435 TBD-06-3450-1541 K11: RT金額  → 2400 | RT總  → 72000 | 驗收狀態  → 

📄 6100882178-TBD-06-4110-1500_K11-8F_4110五合一烤盤.mht  HTTP 200 success=True  GridView 1 列
   PO 6100882178 | TBD-06-4110-1500 K11-8F 4110五合一烤 | RT金額 29500.0 | RT總 265500.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 1 筆資料
   PO 6100882178 TBD-06-4110-1500 K11: RT金額  → 29500 | RT總  → 265500 | 驗收狀態  → 

📄 6100882227-CIM_VX113-1002_Heary-weight_wheel_CIM  HTTP 200 success=True  GridView 2 列
   PO 6100882227 | CIM VX113-1002 Heary-weight whee | RT金額 32320.0 | RT總 129280.0 | 已驗收  | match=True
   PO 6100882227 | CIM VX113-1006 Timing belt 時規皮帶  | RT金額 3235.0 | RT總 12940.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 2 筆資料
   PO 6100882227 CIM VX113-1002 Heary: RT金額  → 32320 | RT總  → 129280 | 驗收狀態  → 
   PO 6100882227 CIM VX113-1006 Timin: RT金額  → 3235 | RT總  → 12940 | 驗收狀態  → 

📄 6100891106-Keyence_GL-S24FH_安全光柵_Keyence_GL-SP5P  HTTP 200 success=True  GridView 2 列
   PO 6100891106 | Keyence GL-S24FH 安全光柵            | RT金額 28000.0 | RT總 56000.0 | 已驗收  | match=True
   PO 6100891106 | Keyence GL-SP5P 安全光柵用通訊纜線        | RT金額 2000.0 | RT總 4000.0 | 已驗收  | match=True
   update-buyer-csv: 200 成功更新 2 筆資料
   PO 6100891106 Keyence GL-S24FH 安全光: RT金額  → 28000 | RT總  → 56000 | 驗收狀態  → 
   PO 6100891106 Keyence GL-SP5P 安全光柵: RT金額  → 2000 | RT總  → 4000 | 驗收狀態  → 

======================================================================
C. 物料收貨單 MHTML（驗收檢核 accCheck）→ /api/parse-mhtml → PO 對應需求者
======================================================================

📄 物料收貨單-20260727.mhtml  HTTP 200  解析 10 筆
    {'rtNo': '6000295435', 'itemNo': '0001', 'poNo': '6100879496', 'quantity': '5', 'pickupPerson': 'AB門'}
    {'rtNo': '6000297871', 'itemNo': '0001', 'poNo': '6100880421', 'quantity': '20', 'pickupPerson': '郭任?'}
    {'rtNo': '6000297871', 'itemNo': '0002', 'poNo': '6100880421', 'quantity': '20', 'pickupPerson': '郭任?'}
    {'rtNo': '6000297871', 'itemNo': '0003', 'poNo': '6100880421', 'quantity': '20', 'pickupPerson': '郭任?'}
    PO→需求者/ePR: {'6100879496': {'eprNo': '2604300394', 'user': '周彥良'}, '6100880421': {'eprNo': '2605220363', 'user': '郭任群'}, '6100881435': {'eprNo': '2606020606', 'user': '郭任群'}, '6100882178': {'eprNo': '2606020600', 'user': '繆中明'}, '6100882227': {'eprNo': '2605290303', 'user': '周彥良'}, '6100891106': {'eprNo': '2607060305', 'user': '林景陽'}}

======================================================================
D. 驗收 Mail：accCheck 選取 → sendAccMail /api/save-mail（SMTP 攔截）
======================================================================
待寄項目: 10 | 需求者: ['周彥良', '林景陽', '繆中明', '郭任群']
save-mail HTTP 200 郵件發送成功,已處理 10 筆資料
SMTP 收到: [('sendmail', ['YenLiang_Chou@aseglobal.com', 'Erix_Kuo@aseglobal.com', 'Otis_Wang@aseglobal.com', 'ChungMing_Miao@aseglobal.com', 'RuiYing_Chan@aseglobal.com', 'Otis_Wang@aseglobal.com'])]

```


---

## 附錄：測試工具
- `run_tests.py`：三廠區 142 項功能測試，`python run_tests.py`
- `sim_ert.py`：以上傳的 xls / MHTML 跑 eHub、RT 金額、驗收檢核、驗收 Mail，`python sim_ert.py [KH|KL|NL]`
- 兩者皆以假物件攔截 LDAP 與 SMTP，不會真的連線或寄信