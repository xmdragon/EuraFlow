# Ozon选品助手 - 安装指南

## 安装步骤

### 1. 安装Tampermonkey扩展
- **Edge浏览器**：访问 [Edge扩展商店](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
- **Chrome浏览器**：访问 [Chrome网上应用店](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)

### 2. 安装用户脚本

#### 方法一：拖拽安装（推荐）
1. 打开浏览器扩展管理页面：
   - Edge：地址栏输入 `edge://extensions/` 并回车
   - Chrome：地址栏输入 `chrome://extensions/` 并回车
2. 确保已开启"开发者模式"（右上角开关）
3. **直接将 `ozon_product_selector.user.js` 文件拖拽到浏览器窗口**
4. Tampermonkey会弹出安装确认，点击"安装"

#### 方法二：通过Tampermonkey面板
1. 点击浏览器工具栏的 Tampermonkey 图标
2. 选择"管理面板"（Dashboard）
3. 点击"实用工具"（Utilities）标签
4. 在"导入文件"区域选择 `ozon_product_selector.user.js` 文件
5. 点击"安装"

#### 方法三：复制粘贴代码
1. 用文本编辑器打开 `ozon_product_selector.user.js`
2. 复制全部代码
3. 点击 Tampermonkey 图标 → "管理面板"
4. 点击左侧"+"按钮（新建脚本）
5. 粘贴代码，按 Ctrl+S 保存

## 使用方法

1. 访问 Ozon 商品列表页面（如：https://www.ozon.ru/category/...）
2. 等待页面加载完成后，右下角会出现"🎯 Ozon选品助手"面板
3. 设置目标商品数量（默认100个）
4. 点击"🚀 开始收集"
5. 脚本会自动滚动页面并采集商品数据
6. 采集完成后会自动上传到EuraFlow系统（需先配置API）

## API配置

1. 展开面板中的"⚙️ API设置"
2. 填写：
   - API地址：`https://ozon.gxfc.life`（或你的服务器地址）
   - API Key：从EuraFlow系统获取
3. 点击"💾 保存配置"
4. 点击"🔍 测试连接"验证配置是否正确

## 常见问题

**Q: 为什么脚本没有运行？**
A: 检查Tampermonkey图标上是否显示数字"1"，表示有脚本在该页面运行。如果没有，确认脚本已启用。

**Q: Chrome无法直接下载.js文件怎么办？**
A: 使用"另存为"或右键链接选择"链接另存为"，保存后按上述方法安装。

**Q: 数据中"跟卖者数量"和"最低跟卖价"显示"-"？**
A: 这是正常的，部分商品没有跟卖信息。脚本会等待5秒确保数据完全加载。

**Q: 如何更新脚本？**
A: 重新安装新版本的脚本文件即可，Tampermonkey会自动替换旧版本。

## 技术支持

如有问题，请联系 EuraFlow 技术团队。
