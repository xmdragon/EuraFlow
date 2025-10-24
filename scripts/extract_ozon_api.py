#!/usr/bin/env python3
"""
OZON API文档提取工具
从HTML文档中提取所有API接口并转换为Markdown格式
"""

import os
import re
import json
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Dict, List, Optional, Tuple

# 配置
HTML_FILE = "/mnt/e/pics/ozon.api.html"
OUTPUT_DIR = "docs/OzonAPI"


def extract_version_from_path(path: str) -> str:
    """从API路径中提取版本号"""
    match = re.search(r'/v(\d+)/', path)
    if match:
        return f"v{match.group(1)}"
    return ""


def sanitize_filename(name: str) -> str:
    """清理文件名中的非法字符"""
    # 替换或删除非法字符
    name = name.replace('/', '_')
    name = name.replace('\\', '_')
    name = name.replace('?', '')
    name = name.replace('*', '')
    name = name.replace(':', '-')
    name = name.replace('<', '')
    name = name.replace('>', '')
    name = name.replace('|', '-')
    name = name.replace('"', '')
    # 限制长度
    if len(name) > 100:
        name = name[:100]
    return name.strip()


def extract_text(element) -> str:
    """提取元素的纯文本内容"""
    if element is None:
        return ""
    return element.get_text(strip=True)


def extract_table_to_markdown(table) -> str:
    """将HTML表格转换为Markdown表格"""
    if table is None:
        return ""

    rows = table.find_all('tr')
    if not rows:
        return ""

    markdown = []

    for i, row in enumerate(rows):
        cells = row.find_all(['td', 'th'])
        if not cells:
            continue

        # 提取单元格内容
        cell_contents = []
        for cell in cells:
            # 每个td可能包含多个子元素，需要分别提取
            # 查找参数名
            param_name_span = cell.find('span', class_='sc-ieebsP')
            if param_name_span:
                # 这是参数名列
                param_name = extract_text(param_name_span.find_next_sibling('span'))
            else:
                param_name = None

            # 查找required标记
            required_div = cell.find('div', class_=re.compile('sc-jUotMc'))
            if required_div:
                required = extract_text(required_div).strip()
            else:
                required = None

            # 如果有参数名和required，组合它们
            if param_name and required:
                cell_contents.append(param_name)
                cell_contents.append(required)
            elif param_name:
                cell_contents.append(param_name)
            else:
                # 普通单元格，查找类型和描述
                type_span = cell.find('span', class_=re.compile('sc-kHOZQx.*sc-dtMiey|sc-hOGjNT'))
                description_div = cell.find('div', class_=re.compile('sc-efQUeY.*sc-hUpaWb'))

                if type_span or description_div:
                    # 类型
                    if type_span:
                        cell_type = extract_text(type_span)
                        cell_contents.append(cell_type)

                    # 描述
                    if description_div:
                        desc = extract_text(description_div)
                        if desc:
                            cell_contents.append(desc)
                else:
                    # 作为普通单元格处理
                    text = extract_text(cell)
                    if text:
                        # 转义Markdown特殊字符
                        text = text.replace('|', '\\|')
                        cell_contents.append(text)

        # 如果没有提取到内容，跳过这一行
        if not cell_contents:
            continue

        # 构建Markdown行
        markdown.append('| ' + ' | '.join(cell_contents) + ' |')

        # 第一行后添加分隔符
        if i == 0:
            markdown.append('|' + '|'.join(['---' for _ in cell_contents]) + '|')

    return '\n'.join(markdown)


def extract_json_from_code(element) -> str:
    """从代码元素中提取JSON"""
    if element is None:
        return ""

    # 查找JSON代码块
    code = element.find('code')
    if code:
        # 提取文本并清理
        text = code.get_text()
        # 尝试格式化JSON
        try:
            # 移除可能的HTML实体
            text = text.strip()
            # 如果是有效JSON,格式化它
            parsed = json.loads(text)
            return json.dumps(parsed, indent=2, ensure_ascii=False)
        except:
            # 如果不是有效JSON,返回原始文本
            return text

    return extract_text(element)


def extract_api_info(soup: BeautifulSoup, operation_id: str) -> Optional[Dict]:
    """提取单个API的详细信息"""

    # 查找API详情div
    detail_div = soup.find('div', {'id': operation_id})
    if not detail_div:
        print(f"  ⚠️  未找到详情: {operation_id}")
        return None

    api_info = {
        'operation_id': operation_id,
        'title': '',
        'method': '',
        'path': '',
        'description': '',
        'header_params': '',
        'request_body': '',
        'request_example': '',
        'responses': []
    }

    # 提取标题
    h2 = detail_div.find('h2')
    if h2:
        api_info['title'] = extract_text(h2)

    # 提取HTTP方法和路径
    http_verb = detail_div.find('span', class_=re.compile('http-verb'))
    if http_verb:
        api_info['method'] = extract_text(http_verb).upper()

    path_div = detail_div.find('div', class_=re.compile('sc-gIBoTZ|gNSSYl'))
    if path_div:
        api_info['path'] = extract_text(path_div)

    # 提取描述
    desc_p = detail_div.find('p')
    if desc_p:
        api_info['description'] = extract_text(desc_p)

    # 提取Header参数
    header_section = detail_div.find('h5', string=re.compile('header Parameters'))
    if header_section:
        table = header_section.find_next('table')
        if table:
            api_info['header_params'] = extract_table_to_markdown(table)

    # 提取请求体
    request_body_section = detail_div.find('h5', string=re.compile('Request Body schema'))
    if request_body_section:
        # 查找请求体表格
        table = request_body_section.find_next('table')
        if table:
            api_info['request_body'] = extract_table_to_markdown(table)

    # 提取请求示例
    request_example_h3 = detail_div.find('h3', string=re.compile('请求范例'))
    if request_example_h3:
        example_div = request_example_h3.find_next('div', class_=re.compile('redoc-json'))
        if example_div:
            api_info['request_example'] = extract_json_from_code(example_div)

    # 提取响应
    response_example_h3 = detail_div.find('h3', string=re.compile('回复范例'))
    if response_example_h3:
        # 查找所有响应标签页
        tab_panels = response_example_h3.find_next_siblings('div', class_=re.compile('react-tabs__tab-panel'))
        for panel in tab_panels:
            response_div = panel.find('div', class_=re.compile('redoc-json'))
            if response_div:
                response_code = extract_json_from_code(response_div)
                # 尝试从标签中获取状态码
                tab_list = response_example_h3.find_previous('ul', class_=re.compile('react-tabs__tab-list'))
                status_code = "200"
                if tab_list:
                    tabs = tab_list.find_all('li', class_=re.compile('tab-'))
                    if tabs:
                        status_code = extract_text(tabs[0])

                api_info['responses'].append({
                    'status': status_code,
                    'example': response_code
                })
                break

    # 提取响应结构
    response_section = detail_div.find('h5', string=re.compile('Response Schema'))
    if response_section:
        table = response_section.find_next('table')
        if table:
            api_info['response_schema'] = extract_table_to_markdown(table)
        else:
            api_info['response_schema'] = ''

    return api_info


def format_markdown(api_info: Dict) -> str:
    """将API信息格式化为Markdown"""

    md = []

    # 标题
    md.append(f"# {api_info['title']}\n")

    # 接口信息
    md.append("## 接口信息\n")
    md.append(f"- **HTTP方法**: `{api_info['method']}`")
    md.append(f"- **API路径**: `{api_info['path']}`")
    md.append(f"- **操作ID**: `{api_info['operation_id']}`\n")

    # 描述
    if api_info['description']:
        md.append("## 描述\n")
        md.append(f"{api_info['description']}\n")

    # Header参数
    if api_info['header_params']:
        md.append("## 请求参数\n")
        md.append("### Header参数\n")
        md.append(api_info['header_params'])
        md.append("")

    # 请求体
    if api_info.get('request_body'):
        md.append("### 请求体结构\n")
        md.append(api_info['request_body'])
        md.append("")

    # 请求示例
    if api_info['request_example']:
        md.append("## 请求示例\n")
        md.append("```json")
        md.append(api_info['request_example'])
        md.append("```\n")

    # 响应
    md.append("## 响应\n")

    # 响应结构
    if api_info.get('response_schema'):
        md.append("### 响应结构\n")
        md.append(api_info['response_schema'])
        md.append("")

    # 响应示例
    if api_info['responses']:
        for response in api_info['responses']:
            md.append(f"### {response['status']} 响应示例\n")
            md.append("```json")
            md.append(response['example'])
            md.append("```\n")

    return '\n'.join(md)


def extract_all_apis():
    """提取所有API文档"""

    print(f"📖 读取HTML文件: {HTML_FILE}")

    # 读取HTML文件
    with open(HTML_FILE, 'r', encoding='utf-8') as f:
        html_content = f.read()

    print(f"✅ HTML文件大小: {len(html_content) / 1024 / 1024:.2f} MB")

    # 解析HTML
    print("🔍 解析HTML文档...")
    soup = BeautifulSoup(html_content, 'lxml')

    # 查找所有operation类型的API
    print("🔎 查找所有API操作...")
    operation_items = soup.find_all('li', {'data-item-id': re.compile(r'^operation/')})

    print(f"✅ 找到 {len(operation_items)} 个API操作\n")

    # 创建输出目录
    output_path = Path(OUTPUT_DIR)
    output_path.mkdir(parents=True, exist_ok=True)

    # 提取每个API
    api_list = []
    success_count = 0
    filename_counter = {}  # 跟踪文件名使用情况

    for i, item in enumerate(operation_items, 1):
        operation_id = item.get('data-item-id')

        # 提取API名称
        label = item.find('label', {'type': 'operation'})
        if not label:
            continue

        # 提取中文名称
        name_div = label.find('div', class_=re.compile('sc-fXEqXD'))
        api_name = extract_text(name_div) if name_div else operation_id

        # 提取HTTP方法
        method_span = label.find('span', class_=re.compile('operation-type'))
        method = extract_text(method_span).upper() if method_span else 'POST'

        # 提取路径
        path_div = label.find('div', class_=re.compile('sc-FNZbm'))
        path = extract_text(path_div) if path_div else ''

        print(f"[{i}/{len(operation_items)}] {api_name}")
        print(f"    {method} {path}")

        # 提取详细信息
        api_info = extract_api_info(soup, operation_id)

        if api_info:
            # 补充基本信息
            api_info['title'] = api_name
            api_info['method'] = method
            api_info['path'] = path

            # 生成Markdown
            markdown = format_markdown(api_info)

            # 生成文件名（带版本号去重）
            base_filename = sanitize_filename(api_name)

            # 提取版本号
            version = extract_version_from_path(path)

            # 检查文件名是否已存在
            if base_filename in filename_counter:
                # 如果有版本号，添加到文件名
                if version:
                    filename = f"{base_filename}_{version}.md"
                    print(f"    ⚠️  文件名重复，添加版本号: {version}")
                else:
                    # 没有版本号，使用计数器
                    count = filename_counter[base_filename]
                    filename_counter[base_filename] += 1
                    filename = f"{base_filename}_{count}.md"
                    print(f"    ⚠️  文件名重复，添加序号: {count}")
            else:
                filename = base_filename + '.md'
                filename_counter[base_filename] = 1

            filepath = output_path / filename

            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(markdown)

            print(f"    ✅ 已保存: {filename}\n")

            api_list.append({
                'name': api_name,
                'method': method,
                'path': path,
                'filename': filename,
                'operation_id': operation_id,
                'version': version
            })

            success_count += 1
        else:
            print(f"    ❌ 提取失败\n")

    print(f"\n{'='*60}")
    print(f"✅ 提取完成！")
    print(f"   成功: {success_count}/{len(operation_items)}")
    print(f"   输出目录: {OUTPUT_DIR}")
    print(f"{'='*60}\n")

    return api_list


def generate_index(api_list: List[Dict]):
    """生成索引文件"""

    print("📝 生成索引文件...")

    md = []
    md.append("# OZON Seller API 文档\n")
    md.append(f"共 {len(api_list)} 个API接口\n")
    md.append("## API列表\n")

    # 按功能分组
    grouped = {}
    for api in api_list:
        # 根据路径前缀分组
        path_parts = api['path'].split('/')
        if len(path_parts) >= 2:
            group = path_parts[1]  # 例如 v1, v2, v3
            if len(path_parts) >= 3:
                group = path_parts[2]  # 例如 product, order
        else:
            group = "其他"

        if group not in grouped:
            grouped[group] = []
        grouped[group].append(api)

    # 输出分组
    for group in sorted(grouped.keys()):
        md.append(f"### {group}\n")
        for api in sorted(grouped[group], key=lambda x: x['name']):
            md.append(f"- [{api['name']}](./{api['filename']}) - `{api['method']} {api['path']}`")
        md.append("")

    # 保存索引
    index_path = Path(OUTPUT_DIR) / 'README.md'
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))

    print(f"✅ 索引文件已生成: {index_path}\n")


if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 OZON API 文档提取工具")
    print("="*60 + "\n")

    api_list = extract_all_apis()

    if api_list:
        generate_index(api_list)

    print("🎉 全部完成！\n")
