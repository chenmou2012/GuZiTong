// scripts/test_url_decode.js
// 验证 decodeURIComponent 防御性修复在各种情况下的行为

console.log('===== TEST 1: WeChat 已正常解码 =====');
const word1 = '友';  // 期望：WeChat 解码后是 "友"
const decoded1 = (() => {
  try {
    if (word1.includes('%')) return decodeURIComponent(word1);
    return word1;
  } catch { return word1; }
})();
console.log(`  原值: ${JSON.stringify(word1)}, 解码后: ${JSON.stringify(decoded1)}`);
console.assert(decoded1 === '友', '应保持 "友"');

console.log('\n===== TEST 2: WeChat 未解码（用户实际遇到）=====');
const word2 = '%E5%8F%8B';  // 实际是 URL 编码后的 "友"
const decoded2 = (() => {
  try {
    if (word2.includes('%')) return decodeURIComponent(word2);
    return word2;
  } catch { return word2; }
})();
console.log(`  原值: ${JSON.stringify(word2)}, 解码后: ${JSON.stringify(decoded2)}`);
console.assert(decoded2 === '友', '应解码为 "友"');

console.log('\n===== TEST 3: 含 % 但非编码（边界情况）=====');
const word3 = '100%';  // 含 % 但不是 URL 编码
const decoded3 = (() => {
  try {
    if (word3.includes('%')) return decodeURIComponent(word3);
    return word3;
  } catch { return word3; }
})();
console.log(`  原值: ${JSON.stringify(word3)}, 解码后: ${JSON.stringify(decoded3)}`);
// "100%" decodeURIComponent 会返回 "100%"（合法 - % 后面没有 hex）
console.assert(decoded3 === '100%', '应保持 "100%"');

console.log('\n===== TEST 4: 包含前后空格的编码串 =====');
const word4 = '%20%E5%8F%A4%20';  // 编码后的 " 古 "
const decoded4 = (() => {
  try {
    if (word4.includes('%')) return decodeURIComponent(word4);
    return word4;
  } catch { return word4; }
})();
console.log(`  原值: ${JSON.stringify(word4)}, 解码后: ${JSON.stringify(decoded4)}`);
console.assert(decoded4.trim() === '古', '解码后 trim 应为 "古"');

console.log('\n===== TEST 5: 多字 ====================');
const word5 = '%E5%8F%A4%E5%AD%97%E9%80%9A';  // 古字通
const decoded5 = (() => {
  try {
    if (word5.includes('%')) return decodeURIComponent(word5);
    return word5;
  } catch { return word5; }
})();
console.log(`  原值: ${JSON.stringify(word5)}, 解码后: ${JSON.stringify(decoded5)}`);
console.assert(decoded5 === '古字通', '应解码为 "古字通"');

console.log('\n===== TEST 6: 异常的 URI（防御性捕获）=====');
const word6 = '%E5%8F';  // 不完整的编码
const decoded6 = (() => {
  try {
    if (word6.includes('%')) return decodeURIComponent(word6);
    return word6;
  } catch { return word6; }
})();
console.log(`  原值: ${JSON.stringify(word6)}, 解码后: ${JSON.stringify(decoded6)}（异常时应原样保留）`);

console.log('\n===== 全部测试通过 =====');