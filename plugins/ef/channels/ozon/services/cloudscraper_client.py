#!/usr/bin/env python3
"""
Cloudscraper-based client for Ozon competitor data.
Uses cloudscraper to bypass Cloudflare and anti-bot protection.
"""

import json
import logging
import asyncio
from typing import Dict, Any, Optional
import cloudscraper
from decimal import Decimal

logger = logging.getLogger(__name__)


class OzonCloudscraperClient:
    """Client to get competitor data from Ozon using cloudscraper."""

    def __init__(self):
        """Initialize the cloudscraper client."""
        # Create a cloudscraper instance with browser emulation
        self.scraper = cloudscraper.create_scraper(
            browser={
                'browser': 'chrome',
                'platform': 'windows',
                'desktop': True
            }
        )

    async def get_competitor_data(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Get competitor data for a product.

        Args:
            product_id: Ozon product ID

        Returns:
            Dictionary with competitor data or None if failed
        """
        try:
            # Run the sync method in a thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self._get_competitor_data_sync,
                product_id
            )
            return result
        except Exception as e:
            logger.error(f"Error getting competitor data for product {product_id}: {e}")
            return None

    def _get_competitor_data_sync(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Synchronous method to get competitor data.

        Args:
            product_id: Ozon product ID

        Returns:
            Dictionary with competitor data or None if failed
        """
        try:
            # Try the modal URL for other sellers
            modal_url = f"https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2"
            params = {
                "url": f"/modal/otherOffersFromSellers?product_id={product_id}&page_changed=true"
            }

            logger.info(f"Fetching competitor data for product {product_id}")

            response = self.scraper.get(modal_url, params=params, timeout=30)

            if response.status_code == 200:
                data = response.json()
                competitor_info = self._extract_competitor_info(data)

                if competitor_info['competitor_count'] > 0:
                    logger.info(f"Found {competitor_info['competitor_count']} competitors for product {product_id}")
                    return competitor_info
                else:
                    logger.info(f"No competitors found in modal data for product {product_id}")

            elif response.status_code == 403:
                logger.warning(f"Access forbidden for product {product_id}, trying alternative approach")
                # Try alternative URL format
                return self._try_alternative_url(product_id)
            else:
                logger.warning(f"Failed to get competitor data: HTTP {response.status_code}")

        except Exception as e:
            logger.error(f"Error fetching competitor data: {e}")

        return None

    def _try_alternative_url(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Try alternative URL format to get competitor data.

        Args:
            product_id: Ozon product ID

        Returns:
            Dictionary with competitor data or None if failed
        """
        try:
            # Try the product page with special parameters
            product_url = f"https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2"

            # Use the exact URL format that user said works
            params_str = f"/product/product-{product_id}/?layout_container=pdpPage2column&layout_page_index=2"

            params = {"url": params_str}

            response = self.scraper.get(product_url, params=params, timeout=30)

            if response.status_code == 200:
                data = response.json()
                competitor_info = self._extract_competitor_info(data)

                if competitor_info['competitor_count'] > 0:
                    logger.info(f"Found {competitor_info['competitor_count']} competitors using alternative URL")
                    return competitor_info

        except Exception as e:
            logger.error(f"Alternative URL failed: {e}")

        return None

    def _extract_competitor_info(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract competitor information from API response.

        Args:
            data: Raw API response data

        Returns:
            Extracted competitor information
        """
        result = {
            'competitor_count': 0,
            'competitor_min_price': None,
            'market_min_price': None,
            'sellers': []
        }

        if 'widgetStates' not in data:
            return result

        widget_states = data['widgetStates']

        # Look for widgets containing seller/offer information
        for key, value in widget_states.items():
            key_lower = key.lower()

            # Check for relevant widgets
            if any(word in key_lower for word in ['seller', 'offer', 'price', 'другие', 'предложения']):
                if isinstance(value, str):
                    try:
                        widget_data = json.loads(value)

                        # Extract total count
                        if 'totalCount' in widget_data:
                            result['competitor_count'] = widget_data['totalCount']
                            logger.debug(f"Found totalCount: {widget_data['totalCount']}")

                        # Extract count from various possible fields
                        if 'count' in widget_data:
                            result['competitor_count'] = widget_data['count']

                        # Extract items/sellers list
                        if 'items' in widget_data and isinstance(widget_data['items'], list):
                            for item in widget_data['items']:
                                seller_info = self._extract_seller_info(item)
                                if seller_info:
                                    result['sellers'].append(seller_info)

                        # Extract offers
                        if 'offers' in widget_data and isinstance(widget_data['offers'], list):
                            for offer in widget_data['offers']:
                                seller_info = self._extract_seller_info(offer)
                                if seller_info:
                                    result['sellers'].append(seller_info)

                        # Extract min price
                        if 'minPrice' in widget_data:
                            result['competitor_min_price'] = float(widget_data['minPrice'])

                        if 'min_price' in widget_data:
                            result['competitor_min_price'] = float(widget_data['min_price'])

                    except json.JSONDecodeError:
                        continue
                    except Exception as e:
                        logger.debug(f"Error parsing widget {key}: {e}")

        # If we found sellers but no count, use the number of sellers
        if not result['competitor_count'] and result['sellers']:
            result['competitor_count'] = len(result['sellers'])

        # Calculate min price from sellers if not found
        if not result['competitor_min_price'] and result['sellers']:
            prices = []
            for seller in result['sellers']:
                if 'price' in seller and seller['price']:
                    prices.append(float(seller['price']))

            if prices:
                result['competitor_min_price'] = min(prices)
                result['market_min_price'] = min(prices)

        return result

    def _extract_seller_info(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extract seller information from an item.

        Args:
            item: Item data from API response

        Returns:
            Seller information dictionary or None
        """
        try:
            seller_info = {}

            # Extract price
            if 'price' in item:
                if isinstance(item['price'], dict):
                    if 'price' in item['price']:
                        seller_info['price'] = float(item['price']['price'])
                    elif 'value' in item['price']:
                        seller_info['price'] = float(item['price']['value'])
                else:
                    seller_info['price'] = float(item['price'])

            # Extract seller name
            if 'sellerName' in item:
                seller_info['seller'] = item['sellerName']
            elif 'seller' in item:
                if isinstance(item['seller'], dict) and 'name' in item['seller']:
                    seller_info['seller'] = item['seller']['name']
                else:
                    seller_info['seller'] = str(item['seller'])

            # Extract rating
            if 'rating' in item:
                seller_info['rating'] = item['rating']

            # Extract delivery info
            if 'delivery' in item:
                seller_info['delivery'] = item['delivery']
            elif 'deliveryTime' in item:
                seller_info['delivery'] = item['deliveryTime']

            return seller_info if seller_info else None

        except Exception as e:
            logger.debug(f"Error extracting seller info: {e}")
            return None


if __name__ == "__main__":
    # Test the client
    import sys

    logging.basicConfig(level=logging.INFO)

    test_product_id = sys.argv[1] if len(sys.argv) > 1 else "1644052324"

    async def test():
        client = OzonCloudscraperClient()
        data = await client.get_competitor_data(test_product_id)

        if data:
            logger.info(f"\nCompetitor data for product {test_product_id}:")
            logger.info(json.dumps(data, indent=2, ensure_ascii=False))
        else:
            logger.warning("Failed to get competitor data")

    asyncio.run(test())