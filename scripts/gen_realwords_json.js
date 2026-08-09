// scripts/gen_realwords_json.js
// 从 utils/services/realWords.js（前端唯一词表源）生成 backend/realwords.json，
// 供后端 init_learn_order 生成新用户背诵顺序。
// 用法：node scripts/gen_realwords_json.js

const fs = require('fs');
const path = require('path');

const { REAL_WORDS_DATA } = require('../utils/services/realWords.js');

if (!Array.isArray(REAL_WORDS_DATA) || REAL_WORDS_DATA.length === 0) {
  console.error('❌ REAL_WORDS_DATA 为空，检查 utils/services/realWords.js');
  process.exit(1);
}

const outPath = path.join(__dirname, '..', 'backend', 'realwords.json');
fs.writeFileSync(outPath, JSON.stringify(REAL_WORDS_DATA, null, 2) + '\n', 'utf-8');

console.log(`✓ 已生成 ${outPath}（${REAL_WORDS_DATA.length} 个字）`);
