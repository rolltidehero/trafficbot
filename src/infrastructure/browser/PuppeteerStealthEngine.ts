import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page, LaunchOptions } from 'puppeteer';
import { BrowserEngine, BrowserOptions } from '../../domain/interfaces/BrowserEngine';
import { sameOrigin } from '../../domain/entities/SessionContract';
import { logger } from '../logging/logger';

puppeteer.use(StealthPlugin());

export class PuppeteerStealthEngine implements BrowserEngine {
  private browser: Browser | null = null;
  private closing?: Promise<void>;
  private launching?: Promise<Browser>;
  private cancelled = false;
  private page: Page | null = null;

  private allowedOrigin?: string;
  private searchOrigins: string[] = [];
  private scopeError?: Error;
  private lastResponse?: { status: number; finalUrl: string };
  private navigationTimeoutMs = 60000;
  private waits = new Map<NodeJS.Timeout, () => void>();

  navigationResult(allowFailure = false): { status: number; finalUrl: string } {
    if (!allowFailure && this.scopeError) throw this.scopeError;
    if (!this.lastResponse) throw new Error('No navigation response');
    if (!allowFailure && this.allowedOrigin && !sameOrigin(this.lastResponse.finalUrl, this.allowedOrigin)) throw new Error('Session did not reach configured origin');
    if (!allowFailure && this.lastResponse.status >= 400) throw new Error(`HTTP failure: ${this.lastResponse.status}`);
    return this.lastResponse;
  }

  async init(options: BrowserOptions): Promise<void> {
    this.closing = undefined;
    this.cancelled = false;
    const args = [
      '--window-position=0,0',
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-default-browser-check',
    ];

    if (options.proxy) {
      args.push(`--proxy-server=${options.proxy.server}`);
    }

    const launchOptions: LaunchOptions = {
      headless: options.headless !== false,
      args,
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: options.viewport || { width: 1280, height: 720 },
    };

    if (options.userDataDir) {
      launchOptions.userDataDir = options.userDataDir;
    }

    this.launching = puppeteer.launch(launchOptions);
    this.browser = await this.launching;
    if (this.cancelled) { await this.close(); throw new Error('Session cancelled during launch'); }
    const pages = await this.browser!.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser!.newPage();

    this.allowedOrigin = options.allowedOrigin;
    this.searchOrigins = options.searchOrigins || [];
    this.navigationTimeoutMs = options.navigationTimeoutMs || 60000;
    this.scopeError = undefined;
    this.lastResponse = undefined;
    await this.page.setRequestInterception(true);
    this.page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === this.page?.mainFrame()) {
        const url = request.url();
        if (this.allowedOrigin && !sameOrigin(url, this.allowedOrigin) && !this.searchOrigins.some(origin => sameOrigin(url, origin))) {
          this.scopeError = new Error('Navigation blocked: destination outside configured origin');
          void request.abort().catch(() => undefined);
          return;
        }
        if (this.allowedOrigin && sameOrigin(url, this.allowedOrigin)) this.searchOrigins = [];
      }
      void request.continue().catch(() => undefined);
    });
    this.page.on('response', response => {
      if (response.request().isNavigationRequest() && response.frame() === this.page?.mainFrame()) {
        this.lastResponse = { status: response.status(), finalUrl: response.url() };
      }
    });
    // Popups are outside the session's controlled navigation path.
    this.page.on('popup', page => { void page?.close(); });

    if (options.userAgent) {
      await this.page.setUserAgent(options.userAgent);
      
      // Reinforce Client Hints (Sec-CH-UA)
      const chromeMatch = options.userAgent.match(/Chrome\/(\d+)/);
      if (chromeMatch) {
        const majorVersion = chromeMatch[1];
        const isMobile = options.userAgent.includes('Mobile');
        const platform = options.platform === 'MacIntel' ? 'macOS' : 
                         options.platform === 'Win32' ? 'Windows' : 'Linux';

        await this.page.setExtraHTTPHeaders({
          'sec-ch-ua': `"Not(A:Brand";v="99", "Google Chrome";v="${majorVersion}", "Chromium";v="${majorVersion}"`,
          'sec-ch-ua-mobile': isMobile ? '?1' : '?0',
          'sec-ch-ua-platform': `"${platform}"`,
        });
      }
    }

    if (options.viewport) {
      await this.page.setViewport(options.viewport);
    }

    if (options.proxy?.username && options.proxy?.password) {
      await this.page.authenticate({
        username: options.proxy.username,
        password: options.proxy.password,
      });
    }

    if (options.fingerprintScript) await this.page.evaluateOnNewDocument(options.fingerprintScript);

    logger.debug('Puppeteer Stealth initialized with advanced fingerprint', { 
      userAgent: options.userAgent,
      platform: options.platform 
    });
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.navigationTimeoutMs });
    if (this.scopeError) throw this.scopeError;
    if (!response) throw new Error('Missing navigation response');
    if (response.status() >= 400) throw new Error(`HTTP failure: ${response.status()}`);
  }

  async wait(ms: number): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.waits.delete(timer); resolve(); }, ms);
      this.waits.set(timer, () => { clearTimeout(timer); reject(new Error('Session cancelled')); });
    });
  }

  async evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T> {
    if (!this.page) throw new Error('Engine not initialized');
    return await this.page.evaluate(fn, ...args);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await (this.page as any).mouse.wheel({ deltaX, deltaY });
  }

  async mouseMove(x: number, y: number): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await this.page.mouse.move(x, y, { steps: 5 }); // Use steps for smoother movement
  }

  async click(x: number, y: number): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await this.page.mouse.click(x, y);
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.cancelled = true;
    for (const cancel of this.waits.values()) cancel();
    this.waits.clear();
    this.closing = (async () => {
      const browser = this.browser || await this.launching?.catch(() => undefined);
      this.browser = null;
      this.page = null;
      if (browser) {
        try { await browser.close(); }
        catch (error) { browser.process()?.kill('SIGKILL'); throw error; }
      }
    })();
    return this.closing;
  }

  async setExtraHeaders(headers: Record<string, string>): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await this.page.setExtraHTTPHeaders(headers);
  }

  async setGeolocation(latitude: number, longitude: number): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await this.page.setGeolocation({ latitude, longitude, accuracy: 100 });
    
    // Also need to grant permission for geolocation
    const context = this.browser!.defaultBrowserContext();
    await context.overridePermissions(this.page.url(), ['geolocation']);
  }

  async waitForNetworkIdle(): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      await this.page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 });
    } catch (e) {
      // Ignore network idle timeouts, some pages never fully idle
    }
  }

  async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.wait(delay);
  }

  async clickLinkByHref(href: string): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      const link = await this.page.$(`a[href="${href}"]`);
      if (link) {
        // Robust click
        await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), link);
        await this.randomDelay(500, 1500);
        await link.click({ delay: Math.random() * 200 + 100 });
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async clickLinkContainingHref(partialHref: string): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      const links = await this.page.$$('a');
      for (const link of links) {
        const href = await this.page.evaluate(el => el.getAttribute('href'), link);
        if (href && href.includes(partialHref)) {
          // Robust click
          await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), link);
          await this.randomDelay(500, 1500);
          await link.click({ delay: Math.random() * 200 + 100 });
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async clickLinkByText(text: string): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      // Look for links that contain the text
      const links = await this.page.$$('a');
      for (const link of links) {
        const linkText = await this.page.evaluate(el => el.textContent, link);
        if (linkText && linkText.toLowerCase().includes(text.toLowerCase())) {
          // Robust click
          await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), link);
          await this.randomDelay(500, 1500);
          await link.click({ delay: Math.random() * 200 + 100 });
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async clickNextSearchPage(): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      const nextSelectors = [
        'a#pnnext', // Google
        'a.sb_pagN', // Bing
        'a.page-link[aria-label="Next page"]', // Bing alternative
        'button#more-results', // DuckDuckGo
        'a:contains("Next")', // Generic text-based fallback
      ];

      for (const selector of nextSelectors) {
        const nextButton = await this.page.$(selector);
        if (nextButton) {
          await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), nextButton);
          await this.randomDelay(500, 1500);
          await nextButton.click({ delay: Math.random() * 200 + 100 });
          await this.waitForNetworkIdle();
          return true;
        }
      }

      // Special case for DuckDuckGo "More Results" button
      if (await this.page.$('#more-results')) {
        await this.page.click('#more-results');
        await this.randomDelay(1000, 2000);
        return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  async clickSearchResult(pattern: string): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      const links = await this.page.$$('a');
      const patternLower = pattern.toLowerCase();

      for (const link of links) {
        const href = await this.page.evaluate(el => el.getAttribute('href'), link);
        const text = await this.page.evaluate(el => el.textContent, link);
        
        // Skip common search engine internal links
        if (text && (text.toLowerCase().includes('similar') || text.toLowerCase().includes('cached'))) continue;

        // Strategy 1: Direct href match
        if (href && href.toLowerCase().includes(patternLower)) {
          // Special case for search engine redirect URLs (e.g., google.com/url?q=...)
          const isRedirect = href.includes('/url?') || href.includes('bing.com/ck/a?') || href.includes('duckduckgo.com/l/?');
          if (isRedirect) {
            // Check if the pattern is in the query params or the full encoded URL
            try {
              const urlObj = new URL(href, this.page.url());
              const target = urlObj.searchParams.get('q') || urlObj.searchParams.get('url') || urlObj.searchParams.get('uddg');
              if (target && target.toLowerCase().includes(patternLower)) {
                logger.info(`Heuristic: Found target in redirect URL: ${target}`);
              } else if (!href.toLowerCase().includes(patternLower)) {
                continue; // Not a match in the redirect target
              }
            } catch (e) {
              // URL parsing failed, but if href still contains pattern, we proceed
              if (!href.toLowerCase().includes(patternLower)) continue;
            }
          }

          logger.info(`Clicking result by href: ${href}`);
          await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), link);
          await this.randomDelay(800, 2000);
          await link.click({ delay: Math.random() * 200 + 100 });
          return true;
        }

        // Strategy 2: Text content match
        if (text && text.toLowerCase().includes(patternLower)) {
          logger.info(`Clicking result by text: ${text.trim()}`);
          await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), link);
          await this.randomDelay(800, 2000);
          await link.click({ delay: Math.random() * 200 + 100 });
          return true;
        }
      }

      return false;
    } catch (e) {
      logger.error(`Error in clickSearchResult: ${e}`);
      return false;
    }
  }

  async searchKeyword(keyword: string): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    
    const searchInputSelectors = [
      'input[name="q"]', // Google, Bing
      'textarea[name="q"]', // Google modern
      '#search_form_input_homepage', // DuckDuckGo homepage
      '#search_form_input', // DuckDuckGo results
      'input[type="text"]', // Generic fallback
    ];

    let inputSet = false;
    for (const selector of searchInputSelectors) {
      try {
        const input = await this.page.waitForSelector(selector, { timeout: 5000 });
        if (input) {
          logger.debug(`Found search input with selector: ${selector}`);
          
          // Clear input first
          await input.click();
          await this.page.keyboard.down('Meta'); // Mac CMD
          await this.page.keyboard.press('a');
          await this.page.keyboard.up('Meta');
          await this.page.keyboard.press('Backspace');
          
          // Fallback for non-mac or failed CMD+A
          const currentVal = await input.evaluate((el: any) => el.value);
          if (currentVal) {
             await this.page.keyboard.down('Control');
             await this.page.keyboard.press('a');
             await this.page.keyboard.up('Control');
             await this.page.keyboard.press('Backspace');
          }

          // Type like a human
          await input.type(keyword, { delay: Math.random() * 100 + 50 });
          await this.randomDelay(500, 1200);
          
          // Press Enter and wait for navigation
          const navPromise = this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
            logger.debug('Search navigation timeout or already navigated');
          });
          await this.page.keyboard.press('Enter');
          await navPromise;
          
          await this.waitForNetworkIdle();
          inputSet = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!inputSet) {
      throw new Error(`Search input not found with any selector for keyword: ${keyword}`);
    }
  }

  async handleConsentPopups(): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    
    logger.debug('Checking for consent popups...');
    
    const consentSelectors = [
      // Google
      'button[aria-label="Accept all"]',
      'button[aria-label="I agree"]',
      '#L2AGLb', // Google "Accept all" ID
      'button:contains("Accept all")',
      // Bing
      '#bnp_btn_accept',
      'button#bnp_btn_accept',
      '#adlt_set_save',
      // Generic XPath for buttons containing specific text
      '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "accept all")]',
      '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "i agree")]',
      '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "agree")]',
      '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "accept cookies")]'
    ];

    try {
      // Short delay to allow popup to appear
      await new Promise(resolve => setTimeout(resolve, 2000));

      for (const selector of consentSelectors) {
        let element;
        if (selector.startsWith('//')) {
          const handles = await this.page.$$(`::-p-xpath(${selector})`);
          if (handles.length > 0) element = handles[0];
        } else if (selector.includes(':contains')) {
          const text = selector.match(/:contains\("(.+)"\)/)?.[1];
          if (text) {
             const handles = await this.page.$$(`::-p-xpath(//button[contains(., "${text}")])`);
             if (handles.length > 0) element = handles[0];
          }
        } else {
          element = await this.page.$(selector);
        }

        if (element) {
          const isVisible = await element.evaluate((el: any) => {
            const style = window.getComputedStyle(el);
            return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
          });

          if (isVisible) {
            logger.info('Consent popup detected, attempting to clear...', { selector });
            await (element as any).click();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for it to close
            return true;
          }
        }
      }
      
      logger.debug('No active consent popups detected.');
      return false;
    } catch (error) {
      logger.debug('Error while checking for consent popups', { error: (error as Error).message });
      return false;
    }
  }
}
