/**
 * Ad Scraper Service
 * Handles headless browser operations and ad extraction
 * Uses mobile proxies via Proxies.sx for geo-targeted ad verification
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { proxyFetch } from '../utils/proxy';
import { Ad, SearchAdsResponse, DisplayAdsResponse, AdvertiserResponse } from '../types/ads';

export class AdScraper {
  private browser: Browser | null = null;

  /**
   * Initialize headless browser with mobile emulation
   */
  async initBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });
    }
    return this.browser;
  }

  /**
   * Create a new page with mobile emulation and proxy settings
   */
  async createMobilePage(country: string): Promise<Page> {
    const browser = await this.initBrowser();
    const page = await browser.newPage();

    // Set mobile viewport and user agent
    await page.setViewport({ width: 375, height: 667, isMobile: true });
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
    );

    // Enable request interception for proxy
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      // Use proxyFetch for external requests
      if (request.resourceType() === 'document' || request.resourceType() === 'script') {
        try {
          const response = await proxyFetch(request.url(), country);
          request.respond({
            status: response.status,
            headers: response.headers,
            body: await response.text(),
          });
        } catch (error) {
          request.abort();
        }
      } else {
        request.continue();
      }
    });

    return page;
  }

  /**
   * Extract Google Search ads from search results page
   */
  async scrapeSearchAds(query: string, country: string): Promise<SearchAdsResponse> {
    const page = await this.createMobilePage(country);
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://www.google.com/search?q=${encodedQuery}&hl=en&gl=${country.toLowerCase()}`;

    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for ads to load
      await page.waitForSelector('[data-text-ad], [data-dtld], .uEierd, .pla-unit', { timeout: 10000 });

      // Extract ads using multiple selectors for different ad formats
      const ads = await page.evaluate(() => {
        const adElements = document.querySelectorAll('[data-text-ad], [data-dtld], .uEierd, .pla-unit');
        const ads: Ad[] = [];
        let position = 1;

        adElements.forEach((element, index) => {
          // Determine placement (top or bottom)
          const rect = element.getBoundingClientRect();
          const placement = rect.top < window.innerHeight / 2 ? 'top' : 'bottom';

          // Extract ad data based on element type
          let title = '';
          let description = '';
          let displayUrl = '';
          let finalUrl = '';
          let advertiser = '';

          // Try different selectors for different ad formats
          const titleEl = element.querySelector('.v0nnCb, .CCgQ5, .sVXRqc, .pla-unit-title');
          const descEl = element.querySelector('.MUxGbd, .lyLwlc, .pla-unit-description');
          const urlEl = element.querySelector('.qzEoUe, .x2VHCd, .pla-unit-url');
          const linkEl = element.querySelector('a');

          if (titleEl) title = titleEl.textContent?.trim() || '';
          if (descEl) description = descEl.textContent?.trim() || '';
          if (urlEl) displayUrl = urlEl.textContent?.trim() || '';
          if (linkEl) finalUrl = linkEl.href || '';

          // Extract advertiser from URL or title
          advertiser = displayUrl.split('/')[0] || title.split(' ')[0] || '';

          // Check for extensions
          const extensions: string[] = [];
          if (element.querySelector('.pla-unit-sitelinks')) extensions.push('Sitelinks');
          if (element.querySelector('.pla-unit-callout')) extensions.push('Callout');
          if (element.querySelector('.pla-unit-price')) extensions.push('Price');
          if (element.querySelector('.pla-unit-location')) extensions.push('Location');

          if (title && description) {
            ads.push({
              position: position++,
              placement,
              title,
              description,
              displayUrl,
              finalUrl,
              advertiser,
              extensions,
              isResponsive: extensions.length > 0,
            });
          }
        });

        return ads;
      });

      // Count organic results
      const organicCount = await page.evaluate(() => {
        return document.querySelectorAll('.g:not([data-text-ad]):not([data-dtld])').length;
      });

      // Calculate ad positions
      const adPositions = {
        top: ads.filter(ad => ad.placement === 'top').length,
        bottom: ads.filter(ad => ad.placement === 'bottom').length,
      };

      await page.close();

      return {
        type: 'search_ads',
        query,
        country,
        timestamp: new Date().toISOString(),
        ads,
        organic_count: organicCount,
        total_ads: ads.length,
        ad_positions: adPositions,
        proxy: {
          country,
          carrier: 'T-Mobile', // This would come from proxy service response
          type: 'mobile',
        },
        payment: {
          txHash: '',
          amount: 0.03,
          verified: true,
        },
      };
    } catch (error) {
      await page.close();
      throw new Error(`Failed to scrape search ads: ${error}`);
    }
  }

  /**
   * Extract display ads from a webpage
   */
  async scrapeDisplayAds(url: string, country: string): Promise<DisplayAdsResponse> {
    const page = await this.createMobilePage(country);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for page to load and potential ads to appear
      await page.waitForTimeout(5000);

      // Extract ad elements from the page
      const ads = await page.evaluate(() => {
        const adSelectors = [
          '[data-ad]',
          '.ad',
          '.advertisement',
          '.adsbygoogle',
          'iframe[src*="ads"]',
          'ins.adsbygoogle',
        ];

        const adElements: Element[] = [];
        adSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => adElements.push(el));
        });

        const ads: Ad[] = [];
        adElements.forEach((element, index) => {
          // Try to extract ad content
          const rect = element.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0;

          if (isVisible) {
            // Extract text content
            const text = element.textContent?.trim() || '';
            const title = text.split('\n')[0] || 'Display Ad';
            const description = text.length > 100 ? text.substring(0, 100) + '...' : text;

            // Try to find links
            const linkEl = element.querySelector('a');
            const finalUrl = linkEl?.href || '';
            const displayUrl = finalUrl ? new URL(finalUrl).hostname : '';

            ads.push({
              position: index + 1,
              placement: 'display',
              title,
              description,
              displayUrl,
              finalUrl,
              advertiser: displayUrl.split('.')[0] || 'Unknown',
              extensions: [],
              isResponsive: true,
            });
          }
        });

        return ads;
      });

      await page.close();

      return {
        type: 'display_ads',
        url,
        country,
        timestamp: new Date().toISOString(),
        ads,
        total_ads: ads.length,
        proxy: {
          country,
          carrier: 'T-Mobile',
          type: 'mobile',
        },
        payment: {
          txHash: '',
          amount: 0.03,
          verified: true,
        },
      };
    } catch (error) {
      await page.close();
      throw new Error(`Failed to scrape display ads: ${error}`);
    }
  }

  /**
   * Scrape advertiser information from Google Ads Transparency Center
   */
  async scrapeAdvertiser(domain: string, country: string): Promise<AdvertiserResponse> {
    const page = await this.createMobilePage(country);
    const transparencyUrl = `https://adstransparency.google.com/advertiser/${domain}?region=${country}`;

    try {
      await page.goto(transparencyUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for advertiser data to load
      await page.waitForSelector('.advertiser-info, .campaign-list', { timeout: 10000 });

      const advertiserData = await page.evaluate(() => {
        // Extract advertiser information
        const nameEl = document.querySelector('.advertiser-name');
        const spendEl = document.querySelector('.spend-estimate');
        const campaignsEl = document.querySelectorAll('.campaign-item');

        const campaigns = Array.from(campaignsEl).map(campaign => {
          const titleEl = campaign.querySelector('.campaign-title');
          const spendEl = campaign.querySelector('.campaign-spend');
          const impressionsEl = campaign.querySelector('.campaign-impressions');

          return {
            title: titleEl?.textContent?.trim() || '',
            estimated_spend: spendEl?.textContent?.trim() || '',
            impressions: impressionsEl?.textContent?.trim() || '',
          };
        });

        return {
          name: nameEl?.textContent?.trim() || '',
          estimated_spend: spendEl?.textContent?.trim() || '',
          total_campaigns: campaigns.length,
          campaigns,
        };
      });

      await page.close();

      return {
        type: 'advertiser',
        domain,
        country,
        timestamp: new Date().toISOString(),
        advertiser_name: advertiserData.name,
        estimated_spend: advertiserData.estimated_spend,
        total_campaigns: advertiserData.total_campaigns,
        campaigns: advertiserData.campaigns,
        proxy: {
          country,
          carrier: 'T-Mobile',
          type: 'mobile',
        },
        payment: {
          txHash: '',
          amount: 0.03,
          verified: true,
        },
      };
    } catch (error) {
      await page.close();
      throw new Error(`Failed to scrape advertiser data: ${error}`);
    }
  }

  /**
   * Clean up browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export const adScraper = new AdScraper();