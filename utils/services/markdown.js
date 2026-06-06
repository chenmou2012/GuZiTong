// Markdown 服务

/**
 * 简易 Markdown 转 HTML
 */
function markdownToHtml(markdown) {
  if (!markdown) return '';

  // 转义 HTML 特殊字符
  var escaped = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Markdown 转换
  var html = escaped
    // 标题 ## xxx
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // 加粗 **xxx**
    .replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>')
    // 数字列表 1. xxx
    .replace(/^(\d+)\.\s+(.+)$/gm, '<p><b>$1. </b>$2</p>')
    // 短横线列表项 - xxx
    .replace(/^-\s+(.+)$/gm, '<p class="indent">$1</p>')
    // 换行转为 br
    .replace(/\n/g, '<br>');

  return html;
}

/**
 * 解析 Markdown 文本（用于实词查询结果）
 */
function parseMarkdown(markdown) {
  if (!markdown) return null;

  const result = {
    raw: markdown,
    pinyin: '',
    meanings: []
  };

  const lines = markdown.split('\n');
  let currentPos = '';
  let currentMeaning = '';
  let currentExample = '';
  let currentSource = '';
  let inMeaning = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 读音
    if (line.startsWith('## 读音') || line.startsWith('# 读音')) {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine) {
        result.pinyin = nextLine.replace(/^[【\[].*[】\]]/, '').trim();
      }
      continue;
    }

    // 义项
    const meaningMatch = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*(.+)$/);
    if (meaningMatch) {
      if (currentMeaning) {
        result.meanings.push({
          pos: currentPos,
          meaning: currentMeaning,
          example: currentExample,
          source: currentSource
        });
      }
      const posText = meaningMatch[2];
      const posMatch = posText.match(/【(.+?)】/);
      if (posMatch) {
        currentPos = posMatch[1];
        currentMeaning = posText.substring(posMatch[0].length) + meaningMatch[3];
      } else {
        currentPos = posText.replace(/【|】/g, '');
        currentMeaning = meaningMatch[3];
      }
      currentExample = '';
      currentSource = '';
      inMeaning = true;
      continue;
    }

    // 例句
    const exampleMatch = line.match(/^-\s*例句[：:](.+?)【(.+?)】$/);
    if (exampleMatch && inMeaning) {
      currentExample = exampleMatch[1].trim();
      currentSource = exampleMatch[2].trim();
      continue;
    }

    const simpleExampleMatch = line.match(/^-\s*例句[：:](.+)$/);
    if (simpleExampleMatch && inMeaning) {
      currentExample = simpleExampleMatch[1].trim();
      continue;
    }

    if (inMeaning && line && !line.startsWith('#') && !line.startsWith('-')) {
      currentMeaning += ' ' + line;
    }
  }

  if (currentMeaning) {
    result.meanings.push({
      pos: currentPos,
      meaning: currentMeaning,
      example: currentExample,
      source: currentSource
    });
  }

  return result;
}

module.exports = {
  markdownToHtml,
  parseMarkdown
};