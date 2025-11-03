/**
 * 扫描结果表格组件
 * 用于扫描单号功能，显示查询到的订单商品信息
 */
import React, { useMemo } from "react";
import { Table, Tag, Tooltip, Button } from "antd";
import {
  CopyOutlined,
  EditOutlined,
  PrinterOutlined,
} from "@ant-design/icons";
import { Typography } from "antd";

import ProductImage from "@/components/ozon/ProductImage";
import { useDateTime } from "@/hooks/useDateTime";
import { statusConfig, operationStatusConfig } from "@/utils/packingHelpers";
import * as ozonApi from "@/services/ozonApi";
import styles from "../../../pages/ozon/PackingShipment.module.scss";

const { Text } = Typography;

// 扫描结果商品行数据结构
interface ScanResultItemRow {
  key: string;
  item: any;
  itemIndex: number;
  posting: any; // PostingWithOrder 但类型定义不完整，使用 any
  isFirstItem: boolean;
  itemCount: number;
}

interface ScanResultTableProps {
  scanResults: any[]; // PostingWithOrder 但类型定义不完整，使用 any
  scanSelectedPostings: string[];
  onSelectedPostingsChange: (postings: string[]) => void;
  onPrintSingle: (postingNumber: string) => void;
  onOpenEditNotes: (posting: any) => void;
  onOpenDomesticTracking: (posting: any) => void;
  shopNameMap: Record<number, string>;
  canOperate: boolean;
  isPrinting: boolean;
  onCopy: (text: string, label: string) => void;
}

const ScanResultTable: React.FC<ScanResultTableProps> = ({
  scanResults,
  scanSelectedPostings,
  onSelectedPostingsChange,
  onPrintSingle,
  onOpenEditNotes,
  onOpenDomesticTracking,
  shopNameMap,
  canOperate,
  isPrinting,
  onCopy,
}) => {
  const { formatDateTime } = useDateTime();
  // 将 scanResults 转换为表格行数据
  const scanItemRows = useMemo<ScanResultItemRow[]>(() => {
    const rows: ScanResultItemRow[] = [];

    scanResults.forEach((posting) => {
      const items = posting.items || [];
      const itemCount = items.length;

      if (itemCount === 0) {
        // 如果没有商品，创建一行空数据
        rows.push({
          key: `${posting.posting_number}_0`,
          item: {} as any,
          itemIndex: 0,
          posting: posting,
          isFirstItem: true,
          itemCount: 1,
        });
      } else {
        // 为每个商品创建一行
        items.forEach((item: any, index: number) => {
          rows.push({
            key: `${posting.posting_number}_${index}`,
            item: item,
            itemIndex: index,
            posting: posting,
            isFirstItem: index === 0,
            itemCount: itemCount,
          });
        });
      }
    });

    return rows;
  }, [scanResults]);

  return (
    <Table
      dataSource={scanItemRows}
      rowKey="key"
      pagination={false}
      size="middle"
      style={
        {
          "--ant-table-padding-vertical": "2px",
          "--ant-table-padding-horizontal": "2px",
        } as React.CSSProperties
      }
      className={styles.scanResultTable}
      rowSelection={
        canOperate
          ? {
              // 将 posting_number 转换为第一行的 key
              selectedRowKeys: scanSelectedPostings.map((pn) => `${pn}_0`),
              onChange: (selectedRowKeys) => {
                // 从 key 中提取 posting_number
                const postingNumbers = Array.from(
                  new Set(
                    (selectedRowKeys as string[]).map((key) =>
                      key.split("_").slice(0, -1).join("_"),
                    ),
                  ),
                );
                onSelectedPostingsChange(postingNumbers);
              },
              getCheckboxProps: (row: ScanResultItemRow) => ({
                // 非第一行不显示复选框
                disabled: !row.isFirstItem,
              }),
              renderCell: (
                _checked,
                row: ScanResultItemRow,
                _index,
                originNode,
              ) => {
                // 只在第一行显示复选框，并使用rowSpan
                if (!row.isFirstItem) {
                  return {
                    props: { rowSpan: 0 },
                    children: null,
                  };
                }
                return {
                  props: { rowSpan: row.itemCount },
                  children: originNode,
                };
              },
            }
          : undefined
      }
      columns={[
        // 第一列：商品图片
        {
          title: "商品图片",
          key: "product_image",
          width: 180,
          render: (_: any, row: ScanResultItemRow) => {
            const item = row.item;

            return (
              <ProductImage
                imageUrl={item.image}
                size="medium"
                hoverBehavior="none"
                name={item.name}
                topRightCorner="link"
                sku={item.sku}
              />
            );
          },
        },
        // 第二列：商品信息
        {
          title: "商品信息",
          key: "product_info",
          width: "20%",
          onCell: () => ({
            className: styles.productInfoCell,
          }),
          render: (_: any, row: ScanResultItemRow) => {
            const item = row.item;
            const price = item.price ? parseFloat(item.price) : 0;
            const quantity = item.quantity || 0;
            const amount = price * quantity;

            return (
              <div
                style={{ display: "flex", flexDirection: "column", gap: "4px" }}
              >
                <div>
                  <Text type="secondary">SKU: </Text>
                  <span>{item.sku || "-"}</span>
                </div>
                <div>
                  <Text type="secondary">名称: </Text>
                  <Tooltip title={item.name}>
                    <span
                      style={{
                        maxWidth: "200px",
                        display: "inline-block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        verticalAlign: "bottom",
                      }}
                    >
                      {item.name || "-"}
                    </span>
                  </Tooltip>
                </div>
                <div>
                  <Text type="secondary">单价: </Text>
                  <span>{price > 0 ? price.toFixed(2) : "-"}</span>
                </div>
                <div>
                  <Text type="secondary">数量: </Text>
                  {quantity > 1 ? (
                    <span className={styles.quantityMultiple}>{quantity}</span>
                  ) : (
                    <span>{quantity}</span>
                  )}
                </div>
                <div>
                  <Text type="secondary">金额: </Text>
                  <span style={{ fontWeight: 500 }}>
                    {amount > 0 ? amount.toFixed(2) : "-"}
                  </span>
                </div>
              </div>
            );
          },
        },
        // 第三列：货件信息（使用rowSpan合并）
        {
          title: "货件信息",
          key: "posting_info",
          render: (_: any, row: ScanResultItemRow) => {
            if (!row.isFirstItem) {
              return {
                props: { rowSpan: 0 },
                children: null,
              };
            }

            const posting = row.posting;
            const shopName =
              shopNameMap[posting.shop_id] || `店铺ID: ${posting.shop_id}`;

            return {
              children: (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <div>
                    <Text type="secondary">店铺: </Text>
                    <span>{shopName}</span>
                  </div>
                  <div>
                    <Text type="secondary">货件: </Text>
                    <span>{posting.posting_number}</span>
                    <CopyOutlined
                      style={{
                        marginLeft: 8,
                        cursor: "pointer",
                        color: "#1890ff",
                      }}
                      onClick={() => onCopy(posting.posting_number, "货件编号")}
                    />
                  </div>
                  <div>
                    <Text type="secondary">追踪: </Text>
                    <span>{posting.tracking_number || "-"}</span>
                    {posting.tracking_number && (
                      <CopyOutlined
                        style={{
                          marginLeft: 8,
                          cursor: "pointer",
                          color: "#1890ff",
                        }}
                        onClick={() =>
                          onCopy(posting.tracking_number, "追踪号码")
                        }
                      />
                    )}
                  </div>
                  {posting.domestic_tracking_numbers &&
                  posting.domestic_tracking_numbers.length > 0 ? (
                    <div style={{ display: "flex", gap: "4px" }}>
                      <Text type="secondary" style={{ flexShrink: 0 }}>
                        国内:{" "}
                      </Text>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        {posting.domestic_tracking_numbers.map(
                          (num: string, idx: number) => (
                            <div key={idx}>
                              <a
                                href={`https://t.17track.net/zh-cn#nums=${num}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: "#1890ff" }}
                              >
                                {num}
                              </a>
                              <CopyOutlined
                                style={{
                                  marginLeft: 4,
                                  cursor: "pointer",
                                  color: "#1890ff",
                                }}
                                onClick={() => onCopy(num, "国内单号")}
                              />
                            </div>
                          ),
                        )}
                        {canOperate && (
                          <Button
                            type="link"
                            size="small"
                            icon={<EditOutlined />}
                            style={{
                              padding: 0,
                              height: "auto",
                              alignSelf: "flex-start",
                            }}
                            onClick={() => onOpenDomesticTracking(posting)}
                          >
                            编辑
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Text type="secondary">国内: </Text>
                      <span>-</span>
                      {canOperate && (
                        <Button
                          type="link"
                          size="small"
                          icon={<EditOutlined />}
                          style={{ padding: 0, height: "auto", marginLeft: 8 }}
                          onClick={() => onOpenDomesticTracking(posting)}
                        >
                          编辑
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ),
              props: {
                rowSpan: row.itemCount,
              },
            };
          },
        },
        // 第四列：订单信息（使用rowSpan合并）
        {
          title: "订单信息",
          key: "order_info",
          render: (_: any, row: ScanResultItemRow) => {
            if (!row.isFirstItem) {
              return {
                props: { rowSpan: 0 },
                children: null,
              };
            }

            const posting = row.posting;
            const statusCfg =
              statusConfig[posting.status] || statusConfig.pending;
            const opStatusCfg = operationStatusConfig[posting.operation_status];

            // 解析配送方式，提取括号前和括号内的内容
            const deliveryMethod = posting.delivery_method || "";
            const match = deliveryMethod.match(/^(.+?)[（(](.+?)[）)]$/);
            const mainText = match ? match[1].trim() : deliveryMethod;
            const detailText = match ? match[2].trim() : "";

            return {
              children: (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <div>
                    <Text type="secondary">配送: </Text>
                    {detailText ? (
                      <Tooltip title={detailText}>
                        <span>{mainText || "-"}</span>
                      </Tooltip>
                    ) : (
                      <span>{mainText || "-"}</span>
                    )}
                  </div>
                  <div>
                    <Text type="secondary">状态: </Text>
                    <Tag color={statusCfg.color}>{statusCfg.text}</Tag>
                  </div>
                  {opStatusCfg && (
                    <div>
                      <Text type="secondary">操作: </Text>
                      <Tag color={opStatusCfg.color}>{opStatusCfg.text}</Tag>
                    </div>
                  )}
                  <div>
                    <Text type="secondary">下单: </Text>
                    {posting.ordered_at
                      ? formatDateTime(posting.ordered_at, "MM-DD HH:mm")
                      : "-"}
                  </div>
                  <div>
                    <Text type="secondary">截止: </Text>
                    <span style={{ color: "#ff4d4f", fontWeight: "bold" }}>
                      {posting.shipment_date
                        ? formatDateTime(posting.shipment_date, "MM-DD HH:mm")
                        : "-"}
                    </span>
                  </div>
                </div>
              ),
              props: {
                rowSpan: row.itemCount,
              },
            };
          },
        },
        // 第五列：备注（使用rowSpan合并）
        {
          title: "备注",
          key: "notes",
          width: 150,
          render: (_: any, row: ScanResultItemRow) => {
            if (!row.isFirstItem) {
              return {
                props: { rowSpan: 0 },
                children: null,
              };
            }

            const posting = row.posting;
            return {
              children: (
                <Tooltip title={posting.order_notes || "暂无备注"}>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "block",
                    }}
                  >
                    {posting.order_notes || "-"}
                  </span>
                </Tooltip>
              ),
              props: {
                rowSpan: row.itemCount,
              },
            };
          },
        },
        // 第六列：操作（使用rowSpan合并）
        {
          title: "操作",
          key: "action",
          width: 80,
          fixed: "right" as const,
          render: (_: any, row: ScanResultItemRow) => {
            if (!row.isFirstItem) {
              return {
                props: { rowSpan: 0 },
                children: null,
              };
            }

            return {
              children: (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  {canOperate && (
                    <>
                      <Button
                        type="link"
                        size="small"
                        icon={<EditOutlined />}
                        style={{ padding: 0, height: "auto" }}
                        onClick={() => onOpenEditNotes(row.posting)}
                      >
                        编辑
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        icon={<PrinterOutlined />}
                        loading={isPrinting}
                        style={{ padding: 0, height: "auto" }}
                        onClick={() =>
                          onPrintSingle(row.posting.posting_number)
                        }
                      >
                        {(row.posting.label_print_count || 0) > 0 &&
                        row.posting.operation_status === "printed"
                          ? "补打"
                          : "打印"}
                      </Button>
                    </>
                  )}
                </div>
              ),
              props: {
                rowSpan: row.itemCount,
              },
            };
          },
        },
      ]}
    />
  );
};

export default ScanResultTable;
