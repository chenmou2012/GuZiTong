// 生成带source的测验题目
const { REAL_WORDS_DATA } = require('../services/realWords.js');

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const quizQuestions = [];

REAL_WORDS_DATA.forEach(wordData => {
  const word = wordData.word;
  const meanings = wordData.meanings || [];

  meanings.forEach((m, meaningIndex) => {
    const example = m.example;
    const source = m.source;
    if (!example) return;

    // sentence_meaning题目（单选）
    const options = [
      { text: m.meaning, correct: true }
    ];

    // 从其他词的意思中获取错误选项
    const wrongOptions = [];
    REAL_WORDS_DATA.forEach(w => {
      if (w.word === word) return;
      w.meanings.forEach(mm => {
        if (mm.meaning && mm.meaning !== m.meaning) {
          wrongOptions.push({ text: mm.meaning, correct: false });
        }
      });
    });

    shuffleArray(wrongOptions);
    options.push(...wrongOptions.slice(0, 3));
    shuffleArray(options);

    quizQuestions.push({
      word,
      type: 'sentence_meaning',
      sentence: example,
      source: source,
      options
    });
  });
});

console.log('Generated:', quizQuestions.length, 'questions');
console.log('JSON:', JSON.stringify(quizQuestions, null, 2));