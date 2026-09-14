import pandas as pd
import datetime
import os

def get_unaccounted_amount(file_path):
    """
    統計尚未入帳的金額 (以今天日期為基準)
    條件：
    1. 有承諾交期
    2. 承諾交期 <= 今天
    3. 發票月份為空
    """
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
            (df["發票月份"] == "")
        )
        filtered = df[mask].copy()

        # 處理金額：優先用 RT總金額，其次用 總價，最後 fallback 數量*單價
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

        rows = filtered[[
            "PO No.", "Item", "品項", "Delivery Date 廠商承諾交期", 
            "SOD Qty 廠商承諾數量", "金額"
        ]].to_dict(orient="records")

        print(f"{'PO No.':<12}{'Item':<8}{'品項':<30}{'交期':<12}{'SOD Qty':<10}{'金額':<12}")
        for r in rows:
            print(f"{r['PO No.']:<12}{r['Item']:<8}{r['品項']:<30}{r['Delivery Date 廠商承諾交期']:<12}{r['SOD Qty 廠商承諾數量']:<10}{r['金額']:<12,.0f}")

        print(int(total_amount))

    except Exception as e:
        return {"file": file_path, "error": str(e)}
    

file_path = "Buyer_detaiL.csv"
get_unaccounted_amount(file_path)