# 中俄互译服务（基于 ChatGPT API，Python 实现）PRD

版本：v1.0  
作者：系统助手（结合用户需求整理）  
状态：草案，可直接落地实现  
最后更新：2025-11-07

---

## 1. 项目背景与目标

### 1.1 背景

用户在多个业务中需要大量 **中文 ⇄ 俄文** 互译，包括但不限于：

- 电商平台（如 OZON）商品标题、描述、客服回复
- Telegram 频道 / 机器人文案
- 内部运营系统中的中俄双语内容

希望通过 **Python + ChatGPT API** 搭建一个统一的「中俄互译服务」，以 API 形式对外提供：

- 对上层业务透明：业务只需要丢文本给翻译服务即可
- 保持翻译风格统一、术语统一
- 易于扩展到其他语言对（例如中英、中俄英三语）

### 1.2 目标

1. 提供一个 **可部署在服务器上的 Python 服务**（FastAPI），对外暴露 HTTP 接口：`POST /translate/zh-ru`
2. 服务自动识别输入是中文还是俄文，实现：
   - 中文 → 俄文
   - 俄文 → 中文
3. 使用 ChatGPT Responses API（推荐模型如 `gpt-5.1-mini`），保证：
   - 译文自然、地道，适合电商 / 社交场景
   - 输出只包含译文本身，不带任何多余解释
4. 可落地运维：
   - 支持日志记录、错误处理、简单限流
   - 支持配置化（API Key、模型、温度等）
   - 方便将来升级模型或扩展新语言对

---

## 2. 术语与角色

- **翻译服务（Translation Service）**：本项目要实现的 Python 服务（FastAPI）
- **上游业务系统**：调用翻译服务的任意系统，如：
  - OZON 辅助后台
  - Telegram 机器人后端
  - 运营管理后台
- **OpenAI / ChatGPT API**：用于实际执行翻译的 LLM 服务
- **终端用户**：最终看到翻译结果的用户（俄语用户 / 中文用户）

---

## 3. 业务需求

### 3.1 功能性需求（业务角度）

1. 支持 **单句翻译** 与 **多句文本翻译**。
2. 自动识别输入文本语言：
   - 如果输入主要为中文 → 输出俄文
   - 如果输入主要为俄文 → 输出中文
3. 保证语气、礼貌程度与原文尽量一致：
   - 客服场景保持礼貌
   - 商品描述保持专业、简洁
4. 翻译风格要求：
   - 自然、地道，避免生硬机翻感
   - 适合电商、社交、即时通讯场景
5. 返回结果要求：
   - 只返回译文字符串，不包含「说明/解释/前后缀/引号」
   - 使用 UTF-8 编码

### 3.2 非功能性需求

1. **性能**
   - 单次请求延迟：在网络条件正常情况下，典型延迟控制在 1–3 秒级（取决于模型与网络状况）
   - 并发：初期按低并发（例如 < 20 rps）设计，后续可通过多进程 / 多实例扩容
2. **可靠性**
   - 对 ChatGPT API 返回错误（429/500 等）有明确处理策略
   - 支持重试、降级（例如返回原文或提示失败）
3. **可观测性**
   - 日志记录输入/输出摘要、错误信息（注意脱敏）
   - 支持基础指标统计：请求次数、失败率、平均延迟
4. **可扩展性**
   - Prompt 统一管理，可针对不同业务定制
   - 未来可新增：`/translate/zh-en`、`/translate/en-ru` 等端点

---

## 4. 功能需求拆解（技术角度）

### 4.1 核心翻译函数

在 Python 中实现一个核心函数：

```python
def translate_zh_ru(text: str) -> str:
    """
    自动识别中文/俄文，然后互译。
    - 输入 text: 中文或俄文
    - 输出: 互译后的文本（只包含译文）
    """
```

职责：

1. 构造请求：
   - 使用 OpenAI Responses API
   - 使用统一的 `system` 提示词（Prompt）
   - 将 `text` 作为 `user` 输入
2. 调用 OpenAI API 获取结果
3. 从返回结构中解析译文
4. 做基本清洗（`strip()`）
5. 错误处理（超时、429、500 等）

### 4.2 HTTP 接口（FastAPI）

对外提供一个主接口：

- `POST /translate/zh-ru`  
- 请求体：JSON
- 响应体：JSON

接口语义：

- 接收一个 `text` 字符串（中文或俄文）
- 返回一个 `translated` 字符串（互译结果）

### 4.3 配置管理

支持通过配置文件或环境变量管理：

- `OPENAI_API_KEY`：必需
- `OPENAI_BASE_URL`（如有代理或中转点时使用，默认为官方地址）
- `MODEL_NAME`：如 `gpt-5.1-mini`
- `TEMPERATURE`：如 `0.2`（翻译建议偏低）
- 超时设置：如 30 秒
- 最大重试次数：如 2–3 次

### 4.4 日志与监控

记录内容：

- 每次请求：
  - 请求 ID
  - 调用端 IP / 调用系统标识（如有）
  - 输入长度（字符数）
  - 返回状态（成功 / 失败 / 重试）
  - 耗时
- 错误日志：
  - HTTP 状态码
  - OpenAI 错误码与错误消息

注意：

- **不在日志中记录 API Key**  
- 对文本内容如有敏感信息，可考虑只记录前 N 个字符或哈希

### 4.5 缓存策略（可选）

为降低成本与延迟，可实现简单缓存：

- Key：`sha256(model + temperature + text)`
- Value：翻译结果
- 存储：
  - 内存 LRU 缓存（短期）
  - 或 Redis 等（长期）

命中场景：

- 高频重复文案（商品标题 / 常用短语）
- 同一文本多次被不同系统调用

### 4.6 简单限流（可选）

避免误操作把额度打爆：

- 对单服务实例限制 QPS（例如 10 rps）
- 对单 IP 或单业务调用方设置配额

---

## 5. 系统架构设计

### 5.1 逻辑架构

```text
[上游系统]  →  [翻译服务 (FastAPI)]  →  [OpenAI / ChatGPT API]
                      |
                      ├─ 日志 & 监控
                      ├─ 缓存 (可选)
                      └─ 配置 (API Key / 模型等)
```

### 5.2 部署架构（最小可行版）

- 单台 VPS / 云服务器（如 1–2 核 CPU，2–4 GB 内存）
- 运行环境：
  - Python 3.10+
  - FastAPI + Uvicorn / Gunicorn
- 前面可挂：
  - Nginx / Caddy 做反向代理 + TLS
  - 或直接用 Cloudflare Tunnel

---

## 6. 接口设计

### 6.1 HTTP 请求

**URL**：`POST /translate/zh-ru`

**Content-Type**：`application/json; charset=utf-8`

**请求体示例：**

```json
{
  "text": "亲爱的顾客，您的订单已经发货，预计5-7天送达。"
}
```

或：

```json
{
  "text": "Уважаемый клиент, ваш заказ уже отправлен и будет доставлен в течение 5–7 дней."
}
```

### 6.2 HTTP 响应

**成功响应 (200)：**

```json
{
  "translated": "Уважаемый покупатель, ваш заказ уже отправлен, доставка ожидается в течение 5–7 дней."
}
```

或：

```json
{
  "translated": "尊敬的客户，您的订单已经发出，预计在5-7天内送达。"
}
```

**错误响应示例：**

```json
{
  "error": {
    "code": "UPSTREAM_ERROR",
    "message": "翻译服务上游（OpenAI）暂时不可用，请稍后重试。"
  }
}
```

错误码建议（服务内部定义，不一定等于 HTTP 状态码）：

- `INVALID_REQUEST`：参数缺失或格式错误
- `UPSTREAM_ERROR`：OpenAI 接口错误（5xx 等）
- `RATE_LIMITED`：命中本服务限流
- `INTERNAL_ERROR`：服务内部异常

---

## 7. Prompt 设计

### 7.1 System Prompt

建议统一的 System 提示词：

```text
你是一名专业的中俄互译翻译器。
- 所有输出只包含译文，不要任何解释、前后缀或引号。
- 保持原文的语气和礼貌程度。
- 优先使用地道、口语化但自然的表达，适合电商、社交、即时通讯场景。
- 如果输入中文，就翻译成俄文；如果输入俄文，就翻译成中文。
```

### 7.2 Prompt 管理

- 将 System Prompt 写在单独的 Python 模块或配置文件中，方便以后根据业务场景：
  - 普通客服 / 售前
  - 法律 / 正式文书
  - 营销文案（可以适当润色，不仅仅直译）

---

## 8. 配置与环境

### 8.1 环境变量

- `OPENAI_API_KEY`：必填
- `OPENAI_BASE_URL`（可选）：如需走中转或代理
- `MODEL_NAME`（可选，默认 `gpt-5.1-mini`）
- `TEMPERATURE`（可选，默认 `0.2`）

### 8.2 示例 `.env`

```env
OPENAI_API_KEY=sk-xxxxxxx
MODEL_NAME=gpt-5.1-mini
TEMPERATURE=0.2
```

生产环境可使用：

- systemd 环境变量
- Docker 环境变量
- K8s Secret / ConfigMap

---

### 配置建议使用统一的数据库存储方式，prompt建议也在数据库里存储。

## 9. 常见坑与注意事项

### 9.1 API Key 管理

- 不将 API Key 写死在代码库（尤其是 Git 仓库）
- 不在日志中打印 API Key 或完整请求头
- 如果有多个环境（测试 / 生产），建议使用不同的 Key

### 9.2 速率限制（429）

- OpenAI 对不同账号有 QPS / 每分钟 Token 限制
- 需要：
  - 捕获 429 错误
  - 增加指数退避重试（例如 1s、2s、4s）
  - 必要时在调用层做简单限流

### 9.3 上游错误（5xx）

- 遇到 500、502、503、504 等错误：
  - 记录错误日志
  - 重试（限制次数，例如最多 2–3 次）
  - 仍失败时向上游业务返回错误信息（不要无限重试）

### 9.4 文本长度

- 极长文本（如整页长文）可能导致：
  - 请求成本高（Token 多）
  - 响应变慢或失败
- 解决方案：
  - 对文本按段落 / 句子分片翻译
  - 限制单请求最大字符数（例如 2000–4000 字符）
  - 上层业务提前切分内容

### 9.5 编码问题

- 所有输入输出统一为 UTF-8
- 注意 Python 中字符串与 bytes 的转换
- 确保 HTTP 响应头有正确的 `charset=utf-8`

### 9.6 敏感 / 违规内容

- 若文本涉及敏感话题，有可能触发模型的安全策略：
  - 需要在上层业务中做好容错
  - 出现某些被屏蔽内容时，返回一个明确错误提示

### 9.7 成本与账单

- 翻译属于高频调用场景，必须关注：
  - 每次请求平均 Token 消耗（输入 + 输出）
  - 每天 / 每月调用次数
  - 可结合缓存策略减少重复调用
- 建议：
  - 使用 `-mini` 级模型作为主力
  - 对于关键场景才使用更昂贵的模型

---

## 10. 开发任务与里程碑

### 10.1 开发任务拆解

1. 初始化项目结构
   - 创建 Python 虚拟环境
   - 安装依赖：`fastapi`, `uvicorn`, `openai`, `pydantic`
2. 实现核心翻译模块
   - `translate_zh_ru(text)` 函数
   - 与 OpenAI Responses API 对接
3. 实现 FastAPI 接口
   - 路由：`POST /translate/zh-ru`
   - 请求/响应模型（Pydantic）
   - 错误处理（返回统一错误格式）
4. 配置与环境
   - 读取环境变量 / 配置文件
   - 本地 `.env` 示例
5. 日志与简单监控
   - 基础日志（请求耗时、错误信息）
   - 可选：Prometheus 指标、请求计数
6. 缓存与限流（第二阶段）
   - 内存缓存（如 `functools.lru_cache` 或自定义 dict + 过期时间）
   - 简单限流（每秒限制）
7. 部署
   - 使用 Uvicorn / Gunicorn + Nginx 部署
   - 配置 HTTPS（例如通过 Caddy / Nginx / Cloudflare）

### 10.2 里程碑

1. **MVP（最小可用版本）**
   - 完成 `translate_zh_ru` + `POST /translate/zh-ru`
   - 在开发环境测试若干中俄文本
2. **内部集成**
   - 将翻译服务接入一个实际业务（如 Telegram 机器人）
   - 收集实际使用中的例句，微调 Prompt
3. **优化阶段**
   - 加入缓存、限流
   - 增强日志与监控
4. **扩展阶段**
   - 新增多语言端点
   - 针对不同业务（电商、客服、营销）设计不同 Prompt / API

---

## 11. 示例代码（Python 实现）

### 11.1 核心翻译函数（独立模块）

```python
# file: translator.py
from openai import OpenAI
import os

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = """
你是一名专业的中俄互译翻译器。
- 所有输出只包含译文，不要任何解释、前后缀或引号。
- 保持原文的语气和礼貌程度。
- 优先使用地道、口语化但自然的表达，适合电商、社交、即时通讯场景。
- 如果输入中文，就翻译成俄文；如果输入俄文，就翻译成中文。
"""

MODEL_NAME = os.getenv("MODEL_NAME", "gpt-5.1-mini")

def translate_zh_ru(text: str) -> str:
    """
    自动识别中文/俄文，然后互译。
    """
    if not text or not text.strip():
        raise ValueError("text 不能为空")

    resp = client.responses.create(
        model=MODEL_NAME,
        temperature=float(os.getenv("TEMPERATURE", "0.2")),
        input=[
            {
                "role": "system",
                "content": SYSTEM_PROMPT
            },
            {
                "role": "user",
                "content": text
            }
        ],
    )

    # Responses API 返回的文本在 output[0].content[0].text.value 中
    translated = resp.output[0].content[0].text.value
    return translated.strip()
```

### 11.2 FastAPI 服务示例

```python
# file: main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from translator import translate_zh_ru

app = FastAPI(title="ZH-RU Translation Service")

class TranslateRequest(BaseModel):
    text: str

class TranslateResponse(BaseModel):
    translated: str

@app.post("/translate/zh-ru", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    try:
        translated = translate_zh_ru(req.text)
        return TranslateResponse(translated=translated)
    except ValueError as e:
        # 参数错误
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_REQUEST",
            "message": str(e)
        })
    except Exception as e:
        # 这里可以细分 OpenAI 错误、网络错误等
        # 为简化示例，统一处理
        raise HTTPException(status_code=502, detail={
            "code": "UPSTREAM_ERROR",
            "message": "翻译服务上游（OpenAI）暂时不可用，请稍后重试。"
        })
```

### 11.3 启动命令

开发环境：

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

生产环境（示例）：

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
# 或使用 gunicorn + uvicorn workers
# gunicorn -k uvicorn.workers.UvicornWorker main:app -b 0.0.0.0:8000 -w 4
```

---

## 12. 总结

通过本 PRD，可以直接落地一个：

- 基于 Python + FastAPI
- 使用 ChatGPT Responses API
- 面向中俄互译场景
- 支持后续扩展与运维的翻译服务

上游业务只需要通过 HTTP POST 传入 `text`，即可获取稳定、地道的中俄互译结果。未来可以在此基础上：

- 增加更多语言对
- 增加不同业务风格的 Prompt
- 接入更多业务系统（OZON、Telegram、内部后台等）
