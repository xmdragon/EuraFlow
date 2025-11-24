/**
 * 商品创建页 - 表单底部操作区
 */
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import React from 'react';

import styles from '../ProductCreate.module.scss';

export interface ProductFormFooterProps {
  hasUnsavedChanges: boolean;
  createProductLoading: boolean;
  uploadImageLoading: boolean;
  handleManualSaveDraft: () => void;
  handleDeleteDraft: () => void;
  handleOpenSaveTemplateModal: () => void;
  handleOpenTemplateModal: () => void;
  handleSubmit: () => void;
  handleReset: () => void;
}

export const ProductFormFooter: React.FC<ProductFormFooterProps> = ({
  hasUnsavedChanges,
  createProductLoading,
  uploadImageLoading,
  handleManualSaveDraft,
  handleDeleteDraft,
  handleOpenSaveTemplateModal,
  handleOpenTemplateModal,
  handleSubmit,
  handleReset,
}) => {
  return (
    <div style={{ backgroundColor: '#fff', padding: '16px 24px', borderTop: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end' }}>
        {hasUnsavedChanges && (
          <span className={styles.unsavedIndicator}>有未保存的更改</span>
        )}

        {/* 草稿下拉菜单 */}
        <Dropdown
          menu={{
            items: [
              {
                key: 'save',
                label: '保存',
                onClick: handleManualSaveDraft,
              },
              {
                key: 'delete',
                label: '删除',
                danger: true,
                onClick: handleDeleteDraft,
              },
            ],
          }}
        >
          <Button size="large">
            草稿 <DownOutlined />
          </Button>
        </Dropdown>

        {/* 模板下拉菜单 */}
        <Dropdown
          menu={{
            items: [
              {
                key: 'save-template',
                label: '保存模板',
                onClick: handleOpenSaveTemplateModal,
              },
              {
                key: 'apply-template',
                label: '引用模板',
                onClick: handleOpenTemplateModal,
              },
            ],
          }}
        >
          <Button size="large">
            模板 <DownOutlined />
          </Button>
        </Dropdown>

        <Button
          type="primary"
          size="large"
          className={styles.primaryBtn}
          icon={<PlusOutlined />}
          loading={createProductLoading || uploadImageLoading}
          onClick={handleSubmit}
        >
          提交至OZON
        </Button>

        <Button size="large" onClick={handleReset}>
          重置
        </Button>
      </div>
    </div>
  );
};
