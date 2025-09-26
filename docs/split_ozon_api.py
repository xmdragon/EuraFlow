#!/usr/bin/env python3
"""
OZON API文档拆分脚本
将大型HTML文档拆分成多个独立的Markdown文件
"""
import os
import re
import json
from pathlib import Path
from html.parser import HTMLParser
import html


def sanitize_filename(text):
    """将API路径转换为安全的文件名"""
    # 移除开头的斜杠并替换其他特殊字符
    filename = text.strip('/')
    filename = re.sub(r'[^\w\-_/.]', '_', filename)
    filename = filename.replace('/', '_')
    filename = filename.replace('__', '_').strip('_')
    return filename


def extract_text_content(element):
    """递归提取元素的文本内容，保持基本格式"""
    if not element:
        return ""

    if hasattr(element, 'name'):
        if element.name in ['br']:
            return '\n'
        elif element.name in ['code']:
            return f"`{element.get_text()}`"
        elif element.name in ['pre']:
            return f"```\n{element.get_text()}\n```"
        elif element.name in ['strong', 'b']:
            return f"**{element.get_text()}**"
        elif element.name in ['em', 'i']:
            return f"*{element.get_text()}*"
        elif element.name in ['li']:
            return f"- {element.get_text()}\n"
        elif element.name in ['ul', 'ol']:
            items = []
            for li in element.find_all('li', recursive=False):
                items.append(f"- {li.get_text()}")
            return '\n'.join(items) + '\n'

    if hasattr(element, 'get_text'):
        return element.get_text()

    return str(element)


def find_api_operations(soup):
    """从HTML中查找API操作"""
    operations = []

    # 尝试不同的选择器来查找API操作
    selectors = [
        'div[data-section-id]',  # RedDoc风格
        '.operation',
        '[data-operation-id]',
        '.api-operation',
        '.method',
        'section[id*="operation"]',
    ]

    # 查找包含HTTP方法的元素
    http_methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

    # 搜索标题和链接元素
    for element in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'div', 'span']):
        text = element.get_text(strip=True)

        # 查找包含HTTP方法和路径的文本
        for method in http_methods:
            if method in text and '/v' in text:
                # 尝试提取API路径
                path_match = re.search(r'(/v\d+/[^\s\)]+)', text)
                if path_match:
                    api_path = path_match.group(1)

                    # 查找相关内容
                    parent = element.parent
                    content_elem = parent

                    # 向上查找更大的容器
                    for _ in range(5):
                        if parent and parent.parent:
                            parent = parent.parent
                            if len(parent.get_text()) > len(content_elem.get_text()):
                                content_elem = parent

                    operation = {
                        'method': method,
                        'path': api_path,
                        'title': text,
                        'element': content_elem,
                        'description': ''
                    }

                    # 避免重复
                    existing = [op for op in operations if op['path'] == api_path and op['method'] == method]
                    if not existing:
                        operations.append(operation)

    # 如果没有找到操作，尝试从导航菜单中查找
    if not operations:
        nav_items = soup.find_all('li', {'data-item-id': True})
        for nav_item in nav_items:
            item_id = nav_item.get('data-item-id')
            if 'operation' in item_id:
                link = nav_item.find('a') or nav_item
                title = link.get_text(strip=True)

                # 尝试从标题中提取方法和路径
                for method in http_methods:
                    if method.lower() in title.lower():
                        operation = {
                            'method': method,
                            'path': f'/v1/{item_id}',
                            'title': title,
                            'element': nav_item,
                            'description': title
                        }
                        operations.append(operation)
                        break

    return operations


def extract_operation_details(operation, soup):
    """提取操作的详细信息"""
    details = {
        'method': operation['method'],
        'path': operation['path'],
        'title': operation['title'],
        'description': '',
        'parameters': [],
        'responses': [],
        'examples': []
    }

    element = operation['element']

    # 提取描述
    desc_elements = element.find_all(['p', 'div'], limit=5)
    descriptions = []
    for desc_elem in desc_elements:
        text = desc_elem.get_text(strip=True)
        if text and len(text) > 10 and text not in descriptions:
            descriptions.append(text)

    details['description'] = '\n\n'.join(descriptions[:3])  # 限制描述长度

    # 查找参数表格
    tables = element.find_all('table')
    for table in tables:
        headers = [th.get_text(strip=True) for th in table.find_all(['th', 'td'])[:10]]
        if any(header.lower() in ['parameter', 'name', 'type', 'required'] for header in headers):
            rows = table.find_all('tr')[1:]  # 跳过标题行
            for row in rows:
                cells = [td.get_text(strip=True) for td in row.find_all(['td', 'th'])]
                if len(cells) >= 2:
                    param = {
                        'name': cells[0],
                        'type': cells[1] if len(cells) > 1 else '',
                        'required': cells[2] if len(cells) > 2 else '',
                        'description': cells[3] if len(cells) > 3 else ''
                    }
                    details['parameters'].append(param)

    # 查找代码示例
    code_blocks = element.find_all(['pre', 'code'])
    for code_block in code_blocks:
        code_text = code_block.get_text(strip=True)
        if code_text and len(code_text) > 10:
            details['examples'].append(code_text)

    return details


def generate_markdown(operation_details):
    """生成Markdown内容"""
    md_content = []

    # 标题
    md_content.append(f"# {operation_details['method']} {operation_details['path']}")
    md_content.append("")

    # 描述
    if operation_details['description']:
        md_content.append("## 描述")
        md_content.append("")
        md_content.append(operation_details['description'])
        md_content.append("")

    # 参数
    if operation_details['parameters']:
        md_content.append("## 参数")
        md_content.append("")
        md_content.append("| 名称 | 类型 | 必填 | 描述 |")
        md_content.append("|------|------|------|------|")

        for param in operation_details['parameters']:
            name = param.get('name', '')
            type_info = param.get('type', '')
            required = param.get('required', '')
            description = param.get('description', '')
            md_content.append(f"| {name} | {type_info} | {required} | {description} |")

        md_content.append("")

    # 响应
    if operation_details['responses']:
        md_content.append("## 响应")
        md_content.append("")
        for response in operation_details['responses']:
            md_content.append(f"- {response}")
        md_content.append("")

    # 示例
    if operation_details['examples']:
        md_content.append("## 示例")
        md_content.append("")
        for i, example in enumerate(operation_details['examples'][:3]):  # 限制示例数量
            if i > 0:
                md_content.append("")
            md_content.append("```json")
            md_content.append(example)
            md_content.append("```")
        md_content.append("")

    return '\n'.join(md_content)


def main():
    """主函数"""
    html_file = '/home/grom/EuraFlow/docs/OzonSellerAPI.html'
    output_dir = '/home/grom/EuraFlow/docs/ozon-api'

    print(f"开始解析 {html_file}...")

    # 读取HTML文件
    with open(html_file, 'r', encoding='utf-8') as f:
        content = f.read()

    print(f"文件大小: {len(content) / 1024 / 1024:.1f} MB")

    # 解析HTML
    soup = BeautifulSoup(content, 'html.parser')
    print("HTML解析完成")

    # 查找API操作
    operations = find_api_operations(soup)
    print(f"找到 {len(operations)} 个API操作")

    # 如果没有找到操作，尝试分析整个文档结构
    if not operations:
        print("未找到API操作，尝试分析文档结构...")

        # 查找所有包含路径的文本
        all_text = soup.get_text()
        path_matches = re.findall(r'(/v\d+/[\w/\-]+)', all_text)
        unique_paths = list(set(path_matches))

        print(f"发现 {len(unique_paths)} 个唯一API路径")

        # 为每个路径创建基本操作
        for path in unique_paths[:50]:  # 限制数量避免过多文件
            operations.append({
                'method': 'POST',  # 默认方法
                'path': path,
                'title': f"API: {path}",
                'element': soup,  # 使用整个文档
                'description': f"OZON API 接口: {path}"
            })

    # 生成Markdown文件
    index_entries = []
    generated_files = 0

    for operation in operations:
        try:
            # 提取操作详细信息
            operation_details = extract_operation_details(operation, soup)

            # 生成文件名
            filename = sanitize_filename(f"{operation['method']}_{operation['path']}")
            if not filename:
                filename = f"api_{generated_files}"

            filename = f"{filename}.md"
            filepath = os.path.join(output_dir, filename)

            # 生成Markdown内容
            markdown_content = generate_markdown(operation_details)

            # 写入文件
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(markdown_content)

            # 添加到索引
            index_entries.append({
                'method': operation['method'],
                'path': operation['path'],
                'title': operation['title'],
                'filename': filename
            })

            generated_files += 1
            print(f"生成文件: {filename}")

        except Exception as e:
            print(f"处理操作时出错: {operation.get('path', 'unknown')}: {e}")
            continue

    # 生成索引文件
    create_index_file(output_dir, index_entries)

    print(f"\n拆分完成！")
    print(f"总共生成了 {generated_files} 个API文件")
    print(f"文件保存在: {output_dir}")


def create_index_file(output_dir, entries):
    """创建索引文件"""
    index_content = []
    index_content.append("# OZON API 文档索引")
    index_content.append("")
    index_content.append("本目录包含从 OZON Seller API 官方文档中提取的所有API接口说明。")
    index_content.append("")

    # 按方法分组
    methods = {}
    for entry in entries:
        method = entry['method']
        if method not in methods:
            methods[method] = []
        methods[method].append(entry)

    # 生成目录
    for method in sorted(methods.keys()):
        index_content.append(f"## {method} 方法")
        index_content.append("")

        for entry in methods[method]:
            path = entry['path']
            title = entry['title']
            filename = entry['filename']
            index_content.append(f"- [{path}]({filename}) - {title}")

        index_content.append("")

    # 写入索引文件
    index_path = os.path.join(output_dir, 'index.md')
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(index_content))

    print(f"生成索引文件: index.md")


if __name__ == '__main__':
    main()