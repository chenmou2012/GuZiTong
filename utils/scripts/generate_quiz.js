const { REAL_WORDS_DATA } = require('../services/realWords.js');
const fs = require('fs');

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

  // sentence_meaning（单选）- 每个词义都生成
  meanings.forEach(m => {
    const example = m.example;
    const source = m.source;
    if (!example) return;

    const options = [{ text: m.meaning, correct: true }];
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

  // select_meanings（多选）- 每个有2+意思的词生成一道
  if (meanings.length >= 2 && meanings.some(m => m.example)) {
    const options = meanings.map(m => ({
      text: m.meaning,
      correct: true
    }));
    const wrongMeanings = [];
    REAL_WORDS_DATA.forEach(w => {
      if (w.word === word) return;
      w.meanings.forEach(mm => {
        if (mm.meaning) {
          wrongMeanings.push({ text: mm.meaning, correct: false });
        }
      });
    });
    shuffleArray(wrongMeanings);
    // 添加2个错误选项
    options.push(...wrongMeanings.slice(0, 2));
    shuffleArray(options);

    quizQuestions.push({
      word,
      type: 'select_meanings',
      options
    });
  }
});

fs.writeFileSync('../data/quiz_questions.js', 'module.exports = ' + JSON.stringify(quizQuestions, null, 2) + ';');
console.log('Done:', quizQuestions.length, 'questions');