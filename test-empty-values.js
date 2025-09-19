// 测试空值行为

// 模拟 calculationData 初始状态
const calculationData = {
  weight: undefined,
  length: undefined,
  width: undefined,
  height: undefined,
  value: undefined,
  deliveryType: 'pickup'
};

// 解构并使用默认值
const { weight = 0, length = 0, width = 0, height = 0, value = 0 } = calculationData;

console.log("初始值（undefined）转换为默认值（0）：");
console.log("weight:", weight);
console.log("length:", length);
console.log("width:", width);
console.log("height:", height);
console.log("value:", value);
console.log("");

// 测试 InputNumber 组件的行为
console.log("InputNumber 组件行为：");
console.log("- value={undefined} 会显示为空输入框");
console.log("- value={0} 会显示 '0'");
console.log("- 用户清空输入框时，onChange 会接收到 null");
console.log("- 我们将 null 存储为 undefined");
console.log("");

// 测试检查逻辑
function checkServiceAvailable(minWeight, weight) {
  if (minWeight && weight < minWeight) {
    return { available: false, reason: `低于最小重量限制 ${minWeight}g` };
  }
  return { available: true };
}

console.log("服务可用性检查：");
console.log("minWeight=1, weight=0:", checkServiceAvailable(1, 0));
console.log("minWeight=1, weight=undefined (转为0):", checkServiceAvailable(1, 0));
console.log("minWeight=1, weight=100:", checkServiceAvailable(1, 100));