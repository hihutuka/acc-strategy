const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'networkidle0' });
  const rootHtml = await page.$eval('#root', el => el.innerHTML);
  console.log('ROOT HTML:', rootHtml.substring(0, 200));
  await browser.close();
})();
