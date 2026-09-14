import datetime
import json
import os
import re
from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
from ldap3 import Server, Connection, ALL, NTLM # type: ignore
from ldap3.core.exceptions import LDAPException, LDAPBindError # type: ignore
import uuid
from filelock import FileLock, Timeout
from werkzeug.utils import secure_filename
import logging
import shutil
import numpy as np
import traceback

# ── 集中式 Log 設定（路徑與輪轉週期定義於 config.ini）──
from log_config import setup_logging, get_logger
setup_logging()
logger = get_logger('app')

app = Flask(__name__)
CORS(app)

# ── 廠區（Site）設定 ───────────────────────────────────────────────────────
# admin.json：
#   { "KH": ["K18251", ...], "KL": [...], "NL": [...],          ← 廠區代碼：該廠區管理者工號
#     "cross_site": { "K18251": ["KL", "NL"] } }                ← 選填：可跨廠區查閱的工號 → 允許進入的廠區
# 同一工號列在多個廠區的管理者名單，或列在 cross_site，登入時即可選擇要進入的廠區
# 所有資料檔皆放在 static/data/<廠區>/<廠區>_<檔名>
# 前端每一次請求都在 query string 帶 site 與 username（?site=KH&username=K18251）
ADMIN_FILE = "admin.json"
DEFAULT_SITE = "KH"   # 請求未帶 site 時使用的廠區

def load_admin_sites():
    with open(ADMIN_FILE, "r", encoding="utf-8-sig") as f:
        return json.load(f)

def _req_value(key):
    """依序從 query string → JSON body → form 取值"""
    try:
        val = request.args.get(key)
        if val is None:
            body = request.get_json(silent=True)
            if isinstance(body, dict):
                val = body.get(key)
        if val is None:
            val = request.form.get(key)
        return str(val).strip() if val is not None else ""
    except RuntimeError:  # 非請求上下文（模組載入時）
        return ""

def site_codes(cfg=None):
    """admin.json 內的廠區代碼（排除 cross_site 等設定鍵）"""
    cfg = cfg if cfg is not None else load_admin_sites()
    return [k for k in cfg.keys() if k != "cross_site"]

def current_site():
    site = _req_value("site").upper()
    return site if site in site_codes() else DEFAULT_SITE

def find_home_site(user_id, cfg=None):
    """依工號找本廠：先看各廠區管理者名單，再逐廠區找 <廠區>_Backend_data.json；找不到回 None"""
    cfg = cfg if cfg is not None else load_admin_sites()
    for site in site_codes(cfg):
        if user_id in [str(x).strip() for x in cfg.get(site, [])]:
            return site
    for site in site_codes(cfg):
        backend_file = os.path.join(DATA_DIR, site, f"{site}_Backend_data.json")
        if not os.path.exists(backend_file):
            continue
        with open(backend_file, "r", encoding="utf-8-sig") as f:
            for item in json.load(f):
                if str(item.get("工號", "")).strip() == user_id:
                    return site
    return None

def allowed_sites(user_id, cfg=None):
    """該工號可進入的廠區：本廠 + 列名為管理者的廠區 + cross_site 設定的廠區"""
    cfg = cfg if cfg is not None else load_admin_sites()
    codes = site_codes(cfg)
    result = []
    home = find_home_site(user_id, cfg)
    if home:
        result.append(home)
    for site in codes:
        if user_id in [str(x).strip() for x in cfg.get(site, [])] and site not in result:
            result.append(site)
    for site in cfg.get("cross_site", {}).get(user_id, []):
        site = str(site).strip().upper()
        if site in codes and site not in result:
            result.append(site)
    return result

def current_username():
    return _req_value("username")

def site_admin_ids(site=None):
    """admin.json 中該廠區的管理者工號"""
    site = site or current_site()
    return [str(x).strip() for x in load_admin_sites().get(site, [])]

class SitePath(os.PathLike):
    """依 current_site() 動態產生廠區路徑，可直接給 open / pandas / os.path 使用
    - 所有廠區檔案皆放在 static/data/<廠區>/<廠區>_<檔名>
    """
    def __init__(self, directory, filename):
        self._dir = directory
        self._name = filename
    def __str__(self):
        site = current_site()
        name = f"{site}_{self._name}"
        return os.path.join(self._dir, site, name) if self._dir else name
    def __fspath__(self):
        return str(self)
    def __repr__(self):
        return str(self)
    def __add__(self, other):
        return str(self) + other
    def __radd__(self, other):
        return other + str(self)

@app.before_request
def log_site_request():
    if request.method == "OPTIONS":
        return
    site, user = current_site(), current_username()
    logger.info(f"[{site}] [{user or '-'}] {request.method} {request.path}")
    # 跨廠區存取權限檢查：有帶 username 且要求的 site 不在其允許清單 → 403
    if user and request.path not in ("/api/getAllLoginer", "/api/login"):
        allowed = allowed_sites(user)
        if allowed and site not in allowed:
            logger.warning(f"⛔ [{site}] [{user}] 無權存取此廠區，允許：{allowed}")
            return jsonify({"error": f"無權存取 {site} 廠區資料"}), 403
# ─────────────────────────────────────────────────────────────────────────

# 讓 SitePath 進 jsonify 時自動轉成字串（例如回傳 "file": BUYER_FILE）
from flask.json.provider import DefaultJSONProvider
class SiteJSONProvider(DefaultJSONProvider):
    @staticmethod
    def default(o):
        if isinstance(o, SitePath):
            return str(o)
        return DefaultJSONProvider.default(o)
app.json = SiteJSONProvider(app)

# ══════════════════════════════════════════════════════════════════════
# 路徑設定（全部集中於此）
# ══════════════════════════════════════════════════════════════════════
DATA_DIR = "static/data"                 # 各廠區資料根目錄：static/data/<廠區>/<廠區>_<檔名>

# ── 分廠區檔案（SitePath，依請求的 site 動態切換）──
BACKEND_DATA          = SitePath(DATA_DIR, "Backend_data.json")       # 人員資料
CONFIG_FILE           = SitePath(DATA_DIR, "config.cfg")              # 需求者名單
CSV_FILE              = SitePath(DATA_DIR, "Planned_Purchase_Request_List.csv")  # 請購主表
BUYER_FILE            = SitePath(DATA_DIR, "Buyer_detail.csv")        # 請購明細 / eRT 總表
JSON_FILE             = SitePath(DATA_DIR, "money.json")              # 預算
PHONE_FILE            = SitePath(DATA_DIR, "phone.json")              # 分機
VENDER_FILE_PATH      = SitePath(DATA_DIR, "vender.ini")              # 廠商清單
ACC_MAIL_DATA_FILE    = SitePath(DATA_DIR, "accMailData.json")        # 驗收發信備註選項
MAIL_RECIPIENTS_FILE  = SitePath(DATA_DIR, "mailRecipients.json")     # 發送 Mail 固定人員
DELIVERY_RECEIPT_FILE = SitePath(DATA_DIR, "delivery_receipt.csv")    # 廠商交期上傳暫存（用完即刪）

# ── 全廠區共用（資料夾共用，檔名在使用處加廠區前綴）──
UPLOAD_DIR       = "uploads"                                # eHub / 狀態上傳暫存
PROCESSED_DIR    = "processed"                              # MHTML 解析暫存
FILTERS_DIR      = "user_filters"                           # 篩選狀態：<廠區>_<工號>_filters.json
MB_DIR           = "message_board_data"                     # 留言板
MB_CHANNELS_DIR  = os.path.join(MB_DIR, "channels")         #   <廠區>_<channel>.json
MB_VISITS_DIR    = os.path.join(MB_DIR, "visits")           #   <廠區>_<工號>.json
MB_LOG_FILE      = os.path.join(MB_DIR, "message_board.log")
BUYER_FILE_LOCK  = os.path.join(DATA_DIR, "Buyer_detail.csv.lock")   # 全廠區共用一把鎖

MAIL_DOMAIN = "@aseglobal.com"

for _d in [UPLOAD_DIR, PROCESSED_DIR, FILTERS_DIR, MB_DIR, MB_CHANNELS_DIR, MB_VISITS_DIR]:
    os.makedirs(_d, exist_ok=True)

# ── 啟動自檢：每個廠區資料夾必須有的檔案 ──
SITE_REQUIRED_FILES = [
    "Backend_data.json", "config.cfg", "Planned_Purchase_Request_List.csv", "Buyer_detail.csv",
    "money.json", "phone.json", "vender.ini", "accMailData.json", "mailRecipients.json",
]

def check_site_files(log=True):
    """檢查 admin.json 各廠區的資料夾與檔案是否齊全，回傳 {廠區: {"missing": [...], "misnamed": [...]}}"""
    report = {}
    try:
        cfg = load_admin_sites()
    except Exception as e:
        if log:
            logger.error(f"⛔ 讀取 {ADMIN_FILE} 失敗: {e}")
        return {"_error": str(e)}
    codes = site_codes(cfg)
    for site in codes:
        folder = os.path.join(DATA_DIR, site)
        missing, misnamed = [], []
        if not os.path.isdir(folder):
            missing = [f"{site}_{f}" for f in SITE_REQUIRED_FILES]
            report[site] = {"folder_exists": False, "missing": missing, "misnamed": []}
            if log:
                logger.error(f"⛔ [{site}] 資料夾不存在: {folder}")
            continue
        for f in SITE_REQUIRED_FILES:
            if not os.path.exists(os.path.join(folder, f"{site}_{f}")):
                missing.append(f"{site}_{f}")
        # 資料夾裡出現別的廠區前綴或沒前綴的檔案 → 很可能是命名錯誤
        for name in os.listdir(folder):
            if name.endswith(".lock"):
                continue
            prefix = name.split("_", 1)[0]
            if not name.startswith(f"{site}_") and (prefix in codes or name in SITE_REQUIRED_FILES):
                misnamed.append(name)
        report[site] = {"folder_exists": True, "missing": missing, "misnamed": misnamed}
        if log:
            if not missing and not misnamed:
                logger.info(f"✅ [{site}] 資料檔齊全 ({folder})")
            if missing:
                logger.error(f"⛔ [{site}] 缺少檔案: {', '.join(missing)}")
            if misnamed:
                logger.error(f"⚠ [{site}] 檔名前綴錯誤（應為 {site}_）: {', '.join(misnamed)}")
    return report

check_site_files()
# ══════════════════════════════════════════════════════════════════════

def read_json_file():
    try:
        with open(JSON_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}  # 如果文件不存在，返回空字典

def ensure_current_month_budget():
    """
    登入時自動檢查 money.json 是否有當月預算資料，
    若無則自動填入預設值（當月請購預算 25000000、當月追加預算 0），
    若已有該月資料則不做任何更動。
    """
    try:
        from datetime import datetime as _dt  # 避免被模組層級的 from datetime import datetime 覆蓋影響
        current_date = _dt.now()
        current_year = str(current_date.year)
        month_no_pad = str(current_date.month)        # '8'
        month_pad = str(current_date.month).zfill(2)  # '08'

        lock = FileLock(f"{JSON_FILE}.lock", timeout=10)
        with lock:
            budget_data = read_json_file()

            if "預算" not in budget_data:
                budget_data["預算"] = {}

            if current_year not in budget_data["預算"]:
                budget_data["預算"][current_year] = {}

            year_data = budget_data["預算"][current_year]

            # 兩種月份 key 格式都檢查，任一存在就不更動
            if month_no_pad in year_data or month_pad in year_data:
                return

            # 該月無資料 → 自動填入預設值（key 格式與 uploadMoney 一致，不補零）
            year_data[month_no_pad] = {
                "當月請購預算": 25000000,
                "當月追加預算": 0
            }

            with open(JSON_FILE, 'w', encoding='utf-8') as f:
                json.dump(budget_data, f, ensure_ascii=False, indent=4)

            print(f"✅ 已自動建立 {current_year} 年 {month_no_pad} 月預算預設資料")

    except Timeout:
        print("⚠️ ensure_current_month_budget: 取得檔案鎖逾時，略過本次檢查")
    except Exception as e:
        print(f"⚠️ ensure_current_month_budget 錯誤: {e}")

def clean_value(val):
    try:
        if isinstance(val, str) and val.endswith(".0"):
            return str(int(float(val)))
        return str(val) if val is not None else ""
    except Exception:
        return str(val)


def authenticate_user(username, password):
    try:
        server = Server('ldap://KHADDC02.kh.asegroup.com', get_info = ALL)
        # 使用 NTLM
        user = f'kh\\{username}'
        password = f'{password}'
        return True

        # print("帳號: ", username, " 密碼: ", password)
        # # 建立連接
        # conn = Connection(server, user = user, password = password, authentication = NTLM)

        # # 嘗試綁定
        # if conn.bind():
        #     app.logger.info(f"User {username} login successful.")
        
        # else:
        #     # app.logger.warning(f"Login failed for user {username}: {conn.last_error}")
        #     return False
    except Exception as e:
        # app.logger.error(f"Error during authentication for user {username}: {e}")
        return False


@app.route("/api/getAllLoginer", methods=["POST"])
def getAllLoginer():
    try:
        data = request.get_json()
        user_id = str(data.get("username", "")).strip()
        print(user_id)

        sites = allowed_sites(user_id)
        if not sites:
            logger.warning(f"登入失敗，找不到工號: {user_id}")
            return jsonify({"error": "Item not found"}), 404

        logger.info(f"登入對應廠區: {user_id} → 本廠 {sites[0]}，可進入 {sites}")
        # site = 本廠（預設）；sites = 全部可進入的廠區，多於一個時由登入頁讓使用者選擇
        return jsonify({"name": "Username Find", "site": sites[0], "sites": sites, "username": user_id})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    if not data:
        return jsonify({'message': '未提供登入資訊'}), 400
    
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    
    if authenticate_user(username, password):
        ensure_current_month_budget()  # 登入成功時檢查當月預算資料
        return jsonify({'message': '登入成功'})
    return jsonify({'message': '帳號或密碼錯誤'}), 401


@app.route('/api/save-filters-json', methods=['POST'])
def save_filters_json():
    try:
        data = request.json
        username = data.get('username') # type: ignore
        
        if not username:
            return jsonify({'status': 'error', 'message': '缺少使用者名稱'}), 400
        
        # 儲存到 JSON 檔案
        filename = os.path.join(FILTERS_DIR, f'{current_site()}_{username}_filters.json')
        
        # 確保目錄存在
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        
        # 寫入檔案
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return jsonify({'status': 'success', 'message': '篩選狀態已儲存'})
        
    except Exception as e:
        print(f"儲存篩選狀態錯誤: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/get-filters-json/<username>', methods=['GET'])
def get_filters_json(username):
    try:
        filename = os.path.join(FILTERS_DIR, f'{current_site()}_{username}_filters.json')
        
        if os.path.exists(filename):
            with open(filename, 'r', encoding='utf-8') as f:
                filters = json.load(f)
            return jsonify(filters)
        else:
            return jsonify({'message': '找不到篩選設定'}), 404
            
    except Exception as e:
        print(f"載入篩選狀態錯誤: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/clear-filters-json/<username>', methods=['DELETE'])
def clear_filters_json(username):
    try:
        filename = os.path.join(FILTERS_DIR, f'{current_site()}_{username}_filters.json')
        
        if os.path.exists(filename):
            os.remove(filename)
            return jsonify({'status': 'success', 'message': '篩選狀態已清除'})
        else:
            return jsonify({'status': 'success', 'message': '沒有需要清除的篩選狀態'})
            
    except Exception as e:
        print(f"清除篩選狀態錯誤: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


def update_verification_status_and_po_numbers():
    """
    更新驗收狀態和PO No.欄位
    1. 根據Buyer_detail.csv中同ID的驗收狀態來更新Planned_Purchase_Request_List.csv的驗收狀態
    2. 將同ID下的PO No.組合成字串
    3. 檢查Buyer_detail.csv中的ePR No.，如果有值則設開單狀態為'V'
    """
    # backup_files()
    try:
        # 讀取兩個CSV檔案
        main_df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)  # Planned_Purchase_Request_List.csv
        detail_df = pd.read_csv(BUYER_FILE, encoding="utf-8-sig", dtype=str)  # Buyer_detail.csv
        
        # 確保必要欄位存在
        if '驗收狀態' not in main_df.columns:
            main_df['驗收狀態'] = 'X'
        if 'PO No.' not in main_df.columns:
            main_df['PO No.'] = ''
        if '開單狀態' not in detail_df.columns:
            detail_df['開單狀態'] = 'X'
        
        # ===== 步驟1：更新 BUYER_FILE 中的開單狀態 =====
        for idx, detail_row in detail_df.iterrows():
            epr_no = str(detail_row.get('ePR No.', '')).strip()
            if epr_no and epr_no.isdigit() and len(epr_no) == 10:
                detail_df.at[idx, '開單狀態'] = 'V' # type: ignore
            else:
                detail_df.at[idx, '開單狀態'] = 'X' # type: ignore
        
        detail_df.to_csv(BUYER_FILE, index=False, encoding="utf-8-sig")
        
        # ===== 步驟2：更新主表 驗收狀態 和 PO No. =====
        for idx, main_row in main_df.iterrows():
            main_id = str(main_row.get('Id', '')).strip()
            if not main_id:
                continue
                
            detail_records = detail_df[detail_df['Id'].astype(str).str.strip() == main_id]
            
            if detail_records.empty:
                main_df.at[idx, '驗收狀態'] = 'X' # type: ignore
                main_df.at[idx, 'PO No.'] = '' # type: ignore
                continue
            
            # 驗收狀態：只有當所有都是 V 才設 V
            statuses = detail_records['驗收狀態'].fillna('X').astype(str).str.strip()
            main_df.at[idx, '驗收狀態'] = 'V' if all(s == 'V' for s in statuses if s) else 'X' # type: ignore
            
            # PO No. 組合
            po_numbers = detail_records['PO No.'].fillna('').astype(str).str.strip()
            unique_po_numbers = []
            for po in po_numbers:
                if po and po not in unique_po_numbers:
                    unique_po_numbers.append(po)
            main_df.at[idx, 'PO No.'] = '<br />'.join(unique_po_numbers) if unique_po_numbers else '' # type: ignore
        
        main_df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
        return True
    
    except Exception as e:
        print(f"❌ 更新驗收狀態和PO No.時發生錯誤: {str(e)}")
        import traceback; traceback.print_exc()
        return False


# ===============================
@app.route("/data")
def get_data():
    if not os.path.exists(CSV_FILE):
        site = current_site()
        msg = f"找不到 {site} 廠區請購主表：{CSV_FILE}，請確認 static/data/{site}/ 內檔名前綴為 {site}_"
        logger.error(f"⛔ [{site}] {msg}")
        return jsonify({"error": msg, "site_check": check_site_files(log=False).get(site)}), 500
    update_verification_status_and_po_numbers()
    df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)

    expected_columns = [
        "Id", "開單狀態", "WBS", "請購順序", "需求者", "請購項目", "需求原因",
        "總金額", "需求日", "已開單日期", "ePR No.", "進度追蹤超連結", "備註",
        "Status", "簽核中關卡", "報告路徑", "驗收路徑", "合作類別", "合作廠商", 
        "前購單單號", "驗收狀態", "PO No."
    ]
    for col in expected_columns:
        if col not in df.columns:
            df[col] = ""

    if "Id" not in df.columns:
        df.insert(0, "Id", [str(uuid.uuid4()) for _ in range(len(df))])
        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
    else:
        df["Id"] = df["Id"].fillna("").astype(str).str.strip()
        missing_ids = df["Id"] == ""
        df.loc[missing_ids, "Id"] = [str(uuid.uuid4()) for _ in range(missing_ids.sum())]
        if missing_ids.any():
            df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")

    df["ePR No."] = df["ePR No."].apply(lambda x: "" if pd.isna(x) or x == 0 else str(int(float(x))))
    df["總金額"] = pd.to_numeric(df["總金額"], errors="coerce").fillna(0)
    df["總金額"] = df["總金額"].apply(lambda x: "" if x == 0 else int(x))

    numeric_columns = ["請購順序", "需求日", "已開單日期", "前購單單號", "驗收狀態"]
    for col in numeric_columns:
        if col in df.columns:
            df[col] = df[col].apply(
                lambda x: "" if pd.isna(x) or x == 0 else str(int(float(x)))
                if str(x).replace('.','').isdigit() else str(x)
            )
    
    df = df.fillna("")
    return jsonify(df.to_dict(orient="records"))


@app.route('/api/unordered-count')
def get_unordered_count():
    
    if not os.path.exists(CSV_FILE):
        logger.error(f"⛔ [{current_site()}] 找不到請購主表: {CSV_FILE}（請確認 static/data/{current_site()}/ 內檔名前綴為 {current_site()}_）")
    if not os.path.exists(CSV_FILE) or os.path.getsize(CSV_FILE) == 0:
        return jsonify({
            "count_X": 0,
            "count_V": 0,
            "monthly_expenses": {}
        })

    try:
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        df = df.fillna("")

        count_X = df[df["開單狀態"] != "V"].shape[0]
        count_V = df[df["開單狀態"] == "V"].shape[0]

        df_unordered = df[df["開單狀態"] != "V"].copy()

        # ✅ 加這一行，過濾掉非法的需求日
        df_unordered["需求日"] = df_unordered["需求日"].astype(str).str.replace("/", "", regex=False)
        df_unordered = df_unordered[df_unordered["需求日"].str.match(r'^\d{8}$')].copy()

        df_unordered["總金額"] = pd.to_numeric(df_unordered["總金額"], errors="coerce").fillna(0)
        df_unordered["需求日"] = df_unordered["需求日"].astype(str)
        df_unordered["月份"] = df_unordered["需求日"].str.slice(0, 6)

        monthly_sums = df_unordered.groupby("月份")["總金額"].sum().sort_index()
        monthly_expenses = {month: int(round(amount, 2)) for month, amount in monthly_sums.items()}

        # print(monthly_expenses)

        return jsonify({
            "count_X": count_X,
            "count_V": count_V,
            "monthly_expenses": monthly_expenses
        })

    except Exception as e:
        traceback.print_exc()  
        return jsonify({
            "count_X": 0,
            "count_V": 0,
            "monthly_expenses": {},
            "error": str(e)
        }), 500

# 12/1 06/04
# ========================================================================
# 🆕 新增API：月度花費分析（用於新圖表頁面）
# ========================================================================
@app.route('/api/monthly_expense_analysis', methods=['POST'])
def monthly_expense_analysis():
    """月度費用分析API - 支持範圍查詢"""
    try:
        data = request.json
        start_month = data.get('start_month', '2025-02')
        end_month = data.get('end_month', '2025-11')
        
        # 讀取CSV
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        
        # 過濾有日期的記錄
        df_with_date = df[df['已開單日期'].notna()].copy()
        
        if len(df_with_date) == 0:
            return jsonify({'success': False, 'message': 'CSV中沒有有效數據'})
        
        # ✅ 正確轉換日期格式 (20250506 -> 202505)
        df_with_date['已開單日期_str'] = df_with_date['已開單日期'].astype(int).astype(str)
        df_with_date['年月'] = df_with_date['已開單日期_str'].str[:6]
        
        # 轉換查詢月份 (2025-02 -> 202502)
        start_month_num = start_month.replace('-', '')
        end_month_num = end_month.replace('-', '')
        
        # 數字範圍篩選
        df_filtered = df_with_date[
            (df_with_date['年月'] >= start_month_num) & 
            (df_with_date['年月'] <= end_month_num)
        ]
        
        if len(df_filtered) == 0:
            return jsonify({'success': False, 'message': f'{start_month} 到 {end_month} 沒有數據'})
        
        # 分離正常和WBS
        df_normal = df_filtered[df_filtered['WBS'].isna()].copy()
        df_wbs = df_filtered[df_filtered['WBS'].notna()].copy()
        
        # 生成所有月份列表
        all_months = []
        current = start_month_num
        while current <= end_month_num:
            all_months.append(f"{current[:4]}-{current[4:]}")
            year, month = int(current[:4]), int(current[4:])
            month = month + 1 if month < 12 else 1
            year = year + 1 if month == 1 else year
            current = f"{year}{month:02d}"
        
        # 正常花費趨勢
        normal_trend = []
        if len(df_normal) > 0:
            normal_monthly = df_normal.groupby('年月')['總金額'].apply(
                lambda x: int(x.astype(float).sum())
            ).to_dict()
            for month in all_months:
                month_key = month.replace('-', '')
                normal_trend.append({'month': month, 'amount': normal_monthly.get(month_key, 0)})
        else:
            normal_trend = [{'month': m, 'amount': 0} for m in all_months]
        
        # WBS花費趨勢
        wbs_trend = []
        if len(df_wbs) > 0:
            wbs_monthly = df_wbs.groupby('年月')['總金額'].apply(
                lambda x: int(x.astype(float).sum())
            ).to_dict()
            for month in all_months:
                month_key = month.replace('-', '')
                wbs_trend.append({'month': month, 'amount': wbs_monthly.get(month_key, 0)})
        else:
            wbs_trend = [{'month': m, 'amount': 0} for m in all_months]

        # ✅ 新增：讀取 Buyer_detail.csv 計算每月實際入帳 (同 get_monthly_actual_accounting 邏輯)
        buyer_df = pd.read_csv(BUYER_FILE, encoding='utf-8-sig', dtype='str')
        
        buyer_df = buyer_df[
            buyer_df['ePR No.'].notna() & buyer_df['PO No.'].notna() &
            (buyer_df['ePR No.'] != '') & (buyer_df['PO No.'] != '') &
            (buyer_df['WBS'].isna() | (buyer_df['WBS'] == ''))
        ].copy()
        
        buyer_df['發票月份_日期'] = pd.to_datetime(buyer_df['發票月份'], errors='coerce', format='mixed')
        buyer_df = buyer_df[buyer_df['發票月份_日期'].notna()].copy()
        buyer_df['發票年月'] = buyer_df['發票月份_日期'].dt.to_period('M').astype(str)
        buyer_df['RT總金額_數值'] = pd.to_numeric(
            buyer_df['RT總金額'].astype(str).str.replace(',', '').str.replace('$', ''),
            errors='coerce'
        )
        
        # 依 start_month ~ end_month 範圍篩選
        buyer_df = buyer_df[
            (buyer_df['發票年月'] >= start_month) &
            (buyer_df['發票年月'] <= end_month)
        ]
        
        # 按月加總，對齊 all_months 格式
        rt_monthly = buyer_df.groupby('發票年月')['RT總金額_數值'].sum().to_dict()
        rt_trend = [{'month': m, 'amount': int(rt_monthly.get(m, 0))} for m in all_months]

        return jsonify({
                    'success': True,
                    'data': {
                        'normal': {
                            'total': int(df_normal['總金額'].astype(float).sum()) if len(df_normal) > 0 else 0,
                            'average': int(df_normal['總金額'].astype(float).mean()) if len(df_normal) > 0 else 0,
                            'count': len(df_normal),
                            'trend': normal_trend
                        },
                        'wbs': {
                            'total': int(df_wbs['總金額'].astype(float).sum()) if len(df_wbs) > 0 else 0,
                            'average': int(df_wbs['總金額'].astype(float).mean()) if len(df_wbs) > 0 else 0,
                            'count': len(df_wbs),
                            'trend': wbs_trend
                        },
                        'rt': {                          # ✅ 新增
                            'trend': rt_trend
                        }
                    }
                })
        
    except Exception as e:
        print(f"月度費用分析錯誤: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'錯誤: {str(e)}'}), 500


@app.route('/api/getrestofmoney', methods = ['GET'])
def getrestofmoney():
    import datetime, re, math

    ensure_current_month_budget()  # 載入資料時檢查當月預算，無則自動建立

    budget = read_json_file()
    current_date = datetime.datetime.now()
    current_year = str(current_date.year)
    month_no_pad = str(current_date.month)       # '8'
    month_pad = str(current_date.month).zfill(2) # '08'
    yyyymm = current_year + month_pad

    # 嘗試兩種 key
    data = budget.get("預算", {}).get(current_year, {}).get(month_no_pad, {})
    if not data:
        data = budget.get("預算", {}).get(current_year, {}).get(month_pad, {})

    current_budget = float(data.get('當月請購預算', 0))
    additional_budget = float(data.get('當月追加預算', 0))

    try:
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
    except:
        df = pd.DataFrame()

    total_money = 0.0
    if not df.empty:
        for _, row in df.iterrows():
            status = str(row.get('開單狀態', '')).strip()
            raw_date = str(row.get('已開單日期', '')).strip()
            cleaned_date = ''.join([c for c in raw_date if c.isdigit()])[:8]
            wbs = str(row.get('WBS', '')).strip()

            raw_amount = str(row.get('總金額', '')).replace(',', '').strip()
            try:
                amount = float(raw_amount) if raw_amount and raw_amount.lower() != 'nan' else 0.0
            except:
                amount = 0.0
            if math.isnan(amount):
                amount = 0.0

            monthKey = cleaned_date[:6]
            matchMonth = len(cleaned_date) == 8 and monthKey == yyyymm

            if status == 'V' and matchMonth and not re.match(r'^\d{2}FT0A\d{4}$', wbs):
                total_money += amount
                # print(f"[DEBUG] 加總 -> 狀態={status}, 日期={cleaned_date}, 月份={monthKey}, 金額={amount}, WBS={wbs}")

    rest_money = (current_budget + additional_budget) - total_money
    # print(f"[DEBUG] 當月預算={current_budget}, 追加={additional_budget}, 已開單={total_money}, 剩餘={rest_money}")
    return jsonify({
        '當月請購預算': int(current_budget),
        '當月追加預算': int(additional_budget),
        '已開單總額': int(total_money),
        '剩餘金額': int(rest_money)
    })




@app.route('/api/budget_months', methods=['GET'])
def get_budget_months():
    """
    獲取所有可用的預算月份選項和對應的預算金額
    """
    try:
        budget = read_json_file()
        # print(f"📊 讀取預算資料: {budget}")
        
        budget_list = []
        
        # 從預算資料中提取所有年份和月份，並計算預算
        budget_data = budget.get("預算", {})
        
        for year in budget_data.keys():
            year_data = budget_data[year]
            for month in year_data.keys():
                # 格式化為 YYYYMM 格式
                month_padded = str(month).zfill(2)
                year_month = f"{year}{month_padded}"
                
                # 獲取該月份的預算資料
                month_budget_data = year_data[month]
                current_budget = month_budget_data.get('當月請購預算', 0)
                additional_budget = month_budget_data.get('當月追加預算', 0)
                total_budget = current_budget + additional_budget
                
                # 建立月份和預算的對應資料
                budget_info = {
                    'month': year_month,
                    'money': total_budget,
                    '當月請購預算': current_budget,
                    '當月追加預算': additional_budget
                }
                
                budget_list.append(budget_info)
                # print(f"💰 {year_month}: 請購={current_budget:,}, 追加={additional_budget:,}, 總計={total_budget:,}")
        
        # 按月份排序，最新的在前
        budget_list.sort(key=lambda x: x['month'], reverse=True)
        
        # print(f"📅 完整預算清單: {budget_list}")
        
        return jsonify({
            'success': True,
            'budget_list': budget_list,
            'count': len(budget_list)
        })
        
    except Exception as e:
        print(f"❌ 獲取預算月份錯誤: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    

@app.route('/api/uploadMoney', methods=['POST'])
def uploadMoney():
    try:
        data = request.get_json()
        year = data.get('currentYear')
        month = data.get('currentMonth')
        current_budget = data.get('currentBudget')
        additional_budget = data.get('additionalBudget')

        budget_data = read_json_file()  # 讀原始 JSON 資料
        # print("budget_data: ", budget_data)

        # 檢查年度
        if "預算" not in budget_data:
            budget_data["預算"] = {}

        if str(year) not in budget_data["預算"]:
            budget_data["預算"][str(year)] = {}

        # 更新該月份資料
        budget_data["預算"][str(year)][str(month)] = {
            "當月請購預算": current_budget,
            "當月追加預算": additional_budget
        }

        # ✅ 正確寫入更新後的資料
        with open(JSON_FILE, 'w', encoding='utf-8') as f:
            json.dump(budget_data, f, ensure_ascii=False, indent=4)

        return jsonify({'message': '資料提交成功'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/requesters', methods=['GET'])
def get_requesters():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8-sig") as f:
            lines = f.readlines()
            names = [line.strip() for line in lines if line.strip()]  
            # print("requesters: ", names)
            return jsonify(names)
    except Exception as e:
        return jsonify({"error": str(e)}), 500



@app.route('/api/site-check', methods=['GET'])
def api_site_check():
    """各廠區資料檔自檢結果（管理者排錯用）"""
    return jsonify(check_site_files(log=False))


@app.route('/api/admins', methods=['GET'])
def get_admins():
    """管理者名單只從 admin.json[廠區] 讀取"""
    try:
        return jsonify(site_admin_ids())
    except Exception as e:
        return jsonify({"error": str(e)}), 500



@app.route("/api/add", methods = ['POST'])
def add_new_item():
    try:
        # 備份
        # backup_files()
        data = request.get_json()
        main_data = {k: v for k, v in data.items() if k != 'tableRows'}
        table_rows = data.get('tableRows', [])

        print("主資料：", main_data)
        
        if not data:
            return jsonify({'status': 'error', 'message': '無效的 JSON 請求'}), 400

        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)

        # 確保所有欄位一致
        # new_row = {col: data.get(col, "") for col in df.columns}

        new_row = {col: clean_value(main_data.get(col, "")) for col in df.columns}

        if isinstance(new_row["需求日"], str) and "/" in new_row["需求日"]:
            new_row['需求日'] = new_row["需求日"].replace("/", "")

        if isinstance(new_row["已開單日期"], str) and "/" in new_row["已開單日期"]:
            new_row['已開單日期'] = new_row["已開單日期"].replace("/", "")

        def safe_float_to_int64(value):
            try:
                return str(int(float(value)))
            except (ValueError, TypeError, OverflowError):
                return ""

        # ✨ 要轉換的欄位（避免 int32 溢位）
        numeric_fields = ["請購順序", "總金額", "需求日", "已開單日期", "ePR No."]
        for field in numeric_fields:
            if field in new_row:
                new_row[field] = safe_float_to_int64(new_row[field])

        new_row["Id"] = str(uuid.uuid4())  # 自動產生唯一 ID

        df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
        print(new_row)
        # 儲存回 CSV
        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")

        # 寫入另一張表
        print("表格列：", table_rows)
        # 路徑已統一使用檔案開頭的 BUYER_FILE 常數

        detail_columns = [
            "Id", "開單狀態", "交貨驗證", "User", "ePR No.", "PO No.",
            "Item", "品項", "規格", "數量", "總數", "單價", "總價", "備註", "字數",
            "isEditing", "backup", "_alertedItemLimit", "Delivery Date 廠商承諾交期",
            "SOD Qty 廠商承諾數量", "驗收數量", "拒收數量", "發票月份", "WBS", "需求日", "RT金額", "RT總金額","驗收狀態"
        ]

        # 處理後的資料列（每筆 row 補上主資料 ID，欄位順序統一）
        cleaned_rows = []
        for row in table_rows:
            cleaned_row = {"Id": new_row["Id"]}  # 主表 Id
            for col in detail_columns[1:-2]:  # 不含 isEditing, backup，這兩個手動補
                cleaned_row[col] = row.get(col, "")
            cleaned_row["isEditing"] = "False"
            cleaned_row["backup"] = "{}"
            cleaned_rows.append(cleaned_row)
            
        # 如果檔案已存在就 append，否則建立新檔
        if os.path.exists(BUYER_FILE):
            df_detail = pd.read_csv(BUYER_FILE, encoding="utf-8-sig", dtype=str)
            df_detail = pd.concat([df_detail, pd.DataFrame(cleaned_rows)], ignore_index=True)
        else:
            df_detail = pd.DataFrame(cleaned_rows, columns=detail_columns)

        # 寫入 CSV
        df_detail.to_csv(BUYER_FILE, index=False, columns=detail_columns, encoding="utf-8-sig")

        return jsonify({'status': 'success', 'message': '資料新增成功'}), 200

    except Exception as e:
        print("新增錯誤：", e)
        return jsonify({'status': 'error', 'message': str(e)}), 500
    



@app.route('/update', methods=['POST'])
def update_data():
    # 備份
    # backup_files()
    new_data = request.json
    if not isinstance(new_data, dict):
        return jsonify({"message": "請求內容不是有效的 JSON"}), 400
    print(new_data)
    main_data = {k: v for k, v in new_data.items() if k != "tableRows"} # type: ignore
    detail_data = new_data.get("tableRows", []) # type: ignore
    
    if main_data is None:
        return jsonify({"message": "請求內容不是有效的 JSON"}), 400
    
    target_id = str(main_data.get("Id", "")).strip()
    if not target_id:
        return jsonify({"message": "缺少 Id"}), 400
    
    try:
        df = pd.read_csv(CSV_FILE, dtype=str)
        df.fillna("", inplace=True)

        # 找到對應列
        df["Id"] = df["Id"].astype(str).str.strip()
        match_idx = df.index[df["Id"] == target_id].tolist()
        if not match_idx:
            return jsonify({"message": "找不到對應資料"}), 404
        idx = match_idx[0]

        # 處理日期欄位格式
        if isinstance(new_data.get("需求日"), str):
            main_data["需求日"] = main_data["需求日"].replace("/", "")
        if isinstance(new_data.get("已開單日期"), str):
            main_data["已開單日期"] = main_data["已開單日期"].replace("/", "")

        # 更新欄位
        for col in df.columns:
            df.at[idx, col] = str(main_data.get(col, ""))

            # 清洗資料（包含去除 .0 與斜線）
        for col in df.columns:
            val = main_data.get(col, "")
            val = clean_value(val)
            if col in ["需求日", "已開單日期"] and isinstance(val, str):
                val = val.replace("/", "")
            df.at[idx, col] = val

        # 若 ePR No. 存在 → 補連結欄位
        if main_data.get('ePR No.'):
            df.at[idx, "進度追蹤超連結"] = f"https://khwfap.kh.asegroup.com/ePR/PRQuery/QueryPR?id={main_data['ePR No.']}"


        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
       
    
        detail_file = BUYER_FILE
        if os.path.exists(detail_file):
            df_detail = pd.read_csv(detail_file, encoding="utf-8-sig", dtype=str)
            df_detail = df_detail[df_detail["Id"] != target_id]
        else:
            df_detail = pd.DataFrame()

        # 加入新的細項資料
        if detail_data:
            new_rows = pd.DataFrame(detail_data)
            new_rows["Id"] = target_id  # 加入對應主表 Id
            df_detail = pd.concat([df_detail, new_rows], ignore_index=True)

        # 儲存
        df_detail.to_csv(detail_file, index=False, encoding="utf-8-sig")
        
        return jsonify({"message": "更新成功"}), 200

    except Exception as e:
        print("錯誤：", e)
        return jsonify({"message": "資料更新失敗"}), 500



@app.route('/api/get-username-info', methods=['POST'])
def get_username_info():
    try:
        data = request.get_json()
        emp_id = data.get("emp_id", "").strip()  # 工號

        if not emp_id:
            return jsonify({"error": "缺少工號"}), 400

        with open(BACKEND_DATA, "r", encoding="utf-8-sig") as f:
            users = json.load(f)

        for entry in users:
            if entry.get("工號", "").strip() == emp_id:
                return jsonify({
                    "name": entry.get("姓名", "").strip(),
                    "班別": entry.get("班別", "").strip(),
                    "後台權限": "O" if emp_id in site_admin_ids() else "X"   # 權限以 admin.json 為準
                })

        return jsonify({"error": "查無此工號"}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
@app.route('/api/checkeEPRno', methods=['POST'])
def check_epr_no():
    try:
        epr_no = request.get_json()
        if not isinstance(epr_no, str):
            return jsonify({'error': 'Invalid ePR No. format'}), 400

        df = pd.read_csv(CSV_FILE, dtype=str)  # 讀取所有欄位為字串避免轉型問題
        exists = epr_no in df['ePR No.'].dropna().tolist()

        return jsonify({'exists': exists})
    except Exception as e:
        print(f"❌ 錯誤: {e}")
        return jsonify({'error': '檢查失敗'}), 500


@app.route('/api/check-edit-permission', methods=['POST'])
def check_edit_permission():
    try:
        data = request.get_json()
        current_user = data.get("currentUser", "").strip()
        target_id = data.get("id", "").strip()

        if not current_user or not target_id:
            return jsonify({"allowed": False, "error": "缺少必要參數"}), 400
        
        # 管理者權限只看 admin.json[廠區]
        is_admin = current_user in site_admin_ids()

        # 查詢該 ID 對應的需求者
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        df.fillna("", inplace=True)
        df["Id"] = df["Id"].astype(str).str.strip()

        matched_row = df[df["Id"] == target_id]
        if matched_row.empty:
            return jsonify({"allowed": False, "error": "找不到對應資料"}), 404

        row = matched_row.iloc[0]
        requester = row.get("需求者", "").strip()

        with open(BACKEND_DATA, "r", encoding="utf-8-sig") as f:
            backend_data = json.load(f)
        
        requester_id = ""
        for entry in backend_data:
            if entry.get("姓名", "").strip() == requester:
                requester_id = entry.get("工號", "").strip()
                break

        print(f"使用者: {current_user}, 工號: {requester_id}, 是否為 admin: ", is_admin)

        if requester_id == current_user:
            return jsonify({"allowed": True})

        return jsonify({"allowed": is_admin})

    except Exception as e:
        print("權限檢查失敗：", e)
        return jsonify({"allowed": False, "error": str(e)}), 500




@app.route("/api/get_detail/<id>", methods=["GET"])
def get_detail_by_id(id):
    try:
        detail_file = BUYER_FILE
        if not os.path.exists(detail_file):
            return jsonify([])  # 沒有資料回傳空陣列

        df = pd.read_csv(detail_file, encoding="utf-8-sig", dtype=str)
        df.fillna("", inplace=True)

        # 篩選出指定 Id 的細項資料
        detail_rows = df[df["Id"] == id].to_dict(orient="records")
        return jsonify(detail_rows)
    
    except Exception as e:
        print("讀取細項資料錯誤：", e)
        return jsonify({"error": str(e)}), 500



@app.route("/getItemName", methods=["POST"])
def get_item_name():
    try:
        data = request.get_json()
        user_id = data.get("username")
        user_name = data.get("NeedPerson")
        print(user_id, user_name)

        with open(BACKEND_DATA, "r", encoding="utf-8-sig") as f:
            items = json.load(f)

        for item in items:
            if str(item.get("工號", "")).strip() == user_id:
                return jsonify({"name": item.get("姓名", "")})
            
        return jsonify({"error": "Item not found"}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/delete', methods=['POST'])
def delete_entry():
    # 備份
    # backup_files()
    data = request.json
    if data is None:
        return jsonify({"message": "請求內容不是有效的 JSON"}), 400
    
    target_id = str(data.get("Id", "")).strip()
    if not target_id:
        return jsonify({"status": "error", "message": "缺少 Id 欄位"}), 400

    df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
    # 取消 eprno的欄位

    new_df = df[df['Id'] != target_id]

    if len(new_df) == len(df):
        return jsonify({"status": "error", "message": "找不到符合條件的資料"})

    new_df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")

    detail_file = BUYER_FILE 
    if os.path.exists(detail_file):
        df_detail = pd.read_csv(detail_file, encoding="utf-8-sig", dtype=str)
        df_detail = df_detail[df_detail["Id"] != target_id]
        df_detail.to_csv(detail_file, index=False, encoding="utf-8-sig")

    return jsonify({"status": "success", "message": "已成功刪除"})

# 預計請購 更新目前狀態
@app.route("/api/Status-upload", methods=["POST"])
def upload():
    # 備份
    # backup_files()
    if 'file' not in request.files:
        return jsonify({'status': 'fail', 'msg': 'No file uploaded'}), 400

    file = request.files['file']
    filename = file.filename
    if filename != "download.csv":
        return jsonify({'status': 'Fail', 'filename': filename}), 400
    filename = f"status_{uuid.uuid4().hex}.csv"
    filepath = os.path.join('uploads', str(filename))
    file.save(filepath)

    lock = FileLock(f"{CSV_FILE}.lock")

    def clean_nan_value(val):
        if pd.isna(val) or str(val).strip().lower() in ['nan', 'none']:
            return ""
        return str(val).strip()
    
    with lock:
        try:

            df = pd.read_csv(filepath)
            print(df)
            updates = []
            for _, row in df.iterrows():
                epr_no = str(row.get('E-PR號碼           ', '')).strip()
                status = clean_nan_value(row.get('狀態', ''))
                stage = clean_nan_value(row.get('簽核中關卡', ''))

                if epr_no and epr_no != 'nan':
                    updates.append({
                        'epr_no': epr_no,
                        '狀態': status,
                        '簽核中關卡': stage
                    })
                    
            Planned_Purchase_Request_List_df = pd.read_csv(CSV_FILE)
            updated_count = 0
            no_change_count = 0

            # non_null_count = Planned_Purchase_Request_List_df['ePR No.'].notna().sum()


            for update in updates:
                epr = update['epr_no']
                new_status = update['狀態']
                new_stage = update['簽核中關卡']
            
                match = Planned_Purchase_Request_List_df['ePR No.'] == int(epr)
                if match.any():
                    idx = Planned_Purchase_Request_List_df[match].index[0]
                    
                    # 取得目前值
                    old_status = clean_nan_value(Planned_Purchase_Request_List_df.at[idx, 'Status'])
                    old_stage = clean_nan_value(Planned_Purchase_Request_List_df.at[idx, '簽核中關卡'])
                    
                    # 只有在真的有變更時才更新
                    if old_status != new_status or old_stage != new_stage:
                        Planned_Purchase_Request_List_df.at[idx, 'Status'] = new_status
                        Planned_Purchase_Request_List_df.at[idx, '簽核中關卡'] = new_stage
                        updated_count += 1
                    else:
                        no_change_count += 1

                    
            def safe_float_to_int64(val):
                try:
                    if pd.isna(val):
                        return ""
                    return str(int(float(val)))
                except:
                    return str(val).strip()
                
            numeric_fields = ["請購順序", "總金額", "需求日", "已開單日期", "ePR No."]
            for field in numeric_fields:
                if field in Planned_Purchase_Request_List_df.columns:
                    Planned_Purchase_Request_List_df[field] = Planned_Purchase_Request_List_df[field].apply(safe_float_to_int64)

            # 清理所有欄位
            for col in Planned_Purchase_Request_List_df.columns:
                Planned_Purchase_Request_List_df[col] = Planned_Purchase_Request_List_df[col].apply(clean_nan_value)

            Planned_Purchase_Request_List_df.to_csv(CSV_FILE, index=False, encoding='utf-8-sig', na_rep="")
        except Exception as e:
            print("Exception: ", e)


    with lock:
        try:
            df_update = pd.read_csv(filepath, dtype=str)

            # 提取更新資料
            po_updates = []
            for _, row in df_update.iterrows():
                epr_no = str(row.get('E-PR號碼           ', '')).strip()
                sap_po  = str(row.get('SAP PO', '')).strip() 
                if epr_no and sap_po:
                    po_updates.append({
                        'epr_no': epr_no,
                        'po_no': sap_po
                    })
            df_detail = pd.read_csv(BUYER_FILE, dtype=str)

            if "PO No." not in df_detail.columns:
                df_detail["PO No."] = ""


            updated = 0
            nochange = 0

            for upd in po_updates:
                epr = upd['epr_no']
                new_po = upd['po_no']

                # ePR No. 轉成 int → str 避免格式不同
                try:
                    epr_str = str(int(float(epr)))
                except:
                    epr_str = str(epr).strip()

                match_idx = df_detail.index[df_detail['ePR No.'] == epr_str].tolist()

                if match_idx:
                    for idx in match_idx:
                        old_po = str(df_detail.at[idx, 'PO No.']).strip()

                        if old_po != new_po:
                            df_detail.at[idx, 'PO No.'] = new_po
                            updated += 1
                        else:
                            nochange += 1

            # 寫回 Buyer_detail.csv
            df_detail.to_csv(BUYER_FILE, index=False, encoding="utf-8-sig")
            # os.remove(filepath)
            return jsonify({'status': 'success', 'updated_count': updated_count})

        except Exception as e:
            return jsonify({'status': 'Fail', 'reason': e})




# 路徑(報告路徑)
@app.route('/upload_report', methods=['POST'])
def upload_report():
    file = request.files.get('file')
    folder = request.form.get('folder')
    username = request.form.get('work_username')

    if not file:
        return jsonify(success=False, message='無檔案')
    if not folder:
        return jsonify(success=False, message='資料夾名稱為空')
    if not username:
        return jsonify(success=False, message='缺少 username')

    filename = file.filename or ''
    if filename == '':
        return jsonify(success=False, message='檔案名稱為空')

    try:
        save_path = os.path.join(
            r'\\cim300\FT01_CIM\FT01_4000\11.RR班人員-ePR請購管理',
            username,
            folder
        )
        os.makedirs(save_path, exist_ok=True)
        file.save(os.path.join(save_path, filename))
        return jsonify(success=True, message='已上傳')
    except Exception as e:
        print('❌ 儲存錯誤：', e)
        return jsonify(success=False, message=str(e))



# 路徑(報告路徑)
@app.route('/upload_acceptancereport', methods=['POST'])
def upload_acceptancereport():
    file = request.files.get('file')
    folder = request.form.get('folder')
    username = request.form.get('work_username')

    if not file:
        return jsonify(success=False, message='無檔案')
    if not folder:
        return jsonify(success=False, message='資料夾名稱為空')
    if not username:
        return jsonify(success=False, message='缺少 username')

    filename = file.filename or ''
    if filename == '':
        return jsonify(success=False, message='檔案名稱為空')

    try:
        save_path = os.path.join(
            r'\\cim300\FT01_CIM\FT01_4000\11.RR班人員-ePR請購管理',
            username,
            r"=已結單=",
            folder
        )
        os.makedirs(save_path, exist_ok=True)
        file.save(os.path.join(save_path, filename))
        return jsonify(success=True, message='已上傳')
    except Exception as e:
        print('❌ 儲存錯誤：', e)
        return jsonify(success=False, message=str(e))

# 取得英文名字
@app.route('/api/getUsername', methods=['POST'])
def get_username():
    try:
        data = request.get_json()
        username = data.get("username")
        print("收到需求者名字：", username)


        with open(BACKEND_DATA, "r", encoding="utf-8-sig") as f:
            backend_data = json.load(f)

        matched = next((entry for entry in backend_data if entry["姓名"] == username), None)
        
        if matched and "Notes_ID" in matched:
            try:
                name = matched["Notes_ID"].split("_")[0]
            except:
                name = matched["Notes_ID"].split("@")[0]

            return jsonify({"name": name})
        else:
            return jsonify({"name": "查無使用者"}), 404
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/sendmail', methods=['POST']) 
def sendmail():
    try:
        data = request.get_json()
        with open(BACKEND_DATA, "r", encoding="utf-8-sig") as f:
            backend_data = json.load(f)

        mail_data = data.get("data", {})
        recipient_clean = mail_data.get("需求者", "").strip()  
        mail_name = ''
        matched = next(
            (entry for entry in backend_data if entry.get("姓名", "").strip() == recipient_clean),
            None
        )

        if matched and "Notes_ID" in matched:
            mail_name = matched["Notes_ID"]

        raw_cc = data.get("cc", "")  

        cc_names = [name.strip() for name in raw_cc.split(",") if name.strip()]

        cc_list = [name.replace(" ", "_") + "@aseglobal.com" for name in cc_names]

        cc_string = ",".join(cc_list)

        if data["data"]["請購順序"] == "1":
            print("正在導入超急件模組...")
            from MailFunction.urgent import send_mail
            print("開始執行超急件郵件發送...")
            try:
                print(data["data"], '\n', data["recipient"], '\n', mail_name, '\n', cc_string)
                send_mail(data["data"], data["recipient"], mail_name, cc_string, recipients_file=str(MAIL_RECIPIENTS_FILE))
                print("超急件郵件發送完成")
            except Exception as urgent_error:
                print(f"❌ 超急件郵件發送錯誤: {str(urgent_error)}")
              
                print("完整錯誤追蹤:")
                traceback.print_exc()
                raise urgent_error
        else:
            print("正在導入一般郵件模組...")
            from MailFunction.normail import send_mail
            print("開始執行一般郵件發送...")
            try:
                print(data["data"], '\n', data["recipient"], '\n', mail_name, '\n', cc_string)
                send_mail(data["data"], data["recipient"], mail_name, cc_string, recipients_file=str(MAIL_RECIPIENTS_FILE))
                print("一般郵件發送完成")
            except Exception as normal_error:
                print(f"❌ 一般郵件發送錯誤: {str(normal_error)}")
        
                print("完整錯誤追蹤:")
                traceback.print_exc()
                raise normal_error

        print("準備返回成功響應")
        return jsonify({"success": True, "message": "郵件發送成功"}), 200
        
    except Exception as e:
        print(f"❌ 主函數錯誤: {str(e)}")

        print("完整錯誤追蹤:")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    
@app.route('/update_for_mail', methods=['POST'])
def update_for_mail():
    # 備份
    # backup_files()
    new_data = request.json
    print("收到的資料:", new_data)
    
    if new_data is None:
        return jsonify({"message": "沒有收到資料"}), 400
    
    try:
        df = pd.read_csv(CSV_FILE, dtype=str)
        df.fillna("", inplace=True)

        # 找到對應列
        df["Id"] = df["Id"].astype(str).str.strip()
        target_id = str(new_data['Id']).strip()
        
        print(f"尋找 Id: {target_id}")
        
        # 找到符合條件的列
        mask = df["Id"] == target_id
        
        if not mask.any():
            print(f"找不到 Id 為 {target_id} 的資料")
            return jsonify({"message": "找不到對應的資料"}), 404
        
        print(f"找到對應資料，開始更新...")
        
        # 更新資料
        for key, value in new_data.items():
            if key in df.columns:
                df.loc[mask, key] = str(value) if value is not None else ""
                print(f"更新 {key}: {value}")
        
        # 儲存到 CSV
        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
        print("資料已儲存")
        
        return jsonify({"message": "更新成功"}), 200

    except Exception as e:
        print("錯誤：", e)
        
        traceback.print_exc()
        return jsonify({"message": "資料更新失敗"}), 500


# 罐頭訊息   - 。(前購單：，詳如附件)需求工程師：(CT4:)，合作開發：
@app.route('/api/get_phone', methods=['POST'])
def get_phone():
    data = request.get_json()
    name = data.get("name", "")
    with open(PHONE_FILE, 'r', encoding='utf-8-sig') as f:
        phone_data = json.load(f)

    phone_number = phone_data.get(name, "未知")

    return jsonify({"phone": phone_number})


# 廠商
@app.route('/api/venders', methods=['GET'])
def get_venders():
    """讀取 vender.ini 並返回供應商列表"""
    try:
        if os.path.exists(VENDER_FILE_PATH):
            with open(VENDER_FILE_PATH, 'r', encoding='utf-8') as f:
                venders = [line.strip() for line in f.readlines() if line.strip()]
            return jsonify(venders)
        else:
            return jsonify([])
    except Exception as e:
        print(e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/venders', methods=['POST'])
def add_vender():
    """新增供應商到 vender.ini"""
    try:
        data = request.get_json()
        new_vender = data.get('vender', '').strip()

        if not new_vender:
            return jsonify({'error': '供應商名稱不能是空的'}), 400

        # 讀取現有清單，避免重複
        existing = []
        if os.path.exists(VENDER_FILE_PATH):
            with open(VENDER_FILE_PATH, 'r', encoding='utf-8') as f:
                existing = [line.strip() for line in f.readlines() if line.strip()]

        if new_vender in existing:
            return jsonify({'message': '供應商已存在'}), 200

        # 追加寫入
        with open(VENDER_FILE_PATH, 'a', encoding='utf-8') as f:
            f.write(new_vender + '\n')

        return jsonify({'message': '新增成功', 'vender': new_vender}), 201

    except Exception as e:
        print(e)
        return jsonify({'error': str(e)}), 500


# eHub 處理
from difflib import SequenceMatcher
buyer_file_lock = FileLock(BUYER_FILE_LOCK, timeout=10)

def is_po_in_record(row_po_str, target_po):
    """檢查 PO 是否在記錄中（支援 <br /> 分隔的多個 PO）"""
    po_list = re.split(r"<br\s*/?>", str(row_po_str))
    po_list = [po.strip() for po in po_list if po.strip()]
    return target_po.strip() in po_list


def fuzzy_in(text, keyword):
    """模糊比對關鍵字是否在文字中"""
    return keyword.strip() in str(text).strip()

def cleanup_temp_csv_files(po_no=None):
    """清理暫存的 CSV 檔案"""
    try:
        uploads_dir = UPLOAD_DIR
        if not os.path.exists(uploads_dir):
            return
        
        if po_no:
            # 只刪除特定 PO 的檔案
            temp_file = os.path.join(uploads_dir, f"{po_no}.csv")
            if os.path.exists(temp_file):
                os.remove(temp_file)
                logger.info(f"✅ 已刪除: {temp_file}")
        else:
            # 刪除所有暫存 CSV 檔案
            for filename in os.listdir(uploads_dir):
                if filename.endswith('.csv'):
                    file_path = os.path.join(uploads_dir, filename)
                    os.remove(file_path)
                    logger.info(f"✅ 已刪除: {file_path}")
    except Exception as e:
        logger.error(f"清理暫存檔案時發生錯誤: {str(e)}")


@app.route("/api/save_csv", methods=["POST", "OPTIONS"])
def save_csv():
    if request.method == "OPTIONS":
        return jsonify({"status": "ok"}), 200

    data = request.get_json(silent=True) or {}
    content = data.get("content", "")

    from io import StringIO
    df_all = pd.read_csv(StringIO(content), dtype=str).fillna("")

    # 先處理 Item → 一律補成4位數
    if "PO Item 採購單項次" in df_all.columns:
        df_all["PO Item 採購單項次"] = (
            df_all["PO Item 採購單項次"]
            .str.strip()
            .apply(lambda x: str(int(float(x))) if x.replace('.', '', 1).isdigit() else x)
            .apply(lambda x: x.zfill(4) if x.isdigit() else x)
        )

    # 確認有必要欄位
    if "PO NO 採購單號碼" not in df_all.columns:
        return jsonify({"status": "error", "msg": "❌ 缺少 PO NO 採購單號碼 欄位!"}), 400

    # 抓出所有不同的 PO NO
    unique_po_nos = df_all["PO NO 採購單號碼"].dropna().unique()

    # ✅ 第一步:分群儲存 uploads/{po_no}.csv
    saved_files = []
    for po_no in unique_po_nos:
        po_no_clean = str(po_no).strip()
        group_df = df_all[df_all["PO NO 採購單號碼"] == po_no_clean]

        upload_path = os.path.join(UPLOAD_DIR, f"{po_no_clean}.csv")
        group_df.to_csv(upload_path, index=False, encoding="utf-8-sig")

        saved_files.append({
            "po_no": po_no_clean,
            "rows": len(group_df),
            "file": upload_path
        })
        logger.info(f"✅ 已儲存 {upload_path} ({len(group_df)} 筆資料)")

    try:
        with buyer_file_lock:
            # ✅ 第二步:載入 Buyer_detail.csv (比對用)
            df_buyer = pd.read_csv(BUYER_FILE, encoding="utf-8-sig", dtype=str, on_bad_lines="skip").fillna("")
            df_buyer["PO No."] = df_buyer["PO No."].str.strip()
            df_buyer["Item"] = (
                df_buyer["Item"]
                .str.replace(r"\.0$", "", regex=True)
                .str.strip()
                .apply(lambda x: x.zfill(4) if x.isdigit() else x)
            )

            # 🔴 建立一個只包含狀態為 V 的資料索引
            df_active = df_buyer[df_buyer["開單狀態"] == "V"].copy()
            logger.info(f"總資料筆數: {len(df_buyer)}, 有效資料(狀態=V): {len(df_active)}")

    except Timeout:
        logger.error("❌ 無法取得檔案鎖,請稍後再試")
        return jsonify({"status": "error", "msg": "系統忙碌中,請稍後再試"}), 503
    except Exception as e:
        logger.error(f"❌ 讀取 Buyer_detail.csv 時發生錯誤: {str(e)}")
        return jsonify({"status": "error", "msg": f"讀取檔案失敗: {str(e)}"}), 500

    # 🆕 初始化
    all_group_results = []
    quantity_mismatch_items = []
    merged_items = []  # 🆕 記錄合併的項目
    
    # ✅✅✅ 新增：記錄哪些 PO 有問題（分批或合併）
    mismatch_po_set = set()  # 有分批問題的 PO
    merge_po_set = set()      # 有合併問題的 PO

    def clean_name(x: str) -> str:
        return str(x).replace("\n", "").replace("\r", "").replace("<br>", "").strip()

    df_buyer["品項_clean"] = df_buyer["品項"].apply(clean_name)
    buyer_id_lookup = {
        (row["PO No."], row["Item"]): row.get("Id", "")
        for _, row in df_buyer.iterrows()
    }

    # 🔴 第一輪:檢測所有 PO 是否有分批或合併問題
    logger.info("\n" + "="*80)
    logger.info("第一輪掃描：檢測分批和合併問題")
    logger.info("="*80)
    
    for file_info in saved_files:
        po_no = file_info["po_no"]
        csv_path = file_info["file"]
        
        df_po = pd.read_csv(csv_path, encoding="utf-8-sig", dtype=str).fillna("")
        df_po["PO Item 採購單項次"] = df_po["PO Item 採購單項次"].str.zfill(4)
        
        buyer_related = df_active[df_active["PO No."].str.contains(po_no, regex=False, na=False)].copy()
        
        xls_item_groups = df_po.groupby("PO Item 採購單項次")
        
        for item, xls_group in xls_item_groups:
            xls_count = len(xls_group)
            csv_items = buyer_related[buyer_related["Item"] == item]
            csv_count = len(csv_items)
            
            # ✅ 新增:如果 XLS 筆數 < CSV 筆數,代表「分批變回合併」
            if csv_count > 0 and xls_count < csv_count:
                logger.info(f"🔄 偵測到合併:PO={po_no}, Item={item}, XLS={xls_count}筆 < CSV={csv_count}筆")
                merge_po_set.add(po_no)  # ✅ 標記此 PO 有合併問題
                
                xls_rows = []
                for _, row in xls_group.iterrows():
                    xls_rows.append({
                        "description": str(row.get("Description 品名", "")),
                        "delivery": str(row.get("Delivery Date 廠商承諾交期", "")),
                        "sod_qty": str(row.get("SOD Qty 廠商承諾數量", "0"))
                    })
                
                csv_rows = []
                batch_mask = (
                    (df_buyer["PO No."].str.strip() == po_no) &
                    (df_buyer["Item"].str.strip() == item) &
                    (df_buyer["備註"].str.contains("分批", na=False)) &
                    (df_buyer["開單狀態"] == "V")
                )
                csv_items = df_buyer[batch_mask]
                
                for _, row in csv_items.iterrows():
                    csv_rows.append({
                        "id": str(row.get("Id", "")),
                        "description": str(row.get("品項", "")),
                        "delivery": str(row.get("Delivery Date 廠商承諾交期", "")),
                        "sod_qty": str(row.get("SOD Qty 廠商承諾數量", "0")),
                        "note": str(row.get("備註", ""))
                    })
                
                # 🆕 記錄需要合併的項目
                merged_items.append({
                    "po_no": po_no,
                    "item": item,
                    "xls_count": int(xls_count),
                    "csv_count": int(csv_count),
                    "xls_data": xls_rows,
                    "csv_data": csv_rows,
                    "action_type": "merge"
                })
                
                logger.info(f"   📝 已記錄需要合併的項目")

            # 🚨 筆數不符（分批）
            elif csv_count > 0 and xls_count > csv_count:
                mismatch_po_set.add(po_no)  # ✅ 標記此 PO 有分批問題
                
                try:
                    total_sod = csv_items["SOD Qty 廠商承諾數量"].astype(float).sum()
                except:
                    total_sod = 0.0
                
                xls_rows = []
                for _, row in xls_group.iterrows():
                    xls_rows.append({
                        "description": str(row.get("Description 品名", "")),
                        "delivery": str(row.get("Delivery Date 廠商承諾交期", "")),
                        "sod_qty": str(row.get("SOD Qty 廠商承諾數量", "0"))
                    })
                
                csv_rows = []
                for _, row in csv_items.iterrows():
                    csv_rows.append({
                        "id": str(row.get("Id", "")),
                        "description": str(row.get("品項", "")),
                        "delivery": str(row.get("Delivery Date 廠商承諾交期", "")),
                        "sod_qty": str(row.get("SOD Qty 廠商承諾數量", "0")),
                        "total_qty": str(row.get("總數", "0"))
                    })
                
                quantity_mismatch_items.append({
                    "po_no": po_no,
                    "item": item,
                    "xls_count": int(xls_count),
                    "csv_count": int(csv_count),
                    "total_sod": float(total_sod),
                    "xls_data": xls_rows,
                    "csv_data": csv_rows
                })
                
                logger.info(f"⚠️ 筆數不符: PO={po_no}, Item={item}, XLS={xls_count}筆, CSV={csv_count}筆")

    logger.info(f"\n📊 第一輪掃描結果:")
    logger.info(f"   分批問題 PO: {len(mismatch_po_set)} 個 - {list(mismatch_po_set)}")
    logger.info(f"   合併問題 PO: {len(merge_po_set)} 個 - {list(merge_po_set)}")
    logger.info("="*80 + "\n")

    # 🔴 第二輪:處理沒有問題的 PO (正常比對)
    logger.info("\n" + "="*80)
    logger.info("第二輪處理：正常比對（排除有問題的 PO）")
    logger.info("="*80)
    
    for file_info in saved_files:
        po_no = file_info["po_no"]
        
        # ✅✅✅ 關鍵修改：如果這個 PO 有分批或合併問題，跳過正常比對
        if po_no in mismatch_po_set:
            logger.info(f"⭕️ 跳過 PO {po_no} 的正常比對 (有分批問題)")
            continue
        
        if po_no in merge_po_set:
            logger.info(f"⭕️ 跳過 PO {po_no} 的正常比對 (有合併問題)")
            continue
        
        csv_path = file_info["file"]
        df_po = pd.read_csv(csv_path, encoding="utf-8-sig", dtype=str).fillna("")
        df_po["PO Item 採購單項次"] = df_po["PO Item 採購單項次"].str.zfill(4)

        buyer_related = df_buyer[df_buyer["PO No."].str.contains(po_no, regex=False, na=False)].copy()

        matched_list = []
        conflict_list = []

        for row_idx, row in df_po.iterrows():
            item = row["PO Item 採購單項次"]
            desc = clean_name(row.get("Description 品名", ""))
            delivery = row["Delivery Date 廠商承諾交期"]
            qty = row["SOD Qty 廠商承諾數量"]

            logger.info(f"處理 PO {po_no} 的 Item {item}")

            item_match = buyer_related[buyer_related["Item"] == item]
            
            if not item_match.empty:
                buyer_row = item_match.iloc[0]
                buyer_item = buyer_row["Item"]
                buyer_desc = clean_name(buyer_row["品項"])
                buyer_id = buyer_row.get("Id", "")

                logger.info(f"  找到 Buyer Item {buyer_item}, 品名: {buyer_desc}")

                df_buyer.loc[item_match.index, "Delivery Date 廠商承諾交期"] = delivery
                df_buyer.loc[item_match.index, "SOD Qty 廠商承諾數量"] = qty

                if buyer_desc == desc:
                    buyer_id = buyer_id_lookup.get((po_no, buyer_item), "")
                    matched_list.append({
                        "id": buyer_id,
                        "po_no": po_no,
                        "item": item,
                        "buyer_description": buyer_desc,
                        "po_description": desc or buyer_desc,
                        "delivery_date": delivery,
                        "sod_qty": qty,
                        "status": "✅ 相同",
                        "diff_type": "none"
                    })
                    logger.info(f"  ✅ 完全相同")
                else:
                    buyer_id = buyer_id_lookup.get((po_no, buyer_item), "")
                    conflict_list.append({
                        "id": buyer_id,
                        "po_no": po_no,
                        "item": item,
                        "buyer_description": buyer_desc,
                        "po_description": desc,
                        "delivery_date": delivery,
                        "sod_qty": qty,
                        "status": "⚠️ 品名不相同",
                        "diff_type": "desc"
                    })
                    logger.info(f"  ⚠️ 品名不同")
            else:
                logger.info(f"  ❌ Buyer 中找不到 Item {item}")
                buyer_id = ''
                conflict_list.append({
                    "id": buyer_id,
                    "po_no": po_no,
                    "item": item,
                    "buyer_description": None,
                    "po_description": desc,
                    "delivery_date": delivery,
                    "sod_qty": qty,
                    "status": "⚠️ Buyer_detail 沒有這筆資料",
                    "diff_type": "missing"
                })

        all_group_results.append({
            "po_no": po_no,
            "matched": matched_list,
            "conflict": conflict_list
        })
        
        logger.info(f"📊 PO {po_no} 統計: 相同={len(matched_list)}, 衝突={len(conflict_list)}")

    logger.info("="*80 + "\n")

    # 🎯 根據情況返回不同的結果
    
    # ✅ 優先返回合併確認
    if merged_items:
        logger.info(f"🔄 發現 {len(merged_items)} 個項目需要合併")
        
        # 轉換資料
        merged_items_clean = []
        for item in merged_items:
            merged_items_clean.append({
                "po_no": str(item["po_no"]),
                "item": str(item["item"]),
                "xls_count": int(item["xls_count"]),
                "csv_count": int(item["csv_count"]),
                "xls_data": item["xls_data"],
                "csv_data": item["csv_data"],
                "action_type": "merge"
            })
        
        return jsonify({
            "status": "merge_confirmation_needed",
            "message": f"發現 {len(merged_items)} 個項目從分批變回單筆,需要確認",
            "merge_items": merged_items_clean,
            "total_merge_items": len(merged_items),
            "groups": all_group_results,  # ✅ 只包含沒問題的 PO
            "has_normal_items": len(all_group_results) > 0
        })
    
    # ✅ 其次返回分批調整
    if quantity_mismatch_items:
        logger.info(f"🚨 發現 {len(quantity_mismatch_items)} 個項目筆數不符")
        logger.info(f"✅ 同時處理了 {len(all_group_results)} 個正常 PO")
        
        return jsonify({
            "status": "quantity_mismatch",
            "message": f"發現 {len(quantity_mismatch_items)} 個項目的筆數不符,需要手動調整",
            "mismatches": quantity_mismatch_items,
            "total_mismatches": len(quantity_mismatch_items),
            "require_manual_adjustment": True,
            "groups": all_group_results,  # ✅ 只包含沒問題的 PO
            "has_normal_items": len(all_group_results) > 0
        })

    # 沒有分批或合併問題,正常返回
    logger.info(f"\n✅ 總共處理 {len(all_group_results)} 個 PO")
    
    return jsonify({
        "status": "ok",
        "groups": all_group_results,
        "saved_files": saved_files,
        "has_mismatch": False
    })

# 走分批
@app.route("/api/confirm_quantity_update", methods=["POST"])
def confirm_quantity_update():
    """處理筆數不符時使用者確認的更新(保留所有原始欄位)"""
    
    logger.info("=" * 80)
    logger.info("🚀 confirm_quantity_update 函數被調用")
    logger.info("=" * 80)
    
    try:
        data = request.get_json()
        logger.info(f"📥 收到的完整資料: {json.dumps(data, ensure_ascii=False, indent=2)}")
        
        po_no = data.get("po_no")
        item = data.get("item")
        new_rows = data.get("rows")
        expected_total = data.get("expected_total")
        
        logger.info(f"📦 解析後的參數:")
        logger.info(f"   PO No: {po_no}")
        logger.info(f"   Item: {item}")
        logger.info(f"   新筆數: {len(new_rows) if new_rows else 0}")
        logger.info(f"   預期總和: {expected_total}")
        
        if not po_no or not item or not new_rows:
            error_msg = f"缺少必要參數: po_no={po_no}, item={item}, new_rows={len(new_rows) if new_rows else 'None'}"
            logger.error(f"❌ {error_msg}")
            return jsonify({
                "status": "error",
                "message": error_msg
            }), 400
        
        def smart_number_format(value):
            """智能格式化數字"""
            try:
                num = float(value)
                if num.is_integer():
                    return str(int(num))
                else:
                    return str(num)
            except (ValueError, TypeError):
                return str(value)
        
        try:
            with buyer_file_lock:
                # 📊 載入 Buyer_detail.csv
                logger.info(f"📂 開始載入 {BUYER_FILE}")
                
                if not os.path.exists(BUYER_FILE):
                    logger.error(f"❌ 檔案不存在: {BUYER_FILE}")
                    return jsonify({
                        "status": "error",
                        "message": f"找不到檔案: {BUYER_FILE}"
                    }), 500
                
                df_buyer = pd.read_csv(BUYER_FILE, encoding="utf-8-sig", dtype=str).fillna("")
                logger.info(f"✅ 成功載入 Buyer_detail.csv,共 {len(df_buyer)} 筆資料")
                
                # ⚠️ 計算實際 SOD 總和
                try:
                    actual_total = sum(float(row.get("sod_qty", 0)) for row in new_rows)
                    sod_diff = actual_total - expected_total
                    
                    logger.info(f"🔢 SOD 總和計算:")
                    logger.info(f"   預期: {expected_total}")
                    logger.info(f"   實際: {actual_total}")
                    logger.info(f"   差異: {sod_diff}")
                    
                    if abs(sod_diff) > 0.01:
                        logger.warning(f"⚠️ SOD 總和不符!預期={expected_total}, 實際={actual_total}, 差異={sod_diff}")
                        logger.warning(f"   使用者選擇強制儲存,將繼續處理...")
                    else:
                        logger.info(f"✅ SOD 總和正確:{actual_total}")
                except Exception as e:
                    logger.error(f"❌ 計算 SOD 總和時發生錯誤: {str(e)}")
                    logger.error(traceback.format_exc())
                
                # 🗑️ 刪除舊的資料
                logger.info(f"🔍 開始尋找要刪除的資料 (PO={po_no}, Item={item}, 狀態=V)")
                
                old_mask = (
                    (df_buyer["PO No."].str.strip() == po_no) &
                    (df_buyer["Item"].str.strip() == item) &
                    (df_buyer["開單狀態"] == "V")
                )
                
                deleted_count = old_mask.sum()
                logger.info(f"📊 找到 {deleted_count} 筆符合條件的資料")
                
                if deleted_count == 0:
                    logger.error(f"❌ 找不到要刪除的舊資料")
                    logger.error(f"   查詢條件: PO No.={po_no}, Item={item}, 開單狀態=V")
                    
                    po_exists = df_buyer[df_buyer["PO No."].str.strip() == po_no]
                    logger.error(f"   該 PO 共有 {len(po_exists)} 筆資料")
                    
                    if len(po_exists) > 0:
                        items = po_exists["Item"].str.strip().unique()
                        logger.error(f"   該 PO 的 Items: {list(items)}")
                        statuses = po_exists["開單狀態"].unique()
                        logger.error(f"   該 PO 的狀態: {list(statuses)}")
                    else:
                        logger.error(f"   ❌ 該 PO 完全不存在於資料庫中")
                    
                    return jsonify({
                        "status": "error",
                        "message": f"找不到要刪除的舊資料 (PO {po_no} - Item {item}, 狀態=V)"
                    }), 404
                
                # 🎯 取得第一筆舊資料作為範本
                logger.info(f"📋 取得第一筆舊資料作為範本")
                first_old_row = df_buyer[old_mask].iloc[0]
                
                # 📝 記錄被刪除的資料
                deleted_data = []
                for idx, row in df_buyer[old_mask].iterrows():
                    deleted_data.append({
                        "品項": row.get("品項", ""),
                        "規格": row.get("規格", ""),
                        "單價": row.get("單價", ""),
                        "總價": row.get("總價", ""),
                        "交期": row.get("Delivery Date 廠商承諾交期", ""),
                        "SOD": row.get("SOD Qty 廠商承諾數量", "")
                    })
                
                logger.info(f"🗑️ 將刪除的資料:")
                for i, d in enumerate(deleted_data, 1):
                    logger.info(f"   第 {i} 筆: {d}")
                
                # 刪除舊資料
                logger.info(f"🗑️ 執行刪除操作...")
                df_buyer = df_buyer[~old_mask]
                logger.info(f"✅ 刪除完成,剩餘 {len(df_buyer)} 筆資料")
                
                # 💰 計算單價
                try:
                    unit_price_str = str(first_old_row.get("單價", "0")).replace(",", "").strip()
                    unit_price = float(unit_price_str) if unit_price_str else 0.0
                    logger.info(f"💰 原始單價: {unit_price}")
                except Exception as e:
                    logger.error(f"❌ 解析單價時發生錯誤: {str(e)}")
                    unit_price = 0.0
                
                # ➕ 準備新資料
                logger.info(f"➕ 開始準備新資料...")
                new_data_rows = []
                
                for idx, row_data in enumerate(new_rows):
                    logger.info(f"   處理第 {idx+1}/{len(new_rows)} 筆新資料...")
                    
                    try:
                        sod_qty = float(row_data.get("sod_qty", 0))
                    except:
                        sod_qty = 0.0
                    
                    sod_qty_formatted = smart_number_format(sod_qty)
                    total_price = unit_price * sod_qty
                    total_price_formatted = smart_number_format(total_price)
                    unit_price_formatted = smart_number_format(unit_price)
                    
                    new_row = {
                        "Id": first_old_row.get("Id", ""),
                        "開單狀態": "V",
                        "交貨驗證": first_old_row.get("交貨驗證", ""),
                        "User": first_old_row.get("User", ""),
                        "ePR No.": first_old_row.get("ePR No.", ""),
                        "PO No.": po_no,
                        "Item": item,
                        "品項": row_data.get("description", first_old_row.get("品項", "")),
                        "規格": first_old_row.get("規格", ""),
                        "數量": sod_qty_formatted,
                        "總數": sod_qty_formatted,
                        "單價": unit_price_formatted,
                        "總價": total_price_formatted,
                        "備註": f"分批{idx+1}/{len(new_rows)}" if len(new_rows) > 1 else first_old_row.get("備註", ""),
                        "字數": first_old_row.get("字數", ""),
                        "isEditing": "False",
                        "backup": "{}",
                        "_alertedItemLimit": "",
                        "Delivery Date 廠商承諾交期": row_data.get("delivery", ""),
                        "SOD Qty 廠商承諾數量": sod_qty_formatted,
                        "驗收數量": "",
                        "拒收數量": "",
                        "發票月份": "",
                        "WBS": first_old_row.get("WBS", ""),
                        "需求日": first_old_row.get("需求日", ""),
                        "RT金額": "",
                        "RT總金額": "",
                        "驗收狀態": "X"
                    }
                    new_data_rows.append(new_row)
                    logger.info(f"      品項: {new_row['品項']}, SOD: {new_row['SOD Qty 廠商承諾數量']}, 總價: {new_row['總價']}")
                
                logger.info(f"✅ 準備完成 {len(new_data_rows)} 筆新資料")
                
                # 🔴🔴🔴 直接加到最後面 🔴🔴🔴
                logger.info(f"📥 將新資料添加到最後...")
                df_buyer = pd.concat([
                    df_buyer,
                    pd.DataFrame(new_data_rows)
                ], ignore_index=True)
                logger.info(f"✅ 添加完成,現有 {len(df_buyer)} 筆資料")
                
                # 💾 儲存回檔案
                logger.info(f"💾 開始儲存到 {BUYER_FILE}...")
                df_buyer.to_csv(BUYER_FILE, index=False, encoding="utf-8-sig")
                logger.info(f"✅ 儲存完成")
        
        except Timeout:
            logger.error("❌ 無法取得檔案鎖,請稍後再試")
            return jsonify({
                "status": "error",
                "message": "系統忙碌中,請稍後再試"
            }), 503

        # 📝 準備回傳訊息
        success_msg = f"成功更新 PO {po_no} Item {item}: 刪除 {deleted_count} 筆,新增 {len(new_data_rows)} 筆 (已加到最後)"
        
        if abs(sod_diff) > 0.01:
            success_msg += f" (⚠️ SOD差異: {sod_diff:+.2f})"
        
        logger.info("=" * 80)
        logger.info(f"✅ {success_msg}")
        logger.info("=" * 80)

        # 🗑️ 刪除暫存的 CSV 檔案
        cleanup_temp_csv_files(po_no)
        
        return jsonify({
            "status": "success",
            "message": success_msg,
            "deleted_count": int(deleted_count),
            "inserted_count": len(new_data_rows),
            "sod_info": {
                "expected": float(expected_total),
                "actual": float(actual_total),
                "difference": float(sod_diff),
                "is_match": abs(sod_diff) < 0.01
            },
            "preserved_fields": {
                "unit_price": float(unit_price),
                "specification": first_old_row.get("規格", ""),
                "wbs": first_old_row.get("WBS", ""),
                "epr_no": first_old_row.get("ePR No.", "")
            }
        })
        
    except Exception as e:
        logger.error("=" * 80)
        logger.error(f"❌ confirm_quantity_update 發生嚴重錯誤")
        logger.error(f"❌ 錯誤訊息: {str(e)}")
        logger.error(f"❌ 錯誤類型: {type(e).__name__}")
        logger.error("❌ 完整堆疊追蹤:")
        logger.error(traceback.format_exc())
        logger.error("=" * 80)
        
        return jsonify({
            "status": "error",
            "message": f"更新失敗: {str(e)}"
        }), 500

# 走合併
@app.route("/api/confirm_merge", methods=["POST"])
def confirm_merge():
    """處理分批變回合併的確認更新"""
    
    logger.info("=" * 80)
    logger.info("🔄 confirm_merge 函數被調用")
    logger.info("=" * 80)
    
    try:
        data = request.get_json()
        logger.info(f"📥 收到的完整資料: {json.dumps(data, ensure_ascii=False, indent=2)}")
        
        po_no = data.get("po_no")
        item = data.get("item")
        xls_data = data.get("xls_data")  # 新的 XLS 資料 (通常只有 1 筆)
        
        logger.info(f"📦 解析後的參數:")
        logger.info(f"   PO No: {po_no}")
        logger.info(f"   Item: {item}")
        logger.info(f"   新筆數: {len(xls_data) if xls_data else 0}")
        
        if not po_no or not item or not xls_data:
            error_msg = f"缺少必要參數: po_no={po_no}, item={item}, xls_data={len(xls_data) if xls_data else 'None'}"
            logger.error(f"❌ {error_msg}")
            return jsonify({
                "status": "error",
                "message": error_msg
            }), 400
        
        def smart_number_format(value):
            """智能格式化數字"""
            try:
                num = float(value)
                if num.is_integer():
                    return str(int(num))
                else:
                    return str(num)
            except (ValueError, TypeError):
                return str(value)
        
        try:
            with buyer_file_lock:
                # 📊 載入 Buyer_detail.csv
                logger.info(f"📂 開始載入 {BUYER_FILE}")
                
                if not os.path.exists(BUYER_FILE):
                    logger.error(f"❌ 檔案不存在: {BUYER_FILE}")
                    return jsonify({
                        "status": "error",
                        "message": f"找不到檔案: {BUYER_FILE}"
                    }), 500
                
                df_buyer = pd.read_csv(BUYER_FILE, encoding="utf-8-sig", dtype=str).fillna("")
                logger.info(f"✅ 成功載入 Buyer_detail.csv,共 {len(df_buyer)} 筆資料")
                
                # 🗑️ 刪除舊的分批資料
                logger.info(f"🔍 開始尋找要刪除的資料 (PO={po_no}, Item={item}, 備註包含'分批', 狀態=V)")
                
                old_mask = (
                    (df_buyer["PO No."].str.strip() == po_no) &
                    (df_buyer["Item"].str.strip() == item) &
                    (df_buyer["備註"].str.contains("分批", na=False)) &
                    (df_buyer["開單狀態"] == "V")
                )
                
                deleted_count = old_mask.sum()
                logger.info(f"📊 找到 {deleted_count} 筆符合條件的資料")
                
                if deleted_count == 0:
                    logger.error(f"❌ 找不到要刪除的舊資料")
                    return jsonify({
                        "status": "error",
                        "message": f"找不到要刪除的舊資料 (PO {po_no} - Item {item})"
                    }), 404
                
                # 🎯 取得第一筆舊資料作為範本
                logger.info(f"📋 取得第一筆舊資料作為範本")
                first_old_row = df_buyer[old_mask].iloc[0]
                
                # 📝 記錄被刪除的資料
                deleted_data = []
                for idx, row in df_buyer[old_mask].iterrows():
                    deleted_data.append({
                        "品項": row.get("品項", ""),
                        "交期": row.get("Delivery Date 廠商承諾交期", ""),
                        "SOD": row.get("SOD Qty 廠商承諾數量", ""),
                        "備註": row.get("備註", "")
                    })
                
                logger.info(f"🗑️ 將刪除的資料:")
                for i, d in enumerate(deleted_data, 1):
                    logger.info(f"   第 {i} 筆: {d}")
                
                # 刪除舊資料
                logger.info(f"🗑️ 執行刪除操作...")
                df_buyer = df_buyer[~old_mask]
                logger.info(f"✅ 刪除完成,剩餘 {len(df_buyer)} 筆資料")
                
                # 💰 計算單價
                try:
                    unit_price_str = str(first_old_row.get("單價", "0")).replace(",", "").strip()
                    unit_price = float(unit_price_str) if unit_price_str else 0.0
                    logger.info(f"💰 原始單價: {unit_price}")
                except Exception as e:
                    logger.error(f"❌ 解析單價時發生錯誤: {str(e)}")
                    unit_price = 0.0
                
                # ➕ 準備新資料 (合併後的資料)
                logger.info(f"➕ 開始準備新資料...")
                new_data_rows = []
                
                for idx, row_data in enumerate(xls_data):
                    logger.info(f"   處理第 {idx+1}/{len(xls_data)} 筆新資料...")
                    
                    try:
                        sod_qty = float(row_data.get("sod_qty", 0))
                    except:
                        sod_qty = 0.0
                    
                    sod_qty_formatted = smart_number_format(sod_qty)
                    total_price = unit_price * sod_qty
                    total_price_formatted = smart_number_format(total_price)
                    unit_price_formatted = smart_number_format(unit_price)
                    
                    # 清理備註 (移除「分批」字樣)
                    old_note = first_old_row.get("備註", "")
                    new_note = old_note.replace("分批1/2", "").replace("分批2/2", "").strip()
                    
                    new_row = {
                        "Id": first_old_row.get("Id", ""),
                        "開單狀態": "V",
                        "交貨驗證": first_old_row.get("交貨驗證", ""),
                        "User": first_old_row.get("User", ""),
                        "ePR No.": first_old_row.get("ePR No.", ""),
                        "PO No.": po_no,
                        "Item": item,
                        "品項": row_data.get("description", first_old_row.get("品項", "")),
                        "規格": first_old_row.get("規格", ""),
                        "數量": sod_qty_formatted,
                        "總數": sod_qty_formatted,
                        "單價": unit_price_formatted,
                        "總價": total_price_formatted,
                        "備註": new_note,  # 已移除「分批」字樣
                        "字數": first_old_row.get("字數", ""),
                        "isEditing": "False",
                        "backup": "{}",
                        "_alertedItemLimit": "",
                        "Delivery Date 廠商承諾交期": row_data.get("delivery", ""),
                        "SOD Qty 廠商承諾數量": sod_qty_formatted,
                        "驗收數量": "",
                        "拒收數量": "",
                        "發票月份": "",
                        "WBS": first_old_row.get("WBS", ""),
                        "需求日": first_old_row.get("需求日", ""),
                        "RT金額": "",
                        "RT總金額": "",
                        "驗收狀態": "X"
                    }
                    new_data_rows.append(new_row)
                    logger.info(f"      品項: {new_row['品項']}, SOD: {new_row['SOD Qty 廠商承諾數量']}, 總價: {new_row['總價']}")
                
                logger.info(f"✅ 準備完成 {len(new_data_rows)} 筆新資料")
                
                # 🔴🔴🔴 直接加到最後面 🔴🔴🔴
                logger.info(f"🔥 將新資料添加到最後...")
                df_buyer = pd.concat([
                    df_buyer,
                    pd.DataFrame(new_data_rows)
                ], ignore_index=True)
                logger.info(f"✅ 添加完成,現有 {len(df_buyer)} 筆資料")
                
                # 💾 儲存回檔案
                logger.info(f"💾 開始儲存到 {BUYER_FILE}...")
                df_buyer.to_csv(BUYER_FILE, index=False, encoding="utf-8-sig")
                logger.info(f"✅ 儲存完成")
        
        except Timeout:
            logger.error("❌ 無法取得檔案鎖,請稍後再試")
            return jsonify({
                "status": "error",
                "message": "系統忙碌中,請稍後再試"
            }), 503

        # 📝 準備回傳訊息
        success_msg = f"成功合併 PO {po_no} Item {item}: 刪除 {deleted_count} 筆分批資料,新增 {len(new_data_rows)} 筆合併資料"
        
        logger.info("=" * 80)
        logger.info(f"✅ {success_msg}")
        logger.info("=" * 80)

        # 🗑️ 刪除暫存的 CSV 檔案
        cleanup_temp_csv_files(po_no)
        
        return jsonify({
            "status": "success",
            "message": success_msg,
            "deleted_count": int(deleted_count),
            "inserted_count": len(new_data_rows),
            "merge_info": {
                "po_no": po_no,
                "item": item,
                "old_count": int(deleted_count),
                "new_count": len(new_data_rows)
            }
        })
        
    except Exception as e:
        logger.error("=" * 80)
        logger.error(f"❌ confirm_merge 發生嚴重錯誤")
        logger.error(f"❌ 錯誤訊息: {str(e)}")
        logger.error(f"❌ 錯誤類型: {type(e).__name__}")
        logger.error("❌ 完整堆疊追蹤:")
        logger.error(traceback.format_exc())
        logger.error("=" * 80)
        
        return jsonify({
            "status": "error",
            "message": f"合併失敗: {str(e)}"
        }), 500

# 正常流程
@app.route("/api/save_override_all", methods=["POST"])
def save_override_all():
    """
    Version 31 - 品名優先比對邏輯（已改進處理重複 Item）
    改進：優先以品名相似度為主要比對依據，Item 作為次要參考
    優先順序：同 PO 內的品名高度相似 > Item 相同 > 品名中度相似 > 新增
    """
    # 備份
    # backup_files()
    data = request.get_json()
    rows = data.get("rows", [])
    confirm_override = data.get("confirm_override", False)  # 是否已確認覆蓋

    if not rows:
        return jsonify({"status": "error", "msg": "❌ 沒有收到任何資料"}), 400

    def clean_text(x):
        """清理文字：移除換行和空白"""
        return str(x).replace("\n", "").replace("\r", "").strip()
    
    def calculate_similarity(text1, text2):
        """計算兩個字串的相似度 (0-100)"""
        text1_clean = clean_text(text1).lower()
        text2_clean = clean_text(text2).lower()
        return SequenceMatcher(None, text1_clean, text2_clean).ratio() * 100
    
    # 處理 pandas int64 轉換問題
    def convert_to_json_serializable(obj):
        """將 pandas 的特殊類型轉換為可序列化的類型"""
        if isinstance(obj, dict):
            return {k: convert_to_json_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_to_json_serializable(item) for item in obj]
        elif hasattr(obj, 'item'):  # numpy/pandas 數值類型
            return obj.item()
        elif pd.isna(obj):  # NaN 值
            return None
        else:
            return obj

    # 🔒 使用檔案鎖保護讀取操作
    try:
        with buyer_file_lock:
            # 讀取並處理資料
            df_buyer = pd.read_csv(BUYER_FILE, encoding="utf-8-sig", dtype=str, on_bad_lines="skip").fillna("")
            df_buyer["PO No."] = df_buyer["PO No."].str.strip()
            df_buyer["Item"] = (
                df_buyer["Item"]
                .str.replace(r"\.0$", "", regex=True)
                .str.strip()
                .apply(lambda x: x.zfill(4) if x.isdigit() else x)
            )
            
            # 🔴 重要：建立一個只包含狀態為 V 的資料索引
            df_active = df_buyer[df_buyer["開單狀態"] == "V"].copy()
            logger.info(f"總資料筆數: {len(df_buyer)}, 有效資料(狀態=V): {len(df_active)}")

    except Timeout:
        logger.error("❌ 無法取得檔案鎖,請稍後再試")
        return jsonify({"status": "error", "msg": "系統忙碌中,請稍後再試"}), 503
    except Exception as e:
        logger.error(f"❌ 讀取 Buyer_detail.csv 時發生錯誤: {str(e)}")
        return jsonify({"status": "error", "msg": f"讀取檔案失敗: {str(e)}"}), 500


    # ✅ 🆕 **在這裡添加初始化 all_group_results**
    all_group_results = []  # 用來收集所有 PO 的比對結果

    updated_count = 0
    inserted_count = 0
    failed = []
    need_confirm_items = []  # 需要確認的項目
    auto_updated_items = []  # 🆕 自動更新的項目
    matching_output = []  # 比對結果輸出

    new_item = ''
    epr_no = 0
    po_no_new = ''
    
    # 輸出開始訊息
    logger.info("\n" + "="*80)
    logger.info("開始處理資料比對 (Version 31 - 品名優先)")
    logger.info("="*80)

    for row_num, row in enumerate(rows, 1):
        id_ = row.get("id", "").strip()
        po_no_new = row.get("po_no", "").strip()
        item_new = row.get("item", "").strip()
        
        # 確保 item 格式一致（4位數）
        if item_new.isdigit():
            item_new = item_new.zfill(4)
            
        new_delivery = row.get("delivery_date", "").strip()
        new_qty = row.get("sod_qty", "").strip()
        new_desc = row.get("po_description", "").strip()
        new_desc_clean = clean_text(new_desc)

        target_idx = None
        match_reason = ""
        
        # 輸出當前處理項目
        logger.info(f"\n[第 {row_num} 筆]")
        logger.info(f"  新資料 => PO: {po_no_new}, Item: {item_new}")
        logger.info(f"  品名: {new_desc[:50]}{'...' if len(new_desc) > 50 else ''}")
        
        # 🔍 Version 31 核心改變：先找品名相似度，再考慮 Item
        # 步驟1：先在同 PO 內找資料（只找狀態為 V 的）
        po_group = df_active[df_active["PO No."].apply(lambda x: is_po_in_record(x, po_no_new))]
        
        if not po_group.empty:
            logger.info(f"     在 PO {po_no_new} 找到 {len(po_group)} 筆資料")
            
            # 🔥 Version 31：計算所有項目的品名相似度
            similarity_scores = []
            for idx, row_data in po_group.iterrows():
                existing_desc = row_data["品項"]
                existing_item = row_data["Item"]
                similarity = calculate_similarity(new_desc, existing_desc)
                similarity_scores.append({
                    'index': idx,
                    'item': existing_item,
                    'desc': existing_desc,
                    'similarity': similarity,
                    'item_match': (existing_item == item_new),  # 記錄 Item 是否相同
                    'delivery_date': row_data.get("Delivery Date 廠商承諾交期", "")  # 加入交期資訊
                })
            
            # 🔴🔴🔴 這裡是修改的重點 🔴🔴🔴
            # Version 31 改進：處理相同 Item 的多筆資料
            # 如果有多筆完全相同的 Item，優先考慮品名相似度，再考慮交期
            item_matches = [s for s in similarity_scores if s['item_match']]
            if len(item_matches) > 1:
                logger.info(f"     發現 {len(item_matches)} 筆相同的 Item {item_new}")
                
                # 🆕 計算每筆的品名相似度
                for match in item_matches:
                    match['name_similarity'] = calculate_similarity(new_desc, match['desc'])
                    
                    # 處理交期
                    try:
                        date_str = match['delivery_date'].strip()
                        if date_str:
                            date_str = date_str.split(' ')[0]
                            date_str = date_str.replace('/', '-')
                            match['parsed_date'] = date_str
                        else:
                            match['parsed_date'] = '1900-01-01'
                    except:
                        match['parsed_date'] = '1900-01-01'
                    
                    logger.info(f"       - Index {match['index']}: 品名相似度 {match['name_similarity']:.1f}%, 交期 {match['delivery_date']}")
                
                # 🆕 改進的選擇邏輯
                # 1. 先找品名完全相同或高度相似的（≥95%）
                exact_matches = [m for m in item_matches if m['name_similarity'] >= 95]
                
                if exact_matches:
                    # 如果有品名幾乎相同的，從中選擇交期最新的
                    exact_matches.sort(key=lambda x: x.get('parsed_date', '1900-01-01'), reverse=True)
                    newest_match = exact_matches[0]
                    logger.info(f"     => ✅ 選擇品名相同且交期最新的資料")
                    logger.info(f"        Index {newest_match['index']}")
                    logger.info(f"        品名相似度: {newest_match['name_similarity']:.1f}%")
                    logger.info(f"        交期: {newest_match['delivery_date']}")
                else:
                    # 如果沒有品名相同的，選擇品名最相似的（但要警告）
                    item_matches.sort(key=lambda x: (x['name_similarity'], x.get('parsed_date', '1900-01-01')), reverse=True)
                    newest_match = item_matches[0]
                    
                    if newest_match['name_similarity'] < 60:
                        logger.info(f"     => ⚠️⚠️ 警告：相同 Item 但品名差異很大！")
                        logger.info(f"        Index {newest_match['index']}")
                        logger.info(f"        品名相似度僅: {newest_match['name_similarity']:.1f}%")
                        logger.info(f"        原品名: {newest_match['desc'][:50]}...")
                        logger.info(f"        新品名: {new_desc[:50]}...")
                        logger.info(f"        建議手動檢查！")
                    else:
                        logger.info(f"     => ⚠️ 選擇品名最相似的資料")
                        logger.info(f"        Index {newest_match['index']}")
                        logger.info(f"        品名相似度: {newest_match['name_similarity']:.1f}%")
                
                # 將選中的資料移到 similarity_scores 的最前面
                similarity_scores = [s for s in similarity_scores if not s['item_match']]
                similarity_scores.insert(0, newest_match)
            else:
                # 排序：先按相似度排序，相似度相同時 Item 相同的優先
                similarity_scores.sort(key=lambda x: (x['similarity'], x['item_match']), reverse=True)
            # 🔴🔴🔴 修改結束 🔴🔴🔴
            
            # 輸出相似度排名（除錯用）
            logger.info(f"     品名相似度排名：")
            for i, score in enumerate(similarity_scores[:3], 1):  # 顯示前3名
                item_marker = " [Item相同]" if score['item_match'] else ""
                logger.info(f"       {i}. Item {score['item']}: {score['similarity']:.1f}%{item_marker} - {score['desc'][:30]}...")
            
            # 取得最高相似度的項目
            best_match = similarity_scores[0]
            best_similarity = best_match['similarity']
            best_idx = best_match['index']
            best_item = best_match['item']
            best_desc = best_match['desc']
            
            # 🎯 根據相似度和 Item 是否相同來決定處理方式
            if best_similarity >= 95:  # 品名幾乎完全相同
                target_idx = best_idx
                if best_item == item_new:
                    match_reason = "品名完全相同+Item相同"
                    logger.info(f"  ✅ 品名完全相同且 Item 相同（相似度 {best_similarity:.1f}%） => 直接更新")
                    
                    # 🆕 加入自動更新清單
                    auto_updated_items.append({
                        "row": row_num,
                        "po_no": po_no_new,
                        "new_item": item_new,
                        "old_item": best_item,
                        "new_desc": new_desc,
                        "old_desc": best_desc,
                        "similarity": round(best_similarity, 1),
                        "new_delivery": new_delivery,
                        "new_qty": new_qty,
                        "target_index": int(best_idx),
                        "reason": "品名與Item完全相同",
                        "action_type": "auto_updated"
                    })
                else:
                    match_reason = f"品名完全相同(Item:{best_item}→{item_new})"
                    logger.info(f"  ⚠️ 品名完全相同但 Item 不同（{best_item} → {item_new}）")
                    logger.info(f"     品名相似度: {best_similarity:.1f}%")
                    
                    if not confirm_override:
                        logger.info(f"     需要確認是否要更新 Item")
                        
                        need_confirm_items.append({
                            "row": row_num,
                            "po_no": po_no_new,
                            "new_item": item_new,
                            "new_desc": new_desc,
                            "old_item": best_item,
                            "old_desc": best_desc,
                            "similarity": round(best_similarity, 1),
                            "new_delivery": new_delivery,
                            "new_qty": new_qty,
                            "target_index": int(best_idx),
                            "reason": "品名相同但Item不同",
                            "action_type": "update_item_change"
                        })
                        
                        matching_output.append({
                            "row": row_num,
                            "po": po_no_new,
                            "item": f"{best_item}→{item_new}",
                            "match": match_reason,
                            "action": "待確認",
                            "note": f"品名相同但Item不同"
                        })
                        continue
                    else:
                        logger.info(f"     => 已確認，將更新 Item")
                        
            elif best_similarity >= 80:  # 品名高度相似
                target_idx = best_idx
                if best_item == item_new:
                    match_reason = f"品名高度相似+Item相同({best_similarity:.0f}%)"
                    logger.info(f"  ✅ 品名高度相似且 Item 相同（{best_similarity:.1f}%） => 直接更新")
                    
                    # 🆕 加入自動更新清單
                    auto_updated_items.append({
                        "row": row_num,
                        "po_no": po_no_new,
                        "new_item": item_new,
                        "old_item": best_item,
                        "new_desc": new_desc,
                        "old_desc": best_desc,
                        "similarity": round(best_similarity, 1),
                        "new_delivery": new_delivery,
                        "new_qty": new_qty,
                        "target_index": int(best_idx),
                        "reason": f"品名高度相似({best_similarity:.0f}%)且Item相同",
                        "action_type": "auto_updated"
                    })
                else:
                    match_reason = f"品名高度相似(Item:{best_item}→{item_new})"
                    logger.info(f"  ⚠️ 品名高度相似但 Item 不同（{best_item} → {item_new}）")
                    logger.info(f"     品名相似度: {best_similarity:.1f}%")
                    logger.info(f"     原品名: {best_desc[:40]}...")
                    logger.info(f"     新品名: {new_desc[:40]}...")
                    
                    if not confirm_override:
                        logger.info(f"     需要確認是否要更新")
                        
                        need_confirm_items.append({
                            "row": row_num,
                            "po_no": po_no_new,
                            "new_item": item_new,
                            "new_desc": new_desc,
                            "old_item": best_item,
                            "old_desc": best_desc,
                            "similarity": round(best_similarity, 1),
                            "new_delivery": new_delivery,
                            "new_qty": new_qty,
                            "target_index": int(best_idx),
                            "reason": "品名高度相似但Item不同",
                            "action_type": "update_high_similarity"
                        })
                        
                        matching_output.append({
                            "row": row_num,
                            "po": po_no_new,
                            "item": f"{best_item}→{item_new}",
                            "match": match_reason,
                            "action": "待確認",
                            "note": f"品名相似{best_similarity:.0f}%"
                        })
                        continue
                    else:
                        logger.info(f"     => 已確認，將更新")
                        
            elif best_similarity >= 60:  # 品名中度相似
                # 檢查是否有 Item 相同的項目
                item_match = next((s for s in similarity_scores if s['item_match']), None)
                
                if item_match and item_match['similarity'] >= 40:
                    # 如果有 Item 相同且相似度不是太低，優先選擇 Item 相同的
                    target_idx = item_match['index']
                    match_reason = f"Item相同+品名相似({item_match['similarity']:.0f}%)"
                    logger.info(f"  ⚠️ 找到 Item 相同的項目，品名相似度 {item_match['similarity']:.1f}%")
                    logger.info(f"     原品名: {item_match['desc'][:40]}...")
                    logger.info(f"     新品名: {new_desc[:40]}...")
                    
                    if not confirm_override:
                        logger.info(f"     需要確認是否要更新")
                        
                        need_confirm_items.append({
                            "row": row_num,
                            "po_no": po_no_new,
                            "new_item": item_new,
                            "new_desc": new_desc,
                            "old_item": item_new,
                            "old_desc": item_match['desc'],
                            "similarity": round(item_match['similarity'], 1),
                            "new_delivery": new_delivery,
                            "new_qty": new_qty,
                            "target_index": int(item_match['index']),
                            "reason": "Item相同但品名差異較大",
                            "action_type": "update_medium_similarity"
                        })
                        
                        matching_output.append({
                            "row": row_num,
                            "po": po_no_new,
                            "item": item_new,
                            "match": match_reason,
                            "action": "待確認",
                            "note": f"品名差異{item_match['similarity']:.0f}%"
                        })
                        continue
                    else:
                        logger.info(f"     => 已確認，將更新")
                else:
                    # 品名中度相似，Item 不同
                    target_idx = best_idx
                    match_reason = f"品名中度相似({best_similarity:.0f}%)"
                    logger.info(f"  ⚠️ 品名中度相似，Item 不同（{best_item} → {item_new}）")
                    logger.info(f"     相似度: {best_similarity:.1f}%")
                    logger.info(f"     原品名: {best_desc[:40]}...")
                    logger.info(f"     新品名: {new_desc[:40]}...")
                    
                    if not confirm_override:
                        logger.info(f"     需要確認")
                        
                        need_confirm_items.append({
                            "row": row_num,
                            "po_no": po_no_new,
                            "new_item": item_new,
                            "new_desc": new_desc,
                            "old_item": best_item,
                            "old_desc": best_desc,
                            "similarity": round(best_similarity, 1),
                            "new_delivery": new_delivery,
                            "new_qty": new_qty,
                            "target_index": int(best_idx),
                            "reason": "品名中度相似",
                            "action_type": "update_medium_similarity",
                            "warning": True
                        })
                        
                        matching_output.append({
                            "row": row_num,
                            "po": po_no_new,
                            "item": f"{best_item}→{item_new}",
                            "match": match_reason,
                            "action": "待確認",
                            "note": f"品名中度相似"
                        })
                        continue
                    else:
                        logger.info(f"     => 已確認，將更新")
                        
            else:  # 相似度 < 60%
                # 檢查是否有 Item 完全相同的
                item_match = next((s for s in similarity_scores if s['item_match']), None)
                
                if item_match:
                    # Item 相同但品名相似度低
                    logger.info(f"  ⚠️ 找到 Item 相同但品名差異很大（相似度 {item_match['similarity']:.1f}%）")
                    logger.info(f"     原品名: {item_match['desc'][:40]}...")
                    logger.info(f"     新品名: {new_desc[:40]}...")
                    
                    if not confirm_override:
                        logger.info(f"     ⚠️⚠️ 品名差異很大！需要確認")
                        
                        need_confirm_items.append({
                            "row": row_num,
                            "po_no": po_no_new,
                            "new_item": item_new,
                            "new_desc": new_desc,
                            "old_item": item_new,
                            "old_desc": item_match['desc'],
                            "similarity": round(item_match['similarity'], 1),
                            "new_delivery": new_delivery,
                            "new_qty": new_qty,
                            "target_index": int(item_match['index']),
                            "reason": "Item相同但品名完全不同",
                            "action_type": "update_low_similarity",
                            "warning": True,
                            "critical": True
                        })
                        
                        matching_output.append({
                            "row": row_num,
                            "po": po_no_new,
                            "item": item_new,
                            "match": f"Item相同(相似度{item_match['similarity']:.0f}%)",
                            "action": "待確認",
                            "note": f"❌品名差異極大"
                        })
                        continue
                    else:
                        target_idx = item_match['index']
                        match_reason = f"Item相同(品名差異大)"
                        logger.info(f"     => 已確認，將強制更新")
                else:
                    # 沒有任何匹配，建議新增
                    target_idx = None
        
        # 步驟2：如果在同 PO 內找不到匹配，詢問是否新增
        if target_idx is None and not po_group.empty:
            logger.info(f"  ⚠️  在 PO {po_no_new} 內找不到相似的品名或相同的 Item")
            logger.info(f"     新Item: {item_new}, 新品名: {new_desc[:40]}...")
            
            if not confirm_override:
                logger.info(f"     需要確認是否要新增為新項目")
                
                # 列出現有的項目供參考
                existing_items = []
                for score in similarity_scores[:5]:  # 顯示前5個相似度最高的
                    existing_items.append({
                        "item": score['item'],
                        "desc": score['desc'][:50],
                        "similarity": round(score['similarity'], 1)
                    })
                
                need_confirm_items.append({
                    "row": row_num,
                    "po_no": po_no_new,
                    "new_item": item_new,
                    "new_desc": new_desc,
                    "existing_items": existing_items,
                    "new_delivery": new_delivery,
                    "new_qty": new_qty,
                    "reason": "無相似項目",
                    "action_type": "add_new"
                })
                
                matching_output.append({
                    "row": row_num,
                    "po": po_no_new,
                    "item": item_new,
                    "match": "無匹配",
                    "action": "待確認",
                    "note": "建議新增"
                })
                continue
            else:
                logger.info(f"     => 已確認，將新增為新項目")
        
        # 步驟3：其他比對方式（ID、模糊比對等）- 只找狀態為 V 的
        if target_idx is None and id_:
            candidates = df_active[df_active["Id"] == id_].copy()
            
            if len(candidates) > 1:
                candidates["品項_clean"] = candidates["品項"].apply(clean_text)
                exact_match = candidates[candidates["品項_clean"] == new_desc_clean]
                if len(exact_match) == 1:
                    target_idx = exact_match.index[0]
                    match_reason = "ID+品項匹配"
                    logger.info(f"  ✅ ID+品項匹配 => 更新資料 (狀態=V)")
            elif len(candidates) == 1:
                target_idx = candidates.index[0]
                match_reason = "ID匹配"
                logger.info(f"  ✅ ID匹配 => 更新資料 (狀態=V)")

        # 步驟4：PO + 品項模糊比對 - 只找狀態為 V 的
        if target_idx is None:
            po_match = df_active[df_active["PO No."].apply(lambda x: is_po_in_record(x, po_no_new))]
            po_match = po_match[po_match["品項"].apply(lambda x: fuzzy_in(x, new_desc_clean))]

            if not po_match.empty:
                target_idx = po_match.index[0]
                match_reason = "PO+品項模糊匹配"
                logger.info(f"  ✅ PO+品項模糊匹配 => 更新資料 (狀態=V)")

        # 🔍 如果找到匹配項目，執行更新
        if target_idx is not None:
            # 記錄原始值（用於輸出）
            old_values = {
                "po": df_buyer.at[target_idx, "PO No."],
                "item": df_buyer.at[target_idx, "Item"],
                "delivery": df_buyer.at[target_idx, "Delivery Date 廠商承諾交期"],
                "qty": df_buyer.at[target_idx, "SOD Qty 廠商承諾數量"],
                "desc": df_buyer.at[target_idx, "品項"]
            }
            
            # 執行更新
            df_buyer.at[target_idx, "PO No."] = po_no_new
            df_buyer.at[target_idx, "Item"] = item_new
            df_buyer.at[target_idx, "Delivery Date 廠商承諾交期"] = new_delivery
            df_buyer.at[target_idx, "SOD Qty 廠商承諾數量"] = new_qty
            if new_desc:
                df_buyer.at[target_idx, "品項"] = new_desc
            updated_count += 1
            
            # 輸出變更詳情
            if old_values["po"] != po_no_new:
                logger.info(f"     PO變更: {old_values['po']} → {po_no_new}")
            if old_values["item"] != item_new:
                logger.info(f"     Item變更: {old_values['item']} → {item_new}")
            if old_values["delivery"] != new_delivery:
                logger.info(f"     交期變更: {old_values['delivery']} → {new_delivery}")
            if old_values["qty"] != new_qty:
                logger.info(f"     數量變更: {old_values['qty']} → {new_qty}")
            
            matching_output.append({
                "row": row_num,
                "po": po_no_new,
                "item": item_new if old_values["item"] == item_new else f"{old_values['item']}→{item_new}",
                "match": match_reason,
                "action": "已更新",
                "note": "品名已變更" if old_values["desc"] != new_desc else ""
            })
            continue

        # 🆕 如果都找不到 → 新增資料（但要檢查 PO 是否存在於狀態 V 的資料中）
        po_matches = df_active[df_active["PO No."].apply(lambda x: is_po_in_record(x, po_no_new))]
        if po_matches.empty:
            # 再檢查是否有狀態為 X 的相同 PO
            po_cancelled = df_buyer[
                (df_buyer["開單狀態"] == "X") & 
                (df_buyer["PO No."].apply(lambda x: is_po_in_record(x, po_no_new)))
            ]
            
            if not po_cancelled.empty:
                logger.info(f"  ⚠️  找到 PO {po_no_new} 但狀態為 X（已取消），無法更新")
                failed.append({
                    "row": row_num,
                    "po_no": po_no_new,
                    "item": item_new,
                    "reason": f"PO {po_no_new} 狀態為 X（已取消）"
                })
                
                matching_output.append({
                    "row": row_num,
                    "po": po_no_new,
                    "item": item_new,
                    "match": "PO已取消",
                    "action": "失敗",
                    "note": "狀態為X"
                })
                continue
            else:
                # 🔴 Version 31：PO 完全不存在的情況
                logger.info(f"  ❌ 360表單無此項目：PO {po_no_new}")
                
                failed.append({
                    "row": row_num,
                    "po_no": po_no_new,
                    "item": item_new,
                    "reason": "360表單無此項目"
                })
                
                matching_output.append({
                    "row": row_num,
                    "po": po_no_new,
                    "item": item_new,
                    "match": "無PO",
                    "action": "失敗",
                    "note": "360表單無此項目"
                })
                continue
        
        # 🆓 推測 Id（取首筆）
        possible_ids = po_matches["Id"].dropna().unique().tolist()
        id_ = possible_ids[0] if possible_ids else row.get("id") or row.get("Id", "")
        id_ = str(id_).strip()

        # 👤 取同組第一筆的資訊
        user = po_matches["User"].iloc[0] if not po_matches.empty else ""
        epr_no = po_matches["ePR No."].iloc[0] if not po_matches.empty else ""
        wbs_no = po_matches["WBS"].iloc[0] if not po_matches.empty else ""
        need_day_no = po_matches["需求日"].iloc[0] if not po_matches.empty else ""

        logger.info(f"  🆕 找不到匹配項目 => 新增資料")
        logger.info(f"     新增到 ePR No.: {epr_no}")

        # ➕ 新增新的一筆資料
        new_row = {
            "Id": id_,
            "開單狀態": "V",
            "交貨驗證": "",
            "User": user,
            "ePR No.": epr_no,
            "PO No.": po_no_new,
            "Item": item_new,
            "品項": new_desc,
            "規格": "",
            "數量": new_qty,
            "總數": new_qty,
            "單價": "",
            "總價": "",
            "備註": "",
            "字數": "",
            "isEditing": "False",
            "backup": "{}",
            "_alertedItemLimit": "",
            "Delivery Date 廠商承諾交期": new_delivery,
            "SOD Qty 廠商承諾數量": new_qty,
            "驗收數量": "",
            "拒收數量": "",
            "發票月份": "",
            "WBS": wbs_no,
            "需求日": need_day_no,
            "RT金額": '',
            "RT總金額": '',
            "驗收狀態": "X" 
        }

        # 📌 找這個 id 的最後一筆位置
        same_id_idx = df_buyer[df_buyer["Id"] == id_].index
        insert_pos = same_id_idx[-1] + 1 if len(same_id_idx) > 0 else len(df_buyer)

        # ✨ 插入到原 df_buyer 中指定位置
        df_buyer = pd.concat([
            df_buyer.iloc[:insert_pos],
            pd.DataFrame([new_row]),
            df_buyer.iloc[insert_pos:]
        ], ignore_index=True)
        
        new_item = '新增物件'
        inserted_count += 1
        
        matching_output.append({
            "row": row_num,
            "po": po_no_new,
            "item": item_new,
            "match": "無匹配",
            "action": "已新增",
            "note": f"ePR:{epr_no}"
        })

    # 輸出比對結果摘要
    logger.info("\n" + "="*80)
    logger.info("比對結果摘要 (Version 31 - 品名優先)")
    logger.info("="*80)
    logger.info(f"總處理筆數: {len(rows)}")
    logger.info(f"更新筆數: {updated_count}")
    logger.info(f"新增筆數: {inserted_count}")
    logger.info(f"失敗筆數: {len(failed)}")
    logger.info(f"待確認筆數: {len(need_confirm_items)}")
    logger.info(f"自動更新筆數: {len(auto_updated_items)}")  # 
    
    # 輸出詳細比對表格
    if matching_output:
        logger.info("\n詳細比對結果:")
        logger.info("-"*80)
        logger.info(f"{'筆數':<5} {'PO No.':<15} {'Item':<10} {'比對方式':<20} {'處理':<8} {'備註'}")
        logger.info("-"*80)
        for item in matching_output:
            logger.info(f"{item['row']:<5} {item['po']:<15} {item['item']:<10} {item['match']:<20} {item['action']:<8} {item['note']}")
    
    logger.info("="*80 + "\n")

    # 如果有需要確認的項目，回傳給前端
    if need_confirm_items and not confirm_override:
        # 檢查是否有關鍵確認項（品名完全不同）
        critical_items = [item for item in need_confirm_items if item.get("critical", False)]
        warning_items = [item for item in need_confirm_items if item.get("warning", False)]
        
        # 根據不同的確認原因和動作類型，產生不同的訊息
        action_types = set(item.get("action_type", "") for item in need_confirm_items)
        
        if critical_items:
            msg = f"⚠️ 發現 {len(critical_items)} 個品名完全不同的項目需要特別確認"
        elif "update_low_similarity" in action_types:
            msg = f"❌ 發現 {len(need_confirm_items)} 個品名相似度極低的項目需要確認"
        elif "update_item_change" in action_types:
            msg = f"發現 {len(need_confirm_items)} 個品名相同但Item不同的項目需要確認"
        elif "add_new" in action_types:
            msg = f"發現 {len(need_confirm_items)} 個項目可能需要新增"
        else:
            msg = f"發現 {len(need_confirm_items)} 個需要確認的項目"
        
        return jsonify(convert_to_json_serializable({
            "status": "confirm_needed",
            "msg": msg,
            "items": need_confirm_items,
            "auto_updated": auto_updated_items,  # 🆕 新增自動更新的項目
            "updated": updated_count,
            "inserted": inserted_count,
            "matching_output": matching_output,
            "has_critical": len(critical_items) > 0,
            "has_warning": len(warning_items) > 0
        }))

    # 🔒 使用檔案鎖保護儲存操作
    try:
        with buyer_file_lock:
            # 儲存回檔案
            df_buyer.to_csv(BUYER_FILE, index=False, encoding="utf-8-sig")
    except Timeout:
        logger.error("❌ 無法取得檔案鎖進行儲存,請稍後再試")
        return jsonify({"status": "error", "msg": "系統忙碌中,無法儲存,請稍後再試"}), 503
    except Exception as e:
        logger.error(f"❌ 儲存 Buyer_detail.csv 時發生錯誤: {str(e)}")
        return jsonify({"status": "error", "msg": f"儲存檔案失敗: {str(e)}"}), 500
    
    # 刪除暫存檔案
    if po_no_new:
        temp_file = os.path.join(UPLOAD_DIR, f"{po_no_new}.csv")
        if os.path.exists(temp_file):
            os.remove(temp_file)
    
    # 🔴 檢查是否所有項目都失敗且原因都是「360表單無此項目」
    if failed and len(failed) == len(rows):
        all_not_found = all(f.get("reason") == "360表單無此項目" for f in failed)
        if all_not_found:
            return jsonify(convert_to_json_serializable({
                "status": "not_found",
                "msg": "❌ 360表單無此項目",
                "failed": failed,
                "matching_output": matching_output
            }))
    
    # 回傳結果
    if new_item == '新增物件':
        return jsonify(convert_to_json_serializable({
            "status": "ok",
            "msg": f"有新增的物件(item)需要維護，ePR No. 單號為 {epr_no}。更新 {updated_count} 筆，新增 {inserted_count} 筆",
            "failed": failed,
            "matching_output": matching_output,
            "auto_updated": auto_updated_items  # 🆕 也在成功時回傳
        }))
    else:
        return jsonify(convert_to_json_serializable({
            "status": "ok",
            "msg": f"✅ 更新 {updated_count} 筆，新增 {inserted_count} 筆",
            "failed": failed,
            "matching_output": matching_output,
            "auto_updated": auto_updated_items  # 🆕 也在成功時回傳
        }))




# eRT 驗收表單
# Log 設定已移至 log_config.py（讀取 config.ini），logger 於檔案開頭統一取得

# 2025/11/03修正
@app.route('/api/update-buyer-items', methods=['POST'])
def update_buyer_items():
    """
    更新 Buyer_detail.csv - 先刪除同 Id 的所有舊資料，再寫入新資料
    """
    try:
        data = request.json
        item_id = data.get('Id') # type: ignore
        new_items = data.get('items', []) # type: ignore
        username = data.get('username', '') # type: ignore
        
        if not item_id:
            return jsonify({'status': 'error', 'success': False, 'message': '缺少 Id'}), 400
        
        if not new_items or len(new_items) == 0:
            return jsonify({'status': 'error', 'success': False, 'message': '沒有要更新的資料'}), 400
        
        logger.info(f"🔄 使用者 {username} 請求更新 Id: {item_id}，共 {len(new_items)} 筆資料")
        
        # 🔒 使用檔案鎖
        with buyer_file_lock:
            logger.info(f"🔒 已取得檔案鎖，開始更新...")
            
            # 讀取 CSV
            df = pd.read_csv(BUYER_FILE, encoding='utf-8-sig', dtype=str)
            df.columns = df.columns.str.strip()
            
            # ⭐ 步驟1: 刪除同 Id 的所有舊資料
            mask = df['Id'].astype(str).str.strip() == str(item_id).strip()
            old_count = mask.sum()
            
            if old_count > 0:
                logger.info(f"📝 找到 {old_count} 筆舊資料，準備刪除")
            
            df = df[~mask]
            logger.info(f"✅ 已刪除 {old_count} 筆舊資料")
            
            # ⭐ 步驟2: 準備新資料
            new_rows = []
            for item in new_items:
                # 移除前端的特殊欄位
                item.pop('backup', None)
                item.pop('isEditing', None)
                item.pop('_alertedItemLimit', None)
                
                # 確保所有欄位都存在
                new_row = {}
                for col in df.columns:
                    new_row[col] = str(item.get(col, '')) if item.get(col) is not None else ''
                new_rows.append(new_row)
                logger.info(f"  新資料: Item={item.get('Item')}, 品項={item.get('品項')}, 總價={item.get('總價')}")
            
            # ⭐ 步驟3: 加入新資料
            new_df = pd.DataFrame(new_rows)
            df = pd.concat([df, new_df], ignore_index=True)
            logger.info(f"✅ 已加入 {len(new_items)} 筆新資料")
            
            # 確保欄位順序正確
            final_columns = ['Id', '開單狀態', '交貨驗證', 'User', 'ePR No.', 'PO No.', 'Item', '品項', '規格', 
                           '數量', '總數', '單價', '總價', '備註', '字數', 'isEditing', 'backup', '_alertedItemLimit', 
                           'Delivery Date 廠商承諾交期', 'SOD Qty 廠商承諾數量', '驗收數量', '拒收數量', 
                           '發票月份', 'WBS', '需求日', 'RT金額', 'RT總金額', '驗收狀態']
            
            # 確保所有欄位存在
            for col in final_columns:
                if col not in df.columns:
                    df[col] = ''
            
            # 重新排序
            df = df[final_columns]
            
            # 儲存
            df.to_csv(BUYER_FILE, index=False, encoding='utf-8-sig', na_rep='')
            
            logger.info(f"✅ 更新成功! (刪除 {old_count} 筆 + 新增 {len(new_items)} 筆)")
            logger.info(f"🔓 釋放檔案鎖")
        
        # ⭐⭐⭐ 關鍵修改：將 int64 轉換成 int ⭐⭐⭐
        return jsonify({
            'status': 'success',
            'success': True,
            'message': '更新成功',
            'msg': f'已刪除 {old_count} 筆舊資料，新增 {len(new_items)} 筆資料',
            'deleted_count': int(old_count),      # ⭐ 加 int() 轉換
            'added_count': len(new_items)
        }), 200
        
    except Timeout:
        error_msg = '檔案正在被其他程序使用，請稍後再試'
        logger.info(f"⏱️ {error_msg}")
        return jsonify({'status': 'error', 'success': False, 'message': error_msg}), 503
        
    except Exception as e:
        error_msg = str(e)
        logger.info(f"❌ 更新失敗: {error_msg}")
        traceback.print_exc()
        return jsonify({'status': 'error', 'success': False, 'message': error_msg}), 500


# 2025/11/03修正
@app.route('/api/delete-buyer-item-exact', methods=['POST'])
def delete_buyer_item_exact():
    """
    刪除 Buyer_detail.csv - 精確比對所有欄位，找到完全一樣的才刪除
    """
    try:
        data = request.json
        item_to_delete = data.get('item', {}) # type: ignore
        username = data.get('username', '') # type: ignore
        
        if not item_to_delete or not item_to_delete.get('Id'):
            return jsonify({'status': 'error', 'success': False, 'message': '缺少資料或 Id'}), 400
        
        item_id = item_to_delete.get('Id')
        logger.info(f"🗑️ 使用者 {username} 請求刪除 Id: {item_id}, Item: {item_to_delete.get('Item')}")
        
        # 🔒 使用檔案鎖
        with buyer_file_lock:
            logger.info(f"🔒 已取得檔案鎖，開始刪除...")
            
            # 讀取 CSV
            df = pd.read_csv(BUYER_FILE, encoding='utf-8-sig', dtype=str)
            df.columns = df.columns.str.strip()
            
            # 記錄刪除前的筆數
            df_before_count = len(df)
            
            # ⭐ 建立比對遮罩：比對所有欄位
            # 需要比對的欄位（排除前端特殊欄位）
            ignore_fields = ['backup', 'isEditing', '_alertedItemLimit']
            
            # 找到所有需要比對的欄位
            fields_to_compare = [col for col in df.columns if col not in ignore_fields]
            
            logger.info(f"📋 準備比對 {len(fields_to_compare)} 個欄位")
            
            # 建立比對條件
            mask = pd.Series([True] * len(df))
            
            matched_fields = []
            for field in fields_to_compare:
                if field in item_to_delete:
                    expected_value = str(item_to_delete[field]) if item_to_delete[field] is not None else ''
                    
                    # 處理 CSV 中的 NaN
                    actual_values = df[field].fillna('').astype(str)
                    
                    # 比對
                    field_match = actual_values == expected_value
                    mask = mask & field_match
                    
                    if expected_value != '':  # 只記錄非空值的欄位
                        matched_fields.append(f"{field}={expected_value}")
            
            matched_count = mask.sum()
            
            if matched_count == 0:
                logger.info(f"❌ 找不到完全符合的資料")
                logger.info(f"   比對條件: {', '.join(matched_fields[:5])}...")
                return jsonify({
                    'status': 'error',
                    'success': False,
                    'message': '找不到完全符合的資料'
                }), 404
            
            if matched_count > 1:
                logger.info(f"⚠️ 警告：找到 {matched_count} 筆完全相同的資料，將全部刪除")
            
            # 記錄要刪除的資料
            deleted_data = df[mask].to_dict('records')
            logger.info(f"📝 準備刪除 {matched_count} 筆資料:")
            for idx, item in enumerate(deleted_data):
                logger.info(f"  資料 {idx+1}: Item={item.get('Item')}, 品項={item.get('品項')}, 總價={item.get('總價')}")
            
            # ⭐ 執行刪除
            df = df[~mask]
            df_after_count = len(df)
            
            # 儲存
            df.to_csv(BUYER_FILE, index=False, encoding='utf-8-sig', na_rep='')
            
            deleted_count = df_before_count - df_after_count
            logger.info(f"✅ 刪除成功! 共刪除 {deleted_count} 筆資料 (總筆數: {df_before_count} → {df_after_count})")
            logger.info(f"🔓 釋放檔案鎖")
        
        return jsonify({
            'status': 'success',
            'success': True,
            'message': '刪除成功',
            'msg': f'成功刪除 {deleted_count} 筆資料',
            'deleted_count': int(deleted_count)  # ⭐ 轉換成 int
        }), 200
        
    except Timeout:
        error_msg = '檔案正在被其他程序使用，請稍後再試'
        logger.info(f"⏱️ {error_msg}")
        return jsonify({'status': 'error', 'success': False, 'message': error_msg}), 503
        
    except Exception as e:
        error_msg = str(e)
        logger.info(f"❌ 刪除失敗: {error_msg}")
        traceback.print_exc()
        return jsonify({'status': 'error', 'success': False, 'message': error_msg}), 500
    

@app.route("/api/update_delivery_receipt", methods=["POST"])
def upload_buyer_detail():
    # 備份
    # backup_files()
    file = request.files.get('file')
    if not file or not file.filename:
        logger.info("❌ 沒有收到檔案")
        return jsonify({"status": "fail", "message": "No file uploaded"}), 400

    filename = file.filename
    ext = os.path.splitext(filename)[-1].lower()
    logger.info(f"📁 收到檔案：{filename}（副檔名：{ext}）")

    if ext not in ['.xlsx', '.xls']:
        return jsonify({"status": "fail", "message": "Invalid file type"}), 400

    try:
        engine = 'openpyxl' if ext == '.xlsx' else 'xlrd'
        df = pd.read_excel(file, engine=engine)  # 這行最容易報錯
        df.to_csv(DELIVERY_RECEIPT_FILE, index=False, encoding="utf-8-sig")
        logger.info(r"💾 已儲存為 D:\Data\ePR_Data\delivery_receipt.csv，開始進行對 Buyer detail 該表數據更新")


        output_df = pd.read_csv(DELIVERY_RECEIPT_FILE, encoding="utf-8-sig", dtype=str)
        buyer_df = pd.read_csv(BUYER_FILE, encoding="utf-8-sig", dtype=str)

        # === 欄位標準化 ===
        output_df.columns = output_df.columns.str.replace("\ufeff", "").str.strip()
        buyer_df.columns = buyer_df.columns.str.strip()


        # === 確認並處理必要的欄位 ===
        required_buyer_cols = ["PO No.", "品項", "驗收數量", "拒收數量", "發票月份"]
        required_output_cols = ["PONO", "品名", "驗收數量", "拒收數量", "收料日期"]

        # 檢查 buyer_df 是否有必要的欄位
        if not all(col in buyer_df.columns for col in required_buyer_cols):
            missing_cols = [col for col in required_buyer_cols if col not in buyer_df.columns]
            logger.info(f"錯誤: {BUYER_FILE} 缺少必要的欄位: {', '.join(missing_cols)}")
            logger.error(f"{BUYER_FILE} 缺少必要的欄位: {', '.join(missing_cols)}")
            exit()

        # 檢查 output_df 是否有必要的欄位
        if not all(col in output_df.columns for col in required_output_cols):
            missing_cols = [col for col in required_output_cols if col not in output_df.columns]
            logger.info(f"錯誤: delivery_receipt.csv 缺少必要的欄位: {', '.join(missing_cols)}")
            logger.error(f"delivery_receipt.csv 缺少必要的欄位: {', '.join(missing_cols)}")
            exit()

        # === 資料清理與預處理 ===
        # 清理 output_df 的 PONO 和 品名
        output_df["PONO_clean"] = output_df["PONO"].astype(str).str.strip().str.upper()
        output_df["品名_clean"] = output_df["品名"].astype(str).str.strip()

        # 根據你的要求，直接複製收料日期到新的發票月份欄位，不進行任何格式更改。
        output_df["發票月份_from_output"] = output_df["收料日期"].astype(str).str.strip()

        output_df.rename(columns={
            "驗收數量": "驗收數量_from_output",
            "拒收數量": "拒收數量_from_output"
        }, inplace=True)

        # 清理 buyer_df 的 PO No. 和 品項
        buyer_df["PO_clean"] = buyer_df["PO No."].astype(str).str.strip().str.upper()
        buyer_df["品項_clean"] = buyer_df["品項"].astype(str).str.strip()

        # 選擇 output_df 需要的欄位進行合併
        output_cols_to_merge = [
            "PONO_clean",
            "品名_clean",
            "驗收數量_from_output",
            "拒收數量_from_output",
            "發票月份_from_output"
        ]
        output_subset = output_df[output_cols_to_merge].copy()

        # === 合併資料 ===
        merged = pd.merge(
            buyer_df,
            output_subset,
            how='left',
            left_on=["PO_clean", "品項_clean"],
            right_on=["PONO_clean", "品名_clean"],
            suffixes=("", "_from_output")
        )

        # === 更新欄位 ===
        columns_to_update = {
            "驗收數量": "驗收數量_from_output",
            "拒收數量": "拒收數量_from_output",
            "發票月份": "發票月份_from_output"
        }

        update_count = 0
        for idx, row in merged.iterrows():
            updated = False
            log_info = {}
            
            po = row.get("PO No.", "N/A")
            item = row.get("Item", "N/A") # 使用 'Item' 欄位
            
            # 這裡確保 '品項' 欄位有值，否則以 'Item' 替代
            item_for_log = row.get("品項", "N/A")
            if item_for_log == 'N/A' or pd.isna(item_for_log):
                item_for_log = item

            for target_col, source_col in columns_to_update.items():
                new_val = row.get(source_col, "")
                old_val = row.get(target_col, "")

                if pd.isna(new_val): new_val = ""
                if pd.isna(old_val): old_val = ""

                clean_new_val = str(new_val).strip()
                clean_old_val = str(old_val).strip()

                if clean_new_val != "" and clean_new_val != clean_old_val:
                    merged.at[idx, target_col] = clean_new_val # type: ignore
                    updated = True
                    log_info[target_col] = {"old": old_val, "new": clean_new_val}

            if updated:
                update_count += 1
                # 使用你要求的日誌格式
                logger.info(
                    f"{{'{po}'}} 更改 -> item: {item_for_log}, "
                    f"驗收數量: {log_info.get('驗收數量', {}).get('new', row.get('驗收數量', ''))}, "
                    f"拒收數量: {log_info.get('拒收數量', {}).get('new', row.get('拒收數量', ''))}, "
                    f"發票月份: {log_info.get('發票月份', {}).get('new', row.get('發票月份', ''))}"
                )

        # === 移除中繼欄位 ===
        merged.drop(columns=[c for c in merged.columns if c.endswith("_clean") or c.endswith("_from_output")], inplace=True)

        # === 最終輸出欄位清單 ===
        final_columns = ['Id', '開單狀態', '交貨驗證', 'User', 'ePR No.', 'PO No.', 'Item', '品項', '規格', '數量', '總數', '單價', '總價', '備註', '字數', 'isEditing', 'backup', '_alertedItemLimit', 
                         'Delivery Date 廠商承諾交期', 'SOD Qty 廠商承諾數量', '驗收數量', '拒收數量', '發票月份', "WBS", "需求日", "RT金額", "RT總金額", "驗收狀態"]

        # 確保只保留需要的欄位
        final_df = merged[final_columns].copy()

        # === 儲存更新後的檔案 ===
        final_df.to_csv(BUYER_FILE, index=False, encoding="utf-8-sig")

        logger.info(f"總共更新了 {update_count} 筆資料。")
        logger.info(f"檔案已更新。總共更新了 {update_count} 筆資料。")
        os.remove(DELIVERY_RECEIPT_FILE)

        return jsonify({"status": "success", "msg": f"檔案已更新。總共更新了 {update_count} 筆資料。"})
    except Exception as e:
        traceback.print_exc()  # 印出完整錯誤堆疊
        return jsonify({"status": "error", "message": str(e)}), 500
    

@app.route("/api/buyer_detail", methods=["GET"])
def get_buyer_details():
    """
    讀取 Buyer_detail.csv 檔案並以 JSON 格式回傳。
    """
    # 檢查檔案是否存在
    if not os.path.exists(BUYER_FILE):
        print(f"錯誤：找不到檔案 {BUYER_FILE}")
        return jsonify({"error": f"找不到檔案 {BUYER_FILE}"}), 500
        
    try:
        # 使用 pandas 讀取 CSV 檔案
        df = pd.read_csv(BUYER_FILE, encoding="utf-8-sig", dtype=str)
        
        # 確保欄位名稱沒有多餘的空白
        df.columns = df.columns.str.strip()

        # === 修正：將 DataFrame 中的 NaN 值替換為 None ===
        # 讀取 CSV 時 dtype=str 會將 NaN 讀成字串 'nan'。
        df = df.replace({np.nan: None, 'nan': None})
        
        # 將 DataFrame 轉換成 JSON 格式的列表
        data_json = df.to_dict('records')
        
        return jsonify(data_json)
    except Exception as e:
        print(f"處理檔案時發生錯誤: {e}")
        return jsonify({"error": f"處理檔案時發生錯誤: {e}"}), 500



# 物料收貨單
from datetime import datetime
import hashlib
from bs4 import BeautifulSoup
import email
from email import policy
from email.parser import BytesParser
# Log 設定已移至 log_config.py，此處不再重複設定

# Buyer CSV 路徑已統一使用檔案開頭的 BUYER_FILE 常數

# 設定
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB 檔案大小限制
app.config['UPLOAD_FOLDER'] = UPLOAD_DIR
app.config['PROCESSED_FOLDER'] = PROCESSED_DIR
app.config['ALLOWED_EXTENSIONS'] = {'mhtml'}  

def allowed_file(filename):
    """檢查檔案是否為允許的格式"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def generate_unique_filename(original_name, new_name):
    """生成唯一的檔名"""
    # 取得副檔名
    ext = original_name.rsplit('.', 1)[1].lower()
    
    # 如果新檔名沒有副檔名，加上原始副檔名
    if not new_name.endswith(f'.{ext}'):
        new_name = f"{new_name}.{ext}"
    
    # 生成唯一識別碼
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    unique_id = hashlib.md5(f"{new_name}{timestamp}".encode()).hexdigest()[:8]
    
    # 組合最終檔名
    name_without_ext = new_name.rsplit('.', 1)[0]
    final_name = f"{name_without_ext}_{unique_id}.{ext}"
    
    return secure_filename(final_name)

class MHTMLParser:
    """MHTML 檔案解析器"""
    
    def __init__(self, file_path):
        self.file_path = file_path
        self.boundary = None
        self.parts = []
        self.html_content = None
        self.metadata = {}
        self.gridview_data = None
        
    def parse(self):
        """解析 MHTML 檔案"""
        try:
            with open(self.file_path, 'rb') as f:
                # 使用 email 模組解析 MHTML
                try:
                    msg = BytesParser(policy=policy.default).parse(f)
                except Exception as e:
                    logger.error(f"Email parser error: {str(e)}")
                    # 如果 email 解析失敗，嘗試直接讀取為 HTML
                    f.seek(0)
                    content = f.read()
                    self.html_content = content.decode('utf-8', errors='ignore')
                    
                    if self.html_content:
                        result = self._extract_html_info()
                        gridview_data = self._parse_gridview()
                        if gridview_data:
                            result['gridview_data'] = gridview_data # type: ignore
                        return result
                    return {'error': f'無法解析檔案: {str(e)}'}
                
                # 提取基本資訊
                self.metadata['subject'] = msg.get('Subject', '')
                self.metadata['date'] = msg.get('Date', '')
                self.metadata['from'] = msg.get('From', '')
                self.metadata['content_type'] = msg.get_content_type()
                
                # 處理多部分內容
                if msg.is_multipart():
                    self._parse_multipart(msg)
                else:
                    # 單一部分 MHTML
                    content = msg.get_payload(decode=True)
                    if content:
                        self.html_content = content.decode('utf-8', errors='ignore') # type: ignore
                
                # 解析 HTML 內容
                if self.html_content:
                    result = self._extract_html_info()
                    
                    # 特別處理 GridView 表格
                    gridview_data = self._parse_gridview()
                    if gridview_data:
                        result['gridview_data'] = gridview_data # type: ignore
                    
                    return result
                    
            return self.metadata
            
        except Exception as e:
            logger.error(f"解析錯誤: {str(e)}")
            logger.error(traceback.format_exc())
            return {'error': str(e)}
    
    def _parse_multipart(self, msg):
        """解析多部分 MHTML"""
        for part in msg.walk():
            content_type = part.get_content_type()
            
            # 尋找 HTML 內容
            if content_type == 'text/html':
                content = part.get_payload(decode=True)
                if content:
                    self.html_content = content.decode('utf-8', errors='ignore')
                    
            # 收集其他資源
            elif not part.is_multipart():
                self.parts.append({
                    'content_type': content_type,
                    'content_location': part.get('Content-Location', ''),
                    'content_id': part.get('Content-ID', ''),
                    'size': len(part.get_payload())
                })
    
    def _extract_html_info(self):
        """從 HTML 內容提取資訊"""
        if not self.html_content:
            return None  # 或 raise ValueError("html_content 為空")
        
        soup = BeautifulSoup(self.html_content, 'html.parser')
        
        # 提取標題
        title_tag = soup.find('title')
        self.metadata['title'] = title_tag.string if title_tag else ''  # type: ignore
        
        # 提取 meta 標籤
        meta_tags = {}
        for meta in soup.find_all('meta'):
            name = meta.get('name') or meta.get('property')
            content = meta.get('content')
            if name and content:
                meta_tags[name] = content
            
            # 特別處理 charset
            if meta.get('charset'):
                self.metadata['encoding'] = meta.get('charset')
            elif meta.get('http-equiv', '').lower() == 'content-type':
                content = meta.get('content', '')
                if 'charset=' in content:
                    self.metadata['encoding'] = content.split('charset=')[-1].strip()
        
        self.metadata['meta_tags'] = meta_tags
        
        # 統計資訊
        self.metadata['statistics'] = {
            'total_parts': len(self.parts),
            'html_size': len(self.html_content) if self.html_content else 0
        }
        
        # 提取文字內容摘要（前500字）
        text_content = soup.get_text(strip=True)
        self.metadata['content_preview'] = text_content[:500] if text_content else ''
        
        return self.metadata
    
    def _parse_gridview(self):
        """解析 GridView 表格資料"""
        if not self.html_content:
            return None
        
        try:
            soup = BeautifulSoup(self.html_content, 'html.parser')
            
            # 尋找 GridView Wrapper
            wrapper = soup.find('div', {'id': 'ContentPlaceHolder1_GridView2Wrapper'})
            if not wrapper:
                logger.debug("No GridView wrapper found")
                return None
            
            gridview_data = {
                'headers': [],
                'rows': [],
                'statistics': {}
            }
            
            # 解析表頭
            header_table = wrapper.find('table', {'id': 'ContentPlaceHolder1_GridView2Copy'}) # type: ignore
            if header_table:
                header_row = header_table.find('tr', {'id': lambda x: x and 'HeaderCopy' in x}) # type: ignore
                if header_row:
                    for th in header_row.find_all('th'): # type: ignore
                        # 清理表頭文字
                        header_text = th.get_text(strip=True)
                        header_text = header_text.replace('\n', ' ').replace('\r', '')
                        # 分離中英文
                        if 'br' in str(th):
                            parts = [t.strip() for t in th.strings]
                            header_dict = {
                                'zh': parts[0] if len(parts) > 0 else '',
                                'en': parts[1] if len(parts) > 1 else '',
                                'full': header_text
                            }
                        else:
                            header_dict = {
                                'zh': header_text,
                                'en': '',
                                'full': header_text
                            }
                        gridview_data['headers'].append(header_dict)
            
            # 解析資料行
            data_table = wrapper.find('table', {'id': 'ContentPlaceHolder1_GridView2'}) # type: ignore
            if data_table:
                # 找所有的 tr，排除表頭
                all_rows = data_table.find_all('tr') # type: ignore
                data_rows = []
                
                for row in all_rows:
                    # 跳過表頭行（通常有特定的 style 或 id）
                    if row.get('id') and 'Header' in row.get('id', ''):
                        continue
                    if row.get('style') and 'display: none' in row.get('style', ''):
                        continue
                    # 確保有 td 元素
                    if row.find_all('td'):
                        data_rows.append(row)
                
                for row in data_rows:
                    row_data = []
                    cells = row.find_all('td')
                    
                    for idx, td in enumerate(cells):
                        cell_data = {
                            'value': '',
                            'inputs': [],
                            'spans': []
                        }
                        
                        # 提取 input 元素
                        inputs = td.find_all('input')
                        for inp in inputs:
                            input_data = {
                                'type': inp.get('type', ''),
                                'name': inp.get('name', ''),
                                'id': inp.get('id', ''),
                                'title': inp.get('title', ''),
                                'src': inp.get('src', '')
                            }
                            # 標記按鈕類型，不依賴外部圖片
                            if input_data['src']:
                                if 'edit' in input_data['src'].lower() or '編輯' in input_data.get('title', ''):
                                    input_data['button_type'] = 'edit'
                                elif 'delete' in input_data['src'].lower() or '刪除' in input_data.get('title', ''):
                                    input_data['button_type'] = 'delete'
                                else:
                                    input_data['button_type'] = 'unknown'
                            
                            cell_data['inputs'].append(input_data)
                        
                        # 提取 span 元素
                        spans = td.find_all('span')
                        for span in spans:
                            span_text = span.get_text(strip=True)
                            cell_data['spans'].append({
                                'id': span.get('id', ''),
                                'class': span.get('class', []),
                                'text': span_text
                            })
                            if not cell_data['value']:  # 使用第一個 span 的文字作為值
                                cell_data['value'] = span_text
                        
                        # 如果沒有 span，取整個 td 的文字
                        if not cell_data['value']:
                            cell_data['value'] = td.get_text(strip=True)
                        
                        row_data.append(cell_data)
                    
                    # 將資料行加入結果
                    if row_data:
                        # 建立結構化的資料物件
                        structured_row = {}
                        for i, header in enumerate(gridview_data['headers']):
                            if i < len(row_data):
                                # 建立更安全的欄位名稱
                                if header.get('en'):
                                    field_name = re.sub(r'[^a-zA-Z0-9_]', '_', header['en'].lower())
                                else:
                                    field_name = f'field_{i}'
                                structured_row[field_name] = row_data[i]['value']
                        
                        # 加入原始資料和結構化資料
                        gridview_data['rows'].append({
                            'raw_data': row_data,
                            'structured_data': structured_row
                        })
            
            # 統計資訊
            gridview_data['statistics'] = {
                'total_columns': len(gridview_data['headers']),
                'total_rows': len(gridview_data['rows']),
                'has_data': len(gridview_data['rows']) > 0
            }
            
            return gridview_data
            
        except Exception as e:
            logger.error(f"GridView parsing error: {str(e)}")
            logger.error(traceback.format_exc())
            return None

@app.route('/api/upload-mhtml', methods=['POST'])
def upload_mhtml():
    """處理 MHTML 檔案上傳並自動與 Buyer CSV 比對"""
    try:
        # 檢查是否有檔案
        if 'file' not in request.files:
            logger.error("No file in request")
            return jsonify({'success': False, 'error': '沒有檔案被上傳'}), 400
        
        file = request.files['file']
        new_name = request.form.get('newName', '')
        
        # 檢查檔案是否為空
        if file.filename == '':
            logger.error("Empty filename")
            return jsonify({'success': False, 'error': '沒有選擇檔案'}), 400
        
        # 檢查檔案格式
        if not allowed_file(file.filename):
            logger.error(f"Invalid file type: {file.filename}")
            return jsonify({'success': False, 'error': '不支援的檔案格式'}), 400
        
        # 生成新的唯一檔名
        if new_name:
            filename = generate_unique_filename(file.filename, new_name)
        else:
            filename = generate_unique_filename(file.filename, file.filename)
        
        logger.info(f"Processing file: {filename}")
        
        # 儲存檔案到上傳資料夾
        upload_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(upload_path)
        
        # 移動並重新命名檔案到處理資料夾
        processed_path = os.path.join(app.config['PROCESSED_FOLDER'], filename)
        
        # 如果目標檔案已存在，先刪除
        if os.path.exists(processed_path):
            os.remove(processed_path)
        
        os.rename(upload_path, processed_path)
        
        # 解析 MHTML 檔案
        parser = MHTMLParser(processed_path)
        extracted_info = parser.parse()
        
        # 檢查是否有解析錯誤
        if 'error' in extracted_info: # type: ignore
            logger.error(f"Parser error: {extracted_info['error']}") # type: ignore
            # 即使有錯誤，還是返回部分資訊
        
        # 加入檔案資訊
        file_stats = os.stat(processed_path)
        extracted_info.update({ # type: ignore
            'original_filename': file.filename,
            'saved_filename': filename,
            'file_size': file_stats.st_size,
            'upload_time': datetime.now().isoformat(),
            'file_path': processed_path
        })
        
        # 格式化檔案大小
        size = file_stats.st_size
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024.0:
                extracted_info['file_size_formatted'] = f"{size:.2f} {unit}" # type: ignore
                break
            size /= 1024.0
        
        # 如果有 GridView 資料，另外儲存為 JSON
        if 'gridview_data' in extracted_info and extracted_info['gridview_data']: # type: ignore
            json_filename = filename.rsplit('.', 1)[0] + '_gridview.json'
            json_path = os.path.join(app.config['PROCESSED_FOLDER'], json_filename)
            
            try:
                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(extracted_info['gridview_data'], f, ensure_ascii=False, indent=2) # type: ignore
                
                extracted_info['gridview_json_file'] = json_filename # type: ignore
                logger.info(f"GridView data saved to: {json_filename}")
                
                # 自動與 Buyer_detail.csv 比對
                if os.path.exists(BUYER_FILE):
                    logger.info("開始與 Buyer_detail.csv 比對...")
                    comparison_result = compare_with_buyer_csv(extracted_info['gridview_data']) # type: ignore
                    extracted_info['comparison_result'] = comparison_result # type: ignore
                else:
                    logger.warning(f"找不到 {BUYER_FILE}")
                    extracted_info['comparison_result'] = { # type: ignore
                        'error': f'找不到 {BUYER_FILE} 檔案',
                        'needs_buyer_csv': True
                    }
                    
            except Exception as e:
                logger.error(f"Failed to save GridView JSON or compare: {str(e)}")
        
        return jsonify({
            'success': True,
            'message': '檔案上傳並解析成功',
            'data': extracted_info
        })
        
    except Exception as e:
        logger.error(f"上傳錯誤: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'處理檔案時發生錯誤: {str(e)}'
        }), 500

def compare_with_buyer_csv(gridview_data):
    """與 Buyer CSV 比對 PO No. 和品名"""
    try:
        # 讀取 Buyer CSV
        try:
            buyer_df = pd.read_csv(BUYER_FILE, encoding='utf-8-sig')
        except:
            try:
                buyer_df = pd.read_csv(BUYER_FILE, encoding='utf-8')
            except:
                buyer_df = pd.read_csv(BUYER_FILE, encoding='big5')
        
        print(f"Buyer CSV columns: {list(buyer_df.columns)}")
        print(f"Buyer CSV shape: {buyer_df.shape}")
        # 清理 PO No. 欄位，移除 .0 後綴
        buyer_df['PO No.'] = buyer_df['PO No.'].apply(lambda x: str(x).replace('.0', '') if pd.notna(x) and str(x).endswith('.0') else str(x) if pd.notna(x) else '')

        # 顯示修正後的結果
        valid_pos = [po for po in buyer_df['PO No.'].tolist() if po != 'nan' and po != '']
        print(f"修正後有效 PO 數量: {len(valid_pos)}")
        print(f"修正後前10個 PO: {valid_pos[:10]}")
        
        # 解析 GridView 資料
        headers = gridview_data.get('headers', [])
        rows = gridview_data.get('rows', [])
        
        print(f"GridView rows count: {len(rows)}")
        
        # 找出關鍵欄位的索引
        po_index = -1
        desc_index = -1
        qty_index = -1
        accept_qty_index = -1
        amount_index = -1
        
        for i, header in enumerate(headers):
            header_text = header.get('en', '').lower() or header.get('zh', '').lower() or header.get('full', '').lower()
            # PO No. 欄位（避免匹配到 Demo PO號）
            if ('po' in header_text and 'no' in header_text) or 'po號碼' in header_text:
                if 'demo' not in header_text.lower():  # 排除 Demo PO號
                    po_index = i
                    print(f"Found PO index at {i}: {header}")
            elif 'description' in header_text or '品名' in header_text:
                desc_index = i
                print(f"Found Description index at {i}: {header}")
            elif 'accept' in header_text and 'qty' in header_text or '驗收數量' in header_text:
                accept_qty_index = i
            elif 'qty' in header_text or '數量' in header_text or '收貨數量' in header_text:
                if accept_qty_index == -1:
                    qty_index = i
            elif 'amount' in header_text or '總金額' in header_text:
                amount_index = i
        
        # 先提取所有 PO 號碼，檢查是否有多個不同的 PO
        po_numbers = []
        for row_idx, row in enumerate(rows):
            raw_data = row.get('raw_data', [])
            
            if po_index >= 0 and po_index < len(raw_data):
                po_no = str(raw_data[po_index].get('value', '')).strip()
                print(f"Row {row_idx} - Extracted PO: '{po_no}'")
                if po_no:  # 只記錄非空的 PO 號碼
                    po_numbers.append(po_no)
            else:
                logger.warning(f"Row {row_idx} - PO index {po_index} out of range")
        
        # 檢查 PO 號碼的唯一性
        unique_pos = list(set(po_numbers))
        print(f"發現的唯一 PO 號碼: {unique_pos}")
        
        # 添加即時檢查：檢查這些 PO 是否在 Buyer CSV 中存在
        print("=" * 60)
        print("🔍 即時檢查 PO 是否存在於 Buyer CSV 中...")
        print("=" * 60)
        
        # 獲取 Buyer CSV 中所有的 PO 號碼
        buyer_pos = buyer_df['PO No.'].astype(str).str.strip().tolist()
        print(f"📊 Buyer CSV 中總共有 {len(buyer_pos)} 筆 PO 資料")
        print(f"📊 Buyer CSV 中前10個 PO 號碼範例: {buyer_pos[:10]}")
        
        # 檢查每個提取的 PO
        found_pos = []
        missing_pos = []
        
        for po_no in unique_pos:
            if po_no in buyer_pos:
                found_pos.append(po_no)
                print(f"✅ PO {po_no} 在 Buyer CSV 中找到")
                
                # 顯示匹配的詳細資訊
                matching_rows = buyer_df[buyer_df['PO No.'].astype(str).str.strip() == po_no]
                print(f"   └─ 共找到 {len(matching_rows)} 筆匹配記錄")
                for idx, row in matching_rows.iterrows():
                    print(f"   └─ 第 {idx} 行: 品項='{row.get('Item', '')}' 或 '{row.get('品項', '')}'")
            else:
                missing_pos.append(po_no)
                print(f"❌ PO {po_no} 在 Buyer CSV 中找不到")
        
        print("=" * 60)
        print(f"📈 檢查結果統計:")
        print(f"   ✅ 找到的 PO: {len(found_pos)} 個 → {found_pos}")
        print(f"   ❌ 缺失的 PO: {len(missing_pos)} 個 → {missing_pos}")
        print("=" * 60)
        
        # 如果有缺失的 PO，進一步檢查可能的問題
        if missing_pos:
            print("🔧 進一步診斷缺失的 PO:")
            for missing_po in missing_pos:
                # 檢查是否有相似的 PO（可能是格式問題）
                similar_pos = [po for po in buyer_pos if missing_po in po or po in missing_po]
                if similar_pos:
                    print(f"   ⚠️  PO {missing_po} 找不到，但發現相似的: {similar_pos[:5]}")
                else:
                    print(f"   ❌ PO {missing_po} 完全找不到相似的")
            print("=" * 60)

        # 如果只有一個 PO 或有明顯多數，繼續原來的比對邏輯
        # 讀取 Buyer CSV
        # 建立比對結果
        comparison_items = []
        total_amount = 0
        
        # 列出第一筆資料的原始內容以除錯
        if len(rows) > 0:
            first_row = rows[0].get('raw_data', [])
            print(f"First row raw data length: {len(first_row)}")
            for i, cell in enumerate(first_row[:10]):  # 只列前10個欄位
                print(f"Cell {i}: {cell.get('value', 'NO VALUE')}")
        
        for row_idx, row in enumerate(rows):
            item = {}
            raw_data = row.get('raw_data', [])
            
            # 提取資料
            if po_index >= 0 and po_index < len(raw_data):
                item['po_no'] = str(raw_data[po_index].get('value', '')).strip()
                print(f"Row {row_idx} - Extracted PO from index {po_index}: '{item['po_no']}'")
            else:
                logger.warning(f"Row {row_idx} - PO index {po_index} out of range (row has {len(raw_data)} cells)")
                
            if desc_index >= 0 and desc_index < len(raw_data):
                item['description'] = str(raw_data[desc_index].get('value', '')).strip()
                print(f"Row {row_idx} - Extracted Description from index {desc_index}: '{item['description']}'")
                
            if qty_index >= 0 and qty_index < len(raw_data):
                item['qty'] = raw_data[qty_index].get('value', '')
                
            if accept_qty_index >= 0 and accept_qty_index < len(raw_data):
                item['accept_qty'] = raw_data[accept_qty_index].get('value', '')
            elif qty_index >= 0:
                item['accept_qty'] = item.get('qty', '0')
                
            if amount_index >= 0 and amount_index < len(raw_data):
                item['amount'] = raw_data[amount_index].get('value', '')
            
            # 計算 RT 金額和 RT 總金額
            try:
                amount_str = str(item.get('amount', '0'))
                amount_str = amount_str.replace(',', '').replace('$', '').replace('TWD', '').strip()
                amount_value = float(amount_str) if amount_str and amount_str != '-' else 0
                
                accept_qty_str = str(item.get('accept_qty', '0'))
                accept_qty_str = accept_qty_str.replace(',', '').strip()
                accept_qty_value = float(accept_qty_str) if accept_qty_str and accept_qty_str != '0' and accept_qty_str != '-' else 1
                
                item['rt_amount'] = amount_value / accept_qty_value if accept_qty_value > 0 else 0
                item['rt_total_amount'] = amount_value
                
                total_amount += amount_value
            except Exception as e:
                logger.error(f"計算 RT 金額錯誤: {str(e)}")
                item['rt_amount'] = 0
                item['rt_total_amount'] = 0
            
            # 在 Buyer CSV 中尋找匹配
            matched_in_buyer = False
            buyer_row_index = -1
            
            if item.get('po_no'):
                # 在 Buyer CSV 的 PO No. 欄位中尋找
                for idx, buyer_row in buyer_df.iterrows():
                    buyer_po = str(buyer_row.get('PO No.', '')).strip()
                    
                    if buyer_po == item['po_no']:
                        matched_in_buyer = True
                        buyer_row_index = idx
                        print(f"✓ Matched PO {item['po_no']} at Buyer CSV row {idx}")
                        logger.debug(f"所有欄位: {buyer_row.to_dict()}")
                        # 檢查品名是否也匹配
                        col_item = next((col for col in buyer_row.index if col.strip().replace(' ', '') in ['Item']), 'Item')
                        col_desc = next((col for col in buyer_row.index if col.strip().replace(' ', '') in ['品項', '品名']), '品項')

                        buyer_item = str(buyer_row.get(col_item, '')).strip()
                        buyer_desc = str(buyer_row.get(col_desc, '')).strip()
                        
                        if item.get('description'):
                            if buyer_item != item['description'] and buyer_desc != item['description']:
                                logger.warning(f"PO matched but description different: Buyer='{buyer_item}' or '{buyer_desc}', GridView='{item['description']}'")
                        break
                
                if not matched_in_buyer:
                    logger.warning(f"✗ PO {item['po_no']} not found in Buyer CSV")
            else:
                logger.warning(f"Row {row_idx} has no PO number")
            
            item['matched_in_buyer'] = matched_in_buyer
            item['buyer_row_index'] = buyer_row_index
            comparison_items.append(item)
        
        # 統計結果
        matched_count = sum(1 for item in comparison_items if item['matched_in_buyer'])
        unmatched_count = len(comparison_items) - matched_count
        
        print(f"比對結果: 總項目={len(comparison_items)}, 匹配={matched_count}, 未匹配={unmatched_count}")
        
        return {
            'items': comparison_items,
            'summary': {
                'total_items': len(comparison_items),
                'matched_count': matched_count,
                'unmatched_count': unmatched_count,
                'total_amount': total_amount,
                'buyer_csv_rows': len(buyer_df),
                'buyer_csv_columns': list(buyer_df.columns)
            }
        }
        
    except Exception as e:
        logger.error(f"比對錯誤: {str(e)}")
        logger.error(traceback.format_exc())
        return {
            'error': str(e),
            'items': [],
            'summary': {}
        }
    

    
# 在 app.py 中新增以下路由和功能

import shutil

@app.route('/api/cleanup-processed', methods=['POST'])
def cleanup_processed():
    """清理 processed 資料夾中的所有文件"""
    try:
        processed_folder = app.config['PROCESSED_FOLDER']
        upload_folder = app.config['UPLOAD_FOLDER']
        
        total_files_removed = 0
        
        # 清理 processed 資料夾
        if os.path.exists(processed_folder):
            files_before = os.listdir(processed_folder)
            if files_before:
                for filename in files_before:
                    file_path = os.path.join(processed_folder, filename)
                    try:
                        if os.path.isfile(file_path) or os.path.islink(file_path):
                            os.unlink(file_path)
                            total_files_removed += 1
                            logger.info(f"已刪除 processed 文件: {filename}")
                        elif os.path.isdir(file_path):
                            shutil.rmtree(file_path)
                            total_files_removed += 1
                            logger.info(f"已刪除 processed 目錄: {filename}")
                    except Exception as e:
                        logger.error(f"無法刪除 processed 文件 {file_path}: {str(e)}")
        
        # 同時清理 upload 資料夾（預防措施）
        if os.path.exists(upload_folder):
            upload_files = os.listdir(upload_folder)
            if upload_files:
                for filename in upload_files:
                    file_path = os.path.join(upload_folder, filename)
                    try:
                        if os.path.isfile(file_path) or os.path.islink(file_path):
                            os.unlink(file_path)
                            total_files_removed += 1
                            logger.info(f"已刪除 upload 文件: {filename}")
                        elif os.path.isdir(file_path):
                            shutil.rmtree(file_path)
                            total_files_removed += 1
                            logger.info(f"已刪除 upload 目錄: {filename}")
                    except Exception as e:
                        logger.error(f"無法刪除 upload 文件 {file_path}: {str(e)}")
        
        # 驗證清理結果
        processed_files_after = os.listdir(processed_folder) if os.path.exists(processed_folder) else []
        upload_files_after = os.listdir(upload_folder) if os.path.exists(upload_folder) else []
        
        logger.info(f"清理完成: 刪除了 {total_files_removed} 個文件")
        
        return jsonify({
            'success': True,
            'message': f'成功清理 {total_files_removed} 個文件',
            'files_removed': total_files_removed,
            'remaining_processed_files': len(processed_files_after),
            'remaining_upload_files': len(upload_files_after)
        })
        
    except Exception as e:
        logger.error(f"清理資料夾錯誤: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'清理失敗: {str(e)}'
        }), 500

# 修改現有的 update_buyer_csv 函數，在成功更新後自動觸發清理
@app.route('/api/update-buyer-csv', methods=['POST'])
def update_buyer_csv():
    # 備份
    # backup_files()
    """更新 Buyer CSV 檔案中的 RT 金額"""
    try:
        data = request.json
        items_to_update = data.get('items', []) # type: ignore
        
        if not items_to_update:
            return jsonify({'success': False, 'error': '沒有要更新的項目'}), 400
        
        logger.info(f"準備更新 {len(items_to_update)} 筆資料")
        
        # 讀取 Buyer CSV
        try:
            buyer_df = pd.read_csv(BUYER_FILE, encoding='utf-8-sig', dtype=str)
        except:
            try:
                buyer_df = pd.read_csv(BUYER_FILE, encoding='utf-8', dtype=str)
            except:
                buyer_df = pd.read_csv(BUYER_FILE, encoding='big5', dtype=str)
        
        logger.info(f"Buyer CSV 原始欄位: {list(buyer_df.columns)}")
        
        # 確保有 RT 相關欄位
        if 'RT金額' not in buyer_df.columns:
            buyer_df['RT金額'] = ''
            logger.info("新增 RT金額 欄位")
        if 'RT總金額' not in buyer_df.columns:
            buyer_df['RT總金額'] = ''
            logger.info("新增 RT總金額 欄位")
        
        updated_count = 0
        
        # 更新每個項目
        for item in items_to_update:
            print(items_to_update)
            po_no = str(item.get('po_no', '')).strip()
            description = str(item.get('description', '')).strip()
            
            # 將金額轉換為整數字串（移除小數點）
            rt_amount = item.get('rt_amount', 0)
            rt_total_amount = item.get('rt_total_amount', 0)
            
            try:
                rt_amount_str = str(int(round(float(rt_amount))))
                rt_total_amount_str = str(int(round(float(rt_total_amount))))
            except:
                rt_amount_str = '0'
                rt_total_amount_str = '0'
            
            logger.info(f"嘗試更新: PO={po_no}, 品名={description}, RT金額={rt_amount_str}, RT總金額={rt_total_amount_str}")
            
            if po_no:
                mask_po = buyer_df['PO No.'].astype(str).str.strip() == po_no

                if '品項' in buyer_df.columns:
                    mask_desc = buyer_df['品項'].astype(str).str.strip() == description
                    mask_both = mask_po & mask_desc
                else:
                    mask_desc = pd.Series([False] * len(buyer_df))
                    mask_both = mask_po  # fallback

                if mask_both.sum() > 0:
                    buyer_df.loc[mask_both, 'RT金額'] = rt_amount_str
                    buyer_df.loc[mask_both, 'RT總金額'] = rt_total_amount_str
                    updated_count += mask_both.sum()
                    print(f"✓ 完整匹配 PO={po_no}, 品項={description} → 成功更新")
                elif mask_po.sum() > 0:
                    buyer_df.loc[mask_po, 'RT金額'] = rt_amount_str
                    buyer_df.loc[mask_po, 'RT總金額'] = rt_total_amount_str
                    updated_count += mask_po.sum()
                    logger.warning(f"⚠️ PO={po_no} 在 Buyer CSV 中有 {mask_po.sum()} 筆，但品項不同 (GridView: {description}, Buyer: {buyer_df.loc[mask_po, '品項'].unique().tolist()})，仍強制更新 RT 金額")
                else:
                    logger.warning(f"✗ 在 Buyer CSV 中找不到 PO {po_no}")
        
        # 儲存更新後的 CSV
        if updated_count > 0:
            try:
                buyer_df.to_csv(BUYER_FILE, index=False, encoding='utf-8-sig', na_rep='')
                print(f"成功儲存更新後的 Buyer CSV，共更新 {updated_count} 筆資料")
                
                # 驗證更新是否成功
                verify_df = pd.read_csv(BUYER_FILE, encoding='utf-8-sig', dtype=str)
                print(f"驗證: 更新後的 CSV 有 {len(verify_df)} 筆資料")
                
                # 檢查特定 PO 的更新結果
                for item in items_to_update[:3]:
                    po_no = str(item.get('po_no', '')).strip()
                    if po_no:
                        verify_rows = verify_df[verify_df['PO No.'].astype(str).str.strip() == po_no]
                        if len(verify_rows) > 0:
                            print(f"驗證 PO {po_no}：共有 {len(verify_rows)} 筆資料")
                            for idx, row in verify_rows.iterrows():
                                print(f"- 品項={row.get('品項', '')}, RT金額={row.get('RT金額', '')}, RT總金額={row.get('RT總金額', '')}")
                                
                return jsonify({
                    'success': True,
                    'message': f'成功更新 {int(updated_count)} 筆資料',
                    'updated_count': int(updated_count),
                    'total_items': int(len(items_to_update)),
                    'should_cleanup': True,  # 確保添加標記告訴前端需要清理
                    'cleanup_required': True  # 額外的清理標記
                })
                
            except Exception as e:
                logger.error(f"儲存 CSV 失敗: {str(e)}")
                return jsonify({
                    'success': False,
                    'error': f'儲存檔案失敗: {str(e)}'
                }), 500
        else:
            # 提供更詳細的錯誤資訊
            logger.warning("沒有任何資料被更新")
            
            # 統計各種情況
            empty_po_count = sum(1 for item in items_to_update if not str(item.get('po_no', '')).strip())
            valid_po_count = len(items_to_update) - empty_po_count
            
            error_details = {
                'total_items': len(items_to_update),
                'valid_po_count': valid_po_count,
                'empty_po_count': empty_po_count,
                'updated_count': 0
            }
            
            if empty_po_count > 0:
                error_message = f'共 {len(items_to_update)} 筆資料中有 {empty_po_count} 筆缺少 PO 號碼，{valid_po_count} 筆在 Buyer CSV 中找不到匹配項目'
            else:
                error_message = f'在 Buyer CSV 中找不到任何匹配的 PO 號碼 (共檢查 {len(items_to_update)} 筆)'
            
            return jsonify({
                'success': False,
                'message': error_message,
                'error': '後台查無此資料，請檢查 PO 號碼是否正確',
                'details': error_details,
                'updated_count': 0
            })
        
    except Exception as e:
        logger.error(f"更新 Buyer CSV 錯誤: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500





from flask import Flask, send_file, jsonify, Response
from io import BytesIO
import tempfile



# eRT 功能
# 1.py
@app.route('/api/get_unaccounted_amount', methods=['GET'])
def get_unaccounted_amount():
    """
    統計尚未入帳的金額 (以今天日期為基準)
    條件：
    1. 有承諾交期
    2. 承諾交期 <= 今天
    3. 發票月份為空
    4. 移除 WBS
    """
    import datetime
    file_path = BUYER_FILE
    if not os.path.exists(file_path):
        return {"file": file_path, "unaccounted_amount": 0, "rows": []}

    try:
        df = pd.read_csv(file_path, encoding="utf-8-sig", dtype=str).fillna("")

        # 日期處理
        today = datetime.datetime.now().strftime("%Y%m%d")

        def clean_date(val):
            val = str(val).strip().replace("/", "").replace("-", "")
            return val if val.isdigit() and len(val) == 8 else ""

        df["交期_clean"] = df["Delivery Date 廠商承諾交期"].apply(clean_date)
        df["發票月份"] = df["發票月份"].astype(str).str.strip()

        # 過濾條件
        mask = (
            (df["交期_clean"] != "") &
            (df["交期_clean"] <= today) &
            (df["發票月份"] == "") & 
            (df["WBS"] == "")
        )
        filtered = df[mask].copy()

        # 處理金額：優先用「總價」，若沒有就用 數量*單價
        def calc_amount(row):
            try:
                if row.get("RT總金額") and str(row["RT總金額"]).strip():
                    return float(str(row["RT總金額"]).replace(",", "").replace("$", "").strip())
                elif row.get("總價") and str(row["總價"]).strip():
                    return float(str(row["總價"]).replace(",", "").replace("$", "").strip())
                else:
                    qty = float(str(row.get("數量", "0")).replace(",", "").strip() or 0)
                    price = float(str(row.get("單價", "0")).replace(",", "").strip() or 0)
                    return qty * price
            except:
                return 0.0

        filtered["金額"] = filtered.apply(calc_amount, axis=1)
        total_amount = round(filtered["金額"].sum(), 2)

        rows = []
        for _, row in filtered.iterrows():
            rows.append({
                "ePR No.": row.get("ePR No.", ""),
                "PO No.": row.get("PO No.", ""),
                "Item": row.get("Item", ""),
                "品項": row.get("品項", ""),
                "總價": str(row.get("總價", "")),
                "RT總金額": str(row.get("RT總金額", "")),
                "承諾交期": row.get("Delivery Date 廠商承諾交期", ""),
                "發票月份": row.get("發票月份", ""),
                "計算金額": row["金額"]  # 改成這樣
            })

        # print(f"{'PO No.':<12}{'Item':<8}{'品項':<30}{'交期':<12}{'SOD Qty':<10}{'總價':<12}")
        # # 印出每一行
        # for r in rows:
        #     print(f"{r['PO No.']:<12}{r['Item']:<8}{r['品項']:<30}{r['Delivery Date 廠商承諾交期']:<12}{r['SOD Qty 廠商承諾數量']:<10}{r['總價']:<12,.0f}")
        # print(total_amount)
        return jsonify({
            "unaccounted_amount": int(total_amount),
            "rows": rows
        })
    
    except Exception as e:
        return {"file": file_path, "error": str(e)}
    

# 3.py
@app.route("/api/accounting_summary", methods=["GET"])
def get_accounting_summary():
    from datetime import datetime
    import numpy as np
    
    # 讀取CSV檔案
    df = pd.read_csv(BUYER_FILE, encoding='utf-8-sig', dtype='str')

    # 篩選條件：ePR No、PO No、需求日都不為空值
    filtered_df = df[
        (df['ePR No.'].notna()) & 
        (df['PO No.'].notna()) & 
        (df['需求日'].notna()) &
        (df['ePR No.'] != '') & 
        (df['PO No.'] != '') & 
        (df['需求日'] != '')
    ]

    def filter_for_accounting(df, target_month, target_year=2025):
        """
        篩選未入帳資料 - 正確邏輯
        如果發票月份和承諾交期在同個月份 → 已入帳，直接忽略
        """
        # 建立目標月份的最後一天
        if target_month == 12:
            target_date_end = datetime(target_year + 1, 1, 1)
        else:
            target_date_end = datetime(target_year, target_month + 1, 1)
        
        # 複製資料避免修改原始資料
        accounting_df = df.copy()
        
        # 解析日期
        accounting_df['承諾交期_日期'] = pd.to_datetime(accounting_df['Delivery Date 廠商承諾交期'], errors='coerce', format='mixed')
        accounting_df['發票月份_日期'] = pd.to_datetime(accounting_df['發票月份'], errors='coerce', format='mixed')
        
        # 處理數字格式的需求日 (如 20250523)
        def parse_numeric_date(val):
            if pd.isna(val):
                return pd.NaT
            try:
                val_str = str(int(float(val)))
                if len(val_str) == 8:
                    year = int(val_str[:4])
                    month = int(val_str[4:6])
                    day = int(val_str[6:8])
                    return pd.Timestamp(year, month, day)
            except:
                pass
            return pd.NaT
        
        accounting_df['需求日_日期'] = accounting_df['需求日'].apply(parse_numeric_date)
        
        # 0. 時間回推邏輯：排除在目標月份或之前已開發票的資料
        target_date_start = datetime(target_year, target_month, 1)
        if target_month == 12:
            target_date_end = datetime(target_year + 1, 1, 1)
        else:
            target_date_end = datetime(target_year, target_month + 1, 1)
        
        # 排除已入帳的資料：發票日期在目標月份或之前的
        already_paid_mask = (
            accounting_df['發票月份_日期'].notna() & 
            (accounting_df['發票月份_日期'] < target_date_end)
        )
        
        # 排除已入帳的資料
        accounting_df = accounting_df[~already_paid_mask]
        
        # 1. EPR No. 和 PO No. 必須有值
        condition1 = (accounting_df['ePR No.'].notna()) & (accounting_df['PO No.'].notna()) & \
                    (accounting_df['ePR No.'] != '') & (accounting_df['PO No.'] != '')
        
        # 2. 扣除 WBS 欄位有值的資料（WBS 必須為空）
        condition2 = accounting_df['WBS'].isna() | (accounting_df['WBS'] == '')
        
        # 3. 承諾交期必須有值且在當月或之前
        # condition3 = accounting_df['承諾交期_日期'].notna() & (accounting_df['承諾交期_日期'] < target_date_end)
        condition3 = (
            accounting_df['承諾交期_日期'].notna() &
            (accounting_df['承諾交期_日期'] >= target_date_start) &
            (accounting_df['承諾交期_日期'] < target_date_end)
        )
        # # 4. 需求日必須在當月之前  
        # condition4 = accounting_df['需求日_日期'] < target_date_start
        
        # 套用所有條件
        # final_condition = condition1 & condition2 & condition3 & condition4
        final_condition = condition1 & condition2 & condition3 
        result_df = accounting_df[final_condition]
        
        # 計算金額 (RT總金額優先，空的就用總價)
        result_df = result_df.copy()
        result_df['最終金額_數值'] = np.where(
            result_df['RT總金額'].notna() & (result_df['RT總金額'].astype(str).str.strip() != ''),
            result_df['RT總金額'],
            result_df['總價']
        )
        result_df['最終金額_數值'] = pd.to_numeric(
            result_df['最終金額_數值'].astype(str).str.replace(',', '').str.replace('$', ''), 
            errors='coerce'
        )
        total_amount = result_df['最終金額_數值'].sum()
        
        # 準備詳細資料行列表
        detailed_rows = []
        for _, row in result_df.iterrows():
            # Convert numpy types to native Python types
            amount = row.get("最終金額_數值", 0)
            if pd.isna(amount):
                amount = 0
            elif isinstance(amount, (int, np.integer)):
                amount = int(amount)
            elif isinstance(amount, (float, np.floating)):
                amount = float(amount)
                
            detailed_rows.append({
                "ePR No.": str(row.get("ePR No.", "")),
                "PO No.": str(row.get("PO No.", "")),
                "品項": str(row.get("品項", "")),
                "總價": str(row.get("總價", "")),
                "RT總金額": str(row.get("RT總金額", "")),
                "承諾交期": str(row.get("Delivery Date 廠商承諾交期", "")),
                "需求日": str(row.get("需求日", "")),
                "發票月份": str(row.get("發票月份", "")),
                "WBS": str(row.get("WBS", "")),
                "計算金額": amount
            })
        
        # Convert numpy/pandas types to native Python types
        total_amount_py = int(total_amount) if not pd.isna(total_amount) else 0
        
        return {
            "result_df": result_df,
            "total_amount": total_amount_py,
            "detailed_rows": detailed_rows,
            "conditions": {
                "condition1_count": int(condition1.sum()),
                "condition2_count": int(condition2.sum()), 
                "condition3_count": int(condition3.sum()),
                # "condition4_count": int(condition4.sum()),
                "already_paid_count": int(already_paid_mask.sum()),
                "final_condition_count": int(final_condition.sum())
            },
            "date_ranges": {
                "target_date_start": target_date_start.isoformat(),
                "target_date_end": target_date_end.isoformat(),
                "target_year": int(target_year),
                "target_month": int(target_month)
            }
        }

    # 獲取資料中所有可能的年月份 (只到當前月份)
    def get_all_year_months(df):
        current_date = datetime.now()
        current_year = current_date.year
        current_month = current_date.month
        
        all_dates = []
        all_dates.extend(pd.to_datetime(df['Delivery Date 廠商承諾交期'], errors='coerce').dropna())
        all_dates.extend(pd.to_datetime(df['需求日'], errors='coerce').dropna())
        all_dates.extend(pd.to_datetime(df['發票月份'], errors='coerce').dropna())
        
        year_months = set()
        for date in all_dates:
            year, month = date.year, date.month
            if (year < current_year) or (year == current_year and month <= current_month):
                year_months.add((year, month))
        return sorted(list(year_months))

    # 計算所有月份
    all_year_months = get_all_year_months(filtered_df)
    json_summary = {}
    detailed_data = {}
    all_conditions = {}
    all_date_ranges = {}

    for year, month in all_year_months:
        result_data = filter_for_accounting(df, month, year)
        year_month_key = f"{year}年{month}月"
        
        json_summary[year_month_key] = result_data["total_amount"]
        detailed_data[year_month_key] = result_data["detailed_rows"]
        all_conditions[year_month_key] = result_data["conditions"]
        all_date_ranges[year_month_key] = result_data["date_ranges"]
    
    # Convert all year_months tuples to native Python types
    all_year_months_py = [(int(year), int(month)) for year, month in all_year_months]
    
    # 回傳所有物件
    return jsonify({
        "summary": json_summary,
        "detailed_data": detailed_data,
        "conditions": all_conditions,
        "date_ranges": all_date_ranges,
        "meta": {
            "total_months": len(all_year_months),
            "all_year_months": all_year_months_py,
            "original_df_count": int(len(df)),
            "filtered_df_count": int(len(filtered_df)),
            "csv_path": str(BUYER_FILE)
        }
    })


# 2_4.py
@app.route("/api/monthly_actual_accounting", methods=["GET"])
def get_monthly_actual_accounting():
    import datetime
    # 讀取CSV檔案
    df = pd.read_csv(BUYER_FILE, encoding='utf-8-sig', dtype='str')

    # 篩選條件：ePR No、PO No、需求日都不為空值
    filtered_df = df[
        (df['ePR No.'].notna()) & 
        (df['PO No.'].notna()) & 
        (df['需求日'].notna()) &
        (df['ePR No.'] != '') & 
        (df['PO No.'] != '') & 
        (df['需求日'] != '')
    ].copy()

    def calculate_monthly_actual_accounting(df):
        """
        計算每月實際入帳金額
        條件：
        1. ePR No. 和 PO No. 必須有值
        2. 不包含WBS (WBS必須為空)
        3. 發票月份不為空 (有發票才算入帳)
        """
        accounting_df = df.copy()

        # 1. EPR No. 和 PO No. 必須有值
        condition1 = (
            accounting_df['ePR No.'].notna() &
            accounting_df['PO No.'].notna() &
            (accounting_df['ePR No.'] != '') &
            (accounting_df['PO No.'] != '')
        )

        # 2. 不含WBS (WBS 必須為空)
        condition2 = accounting_df['WBS'].isna() | (accounting_df['WBS'] == '')

        # 3. 發票月份不為空
        accounting_df['發票月份_日期'] = pd.to_datetime(accounting_df['發票月份'], errors='coerce', format='mixed')
        condition3 = accounting_df['發票月份_日期'].notna()

        # 套用所有條件
        final_condition = condition1 & condition2 & condition3
        result_df = accounting_df[final_condition].copy()

        # 加入發票年月欄位 (格式: YYYY-MM)
        result_df['發票年月'] = result_df['發票月份_日期'].dt.to_period('M').astype(str)

        # 轉換 RT總金額 為數值
        result_df['RT總金額_數值'] = pd.to_numeric(
            result_df['RT總金額'].astype(str).str.replace(',', '').str.replace('$', ''),
            errors='coerce'
        )

        return result_df

    # ==== 執行計算 ====
    actual_accounting_df = calculate_monthly_actual_accounting(filtered_df)

    if len(actual_accounting_df) == 0:
        return jsonify({
            "本月": {"amount": 0, "details": []},
            "上月": {"amount": 0, "details": []}
        })

    # ==== 準備詳細資料 ====
    # 只取需要的欄位
    detail_columns = [
        'ePR No.', 'PO No.', '品項', '總價', 'RT總金額',
        'Delivery Date 廠商承諾交期', '需求日', '發票月份', 'WBS'
    ]

    # 按「發票年月」分組
    monthly_details = {}
    for period, group in actual_accounting_df.groupby('發票年月'):
        amount = group['RT總金額_數值'].sum()
        details = []
        for _, row in group.iterrows():
            # 轉換金額為整數
            rt_amount_val = row['RT總金額_數值']
            rt_amount = int(rt_amount_val) if pd.notna(rt_amount_val) else 0

            detail = {col: str(row[col]) if pd.notna(row[col]) else "" for col in detail_columns}
            detail["計算金額"] = str(rt_amount)
            details.append(detail)

        monthly_details[period] = {
            "amount": int(amount),
            "details": details
        }

    # ==== 取得本月與上月 key (YYYY-MM) ====
    now = datetime.datetime.now()
    this_month_str = f"{now.year}-{now.month:02d}"
    last_month = now.month - 1 if now.month > 1 else 12
    last_year = now.year if now.month > 1 else now.year - 1
    last_month_str = f"{last_year}-{last_month:02d}"

    # 取得資料，若無則回傳預設
    this_data = monthly_details.get(this_month_str, {"amount": 0, "details": []})
    last_data = monthly_details.get(last_month_str, {"amount": 0, "details": []})

    # ==== 回傳結果 ====
    return jsonify({
        "本月": this_data,
        "上月": last_data
    })


# 5.py
@app.route('/api/next_month_amount', methods=['GET'])
def get_next_month_amount():
    """
    計算下個月的承諾交期總金額
    
    篩選條件：
    1. 有承諾交期
    2. 承諾交期落在「下個月」
    3. 發票月份為空
    4. WBS 為空
    5. 優先用 RT總金額，否則用 總價
    """
    from datetime import date, timedelta 
    try:
        file_path = BUYER_FILE
        
        print(f"📂 開始處理下個月預計入帳...")
        print(f"📂 檔案路徑: {file_path}")
        
        if not os.path.exists(file_path):
            print(f"❌ 檔案不存在: {file_path}")
            return jsonify({
                "file": file_path, 
                "next_month_amount": 0, 
                "rows": [],
                "error": "檔案不存在"
            }), 404

        # 讀取 CSV
        df = pd.read_csv(file_path, encoding="utf-8-sig", dtype=str).fillna("")
        print(f"✅ 成功讀取 CSV，共 {len(df)} 筆資料")

        # 金額欄位清理（去掉千分位逗號）
        def clean_amount(series):
            return (
                series.astype(str)
                .str.replace(",", "", regex=False)
                .str.strip()
                .replace("", "0")
            )

        # 處理 RT總金額
        if "RT總金額" in df.columns:
            df["RT總金額"] = pd.to_numeric(clean_amount(df["RT總金額"]), errors="coerce").fillna(0)
        else:
            logger.info("⚠️ 找不到 RT總金額 欄位")
            df["RT總金額"] = 0

        # 處理 總價
        if "總價" in df.columns:
            df["總價"] = pd.to_numeric(clean_amount(df["總價"]), errors="coerce").fillna(0)
        else:
            logger.info("⚠️ 找不到 總價 欄位")
            df["總價"] = 0

        # 優先用 RT總金額
        df["計算金額"] = df["RT總金額"].where(df["RT總金額"] > 0, df["總價"])
        logger.info("✅ 計算金額欄位已建立")

        # 日期清理
        def clean_date(val):
            val = str(val).strip().replace("/", "").replace("-", "")
            return val if val.isdigit() and len(val) == 8 else ""

        df["交期_clean"] = df["Delivery Date 廠商承諾交期"].apply(clean_date)

        # ⭐ 取得下個月區間（修正版）
        today = date.today()  # 改用 date.today()
        
        # 計算下個月第一天
        first_day_next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
        
        # 計算下個月最後一天
        last_day_next_month = (first_day_next_month.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)

        start = int(first_day_next_month.strftime("%Y%m%d"))
        end = int(last_day_next_month.strftime("%Y%m%d"))

        logger.info(f"📅 下個月日期範圍: {first_day_next_month} ~ {last_day_next_month}")
        logger.info(f"🔢 整數格式: {start} ~ {end}")

        # 篩選符合條件
        df["交期_int"] = pd.to_numeric(df["交期_clean"], errors="coerce")

        next_month_df = df[
            (df["交期_int"] >= start) & 
            (df["交期_int"] <= end) & 
            (df["發票月份"].astype(str).str.strip() == "") &
            (df["WBS"].astype(str).str.strip() == "")
        ].copy()

        logger.info(f"✅ 符合條件的資料共 {len(next_month_df)} 筆")

        # 計算總額
        next_month_df["計算金額"] = next_month_df["計算金額"].astype(int)
        total_amount = int(next_month_df["計算金額"].sum())

        logger.info(f"💰 下個月預計入帳總金額: {total_amount:,} 元")

        # 準備輸出資料
        cols = ["ePR No.", "PO No.", "品項", "計算金額", "Delivery Date 廠商承諾交期", "WBS"]
        output_rows = next_month_df[cols].to_dict(orient="records")

        # 確保計算金額為整數
        for row in output_rows:
            row["計算金額"] = int(row["計算金額"])

        result = {
            "file": file_path,
            "next_month_amount": total_amount,
            "rows": output_rows,
            "count": len(output_rows),
            "date_range": {
                "start": first_day_next_month.strftime("%Y/%m/%d"),
                "end": last_day_next_month.strftime("%Y/%m/%d")
            }
        }
        
        logger.info(f"✅ API 執行成功")
        return jsonify(result)

    except Exception as e:
        import traceback
        error_msg = str(e)
        error_trace = traceback.format_exc()
        
        logger.info(f"❌ 計算下個月預計入帳失敗: {error_msg}")
        logger.info(f"❌ 詳細錯誤：")
        logger.info(error_trace)
        
        return jsonify({
            "file": file_path if 'file_path' in locals() else "unknown",
            "error": error_msg, 
            "next_month_amount": 0, 
            "rows": [],
            "count": 0
        }), 500



# 驗收區塊
import re
import json
import traceback
import logging
import quopri
from urllib.parse import unquote
import pandas as pd
import os
from acceptanceWeb.parse import accMHTMLParser
from MailFunction.acceptanceMail import send_mail


def normalize_name(name):
    """標準化姓名，處理特殊字符問題"""
    if not name or pd.isna(name):
        return name
    
    name_str = str(name).strip()
    
    # 將 郭任? 改為 郭任群
    if name_str.startswith('郭任') and len(name_str) == 3:
        # 如果第三個字是問號或其他特殊字符，統一改為群
        if name_str[2] not in ['群']:  # 如果不是群字，就改為群
            logger.info(f"姓名修正: '{name_str}' -> '郭任群'")
            return '郭任群'
    
    return name_str

def query_user_by_po_no(po_no):
    """根據 PO No. 查詢需求者"""
    try:
        planned_purchase_df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        planned_purchase_df.fillna("", inplace=True)

        # 轉換 po_no 為字串進行比較
        po_no_str = str(po_no).strip()
        logger.info(f"查詢需求者，PO No: '{po_no_str}'")
        
        # 檢查 CSV 中的欄位名稱
        logger.info(f"Planned_Purchase CSV 欄位: {list(planned_purchase_df.columns)}")
        
        # 嘗試不同的欄位名稱匹配
        po_column = None
        user_column = None
        
        for col in planned_purchase_df.columns:
            if 'PO' in col and 'No' in col:
                po_column = col
            if '需求者' in col:
                user_column = col
        
        if po_column is None or user_column is None:
            logger.warning(f"找不到對應欄位 - PO欄位: {po_column}, 需求者欄位: {user_column}")
            return None
        
        # 清理和轉換 PO No. 欄位
        planned_purchase_df[po_column] = planned_purchase_df[po_column].astype(str).str.strip()
        
        # 查詢資料
        result = planned_purchase_df[planned_purchase_df[po_column] == po_no_str]
        
        logger.info(f"查詢結果數量: {len(result)}")
        
        if not result.empty:
            user = result.iloc[0][user_column]
            # 標準化姓名
            normalized_user = normalize_name(user)
            logger.info(f"找到 PO {po_no} 的需求者: {user} -> {normalized_user}")
            return normalized_user
        else:
            # 如果精確匹配失敗，嘗試部分匹配
            logger.info(f"精確匹配失敗，嘗試部分匹配...")
            partial_result = planned_purchase_df[planned_purchase_df[po_column].str.contains(po_no_str, na=False)]
            if not partial_result.empty:
                user = partial_result.iloc[0][user_column]
                normalized_user = normalize_name(user)
                logger.info(f"部分匹配找到 PO {po_no} 的需求者: {user} -> {normalized_user}")
                return normalized_user
            
            # 顯示前幾筆資料供除錯
            logger.info(f"前5筆 PO No. 資料: {planned_purchase_df[po_column].head().tolist()}")
            
    except Exception as e:
        logger.error(f"查詢需求者時發生錯誤 (PO: {po_no}): {str(e)}")
        logger.error(traceback.format_exc())
    
    return None

def query_epr_no_by_po_no(po_no):
    """根據 PO No. 查詢 ePR No. - 主要從 Buyer_detail.csv 查詢"""
    try:
        po_no_str = str(po_no).strip()
        logger.info(f"查詢 ePR No.，PO No: '{po_no_str}'")
        
        # 主要從 Buyer_detail.csv 查詢（這裡有完整的資料）
        buyer_detail_df = pd.read_csv(BUYER_FILE, encoding="utf-8-sig", dtype=str)
        if buyer_detail_df is not None:
            logger.info(f"從 Buyer_detail 查詢 (共 {len(buyer_detail_df)} 筆資料)")
            
            po_column = 'PO No.'
            epr_column = 'ePR No.'
            
            if po_column in buyer_detail_df.columns and epr_column in buyer_detail_df.columns:
                # 處理浮點數格式的 PO No.
                # 將查詢的 PO No. 轉換為數字進行比較
                try:
                    po_no_numeric = po_no_str
                    logger.info(f"將 PO No. 轉換為數字: {po_no_numeric}")
                    
                    # 查找匹配的記錄 - 使用數字比較
                    result = buyer_detail_df[
                        (buyer_detail_df[po_column].notna()) &  # 不是空值
                        (buyer_detail_df[po_column] == po_no_numeric)  # 數字匹配
                    ]
                    
                    logger.info(f"數字匹配查詢到 {len(result)} 筆結果")
                    
                    if not result.empty:
                        epr_no = result.iloc[0][epr_column]
                        logger.info(f"找到的 ePR No. 原始值: '{epr_no}', 類型: {type(epr_no)}")
                        
                        if pd.notna(epr_no) and str(epr_no).strip() not in ['', 'nan', 'NaN']:
                            try:
                                # 轉換 ePR No. 為整數字串
                                if isinstance(epr_no, (int, float)):
                                    epr_result = str(int(epr_no))
                                else:
                                    epr_result = str(epr_no).strip()
                                
                                logger.info(f"✓ 在 Buyer_detail 找到 PO {po_no} 的 ePR No.: {epr_result}")
                                return epr_result
                            except (ValueError, TypeError) as e:
                                logger.error(f"ePR No. 轉換失敗: {e}")
                                epr_result = str(epr_no).strip()
                                logger.info(f"✓ 使用原始字串格式 ePR No.: {epr_result}")
                                return epr_result
                        else:
                            logger.warning(f"Buyer_detail 中找到記錄但 ePR No. 為空: '{epr_no}'")
                    else:
                        logger.warning(f"在 Buyer_detail 中未找到 PO {po_no}")
                        # 顯示可用的 PO No. 供對比
                        valid_pos = buyer_detail_df[buyer_detail_df[po_column].notna()][po_column].head(10).tolist()
                        logger.info(f"Buyer_detail 中的有效 PO No. 樣本: {valid_pos}")
                        
                except ValueError as e:
                    logger.error(f"PO No. 轉換為數字失敗: {e}")
                    return None
            else:
                logger.error(f"Buyer_detail 找不到必要欄位 - PO欄位: {po_column}, ePR欄位: {epr_column}")
        else:
            logger.error("Buyer_detail.csv 未載入！")
        
        # 如果 Buyer_detail 找不到，才嘗試 Planned_Purchase（備用）
        logger.info("Buyer_detail 查詢失敗，嘗試 Planned_Purchase 作為備用")
        planned_purchase_df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        if planned_purchase_df is not None:
            logger.info(f"從 Planned_Purchase 查詢 (共 {len(planned_purchase_df)} 筆資料)")
            
            po_column = 'PO No.'
            epr_column = 'ePR No.'
            
            if po_column in planned_purchase_df.columns and epr_column in planned_purchase_df.columns:
                try:
                    po_no_numeric = po_no_str
                    result = planned_purchase_df[
                        (planned_purchase_df[po_column].notna()) &
                        (planned_purchase_df[po_column] == po_no_numeric)
                    ]
                    
                    if not result.empty:
                        epr_no = result.iloc[0][epr_column]
                        if pd.notna(epr_no) and str(epr_no).strip() not in ['', 'nan', 'NaN']:
                            epr_result = str(int(float(epr_no))) if isinstance(epr_no, (int, float)) else str(epr_no).strip()
                            logger.info(f"✓ 在 Planned_Purchase 找到 PO {po_no} 的 ePR No.: {epr_result}")
                            return epr_result
                except ValueError:
                    pass
                
    except Exception as e:
        logger.error(f"查詢 ePR No. 時發生錯誤 (PO: {po_no}): {str(e)}")
        logger.error(traceback.format_exc())
    
    logger.error(f"✗ 最終未找到 PO {po_no} 的 ePR No.")
    return None



@app.route('/api/parse-mhtml', methods=['POST'])
def parse_mhtml():
    """處理 MHTML 文件上傳和解析"""
    try:
        # 檢查是否有檔案
        if 'file' not in request.files:
            return jsonify({'error': '沒有上傳檔案'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': '沒有選擇檔案'}), 400
        
        # 檢查檔案格式
        if not file.filename.lower().endswith(('.mhtml', '.mht')): # type: ignore
            return jsonify({'error': '檔案格式不正確，請上傳 MHTML 格式檔案'}), 400
        
        # 讀取檔案內容
        file_content = file.read().decode('utf-8', errors='ignore')
        
        logger.info(f"收到檔案: {file.filename}, 大小: {len(file_content)} 字元")
        
        # 創建解析器並解析檔案
        parser = accMHTMLParser()
        parsed_data = parser.parse_mhtml_file(file_content)
        
        # 輸出解析結果到後台日誌
        logger.info("=" * 50)
        logger.info("解析結果:")
        logger.info(f"檔案名稱: {file.filename}")
        logger.info(f"解析筆數: {len(parsed_data)}")
        logger.info("-" * 30)
        
        for i, item in enumerate(parsed_data, 1):
            logger.info(f"第 {i} 筆:")
            logger.info(f"  RT No: {item.get('rtNo')}")
            logger.info(f"  項次: {item.get('itemNo')}")
            logger.info(f"  PO No: {item.get('poNo')}")
            logger.info(f"  科目指派: {item.get('itemAssign')} - {item.get('itemAssignName')}")
            logger.info(f"  品名: {item.get('description')}")
            logger.info(f"  數量: {item.get('quantity')}")
            logger.info(f"  取件者: {item.get('pickupPerson')}")
            logger.info("-" * 30)
        
        logger.info("=" * 50)
        
        # 返回解析結果
        return jsonify({
            'success': True,
            'filename': file.filename,
            'count': len(parsed_data),
            'data': parsed_data
        })
        
    except Exception as e:
        error_msg = str(e)
        logger.error(f"處理請求時發生錯誤: {error_msg}")
        logger.error(traceback.format_exc())
        return jsonify({'error': error_msg}), 500

@app.route('/api/get-user-epr-data', methods=['POST'])
def get_user_epr_data():
    """根據PO號碼查詢對應的User和ePR No."""
    try:
        data = request.get_json()
        po_numbers = data.get('poNumbers', [])

        planned_purchase_df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        buyer_detail_df = pd.read_csv(BUYER_FILE, encoding="utf-8-sig", dtype=str)
        logger.info(f"收到查詢請求，PO 號碼: {po_numbers}")
        logger.info(f"buyer_detail_df 狀態: {'已載入' if buyer_detail_df is not None else '未載入'}")
        logger.info(f"planned_purchase_df 狀態: {'已載入' if planned_purchase_df is not None else '未載入'}")
        
        if buyer_detail_df is not None:
            logger.info(f"Buyer_detail 資料筆數: {len(buyer_detail_df)}")
            logger.info(f"Buyer_detail 欄位: {list(buyer_detail_df.columns)}")
            logger.info(f"Buyer_detail 前3筆 PO No.: {buyer_detail_df.iloc[:3]['PO No.'].tolist() if 'PO No.' in buyer_detail_df.columns else '找不到PO No.欄位'}")
        
        if planned_purchase_df is not None:
            logger.info(f"Planned_purchase 資料筆數: {len(planned_purchase_df)}")
            logger.info(f"Planned_purchase 欄位: {list(planned_purchase_df.columns)}")
            logger.info(f"Planned_purchase 前3筆 PO No.: {planned_purchase_df.iloc[:3]['PO No.'].tolist() if 'PO No.' in planned_purchase_df.columns else '找不到PO No.欄位'}")
        
        result = {}
        
        for po_no in po_numbers:
            logger.info(f"開始處理 PO: {po_no}")
            
            # 查詢需求者和 ePR No.
            user = query_user_by_po_no(po_no)
            epr_no = query_epr_no_by_po_no(po_no)
            
            result[str(po_no)] = {
                'user': user if user else '查無此資訊',
                'eprNo': epr_no if epr_no else '查無此資訊'
            }
            
            logger.info(f"PO {po_no} 最終結果: User={result[str(po_no)]['user']}, ePR={result[str(po_no)]['eprNo']}")
        
        logger.info(f"回傳完整結果: {result}")
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"查詢User和ePR資料時發生錯誤: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


def get_notes_email(user_name, backend_file=BACKEND_DATA):
    """用姓名查 Notes_ID (完整信箱)"""
    with open(backend_file, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
    for entry in data:
        if entry.get("姓名") == user_name:
            first_supervisor = entry.get("第一階主管", "").strip()
            if first_supervisor == "G9745 LC Wang 王利哲":
                return entry.get("Notes_ID", "")
            else:
                # 強制改成 Otis_Wang
                return "Otis_Wang@aseglobal.com"
    return None


def get_notes_prefix(user_name, backend_file=BACKEND_DATA):
    with open(backend_file, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
    
    for entry in data:
        if entry.get("姓名") == user_name:
            notes_id = entry.get("Notes_ID", "")
            if "@" in notes_id:
                prefix = notes_id.split("@")[0]  # 取 @ 前
                if "_" in prefix:
                    return prefix.split("_")[0]   # 再取 _ 前
                return prefix
            return notes_id  # 如果沒有 @，就直接回傳
    return None


def build_greeting(mail_data, backend_file=BACKEND_DATA):
    """建立問候語,從 mail_data 中提取使用者並轉換成英文名"""
    # 從 mail_data 中提取所有 user
    users = [item.get("user") for item in mail_data if item.get("user")]
    
    # 去重並過濾空值和無效值
    unique_users = list(dict.fromkeys([u for u in users if u and u not in ["查無此資訊", "-", ""]]))
    
    logger.info(f"提取到的使用者: {unique_users}")
    
    if not unique_users:
        return "Dear all"
    
    # 獲取每個使用者的英文名
    english_names = []
    for user in unique_users:
        english_name = get_notes_prefix(user, backend_file)
        if english_name:
            english_names.append(english_name)
            logger.info(f"使用者 {user} -> 英文名: {english_name}")
        else:
            logger.warning(f"找不到使用者 {user} 的英文名")
    
    # 如果沒有找到任何英文名,使用 Dear all
    if not english_names:
        logger.warning("沒有找到任何英文名,使用 Dear all")
        return "Dear all"
    
    # 組合成 "Dear Name1, Name2, Name3"
    if len(english_names) == 1:
        greeting = f"Dear {english_names[0]}"
    else:
        greeting = f"Dear {', '.join(english_names)}"
    
    logger.info(f"生成的問候語: {greeting}")
    return greeting


@app.route('/api/save-mail', methods=['POST', 'OPTIONS'])
def save_mail():
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    try:
        data = request.get_json()
        # print(f"收到郵件修改資料: {json.dumps(data, indent=2, ensure_ascii=False)}")
        
        # 提取郵件資料
        mail_data = data.get('data', [])
        
        if not mail_data:
            return jsonify({
                'status': 'error',
                'message': '沒有要發送的資料'
            }), 400
        
        logger.info(f"準備發送郵件,共 {len(mail_data)} 筆資料")
        
        # 調用 mail.py 發送郵件
        try:
            # 取得 PO No. 字串
            po_numbers = list({item.get('poNo', '-') for item in mail_data if item.get('poNo')})
            po_str = "、".join(po_numbers)


            # 取得 user prefix for To 字串
            user_names = {item.get('user') for item in mail_data if item.get('user')}

            # ✅ 逐筆列出備註內容，確認自訂備註正確傳入信件
            for idx, item in enumerate(mail_data, 1):
                logger.info(f"  [{idx}] PO: {item.get('poNo', '-')} / Item: {item.get('itemNo', '-')} / 備註: {item.get('remarks', '(空)')}")
                
            to_prefixes = []
            for name in user_names:
                prefix = get_notes_prefix(name, BACKEND_DATA)
                if prefix:
                    to_prefixes.append(prefix)
            to_str = ", ".join(to_prefixes)

            users = [item.get("user") for item in mail_data if item.get("user")]
            unique_users = list(dict.fromkeys([u for u in users if u]))
            notes_emails = []
            for user in unique_users:
                email = get_notes_email(user, BACKEND_DATA)
                if email:
                    notes_emails.append(email)

            # 組合成逗號分隔的字串
            mail_name = ",".join(notes_emails)

            # ✨ 生成問候語
            greeting = build_greeting(mail_data, BACKEND_DATA)
            logger.info(f"生成的問候語: {greeting}")

            # 準備郵件參數
            name = "驗收通知系統"
            mail_name = mail_name  # 可以根據需要設定收件人
            ccList = ""  # 保持淨空
            po_str = po_str
            to_str = to_str
            
            logger.info(f"PO字串: {po_str}")
            logger.info(f"TO 收件人: {mail_name}")
            logger.info(f"TO 字串: {to_str}")
            logger.info(f"問候語: {greeting}")
            
            logger.info(f"PO: {po_str}\nTO: {mail_name}\nGreeting: {greeting}")
            
            # 呼叫 send_mail 函數,並傳入 greeting
            # print(mail_data, "\n")
            # print(name, "\n")
            # print(mail_name, "\n")
            # print(ccList, "\n")
            # print(po_str, "\n")
            # print(to_str, "\n")
            # print(greeting, "\n")
            # def send_mail(mailList, mail_name, ccList, po_str, to_str, greeting="Dear "):
            send_mail(mail_data, mail_name, ccList, po_str, to_str, greeting, recipients_file=str(MAIL_RECIPIENTS_FILE))
            
            logger.info(f"✅ 郵件發送成功,處理了 {len(mail_data)} 筆資料")
            
            return jsonify({
                "status": "success",
                "message": f"郵件發送成功,已處理 {len(mail_data)} 筆資料",
                "timestamp": data.get('timestamp'),
                "saved_items_count": len(mail_data),
                "mail_sent": True,
                "greeting": greeting
            })
            
        except Exception as mail_error:
            logger.error(f"❌ 郵件發送失敗: {str(mail_error)}")
            logger.error(traceback.format_exc())
            
            # 即使郵件發送失敗,也回傳部分成功的狀態
            return jsonify({
                "status": "partial_success",
                "message": f"資料已保存但郵件發送失敗: {str(mail_error)}",
                "timestamp": data.get('timestamp'),
                "saved_items_count": len(mail_data),
                "mail_sent": False,
                "error_detail": str(mail_error)
            }), 200  # 用200而非500,因為資料處理成功了
        
    except Exception as e:
        logger.error(f"處理請求失敗: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'status': 'error',
            'message': f'處理失敗: {str(e)}'
        }), 500



# 11/25 更新
# ========== 長官審核相關 API（雙重簽核版 - 主任簽核 + 叔叔簽核，移除長官確認欄位）==========
@app.route('/api/add-item-with-notification', methods=['POST'])
def add_item_with_notification():
    """新增資料（不發送郵件）"""
    try:
        data = request.json
        
        # 讀取現有 CSV
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        df = df.fillna('')  # ⭐ 避免 nan 問題
        
        # 確保簽核欄位存在
        if '主任簽核' not in df.columns:
            df['主任簽核'] = 'X'
        if '叔叔簽核' not in df.columns:
            df['叔叔簽核'] = 'X'
        
        # 準備新增的資料
        new_row = {}
        for col in df.columns:
            new_row[col] = data.get(col, '')
        
        # 預設簽核狀態為 X (未確認)
        new_row['主任簽核'] = 'X'
        new_row['叔叔簽核'] = 'X'
        
        # 新增到 DataFrame
        df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
        
        # 儲存 CSV
        df = df.fillna('')  # ⭐ 寫入前確保沒有 nan
        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
        
        return jsonify({
            'status': 'success',
            'message': '資料新增成功',
            'new_item_id': new_row.get('Id', '')
        })
        
    except Exception as e:
        logger.info(f"新增資料失敗: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/get-pending-approval-items', methods=['GET'])
def get_pending_approval_items():
    """取得所有待長官確認的資料"""
    try:
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        df = df.fillna('')  # ⭐ 避免 nan 問題
        
        # 確保簽核欄位存在
        if '主任簽核' not in df.columns:
            df['主任簽核'] = 'X'
        if '叔叔簽核' not in df.columns:
            df['叔叔簽核'] = 'X'
            df = df.fillna('')
            df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
        
        # 篩選出待審核的資料：
        # 1. 主任簽核或叔叔簽核有任一個不是 V
        # 2. 且沒有被退回（都不是 R）
        def is_pending(row):
            director = str(row['主任簽核']).strip() if pd.notna(row['主任簽核']) else 'X'
            uncle = str(row['叔叔簽核']).strip() if pd.notna(row['叔叔簽核']) else 'X'
            
            # 如果有退回就不算待審核
            if director == 'R' or uncle == 'R':
                return False
            # 如果兩個都是 V 就不算待審核
            if director == 'V' and uncle == 'V':
                return False
            # 其他情況都是待審核
            return True
        
        pending_items = df[df.apply(is_pending, axis=1)]
        
        # 轉換為 dict list
        items_list = []
        for _, row in pending_items.iterrows():
            item_dict = {}
            for col in df.columns:
                val = row[col]
                if pd.isna(val):
                    item_dict[col] = ''
                else:
                    item_dict[col] = str(val)
            items_list.append(item_dict)
        
        return jsonify({
            'status': 'success',
            'items': items_list,
            'count': len(items_list)
        })
        
    except Exception as e:
        logger.info(f"取得待審核資料失敗: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/approve-items', methods=['POST'])
def approve_items():
    """批次確認資料（支援主任簽核和叔叔簽核）"""
    try:
        data = request.json
        item_ids = data.get('item_ids', [])
        approve_director = data.get('approve_director', True)  # 是否確認主任簽核
        approve_uncle = data.get('approve_uncle', True)  # 是否確認叔叔簽核
        clear_remarks = data.get('clear_remarks', False)  # 是否清空退回原因
        
        if not item_ids:
            return jsonify({
                'status': 'error',
                'message': '未提供要確認的資料 ID'
            }), 400
        
        # 讀取 CSV
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        df = df.fillna('')  # ⭐ 避免 nan 問題
        
        # 確保簽核欄位存在
        if '主任簽核' not in df.columns:
            df['主任簽核'] = 'X'
        if '叔叔簽核' not in df.columns:
            df['叔叔簽核'] = 'X'
        if '備註' not in df.columns:
            df['備註'] = ''
        
        # 更新指定 ID 的簽核狀態
        updated_count = 0
        for item_id in item_ids:
            mask = df['Id'].astype(str).str.strip() == str(item_id).strip()
            if mask.any():
                # 根據參數設定對應的簽核狀態
                if approve_director:
                    df.loc[mask, '主任簽核'] = 'V'
                if approve_uncle:
                    df.loc[mask, '叔叔簽核'] = 'V'
                
                # 選擇性清空退回原因
                if clear_remarks:
                    current_remark = df.loc[mask, '備註'].values[0]
                    current_remark = str(current_remark) if not pd.isna(current_remark) else ''
                    
                    # 移除所有【主任退回】和【叔叔退回】的部分
                    new_remark = re.sub(r'；*【主任退回】[^；]*', '', current_remark)
                    new_remark = re.sub(r'；*【叔叔退回】[^；]*', '', new_remark)
                    new_remark = new_remark.strip('；').strip()
                    
                    df.loc[mask, '備註'] = new_remark
                
                updated_count += 1
        
        # 儲存 CSV
        df = df.fillna('')  # ⭐ 寫入前確保沒有 nan
        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
        
        # 構建訊息
        msg_parts = []
        if approve_director:
            msg_parts.append('主任簽核')
        if approve_uncle:
            msg_parts.append('叔叔簽核')
        msg = f'成功確認 {updated_count} 筆資料的 {" 和 ".join(msg_parts)}'
        
        return jsonify({
            'status': 'success',
            'message': msg,
            'updated_count': updated_count
        })
        
    except Exception as e:
        logger.info(f"確認資料失敗: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/reject-items', methods=['POST'])
def reject_items():
    """批次退回資料（支援指定退回階段：主任簽核或叔叔簽核）"""
    try:
        data = request.json
        item_ids = data.get('item_ids', [])
        reject_reason = data.get('reject_reason', '長官退回')
        reject_stage = data.get('reject_stage', 'director')  # 'director' 或 'uncle'
        
        if not item_ids:
            return jsonify({
                'status': 'error',
                'message': '未提供要退回的資料 ID'
            }), 400
        
        # 讀取 CSV
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        df = df.fillna('')  # ⭐ 避免 nan 問題
        
        # 確保簽核欄位存在
        if '主任簽核' not in df.columns:
            df['主任簽核'] = 'X'
        if '叔叔簽核' not in df.columns:
            df['叔叔簽核'] = 'X'
        if '備註' not in df.columns:
            df['備註'] = ''
        
        # 決定退回標籤
        stage_label = '主任' if reject_stage == 'director' else '叔叔'
        stage_column = '主任簽核' if reject_stage == 'director' else '叔叔簽核'
        
        # 更新指定 ID 的備註欄位和簽核狀態
        updated_count = 0
        for item_id in item_ids:
            mask = df['Id'].astype(str).str.strip() == str(item_id).strip()
            if mask.any():
                # 處理備註
                current_remark = df.loc[mask, '備註'].values[0]
                current_remark = '' if (pd.isna(current_remark) or 
                                       str(current_remark).strip() == '' or 
                                       str(current_remark) == 'nan') else str(current_remark)
                
                # 在備註中加入退回原因（包含是哪個階段退回）
                new_remark = f"{current_remark}；【{stage_label}退回】{reject_reason}" if current_remark else f"【{stage_label}退回】{reject_reason}"
                df.loc[mask, '備註'] = new_remark
                
                # 設定對應簽核欄位為退回標記
                df.loc[mask, stage_column] = 'R'
                
                updated_count += 1
        
        # 儲存 CSV
        df = df.fillna('')  # ⭐ 寫入前確保沒有 nan
        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
        
        return jsonify({
            'status': 'success',
            'message': f'成功退回 {updated_count} 筆資料（{stage_label}簽核退回）',
            'updated_count': updated_count
        })
        
    except Exception as e:
        logger.info(f"退回資料失敗: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/resubmit-items', methods=['POST'])
def resubmit_items():
    """重新提交（將退回的資料改為待審核，重置兩個簽核狀態）"""
    try:
        data = request.json
        item_ids = data.get('item_ids', [])
        
        if not item_ids:
            return jsonify({
                'status': 'error',
                'message': '未提供要重新提交的資料 ID'
            }), 400
        
        # 讀取 CSV
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        df = df.fillna('')  # ⭐ 避免 nan 問題
        
        # 確保簽核欄位存在
        if '主任簽核' not in df.columns:
            df['主任簽核'] = 'X'
        if '叔叔簽核' not in df.columns:
            df['叔叔簽核'] = 'X'
        
        # 更新指定 ID 的簽核狀態
        updated_count = 0
        for item_id in item_ids:
            mask = df['Id'].astype(str).str.strip() == str(item_id).strip()
            if mask.any():
                # 將所有簽核狀態改回待審核
                df.loc[mask, '主任簽核'] = 'X'
                df.loc[mask, '叔叔簽核'] = 'X'
                updated_count += 1
        
        # 儲存 CSV
        df = df.fillna('')  # ⭐ 寫入前確保沒有 nan
        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
        
        return jsonify({
            'status': 'success',
            'message': f'成功重新提交 {updated_count} 筆資料',
            'updated_count': updated_count
        })
        
    except Exception as e:
        logger.info(f"重新提交失敗: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/get-all-items-with-approval', methods=['GET'])
def get_all_items_with_approval():
    """取得所有資料（自動更新有 ePR No. 的為已確認，確保雙簽核欄位存在）"""
    try:
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        df = df.fillna('')
        
        # 確保簽核欄位存在
        columns_added = False
        if '主任簽核' not in df.columns:
            df['主任簽核'] = 'X'
            columns_added = True
        if '叔叔簽核' not in df.columns:
            df['叔叔簽核'] = 'X'
            columns_added = True
        
        # ⭐ 自動更新：有 ePR No. 的資料，兩個簽核都改為 V
        if 'ePR No.' in df.columns:
            has_epr = df['ePR No.'].astype(str).str.strip() != ''
            
            # 更新主任簽核
            director_not_approved = df['主任簽核'].astype(str).str.strip() != 'V'
            need_update_director = has_epr & director_not_approved
            if need_update_director.any():
                df.loc[need_update_director, '主任簽核'] = 'V'
                columns_added = True
            
            # 更新叔叔簽核
            uncle_not_approved = df['叔叔簽核'].astype(str).str.strip() != 'V'
            need_update_uncle = has_epr & uncle_not_approved
            if need_update_uncle.any():
                df.loc[need_update_uncle, '叔叔簽核'] = 'V'
                columns_added = True
            
            if need_update_director.any() or need_update_uncle.any():
                updated_count = max(need_update_director.sum(), need_update_uncle.sum())
                logger.info(f"✅ 自動更新 {updated_count} 筆已開單資料為已確認")
        
        # 如果有新增欄位或更新，儲存 CSV
        if columns_added:
            df = df.fillna('')
            df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
            logger.info("✅ 已新增/更新主任簽核和叔叔簽核欄位")
        
        # 轉換為 dict list
        items_list = []
        for _, row in df.iterrows():
            item_dict = {}
            for col in df.columns:
                val = row[col]
                if pd.isna(val):
                    item_dict[col] = ''
                else:
                    item_dict[col] = str(val)
            items_list.append(item_dict)
        
        return jsonify({
            'status': 'success',
            'items': items_list,
            'count': len(items_list)
        })
        
    except Exception as e:
        logger.info(f"取得資料失敗: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/clear-remark-and-approve', methods=['POST'])
def clear_remark_and_approve():
    """清空退回原因（保留原本備註）並根據退回階段設定簽核狀態"""
    try:
        data = request.json
        item_id = data.get('item_id')
        reject_stage = data.get('reject_stage', 'unknown')  # 'director' 或 'uncle'
        
        if not item_id:
            return jsonify({
                'status': 'error',
                'message': '未提供資料 ID'
            }), 400
        
        # 讀取 CSV
        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        df = df.fillna('')  # 避免 nan 問題
        
        # ⭐ 移除舊的「長官確認」欄位（如果存在）
        if '長官確認' in df.columns:
            df = df.drop(columns=['長官確認'])
            logger.info("✅ 已移除舊的「長官確認」欄位")
        
        # 確保所有必要欄位存在
        if '備註' not in df.columns:
            df['備註'] = ''
        if '主任簽核' not in df.columns:
            df['主任簽核'] = 'X'
        if '叔叔簽核' not in df.columns:
            df['叔叔簽核'] = 'X'
        
        # 找到對應的資料
        mask = df['Id'].astype(str).str.strip() == str(item_id).strip()
        
        if not mask.any():
            return jsonify({
                'status': 'error',
                'message': f'找不到 ID 為 {item_id} 的資料'
            }), 404
        
        # ⭐ 只移除【主任退回】和【叔叔退回】的部分，保留原本備註
        current_remark = df.loc[mask, '備註'].values[0]
        current_remark = '' if (pd.isna(current_remark) or 
                               str(current_remark).strip() == '' or 
                               str(current_remark) == 'nan') else str(current_remark)
        
        # 移除退回原因（使用正則表達式）
        new_remark = re.sub(r'；*【主任退回】[^；]*', '', current_remark)
        new_remark = re.sub(r'；*【叔叔退回】[^；]*', '', new_remark)
        new_remark = new_remark.strip('；').strip()
        
        df.loc[mask, '備註'] = new_remark
        
        # 根據退回階段設定簽核狀態
        if reject_stage == 'director':
            # 主任退回 → 處理完成後：主任改為 V，叔叔維持 X（等待叔叔簽核）
            df.loc[mask, '主任簽核'] = 'V'
            df.loc[mask, '叔叔簽核'] = 'X'
            message = '退回原因已清除，主任簽核已通過，請叔叔繼續簽核'
            logger.info(f"✅ ID {item_id}: 主任退回處理完成 → 主任V, 叔叔X")
        elif reject_stage == 'uncle':
            # 叔叔退回 → 處理完成後：主任維持 V，叔叔改為 V（簽核完成）
            df.loc[mask, '主任簽核'] = 'V'
            df.loc[mask, '叔叔簽核'] = 'V'
            message = '退回原因已清除，簽核流程已完成'
            logger.info(f"✅ ID {item_id}: 叔叔退回處理完成 → 主任V, 叔叔V")
        else:
            # 未知狀態，只清空退回原因
            message = '退回原因已清除'
            logger.info(f"✅ ID {item_id}: 未知退回階段，僅清除退回原因")
        
        # 儲存 CSV
        df = df.fillna('')  # 寫入前確保沒有 nan
        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
        
        return jsonify({
            'status': 'success',
            'message': message,
            'item_id': item_id,
            'reject_stage': reject_stage,
            'remaining_remark': new_remark  # 回傳保留的備註內容
        })
        
    except Exception as e:
        logger.info(f"❌ 處理失敗: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/reject-approved-to-pending', methods=['POST'])
def reject_approved_to_pending():
    """將已確認的資料退回至待簽核（主任簽核若已通過則維持 V，叔叔簽核重置為 X，並記錄退回原因至備註）"""
    try:
        data = request.json
        item_id = data.get('item_id')
        reject_reason = data.get('reject_reason', '').strip()

        if not item_id:
            return jsonify({'status': 'error', 'message': '未提供資料 ID'}), 400
        if not reject_reason:
            return jsonify({'status': 'error', 'message': '未提供退回原因'}), 400

        df = pd.read_csv(CSV_FILE, encoding="utf-8-sig", dtype=str)
        df = df.fillna('')

        # 確保欄位存在
        if '備註' not in df.columns:
            df['備註'] = ''
        if '主任簽核' not in df.columns:
            df['主任簽核'] = 'X'
        if '叔叔簽核' not in df.columns:
            df['叔叔簽核'] = 'X'

        mask = df['Id'].astype(str).str.strip() == str(item_id).strip()
        if not mask.any():
            return jsonify({'status': 'error', 'message': f'找不到 ID 為 {item_id} 的資料'}), 404

        # 將退回原因附加到備註
        current_remark = df.loc[mask, '備註'].values[0]
        current_remark = '' if (pd.isna(current_remark) or str(current_remark).strip() in ['', 'nan']) else str(current_remark)
        from datetime import datetime as _dt
        timestamp = _dt.now().strftime('%Y-%m-%d %H:%M')
        reject_note = f'【長官退回】{reject_reason}（{timestamp}）'
        new_remark = f'{current_remark}；{reject_note}' if current_remark else reject_note
        df.loc[mask, '備註'] = new_remark

        # 主任簽核若已通過 (V) 則維持，否則重置為 X；叔叔簽核一律重置為 X
        current_director = df.loc[mask, '主任簽核'].values[0]
        if str(current_director).strip() != 'V':
            df.loc[mask, '主任簽核'] = 'X'
        df.loc[mask, '叔叔簽核'] = 'X'

        df = df.fillna('')
        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")

        logger.info(f"✅ ID {item_id} 已從已確認退回至待簽核，原因：{reject_reason}")
        return jsonify({'status': 'success', 'message': '已退回至待簽核', 'item_id': item_id})

    except Exception as e:
        logger.error(f"退回已確認失敗: {e}")
        traceback.print_exc()
        return jsonify({'status': 'error', 'message': str(e)}), 500
    


# ============================================================
#  留言版 API（直接掛載，CORS 由全域 CORS(app) 覆蓋）
#
#  資料結構：
#    message_board_data/
#      channels/
#        general.json        ← 各頻道訊息
#        purchase.json  ...
#      visits/
#        23688.json          ← 每人已讀記錄（工號）
#      message_board.log     ← 操作日誌
# ============================================================

# 路徑常數（MB_DIR / MB_CHANNELS_DIR / MB_VISITS_DIR / MB_LOG_FILE）已統一移至檔案開頭

MB_VALID_CHANNELS = {'general', 'purchase', 'acceptance', 'budget', 'urgent'}

# ── 獨立 Logger ──────────────────────────────────────────────
mb_logger = logging.getLogger('message_board')
if not mb_logger.handlers:
    mb_logger.setLevel(logging.INFO)
    _mb_fh = logging.FileHandler(MB_LOG_FILE, encoding='utf-8')
    _mb_fh.setLevel(logging.INFO)
    _mb_fh.setFormatter(logging.Formatter(
        '%(asctime)s  [%(levelname)s]  %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    mb_logger.addHandler(_mb_fh)
    mb_logger.propagate = False


def mb_channel_path(channel):
    return os.path.join(MB_CHANNELS_DIR, f'{current_site()}_{channel}.json')


def mb_visit_path(username):
    safe = str(username).replace('/', '_').replace('\\', '_')
    return os.path.join(MB_VISITS_DIR, f'{current_site()}_{safe}.json')


def mb_load(filepath, default):
    if not os.path.exists(filepath):
        return default
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        mb_logger.error(f'讀取失敗 {filepath}：{e}')
        return default


def mb_save(filepath, data):
    with FileLock(filepath + '.lock', timeout=10):
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


def mb_now():
    import datetime as _dt
    return _dt.datetime.now().astimezone().isoformat()


def mb_default_visit(username):
    return {
        'username':  username,
        'last_read': {ch: 0 for ch in MB_VALID_CHANNELS}
    }


# 初始化各頻道 JSON
for _ch in MB_VALID_CHANNELS:
    _p = mb_channel_path(_ch)
    if not os.path.exists(_p):
        mb_save(_p, [])
        mb_logger.info(f'初始化頻道檔案：{_p}')


# ── 1. 取得頻道訊息 ───────────────────────────────────────────
@app.route('/api/message-board/messages/<channel>', methods=['GET'])
def mb_get_messages(channel):
    if channel not in MB_VALID_CHANNELS:
        mb_logger.warning(f'取得訊息：無效頻道 [{channel}]')
        return jsonify({'error': '無效頻道'}), 400
    msgs = mb_load(mb_channel_path(channel), [])
    mb_logger.info(f'取得訊息 [{channel}]：共 {len(msgs)} 則')
    return jsonify({'messages': sorted(msgs, key=lambda m: m.get('timestamp', ''))})


# ── 1b. 各頻道最新訊息 id（前端紅點用）──────────────────────
@app.route('/api/message-board/latest-timestamps', methods=['GET'])
def mb_latest_timestamps():
    result = {}
    for ch in MB_VALID_CHANNELS:
        msgs = mb_load(mb_channel_path(ch), [])
        non_system = [m for m in msgs if m.get('type') != 'system']
        result[ch] = max((m.get('id', 0) for m in non_system), default=0)
    return jsonify(result)


# ── 2. 取得使用者各頻道的已讀 last_read ──────────────────────
@app.route('/api/message-board/last-read/<username>', methods=['GET'])
def mb_get_last_read(username):
    visit = mb_load(mb_visit_path(username), mb_default_visit(username))
    last_read = visit.get('last_read', {})
    for ch in MB_VALID_CHANNELS:
        if ch not in last_read:
            last_read[ch] = 0
    mb_logger.info(f'取得已讀記錄 [{username}]：{last_read}')
    return jsonify({'last_read': last_read})


# ── 3. 標記已讀（捲到底時呼叫）──────────────────────────────
@app.route('/api/message-board/mark-read', methods=['POST'])
def mb_mark_read():
    data        = request.get_json(silent=True) or {}
    username    = data.get('username', '').strip()
    channel     = data.get('channel',  '').strip()
    last_msg_id = data.get('last_msg_id', 0)

    if not username or channel not in MB_VALID_CHANNELS:
        mb_logger.warning(f'標記已讀：參數錯誤 username={username} channel={channel}')
        return jsonify({'error': '參數錯誤'}), 400

    vpath = mb_visit_path(username)
    visit = mb_load(vpath, mb_default_visit(username))

    if 'last_read' not in visit:
        visit['last_read'] = {ch: 0 for ch in MB_VALID_CHANNELS}

    current = visit['last_read'].get(channel, 0)
    visit['last_read'][channel] = max(current, int(last_msg_id))
    visit['username'] = username

    mb_save(vpath, visit)
    mb_logger.info(f'標記已讀 [{username}] [{channel}] → #{last_msg_id}（原 #{current}）')
    return jsonify({'success': True, 'last_read': visit['last_read']})


# ── 4. 各頻道未讀數（主看板用）──────────────────────────────
@app.route('/api/message-board/unread/<username>', methods=['GET'])
def mb_unread_count(username):
    visit     = mb_load(mb_visit_path(username), mb_default_visit(username))
    last_read = visit.get('last_read', {})
    result    = {}
    for ch in MB_VALID_CHANNELS:
        msgs       = mb_load(mb_channel_path(ch), [])
        read_id    = last_read.get(ch, 0)
        result[ch] = sum(1 for m in msgs if m.get('type') != 'system' and m.get('id', 0) > read_id)
    total = sum(result.values())
    mb_logger.info(f'查詢未讀 [{username}]：{result}（合計 {total}）')
    return jsonify({'username': username, 'unread': result})


# ── 5. 發送訊息 ───────────────────────────────────────────────
@app.route('/api/message-board/send', methods=['POST'])
def mb_send_message():
    data    = request.get_json(silent=True) or {}
    channel = data.get('channel', '').strip()
    author  = data.get('author',  '').strip()
    content = data.get('content', '').strip()

    if channel not in MB_VALID_CHANNELS:
        mb_logger.warning(f'發送訊息：無效頻道 [{channel}] by {author}')
        return jsonify({'error': '無效頻道'}), 400
    if not author:
        return jsonify({'error': '缺少作者'}), 400
    if not content:
        return jsonify({'error': '訊息內容不可為空'}), 400

    msgs = mb_load(mb_channel_path(channel), [])
    existing_ids = [m.get('id', 0) for m in msgs if isinstance(m.get('id'), int)]
    new_id = (max(existing_ids) + 1) if existing_ids else 1

    new_msg = {
        'id':        new_id,
        'channel':   channel,
        'author':    author,
        'emp_id':    data.get('emp_id', ''),   # 工號，供搜尋用
        'type':      'message',
        'content':   content,
        'timestamp': mb_now(),
        'tag':       data.get('tag', ''),
        'reactions': {},
        'replyTo':   data.get('replyTo', None),
        'pinned':    False,
    }

    msgs.append(new_msg)
    mb_save(mb_channel_path(channel), msgs)
    preview = content[:30] + ('…' if len(content) > 30 else '')
    mb_logger.info(f'新訊息 #{new_id} [{channel}] by {author}：「{preview}」tag={data.get("tag","無")} replyTo={data.get("replyTo")}')
    return jsonify({'success': True, 'message': new_msg})


# ── 6. 切換釘選 ───────────────────────────────────────────────
@app.route('/api/message-board/pin', methods=['POST'])
def mb_toggle_pin():
    data    = request.get_json(silent=True) or {}
    msg_id  = data.get('msg_id')
    channel = data.get('channel', '').strip()

    if channel not in MB_VALID_CHANNELS:
        mb_logger.warning(f'釘選操作：無效頻道 [{channel}] msg_id={msg_id}')
        return jsonify({'error': '無效頻道'}), 400

    msgs = mb_load(mb_channel_path(channel), [])
    msg  = next((m for m in msgs if m.get('id') == msg_id), None)
    if not msg:
        mb_logger.warning(f'釘選操作：找不到訊息 [{channel}] msg_id={msg_id}')
        return jsonify({'error': '找不到訊息'}), 404

    msg['pinned'] = not msg.get('pinned', False)
    if msg['pinned']:
        msg['pinned_at'] = mb_now()
    else:
        msg['pinned_at'] = ''

    mb_save(mb_channel_path(channel), msgs)
    action = '釘選' if msg['pinned'] else '取消釘選'
    mb_logger.info(f'{action} [{channel}] msg_id={msg_id}（作者：{msg.get("author","?")}）')
    return jsonify({'success': True, 'pinned': msg['pinned'], 'pinned_at': msg.get('pinned_at', '')})


# ── 7. Emoji 反應 ─────────────────────────────────────────────
@app.route('/api/message-board/reaction', methods=['POST'])
def mb_add_reaction():
    data    = request.get_json(silent=True) or {}
    msg_id  = data.get('msg_id')
    emoji   = data.get('emoji',   '').strip()
    channel = data.get('channel', '').strip()

    if not emoji or channel not in MB_VALID_CHANNELS:
        mb_logger.warning(f'Emoji 反應：參數錯誤 channel={channel} emoji={emoji}')
        return jsonify({'error': '參數錯誤'}), 400

    msgs = mb_load(mb_channel_path(channel), [])
    msg  = next((m for m in msgs if m.get('id') == msg_id), None)
    if not msg:
        mb_logger.warning(f'Emoji 反應：找不到訊息 [{channel}] msg_id={msg_id}')
        return jsonify({'error': '找不到訊息'}), 404

    if 'reactions' not in msg:
        msg['reactions'] = {}
    msg['reactions'][emoji] = msg['reactions'].get(emoji, 0) + 1

    mb_save(mb_channel_path(channel), msgs)
    mb_logger.info(f'Emoji {emoji} [{channel}] msg_id={msg_id}（作者：{msg.get("author","?")}）→ 共 {msg["reactions"][emoji]} 次')
    return jsonify({'success': True, 'reactions': msg['reactions']})


# ── 8. 撤回訊息（10分鐘內、本人才可撤回）────────────────────
@app.route('/api/message-board/recall', methods=['POST'])
def mb_recall_message():
    import datetime as _dt
    data     = request.get_json(silent=True) or {}
    msg_id   = data.get('msg_id')
    channel  = data.get('channel', '').strip()
    username = data.get('username', '').strip()

    if not username or channel not in MB_VALID_CHANNELS:
        mb_logger.warning(f'撤回訊息：參數錯誤 username={username} channel={channel}')
        return jsonify({'error': '參數錯誤'}), 400

    msgs = mb_load(mb_channel_path(channel), [])
    msg  = next((m for m in msgs if m.get('id') == msg_id), None)

    if not msg:
        mb_logger.warning(f'撤回訊息：找不到訊息 [{channel}] msg_id={msg_id}')
        return jsonify({'error': '找不到訊息'}), 404

    # 10 分鐘時間驗證
    ts_str = msg.get('timestamp', '')
    try:
        ts = _dt.datetime.fromisoformat(ts_str)
        now = _dt.datetime.now().astimezone()
        if ts.tzinfo is None:
            ts = ts.astimezone()
        elapsed = (now - ts).total_seconds()
        if elapsed > 600:
            mb_logger.warning(f'撤回訊息：超過10分鐘 [{channel}] msg_id={msg_id} elapsed={elapsed:.0f}s')
            return jsonify({'error': '已超過10分鐘，無法撤回'}), 403
    except Exception as e:
        mb_logger.error(f'撤回訊息：時間解析失敗 {ts_str}：{e}')
        return jsonify({'error': '時間驗證失敗'}), 500

    msgs = [m for m in msgs if m.get('id') != msg_id]
    mb_save(mb_channel_path(channel), msgs)
    mb_logger.info(f'撤回訊息 [{channel}] msg_id={msg_id} by {username}（作者：{msg.get("author","?")}，發送 {elapsed:.0f}s 前）')
    return jsonify({'success': True})



# ══════════════════════════════════════════════
#  成員管理 API
# ══════════════════════════════════════════════

# 路徑常數（CONFIG_FILE / PHONE_FILE / BACKEND_DATA）已統一移至檔案開頭


# ── 1. 新增需求者 → config.cfg + phone.json + Backend_data.json ──
@app.route('/api/requesters/add', methods=['POST'])
def add_requester():
    try:
        data     = request.get_json()
        name     = data.get("name",     "").strip()
        phone    = data.get("phone",    "").strip()
        emp_id   = data.get("emp_id",   "").strip()
        notes_id = data.get("notes_id", "Otis_Wang@aseglobal.com").strip()

        if not name:   return jsonify({"error": "姓名不可為空"}), 400
        if not phone:  return jsonify({"error": "電話不可為空"}), 400
        if not emp_id: return jsonify({"error": "工號不可為空"}), 400

        # config.cfg
        with FileLock(CONFIG_FILE + ".lock"):
            with open(CONFIG_FILE, "r", encoding="utf-8-sig") as f:
                existing = [l.strip() for l in f.readlines() if l.strip()]
            if name in existing:
                return jsonify({"error": "此人已在需求者清單中"}), 409
            existing.append(name)
            with open(CONFIG_FILE, "w", encoding="utf-8-sig") as f:
                f.write("\n".join(existing) + "\n")

        # phone.json
        with FileLock(PHONE_FILE + ".lock"):
            with open(PHONE_FILE, "r", encoding="utf-8-sig") as f:
                phones = json.load(f)
            phones[name] = phone
            with open(PHONE_FILE, "w", encoding="utf-8-sig") as f:
                json.dump(phones, f, ensure_ascii=False, indent=4)

        # Backend_data.json
        new_entry = {
            "工號":              emp_id,
            "姓名":              name,
            "Notes_ID":          notes_id,
            "班別":              "RR",
            "第一階主管":        "G9745 LC Wang 王利哲",
            "後台管理":          "X",
            "EAP健康度後台":     "X",
            "新增議題後台":      "X",
            "請購網頁後台":      "X",
            "ASEGO派報網頁後台": "X",
            "早報派報網頁後台":  "X",
        }
        with FileLock(BACKEND_DATA + ".lock"):
            with open(BACKEND_DATA, "r", encoding="utf-8-sig") as f:
                backend = json.load(f)
            if any(str(e.get("工號", "")).strip() == emp_id for e in backend):
                return jsonify({"error": f"工號 {emp_id} 已存在於系統中"}), 409
            backend.append(new_entry)
            with open(BACKEND_DATA, "w", encoding="utf-8-sig") as f:
                json.dump(backend, f, ensure_ascii=False, indent=2)

        return jsonify({"success": True, "message": f"已新增：{name}（{phone}）"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── 2. 移除需求者 → config.cfg + phone.json + Backend_data.json ──
@app.route('/api/requesters/remove', methods=['POST'])
def remove_requester():
    try:
        data = request.get_json()
        name = data.get("name", "").strip()

        if not name: return jsonify({"error": "姓名不可為空"}), 400

        # config.cfg
        with FileLock(CONFIG_FILE + ".lock"):
            with open(CONFIG_FILE, "r", encoding="utf-8-sig") as f:
                existing = [l.strip() for l in f.readlines() if l.strip()]
            if name not in existing:
                return jsonify({"error": "此人不在清單中"}), 404
            existing.remove(name)
            with open(CONFIG_FILE, "w", encoding="utf-8-sig") as f:
                f.write("\n".join(existing) + "\n")

        # phone.json
        with FileLock(PHONE_FILE + ".lock"):
            with open(PHONE_FILE, "r", encoding="utf-8-sig") as f:
                phones = json.load(f)
            phones.pop(name, None)
            with open(PHONE_FILE, "w", encoding="utf-8-sig") as f:
                json.dump(phones, f, ensure_ascii=False, indent=4)

        # Backend_data.json
        with FileLock(BACKEND_DATA + ".lock"):
            with open(BACKEND_DATA, "r", encoding="utf-8-sig") as f:
                backend = json.load(f)
            backend = [e for e in backend if str(e.get("姓名", "")).strip() != name]
            with open(BACKEND_DATA, "w", encoding="utf-8-sig") as f:
                json.dump(backend, f, ensure_ascii=False, indent=2)

        return jsonify({"success": True, "message": f"已移除：{name}"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ========== 驗收發信 備註選項 API（accMailData.json） ==========
def _read_acc_mail_remarks():
    """讀取 accMailData.json 的 remarks 清單"""
    with open(ACC_MAIL_DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    remarks = data.get('remarks', [])
    return [str(r) for r in remarks if str(r).strip()]


def _write_acc_mail_remarks(remarks):
    with open(ACC_MAIL_DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump({"remarks": remarks}, f, ensure_ascii=False, indent=2)


@app.route('/api/acc-mail-remarks', methods=['GET'])
def get_acc_mail_remarks():
    """取得備註選項清單"""
    try:
        with FileLock(ACC_MAIL_DATA_FILE + '.lock', timeout=10):
            remarks = _read_acc_mail_remarks()
        return jsonify({'success': True, 'remarks': remarks})
    except Exception as e:
        logger.error(f"讀取備註選項失敗: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/acc-mail-remarks', methods=['POST'])
def add_acc_mail_remark():
    """新增備註選項  body: { "remark": "..." }"""
    try:
        data = request.get_json() or {}
        remark = str(data.get('remark', '')).strip()
        if not remark:
            return jsonify({'success': False, 'message': '備註內容不可為空'}), 400

        with FileLock(ACC_MAIL_DATA_FILE + '.lock', timeout=10):
            remarks = _read_acc_mail_remarks()
            if remark in remarks:
                return jsonify({'success': False, 'message': '此備註已存在', 'remarks': remarks}), 409
            remarks.append(remark)
            _write_acc_mail_remarks(remarks)

        logger.info(f"新增備註選項: {remark}")
        return jsonify({'success': True, 'message': '已新增', 'remarks': remarks})
    except Exception as e:
        logger.error(f"新增備註選項失敗: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/acc-mail-remarks', methods=['DELETE'])
def delete_acc_mail_remark():
    """移除備註選項  body: { "remark": "..." }"""
    try:
        data = request.get_json() or {}
        remark = str(data.get('remark', '')).strip()
        if not remark:
            return jsonify({'success': False, 'message': '備註內容不可為空'}), 400

        with FileLock(ACC_MAIL_DATA_FILE + '.lock', timeout=10):
            remarks = _read_acc_mail_remarks()
            if remark not in remarks:
                return jsonify({'success': False, 'message': '找不到此備註', 'remarks': remarks}), 404
            remarks = [r for r in remarks if r != remark]
            _write_acc_mail_remarks(remarks)

        logger.info(f"移除備註選項: {remark}")
        return jsonify({'success': True, 'message': '已移除', 'remarks': remarks})
    except Exception as e:
        logger.error(f"移除備註選項失敗: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'message': str(e)}), 500


# ========== 發送Mail固定人員 API（mailRecipients.json） ==========
# 放在 acc-mail-remarks API 後面即可（不需額外 import）

def load_recipients():
    with open(MAIL_RECIPIENTS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def normalize_name(name):
    """去頭尾空白、空白轉底線、去掉尾端 @aseglobal.com，只留 Notes ID 前綴"""
    name = str(name or '').strip().replace(' ', '_')
    if name.lower().endswith(MAIL_DOMAIN):
        name = name[:-len(MAIL_DOMAIN)]
    return name


# 允許管理的群組與欄位（防止前端亂傳 key）
_MAIL_RECIPIENT_FIELDS = {
    'purchase':   ('to', 'cc'),   # 請購 Mail：normail.py / urgent.py
    'acceptance': ('cc',),        # 驗收 Mail：acceptanceMail.py（To 為 User 本人，不在此管理）
}


def _write_mail_recipients(data):
    with open(MAIL_RECIPIENTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _validate_mail_recipient_req(data):
    """檢查 body 的 group / field / name，回傳 (group, field, name, error_msg)"""
    group = str(data.get('group', '')).strip()
    field = str(data.get('field', '')).strip()
    name  = normalize_name(data.get('name', ''))
    if group not in _MAIL_RECIPIENT_FIELDS or field not in _MAIL_RECIPIENT_FIELDS[group]:
        return group, field, name, '不支援的群組或欄位'
    if not name:
        return group, field, name, 'Notes ID 不可為空'
    return group, field, name, None


@app.route('/api/mail-recipients', methods=['GET'])
def get_mail_recipients():
    """取得所有固定人員設定"""
    try:
        with FileLock(MAIL_RECIPIENTS_FILE + '.lock', timeout=10):
            data = load_recipients()
        return jsonify({'success': True, 'data': data})
    except Exception as e:
        logger.error(f"讀取 Mail 固定人員失敗: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/mail-recipients', methods=['POST'])
def add_mail_recipient():
    """新增固定人員  body: { "group": "purchase", "field": "cc", "name": "Otis_Wang" }"""
    try:
        group, field, name, err = _validate_mail_recipient_req(request.get_json() or {})
        if err:
            return jsonify({'success': False, 'message': err}), 400

        with FileLock(MAIL_RECIPIENTS_FILE + '.lock', timeout=10):
            data = load_recipients()
            names = data.setdefault(group, {}).setdefault(field, [])
            if name.lower() in [n.lower() for n in names]:
                return jsonify({'success': False, 'message': '此人員已存在', 'data': data}), 409
            names.append(name)
            _write_mail_recipients(data)

        logger.info(f"新增 Mail 固定人員: {group}.{field} += {name}")
        return jsonify({'success': True, 'message': f'已新增 {name}', 'data': data})
    except Exception as e:
        logger.error(f"新增 Mail 固定人員失敗: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/mail-recipients', methods=['DELETE'])
def delete_mail_recipient():
    """移除固定人員  body 同 POST"""
    try:
        group, field, name, err = _validate_mail_recipient_req(request.get_json() or {})
        if err:
            return jsonify({'success': False, 'message': err}), 400

        with FileLock(MAIL_RECIPIENTS_FILE + '.lock', timeout=10):
            data = load_recipients()
            names = data.get(group, {}).get(field, [])
            if name.lower() not in [n.lower() for n in names]:
                return jsonify({'success': False, 'message': '找不到此人員', 'data': data}), 404
            data[group][field] = [n for n in names if n.lower() != name.lower()]
            _write_mail_recipients(data)

        logger.info(f"移除 Mail 固定人員: {group}.{field} -= {name}")
        return jsonify({'success': True, 'message': f'已移除 {name}', 'data': data})
    except Exception as e:
        logger.error(f"移除 Mail 固定人員失敗: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'message': str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True)
    # serve(app, host='10.11.99.84', port=8091)  
    # 原狀態
    # app.run(host="10.11.104.247", port=7001, debug=True)
    # 0971-50-2211 修哥電話
    
    
# CSV_FILE = rf"D:\Data\ePR_Data\Planned_Purchase_Request_List.csv"
# JSON_FILE = f"static/data/money.json"
# BACKEND_DATA = f"Backend_data.json"
# DETAIL_FILE = rf"D:\Data\ePR_Data\Buyer_detail.csv"
# VENDER_FILE_PATH = r"static/data/vender.ini"
# PHONE_JSON = f"static/data/phone.json"
# # DETAIL_FILE = r"D:\Data\ePR_data\Buyer_detail.csv"