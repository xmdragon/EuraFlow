/**
 * 商品导出工具函数
 */
import * as ozonApi from '@/services/ozonApi';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

/**
 * 导出商品数据为CSV
 */
export const exportProductsToCSV = (productsData: ozonApi.Product[] | undefined) => {
  if (!productsData || productsData.length === 0) {
    notifyWarning('导出失败', '没有商品数据可以导出');
    return;
  }

  try {
    // 准备CSV数据
    const csvData = productsData.map((product) => ({
      商品货号: product.offer_id,
      商品标题: product.title || '',
      品牌: product.brand || '',
      条形码: product.barcode || '',
      状态: product.status,
      可见性: product.visibility ? '可见' : '不可见',
      售价: product.price || '0',
      原价: product.old_price || '',
      成本价: product.cost || '',
      总库存: product.stock,
      可售库存: product.available,
      预留库存: product.reserved,
      '重量(g)': product.weight || '',
      '宽度(mm)': product.width || '',
      '高度(mm)': product.height || '',
      '深度(mm)': product.depth || '',
      同步状态: product.sync_status,
      最后同步时间: product.last_sync_at || '',
      创建时间: product.created_at,
      更新时间: product.updated_at,
    }));

    // 转换为CSV格式
    const headers = Object.keys(csvData[0]);
    const csvContent = [
      headers.join(','),
      ...csvData.map((row) =>
        headers
          .map((header) => {
            const value = row[header as keyof typeof row];
            // 处理包含逗号的值，用双引号包围
            return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
          })
          .join(',')
      ),
    ].join('\n');

    // 创建下载
    const blob = new Blob(['\uFEFF' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `商品数据_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    notifySuccess('导出成功', `成功导出 ${csvData.length} 个商品的数据`);
  } catch (error) {
    loggers.product.error('Export error:', error);
    notifyError('导出失败', '导出失败，请重试');
  }
};
