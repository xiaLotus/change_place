# WBS 品項化 — 更改清單

目標：`Buyer_detail.csv` 的 `WBS` 欄改為「每個品項各自獨立」，同一張 ePR 可以只有部分品項是 WBS；
主表 `總金額` 改為「不含 WBS 品項」的金額。

行號以本次交付的檔案為準。app.py 內所有改動處都有 `✏️ WBS-patch ①~⑥` 標記，直接搜尋即可。

---

## 一、更改的檔案（共 6 個）

| # | 檔案 | 類型 | 改動摘要 |
|---|---|---|---|
| 1 | `app.py` | 後端 | 6 處，見下方 |
| 2 | `Planned_Purchase_Request_List.js` | 360 前端 | 細項 WBS 欄（放 ePR No. 後）、WBS 可輸入、總金額排除 WBS 品項（即時／存檔／開啟修正／複製為新單）、每列 WBS 10 碼驗證、移除主表→細項 WBS 同步 |
| 3 | `Procurement_Dynamic_360_Dashboard.html` | 360 前端 | 修正卡片、新增卡片的細項表加 WBS 輸入格（`@input` 即時重算總金額）、紅框列 colspan 調整、總金額標籤改「總金額（不含 WBS 品項）」 |
| 4 | `eRT.js` | eRT 前端 | `visibleColumns` / `defaultColumns` 加入 `WBS`、`需求日` |
| 5 | `supervisor_review.js` | 主管審核前端 | `isWbsRecord()` 永遠回 `false`（WBS 單也進審核）；新增 `wbsDetailCount()`；30 秒自動刷新一併刷新細項 |
| 6 | `Supervisor_review.html` | 主管審核前端 | 細項展開表加 WBS 欄；主列 WBS 欄對混合單顯示「品項×N」徽章；總金額表頭 tooltip；重新整理鈕一併刷新細項 |

**不需要改**：`eRT_page.html`（WBS 表頭已存在、td 是 v-for）、`month_expensive_analysis.js`（API 回傳結構不變）、
`mail.js` / `normail.py` / `urgent.py`（純顯示）、`batch_adjustment.js` / `eHub.js`（品項層級，重建列繼承 WBS）。

---

## 二、app.py 更改內容（依行號）

| 標記 | 行號 | function | route | 改動 |
|---|---|---|---|---|
| ⑥ | L604–687, L716–727 | `monthly_expense_analysis()` | `POST /api/monthly_expense_analysis` | 正常／WBS 趨勢改為品項層級計算 |
| ④ | L978 | `add_new_item()` | `POST /api/add` | `detail_columns[1:-2]` 切片改為顯式排除 `Id / isEditing / backup` |
| ⑤ | L1078 | `update_data()` | `POST /update` | 細項寫回前補齊 28 欄、丟棄多餘欄、固定欄位順序 |
| ① | L3570, L3579 | `upload_buyer_detail()` | `POST /api/update_delivery_receipt` | 兩處 `exit()` 改為 `return jsonify(...), 400` |
| ③ | L3606 | `upload_buyer_detail()` | 同上 | 上傳檔同 PO+品名多列先去重，避免 left join 放大列數 |
| ② | L3676 | `upload_buyer_detail()` | 同上 | `merged[final_columns]` 前先補缺少的欄位，避免其他廠別 KeyError |

### ⑥ `monthly_expense_analysis()` — 這次的主要改動

**舊**：以主表 `WBS` 欄分成正常／WBS 兩群，各自加總主表 `總金額`。

**新**：讀一次 `Buyer_detail.csv`，依主表 `Id` 對應品項列：

| 情況 | WBS 金額 | 正常金額 |
|---|---|---|
| 細項有任一品項填 WBS | Σ 有 WBS 品項的 `總價` | Σ 沒 WBS 品項的 `總價` |
| 細項都沒 WBS，但主表 WBS 有值（舊資料） | 主表 `總金額` | 0 |
| 細項都沒 WBS，主表 WBS 也空 | 0 | 主表 `總金額`（與舊版一致） |

- `總價` 缺值時用 `單價 × 數量`
- `Buyer_detail.csv` 沒有 `WBS` 欄時自動補空欄
- 後面的 RT 入帳趨勢改用 `buyer_df = detail_df.copy()`（不再第二次讀檔）
- 回傳 JSON 結構不變：`data.normal / data.wbs { total, average, count, trend }`、`data.rt.trend`
- `count`：normal = 有正常花費的單數；wbs = 有 WBS 品項的單數（混合單兩邊各算一張）

### ①～⑤ 為既有寫入鏈的修補

與 WBS 欄位本身無關（三道欄位閘門原本就已包含 `WBS`），但同屬 Buyer_detail 寫入路徑，一起處理。
完整前後對照見 `app.py_修改標示.md`。

---

## 三、前端規則摘要（360）

- 細項每列 `WBS`：空白或 10 碼英數字（`/^[A-Za-z0-9]{10}$/`），存檔時逐列驗證
- 主表 `總金額` = Σ（`WBS` 為空的品項 `單價 × 數量`），以下時機都會重算：
  - 細項 `單價 / 數量 / WBS` 輸入時（`@input`）
  - 修正卡片存檔（`saveEdit()`）、新增卡片存檔（`saveNewItem()`）
  - 開啟修正卡片載入歷史資料後（`editItem()`）
  - 複製為新單（`copyToNewItem()`）
- 主表 `WBS` 欄與細項 `WBS` 各自獨立，不再互相同步

---

## 四、多廠別隔離確認

- `SitePath` 類別到第一個 route 之間的程式碼，改前改後 SHA 相同
- 所有改動只透過 `BUYER_FILE` / `CSV_FILE` 讀寫「當前廠別」的檔案
- 上傳流程（eHub 9 個真實檔 + 3 個合成、收貨單、6 個驗收 mhtml）實測：Buyer_detail 的 WBS 只有刻意加上的那一列變動，主表 WBS 0 列變動

---

## 五、驗證方式

```bash
python -m py_compile app.py
node --check Planned_Purchase_Request_List.js
node --check eRT.js
node --check supervisor_review.js
```

月花費分析可用 KH 資料比對：查 2026-06 ~ 2026-09，正常趨勢應與舊版相同，
WBS 趨勢 2026-07 應為 5,900（舊版 3,500 + PO 6100894648 的 WBS 品項 2,400）。