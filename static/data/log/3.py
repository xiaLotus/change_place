import pandas as pd
import numpy as np
from datetime import datetime

# 讀取CSV檔案
df = pd.read_csv('Buyer_detail.csv', encoding='utf-8-sig', dtype='str')

# 篩選條件：ePR No、PO No、需求日都不為空值
filtered_df = df[
    (df['ePR No.'].notna()) & 
    (df['PO No.'].notna()) & 
    (df['需求日'].notna()) &
    (df['ePR No.'] != '') & 
    (df['PO No.'] != '') & 
    (df['需求日'] != '')
]

# 顯示篩選結果
print(f"原始資料筆數: {len(df)}")
print(f"篩選後資料筆數: {len(filtered_df)}")
print("\n篩選後的資料:")
print(filtered_df.to_string(index=False))

# 顯示篩選條件的統計資訊
print(f"\nePR No. 非空值筆數: {df['ePR No.'].notna().sum()}")
print(f"PO No. 非空值筆數: {df['PO No.'].notna().sum()}")
print(f"需求日 非空值筆數: {df['需求日'].notna().sum()}")

# ==== 新增需求：入帳條件篩選 ====
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
    # 例如：7月報表要排除發票在7月或之前的資料，保留發票在8月之後的（7月時未入帳）
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
    
    print(f"調試 - 找到 {already_paid_mask.sum()} 筆在{target_year}年{target_month}月或之前已開發票的資料將被排除")
    
    # 排除已入帳的資料
    accounting_df = accounting_df[~already_paid_mask]
    
    # 1. EPR No. 和 PO No. 必須有值
    condition1 = (accounting_df['ePR No.'].notna()) & (accounting_df['PO No.'].notna()) & \
                 (accounting_df['ePR No.'] != '') & (accounting_df['PO No.'] != '')
    
    # 2. 扣除 WBS 欄位有值的資料（WBS 必須為空）
    condition2 = accounting_df['WBS'].isna() | (accounting_df['WBS'] == '')
    
    # 3. 承諾交期必須有值且在當月或之前
    condition3 = accounting_df['承諾交期_日期'].notna() & (accounting_df['承諾交期_日期'] < target_date_end)
    
    # 4. 需求日必須在當月之前  
    target_date_start = datetime(target_year, target_month, 1)
    condition4 = accounting_df['需求日_日期'] < target_date_start
    
    # 套用所有條件
    final_condition = condition1 & condition2 & condition3 & condition4
    result_df = accounting_df[final_condition]
    
    # 計算統計數據（基於原始資料）
    c1 = ((df['ePR No.'].notna()) & (df['PO No.'].notna()) & (df['ePR No.'] != '') & (df['PO No.'] != '')).sum()
    c2 = (df['WBS'].isna() | (df['WBS'] == '')).sum()
    c3 = condition3.sum()
    c4 = condition4.sum()
    c5 = len(result_df)
    
    return result_df, c1, c2, c3, c4, c5

# 獲取資料中所有可能的年月份 (只到當前月份)
def get_all_year_months(df):
    """從資料中提取所有年月份，但只到當前月份"""
    from datetime import datetime
    
    current_date = datetime.now()
    current_year = current_date.year
    current_month = current_date.month
    
    all_dates = []
    
    # 從承諾交期欄位提取日期
    delivery_dates = pd.to_datetime(df['Delivery Date 廠商承諾交期'], errors='coerce').dropna()
    all_dates.extend(delivery_dates)
    
    # 從需求日欄位提取日期
    demand_dates = pd.to_datetime(df['需求日'], errors='coerce').dropna()
    all_dates.extend(demand_dates)
    
    # 從發票月份欄位提取日期
    invoice_dates = pd.to_datetime(df['發票月份'], errors='coerce').dropna()
    all_dates.extend(invoice_dates)
    
    # 提取年月份並過濾到當前月份
    year_months = set()
    for date in all_dates:
        year = date.year
        month = date.month
        # 只保留到當前月份的資料
        if (year < current_year) or (year == current_year and month <= current_month):
            year_months.add((year, month))
    
    return sorted(list(year_months))

# 獲取所有年月份
all_year_months = get_all_year_months(df)
print(f"資料中包含的所有年月份: {all_year_months}")

# 選擇目標月份進行計算
target_year_months = all_year_months  # 計算所有年月份

for year, month in target_year_months:
    print(f"\n{'='*50}")
    print(f"計算 {year}年{month}月 的未入帳資料")
    print(f"{'='*50}")
    
    result_df, c1, c2, c3, c4, c5 = filter_for_accounting(df, month, year)

    # 計算總價加總
    # 先清理總價欄位，移除非數字字符
    # result_df = result_df.copy()
    # result_df['RT總金額_數值'] = pd.to_numeric(
    #     result_df['RT總金額'].astype(str).str.replace(',', '').str.replace('$', ''), 
    #     errors='coerce'
    # )
    # total_amount = result_df['RT總金額_數值'].sum()

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
    
    print(f"符合條件的資料筆數: {len(result_df)}")
    print(f"總金額: ${total_amount:,.2f}")
    
    print(f"\n各條件篩選統計:")
    print(f"1. EPR No. 和 PO No. 有值: {c1} 筆")
    print(f"2. WBS 欄位為空: {c2} 筆") 
    print(f"3. 承諾交期在 {year}年{month}月當月或之前且有值: {c3} 筆")
    print(f"4. 需求日在 {year}年{month}月前: {c4} 筆")
    print(f"5. 最終未入帳資料筆數: {c5} 筆")
    
    # 輸出詳細清單到 txt 檔案
    filename = f"accounting_list_{year}年{month}月.txt"
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(f"{year}年{month}月 未入帳資料清單\n")
        f.write("="*50 + "\n")
        f.write(f"總筆數: {len(result_df)}\n")
        f.write(f"總金額: ${total_amount:,.2f}\n\n")
        
        if len(result_df) > 0:
            # 選擇重要欄位輸出
            output_columns = ['Id', 'ePR No.', 'PO No.', '品項', '總價', 'RT總金額', 'Delivery Date 廠商承諾交期', '需求日', '發票月份']
            for idx, row in result_df.iterrows():
                f.write(f"第 {idx+1} 筆:\n")  # type: ignore
                for col in output_columns:
                    if col in result_df.columns:
                        if col == '需求日' and pd.notna(row[col]):
                            # 需求日特殊處理，移除.0
                            f.write(f"  {col}: {str(int(float(row[col])))}\n")
                        else:
                            f.write(f"  {col}: {row[col]}\n")
                f.write(f"  最終金額數值: ${row['最終金額_數值']:,.2f}\n")
                f.write("-" * 30 + "\n")
        else:
            f.write("無符合條件的資料\n")
    
    print(f"\n詳細清單已輸出至: {filename}")

print(f"\n{'='*50}")
print("計算完成！")
print(f"{'='*50}")

# 生成JSON摘要
import json

print(f"\n{'='*30}")
print("生成JSON摘要...")
print(f"{'='*30}")

json_summary = {}

for year, month in target_year_months:
    result_df, c1, c2, c3, c4, c5 = filter_for_accounting(df, month, year)
    
    # # 計算總價
    # result_df = result_df.copy()
    # result_df['RT總金額_數值'] = pd.to_numeric(
    #     result_df['總價'].astype(str).str.replace(',', '').str.replace("$", ''), 
    #     errors='coerce'
    # )
    # total_amount = result_df['RT總金額_數值'].sum()
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
        
    # 格式化年月
    year_month_key = f"{year}年{month}月"
    json_summary[year_month_key] = int(total_amount) if not pd.isna(total_amount) else 0

# 輸出JSON到檔案
json_filename = "accounting_summary.json"
with open(json_filename, 'w', encoding='utf-8') as f:
    json.dump(json_summary, f, ensure_ascii=False, indent=2)

print(f"JSON摘要已輸出至: {json_filename}")

# 同時在螢幕顯示
print(f"\nJSON內容:")
print(json.dumps(json_summary, ensure_ascii=False, indent=2))