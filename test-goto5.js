const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.setRequestInterception(true);
  page.on('request', request => {
    request.continue();
  });
  
  try {
    await page.goto('https://www.google.com/sorry/index');
    console.log("On sorry page");
    // await page.setExtraHTTPHeaders({ 'Referer': page.url() }); // uncomment to test referer
    await page.goto('https://ppplayer.com/');
    console.log("Navigated to ppplayer");
  } catch (e) {
    console.log("Error:", e.message);
  }
  await browser.close();
})();
