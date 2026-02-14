/**
 * Run Controller
 * Handles ad verification API requests with x402 payment integration
 */

import { Request, Response } from 'express';
import { adScraper } from '../services/adScraper';
import { verifyPayment } from '../utils/payment';
import { RunQueryParams, ApiResponse } from '../types/ads';

export class RunController {
  /**
   * Main endpoint handler for ad verification requests
   */
  async handleRun(req: Request, res: Response): Promise<void> {
    try {
      const { type, query, url, domain, country } = req.query;

      // Validate required parameters
      if (!type || !country) {
        res.status(400).json({ error: 'Missing required parameters: type and country' });
        return;
      }

      // Validate country code
      const validCountries = ['US', 'DE', 'FR', 'ES', 'GB', 'PL'];
      if (!validCountries.includes(country as string)) {
        res.status(400).json({ 
          error: 'Invalid country code. Valid options: US, DE, FR, ES, GB, PL' 
        });
        return;
      }

      // Verify payment via x402
      const paymentVerified = await verifyPayment(req);
      if (!paymentVerified) {
        res.status(402).json({ 
          error: 'Payment required',
          price: 0.03,
          currency: 'USD',
          payment_url: '/api/payment/initiate'
        });
        return;
      }

      let result: ApiResponse;

      // Route to appropriate scraper based on type
      switch (type) {
        case 'search_ads':
          if (!query) {
            res.status(400).json({ error: 'Query parameter required for search_ads type' });
            return;
          }
          result = await adScraper.scrapeSearchAds(query as string, country as string);
          break;

        case 'display_ads':
          if (!url) {
            res.status(400).json({ error: 'URL parameter required for display_ads type' });
            return;
          }
          result = await adScraper.scrapeDisplayAds(url as string, country as string);
          break;

        case 'advertiser':
          if (!domain) {
            res.status(400).json({ error: 'Domain parameter required for advertiser type' });
            return;
          }
          result = await adScraper.scrapeAdvertiser(domain as string, country as string);
          break;

        default:
          res.status(400).json({ 
            error: 'Invalid type. Valid options: search_ads, display_ads, advertiser' 
          });
          return;
      }

      // Add payment verification to response
      result.payment.verified = true;
      result.payment.txHash = req.headers['payment-signature'] as string || '';

      res.json(result);
    } catch (error) {
      console.error('Error in run controller:', error);
      res.status(500).json({ 
        error: 'Failed to process request',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Health check endpoint
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    res.json({
      status: 'healthy',
      service: 'ad-verification-api',
      version: '1.0.0',
      supported_countries: ['US', 'DE', 'FR', 'ES', 'GB', 'PL'],
      pricing: {
        search_ads: 0.03,
        display_ads: 0.03,
        advertiser: 0.05,
        currency: 'USD'
      }
    });
  }
}

export const runController = new RunController();