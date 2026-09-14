import sys
import json
import pandas as pd # type: ignore
import struct
import os
import win32com.client # type: ignore
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.header import Header
from datetime import datetime
from email.utils import formataddr
from log_config import get_logger
# 分層 log：寫入 Log/mail_send/mail_send_yyyy_mm_dd.log（設定見 config.ini / log_config.py）
logger = get_logger('mail_send.normal')

class MailInfo:
    def __init__(self, sendfrom, sendfromname, sendto, sendcc, smtp_ip):
        self.sendfrom = sendfrom
        self.sendfromname = sendfromname
        self.sendto = sendto
        self.sendcc = sendcc
        # self.smtp = smtp
        self.smtp_ip = "10.12.10.31"  # 加入 SMTP IP 地址

def format_date_simple(date_str):
    if date_str and len(date_str) == 8:
        year = date_str[:4]
        month = str(int(date_str[4:6]))
        day = str(int(date_str[6:8]))
        return f"{year}/{month}/{day}"
    return date_str

# def read_configuration(mail_name, ccList):
#     # sMailTo = "Jackson_Lo@aseglobal.com" 
#     # sMailCc = "ASEK_ASSYIII_CIM_AS@aseglobal.com"
#     sMailTo = "RuiYing_Chan@aseglobal.com,Shugh_Lin@aseglobal.com" 
#     sMailCc = "RuiYing_Chan@aseglobal.com,Shugh_Lin@aseglobal.com" 
#     # sMailTo = f"Jackson_Lo@aseglobal.com,{mail_name}"
#     # sMailCc = f"ASEK_ASSYIII_CIM_AS@aseglobal.com,{ccList}"
#     return sMailCc, sMailTo


MAIL_RECIPIENTS_FILE = "static/data/mailRecipients.json"   # 與 app.py 同層執行，相對路徑即可
MAIL_DOMAIN = "@aseglobal.com"

def read_configuration(mail_name, ccList, recipients_file=MAIL_RECIPIENTS_FILE):
    # 固定人員從 <廠區>_mailRecipients.json 讀取（網頁「發送Mail固定人員管理」維護），路徑由 app.py 傳入
    with open(recipients_file, "r", encoding="utf-8") as f:
        fixed = json.load(f).get("purchase", {})

    fixed_to = [n + MAIL_DOMAIN for n in fixed.get("to", []) if n]
    fixed_cc = [n + MAIL_DOMAIN for n in fixed.get("cc", []) if n]

    sMailTo = ",".join(fixed_to + [mail_name] if mail_name else fixed_to)
    sMailCc = ",".join(fixed_cc + [ccList] if ccList else fixed_cc)
    return sMailCc, sMailTo

def send_mail(mailList, name, mail_name, ccList, recipients_file=MAIL_RECIPIENTS_FILE):
    sMailCc, sMailTo = read_configuration(mail_name, ccList, recipients_file)
    smtp_ip = "10.12.10.31"

    mysendinfo = MailInfo(
        "Purchase_Can@aseglobal.com",
        "請購專用信件",
        sMailTo,
        sMailCc,
        smtp_ip
    )

    # 針對 請購順序 做更動
    level = "急件" if mailList['請購順序'] == "2" else "一般件"

    em = MIMEMultipart()
    em['From'] = formataddr((
        str(Header(mysendinfo.sendfromname, 'utf-8')),
        mysendinfo.sendfrom
    ))
    em['To'] = mysendinfo.sendto
    em['CC'] = mysendinfo.sendcc

    to_list = [x.strip() for x in mysendinfo.sendto.split(',') if x.strip()]
    cc_list = [x.strip() for x in mysendinfo.sendcc.split(',') if x.strip()]

    em['Subject'] = str(Header(rf"<< ePR單 - {mailList['ePR No.']} >> 等級：{level} {mailList['請購項目']}需求請購申請 To. Jackson Sir & {name} (Security C)", 'utf-8'))

    # 📝 記錄郵件內容
    logger.info(f"📧 準備發送【{level}】請購通知郵件")
    logger.info(f"   收件人(To): {mysendinfo.sendto}")
    logger.info(f"   副本(CC): {mysendinfo.sendcc}")
    logger.info(f"   主旨: << ePR單 - {mailList['ePR No.']} >> 等級：{level} {mailList['請購項目']}需求請購申請 To. Jackson Sir & {name} (Security C)")
    logger.info(
        f"   內容: ePR No.={mailList.get('ePR No.', '')}, 需求者={mailList.get('需求者', '')}, "
        f"請購項目={mailList.get('請購項目', '')}, 需求原因={mailList.get('需求原因', '')}, "
        f"總金額={mailList.get('總金額', '')}, 需求日={mailList.get('需求日', '')}, "
        f"ePR狀態={mailList.get('Status', '')}, 簽核中關卡={mailList.get('簽核中關卡', '')}, 備註={mailList.get('備註', '')}"
    )



    # # 建立表格 HTML（若有 df）
    # table_html = ""
    # if df is not None and not df.empty:
    #     table_html = df.to_html(index=False, border=0, justify='center')

    # 表格樣式 + 內容
    htmlBody = rf"""
<html>
    <body>
        <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
                <td>
                    <font face="Arial" size="4"><b>Dear Jackson Sir</b></font>
                </td>
            </tr>
            <tr>
                <td height="10"></td>
            </tr>
            <tr>
                <td>
                    <font face="Arial" size="2">
                        ePR 單已送簽，避免造成後續累計過多，煩請經理撥空協助簽核，感謝。
                    </font>
                </td>
            </tr>
            <tr>
                <td height="10"></td>
            </tr>
            <tr>
                <td>
                    <font face="Arial" size="4">
                        <b>快速簽核 →</b> 
                        <font color="blue">
                            <a href="http://10.11.99.84:8090"><b>路徑</b></a>
                        </font>
                    </font>
                </td>
            </tr>
            <tr>
                <br>
                <br>
                <br>
            </tr>
            <tr>
                <td>
                    <font face="Arial" size="4">
                        <b>Dear {name}</b>
                    </font>
                </td>   
            </tr>
            <br>
            <tr>
                <td>
                    <font face="Arial" size="2">
                        已協助開立 ePR 單請購，待長官撥空協助簽核，謝謝
                    </font>
                    <br>
                    <font color="blue">
                        <b>
                            ( 打個廣告：請購表已上網頁化，下次請購請到網頁進行 Key In 喔!!! -  <font color="red">連結如下網址捷徑</font> )
                        </b>
                    </font>
                </td>   
            </tr>
            <tr>
                <td>
                    <font face="Arial" size="2">
                        <br>
                        <br>
                        <br>
                        <b>
                            <font color="blue">
                                請購申請相關附件報告 
                            </font>
                        </b>
                        <b>
                            <font color="red">
                                採購新公告：品名命名區分
                            </font>
                        </b>
                        <br>
                        <b>
                            <font color="blue">
                                1. 合作開發 (專用類)：
                            </font>
                        </b>
                        <b>
                            <font color="red">
                                A. 原廠 P / N 料號 + 品名 
                                <font color="blue">
                                    或
                                </font>
                                B. 更新類 Upgrade + 型號 + 改善工程名稱
                            </font>
                        <b>
                        <br>
                        <b>
                            <font color="blue">
                                2. 建議廠商 (市購品)：
                            </font>
                            <font color="red">
                                C. 廠牌 + 型號 + 品名  
                                <font color="blue">
                                或 
                                </font>
                                D. 加工件：圖號 + 品名 + 規格
                            </font>
                        </b>
                    </font>
                </td>   
            </tr>
            <br>
            <tr>
                <td>
                    <font face="Arial" size="4"><b>【請購報告】</b></font>
                </td>
            </tr>
            <tr>
                <td>
                    <font face="Arial" size="4" color="red"><b>報告資料夾路徑</b></font>
                </td>
            </tr>
            <tr>
                <td>
                    <font face="Arial" size="4" color="blue">
                        {mailList['報告路徑']}
                    </font>
                </td>
            </tr>
            <br>
            <br>
            <br>
            <tr>
                <td>
                    <font face="Arial" size="4" color="red"><b>【User Review】ePR 單 簽核進度路徑 → 改為預算請購表中的</b>
                        <font face="Arial" size="5" color="blue">
                            <b>
                                <a href="http://10.11.99.84:8090"><b>Link</b></a>
                            </b>
                            
                        </font>
                    </font>
                </td>
            </tr>
            <br>
            <br>
            <tr>
                <td>
                    <font face="Arial" size="4" color="block">
                        <b>
                            << ePR單 - {mailList['ePR No.']} >> 等級：{level} {mailList['請購項目']}需求請購申請 ( 共花費詳如下方總價格 ) 
                        </b>
                    </font>
                </td>
            </tr>
            <tr>
                <td>
                    <table width="100%" cellpadding="8" cellspacing="0" border="0" style="border-collapse: collapse; font-family: Arial, sans-serif; font-size: 14px; color: #333; border: 1px solid #ddd;">
                        <!-- 表頭 -->
                        <tr style="background-color: #4A90E2; color: white;">
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">開單狀態</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">WBS</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">請購順序</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">需求者</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">請購項目</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">需求原因</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">總金額</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">需求日</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">已開單日期</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">ePR No.</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">簽核中關卡</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">Status</td>
                            <td style="border: 1px solid #ddd; font-weight: bold; text-align: center; white-space: nowrap;">備註</td>
                        </tr>
                        <!-- 13個欄位 -->
                        <tr style="background-color: #f7fafd;">
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{mailList['開單狀態']}</td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{mailList['WBS']}</td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{mailList['請購順序']}</td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{mailList['需求者']}</td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{mailList['請購項目']}</td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{mailList['需求原因']}</td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{mailList['總金額']:,}</td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{format_date_simple(mailList['需求日'])}</td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{format_date_simple(mailList['已開單日期'])}</td>                          
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">
                                <a href="{mailList['進度追蹤超連結']}"><b>Link</b></a>
                            </td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{mailList['簽核中關卡']}</td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{mailList['Status']}</td>
                            <td style="border: 1px solid #ddd; text-align: center; white-space: nowrap;">{mailList['備註']}</td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
</html>
    """

    html_part = MIMEText(htmlBody, 'html', 'utf-8')
    em.attach(html_part)

    try:
        with smtplib.SMTP(mysendinfo.smtp_ip) as smtp:
            
            cc_list = [addr.strip() for addr in mysendinfo.sendcc.split(',') if addr.strip()]

            to_list = [addr.strip() for addr in mysendinfo.sendto.split(',') if addr.strip()]

            all_recipients = to_list + cc_list

            smtp.sendmail(
                mysendinfo.sendfrom,
                all_recipients,
                em.as_string()
            )
            
        logger.info(f"✅ 郵件發送成功 (ePR No.={mailList.get('ePR No.', '')}, 共 {len(all_recipients)} 位收件者)")

    except Exception as e:
        logger.error(f"❌ 郵件發送失敗 (ePR No.={mailList.get('ePR No.', '')}): {e}")


# # 測試調用的例子
# if __name__ == '__main__':
#     send_mail()