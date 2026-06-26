const QUIZ_DATA = require('../utils/data/quiz_questions.js');
console.log('Total questions:', QUIZ_DATA.length);
const types = {};
const byWord = {};
QUIZ_DATA.forEach(q => {
  types[q.type] = (types[q.type] || 0) + 1;
  if (!byWord[q.word]) byWord[q.word] = { sentence_meaning: 0, select_meanings: 0 };
  byWord[q.word][q.type] = (byWord[q.word][q.type] || 0) + 1;
});
console.log('By type:', types);
const singleCounts = {};
const multiCounts = {};
Object.keys(byWord).forEach(w => {
  const s = byWord[w].sentence_meaning;
  const m = byWord[w].select_meanings;
  singleCounts[s] = (singleCounts[s] || 0) + 1;
  multiCounts[m] = (multiCounts[m] || 0) + 1;
});
console.log('Words with N single-select:', singleCounts);
console.log('Words with N multi-select:', multiCounts);
console.log('Total words:', Object.keys(byWord).length);
console.log('Sample entry:', JSON.stringify(QUIZ_DATA[0]).slice(0, 400));
console.log('Sample multi entry:', JSON.stringify(QUIZ_DATA.find(q => q.type === 'select_meanings')).slice(0, 400));