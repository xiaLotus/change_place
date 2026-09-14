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
# 分層 log：寫入 Log/acc_mail/acc_mail_yyyy_mm_dd.log（設定見 config.ini / log_config.py）
logger = get_logger('acc_mail.send')

class MailInfo:
    def __init__(self, sendfrom, sendfromname, sendto, sendcc, smtp_ip):
        self.sendfrom = sendfrom
        self.sendfromname = sendfromname
        self.sendto = sendto
        self.sendcc = sendcc
        self.smtp_ip = smtp_ip

def format_date_simple(date_str):
    if date_str and len(date_str) == 8:
        year = date_str[:4]
        month = str(int(date_str[4:6]))
        day = str(int(date_str[6:8]))
        return f"{year}/{month}/{day}"
    return date_str

# def read_configuration(mail_name, ccList):
#     sMailTo = f"{mail_name}" 
#     sMailCc = f"RuiYing_Chan@aseglobal.com,Otis_Wang@aseglobal.com,{ccList}" 
#     return sMailCc, sMailTo

MAIL_RECIPIENTS_FILE = "static/data/mailRecipients.json"
MAIL_DOMAIN = "@aseglobal.com"

def read_configuration(mail_name, ccList, recipients_file=MAIL_RECIPIENTS_FILE):
    # 路徑由 app.py 傳入 <廠區>_mailRecipients.json
    with open(recipients_file, "r", encoding="utf-8") as f:
        fixed = json.load(f).get("acceptance", {})

    fixed_cc = [n + MAIL_DOMAIN for n in fixed.get("cc", []) if n]

    sMailTo = f"{mail_name}"
    sMailCc = ",".join(fixed_cc + [ccList] if ccList else fixed_cc)
    return sMailCc, sMailTo

def build_table_rows(data_list):
    """動態生成表格行，支持不同筆數的資料"""
    rows = ""
    for item in data_list:
        # 處理狀態顯示邏輯
        material_status = "V" if item.get('materialStatus') == 'completed' else ""
        received_status = "V" if item.get('receivedStatus') == 'completed' else ""  
        photo_status = "V" if item.get('photoStatus') == 'provided' else ""
        
        rows += f"""
        <tr>
            <td style="border:1px solid #333; padding:6px; text-align:center; font-size:14px;">{item.get('user', '-')}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center; font-size:14px;">{item.get('eprNo', '-')}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center; font-size:14px;">{item.get('poNo', '-')}</td>
            <td style="border:1px solid #333; padding:6px; text-align:left; font-size:14px; white-space:normal; word-break:break-word;">
                {item.get('description', '-')}
            </td>
            <td style="border:1px solid #333; padding:6px; text-align:center; font-size:14px;">{item.get('quantity', '-')}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center; font-size:14px;">{item.get('totalQuantity', item.get('quantity', '-'))}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center; font-size:14px; font-weight:bold;">{item.get('issueDate', '-')}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center; font-size:14px; font-weight:bold;">{item.get('pickupPerson', '-')}</td>
            <!-- 未領料 -->
            <td style="border:1px solid #333; padding:6px; text-align:center; font-size:14px; width:33.33%; font-weight:bold;">{material_status}</td>
            <!-- 已領料 -->
            <td style="border:1px solid #333; padding:6px; text-align:center; font-size:14px; width:33.33%; font-weight:bold;">{received_status}</td>
            <!-- 照片提供 -->
            <td style="border:1px solid #333; padding:6px; text-align:center; font-size:14px; width:33.33%; font-weight:bold;">{photo_status}</td>
            <!-- 備註 -->
            <td style="border:1px solid #333; padding:6px; text-align:left; font-size:14px; white-space:normal; word-break:break-word; font-weight:bold;">
                {item.get('remarks', '設備修改請, 請 User 提供照片結案')}
            </td>
        </tr>"""
    return rows

def send_mail(mailList, mail_name, ccList, po_str, to_str, greeting="Dear ", recipients_file=MAIL_RECIPIENTS_FILE):
    sMailCc, sMailTo = read_configuration(mail_name, ccList, recipients_file)
    smtp_ip = "10.12.10.31"

    mysendinfo = MailInfo(
        "Purchase_Can@aseglobal.com",
        "領料驗收 專用信件",
        sMailTo,
        sMailCc,
        smtp_ip
    )

    em = MIMEMultipart()
    em['From'] = formataddr((
        str(Header(mysendinfo.sendfromname, 'utf-8')),
        mysendinfo.sendfrom
    ))

    # 設定收件者與副本收件者
    em['To'] = mysendinfo.sendto
    em['CC'] = mysendinfo.sendcc

    to_list = [x.strip() for x in mysendinfo.sendto.split(',') if x.strip()]
    cc_list = [x.strip() for x in mysendinfo.sendcc.split(',') if x.strip()]

    # 根據 mailList 狀態判斷標題
    statuses = [(
        item.get('materialStatus'),
        item.get('receivedStatus'),
        item.get('photoStatus')
    ) for item in mailList]

    # 判斷邏輯
    all_received = all(s[1] == 'completed' for s in statuses)
    all_material = all(s[0] == 'pending' for s in statuses)

    po_numbers = list({item.get('poNo', '-') for item in mailList if item.get('poNo')})
    po_str = "、".join(po_numbers)

    if all_received:
        subject_title = f"<<驗收通知>> 照片請自行拍照上傳論壇，煩請 ERT 單附報告驗收 【PO No. {po_str}】 To: {to_str}"
    elif all_material:
        subject_title = f"<<領料通知>> 煩請開立攜出單至 K7-1F 物流中心領料【PO No. {po_str}】 To: {to_str}"
    else:
        subject_title = f"<<領料 & 驗收通知>> 煩請開立攜出單至 K7-1F 物流中心領料 & 照片請自行拍照上傳論壇，煩請 ERT 單附報告驗收【PO No. {po_str}】 To: {to_str}"

    em['Subject'] = subject_title

    # 📝 記錄郵件內容
    logger.info(f"📧 準備發送驗收/領料通知郵件")
    logger.info(f"   收件人(To): {mysendinfo.sendto}")
    logger.info(f"   副本(CC): {mysendinfo.sendcc}")
    logger.info(f"   主旨: {subject_title}")
    logger.info(f"   內容: 共 {len(mailList)} 筆料件，PO No.: {po_str}")
    for _i, _item in enumerate(mailList, 1):
        logger.info(
            f"   [{_i:02d}] PO={_item.get('poNo', '')}, Item={_item.get('itemNo', '')}, "
            f"品項={_item.get('description', '')}, 數量={_item.get('quantity', '')}, "
            f"RT No.={_item.get('rtNo', '')}, 需求者={_item.get('user', '')}, "
            f"ePR No.={_item.get('eprNo', '')}, 領料人={_item.get('pickupPerson', '')}, 備註={_item.get('remarks', '')}"
        )

    # 動態生成表格行
    table_rows = build_table_rows(mailList)

    # 完整的郵件HTML模板（包含說明文字和表格）
    htmlBody = f"""
        <html>
            <body>
                <div style="font-family:Arial; font-size:14px; margin-bottom:20px;">
                    <div style="font-weight:bold; font-size:20px; color:black;">
                        {greeting} ~ 相關資料已執行驗收，ERT 單先直接轉給您驗收，謝謝。
                    </div>
                    <div style="font-size:14px; line-height:1.2; margin-bottom:25px;">
                        <p style="margin:2px 0;">請參考下方【<span style="color:red;">CIM 內部需求者與相關資訊</span>】備註</p>
                        <p style="margin:2px 0;"><span style="color:red; font-size:16px; font-weight:bold;">未領料</span> 請看【<span style="color:red; font-size:16px; font-weight:bold;">最後領料日</span>】前參考下方【<span style="color:red; font-size:16px; font-weight:bold;">領料流程</span>】至<span style="color:red; font-size:16px; font-weight:bold;">K7 物流中心</span> 領取料件</p>
                        <p style="margin:2px 0;"><span style="color:blue; font-size:16px; font-weight:bold;">已領料</span> 請參考下方【<span style="color:blue; font-size:16px; font-weight:bold;">驗收流程</span>】自行拍照驗收，照片請<span style="color:red; font-size:16px; font-weight:bold;">上傳論壇或附在報告中</span>，好讓我可以下載後結案</p>
                        <p style="margin:2px 0; color:blue;">PS. 提醒大家，零件頻率 1 個零件<span style="color:red;">附上傳數量照片</span>（1 張）、<span style="color:red;">不同角度照片</span>（多張）、<span style="color:red;">零件+型號</span>（1 張）讓我可以清楚辨識是那些零件</p>
                    </div>
                    <tr>
                        <br>
                        <br>
                    </tr>
                    <div style="margin-bottom:20px;">
                        <h3 style="color:blue; margin:5px 0;">&lt;&lt; 領料&驗收公告-20230502 &gt;&gt;</h3>
                        <div style="font-size:14px; line-height:1.2;">
                            <p style="margin:2px 0;">目前 ERT驗收設備需要提供驗收報告(<span style="color:red;">幫各位做好驗收報告模板工具如附件</span>)</p>
                            <p style="margin:2px 0;">另一方面已經幫大家將智能表單導入【<span style="color:red;">照片不落地</span>】方便拍照</p>
                            <p style="margin:2px 0;">改成 K11-10F 備品室指定位置拍照上傳論壇</p>
                            <p style="margin:2px 0;">照各位協調試辦一下，請參考下方 <span style="color:red;">New！驗收流程</span>，看看成效如何再滾動調整</p>
                        </div>
                    </div>
                    <tr>
                        <br>
                        <br>
                    </tr>
                    <div style="margin-bottom:20px;">
                        <h3 style="color:blue; margin:5px 0;">&lt;&lt; 領料流程 &gt;&gt;</h3>
                        <div style="font-size:14px; line-height:1.2;">
                            <p style="margin:2px 0;"><span style="color:blue;">開立需出單 → K7 物流中心領料登收 → K7 警衛刷出 → K11 警衛刷入 → 驗收新流程</span><span style="color:green;">(看「王柏翰」字樣的貨，請簽名一併取回)</span><span style="color:blue;"> → 結案</span></p>
                        </div>
                    </div>
                    <tr>
                        <br>
                        <br>
                    </tr>
                    <div style="margin-bottom:20px;">
                        <h3 style="color:red; margin:5px 0;">&lt;&lt; New！驗收新流程 &gt;&gt; <span style="color:blue;">藍字是新增部分</span></h3>
                        <div style="font-size:14px; line-height:1.2; color:green;">
                            <p style="margin:2px 0;">1. 東西到了，Otis 通知工程師去拿（<span style="color:red;">需求者</span>）</p>
                            <p style="margin:2px 0;">2. 拿回來確認內容物（<span style="color:red;">需求者</span>）</p>
                            <p style="margin:2px 0;">3. 拍照上傳論壇（<span style="color:red;">AlexMY</span>）→ <span style="color:blue;">改成 K11-10F 備品室指定位置拍照上傳論壇</span>（<span style="color:red;">需求者）PS. 設備修改類請拍現場完工照片除外</span></p>
                            <p style="margin:2px 0;">4.1 CIM 備品系統入庫建檔或更新維護（<span style="color:red;">AlexMY</span>）2次內　　　　4.2 表統驗收流程轉程 ERT 單（<span style="color:red;">Otis</span>）</p>
                            <p style="margin:2px 0;">5. 編輯<span style="color:blue;">驗收報告</span>（<span style="color:red;">需求者，參考如下附件工具</span>） 並加簽 <span style="color:blue;">Junyi sir</span> → 結案</p>
                        </div>
                    </div>
                    <tr>
                        <a href="http://cim300/data/attachment/forum/202509/08/201948ylaqgacqiksadldc.jpg">
                            <span style="color:blue; font-size:20px; font-weight:bold;">
                                >>>點我查看驗收新增條件<<<
                            </span>
                        </a>
                    </tr>
                    <tr>
                        <br>
                        <br>
                    </tr>
                    <div style="margin-bottom:20px;">
                        <div style="font-size:14px; line-height:1.2; color:green;">
                            <p style="margin:2px 0;">PS. 退換貨：Otis Mail 領料通知給需求者去交領取料件<span style="color:red;">（需求工程師 或 代理人）</span>自行驗收型號數量 → <span style="color:red;">驗收型號數量有誤通知採購去聯繫廠商進行退換貨</span> → 確認退換貨後參考 <span style="color:red;">New！驗收新流程</span> → 結案</p>
                            <p style="margin:2px 0;">以後系統化制訂這些規則，讓各位方便使用</p>
                        </div>
                    </div>
                    <tr>
                        <br>
                        <br>
                    </tr>
                    <p style="font-size:18px; font-weight:bold;">CIM 內部需求者與相關資訊（<span style="color:blue;">整合ERT 驗收單相關資訊</span>）<span style="color:red;">P.S. 領料驗收流程三步驟：未領料、已領料、照片提供<span></p>
                </div>

                <table width="100%" cellpadding="8" cellspacing="0" border="0" style="border-collapse: collapse; font-family: Arial, sans-serif; font-size: 14px; color: #333; border: 1px solid #ddd;">
                    <thead>
                        <tr>
                            <!-- User -->
                            <td style="border:1px solid #333; padding:6px; background-color:#4A90E2; color:white; font-size:16px; text-align:center; width:8%;">
                                User
                            </td>
                            <!-- ePR No. -->
                            <td style="border:1px solid #333; padding:6px; background-color:#4A90E2; color:white; font-size:16px; text-align:center; width:10%;">
                                ePR No.
                            </td>
                            <!-- PO No. -->
                            <td style="border:1px solid #333; padding:6px; background-color:#4A90E2; color:white; font-size:16px; text-align:center; width:10%;">
                                PO No.
                            </td>
                            <!-- 品項 -->
                            <td style="border:1px solid #333; padding:6px; background-color:#4A90E2; color:white; font-size:16px; text-align:center; white-space:normal; word-break:break-word; width:25%;">
                                品項
                            </td>
                            <!-- 數量 -->
                            <td style="border:1px solid #333; padding:6px; background-color:#4A90E2; color:white; font-size:16px; text-align:center; width:6%;">
                                數量
                            </td>
                            <!-- 總數 -->
                            <td style="border:1px solid #333; padding:6px; background-color:#4A90E2; color:white; font-size:16px; text-align:center; width:6%;">
                                總數
                            </td>
                            <!-- 收料日期 -->
                            <td style="border:1px solid #333; padding:6px; background-color:#4A90E2; color:white; font-size:16px; text-align:center; font-weight:bold; width:8%;">
                                收料日期
                            </td>
                            <!-- 取件者 -->
                            <td style="border:1px solid #333; padding:6px; background-color:#4A90E2; color:white; font-size:16px; text-align:center; font-weight:bold; width:8%;">
                                取件者
                            </td>
                            <td style="border:1px solid #333; padding:6px; background-color:#FAF3E0; color:red; font-size:16px; text-align:center; white-space:normal; font-weight:bold; word-break:break-word; width:14%;">
                                未領料
                            </td>
                            <td style="border:1px solid #333; padding:6px; background-color:#4A90E2; color:white; font-size:16px; text-align:center; white-space:normal; font-weight:bold; word-break:break-word; width:14%;">
                                已領料
                            </td>
                            <td style="border:1px solid #333; padding:6px; background-color:#e0e0e0; color:red; font-size:16px; text-align:center; white-space:normal; font-weight:bold; word-break:break-word; width:14%;">
                                照片提供
                            </td>
                            <!-- 備註 -->
                            <td style="border:1px solid #333; padding:6px; background-color:#4A90E2; color:white; font-size:16px; text-align:center; white-space:normal; font-weight:bold; word-break:break-word; width:14%;">
                                備註
                            </td>
                        </tr>
                    </thead>
                    <tbody>
                        {table_rows}
                    </tbody>
                </table>
            </body>
        </html>
    """

    html_part = MIMEText(htmlBody, 'html', 'utf-8')
    em.attach(html_part)
    # print(html_part)


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
            
        logger.info(f"✅ 郵件發送成功 (PO No.={po_str}, 共 {len(mailList)} 筆料件, {len(all_recipients)} 位收件者)")

    except Exception as e:
        logger.error(f"❌ 郵件發送失敗 (PO No.={po_str}): {e}")

    # send_mail(sample_data, "測試", "RuiYing_Chan@aseglobal.com,RayBao_Chen@aseglobal.com,JieSyuan_Chiang@aseglobal.com", "", "", "")

# if __name__ == "__main__":
#     send_mail([{'assetClass': '', 'description': '保護傘七切六座PU-3763S(2.7M)9尺延長線', 'extendDueDate': '', 'id': 1, 'issueDate': '2025/10/3', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0001', 'pickupPerson': '王淑怡/14168', 'poItem': '00020', 'poNo': 'A000421817', 'quantity': '10', 'rtNo': '5000402209', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '10', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '保護傘七切六座PU-3763S(4.5M)15尺延長線', 'extendDueDate': '', 'id': 2, 'issueDate': '2025/10/3', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0002', 'pickupPerson': '王淑怡/14168', 'poItem': '00030', 'poNo': 'A000421817', 'quantity': '6', 'rtNo': '5000402209', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '6', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '保護傘七切六座PU-3763S(1.8M)6尺延長線', 'extendDueDate': '', 'id': 3, 'issueDate': '2025/10/3', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0003', 'pickupPerson': '王淑怡/14168', 'poItem': '00010', 'poNo': 'A000421817', 'quantity': '4', 'rtNo': '5000402209', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '4', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': 'ESD標示膠帶 30mmX33M黃黑色', 'extendDueDate': '', 'id': 4, 'issueDate': '2025/10/9', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0001', 'pickupPerson': '王淑怡/14168', 'poItem': '00010', 'poNo': 'A000421770', 'quantity': '5', 'rtNo': '5000412517', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '5', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': 'CyberLink PowerDirector 365', 'extendDueDate': '', 'id': 5, 'issueDate': '2025/10/9', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0001', 'pickupPerson': 'C2', 'poItem': '00010', 'poNo': '6100822075', 'quantity': '1', 'rtNo': '5000413507', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '1', 'remarks': '設 備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': 'Keyence SR-X100W 二維條碼組', 'extendDueDate': '', 'id': 6, 'issueDate': '2025/10/13', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0001', 'pickupPerson': 'E2', 'poItem': '00010', 'poNo': '6100821812', 'quantity': '1', 'rtNo': '5000417227', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '1', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '無塵工具包 23*10*10 cm', 'extendDueDate': '', 'id': 7, 'issueDate': '2025/10/14', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0001', 'pickupPerson': '王淑怡/14168', 'poItem': '00010', 'poNo': 'A000421771', 'quantity': '12', 'rtNo': '5000417874', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '12', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': 'Sharp AQUOS Wish4保護貼(全透明玻璃膜)', 'extendDueDate': '', 'id': 8, 'issueDate': '2025/10/14', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0001', 'pickupPerson': '王柏翰', 'poItem': '00010', 'poNo': '6100820115', 'quantity': '20', 'rtNo': '5000419410', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '趙祥富', 'eprNo': '2509010389', 'totalQuantity': '20', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': 'Sharp AQUOS Wish4五金鎧甲防摔殼', 'extendDueDate': '', 'id': 9, 'issueDate': '2025/10/14', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0002', 'pickupPerson': '王柏翰', 'poItem': '00020', 'poNo': '6100820115', 'quantity': '20', 'rtNo': '5000419410', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '趙祥富', 'eprNo': '2509010389', 'totalQuantity': '20', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '夾鏈袋  11號400x280MM  100入', 'extendDueDate': '', 'id': 10, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0001', 'pickupPerson': '王淑怡/14168', 'poItem': '00010', 'poNo': 'A000421829', 'quantity': '5', 'rtNo': '5000419964', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '5', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '夾鏈袋  4號 85x120MM 100入', 'extendDueDate': '', 'id': 11, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0002', 'pickupPerson': '王淑怡/14168', 'poItem': '00020', 'poNo': 'A000421829', 'quantity': '5', 'rtNo': '5000419964', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '5', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '夾鏈袋  5號 100x140MM 100入', 'extendDueDate': '', 'id': 12, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0003', 'pickupPerson': '王淑怡/14168', 'poItem': '00030', 'poNo': 'A000421829', 'quantity': '5', 'rtNo': '5000419964', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '5', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '夾鏈袋 12號  340x450MM  100入', 'extendDueDate': '', 'id': 13, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0004', 'pickupPerson': '王淑怡/14168', 'poItem': '00040', 'poNo': 'A000421829', 'quantity': '5', 'rtNo': '5000419964', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '5', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': 'LIFE NO.3104  充電式紅光雷射筆', 'extendDueDate': '', 'id': 14, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0005', 'pickupPerson': '王淑怡/14168', 'poItem': '00050', 'poNo': 'A000421829', 'quantity': '2', 'rtNo': '5000419964', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '2', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '3M 3秒膠  2g', 'extendDueDate': '', 'id': 15, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0006', 'pickupPerson': '王淑怡/14168', 'poItem': '00060', 'poNo': 'A000421829', 'quantity': '20', 'rtNo': '5000419964', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '20', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': 'CR2032  水銀電池 1入', 'extendDueDate': '', 'id': 16, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0007', 'pickupPerson': '王淑怡/14168', 'poItem': '00070', 'poNo': 'A000421829', 'quantity': '6', 'rtNo': '5000419964', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '6', 'remarks': '設備修改類, 請 User  提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '絕緣膠帶  19mmx20Y', 'extendDueDate': '', 'id': 17, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0008', 'pickupPerson': '王淑怡/14168', 'poItem': '00080', 'poNo': 'A000421829', 'quantity': '70', 'rtNo': '5000419964', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '查無此資訊', 'eprNo': '查無此資訊', 'totalQuantity': '70', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '東方馬達 PKE566AC-FC20RA 5相步進馬達', 'extendDueDate': '', 'id': 18, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0001', 'pickupPerson': 'AB門', 'poItem': '00010', 'poNo': '6100815689', 'quantity': '2', 'rtNo': '5000421276', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '郭任群', 'eprNo': '2508200163', 'totalQuantity': '2', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': '東方馬達 CC050VPR RKII系列電纜線', 'extendDueDate': '', 'id': 19, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0002', 'pickupPerson': 'AB門', 'poItem': '00020', 'poNo': '6100815689', 'quantity': '2', 'rtNo': '5000421276', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '郭任群', 'eprNo': '2508200163', 'totalQuantity': '2', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': 'CIM K25-8F 手臂整合 Fork 特仕版', 'extendDueDate': '', 'id': 20, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0001', 'pickupPerson': '魏劭宇', 'poItem': '00010', 'poNo': '6100817457', 'quantity': '1', 'rtNo': '5000421721', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '魏劭宇', 'eprNo': '2508250397', 'totalQuantity': '1', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}, {'assetClass': '', 'description': 'CIM K25-8F 新增設備護蓋加固補強', 'extendDueDate': '', 'id': 21, 'issueDate': '2025/10/15', 'itemAssign': 'K', 'itemAssignName': '費用', 'itemNo': '0002', 'pickupPerson': '魏劭宇', 'poItem': '00020', 'poNo': '6100817457', 'quantity': '1', 'rtNo': '5000421721', 'status': 'pending', 'materialStatus': 'pending', 'receivedStatus': 'completed', 'selected': True, 'user': '魏劭宇', 'eprNo': '2508250397', 'totalQuantity': '1', 'remarks': '設備修改類, 請 User 提供照片結案', 'showTextarea': False, 'photoStatus': 'pending'}],
#                 "RuiYing_Chan@aseglobal.com,RayBao_Chen@aseglobal.com,JieSyuan_Chiang@aseglobal.com",  # mail_name
#                 "RuiYing_Chan@aseglobal.com",  # ccList 如果沒有副本收件人就填 ""
#                 "A000421770、A000421817、6100820115、6100815689、6100821812、6100822075、A000421771、6100817457、A000421829",  # po_str
#                 "Erix, Zilong, ShaoYu",  # to_str
#                 "Dear Zilong, Erix, ShaoYu"  # greeting（可略，預設是 "Dear "）
#             )