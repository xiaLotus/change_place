import pandas as pd
import datetime
import os

def get_next_month_amount(file_path):
    """
    計算下個月的承諾交期總金額
    條件：
    1. 有承諾交期
    2. 承諾交期落在「下個月」
    3. 發票月份為空
    4. WBS 為空
    5. 優先用 RT總金額，否則用 總價
    """
    if not os.path.exists(file_path):
        return {"file": file_path, "next_month_amount": 0, "rows": []}

    try:
        df = pd.read_csv(file_path, encoding="utf-8-sig", dtype=str).fillna("")

        # === 金額欄位清理（去掉千分位逗號）===
        def clean_amount(series):
            return (
                series.astype(str)
                .str.replace(",", "", regex=False)
                .str.strip()
                .replace("", "0")
            )

        if "RT總金額" in df.columns:
            df["RT總金額"] = pd.to_numeric(clean_amount(df["RT總金額"]), errors="coerce").fillna(0)
        else:
            df["RT總金額"] = 0

        if "總價" in df.columns:
            df["總價"] = pd.to_numeric(clean_amount(df["總價"]), errors="coerce").fillna(0)
        else:
            df["總價"] = 0

        # 優先用 RT總金額
        df["計算金額"] = df["RT總金額"].where(df["RT總金額"] > 0, df["總價"])

        # === 日期清理 ===
        def clean_date(val):
            val = str(val).strip().replace("/", "").replace("-", "")
            return val if val.isdigit() and len(val) == 8 else ""

        df["交期_clean"] = df["Delivery Date 廠商承諾交期"].apply(clean_date)

        # === 取得下個月區間 ===
        today = datetime.date.today()
        first_day_next_month = (today.replace(day=1) + datetime.timedelta(days=32)).replace(day=1)
        last_day_next_month = (first_day_next_month.replace(day=28) + datetime.timedelta(days=4)).replace(day=1) - datetime.timedelta(days=1)

        start = int(first_day_next_month.strftime("%Y%m%d"))
        end = int(last_day_next_month.strftime("%Y%m%d"))

        # === 篩選符合條件 ===
        df["交期_int"] = pd.to_numeric(df["交期_clean"], errors="coerce")

        next_month_df = df[
            (df["交期_int"] >= start) & 
            (df["交期_int"] <= end) & 
            (df["發票月份"].astype(str).str.strip() == "") &
            (df["WBS"].astype(str).str.strip() == "")
        ].copy()

        # === 計算總額 ===
        next_month_df["計算金額"] = next_month_df["計算金額"].astype(int)
        total_amount = next_month_df["計算金額"].sum()

        # 只保留必要欄位
        cols = ["ePR No.", "PO No.", "品項", "計算金額", "Delivery Date 廠商承諾交期", "WBS"]
        output_rows = next_month_df[cols].to_dict(orient="records")

        return {
            "file": file_path,
            "next_month_amount": total_amount,
            "rows": output_rows
        }

    except Exception as e:
        return {"file": file_path, "error": str(e), "next_month_amount": 0, "rows": []}


# === 主程式輸出 ===
result = get_next_month_amount("Buyer_detail.csv")

print("📑 共", len(result["rows"]), "筆資料")
print("="*50)

running_total = 0
for i, row in enumerate(result["rows"], 1):
    amt = int(row["計算金額"])
    running_total += amt
    print(f"第 {i} 筆： ePR={row['ePR No.']}, PO={row['PO No.']}, 品項={row['品項']}, 金額={amt:,}, 承諾交期={row['Delivery Date 廠商承諾交期']}, WBS={row['WBS']}")

print("="*50)
print("✅ 逐筆累加總金額:", f"{running_total:,}")
print("✅ DataFrame 計算總金額:", f"{result['next_month_amount']:,}")

# === 輸出 CSV ===
output_file = "next_month_report.csv"
df_out = pd.DataFrame(result["rows"])

# 加一行 TOTAL
total_row = {
    "ePR No.": "TOTAL",
    "PO No.": "",
    "品項": "",
    "計算金額": result["next_month_amount"],
    "Delivery Date 廠商承諾交期": "",
    "WBS": ""
}
df_out = pd.concat([df_out, pd.DataFrame([total_row])], ignore_index=True)

df_out.to_csv(output_file, index=False, encoding="utf-8-sig")
print(f"📂 已輸出報表到 {output_file}")