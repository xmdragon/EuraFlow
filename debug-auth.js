// 认证调试脚本
// 在浏览器控制台中运行此脚本来调试认证问题

console.log('=== 认证调试信息 ===');

// 1. 检查localStorage中的token
const accessToken = localStorage.getItem('access_token');
const refreshToken = localStorage.getItem('refresh_token');

console.log('1. LocalStorage Token 状态:');
console.log('  Access Token:', accessToken ? `存在 (${accessToken.length} 字符)` : '不存在');
console.log('  Refresh Token:', refreshToken ? `存在 (${refreshToken.length} 字符)` : '不存在');

if (accessToken) {
  try {
    const parts = accessToken.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      console.log('  Token 解析:');
      console.log('    过期时间:', payload.exp ? new Date(payload.exp * 1000).toISOString() : '无');
      console.log('    签发时间:', payload.iat ? new Date(payload.iat * 1000).toISOString() : '无');
      console.log('    是否过期:', payload.exp ? payload.exp * 1000 < Date.now() : '无法确定');
    } else {
      console.log('  Token 格式无效 (不是3段)');
    }
  } catch (error) {
    console.log('  Token 解析失败:', error.message);
  }
}

// 2. 测试直接API调用
console.log('\n2. 测试 API 调用:');
fetch('/api/ef/v1/auth/me')
  .then(response => {
    console.log('  响应状态:', response.status, response.statusText);
    return response.json();
  })
  .then(data => {
    console.log('  响应数据:', data);
  })
  .catch(error => {
    console.log('  请求失败:', error);
  });

// 3. 如果有authService，调用调试方法
if (typeof window !== 'undefined' && window.authService) {
  console.log('\n3. AuthService 调试:');
  window.authService.debugAuthStatus();
} else {
  console.log('\n3. AuthService 未找到，可能还未初始化');
}

console.log('\n=== 建议解决步骤 ===');
console.log('1. 如果没有token，请先登录');
console.log('2. 如果token已过期，请重新登录');
console.log('3. 如果有token但仍401，检查token格式');
console.log('4. 打开浏览器网络面板查看请求头是否包含Authorization');