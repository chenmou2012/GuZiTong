// Markdown 服务

/**
 * 简易 Markdown 转 HTML
 *
 * P1-12 改进：
 * - 修复嵌套加粗 **a**b**c** → 识别为 <strong>a</strong>b<strong>c</strong>
 * - 错误隔离：每个正则替换独立 try，单条规则匹配失败不影响整体
 * - 长度保护：超过 100KB 截断，避免流式输出时正则卡死
 */
function markdownToHtml(markdown) {
  if (!markdown) return '';

  // 流式输出可能非常长，超过 100KB 直接截断（正则复杂度 O(n^2) 会卡死）
  const MAX_LEN = 100 * 1024;
  if (markdown.length > MAX_LEN) {
    markdown = markdown.slice(0, MAX_LEN);
  }

  // 转义 HTML 特殊字符（顺序：& 必须最先）
  let escaped;
  try {
    escaped = markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  } catch (e) {
    return '';
  }

  // 每条规则独立 try，单条失败不阻塞其他规则
  const transforms = [
    // 标题 ## xxx
    [/(^|\n)## (.+?)(?=\n|$)/g, '$1<h2>$2</h2>'],
    // 加粗 **xxx**（支持多段：global + lastIndex 推进）
    [/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>'],
    // 数字列表 1. xxx
    [/^(\d+)\.\s+(.+)$/gm, '<p><b>$1. </b>$2</p>'],
    // 短横线列表项 - xxx
    [/^-\s+(.+)$/gm, '<p class="indent">$1</p>'],
  ];

  for (const [pattern, replacement] of transforms) {
    try {
      escaped = escaped.replace(pattern, replacement);
    } catch (e) {
      // 单条规则失败不阻塞后续
      console.warn('[markdown] transform failed:', e.message);
    }
  }

  // 换行转为 br（放最后，避免被上面规则消耗）
  escaped = escaped.replace(/\n/g, '<br>');

  return escaped;
}

/**
 * 解析 Markdown 文本（用于实词查询结果）
 *
 * P1-12 改进：
 * - 容忍跨行义项：AI 流式输出时，一个义项可能被切成多段陆续到达
 * - 例句和源合并匹配，避免单次失败丢掉源信息
 * - 错误隔离：解析失败返回 null，不抛
 */
function parseMarkdown(markdown) {
  if (!markdown) return null;

  const result = {
    raw: markdown,
    pinyin: '',
    meanings: []
  };

  try {
    const lines = markdown.split('\n');
    let currentPos = '';
    let currentMeaning = '';
    let currentExample = '';
    let currentSource = '';
    let inMeaning = false;
    let meaningIndex = 0;

    const flushMeaning = () => {
      if (currentMeaning.trim()) {
        result.meanings.push({
          pos: currentPos,
          meaning: currentMeaning.trim(),
          example: currentExample.trim(),
          source: currentSource.trim()
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] || '').trim();
      if (!line) continue;

      // 读音：支持 ## 读音 或 # 读音
      if (/^#{1,2}\s*读音/.test(line)) {
        // 读音内容可能在同行（"## 读音 pīn yīn"）或下一行
        const sameLine = line.replace(/^#{1,2}\s*读音\s*/, '').trim();
        if (sameLine) {
          result.pinyin = sameLine.replace(/^[【\[]+.*?[】\]]+/, '').trim();
        } else if (i + 1 < lines.length) {
          const nextLine = (lines[i + 1] || '').trim();
          if (nextLine && !/^#{1,2}\s/.test(nextLine)) {
            result.pinyin = nextLine.replace(/^[【\[]+.*?[】\]]+/, '').trim();
          }
        }
        inMeaning = false;
        continue;
      }

      // 义项起始：兼容两种格式
      // - 标准：1. **【词性】释义**解释
      // - AI 简写：1. 【词性】释义解释（去掉 ** 加粗）
      let meaningMatch = line.match(/^(\d+)\.\s+\*\*\s*([【\[].+?[】\]])?\s*(.+?)\*\*\s*(.*)$/);
      if (!meaningMatch) {
        meaningMatch = line.match(/^(\d+)\.\s+([【\[].+?[】\]])?\s*(.+)$/);
      }
      if (meaningMatch) {
        flushMeaning();  // 保存上一个义项
        meaningIndex = parseInt(meaningMatch[1], 10);
        const posMatch = meaningMatch[2] ? meaningMatch[2].match(/[【\[](.+?)[】\]]/) : null;
        currentPos = posMatch ? posMatch[1] : (meaningMatch[2] || '').replace(/[【】\[\]]/g, '').trim();
        // 释义 = 【词性】之后的所有内容（"1. **【名词】道路**解释" → "道路解释"）
        currentMeaning = (meaningMatch[3] || '').trim();
        currentExample = '';
        currentSource = '';
        inMeaning = true;
        continue;
      }

      // 例句带出处：容错多种括号格式
      //   优先：【】半角方括号
      //   其次：（）全角圆括号（AI 常用）
      //   最后：（）半角圆括号
      const exampleWithSource = line.match(/^[-*]?\s*例句\s*[：:]\s*(.+?)\s*[【\[（(](.+?)[】\]）)]\s*$/);
      if (exampleWithSource && inMeaning) {
        currentExample = exampleWithSource[1].trim();
        currentSource = exampleWithSource[2].trim();
        continue;
      }

      // 例句不带出处（兜底）
      const exampleMatch = line.match(/^[-*]?\s*例句\s*[：:]\s*(.+)$/);
      if (exampleMatch && inMeaning) {
        currentExample = exampleMatch[1].trim();
        continue;
      }

      // 解释行：容错多种关键词（解释/释义/说明/详解/描述）+ 多种前缀（-、*、无）
      const explanationMatch = line.match(/^[-*]?\s*(?:解释|释义|说明|详解|描述)\s*[：:]\s*(.+)$/);
      if (explanationMatch && inMeaning) {
        currentMeaning += (currentMeaning ? '\n' : '') + '解释：' + explanationMatch[1].trim();
        continue;
      }

      // 义项内非空、非标题、非列表行 → 追加到当前义项解释
      if (inMeaning && !/^#{1,2}\s/.test(line) && !/^[-*]\s/.test(line) && !/^\d+\.\s/.test(line)) {
        currentMeaning += (currentMeaning ? ' ' : '') + line;
      }
    }

    flushMeaning();  // 别忘了最后一个
  } catch (e) {
    console.warn('[parseMarkdown] failed:', e.message);
    // 不抛：调用方可以基于 result.meanings.length 判断是否成功
  }

  return result;
}

module.exports = {
  markdownToHtml,
  parseMarkdown
};