#!/usr/bin/env python3
"""
Ozon client using curl_cffi for perfect browser impersonation.
This library uses the actual curl with browser TLS fingerprints.
"""

import json
import logging
import asyncio
from typing import Dict, Any, Optional
from curl_cffi import requests
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)


class CurlCffiOzonClient:
    """Ozon client using curl_cffi for browser impersonation."""

    def __init__(self):
        """Initialize the curl_cffi client."""
        # Use Chrome 120 impersonation
        self.impersonate = "chrome120"

    def get_competitor_data_sync(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Get competitor data using curl_cffi.

        Args:
            product_id: Ozon product ID

        Returns:
            Dictionary with competitor data or None if failed
        """
        try:
            # Generate session ID and request IDs
            session_id = str(uuid.uuid4())
            request_id = str(uuid.uuid4())
            trace_id = str(uuid.uuid4())

            # Build URL
            base_url = "https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2"

            # Try different patterns
            patterns = [
                f"/modal/otherOffersFromSellers?product_id={product_id}&page_changed=true",
                f"/product/product-{product_id}/?layout_container=pdpPage2column&layout_page_index=2",
                f"/product/product-{product_id}/"
            ]

            for pattern in patterns:
                logger.info(f"Trying pattern: {pattern}")

                # Prepare headers
                headers = {
                    "Accept": "application/json",
                    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "Referer": f"https://www.ozon.ru/product/product-{product_id}/",
                    "Origin": "https://www.ozon.ru",

                    # Ozon specific headers
                    "X-O3-App-Name": "dweb_client",
                    "X-O3-App-Version": f"release_26-09-2025_latest",
                    "X-Request-Id": request_id,
                    "X-Trace-Id": trace_id,
                }

                # Prepare cookies
                cookies = {
                    "__Secure-access-token": "",
                    "__Secure-refresh-token": "",
                    "__Secure-user-id": "0",
                    "guest": "true",
                    "xcid": session_id.replace("-", ""),
                    "abt_data": "1.VE-fFihVtwp4kEJOhK79MQTnxJAK7FsG7h1pJ54pHwFVDCcsaVPyLyRPJQWp2eYJ",
                    "_ga": f"GA1.2.{int(datetime.now().timestamp())}.{int(datetime.now().timestamp())}",
                    "is_cookies_accepted": "1",
                }

                # Make request with curl_cffi
                response = requests.get(
                    base_url,
                    params={"url": pattern},
                    headers=headers,
                    cookies=cookies,
                    impersonate=self.impersonate,
                    timeout=30,
                    allow_redirects=True
                )

                logger.info(f"Status: {response.status_code}")

                if response.status_code == 200:
                    try:
                        data = response.json()
                        competitor_info = self._extract_competitor_info(data)

                        if competitor_info['competitor_count'] > 0:
                            logger.info(f"Found {competitor_info['competitor_count']} competitors")
                            return competitor_info
                        else:
                            logger.info("No competitors in response, trying next pattern")

                    except json.JSONDecodeError as e:
                        logger.error(f"JSON decode error: {e}")

                elif response.status_code == 403:
                    # Check response content
                    if 'antibot' in response.text.lower()[:1000]:
                        logger.warning("Antibot detected, trying next pattern")
                    else:
                        logger.warning("403 without antibot marker")

                elif response.status_code == 307:
                    logger.info("Got redirect, following...")

        except Exception as e:
            logger.error(f"Request error: {e}")

        return None

    async def get_competitor_data(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Async wrapper for get_competitor_data_sync.

        Args:
            product_id: Ozon product ID

        Returns:
            Dictionary with competitor data or None if failed
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.get_competitor_data_sync, product_id)

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

        if not data:
            return result

        # Check for widgetStates
        if 'widgetStates' in data:
            widget_states = data['widgetStates']

            for key, value in widget_states.items():
                # Skip non-string values
                if not isinstance(value, str):
                    continue

                # Try to parse as JSON
                try:
                    widget_data = json.loads(value)

                    # Look for seller/offer related widgets
                    key_lower = key.lower()
                    if any(word in key_lower for word in ['seller', 'offer', 'price', 'другие']):
                        logger.debug(f"Found potential widget: {key}")

                        # Extract count
                        for count_field in ['totalCount', 'sellersCount', 'offersCount', 'count']:
                            if count_field in widget_data:
                                result['competitor_count'] = widget_data[count_field]
                                logger.debug(f"Found count: {widget_data[count_field]}")
                                break

                        # Extract items
                        for items_field in ['items', 'offers', 'sellers', 'list']:
                            if items_field in widget_data and isinstance(widget_data[items_field], list):
                                for item in widget_data[items_field]:
                                    seller_info = self._extract_seller_info(item)
                                    if seller_info:
                                        result['sellers'].append(seller_info)

                        # Extract min price
                        for price_field in ['minPrice', 'minimumPrice', 'lowestPrice', 'min_price']:
                            if price_field in widget_data:
                                result['competitor_min_price'] = float(widget_data[price_field])
                                break

                except json.JSONDecodeError:
                    continue
                except Exception as e:
                    logger.debug(f"Error parsing widget {key}: {e}")

        # Check direct fields in response
        if 'sellers' in data:
            result['sellers'] = data['sellers']
            result['competitor_count'] = len(data['sellers'])

        # Calculate min price from sellers
        if not result['competitor_min_price'] and result['sellers']:
            prices = []
            for seller in result['sellers']:
                if 'price' in seller:
                    prices.append(float(seller['price']))
            if prices:
                result['competitor_min_price'] = min(prices)

        # Use seller count if no explicit count found
        if not result['competitor_count'] and result['sellers']:
            result['competitor_count'] = len(result['sellers'])

        return result

    def _extract_seller_info(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extract seller information from an item.

        Args:
            item: Item data from API response

        Returns:
            Seller information dictionary or None
        """
        if not isinstance(item, dict):
            return None

        seller_info = {}

        # Extract price
        if 'price' in item:
            if isinstance(item['price'], (int, float)):
                seller_info['price'] = float(item['price'])
            elif isinstance(item['price'], dict):
                # Handle nested price structure
                price_value = item['price'].get('value') or item['price'].get('price')
                if price_value:
                    seller_info['price'] = float(price_value)

        # Extract seller name
        seller_name = None
        if 'sellerName' in item:
            seller_name = item['sellerName']
        elif 'seller' in item:
            if isinstance(item['seller'], dict):
                seller_name = item['seller'].get('name')
            else:
                seller_name = str(item['seller'])
        elif 'merchantName' in item:
            seller_name = item['merchantName']

        if seller_name:
            seller_info['seller'] = seller_name

        # Extract other info
        if 'rating' in item:
            seller_info['rating'] = item['rating']

        if 'delivery' in item:
            seller_info['delivery'] = item['delivery']
        elif 'deliveryTime' in item:
            seller_info['delivery'] = item['deliveryTime']

        return seller_info if seller_info else None


if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    test_product_id = sys.argv[1] if len(sys.argv) > 1 else "1644052324"

    logger.info(f"\n{'='*60}")
    logger.info(f"Testing curl_cffi client for product {test_product_id}")
    logger.info(f"{'='*60}\n")

    client = CurlCffiOzonClient()
    result = client.get_competitor_data_sync(test_product_id)

    if result:
        logger.info(f"\n✅ SUCCESS! Found competitor data:")
        logger.info(f"  📊 Competitor count: {result['competitor_count']}")
        logger.info(f"  💰 Minimum price: ¥{result['competitor_min_price']:.2f}" if result['competitor_min_price'] else "  💰 Minimum price: N/A")
        logger.info(f"  👥 Sellers found: {len(result['sellers'])}")

        if result['sellers']:
            logger.info(f"\n  First 3 sellers:")
            for i, seller in enumerate(result['sellers'][:3], 1):
                price = seller.get('price', 'N/A')
                if price != 'N/A':
                    price = f"¥{price:.2f}"
                logger.info(f"    {i}. {seller.get('seller', 'Unknown')}: {price}")
    else:
        logger.info("\n❌ Failed to retrieve competitor data")
        logger.info("   The anti-bot protection is still blocking requests.")

    logger.info(f"\n{'='*60}")