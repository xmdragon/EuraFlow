/**
 * 通用页面标题组件
 */
import React from 'react';

import styles from './PageTitle.module.scss';

interface PageTitleProps {
  icon?: React.ReactNode;
  title: string;
  className?: string;
}

const PageTitle: React.FC<PageTitleProps> = ({ icon, title, className }) => {
  return (
    <h2 className={`${styles.pageTitle} ${className || ''}`}>
      {icon && <span className={styles.icon}>{icon}</span>}
      {title}
    </h2>
  );
};

export default PageTitle;
