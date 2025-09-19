// 验证checkServiceAvailable逻辑

function checkServiceAvailable(service, weight, value) {
  // 检查最小重量限制
  if (service.minWeight && weight < service.minWeight) {
    return { available: false, reason: `低于最小重量限制 ${service.minWeight}g` };
  }

  // 检查最大重量限制
  if (service.maxWeight && weight > service.maxWeight) {
    return { available: false, reason: `超过最大重量限制 ${service.maxWeight}g` };
  }

  // 检查最小货值限制
  if (service.minValue && value < service.minValue) {
    return { available: false, reason: `低于最小货值限制 ${service.minValue} RMB` };
  }

  // 检查最大货值限制
  if (service.maxValue && value > service.maxValue) {
    return { available: false, reason: `超过最大货值限制 ${service.maxValue} RMB` };
  }

  return { available: true };
}

// 测试数据
const testService = {
  minWeight: 1,
  maxWeight: 500,
  minValue: undefined,
  maxValue: 1500
};

// 测试场景
console.log("测试 weight=0, value=0:");
const result1 = checkServiceAvailable(testService, 0, 0);
console.log("结果:", result1);
console.log("预期: 不可用 - 低于最小重量限制\n");

console.log("测试 weight=100, value=0:");
const result2 = checkServiceAvailable(testService, 100, 0);
console.log("结果:", result2);
console.log("预期: 可用 (因为没有minValue限制)\n");

console.log("测试 weight=600, value=1000:");
const result3 = checkServiceAvailable(testService, 600, 1000);
console.log("结果:", result3);
console.log("预期: 不可用 - 超过最大重量限制\n");

// Budget服务测试
const budgetService = {
  minWeight: 501,
  maxWeight: 25000,
  minValue: undefined,
  maxValue: 1500
};

console.log("Budget服务 - 测试 weight=600, value=1000:");
const result4 = checkServiceAvailable(budgetService, 600, 1000);
console.log("结果:", result4);
console.log("预期: 可用\n");

console.log("Budget服务 - 测试 weight=400, value=1000:");
const result5 = checkServiceAvailable(budgetService, 400, 1000);
console.log("结果:", result5);
console.log("预期: 不可用 - 低于最小重量限制");