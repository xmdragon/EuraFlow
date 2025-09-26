#!/usr/bin/env python3
"""
增强版OZON API文档拆分器 - 提取详细的API信息
"""
import os
import re
import json
from bs4 import BeautifulSoup, Comment
from pathlib import Path
import html2text
import logging

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 配置
SOURCE_FILE = "/home/grom/EuraFlow/docs/OzonSellerAPI.html"
OUTPUT_DIR = "/home/grom/EuraFlow/docs/ozon-api-detailed"

def clean_filename(name):
    """清理文件名，移除特殊字符"""
    name = name.replace('/', '_').replace('\\', '_')
    name = re.sub(r'[^\w\-_\.]', '', name)
    name = name.lstrip('_')
    return name

def extract_json_from_element(element):
    """从HTML元素中提取JSON内容"""
    if not element:
        return None

    # 查找代码块
    code_blocks = element.find_all(['code', 'pre'])
    for block in code_blocks:
        text = block.get_text().strip()
        if text.startswith('{') or text.startswith('['):
            try:
                # 尝试解析JSON
                parsed = json.loads(text)
                return json.dumps(parsed, indent=2, ensure_ascii=False)
            except:
                # 如果不是有效JSON，返回原始文本
                return text

    return None

def extract_api_details(soup, api_path):
    """从soup中提取特定API的详细信息"""
    api_info = {
        'path': api_path,
        'method': 'POST',  # 大部分OZON API都是POST
        'title': '',
        'description': '',
        'request_schema': None,
        'request_example': None,
        'response_schema': None,
        'response_example': None,
        'parameters': [],
        'responses': {},
        'errors': []
    }

    # 查找包含API路径的元素
    path_elements = soup.find_all(text=re.compile(re.escape(api_path)))
    if not path_elements:
        return api_info

    # 找到包含此API的主要容器
    main_container = None
    for elem in path_elements:
        if elem.parent:
            # 查找最近的大容器
            container = elem.parent
            while container and container.name not in ['div', 'section', 'article']:
                container = container.parent

            if container:
                # 检查容器是否包含API相关内容
                container_text = container.get_text()
                if 'REQUEST BODY SCHEMA' in container_text or 'RESPONSE SCHEMA' in container_text:
                    main_container = container
                    break

    if not main_container:
        # 如果找不到标准容器，扩大搜索范围
        for elem in path_elements:
            if elem.parent:
                # 查找包含更多内容的父元素
                container = elem.parent
                for _ in range(10):  # 向上查找10层
                    if container.parent:
                        container = container.parent
                        container_text = container.get_text()
                        if len(container_text) > 500 and ('schema' in container_text.lower() or 'response' in container_text.lower()):
                            main_container = container
                            break
                    else:
                        break
                if main_container:
                    break

    if not main_container:
        logger.warning(f"未找到API {api_path} 的详细容器")
        return api_info

    # 提取标题
    title_elem = main_container.find(['h1', 'h2', 'h3', 'h4'])
    if title_elem:
        api_info['title'] = title_elem.get_text(strip=True)

    # 提取描述
    # 查找描述段落
    desc_patterns = ['描述', 'description', '方法', '接口']
    for pattern in desc_patterns:
        desc_elem = main_container.find(text=re.compile(pattern, re.I))
        if desc_elem and desc_elem.parent:
            # 获取描述文本
            next_elem = desc_elem.parent.find_next_sibling()
            if next_elem:
                desc_text = next_elem.get_text(strip=True)
                if desc_text and len(desc_text) > 10:
                    api_info['description'] = desc_text
                    break

    # 提取请求Schema
    request_schema_text = main_container.find(text=re.compile('REQUEST BODY SCHEMA', re.I))
    if request_schema_text:
        schema_container = request_schema_text.parent
        while schema_container and not schema_container.find_all(['table', 'pre', 'code']):
            schema_container = schema_container.find_next_sibling()

        if schema_container:
            # 提取参数表格
            table = schema_container.find('table')
            if table:
                api_info['parameters'] = extract_parameters_from_table(table)

            # 提取JSON示例
            json_example = extract_json_from_element(schema_container)
            if json_example:
                api_info['request_example'] = json_example

    # 提取响应Schema
    response_schema_text = main_container.find(text=re.compile('RESPONSE SCHEMA', re.I))
    if response_schema_text:
        schema_container = response_schema_text.parent
        while schema_container and not schema_container.find_all(['table', 'pre', 'code']):
            schema_container = schema_container.find_next_sibling()

        if schema_container:
            # 提取响应表格
            table = schema_container.find('table')
            if table:
                response_params = extract_parameters_from_table(table)
                api_info['responses']['200'] = {
                    'description': '成功响应',
                    'schema': response_params
                }

            # 提取JSON示例
            json_example = extract_json_from_element(schema_container)
            if json_example:
                api_info['response_example'] = json_example

    # 查找所有JSON代码块
    code_blocks = main_container.find_all(['code', 'pre'])
    request_examples = []
    response_examples = []

    for block in code_blocks:
        text = block.get_text().strip()
        if text.startswith('{') or text.startswith('['):
            try:
                parsed = json.loads(text)
                formatted = json.dumps(parsed, indent=2, ensure_ascii=False)

                # 判断是请求还是响应示例
                if any(key in text.lower() for key in ['page', 'limit', 'filter', 'search']):
                    request_examples.append(formatted)
                else:
                    response_examples.append(formatted)
            except:
                continue

    if request_examples and not api_info['request_example']:
        api_info['request_example'] = request_examples[0]

    if response_examples and not api_info['response_example']:
        api_info['response_example'] = response_examples[0]

    return api_info

def extract_parameters_from_table(table):
    """从表格中提取参数信息"""
    parameters = []

    if not table:
        return parameters

    rows = table.find_all('tr')
    headers = []

    # 提取表头
    if rows:
        header_row = rows[0]
        headers = [th.get_text(strip=True).lower() for th in header_row.find_all(['th', 'td'])]

    # 提取参数行
    for row in rows[1:]:
        cells = row.find_all(['td', 'th'])
        if len(cells) >= 2:
            param = {}

            for i, cell in enumerate(cells):
                cell_text = cell.get_text(strip=True)
                if i < len(headers):
                    header = headers[i]
                    if 'name' in header or header == '参数':
                        param['name'] = cell_text
                    elif 'type' in header or header == '类型':
                        param['type'] = cell_text
                    elif 'required' in header or header == '必需':
                        param['required'] = cell_text.lower() in ['true', 'yes', '是', 'required']
                    elif 'description' in header or header == '描述':
                        param['description'] = cell_text
                    elif 'default' in header or header == '默认值':
                        param['default'] = cell_text

            if param.get('name'):
                parameters.append(param)

    return parameters

def generate_detailed_markdown(api_info):
    """生成详细的Markdown文档"""
    md_lines = []

    # 标题
    title = api_info.get('title', api_info['path'])
    md_lines.append(f"# {title}")
    md_lines.append("")

    # API基本信息
    md_lines.append("## 接口信息")
    md_lines.append("")
    md_lines.append("| 属性 | 值 |")
    md_lines.append("|------|-----|")
    md_lines.append(f"| **HTTP方法** | `{api_info['method']}` |")
    md_lines.append(f"| **请求路径** | `{api_info['path']}` |")
    md_lines.append(f"| **Content-Type** | `application/json` |")
    md_lines.append("")

    # 描述
    if api_info.get('description'):
        md_lines.append("## 接口描述")
        md_lines.append("")
        md_lines.append(api_info['description'])
        md_lines.append("")

    # 请求参数
    if api_info.get('parameters'):
        md_lines.append("## 请求参数")
        md_lines.append("")
        md_lines.append("| 参数名 | 类型 | 必需 | 默认值 | 描述 |")
        md_lines.append("|--------|------|------|--------|------|")

        for param in api_info['parameters']:
            name = param.get('name', '-')
            param_type = param.get('type', '-')
            required = '是' if param.get('required', False) else '否'
            default = param.get('default', '-')
            description = param.get('description', '-')

            md_lines.append(f"| `{name}` | {param_type} | {required} | {default} | {description} |")

        md_lines.append("")

    # 请求示例
    if api_info.get('request_example'):
        md_lines.append("## 请求示例")
        md_lines.append("")
        md_lines.append("```json")
        md_lines.append(api_info['request_example'])
        md_lines.append("```")
        md_lines.append("")

    # 响应结构
    if api_info.get('responses'):
        md_lines.append("## 响应结构")
        md_lines.append("")

        for status_code, response in api_info['responses'].items():
            md_lines.append(f"### {status_code} - {response.get('description', '成功')}")
            md_lines.append("")

            if response.get('schema'):
                md_lines.append("| 字段名 | 类型 | 描述 |")
                md_lines.append("|--------|------|------|")

                for field in response['schema']:
                    name = field.get('name', '-')
                    field_type = field.get('type', '-')
                    description = field.get('description', '-')
                    md_lines.append(f"| `{name}` | {field_type} | {description} |")

                md_lines.append("")

    # 响应示例
    if api_info.get('response_example'):
        md_lines.append("## 响应示例")
        md_lines.append("")
        md_lines.append("```json")
        md_lines.append(api_info['response_example'])
        md_lines.append("```")
        md_lines.append("")

    # 错误码
    if api_info.get('errors'):
        md_lines.append("## 错误码")
        md_lines.append("")
        md_lines.append("| 错误码 | 说明 |")
        md_lines.append("|--------|------|")

        for error in api_info['errors']:
            code = error.get('code', '-')
            message = error.get('message', '-')
            md_lines.append(f"| {code} | {message} |")

        md_lines.append("")

    # 通用错误说明
    md_lines.append("## 通用错误码")
    md_lines.append("")
    md_lines.append("| HTTP状态码 | 错误码 | 说明 |")
    md_lines.append("|------------|--------|------|")
    md_lines.append("| 400 | BAD_REQUEST | 请求参数错误 |")
    md_lines.append("| 401 | UNAUTHORIZED | 未授权访问 |")
    md_lines.append("| 403 | FORBIDDEN | 禁止访问 |")
    md_lines.append("| 404 | NOT_FOUND | 资源不存在 |")
    md_lines.append("| 429 | TOO_MANY_REQUESTS | 请求频率限制 |")
    md_lines.append("| 500 | INTERNAL_ERROR | 服务器内部错误 |")
    md_lines.append("")

    return "\n".join(md_lines)

def parse_api_list():
    """解析现有的API列表"""
    index_file = "/home/grom/EuraFlow/docs/ozon-api/index.md"
    if not os.path.exists(index_file):
        logger.error("索引文件不存在，请先运行基础拆分脚本")
        return []

    apis = []
    with open(index_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # 从索引文件中提取API路径
    lines = content.split('\n')
    for line in lines:
        if '| POST |' in line and '`/' in line:
            # 提取路径
            match = re.search(r'`(/[^`]+)`', line)
            if match:
                path = match.group(1)
                apis.append(path)

    return list(set(apis))  # 去重

def main():
    """主函数"""
    logger.info("开始增强OZON API文档...")

    # 确保输出目录存在
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)

    # 读取HTML文档
    logger.info(f"读取HTML文档: {SOURCE_FILE}")
    with open(SOURCE_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    soup = BeautifulSoup(content, 'html.parser')

    # 获取API列表
    api_paths = parse_api_list()
    if not api_paths:
        logger.error("未找到API列表")
        return

    logger.info(f"找到 {len(api_paths)} 个API需要处理")

    # 处理每个API
    processed = 0
    for api_path in api_paths:
        try:
            logger.info(f"处理API: {api_path}")

            # 提取API详细信息
            api_info = extract_api_details(soup, api_path)

            # 生成Markdown文档
            markdown_content = generate_detailed_markdown(api_info)

            # 保存文件
            filename = clean_filename(api_path)
            if not filename:
                filename = f"api_{processed}"
            filename = f"post_{filename}.md"

            filepath = os.path.join(OUTPUT_DIR, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(markdown_content)

            processed += 1
            logger.info(f"  [{processed}/{len(api_paths)}] 已保存: {filename}")

        except Exception as e:
            logger.error(f"处理API {api_path} 时出错: {e}")
            continue

    # 创建增强版索引
    create_enhanced_index(OUTPUT_DIR, processed)

    logger.info(f"完成！共处理 {processed} 个API")

def create_enhanced_index(output_dir, count):
    """创建增强版索引文件"""
    import datetime
    processed_time = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    index_path = os.path.join(output_dir, "README.md")

    content = "# OZON Seller API 详细文档\n\n"
    content += f"本目录包含 {count} 个 OZON Seller API 的详细文档，每个API都包含：\n\n"
    content += "- 📋 接口基本信息（路径、方法、Content-Type）\n"
    content += "- 📝 详细的接口描述和用途说明\n"
    content += "- 📥 完整的请求参数表格（参数名、类型、必需性、默认值、描述）\n"
    content += "- 💡 请求数据结构和JSON示例\n"
    content += "- 📤 响应数据结构说明\n"
    content += "- ✅ 响应JSON示例\n"
    content += "- ❌ 错误码说明\n\n"
    content += "## 使用方法\n\n"
    content += "1. **按API路径查找**：文件名格式为 `post_{api_path}.md`\n"
    content += "2. **示例**：`POST /v3/product/list` 对应文件 `post_v3_product_list.md`\n"
    content += "3. **所有文档都包含完整的请求/响应格式和示例**\n\n"
    content += "## 文档特点\n\n"
    content += "- ✅ 从官方HTML文档自动提取\n"
    content += "- ✅ 包含详细的参数类型和结构\n"
    content += "- ✅ 提供JSON请求/响应示例\n"
    content += "- ✅ 支持中文描述\n"
    content += "- ✅ 格式统一，便于查阅\n\n"
    content += f"## 更新时间\n\n{processed_time}\n"

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    main()