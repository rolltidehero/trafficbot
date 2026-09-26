const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.setRequestInterception(true);
  page.on('request', request => {
    request.continue();
  });
  
  try {
    await page.goto('https://www.google.com/');
    await page.type('textarea[name="q"], input[name="q"]', 'ppplayer');
    await Promise.all([
      page.keyboard.press('Enter'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded' })
    ]);
    
    console.log("On search page:", page.url());
    await page.setExtraHTTPHeaders({ 'Referer': page.url() });
    
    await page.goto('https://ppplayer.com/');
    console.log("Navigated to ppplayer");
  } catch (e) {
    console.log("Error:", e.message);
  }
  await browser.close();
})();
