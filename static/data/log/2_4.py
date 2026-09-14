import pandas as pd
import numpy as np
from datetime import datetime
import json

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

# ==== 每月實際入帳金額計算 ====

def calculate_monthly_actual_accounting(df):
    """
    計算每月實際入帳金額
    條件：
    1. ePR No. 和 PO No. 必須有值
    2. 不包含WBS (WBS必須為空)
    3. 發票月份不為空 (有發票才算入帳)
    """
    # 複製資料避免修改原始資料
    accounting_df = df.copy()
    
    # 1. EPR No. 和 PO No. 必須有值
    condition1 = (accounting_df['ePR No.'].notna()) & (accounting_df['PO No.'].notna()) & \
                 (accounting_df['ePR No.'] != '') & (accounting_df['PO No.'] != '')
    
    # 2. 不含WBS (WBS 必須為空)
    condition2 = accounting_df['WBS'].isna() | (accounting_df['WBS'] == '')
    
    # 3. 發票月份不為空 (有發票才算入帳)
    accounting_df['發票月份_日期'] = pd.to_datetime(accounting_df['發票月份'], errors='coerce', format='mixed')
    condition3 = accounting_df['發票月份_日期'].notna()
    
    # 套用所有條件
    final_condition = condition1 & condition2 & condition3
    result_df = accounting_df[final_condition]
    
    # 加入發票年月欄位
    result_df = result_df.copy()
    result_df['發票年月'] = result_df['發票月份_日期'].dt.to_period('M')
    
    print(f"符合入帳條件的資料筆數: {len(result_df)}")
    print(f"1. EPR No. 和 PO No. 有值: {condition1.sum()} 筆")
    print(f"2. WBS 欄位為空: {condition2.sum()} 筆")
    print(f"3. 發票月份不為空: {condition3.sum()} 筆")
    
    return result_df

def get_monthly_summary(df_with_period):
    """
    按月份統計實際入帳金額
    """
    # 計算總價數值
    df = df_with_period.copy()
    df['RT總金額_數值'] = pd.to_numeric(
        df['RT總金額'].astype(str).str.replace(',', '').str.replace('$', ''), 
        errors='coerce'
    )
    
    # 按發票年月分組 - 使用已經建立的發票年月欄位
    monthly_summary = df.groupby('發票年月')['RT總金額_數值'].sum().reset_index()
    
    # 轉換為字典格式
    monthly_dict = {}
    for _, row in monthly_summary.iterrows():
        if pd.notna(row['發票年月']):
            year_month = row['發票年月']
            year = year_month.year
            month = year_month.month
            key = f"{year}年{month}月"
            amount = int(row['RT總金額_數值']) if not pd.isna(row['RT總金額_數值']) else 0
            monthly_dict[key] = amount
    
    return monthly_dict, monthly_summary, df

# 計算每月實際入帳金額
print(f"\n{'='*50}")
print("計算每月實際入帳金額")
print(f"{'='*50}")

actual_accounting_df = calculate_monthly_actual_accounting(df)

if len(actual_accounting_df) > 0:
    monthly_dict, monthly_summary, df_with_totals = get_monthly_summary(actual_accounting_df)
    
    # 顯示統計結果
    print(f"\n每月實際入帳金額統計:")
    print(f"{'='*30}")
    
    total_amount = 0
    for year_month, amount in sorted(monthly_dict.items()):
        print(f"{year_month}: ${amount:,}")
        total_amount += amount
    
    print(f"{'='*30}")
    print(f"總計: ${total_amount:,}")
    
    # 輸出JSON檔案
    json_filename = "monthly_actual_accounting.json"
    with open(json_filename, 'w', encoding='utf-8') as f:
        json.dump(monthly_dict, f, ensure_ascii=False, indent=2)
    
    print(f"\nJSON摘要已輸出至: {json_filename}")
    
    # 輸出詳細資料到TXT檔案
    detail_filename = "monthly_actual_accounting_detail.txt"
    with open(detail_filename, 'w', encoding='utf-8') as f:
        f.write("每月實際入帳金額詳細資料\n")
        f.write("="*50 + "\n\n")
        
        for year_month in sorted(monthly_dict.keys()):
            amount = monthly_dict[year_month]
            f.write(f"{year_month} 入帳金額: ${amount:,}\n")
            f.write("-"*30 + "\n")
            
            # 找出該月份的資料 - 使用正確的DataFrame
            period_str = year_month.replace('年', '-').replace('月', '')
            year, month = period_str.split('-')
            target_period = pd.Period(f"{year}-{month}")
            
            # 從有發票年月欄位的DataFrame中篩選
            month_data = df_with_totals[df_with_totals['發票年月'] == target_period]
            
            if len(month_data) > 0:
                output_columns = ['Id', 'ePR No.', 'PO No.', '品項', 'RT總金額', '發票月份']
                for idx, row in month_data.iterrows():
                    f.write(f"第 {idx+1} 筆:\n") # type: ignore
                    for col in output_columns:
                        if col in month_data.columns:
                            f.write(f"  {col}: {row[col]}\n")
                    if 'RT總金額_數值' in row:
                        f.write(f"  總價數值: ${row['RT總金額_數值']:,.0f}\n")
                    f.write("-" * 20 + "\n")
            else:
                f.write("無資料\n")
            f.write("\n")
        
        f.write(f"總計: ${total_amount:,}\n")
    
    print(f"詳細資料已輸出至: {detail_filename}")
    
    # 同時在螢幕顯示JSON內容
    print(f"\nJSON內容:")
    print(json.dumps(monthly_dict, ensure_ascii=False, indent=2))
    
else:
    print("無符合條件的入帳資料")

print(f"\n{'='*50}")
print("計算完成！")
print(f"{'='*50}")