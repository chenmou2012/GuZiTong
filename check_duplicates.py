#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查文言实词数据中是否有重复的意思"""

import json
import re
import sys

# 读取 JS 文件
with open('utils/services/realWords.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 提取 JSON 数据
match = re.search(r'const REAL_WORDS_DATA = \[(.*?)\];', content, re.DOTALL)
if not match:
    print("未找到数据")
    sys.exit(1)

# 解析 JSON（需要先处理引号）
json_str = '[' + match.group(1) + ']'
json_str = json_str.replace('"', '"').replace('"', '"')

try:
    data = json.loads(json_str)
except json.JSONDecodeError as e:
    print(f"JSON 解析错误: {e}")
    # 尝试直接从 JS 解析
    sys.exit(1)

# 检查重复
duplicates = []
all_meanings = {}

for word in data:
    word_text = word.get('word', '')
    meanings = word.get('meanings', [])

    for m in meanings:
        meaning_text = m.get('meaning', '')

        if meaning_text in all_meanings:
            # 发现重复
            duplicates.append({
                'word': word_text,
                'meaning': meaning_text,
                'source': m.get('source', ''),
                'first_word': all_meanings[meaning_text]['word'],
                'first_source': all_meanings[meaning_text]['source']
            })
        else:
            all_meanings[meaning_text] = {
                'word': word_text,
                'source': m.get('source', '')
            }

# 输出结果
print("=" * 60)
print(f"总计: {len(data)} 个词")
print(f"总释义数: {len(all_meanings)} 个")
print(f"重复释义数: {len(duplicates)} 个")
print("=" * 60)

if duplicates:
    print("\n发现重复的意思：\n")
    for d in duplicates:
        print(f"  词: {d['word']}")
        print(f"  意思: {d['meaning']}")
        print(f"  出处: {d['source']}")
        print(f"  首次出现: {d['first_word']} ({d['first_source']})")
        print("-" * 40)
else:
    print("\n没有发现重复的意思 ✓")