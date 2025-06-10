import _ from 'lodash';
import ora from 'ora';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function checkSrcTargetLanguagesSupported(apiUrl, sourceLang, toLang) {
  const httpReq = await fetch(apiUrl + '/languages', {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const res = await httpReq.json();
  const findSrc = res.find(e => e.code === sourceLang);
  if (!findSrc) {
    console.log(`-Source- Language ${sourceLang} is not supported by ${apiUrl}`)
    process.exit(1)
  }
  const findTo = findSrc.targets.find(e => e === toLang);
  if (!findTo) {
    console.log(`-To- Language ${toLang} is not supported by ${apiUrl}`)
    process.exit(1)
  }
}
export async function bulkTranslate(rows, { sourceLang, toLang, apiUrl, apiKey = '', chunkSize = 30, chunkDelay = 500 }) {
  if (!sourceLang || !toLang || !chunkSize) throw new Error('bulkTranslate Invalid params');
  await checkSrcTargetLanguagesSupported(apiUrl, sourceLang, toLang)
  const texts = [];
  const keys = [];
  const newRows = [];
  let chunkSizeSafe = Number(chunkSize) || 10;
  let chunkDelaySafe = Number(chunkDelay) || 500;
  if (chunkSizeSafe < 1) chunkSizeSafe = 10;
  if (chunkDelaySafe < 1) chunkDelaySafe = 1;
  rows.forEach((e) => {
    texts.push(e.value)
    keys.push(e.key);
  });
  const queueChunks = _.chunk(texts, chunkSizeSafe)
  const maxReTry = 3;
  let reTry = 0;
  let lastLibreError = '';
  const spinner = ora('Translating [1/' + queueChunks.length + ']').start();
  for (let chunkIndex = 0; chunkIndex < queueChunks.length; chunkIndex += 1) {
    const chunkTexts = queueChunks[chunkIndex];
    spinner.color = 'cyan';
    spinner.text = 'Translating [' + (chunkIndex + 1) + '/' + queueChunks.length + ']';
    const res = await fetch(apiUrl + '/translate', {
      method: "POST",
      body: JSON.stringify({
        q: chunkTexts,
        source: sourceLang,
        target: toLang,
        api_key: apiKey,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const translateResponse = await res.json();
    if (translateResponse.error) {
      if (chunkIndex > 0) {
        chunkIndex -= 1;
      }
      if (reTry < maxReTry) {
        reTry += 1;
      } else if (reTry <= maxReTry) {
        spinner.fail('Keep getting error from libre api,exiting.')
        console.log('Error from libre: ' + lastLibreError);
        console.log('Error happend on this translations;')
        console.log(chunkTexts)
        process.exit(1);
      }
      spinner.color = 'yellow';
      spinner.text = 'Error from libre,Waiting 10 seconds before re-try [' + reTry + '/' + maxReTry + ']';
      await sleep(10 * 1000);
      continue;
    }
    translateResponse.translatedText.forEach((translatedText, index) => {
      const realIndex = (chunkIndex * chunkSizeSafe) + index;
      newRows[realIndex] = { key: keys[realIndex], value: translatedText }
    })
    await sleep(chunkDelaySafe);
  }
  if (newRows.length !== rows.length) {
    spinner.fail('Translate error');
    throw new Error('Translated row count diffrent from original | new length:' + newRows.length + ' , original:' + rows.length)
  }
  spinner.succeed('Translation Done!')
  return newRows;
}
