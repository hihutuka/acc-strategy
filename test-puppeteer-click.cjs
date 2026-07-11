const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'networkidle0' });
  // Click the connection modal open
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent.includes('SimHub 連携'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 500));
  // Click the test connection button
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent.includes('接続テスト'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  const html = await page.$eval('.fixed.inset-0', el => el.innerHTML);
  console.log('MODAL HTML:', html.substring(0, 500));
  await browser.close();
})();
