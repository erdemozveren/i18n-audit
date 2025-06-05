import path from 'path';
import { pathToFileURL } from 'url';
import argvParser from 'minimist';
import { spawn } from 'child_process';
import { json2csv, csv2json } from 'json-2-csv';
import fs from 'fs';
import scompare from "string-comparison"
import _ from 'lodash';
import { table } from 'table';
const sim = scompare.lcs.similarity;

const args = argvParser(process.argv.slice(2), {
  alias: {
    h: 'help'
  }
});

function search(searchPattern, options = [], searchPath = '.') {
  return new Promise((resolve, reject) => {
    const rgargs = ['--vimgrep', '--pcre2', ...options, searchPattern, searchPath];
    const rg = spawn('rg', rgargs);

    let results = [];

    rg.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const [file, matchLine, col, ...match] = line.split(':');
        results.push({
          file,
          line: parseInt(matchLine),
          col: parseInt(col),
          match: match.join(),
        });
        // Ignore invalid JSON lines
      }
    });

    let stderr = '';
    rg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    rg.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolve(results);
      } else {
        reject(new Error(stderr || `rg exited with code ${code}`));
      }
    });
  });
}

function flattenToDotNotation(obj, prefix = '') {
  return _.flatMap(obj, (value, key) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (_.isPlainObject(value)) {
      return flattenToDotNotation(value, fullKey);
    } else {
      return [[fullKey, value]];
    }
  });
}

function unflattenFromDotNotation(pairs) {
  const result = {};

  for (const { key, value } of pairs) {
    _.set(result, key, value);
  }

  return result;
}

function escapeRegexForRipgrep(regex) {
  return regex
    .toString()
    .slice(1, -1)              // remove leading and trailing slashes
}

const variableKeys = escapeRegexForRipgrep(/(?:\$|\.|\s)t\s*\(\s*(?!['"`])(?<key>[^'"`][^)]*?)\s*(?=[,)])/);
const interpolationKeys = escapeRegexForRipgrep(/(?:\$|\.|\s)t\(\s*`(?<key>[^`]+)`/);
const concatinationKeys = escapeRegexForRipgrep(/(?:\$|\.|\s)t\(\s*(?<key>(?:'[^']*'|"[^"]*")\s*\+\s*[a-zA-Z_]\w*)/);
const stringKeys = escapeRegexForRipgrep(/(?:\$|\.|\s)t\s*\(\s*(['"])(?<key>(?:\\.|(?!\1).)*?)\1\s*(?=[,)])/);

function findRelative(output, finds, flattenLocals) {
  finds.forEach(e => {
    const { match: key, file, line, col } = e;
    if (!output.find(oldOut => oldOut.key === key)) {
      let value = flattenLocals.find(l => l[0] === key) || '';
      if (typeof value === 'object') value = value[1];
      output.push({ source: `${file}:${line}:${col}`, key, value });
    }
  });
  return output;
}
const binName = 'i18n-audit';
const savePath = process.cwd();
const attentionOutputPath = path.join(savePath, 'localization-needs-attention.csv');
const localOutputPath = path.join(savePath, 'localization-all.csv');
const csvToJsonPath = path.join(savePath, 'localization-from-csv.json');
function printHelp() {
  const argList = [
    { arg: '-i', input: 'file path', desc: 'Input file to process can be js,json or csv depending on process', required: 'Yes', default: 'None' },
    { arg: '--print', input: '"all" or "attention"', desc: 'print only given option', required: 'No', default: 'attention' },
    { arg: '--write', input: '', desc: 'Write output(s) to disk', required: 'No', default: 'False' },
    { arg: '--no-attention', input: '', desc: 'Don\'t output attention.csv for manual checks', required: 'No', default: 'False' },
  ]
  const fnames = [localOutputPath, attentionOutputPath, csvToJsonPath].map(e => path.basename(e)).join(', ');
  console.log(`
example usage;
  - npx ${binName} -i translationfile.{js,json}
      --> outputs flatten csv and 'attention csv' that lists variable
          dependant and uncovered keys that may needs manual checks
  - npx ${binName} -i transaltions.csv
      --> converts csv dot notaion key,value pairs to i18n translation
          json (basically reverts)
  ----------------------------------------------------------
  Notice: This tool always overwrite to these files on running directory!
          File names : ${fnames}
`)
  const argListToRows = Object.values(argList).map(e => ([e.arg, e.input, e.desc, e.required, e.default]));
  argListToRows.unshift(['Arg', 'Accepts', 'Desc', 'Required', 'Default']);
  console.log(table(argListToRows, {
    columnDefault: {
      width: 15,
    },
    columns: [
      { width: 15 },
      { width: 20 },
      { width: 30, wrapWord: true },
      { width: 5 },
      { width: 5 },
    ]
  }));
}
async function main() {
  if (!args.i || args.help) {
    printHelp();
    process.exit()
  }
  const inputPath = path.resolve(args.i);
  let originalLocals = {}, flattenLocals = [];
  if (args.i.endsWith('.csv')) {
    // revert to original scheme (unflatten)
    console.log('Reverting to json scheme')
    const csvToJson = csv2json(fs.readFileSync(inputPath, 'utf-8'));
    const revertedLocals = unflattenFromDotNotation(csvToJson);
    fs.writeFileSync(csvToJsonPath, JSON.stringify(revertedLocals, null, 2), 'utf-8');
    console.log('File saved to : ' + csvToJsonPath)
    return;
  }
  if (args.i.endsWith('.js')) {
    originalLocals = (await import(pathToFileURL(inputPath))).default;
  }
  if (args.i.endsWith('.json')) {
    originalLocals = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  }
  if (Object.keys(originalLocals).length === 0) {
    console.error('Translation file is empty,exiting.')
    process.exit(1);
  }
  flattenLocals = flattenToDotNotation(originalLocals);

  const rgArgs = ['-o', '-g', '!**/i18n/**'];
  rgArgs.push('-r')
  rgArgs.push('$key')
  const simpleUsed = [];
  const dynamics = [];
  const notUsed = []
  const searchStrings = await search(stringKeys, rgArgs);
  const searchVars = await search(variableKeys, rgArgs);
  const searchInterpolations = await search(interpolationKeys, rgArgs);
  const searchConcats = await search(concatinationKeys, rgArgs);
  findRelative(simpleUsed, searchStrings, flattenLocals);
  dynamics.push({ key: '#i18n# --BELOW IS VARIABLES-- #i18n#' })
  findRelative(dynamics, searchVars, flattenLocals);
  dynamics.push({ key: '#i18n# --BELOW IS INTERPOLATIONS/Concatinations-- #i18n#' })
  findRelative(dynamics, searchInterpolations, flattenLocals);
  findRelative(dynamics, searchConcats, flattenLocals);
  flattenLocals.forEach(([key, value]) => {
    if (!simpleUsed.find(e => e.key === key)) {
      let similar = '';
      let simScore = -Infinity;
      dynamics.find(dynamicLocal => {
        const elementScore = sim(key, dynamicLocal.key);
        if (elementScore > simScore && elementScore > 0.5) {
          similar = dynamicLocal.key;
        }
      });
      notUsed.push({ key, value, similar });
    }
  });
  let needAttentions = [];
  function addToAttention(elements) {
    elements.forEach(e => {
      const { source, key, value, similar } = e;
      needAttentions.push({ key, value, similar, source });
    })
  }
  addToAttention(dynamics);
  needAttentions.push({ key: '#i18n# --BELOW IS HAVE TRANSLATION BUT UNUSED-- #i18n#' })
  addToAttention(notUsed);
  if (args['attention'] !== false) {
    dynamics.push({ key: '#i18n# --BELOW IS USED BUT DO NOT HAVE TRANSLATION-- #i18n#' })
    simpleUsed.forEach(e => {
      if (typeof _.get(originalLocals, e.key) === 'undefined') {
        needAttentions.push(e);
      }
    })
  }
  if (!args.print && !args.write) { args.print = "attention"; }
  if (args.print) {
    let attentionAsTable;
    attentionAsTable = needAttentions.map(e => [e.key, e.value, e.similar, e.source]);
    attentionAsTable.unshift(['Key', 'Value', 'Similar Used Match', 'Source']);
    console.log(table(attentionAsTable, {
      columnDefault: {
        width: 30,
        truncate: 70,
      },
    }))
  }
  if (args.write) {
    fs.writeFileSync(localOutputPath, 'key,value\n' + json2csv(flattenLocals, { prependHeader: false, emptyFieldValue: '' }), 'utf-8')
    console.log('File Saved : ' + localOutputPath);
    if (args['attention'] !== false) {
      fs.writeFileSync(attentionOutputPath, json2csv(needAttentions, { emptyFieldValue: '', keys: ['key', 'value', 'similar', 'source'] }), 'utf-8')
      console.log('File Saved : ' + attentionOutputPath);
    }
  }
  console.log('done!')
}
main();

