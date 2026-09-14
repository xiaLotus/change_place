from bs4 import BeautifulSoup
import re
import quopri
from log_config import get_logger

# 分層 log：寫入 Log/acc_mail/acc_mail_yyyy_mm_dd.log（設定見 config.ini / log_config.py）
logger = get_logger('acc_mail.parse')


class accMHTMLParser:
    """MHTML 文件解析器"""
    
    def __init__(self):
        pass
    
    def parse_mhtml_file(self, file_content):
        """解析 MHTML 文件並提取表格資料"""
        try:
            logger.info("開始解析 MHTML 文件")
            
            # 提取 HTML 內容
            html_content = self.extract_html_from_mhtml(file_content)
            
            # 使用 BeautifulSoup 解析 HTML
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # 尋找資料表格
            table = self.find_data_table(soup)
            
            if not table:
                raise Exception("找不到資料表格")
            
            # 解析表格資料
            parsed_data = self.extract_table_data(table)
            
            logger.info(f"成功解析 {len(parsed_data)} 筆資料")
            return parsed_data
            
        except Exception as e:
            logger.error(f"解析 MHTML 文件時發生錯誤: {str(e)}")
            raise e
    
    def extract_html_from_mhtml(self, mhtml_content):
        """從 MHTML 內容中提取 HTML 部分"""
        try:
            # MHTML 文件包含多個部分，我們需要找到 HTML 部分
            # 通常 HTML 內容在 Content-Type: text/html 之後
            
            # 尋找 HTML 內容的開始位置
            html_start = mhtml_content.find('<!DOCTYPE html>')
            if html_start == -1:
                html_start = mhtml_content.find('<html')
            
            if html_start == -1:
                raise Exception("找不到 HTML 內容")
            
            # 尋找 HTML 內容的結束位置
            html_end = mhtml_content.find('</html>', html_start)
            if html_end != -1:
                html_end += 7  # 包含 </html>
                html_content = mhtml_content[html_start:html_end]
            else:
                # 如果找不到結束標籤，取從開始到下一個邊界
                boundary_pattern = r'------MultipartBoundary--[a-zA-Z0-9]+----'
                match = re.search(boundary_pattern, mhtml_content[html_start:])
                if match:
                    html_content = mhtml_content[html_start:html_start + match.start()]
                else:
                    html_content = mhtml_content[html_start:]
            
            return html_content
            
        except Exception as e:
            logger.error(f"提取 HTML 內容時發生錯誤: {str(e)}")
            raise e
    
    def find_data_table(self, soup):
        """尋找包含資料的表格"""
        # 嘗試多種選擇器來找到表格
        selectors = [
            'table[id*="GridView1"]',
            'table.table-bordered',
            'table[cellspacing="0"]',
            'table[rules="all"]',
            'table[border="1"]'
        ]
        
        for selector in selectors:
            table = soup.select_one(selector)
            if table:
                logger.info(f"使用選擇器 '{selector}' 找到表格")
                return table
        
        # 如果都找不到，嘗試找所有表格並選擇最大的
        tables = soup.find_all('table')
        if tables:
            # 選擇行數最多的表格
            largest_table = max(tables, key=lambda t: len(t.find_all('tr')))
            logger.info(f"選擇最大的表格，共有 {len(largest_table.find_all('tr'))} 行")
            return largest_table
        
        return None
    
    def extract_table_data(self, table):
        """提取表格資料"""
        parsed_data = []
        
        # 找到所有資料行（跳過表頭）
        rows = table.find_all('tr')
        
        # 分析表頭來確定欄位位置
        header_row = None
        for row in rows:
            if '收料號碼' in row.get_text() or 'RT No' in row.get_text():
                header_row = row
                break
        
        # 處理資料行
        for i, row in enumerate(rows):
            try:
                cells = row.find_all(['td', 'th'])
                
                # 跳過表頭行和空行
                if len(cells) < 10:
                    continue
                
                # 檢查是否為資料行（包含 checkbox 或資料）
                if not self.is_data_row(cells):
                    continue
                
                # 提取資料
                data = self.extract_row_data(cells, i)
                
                if data and data.get('rtNo'):  # 確保有必要的資料
                    parsed_data.append(data)
                    
            except Exception as e:
                logger.warning(f"解析第 {i} 行時發生錯誤: {str(e)}")
                continue
        
        return parsed_data
    
    def is_data_row(self, cells):
        """判斷是否為資料行"""
        # 檢查第一個 cell 是否包含 checkbox
        first_cell = cells[0] if cells else None
        if first_cell and first_cell.find('input', {'type': 'checkbox'}):
            return True
        
        # 或者檢查是否包含實際資料（RT No 格式）
        if len(cells) > 1:
            second_cell_text = cells[1].get_text(strip=True)
            if re.match(r'^\d{10}$', second_cell_text):  # RT No 格式
                return True
        
        return False
    
    def extract_row_data(self, cells, row_index):
        """提取單行資料"""
        try:
            # 根據表格結構提取資料
            data = {
                'id': row_index,
                'rtNo': self.extract_cell_text(cells[1]),
                'itemNo': self.extract_cell_text(cells[2]),
                'poNo': self.extract_cell_text(cells[3]),
                'poItem': self.extract_cell_text(cells[4]),
                'assetClass': self.extract_cell_text(cells[6]),
                'description': self.extract_cell_text(cells[7]),
                'quantity': self.extract_cell_text(cells[8]),
                'issueDate': self.extract_cell_text(cells[9]),
                'pickupPerson': self.extract_cell_text(cells[10]),
                'extendDueDate': self.extract_cell_text(cells[11]) if len(cells) > 11 else '',
                'status': 'pending'
            }
            
            # 解析科目指派（第5欄）
            item_assign_cell = cells[5]
            spans = item_assign_cell.find_all('span')
            if len(spans) >= 2:
                assign_code = spans[0].get_text(strip=True)
                assign_name = spans[1].get_text(strip=True).lstrip()
                
                # 解碼科目指派名稱
                assign_name = self.decode_quoted_printable(assign_name)
                
                data['itemAssign'] = assign_code
                data['itemAssignName'] = assign_name
            else:
                cell_text = item_assign_cell.get_text(strip=True)
                # 解碼整個儲存格內容
                cell_text = self.decode_quoted_printable(cell_text)
                
                if '.' in cell_text:
                    parts = cell_text.split('.', 1)
                    data['itemAssign'] = parts[0].strip()
                    data['itemAssignName'] = parts[1].strip()
                else:
                    data['itemAssign'] = cell_text
                    data['itemAssignName'] = ''
            
            return data
            
        except Exception as e:
            logger.error(f"提取行資料時發生錯誤: {str(e)}")
            return None
    
    def extract_cell_text(self, cell):
        """提取儲存格文字內容並處理編碼問題"""
        if not cell:
            return ''
        
        # 優先從 span 中提取
        span = cell.find('span')
        if span:
            text = span.get_text(strip=True)
        else:
            # 否則直接提取文字
            text = cell.get_text(strip=True)
        
        # 處理 Quoted-Printable 編碼
        text = self.decode_quoted_printable(text)
        
        return text
    
    def decode_quoted_printable(self, text):
        """解碼 Quoted-Printable 編碼的文字"""
        if not text:
            return text
        
        try:
            # 檢查是否包含 Quoted-Printable 編碼標記
            if '=' in text and re.search(r'=[0-9A-Fa-f]{2}', text):
                # 先處理 HTML 實體編碼
                text = text.replace('&amp;', '&')
                
                # 解碼 Quoted-Printable
                decoded_bytes = quopri.decodestring(text.encode('ascii'))
                
                # 嘗試多種編碼方式解碼
                for encoding in ['utf-8', 'big5', 'gb2312', 'cp950']:
                    try:
                        decoded_text = decoded_bytes.decode(encoding)
                        logger.info(f"成功使用 {encoding} 解碼: '{text}' -> '{decoded_text}'")
                        return decoded_text
                    except UnicodeDecodeError:
                        continue
                
                # 如果所有編碼都失敗，返回原文
                logger.warning(f"無法解碼文字: {text}")
                return text
            
            return text
            
        except Exception as e:
            logger.error(f"解碼文字時發生錯誤 '{text}': {str(e)}")
            return text