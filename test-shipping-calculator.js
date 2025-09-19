// 测试运费计算器在初始值为0时的行为

console.log("测试场景 1: 初始状态（所有值为0）");
console.log("期望: 所有标签页都显示警告信息");
console.log("原因: weight=0, value=0 不满足任何服务的最小要求\n");

console.log("测试场景 2: 输入重量100g，其他为0");
console.log("期望: 只有UNI Extra Small标签页显示可用服务");
console.log("原因: 100g满足Extra Small (1-500g)，但value=0不满足其他类别的最小货值要求\n");

console.log("测试场景 3: 输入重量600g，货值1000 RMB");
console.log("期望: 只有UNI Budget标签页显示可用服务");
console.log("原因: 600g满足Budget (501-25000g)，1000 RMB < 1500满足Budget的货值要求\n");

console.log("测试场景 4: 输入重量1500g，货值2000 RMB");
console.log("期望: UNI Small标签页显示可用服务");
console.log("原因: 1500g满足Small (1-2000g)，2000 RMB满足Small的货值范围(1501-7000)\n");

console.log("测试场景 5: 输入重量3000g，货值3000 RMB");
console.log("期望: UNI Big标签页显示可用服务");
console.log("原因: 3000g满足Big (2001-25000g)，3000 RMB满足Big的货值范围(1501-7000)\n");

console.log("测试场景 6: 输入重量3000g，货值8000 RMB");
console.log("期望: UNI Premium Small标签页显示可用服务");
console.log("原因: 3000g满足Premium Small (1-5000g)，8000 RMB > 7000满足高客单要求\n");

console.log("测试场景 7: 输入重量6000g，货值10000 RMB");
console.log("期望: UNI Premium Big标签页显示可用服务");
console.log("原因: 6000g满足Premium Big (5001-25000g)，10000 RMB > 7000满足高客单要求\n");

// 验证逻辑总结
console.log("\n=== 验证要点 ===");
console.log("1. 初始值为0时，所有标签页都应显示不适用的警告");
console.log("2. 只有符合重量和货值范围的标签页才显示服务表格");
console.log("3. 不符合条件的标签页显示清晰的警告信息，包含当前输入参数");
console.log("4. 自动切换到第一个可用的标签页");
console.log("5. 手动切换到不符合条件的标签页时，显示警告而不是错误的运费");