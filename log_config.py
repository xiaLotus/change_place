# ============================================================
# log_config.py — 集中式 Log 設定（與 app.py 同層級）
#
# 使用方式：
#   from log_config import setup_logging, get_logger
#   setup_logging()                    # 整個程式只需呼叫一次（app.py 開頭）
#   logger = get_logger('app')         # 取得對應模組的 logger
#
# 目錄結構（由 config.ini [LOG_FILES] 定義）：
#   Log/
#   ├── app/app_2026_08_02.log             ← app.py 主體
#   ├── acc_mail/acc_mail_2026_08_02.log   ← 驗收信系統（含 parse.py / acceptanceMail.py）
#   ├── mail_send/mail_send_2026_08_02.log ← 寄信系統（含 normail.py / urgent.py）
#   └── access/access_2026_08_02.log       ← werkzeug HTTP 請求記錄
#
# 檔名規則：
#   檔名 = {功能}_{該檔起始日}.log（例如 app_2026_08_02.log）。
#   每滿 rotate_days 天（預設 7 天）自動換一個以當天日期命名的新檔；
#   服務重啟時，若資料夾內最新的日期檔仍在 7 天內，會沿用續寫、不會另開新檔。
#   超過 backup_count 數量的最舊檔案會自動刪除。
#
# 分層規則：
#   [LOG_FILES] 中的每個 key 都是一個「頂層 logger」，
#   各自綁定一個獨立的功能資料夾。
#   子模組使用「父名稱.子名稱」命名（例如 'acc_mail.parse'），
#   log 會自動往上傳遞、寫入父層的 log 檔，
#   並在每行的 [%(name)s] 中顯示來源，方便追蹤是哪個子模組寫的。
#   （留言板 mb_logger 維持原本獨立設定，不經過本模組）
# ============================================================

import os
import re
import logging
import datetime
import configparser

# config.ini 與本檔同層級
_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.ini')

_initialized = False

class DatedPeriodFileHandler(logging.FileHandler):
    """以「起始日期」命名 log 檔的輪轉 handler。

    - 目前寫入的檔案：{dir_path}/{prefix}_yyyy_mm_dd.log（yyyy_mm_dd 為該檔起始日）
    - 每滿 period_days 天，自動改寫入以「當天日期」命名的新檔
    - 服務重啟時沿用 7 天內的最新日期檔，不會每次重啟都開新檔
    - 舊檔超過 backup_count 個時，自動刪除最舊的
    """

    def __init__(self, dir_path, prefix, period_days=7, backup_count=52, encoding='utf-8'):
        self.dir_path = dir_path
        self.prefix = prefix
        self.period_days = period_days
        self.backup_count = backup_count
        # 檔名格式：{功能}_yyyy_mm_dd.log
        self._filename_pattern = re.compile(
            r'^' + re.escape(prefix) + r'_(\d{4})_(\d{2})_(\d{2})\.log$'
        )
        os.makedirs(dir_path, exist_ok=True)

        # 決定目前應寫入的檔案起始日（重啟時沿用未滿週期的最新檔）
        self.current_date = self._determine_start_date()
        super().__init__(self._path_for(self.current_date), mode='a', encoding=encoding)

    # ── 內部工具 ──────────────────────────────────────────

    def _path_for(self, d: datetime.date) -> str:
        return os.path.join(self.dir_path, f"{self.prefix}_{d.strftime('%Y_%m_%d')}.log")

    def _existing_dates(self):
        """列出資料夾內所有符合 {功能}_yyyy_mm_dd.log 格式的日期。"""
        dates = []
        try:
            for fn in os.listdir(self.dir_path):
                m = self._filename_pattern.match(fn)
                if m:
                    try:
                        dates.append(datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
                    except ValueError:
                        pass  # 忽略無效日期的檔名
        except OSError:
            pass
        return dates

    def _determine_start_date(self) -> datetime.date:
        today = datetime.date.today()
        dates = self._existing_dates()
        if dates:
            latest = max(dates)
            # 最新檔案未滿一個週期 → 沿用續寫
            if 0 <= (today - latest).days < self.period_days:
                return latest
        return today

    def _cleanup_old(self):
        """刪除超過保留數量的最舊 log 檔。"""
        dates = sorted(self._existing_dates())
        while len(dates) > self.backup_count:
            oldest = dates.pop(0)
            try:
                os.remove(self._path_for(oldest))
            except OSError:
                pass

    # ── 輪轉核心 ──────────────────────────────────────────

    def emit(self, record):
        # handle() 已持有 handler 鎖，此處直接檢查是否需要換檔
        today = datetime.date.today()
        if (today - self.current_date).days >= self.period_days:
            # 滿一個週期 → 關閉舊檔串流，改開以今天日期命名的新檔
            if self.stream:
                self.stream.close()
                self.stream = None
            self.current_date = today
            self.baseFilename = os.path.abspath(self._path_for(today))
            self.stream = self._open()
            self._cleanup_old()
        super().emit(record)


def setup_logging(config_path: str = _CONFIG_PATH):
    """讀取 config.ini，建立所有頂層 logger 與對應的日期輪轉 handler。

    重複呼叫不會重複掛 handler（避免 Flask reloader / 重複 import 造成 log 重複）。
    """
    global _initialized
    if _initialized:
        return

    config = configparser.ConfigParser()
    read_ok = config.read(config_path, encoding='utf-8')

    # 讀取 [LOG] 全域設定（讀不到時使用預設值）
    log_dir      = config.get('LOG', 'log_dir',       fallback='Log')
    rotate_days  = config.getint('LOG', 'rotate_days',  fallback=7)
    backup_count = config.getint('LOG', 'backup_count', fallback=52)
    level_name   = config.get('LOG', 'level',          fallback='INFO')
    level        = getattr(logging, level_name.upper(), logging.INFO)

    # 統一輸出格式：時間 層級 [logger名稱]: 訊息
    formatter = logging.Formatter(
        '%(asctime)s %(levelname)s [%(name)s]: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # 讀取 [LOG_FILES]，為每個頂層 logger 綁定獨立的功能資料夾
    if config.has_section('LOG_FILES'):
        log_files = config.items('LOG_FILES')
    else:
        # config.ini 遺失時的保底設定，確保系統仍可運作
        log_files = [('app', 'app')]

    for logger_name, sub_dir in log_files:
        # 功能資料夾路徑 = log_dir/{功能}，實際檔案 = log_dir/{功能}/yyyy_mm_dd.log
        dir_path = os.path.join(log_dir, sub_dir)

        handler = DatedPeriodFileHandler(
            dir_path=dir_path,
            prefix=sub_dir,            # 檔名前綴 = 功能資料夾名稱（如 app_2026_08_02.log）
            period_days=rotate_days,   # 每 N 天換一個新檔（config.ini 設定，預設 7）
            backup_count=backup_count, # 保留舊檔數量
            encoding='utf-8'
        )
        handler.setFormatter(formatter)

        lg = logging.getLogger(logger_name)
        lg.setLevel(level)
        if not lg.handlers:          # 防止重複掛載
            lg.addHandler(handler)
        lg.propagate = False         # 不往 root 傳，各 log 檔完全隔離

    _initialized = True

    # 啟動記錄
    boot_logger = logging.getLogger('app')
    if read_ok:
        boot_logger.info(
            f'🔄 Log 系統已啟動（設定檔：{config_path}，輪轉週期：{rotate_days} 天，保留 {backup_count} 份）'
        )
    else:
        boot_logger.warning(
            f'⚠️ 找不到設定檔 {config_path}，已使用預設 Log 設定'
        )


def get_logger(name: str) -> logging.Logger:
    """取得指定名稱的 logger。

    頂層名稱（app / acc_mail / mail_send）直接寫入各自的 log 檔；
    子模組名稱（如 acc_mail.parse、mail_send.urgent）自動寫入父層的 log 檔。
    """
    return logging.getLogger(name)