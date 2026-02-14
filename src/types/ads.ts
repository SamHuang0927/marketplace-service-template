/**
 * Type definitions for ad verification API
 */

export interface Ad {
  position: number;
  placement: 'top' | 'bottom' | 'display';
  title: string;
  description: string;
  displayUrl: string;
  finalUrl: string;
  advertiser: string;
  extensions: string[];
  isResponsive: boolean;
}

export interface ProxyInfo {
  country: string;
  carrier: string;
  type: 'mobile' | 'residential' | 'datacenter';
}

export interface PaymentInfo {
  txHash: string;
  amount: number;
  verified: boolean;
}

export interface SearchAdsResponse {
  type: 'search_ads';
  query: string;
  country: string;
  timestamp: string;
  ads: Ad[];
  organic_count: number;
  total_ads: number;
  ad_positions: {
    top: number;
    bottom: number;
  };
  proxy: ProxyInfo;
  payment: PaymentInfo;
}

export interface DisplayAdsResponse {
  type: 'display_ads';
  url: string;
  country: string;
  timestamp: string;
  ads: Ad[];
  total_ads: number;
  proxy: ProxyInfo;
  payment: PaymentInfo;
}

export interface Campaign {
  title: string;
  estimated_spend: string;
  impressions: string;
}

export interface AdvertiserResponse {
  type: 'advertiser';
  domain: string;
  country: string;
  timestamp: string;
  advertiser_name: string;
  estimated_spend: string;
  total_campaigns: number;
  campaigns: Campaign[];
  proxy: ProxyInfo;
  payment: PaymentInfo;
}

export type ApiResponse = SearchAdsResponse | DisplayAdsResponse | AdvertiserResponse;

export interface RunQueryParams {
  type: 'search_ads' | 'display_ads' | 'advertiser';
  query?: string;
  url?: string;
  domain?: string;
  country: string;
}