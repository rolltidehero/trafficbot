const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const allowedOrigin = 'https://ppplayer.com';
  const searchOrigins = ['https://www.google.com', 'https://www.bing.com'];
  
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      const url = request.url();
      const origin = new URL(url).origin;
      const allowed = origin === allowedOrigin;
      const isSearch = searchOrigins.includes(origin);
      if (allowedOrigin && !allowed && !isSearch) {
        console.error(`BLOCKED: ${url}`);
        return request.abort();
      }
    }
    request.continue();
  });
  
  try {
    await page.goto('https://www.google.com/');
    console.log("Navigated to google");
    await page.goto('https://ppplayer.com/');
    console.log("Navigated to ppplayer");
  } catch (e) {
    console.log("Error:", e.message);
  }
  await browser.close();
})();
