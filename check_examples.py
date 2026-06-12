#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
筛选例句不在 poems.json 中的句子
"""

import json
import re

def load_json(filepath):
    """加载 JSON 文件"""
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)

def extract_poem_sentences(poems):
    """从古诗词中提取所有句子"""
    sentences = set()
    for poem in poems:
        content = poem.get('content', '')
        if content:
            # 按标点符号分割句子
            for punct in ['。', '！', '？', '，', '；', '、']:
                # 将标点替换为句号以便分割
                content = content.replace(punct, '。')
            # 分割并去除空白
            for sentence in content.split('。'):
                sentence = sentence.strip()
                if sentence:
                    sentences.add(sentence)
    return sentences

def main():
    # 加载数据
    print("加载数据...")

    # 解析 REAL_WORDS_DATA
    content = open('./utils/services/realWords.js', 'r', encoding='utf-8').read()
    match = re.search(r'REAL_WORDS_DATA\s*=\s*(\[.*\]);', content, re.DOTALL)
    if match:
        words_data = json.loads(match.group(1))
    else:
        print("无法解析 REAL_WORDS_DATA")
        return

    # 加载诗词
    poems = load_json('./backend/poems.json')
    poem_sentences = extract_poem_sentences(poems)

    print(f"古诗词总数: {len(poems)}")
    print(f"古诗词句子数: {len(poem_sentences)}")
    print(f"文言实词数: {len(words_data)}")
    print()

    # 筛选不在诗词中的例句
    not_in_poems = []
    for word_item in words_data:
        word = word_item.get('word', '')
        for meaning in word_item.get('meanings', []):
            example = meaning.get('example', '')
            if example:
                # 检查例句是否在诗词中
                found = False
                for ps in poem_sentences:
                    if example in ps or ps in example:
                        found = True
                        break
                if not found:
                    not_in_poems.append({
                        'word': word,
                        'meaning': meaning.get('meaning', ''),
                        'example': example,
                        'source': meaning.get('source', '')
                    })

    print(f"不在古诗词中的例句数: {len(not_in_poems)}")
    print()
    print("=" * 60)
    print("不在古诗词中的例句:")
    print("=" * 60)

    # 保存到文件
    with open('./not_in_poems.txt', 'w', encoding='utf-8') as f:
        f.write(f"不在古诗词中的例句数: {len(not_in_poems)}\n\n")
        for i, item in enumerate(not_in_poems, 1):
            f.write(f"{i}. 【{item['word']}】{item['meaning']}\n")
            f.write(f"   例句: {item['example']}\n")
            f.write(f"   出处: {item['source']}\n")
            f.write("\n")

    print(f"结果已保存到 not_in_poems.txt")

if __name__ == '__main__':
    main()