#!/usr/bin/env python3
"""
OZON API文档提取工具（HTML版本）
从原始HTML文档中提取每个API操作的完整HTML片段
"""

import os
import re
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Dict, List, Optional

# 配置
HTML_FILE = "docs/OzonSellerAPI.html"
OUTPUT_DIR = "docs/OzonAPI"


def sanitize_filename(name: str) -> str:
    """清理文件名中的非法字符"""
    name = name.replace('/', '_')
    name = name.replace('\\', '_')
    name = name.replace('?', '')
    name = name.replace('*', '')
    name = name.replace(':', '-')
    name = name.replace('<', '')
    name = name.replace('>', '')
    name = name.replace('|', '-')
    name = name.replace('"', '')
    if len(name) > 100:
        name = name[:100]
    return name.strip()


def extract_styles(soup: BeautifulSoup) -> str:
    """提取页面的CSS样式"""
    styles = []

    # 提取所有style标签
    for style_tag in soup.find_all('style'):
        styles.append(style_tag.string or '')

    # 提取link标签引用的CSS（内联显示）
    # 注意：实际CSS文件内容无法获取，这里只是标记

    return '\n'.join(styles)


def create_html_template(title: str, content: str, base_styles: str) -> str:
    """创建完整的HTML文档"""
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - OZON API</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .api-container {{
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
        }}
        th, td {{
            border: 1px solid #ddd;
            padding: 8px 12px;
            text-align: left;
        }}
        th {{
            background-color: #f8f9fa;
            font-weight: 600;
        }}
        code {{
            background-color: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: "Courier New", monospace;
        }}
        pre {{
            background-color: #f4f4f4;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
        }}
        h1, h2, h3, h4, h5, h6 {{
            color: #333;
            margin-top: 20px;
        }}
        .http-verb {{
            display: inline-block;
            padding: 4px 8px;
            border-radius: 3px;
            font-weight: bold;
            margin-right: 8px;
        }}
        .http-verb.post {{ background-color: #49cc90; color: white; }}
        .http-verb.get {{ background-color: #61affe; color: white; }}
        .http-verb.put {{ background-color: #fca130; color: white; }}
        .http-verb.delete {{ background-color: #f93e3e; color: white; }}
        .back-link {{
            display: inline-block;
            margin-bottom: 20px;
            color: #007bff;
            text-decoration: none;
        }}
        .back-link:hover {{
            text-decoration: underline;
        }}
    </style>
</head>
<body>
    <div class="api-container">
        <a href="index.html" class="back-link">← 返回索引</a>
        {content}
    </div>
</body>
</html>
"""


def extract_api_section(soup: BeautifulSoup, operation_id: str) -> Optional[str]:
    """提取单个API的HTML内容"""
    # 查找API详情div
    detail_div = soup.find('div', {'id': operation_id})
    if not detail_div:
        return None

    # 返回该div的完整HTML
    return str(detail_div)


def extract_api_metadata(nav_item) -> Dict:
    """从导航项中提取API元数据"""
    operation_id = nav_item.get('data-item-id')

    # 提取API名称
    label = nav_item.find('label', {'type': 'operation'})
    if not label:
        return None

    # 提取中文名称
    name_div = label.find('div', class_=re.compile('sc-fXEqXD'))
    api_name = name_div.get_text(strip=True) if name_div else operation_id

    # 提取HTTP方法
    method_span = label.find('span', class_=re.compile('operation-type'))
    method = method_span.get_text(strip=True).upper() if method_span else 'POST'

    # 提取路径
    path_div = label.find('div', class_=re.compile('sc-FNZbm'))
    path = path_div.get_text(strip=True) if path_div else ''

    return {
        'operation_id': operation_id,
        'name': api_name,
        'method': method,
        'path': path
    }


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

    # 提取基础样式
    print("🎨 提取样式...")
    base_styles = extract_styles(soup)

    # 查找所有operation类型的API - 直接通过 div id 查找
    print("🔎 查找所有API操作...")
    operation_divs = soup.find_all('div', id=re.compile(r'^operation/'))

    print(f"✅ 找到 {len(operation_divs)} 个API操作\n")

    # 创建输出目录
    output_path = Path(OUTPUT_DIR)
    output_path.mkdir(parents=True, exist_ok=True)

    # 提取每个API
    api_list = []
    success_count = 0
    filename_counter = {}

    for i, div in enumerate(operation_divs, 1):
        operation_id = div.get('id')

        # 从 div 中提取标题和路径
        h2_tag = div.find('h2')
        api_name = h2_tag.get_text(strip=True) if h2_tag else operation_id

        # 提取 HTTP 方法
        http_verb = div.find('span', class_=re.compile('http-verb'))
        method = http_verb.get_text(strip=True).upper() if http_verb else 'POST'

        # 提取路径
        path_div = div.find('div', class_=re.compile('sc-gIBoTZ'))
        path = path_div.get_text(strip=True) if path_div else ''

        print(f"[{i}/{len(operation_divs)}] {api_name}")
        print(f"    {method} {path}")

        # 使用 div 本身作为 HTML 内容
        html_content = str(div)

        if html_content:
            # 生成文件名
            base_filename = sanitize_filename(api_name)

            # 检查文件名是否已存在
            if base_filename in filename_counter:
                count = filename_counter[base_filename]
                filename_counter[base_filename] += 1
                filename = f"{base_filename}_{count}.html"
                print(f"    ⚠️  文件名重复，添加序号: {count}")
            else:
                filename = base_filename + '.html'
                filename_counter[base_filename] = 1

            # 创建完整HTML文档
            full_html = create_html_template(api_name, html_content, base_styles)

            filepath = output_path / filename
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(full_html)

            print(f"    ✅ 已保存: {filename}\n")

            api_list.append({
                'name': api_name,
                'method': method,
                'path': path,
                'filename': filename,
                'operation_id': operation_id
            })

            success_count += 1
        else:
            print(f"    ❌ 提取失败\n")

    print(f"\n{'='*60}")
    print(f"✅ 提取完成！")
    print(f"   成功: {success_count}/{len(operation_divs)}")
    print(f"   输出目录: {OUTPUT_DIR}")
    print(f"{'='*60}\n")

    return api_list


def generate_index(api_list: List[Dict]):
    """生成索引HTML页面"""
    print("📝 生成索引页面...")

    # 按功能分组
    grouped = {}
    for api in api_list:
        # 根据路径前缀分组
        path_parts = api['path'].split('/')
        if len(path_parts) >= 3:
            group = path_parts[2]  # 例如 product, order, finance
        else:
            group = "其他"

        if group not in grouped:
            grouped[group] = []
        grouped[group].append(api)

    # 构建HTML
    html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OZON Seller API 文档索引</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007bff;
            padding-bottom: 10px;
        }
        h2 {
            color: #555;
            margin-top: 30px;
            margin-bottom: 15px;
        }
        .search-box {
            margin: 20px 0;
            padding: 10px;
            width: 100%;
            max-width: 500px;
            border: 2px solid #ddd;
            border-radius: 5px;
            font-size: 16px;
        }
        .api-list {
            list-style: none;
            padding: 0;
        }
        .api-item {
            padding: 12px;
            margin: 8px 0;
            background: #f8f9fa;
            border-left: 4px solid #007bff;
            border-radius: 4px;
            transition: background 0.2s;
        }
        .api-item:hover {
            background: #e9ecef;
        }
        .api-item a {
            text-decoration: none;
            color: #333;
            display: block;
        }
        .api-name {
            font-weight: 600;
            font-size: 16px;
            margin-bottom: 4px;
        }
        .api-path {
            font-family: "Courier New", monospace;
            font-size: 14px;
            color: #666;
        }
        .http-method {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: bold;
            margin-right: 8px;
        }
        .method-post { background-color: #49cc90; color: white; }
        .method-get { background-color: #61affe; color: white; }
        .method-put { background-color: #fca130; color: white; }
        .method-delete { background-color: #f93e3e; color: white; }
        .stats {
            background: #e7f3ff;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>OZON Seller API 文档索引</h1>
        <div class="stats">
            <strong>📊 统计信息：</strong> 共 """ + str(len(api_list)) + """ 个API接口
        </div>

        <input type="text" class="search-box" id="searchBox" placeholder="搜索API名称或路径..." onkeyup="searchAPI()">

        <div id="apiContent">
"""

    # 输出分组
    for group in sorted(grouped.keys()):
        html += f'        <h2>{group}</h2>\n'
        html += '        <ul class="api-list">\n'

        for api in sorted(grouped[group], key=lambda x: x['name']):
            method_class = f"method-{api['method'].lower()}"
            html += f'''            <li class="api-item">
                <a href="{api['filename']}">
                    <div class="api-name">
                        <span class="http-method {method_class}">{api['method']}</span>
                        {api['name']}
                    </div>
                    <div class="api-path">{api['path']}</div>
                </a>
            </li>
'''

        html += '        </ul>\n'

    html += """        </div>
    </div>

    <script>
        function searchAPI() {
            const input = document.getElementById('searchBox');
            const filter = input.value.toLowerCase();
            const items = document.getElementsByClassName('api-item');

            for (let i = 0; i < items.length; i++) {
                const text = items[i].textContent || items[i].innerText;
                if (text.toLowerCase().indexOf(filter) > -1) {
                    items[i].style.display = '';
                } else {
                    items[i].style.display = 'none';
                }
            }
        }
    </script>
</body>
</html>
"""

    # 保存索引
    index_path = Path(OUTPUT_DIR) / 'index.html'
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"✅ 索引文件已生成: {index_path}\n")


if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 OZON API 文档提取工具（HTML版本）")
    print("="*60 + "\n")

    api_list = extract_all_apis()

    if api_list:
        generate_index(api_list)

    print("🎉 全部完成！\n")
    print("💡 打开 docs/OzonAPI/index.html 查看文档索引\n")
