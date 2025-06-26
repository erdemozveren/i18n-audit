import path from 'path';
import { pathToFileURL } from 'url';
import { spawn } from 'child_process';
import { json2csv, csv2json } from 'json-2-csv';
import fs from 'fs';
import scompare from "string-comparison"
import _ from 'lodash';
import { bulkTranslate } from './translate';
import { program } from 'commander';
import { toHTML } from './htmlFormatter';
const sim = scompare.lcs.similarity;


const variableKeys = escapeRegexForRipgrep(/(?:\$|\.|\s)t\s*\(\s*(?!['"`])(?<key>[^'"`][^)]*?)\s*(?=[,)])/);
const interpolationKeys = escapeRegexForRipgrep(/(?:\$|\.|\s)t\(\s*`(?<key>[^`]+)`/);
const concatinationKeys = escapeRegexForRipgrep(/(?:\$|\.|\s)t\(\s*(?<key>(?:'[^']*'|"[^"]*")\s*\+\s*[a-zA-Z_]\w*)/);
const stringKeys = escapeRegexForRipgrep(/(?:\$|\.|\s)t\s*\(\s*(['"])(?<key>(?:\\.|(?!\1).)*?)\1\s*(?=[,)])/);
const looseKeys = escapeRegexForRipgrep(/(['"])(?<key>(?:\\.|(?!\1).)*?)\1/);


program
  .name('i18n-audit')
  .description('Convert i18n JSON <-> CSV, detect unused and undefined translations, and translate between languages.')
  .version('1.2.2')
  // Required input file (json or csv)
  .requiredOption('-i, --input <file>', 'Input file (.json, .js, or .csv)')
  // Optional output file
  .option('-o, --output <file>', 'Output file path (defaults to stdout)')
  // Convert to JSON or CSV
  .option('--to <format>', 'Convert to "csv" or "json" (based on input)', 'csv')
  // Translate mode (works only with CSV)
  .option('-t, --translate <from-to>', 'Translate using source-target languages (e.g., en-tr)')
  // Audit for undefiend/unused keys
  .option('--audit', 'Audit for undefined and unused keys in translation files')
  // Optional target directory for recursive audit
  .option('--src <dir...>', 'Source code directory to scan for used keys (can be used multiple times)', ['.'])
  // Optional loose search
  .option('--loose', 'Search for loosely-matched strings (quoted text not inside $t or other i18n calls)')
  // LibreTranslate Api Url
  .option('--api-url <url>', 'Optional translation API endpoint (LibreTranslate)', 'http://localhost:5000')
  .option('--api-key <key>', 'Optional API key for the translation service')
  .option('--chunk-size <n>', 'Number of entries per API request batch (default: 10)', parseInt)
  .option('--chunk-delay <ms>', 'Delay between each chunk in milliseconds (default: 500)', parseInt)

program.parse();

const opts = program.opts();

function search(searchPattern, options = [], searchPath = ['.']) {
  return new Promise((resolve, reject) => {
    const rgargs = ['--vimgrep', '--pcre2', ...options, searchPattern, ...searchPath];
    const rg = spawn('rg', rgargs);
    // console.log('searching : ', 'rg ' + rgargs.map(e => e.indexOf(' ') === -1 ? e : JSON.stringify(e)).join(' '))

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
  // If it's a primitive, just return it as-is
  if (!_.isObject(obj)) {
    return [{ key: prefix, value: obj }];
  }

  return _.flatMap(obj, (value, key) => {
    const fullKey = Array.isArray(obj)
      ? `${prefix}[${key}]`
      : prefix
        ? `${prefix}.${key}`
        : key;

    return flattenToDotNotation(value, fullKey);
  });
}

function unflattenFromDotNotation(pairs) {
  const result = {};

  for (const { key: flatKey, value } of pairs) {
    // Split keys using "." and "[]" (dot and bracket notation)
    const keys = flatKey.split(/\.|\[|\]/).filter(Boolean);

    let current = result;

    for (let i = 0; i < keys.length; i++) {
      const rawKey = keys[i];
      const isIndex = /^\d+$/.test(rawKey);
      const key = isIndex ? Number(rawKey) : rawKey;
      const isLast = i === keys.length - 1;

      if (isLast) {
        current[key] = value;
      } else {
        if (current[key] == null) {
          const nextKey = keys[i + 1];
          const nextIsIndex = /^\d+$/.test(nextKey);
          current[key] = nextIsIndex ? [] : {};
        }

        current = current[key];
      }
    }
  }

  return result;
}

function escapeRegexForRipgrep(regex) {
  return regex
    .toString()
    .slice(1, -1)              // remove leading and trailing slashes
}

function findUsed(output, finds, localsAsJson, status) {
  finds.forEach(e => {
    const { match: key, file, line, col } = e;
    const langValue = _.get(localsAsJson, key);
    if (langValue) {
      output.push({ source: `${file}:${line}:${col}`, key, value: langValue || '', status });
    }
  });
  return output;
}

function searchToList(output, finds, status) {
  finds.forEach(e => {
    const { match: key, file, line, col } = e;
    output.push({ source: `${file}:${line}:${col}`, key, value: '', status });
  });
}

async function loadTranslationFile(filePath) {
  const ext = filePath.split('.').pop();
  if (ext === 'json') {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } else if (ext === 'js') {
    const mod = await import(pathToFileURL(filePath));
    return mod.default || mod;
  } else if (ext === 'csv') {
    const csvToJson = csv2json(fs.readFileSync(filePath, 'utf-8'));
    return unflattenFromDotNotation(csvToJson);
  }
  throw new Error('Unsupported file type: ' + ext);
}

async function generateAudit(inputPath, searchPath, jsonLocals, flattenLocals, looseSearch = false) {
  const rgArgs = ['-o', '-g', '!' + inputPath, '-r', '$key', '--sort', 'path'];
  const simpleUsed = [];
  const dynamics = [];
  const notUsed = []
  const searchStrings = await search(stringKeys, rgArgs, searchPath);
  const searchVars = await search(variableKeys, rgArgs, searchPath);
  const searchInterpolations = await search(interpolationKeys, rgArgs, searchPath);
  const searchConcats = await search(concatinationKeys, rgArgs, searchPath);
  if (looseSearch) {
    const looseStrings = await search(looseKeys, rgArgs, searchPath);
    findUsed(simpleUsed, looseStrings, jsonLocals, 'USED');
  }
  findUsed(simpleUsed, searchStrings, jsonLocals, 'USED');
  searchToList(dynamics, searchVars, 'VARIABLE');
  searchToList(dynamics, searchInterpolations, 'DYNAMIC');
  searchToList(dynamics, searchConcats, 'DYNAMIC');
  // Find similar keys that could be resolved in dynamic
  dynamics.forEach(e => {
    if (e.status !== 'VARIABLE') {
      let simScore = -Infinity;
      flattenLocals.find(({ key }) => {
        const elementScore = sim(key, e.key);
        if (elementScore > simScore && elementScore > 0.5) {
          e.similar = key;
        }
      });
    }
  });
  // Find dynamic usage of key
  flattenLocals.forEach(({ key, value }) => {
    if (!simpleUsed.find(e => e.key === key)) {
      let similar = '';
      let simScore = -Infinity;
      dynamics.find(dynamicLocal => {
        const elementScore = sim(key, dynamicLocal.key);
        if (elementScore > simScore && elementScore > 0.5) {
          similar = dynamicLocal.key;
        }
      });
      notUsed.push({ key, value, status: 'UNUSED', similar });
    }
  });
  let audit = [];
  simpleUsed.forEach(e => {
    if (typeof _.get(jsonLocals, e.key) === 'undefined') {
      audit.push({ ...e, status: 'UNDEFINED' });
    }
  })
  dynamics.forEach(e => {
    const { source, key, value, similar, status } = e;
    audit.push({ key, value, status, similar, source });
  })
  notUsed.forEach(e => {
    const { source, key, value, similar, status } = e;
    audit.push({ key, value, status, similar, source });
  })
  return audit;
}


async function main() {
  const resolvedInputPath = path.resolve(opts.input);
  if (!fs.existsSync(resolvedInputPath)) {
    program.error('Input file is not exists');
  }
  const inputExt = resolvedInputPath.split('.').pop();
  // General checks
  if (inputExt === opts.to && !opts.translate) {
    program.error('Input and output file type is can not be the same,Unless translation option is used!')
  }
  if (opts.translate && opts.audit) {
    program.error('You cannot use --translate and --audit options together!');
  }
  // input content always converted to unflatten json format
  const inputAsJson = await loadTranslationFile(resolvedInputPath);
  let outputContent = null;

  if (opts.audit) {
    const flattenLocals = flattenToDotNotation(inputAsJson);
    // Audit logic using:
    // - opts.input (e.g., en.json)
    // - opts.src (e.g., ./src/) to find used keys
    outputContent = await generateAudit(opts.input, opts.src, inputAsJson, flattenLocals, opts.loose)
  } else if (opts.translate) {
    const [sourceLang, toLang] = opts.translate.split('-');
    if (!sourceLang || !toLang) program.error('Translate option must be in format source-target e.g. en-tr');
    const inputAsRows = flattenToDotNotation(inputAsJson);
    outputContent = await bulkTranslate(inputAsRows, {
      sourceLang,
      toLang,
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      chunkDelay: opts.chunkDelay,
      chunkSize: opts.chunkSize,
    });
    outputContent = unflattenFromDotNotation(outputContent);
  }
  if (outputContent === null) {
    // its just format convertion
    outputContent = inputAsJson;
  }
  const auditKeys = ['status', 'key', 'value', 'similar', 'source'];
  // This is last stage,make outputContent ready to write
  if (opts.to === 'csv') {
    // Convert JSON/JS to CSV
    if (opts.translate || opts.audit) {
      if (opts.audit) {
        outputContent = json2csv(outputContent, { emptyFieldValue: '', keys: auditKeys });
      } else {
        outputContent = json2csv(outputContent, { emptyFieldValue: '' });
      }
    } else {
      // its just format convertion
      outputContent = flattenToDotNotation(inputAsJson);
      outputContent = json2csv(outputContent, { emptyFieldValue: '' });
    }
  } else if (opts.to === 'json') {
    outputContent = JSON.stringify(outputContent, null, 2);
  } else if (opts.to === 'html') {
    if (opts.audit) {
      outputContent = toHTML(outputContent, auditKeys)
    } else {
      if (!Array.isArray(outputContent)) {
        outputContent = flattenToDotNotation(outputContent);
      }
      outputContent = toHTML(outputContent, ['key', 'value'])
    }
  }

  if (typeof outputContent !== 'string') {
    console.log('Something went wrong! Dumping some info');
    console.log('output type', typeof outputContent)
    console.log('args', opts)
    process.exit(1);
  }
  if (opts.output) {
    fs.writeFileSync(opts.output, outputContent, 'utf-8');
    console.log('File saved to : ' + opts.output)
  } else {
    process.stdout.write(outputContent);
  }
}


main();

