const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'networkidle0' });
  const content = await page.content();
  console.log('CONTENT LENGTH:', content.length);
  await browser.close();
})();
