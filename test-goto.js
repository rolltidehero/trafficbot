const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Referer': 'https://www.google.com/' });
  try {
    await page.goto('https://ppplayer.com/');
    console.log("Success");
  } catch (e) {
    console.log("Error:", e.message);
  }
  await browser.close();
})();
