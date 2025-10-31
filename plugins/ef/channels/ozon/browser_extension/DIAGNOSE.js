/**
 * EuraFlow 选品助手 - 精确诊断脚本
 *
 * 使用方法：
 * 1. 打开 Ozon 商品列表页
 * 2. 按 F12 打开控制台
 * 3. 复制此脚本并粘贴到控制台
 * 4. 按回车运行
 */

console.log('%c=== EuraFlow 选品助手诊断工具 ===', 'color: #00ff00; font-size: 18px; font-weight: bold;');
console.log('版本: v1.2.6');
console.log('开始诊断...\n');

// ========== 检查1: 商品卡片 ==========
console.log('%c【检查1】商品卡片', 'color: #00bfff; font-size: 14px; font-weight: bold;');

const cards = document.querySelectorAll('div[type="item"]');
console.log('找到商品卡片数量:', cards.length);

if (cards.length === 0) {
  console.error('❌ 致命错误：没有找到任何商品卡片！');
  console.log('可能原因：');
  console.log('  1. 页面还在加载中，请等待几秒后重新运行此脚本');
  console.log('  2. Ozon 页面结构已变化，选择器 div[type="item"] 失效');
  console.log('  3. 当前不是商品列表页');
  console.log('\n请提供截图给开发者');
} else {
  console.log('✅ 商品卡片正常');

  // ========== 检查2: 商品链接和ID提取 ==========
  console.log('\n%c【检查2】商品链接和ID提取', 'color: #00bfff; font-size: 14px; font-weight: bold;');

  const testCard = cards[0];
  console.log('测试第1个商品卡片...');

  // 查找商品链接
  const link = testCard.querySelector('a[href*="/product/"]');

  if (!link) {
    console.error('❌ 致命错误：找不到商品链接！');
    console.log('选择器: a[href*="/product/"]');
    console.log('卡片HTML结构:', testCard.outerHTML.substring(0, 500) + '...');
    console.log('\n请将上面的HTML结构截图发送给开发者');
  } else {
    console.log('✅ 找到商品链接:', link.href);

    // 提取 product_id (SKU)
    const urlParts = link.href.split('/product/');
    if (urlParts.length <= 1) {
      console.error('❌ 链接格式异常：不包含 /product/');
      console.log('完整链接:', link.href);
    } else {
      const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');
      const lastDashIndex = pathPart.lastIndexOf('-');

      if (lastDashIndex === -1) {
        console.error('❌ 无法提取SKU：链接中没有连字符');
        console.log('路径部分:', pathPart);
      } else {
        const potentialSKU = pathPart.substring(lastDashIndex + 1);

        if (/^\d+$/.test(potentialSKU)) {
          console.log('✅ 成功提取 product_id:', potentialSKU);
        } else {
          console.error('❌ 提取的SKU不是纯数字:', potentialSKU);
          console.log('路径部分:', pathPart);
        }
      }
    }
  }

  // ========== 检查3: 上品帮数据 ==========
  console.log('\n%c【检查3】上品帮数据', 'color: #00bfff; font-size: 14px; font-weight: bold;');

  const bangElement = testCard.querySelector('.ozon-bang-item[data-ozon-bang="true"]') ||
                       testCard.querySelector('.ozon-bang-item');

  if (!bangElement) {
    console.warn('⚠️ 警告：找不到上品帮数据元素');
    console.log('这可能导致部分数据缺失，但不影响采集');
    console.log('请确认上品帮扩展是否已启用');
  } else {
    console.log('✅ 上品帮数据正常');
    console.log('数据内容（前100字符）:', bangElement.textContent?.substring(0, 100));
  }

  // ========== 检查4: 批量测试（前5个商品）==========
  console.log('\n%c【检查4】批量测试（前5个商品）', 'color: #00bfff; font-size: 14px; font-weight: bold;');

  let successCount = 0;
  let failCount = 0;
  const testCount = Math.min(5, cards.length);

  for (let i = 0; i < testCount; i++) {
    const card = cards[i];
    const cardLink = card.querySelector('a[href*="/product/"]');

    if (cardLink && cardLink.href) {
      const urlParts = cardLink.href.split('/product/');
      if (urlParts.length > 1) {
        const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');
        const lastDashIndex = pathPart.lastIndexOf('-');

        if (lastDashIndex !== -1) {
          const potentialSKU = pathPart.substring(lastDashIndex + 1);
          if (/^\d+$/.test(potentialSKU)) {
            successCount++;
            console.log(`  商品${i + 1}: ✅ SKU=${potentialSKU}`);
            continue;
          }
        }
      }
    }

    failCount++;
    console.error(`  商品${i + 1}: ❌ 无法提取SKU`);
  }

  console.log(`\n批量测试结果: ${successCount}/${testCount} 成功`);

  if (failCount > 0) {
    console.error(`❌ 有 ${failCount} 个商品无法提取SKU，这会导致进度条不更新`);
  }

  // ========== 检查5: DEBUG模式和错误日志 ==========
  console.log('\n%c【检查5】DEBUG模式和错误日志', 'color: #00bfff; font-size: 14px; font-weight: bold;');

  if (typeof window.EURAFLOW_DEBUG === 'undefined') {
    console.log('DEBUG模式: 未启用');
    console.log('建议：在控制台输入以下命令启用DEBUG模式，然后重新采集：');
    console.log('%cwindow.EURAFLOW_DEBUG = true', 'color: yellow; background: black; padding: 5px;');
  } else {
    console.log('DEBUG模式:', window.EURAFLOW_DEBUG ? '✅ 已启用' : '未启用');
  }
}

// ========== 诊断总结 ==========
console.log('\n%c=== 诊断完成 ===', 'color: #00ff00; font-size: 16px; font-weight: bold;');

if (cards.length === 0) {
  console.log('%c结论: 找不到商品卡片，无法采集', 'color: red; font-size: 14px;');
  console.log('建议: 等待页面完全加载后重试，或联系开发者');
} else {
  const firstLink = cards[0].querySelector('a[href*="/product/"]');
  if (!firstLink) {
    console.log('%c结论: 商品链接选择器失效', 'color: red; font-size: 14px;');
    console.log('建议: Ozon页面结构可能已更新，需要开发者修复');
  } else {
    console.log('%c结论: 基础检查通过', 'color: green; font-size: 14px;');
    console.log('建议: ');
    console.log('  1. 启用DEBUG模式: window.EURAFLOW_DEBUG = true');
    console.log('  2. 点击扩展的"开始采集"按钮');
    console.log('  3. 观察控制台是否输出 "[DEBUG] 采集到新商品"');
    console.log('  4. 如果没有输出，请将完整的控制台日志截图发送给开发者');
  }
}

console.log('\n截图指南:');
console.log('  - 截图包含上面的所有输出');
console.log('  - 如果启用DEBUG后重新采集，也要截图控制台输出');
console.log('  - 发送给开发者时，请说明问题现象');
