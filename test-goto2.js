const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => {
    // just continue
    request.continue();
  });
  await page.setExtraHTTPHeaders({ 'Referer': 'https://www.google.com/' });
  try {
    await page.goto('https://ppplayer.com/');
    console.log("Success with interception");
  } catch (e) {
    console.log("Error with interception:", e.message);
  }
  await browser.close();
})();
