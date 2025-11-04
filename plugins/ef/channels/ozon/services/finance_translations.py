"""
OZON财务交易字段俄语->中文翻译映射

包含：
- operation_type_name: 操作类型名称
- transaction_type: 交易类型
- 其他可能的俄语字段
"""

# 操作类型名称翻译（俄语 -> 中文）
OPERATION_TYPE_NAME_TRANSLATIONS = {
    # 支付和费用相关
    "Оплата эквайринга": "支付手续费（收单费）",
    "Агентское вознаграждение за заключение и сопровождение договора транспортно-экспедиционных услуг по организации международной перевозки": "国际物流代理服务费",
    "Доставка покупателю": "配送至买家",
    "Перевыставление услуг доставки": "物流服务费重新计费",

    # 退货和取消相关
    "Возврат товара": "商品退货",
    "Отмена заказа": "订单取消",
    "Возврат средств покупателю": "退款给买家",

    # 佣金和服务费
    "Комиссия за продажу": "销售佣金",
    "Услуга сборки заказа": "订单拣选服务费",
    "Услуга хранения": "仓储服务费",
    "Услуга упаковки": "包装服务费",
    "Услуга за обработку операционных ошибок продавца: отмена": "卖家错误取消服务费",

    # 补偿和罚款
    "Компенсация": "补偿",
    "Штраф": "罚款",
    "Бонус": "奖金",

    # 其他常见操作
    "Продажа": "销售",
    "Начисление": "应计",
    "Списание": "扣款",
    "Корректировка": "调整",
    "Перечисление": "转账",
}


def translate_operation_type_name(russian_name: str) -> str:
    """
    翻译操作类型名称（俄语->中文）

    Args:
        russian_name: 俄语操作类型名称

    Returns:
        中文翻译，如果找不到翻译则返回原文
    """
    if not russian_name:
        return russian_name

    # 完全匹配翻译
    translation = OPERATION_TYPE_NAME_TRANSLATIONS.get(russian_name)
    if translation:
        return translation

    # 如果找不到完全匹配，尝试部分匹配（包含关键词）
    for russian_key, chinese_value in OPERATION_TYPE_NAME_TRANSLATIONS.items():
        if russian_key in russian_name or russian_name in russian_key:
            return chinese_value

    # 如果都找不到，返回原文（保持俄语）
    return russian_name


def translate_finance_transaction_record(record: dict) -> dict:
    """
    翻译财务交易记录中的俄语字段

    Args:
        record: 原始记录字典

    Returns:
        翻译后的记录字典
    """
    if "operation_type_name" in record and record["operation_type_name"]:
        record["operation_type_name"] = translate_operation_type_name(record["operation_type_name"])

    return record
