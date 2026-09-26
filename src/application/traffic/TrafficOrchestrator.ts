import { BrowserEngine, BrowserOptions } from '../../domain/interfaces/BrowserEngine';
import { Session } from '../../domain/entities/Session';
import { logger } from '../../infrastructure/logging/logger';
import { Config } from '../../infrastructure/config/config';
import { BehaviorService } from '../../infrastructure/browser/BehaviorService';
import { MetricsService } from '../../infrastructure/monitoring/MetricsService';
import { sessionJobSchema, proxyServer } from '../../domain/entities/SessionContract';
import { acquireProfile } from '../../infrastructure/browser/ProfileLease';
import { ReputationService } from '../../infrastructure/monitoring/ReputationService';

export class TrafficOrchestrator {
  private blacklist = [
    'https://www.facebook.com/ppplayermusic',
    'https://instagram.com/ppplayermusic',
    'https://lucasveneno.com/public/search',
    'https://lucasveneno.com/search',
    'https://lucasveneno.com/login',
    'https://lucasveneno.com/register'
  ];

  constructor(private engine: BrowserEngine) {}

  async run(session: Session, options: Partial<BrowserOptions> = {}): Promise<void> {
    const { config } = session;
    const startTime = Date.now();
    logger.info('Starting traffic session', { 
      id: config.id, 
      url: config.url, 
      targetDurationMs: config.durationMs 
    });

    let failed = false;
    let failure: unknown;
    let outcome: { status: number; finalUrl: string } | undefined;
    MetricsService.getInstance().trackSessionStart();
    try {


      // Check Proxy Reputation (Optional/Async)
      ReputationService.checkIP(Config.EXTERNAL_IP_CHECK, config.proxy?.server).catch((e: Error) => logger.debug('IP check deferred', { e }));

      const { ReferrerService } = require('../../infrastructure/browser/ReferrerService');
      const referrerService = new ReferrerService(logger);

      await this.engine.init({
        proxy: config.proxy,
        userDataDir: config.userDataDir,
        headless: options.headless,
        deviceProfile: config.deviceProfile || Config.BROWSER_PROFILE,
        proxyLocationEndpoint: Config.MATCH_GEOLOCATION ? Config.PROXY_LOCATION_URL : undefined,
        grantGeolocation: Config.GRANT_GEOLOCATION,
        allowedOrigin: new URL(config.url).origin,
        searchOrigins: Config.ORGANIC_SEARCH ? ['https://www.google.com', 'https://www.bing.com', 'https://duckduckgo.com'] : []
      });
      const viewport = this.engine.getProfile().viewport;

      // 2. Organic Search or Referrer Spoofing
      if (Config.ORGANIC_SEARCH && Config.SEARCH_KEYWORDS.length > 0) {
        const keyword = referrerService.getRandomKeyword(Config.SEARCH_KEYWORDS);
        const { name, url: homepageUrl } = referrerService.getSearchHomepage(Config.SEARCH_ENGINE);
        
        logger.info(`Simulating Organic Search via ${name} (Human-like typing)`, { keyword, homepageUrl });
        await this.engine.navigate(homepageUrl);
        await this.engine.waitForNetworkIdle();
        
        // Clear potential consent popups before interacting
        await this.engine.handleConsentPopups();
        
        await this.engine.randomDelay(1000, 3000);
        
        // Type the keyword and search
        await this.engine.searchKeyword(keyword);
        const searchUrl = await this.engine.evaluate(() => window.location.href);
        
        // Wait to simulate "looking" at results
        if (Config.HUMAN_BEHAVIOR) {
          logger.info('Simulating human-like result scanning (scrolling and mouse movement)...');
          const searchWait = Math.floor(Math.random() * 3000) + 3000; // 3-6 seconds
          const searchStart = Date.now();
          while (Date.now() - searchStart < searchWait) {
            await BehaviorService.simulateRandomAction(this.engine, viewport, { intensity: 'low' });
          }
        } else {
          logger.info('Waiting briefly on search results...');
          await this.engine.randomDelay(2000, 5000);
        }

        // Targeted Clicking Logic (Multi-page loop)
        const targetType = Config.SEARCH_TARGET_TYPE;
        const targetValue = Config.SEARCH_TARGET_VALUE || config.url;
        const pageLimit = Config.SEARCH_PAGES_LIMIT;
        
        let clicked = false;
        for (let page = 1; page <= pageLimit; page++) {
          logger.info(`Searching for target link (Page ${page}/${pageLimit})...`, { 
            strategy: targetType, 
            pattern: targetValue 
          });

          clicked = await this.engine.clickSearchResult(targetValue);

          if (clicked) {
            logger.info(`Successfully identified and clicked target search result on page ${page}!`);
            // Wait for navigation to commence and network to settle
            await this.engine.wait(Math.floor(Math.random() * 2000) + 3000); 
            try {
              await this.engine.waitForNetworkIdle();
            } catch (e) {
              // Ignore network idle timeout, proceed with the loop
            }
            break;
          }

          if (page < pageLimit) {
            logger.info(`Target not found on page ${page}. Attempting to navigate to next page...`);
            const movedToNext = await this.engine.clickNextSearchPage();
            if (!movedToNext) {
              logger.warn(`Could not find "Next" button on search page ${page}. Stopping search.`);
              break;
            }
            await this.engine.waitForNetworkIdle();
            // Random delay after clicking next
            await this.engine.randomDelay(2000, 4000);
          }
        }

        if (!clicked) {
          logger.warn(`Target link matching "${targetValue}" not found within ${pageLimit} pages. Navigating directly.`, { 
            type: targetType, 
            value: targetValue 
          });
          // Fallback: Navigate directly but keep referer if possible
          await this.engine.setExtraHeaders({ 'Referer': searchUrl });
          await this.engine.navigate(config.url);
        }
      } else {
        const referrer = Config.REFERRALS === 'yes' || Config.REFERRER_POOL.length > 0
          ? referrerService.getRandomReferrer(Config.REFERRER_POOL)
          : undefined;
        if (referrer) {
          logger.info(`Spoofing Referrer`, { referrer });
          await this.engine.setExtraHeaders({ 'Referer': referrer });
        }
        await this.engine.navigate(config.url);
      }
      
      // Execute 4 steps with randomized "Thinking Heatmaps" (non-linear stay times)
      const numSteps = 4;
      const sessionDeadline = startTime + config.durationMs;
      const totalLoopTime = Math.min(Math.floor(config.durationMs * 0.8), Math.max(0, sessionDeadline - Date.now()));
      
      // Generate randomized stay durations that sum to totalLoopTime
      const stayWeights = Array.from({ length: numSteps }, () => Math.random() + 0.5);
      const totalWeight = stayWeights.reduce((a, b) => a + b, 0);
      const stayDurations = stayWeights.map(w => Math.floor((w / totalWeight) * totalLoopTime));

      logger.debug('Starting navigation loop with Thinking Heatmaps', { 
        stayDurations, 
        humanBehavior: Config.HUMAN_BEHAVIOR 
      });
      
      for (let i = 0; i < numSteps; i++) {
        const currentStay = stayDurations[i];
        logger.info(`Step ${i+1}/${numSteps}: Staying for ${currentStay}ms...`);
        
        if (Config.HUMAN_BEHAVIOR) {
          const stepStart = Date.now();
          const stepDeadline = Math.min(stepStart + currentStay, sessionDeadline);
          while (Date.now() < stepDeadline) {
            await BehaviorService.simulateRandomAction(
              this.engine, 
              viewport,
              { intensity: config.intensity || Config.BEHAVIOR_INTENSITY, deadlineMs: stepDeadline }
            );
          }
        } else {
          await this.engine.wait(currentStay);
        }

        if (Date.now() < sessionDeadline) await this.performContextualClick();
      }

      // Final wait to ensure total session duration matches target
      const remainingTime = config.durationMs - (Date.now() - startTime);
      if (remainingTime > 0) {
        logger.debug(`Final compensating wait: ${remainingTime}ms...`);
        await this.engine.wait(remainingTime);
      }
      
      outcome = this.engine.navigationResult();
    } catch (error: unknown) {
      failed = true;
      failure = error;
      try { outcome = this.engine.navigationResult(true); } catch { /* No response before launch/navigation failure. */ }
      logger.error('Session execution failed', { 
        id: config.id, 
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : (typeof error === 'object' ? JSON.stringify(error) : String(error))
      });
    } finally {
      try { await this.engine.close(); } catch (cleanupError) {
        logger.warn('Browser cleanup failed', { error: cleanupError });
        if (!failed) { failure = cleanupError; } // Record the failure but do not mark the session as failed
      } finally {
        MetricsService.getInstance().trackSessionEnd(!failed, Date.now() - startTime, outcome, failure);
      }
    }
    if (failed) throw failure;
    logger.info('Session completed successfully', { id: config.id, actualDurationMs: Date.now() - startTime, ...outcome });
  }

  /**
   * Helper to run a session from a simplified Job Data structure
   */
  async runFromJob(jobId: string, payload: unknown): Promise<void> {
    const data = sessionJobSchema.parse(payload);
    const lease = data.persistent ? await acquireProfile(Config.SESSIONS_DATA_DIR, data.profileKey!) : undefined;
    try {
    const session = new Session({
      id: jobId,
      url: data.url,
      deviceProfile: data.deviceProfile,
      durationMs: data.durationMinutes * 60000,
      intensity: data.intensity,
      userDataDir: lease?.path,
      proxy: data.proxy ? {
        server: proxyServer(data.proxy),
        username: data.proxy.username,
        password: data.proxy.password
      } : undefined
    });

    await this.run(session, {
      headless: Config.HEADLESS,
    });
    } finally { await lease?.release().catch(() => logger.warn('Profile lock release failed')); }
  }

  private async performContextualClick(): Promise<void> {
    const clickResult = await this.engine.evaluate((blacklist) => {
      const HIGH_VALUE = ['about', 'product', 'service', 'feature', 'price', 'blog', 'case', 'contact'];
      const LOW_VALUE = ['login', 'register', 'signin', 'signup', 'terms', 'privacy', 'policy', 'legal'];

      const links = Array.from(document.querySelectorAll("a"))
        .filter(a => {
          const href = a.href;
          if (!href || blacklist.some((b: string) => href.includes(b))) return false;
          try {
            const target = new URL(href);
            const current = new URL(window.location.href);
            // Exclude same-page hash anchors — page.goto() returns null for them
            if (target.origin !== current.origin) return false;
            if (target.pathname === current.pathname && target.search === current.search) return false;
            return true;
          } catch { return false; }
        })
        .map(a => {
          const text = (a.innerText || a.title || "").toLowerCase().trim();
          let score = 10; // Base score
          
          if (HIGH_VALUE.some(k => text.includes(k))) score += 20;
          if (LOW_VALUE.some(k => text.includes(k))) score -= 5;
          
          // Surface area bonus (prefer larger elements/buttons)
          const rect = a.getBoundingClientRect();
          score += Math.min(rect.width * rect.height / 1000, 10);

          return { href: a.href, score, text };
        });

      if (links.length === 0) return null;

      // Weighted random selection
      const totalScore = links.reduce((sum, l) => sum + l.score, 0);
      let rand = Math.random() * totalScore;
      
      for (const link of links) {
        rand -= link.score;
        if (rand <= 0) {
          return { href: link.href, text: link.text };
        }
      }
      return null;
    }, this.blacklist);

    if (clickResult) {
      await this.engine.navigate(clickResult.href);
      logger.info(`Contextual click performed: "${clickResult.text}" -> ${clickResult.href}`);
    } else {
      logger.debug('No suitable links found for contextual click.');
    }
  }
}
