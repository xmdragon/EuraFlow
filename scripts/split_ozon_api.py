#!/usr/bin/env python3
"""
拆分OZON API HTML文档为独立的Markdown文件
"""
import os
import re
import json
from bs4 import BeautifulSoup
from pathlib import Path
import html2text

# 配置
SOURCE_FILE = "/home/grom/EuraFlow/docs/OzonSellerAPI.html"
OUTPUT_DIR = "/home/grom/EuraFlow/docs/ozon-api"

def clean_filename(name):
    """清理文件名，移除特殊字符"""
    # 替换斜杠为下划线
    name = name.replace('/', '_').replace('\\', '_')
    # 移除其他特殊字符
    name = re.sub(r'[^\w\-_\.]', '', name)
    # 移除开头的下划线
    name = name.lstrip('_')
    return name

def extract_api_info_from_section(section):
    """从HTML section中提取API信息"""
    api_info = {
        'path': '',
        'method': '',
        'title': '',
        'description': '',
        'parameters': [],
        'response': '',
        'example': ''
    }

    # 尝试提取路径和方法
    path_elem = section.find(class_=re.compile('http-verb|path|endpoint'))
    if path_elem:
        text = path_elem.get_text(strip=True)
        # 提取HTTP方法和路径
        method_match = re.match(r'(GET|POST|PUT|DELETE|PATCH)\s+(.+)', text)
        if method_match:
            api_info['method'] = method_match.group(1)
            api_info['path'] = method_match.group(2)

    # 提取标题
    title_elem = section.find(['h1', 'h2', 'h3', 'h4'])
    if title_elem:
        api_info['title'] = title_elem.get_text(strip=True)

    # 提取描述
    desc_elem = section.find(class_=re.compile('description'))
    if desc_elem:
        api_info['description'] = desc_elem.get_text(strip=True)

    return api_info

def parse_html_content():
    """解析HTML内容并提取API信息"""
    print(f"正在读取文件: {SOURCE_FILE}")

    with open(SOURCE_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    print("正在解析HTML...")
    soup = BeautifulSoup(content, 'html.parser')

    apis = []

    # 查找所有可能包含API定义的元素
    # 方法1: 查找包含HTTP方法的元素
    http_methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
    for method in http_methods:
        # 查找包含HTTP方法的元素
        method_elements = soup.find_all(text=re.compile(f'^{method}\\s+'))
        for elem in method_elements:
            if elem.parent:
                # 获取父元素周围的内容
                parent = elem.parent
                # 尝试找到包含整个API定义的容器
                container = parent.find_parent(['div', 'section', 'article'])
                if container:
                    # 提取路径
                    text = elem.strip()
                    match = re.match(f'{method}\\s+(.+)', text)
                    if match:
                        path = match.group(1).strip()
                        # 清理路径
                        path = path.split()[0]  # 取第一个词（通常是路径）

                        api = {
                            'method': method,
                            'path': path,
                            'title': '',
                            'description': '',
                            'content': ''
                        }

                        # 查找标题
                        title_elem = container.find(['h1', 'h2', 'h3', 'h4'])
                        if title_elem:
                            api['title'] = title_elem.get_text(strip=True)

                        # 获取整个容器的HTML内容
                        api['content'] = str(container)

                        apis.append(api)
                        print(f"找到API: {method} {path}")

    # 方法2: 查找包含API路径模式的元素
    api_path_pattern = re.compile(r'/v\d+/[a-zA-Z0-9/_-]+')
    path_elements = soup.find_all(text=api_path_pattern)
    for elem in path_elements:
        if elem.parent:
            text = elem.strip()
            # 检查是否是API路径格式
            if api_path_pattern.match(text):
                # 查找可能的HTTP方法
                parent_text = elem.parent.get_text(strip=True)
                method = None
                for m in http_methods:
                    if m in parent_text:
                        method = m
                        break

                if not method:
                    method = 'POST'  # 默认方法

                # 检查是否已存在
                exists = any(api['path'] == text and api['method'] == method for api in apis)
                if not exists:
                    container = elem.parent.find_parent(['div', 'section', 'article'])
                    if container:
                        api = {
                            'method': method,
                            'path': text,
                            'title': '',
                            'description': '',
                            'content': str(container) if container else ''
                        }

                        # 查找标题
                        if container:
                            title_elem = container.find(['h1', 'h2', 'h3', 'h4'])
                            if title_elem:
                                api['title'] = title_elem.get_text(strip=True)

                        apis.append(api)
                        print(f"找到API: {method} {text}")

    print(f"共找到 {len(apis)} 个API")
    return apis

def save_api_to_markdown(api, index):
    """将API信息保存为Markdown文件"""
    # 生成文件名
    filename = clean_filename(api['path'])
    if not filename:
        filename = f"api_{index}"

    # 添加方法前缀以避免冲突
    filename = f"{api['method'].lower()}_{filename}.md"
    filepath = os.path.join(OUTPUT_DIR, filename)

    # 转换HTML到Markdown
    h = html2text.HTML2Text()
    h.body_width = 0  # 不限制行宽
    h.ignore_links = False

    # 生成Markdown内容
    md_content = f"# {api['title'] or api['path']}\n\n"
    md_content += f"## 接口信息\n\n"
    md_content += f"- **HTTP方法**: {api['method']}\n"
    md_content += f"- **路径**: `{api['path']}`\n\n"

    if api['description']:
        md_content += f"## 描述\n\n{api['description']}\n\n"

    # 转换HTML内容
    if api['content']:
        md_content += "## 详细信息\n\n"
        try:
            converted = h.handle(api['content'])
            md_content += converted
        except:
            md_content += "（HTML内容转换失败）\n"

    # 保存文件
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(md_content)

    return filename

def create_index(apis):
    """创建索引文件"""
    index_path = os.path.join(OUTPUT_DIR, "index.md")

    content = "# OZON Seller API 文档索引\n\n"
    content += f"共 {len(apis)} 个API接口\n\n"

    # 按路径分组
    grouped = {}
    for i, api in enumerate(apis):
        path_parts = api['path'].split('/')
        if len(path_parts) > 2:
            group = path_parts[2]  # 取第二部分作为分组
        else:
            group = '其他'

        if group not in grouped:
            grouped[group] = []

        filename = clean_filename(api['path'])
        if not filename:
            filename = f"api_{i}"
        filename = f"{api['method'].lower()}_{filename}.md"

        grouped[group].append({
            'method': api['method'],
            'path': api['path'],
            'title': api['title'],
            'filename': filename
        })

    # 生成分组列表
    for group in sorted(grouped.keys()):
        content += f"\n## {group}\n\n"
        content += "| 方法 | 路径 | 描述 | 文件 |\n"
        content += "|------|------|------|------|\n"

        for item in grouped[group]:
            title = item['title'][:50] + '...' if len(item['title']) > 50 else item['title']
            content += f"| {item['method']} | `{item['path']}` | {title} | [{item['filename']}]({item['filename']}) |\n"

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"索引文件已创建: {index_path}")

def main():
    """主函数"""
    print("开始拆分OZON API文档...")

    # 确保输出目录存在
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)

    # 解析HTML
    apis = parse_html_content()

    if not apis:
        print("未找到API定义，尝试其他解析方法...")
        return

    # 保存每个API
    print(f"开始保存 {len(apis)} 个API文件...")
    for i, api in enumerate(apis):
        filename = save_api_to_markdown(api, i)
        print(f"  [{i+1}/{len(apis)}] 已保存: {filename}")

    # 创建索引
    create_index(apis)

    print(f"\n完成！共生成 {len(apis)} 个API文档文件")
    print(f"文档目录: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()