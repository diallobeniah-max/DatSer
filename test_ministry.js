import { normalizeMinistry } from './src/utils/dataUtils.js';

const testCases = [
  ['["\\"Data Management\\"", "Data Management"]'], // Array containing the string
  '["[\\"\\\\\\"Data Management\\\\\\", \\"Data Management\\"]"]' // Double stringified
];

testCases.forEach((input, i) => {
  console.log(`Case ${i + 1} Input:`, input);
  const output = normalizeMinistry(input);
  console.log(`Case ${i + 1} Output:`, output);
  console.log('---');
});
