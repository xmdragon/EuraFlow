/**
 * 扫描单号页面
 *
 * 独立的扫描单号功能页面，支持：
 * - 发货员（shipper）：只能看到启用发货托管的店铺订单
 * - 主账号/子账号：只能看到授权店铺订单
 */
import {
  SearchOutlined,
  CloseCircleOutlined,
  PrinterOutlined,
  EditOutlined,
  CopyOutlined,
  ScanOutlined,
} from '@ant-design/icons';
import {
  Card,
  Input,
  Button,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Empty,
  Spin,
  Radio,
  message,
} from 'antd';
import dayjs from 'dayjs';
import React, { useState, useRef, useCallback, useEffect } from 'react';

import styles from './PackingShipment.module.scss';

import PageTitle from '@/components/PageTitle';
import ProductImage from '@/components/ozon/ProductImage';
import EditNotesModal from '@/components/ozon/packing/EditNotesModal';
import PrintLabelModal from '@/components/ozon/packing/PrintLabelModal';
import { useCopy } from '@/hooks/useCopy';
import { useDateTime } from '@/hooks/useDateTime';
import { usePermission } from '@/hooks/usePermission';
import { readAndValidateClipboard, markClipboardRejected } from '@/hooks/useClipboard';
import axios from '@/services/axios';
import * as ozonApi from '@/services/ozon';
import { statusConfig, operationStatusConfig } from '@/utils/packingHelpers';

import type { InputRef } from 'antd';

const { Text } = Typography;

// 判断订单是否超过10天（逾期）
const isOrderOverdue = (inProcessAt: string | undefined): boolean => {
  if (!inProcessAt) return false;
  const orderDate = dayjs(inProcessAt);
  const daysDiff = dayjs().diff(orderDate, 'day');
  return daysDiff > 10;
};

// 行数据结构
interface ScanResultItemRow {
  key: string;
  item: ozonApi.OrderItem;
  itemIndex: number;
  posting: ozonApi.PostingWithOrder;
  isFirstItem: boolean;
  itemCount: number;
  postingIndex: number;
}

// 托管店铺信息
interface ManagedShop {
  id: number;
  shop_name: string;
  shop_name_cn?: string;
  display_name: string;
}

const ScanShipping: React.FC = () => {
  const { canOperate, isShipper } = usePermission();
  const { formatDateTime } = useDateTime();
  const { copyToClipboard } = useCopy();

  // 状态
  const [searchValue, setSearchValue] = useState('');
  const [isAutoFilled, setIsAutoFilled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanResults, setScanResults] = useState<ozonApi.PostingWithOrder[]>([]);
  const [selectedPostings, setSelectedPostings] = useState<string[]>([]);
  const [shopNameMap, setShopNameMap] = useState<Record<number, string>>({});
  const [printStatus, setPrintStatus] = useState<string>('all');

  // 弹窗状态
  const [editNotesModal, setEditNotesModal] = useState<{
    visible: boolean;
    posting: ozonApi.PostingWithOrder | null;
  }>({ visible: false, posting: null });
  const [printLabelModal, setPrintLabelModal] = useState<{
    visible: boolean;
    postingNumbers: string[];
  }>({ visible: false, postingNumbers: [] });
  const [isPrinting, setIsPrinting] = useState(false);

  const searchInputRef = useRef<InputRef>(null);

  // 加载托管店铺列表（用于获取店铺名称映射）
  useEffect(() => {
    const loadManagedShops = async () => {
      try {
        const response = await axios.get('/api/ef/v1/ozon/scan-shipping/shops');
        if (response.data?.data) {
          const map: Record<number, string> = {};
          response.data.data.forEach((shop: ManagedShop) => {
            map[shop.id] = shop.display_name;
          });
          setShopNameMap(map);
        }
      } catch (error) {
        console.error('加载托管店铺失败:', error);
      }
    };
    loadManagedShops();
  }, []);

  // 处理搜索
  const handleSearch = useCallback(async () => {
    const value = searchValue.trim();
    if (!value) {
      message.warning('请输入追踪号码/国内单号/货件编号');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.get('/api/ef/v1/ozon/scan-shipping/search', {
        params: {
          tracking_number: value,
          print_status: printStatus,
          limit: 50,
        },
      });

      if (response.data?.data) {
        setScanResults(response.data.data);
        setSelectedPostings([]);
        if (response.data.data.length === 0) {
          // 检查是否是托管订单
          if (response.data.is_managed) {
            message.warning(response.data.message || '该订单已经托管发货');
          } else if (response.data.message) {
            message.info(response.data.message);
          } else {
            message.info('未找到匹配的订单');
          }
        }
      }
    } catch (error: unknown) {
      console.error('搜索失败:', error);
      const errorMessage = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '搜索失败';
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [searchValue, printStatus]);

  // 输入框获得焦点时，尝试自动填充剪贴板内容
  const handleInputFocus = async () => {
    if (searchValue) return;

    const clipboardText = await readAndValidateClipboard();
    if (clipboardText) {
      setSearchValue(clipboardText);
      setIsAutoFilled(true);
    }
  };

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    setIsAutoFilled(false);
  };

  // 清除输入框
  const handleClearInput = () => {
    if (searchValue && isAutoFilled) {
      markClipboardRejected(searchValue);
    }
    setSearchValue('');
    setIsAutoFilled(false);
    searchInputRef.current?.focus();
  };

  // 回车搜索
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // 打印标签
  const handlePrint = useCallback((postingNumbers: string[]) => {
    if (postingNumbers.length === 0) {
      message.warning('请选择要打印的订单');
      return;
    }
    setPrintLabelModal({ visible: true, postingNumbers });
  }, []);

  const handlePrintSingle = useCallback((postingNumber: string) => {
    handlePrint([postingNumber]);
  }, [handlePrint]);

  const handlePrintSelected = useCallback(() => {
    handlePrint(selectedPostings);
  }, [handlePrint, selectedPostings]);

  // 编辑备注
  const handleOpenEditNotes = useCallback((posting: ozonApi.PostingWithOrder) => {
    setEditNotesModal({ visible: true, posting });
  }, []);

  // 保存备注后刷新
  const handleNotesUpdated = useCallback(() => {
    // 重新搜索以刷新数据
    handleSearch();
  }, [handleSearch]);

  // 复制
  const handleCopy = useCallback((text: string, label: string) => {
    copyToClipboard(text, label);
  }, [copyToClipboard]);

  // 将 scanResults 转换为表格行数据
  const scanItemRows: ScanResultItemRow[] = React.useMemo(() => {
    const rows: ScanResultItemRow[] = [];

    scanResults.forEach((posting, postingIndex) => {
      const items = posting.products || [];
      const itemCount = items.length || 1;

      if (items.length === 0) {
        rows.push({
          key: `${posting.posting_number}_0`,
          item: {} as ozonApi.OrderItem,
          itemIndex: 0,
          posting: posting,
          isFirstItem: true,
          itemCount: 1,
          postingIndex,
        });
      } else {
        items.forEach((item: ozonApi.OrderItem, index: number) => {
          rows.push({
            key: `${posting.posting_number}_${index}`,
            item: item,
            itemIndex: index,
            posting: posting,
            isFirstItem: index === 0,
            itemCount: itemCount,
            postingIndex,
          });
        });
      }
    });

    return rows;
  }, [scanResults]);

  // 选中行的 keys
  const selectedRowKeys = React.useMemo(() => {
    return selectedPostings.map((pn) => `${pn}_0`);
  }, [selectedPostings]);

  // 表格列定义
  const columns = [
    {
      title: '商品图片',
      key: 'product_image',
      width: 180,
      render: (_: unknown, row: ScanResultItemRow) => (
        <ProductImage
          imageUrl={row.item.image}
          size="medium"
          hoverBehavior="none"
          name={row.item.name}
          topRightCorner="link"
          sku={row.item.sku}
        />
      ),
    },
    {
      title: '商品信息',
      key: 'product_info',
      width: '20%',
      render: (_: unknown, row: ScanResultItemRow) => {
        const item = row.item;
        const price = item.price ? parseFloat(item.price) : 0;
        const quantity = item.quantity || 0;
        const amount = price * quantity;

        return (
          <div className={styles.columnContainer}>
            <div>
              <Text type="secondary">SKU: </Text>
              <span>{item.sku || '-'}</span>
              {item.sku && (
                <CopyOutlined
                  className={styles.copyIcon}
                  onClick={() => handleCopy(item.sku, 'SKU')}
                />
              )}
            </div>
            <div>
              <Text type="secondary">名称: </Text>
              <Tooltip title={item.name}>
                <span className={styles.productNameText}>{item.name || '-'}</span>
              </Tooltip>
            </div>
            <div>
              <Text type="secondary">单价: </Text>
              <span>{price > 0 ? price.toFixed(2) : '-'}</span>
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
              <span className={styles.amountText}>{amount > 0 ? amount.toFixed(2) : '-'}</span>
            </div>
          </div>
        );
      },
    },
    {
      title: '货件信息',
      key: 'posting_info',
      render: (_: unknown, row: ScanResultItemRow) => {
        if (!row.isFirstItem) {
          return { props: { rowSpan: 0 }, children: null };
        }

        const posting = row.posting;
        const shopName = shopNameMap[posting.shop_id] || `店铺ID: ${posting.shop_id}`;

        return {
          children: (
            <div className={styles.columnContainer}>
              <div>
                <Text type="secondary">店铺: </Text>
                <span>{shopName}</span>
              </div>
              <div>
                <Text type="secondary">货件: </Text>
                <span>{posting.posting_number}</span>
                <CopyOutlined
                  className={styles.copyIcon}
                  onClick={() => handleCopy(posting.posting_number, '货件编号')}
                />
              </div>
              <div>
                <Text type="secondary">追踪: </Text>
                <span>{posting.tracking_number || '-'}</span>
                {posting.tracking_number && (
                  <CopyOutlined
                    className={styles.copyIcon}
                    onClick={() => handleCopy(posting.tracking_number, '追踪号码')}
                  />
                )}
              </div>
              {posting.domestic_tracking_numbers && posting.domestic_tracking_numbers.length > 0 ? (
                <div className={styles.domesticTrackingWrapper}>
                  <Text type="secondary" className={styles.domesticTrackingLabel}>
                    国内:{' '}
                  </Text>
                  <div className={styles.domesticTrackingList}>
                    {posting.domestic_tracking_numbers.map((num: string, idx: number) => (
                      <div key={idx}>
                        <a
                          href={`https://t.17track.net/zh-cn#nums=${num}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.link}
                        >
                          {num}
                        </a>
                        <CopyOutlined
                          className={styles.copyIcon}
                          onClick={() => handleCopy(num, '国内单号')}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <Text type="secondary">国内: </Text>
                  <span>-</span>
                </div>
              )}
            </div>
          ),
          props: { rowSpan: row.itemCount },
        };
      },
    },
    {
      title: '订单信息',
      key: 'order_info',
      render: (_: unknown, row: ScanResultItemRow) => {
        if (!row.isFirstItem) {
          return { props: { rowSpan: 0 }, children: null };
        }

        const posting = row.posting;
        const statusCfg = statusConfig[posting.status] || statusConfig.pending;
        const opStatusCfg = operationStatusConfig[posting.operation_status];

        const deliveryMethod = posting.delivery_method_name || '';
        const match = deliveryMethod.match(/^(.+?)[（(](.+?)[）)]$/);
        const mainText = match ? match[1].trim() : deliveryMethod;
        const detailText = match ? match[2].trim() : '';

        return {
          children: (
            <div className={styles.columnContainer}>
              <div>
                <Text type="secondary">配送: </Text>
                {detailText ? (
                  <Tooltip title={detailText}>
                    <span>{mainText || '-'}</span>
                  </Tooltip>
                ) : (
                  <span>{mainText || '-'}</span>
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
                {posting.ordered_at ? formatDateTime(posting.ordered_at, 'MM-DD HH:mm') : '-'}
              </div>
              <div>
                <Text type="secondary">截止: </Text>
                <span className={styles.deadline}>
                  {posting.shipment_date ? formatDateTime(posting.shipment_date, 'MM-DD HH:mm') : '-'}
                </span>
              </div>
            </div>
          ),
          props: { rowSpan: row.itemCount },
        };
      },
    },
    {
      title: '备注',
      key: 'notes',
      width: 150,
      render: (_: unknown, row: ScanResultItemRow) => {
        if (!row.isFirstItem) {
          return { props: { rowSpan: 0 }, children: null };
        }

        const posting = row.posting;
        const overdue = isOrderOverdue(posting.in_process_at);

        return {
          children: (
            <div className={styles.columnContainer}>
              {overdue && (
                <Text type="danger" strong className={styles.overdueText}>
                  本订单已逾期！
                </Text>
              )}
              <Tooltip title={posting.order_notes || '暂无备注'}>
                <span className={styles.notesText}>{posting.order_notes || '-'}</span>
              </Tooltip>
            </div>
          ),
          props: { rowSpan: row.itemCount },
        };
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, row: ScanResultItemRow) => {
        if (!row.isFirstItem) {
          return { props: { rowSpan: 0 }, children: null };
        }

        // 发货员可以操作（打印和编辑备注）
        const canAction = canOperate || isShipper;

        return {
          children: (
            <div className={styles.columnContainer}>
              {canAction && (
                <>
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    className={styles.linkButton}
                    onClick={() => handleOpenEditNotes(row.posting)}
                  >
                    编辑
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    icon={<PrinterOutlined />}
                    loading={isPrinting}
                    className={styles.linkButton}
                    onClick={() => handlePrintSingle(row.posting.posting_number)}
                  >
                    {(row.posting.label_print_count || 0) > 0 && row.posting.operation_status === 'printed'
                      ? '补打'
                      : '打印'}
                  </Button>
                </>
              )}
            </div>
          ),
          props: { rowSpan: row.itemCount },
        };
      },
    },
  ];

  return (
    <div className={styles.container}>
      <PageTitle>扫描单号</PageTitle>

      {/* 搜索区域 */}
      <Card className={styles.filterCard}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Input
              ref={searchInputRef}
              placeholder="输入追踪号码/国内单号/货件编号"
              prefix={<ScanOutlined />}
              style={{ width: 320 }}
              value={searchValue}
              onChange={handleInputChange}
              onFocus={handleInputFocus}
              onKeyDown={handleKeyDown}
              suffix={
                searchValue ? (
                  <CloseCircleOutlined
                    onClick={handleClearInput}
                    style={{ color: '#999', cursor: 'pointer' }}
                  />
                ) : null
              }
            />
            <Radio.Group value={printStatus} onChange={(e) => setPrintStatus(e.target.value)}>
              <Radio.Button value="all">全部</Radio.Button>
              <Radio.Button value="unprinted">未打印</Radio.Button>
              <Radio.Button value="printed">已打印</Radio.Button>
            </Radio.Group>
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loading}>
              搜索
            </Button>
          </Space>

          {/* 批量操作 */}
          {scanResults.length > 0 && (canOperate || isShipper) && (
            <Space>
              <Text type="secondary">
                已选择 {selectedPostings.length} 个订单
              </Text>
              <Button
                icon={<PrinterOutlined />}
                onClick={handlePrintSelected}
                disabled={selectedPostings.length === 0}
              >
                批量打印
              </Button>
            </Space>
          )}
        </Space>
      </Card>

      {/* 结果区域 */}
      <Card className={styles.tableCard}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <Spin size="large" />
          </div>
        ) : scanResults.length === 0 ? (
          <Empty
            description={
              <span>
                {isShipper
                  ? '请扫描单号查询订单（仅显示启用发货托管的店铺订单）'
                  : '请扫描单号查询订单'}
              </span>
            }
          />
        ) : (
          <Table
            dataSource={scanItemRows}
            columns={columns}
            rowKey="key"
            pagination={false}
            size="middle"
            style={
              {
                '--ant-table-padding-vertical': '2px',
                '--ant-table-padding-horizontal': '2px',
              } as React.CSSProperties
            }
            className={styles.scanResultTable}
            rowClassName={(row: ScanResultItemRow) => {
              const classes: string[] = [];
              const postingIdx = scanResults.findIndex((p) => p.posting_number === row.posting.posting_number);
              if (postingIdx % 2 === 1) {
                classes.push(styles.zebraRow);
              }
              if (isOrderOverdue(row.posting.in_process_at)) {
                classes.push(styles.overdueRow);
              }
              return classes.join(' ');
            }}
            rowSelection={
              canOperate || isShipper
                ? {
                    selectedRowKeys,
                    onChange: (newSelectedRowKeys) => {
                      const postingNumbers: string[] = [];
                      const seen = new Set<string>();
                      for (const key of newSelectedRowKeys as string[]) {
                        const lastUnderscoreIndex = key.lastIndexOf('_');
                        const pn = key.substring(0, lastUnderscoreIndex);
                        if (!seen.has(pn)) {
                          seen.add(pn);
                          postingNumbers.push(pn);
                        }
                      }
                      setSelectedPostings(postingNumbers);
                    },
                    getCheckboxProps: (row: ScanResultItemRow) => ({
                      disabled: !row.isFirstItem,
                    }),
                    renderCell: (_checked, row: ScanResultItemRow, _index, originNode) => {
                      if (!row.isFirstItem) {
                        return { props: { rowSpan: 0 }, children: null };
                      }
                      return { props: { rowSpan: row.itemCount }, children: originNode };
                    },
                  }
                : undefined
            }
          />
        )}
      </Card>

      {/* 编辑备注弹窗 */}
      {editNotesModal.posting && (
        <EditNotesModal
          visible={editNotesModal.visible}
          posting={editNotesModal.posting}
          onCancel={() => setEditNotesModal({ visible: false, posting: null })}
          onSuccess={handleNotesUpdated}
        />
      )}

      {/* 打印标签弹窗 */}
      <PrintLabelModal
        visible={printLabelModal.visible}
        postingNumbers={printLabelModal.postingNumbers}
        onCancel={() => setPrintLabelModal({ visible: false, postingNumbers: [] })}
        onPrintStart={() => setIsPrinting(true)}
        onPrintEnd={() => {
          setIsPrinting(false);
          handleSearch(); // 刷新数据
        }}
      />
    </div>
  );
};

export default ScanShipping;
