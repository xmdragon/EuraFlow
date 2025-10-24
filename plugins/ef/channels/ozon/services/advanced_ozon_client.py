#!/usr/bin/env python3
"""
Advanced Ozon client with HTTP/2 and TLS fingerprint spoofing.
Uses tls-client library to bypass anti-bot detection.
"""

import json
import logging
import asyncio
from typing import Dict, Any, Optional, List
from decimal import Decimal
import tls_client
import httpx
from datetime import datetime
import uuid

logger = logging.getLogger(__name__)


class AdvancedOzonClient:
    """Advanced client for Ozon with anti-bot bypass capabilities."""

    def __init__(self):
        """Initialize the advanced client with TLS fingerprint spoofing."""
        # Create a session with Chrome 120 TLS fingerprint
        self.session = tls_client.Session(
            client_identifier="chrome_120",
            random_tls_extension_order=True
        )

        # Set up HTTP/2 client for async operations
        self.httpx_client = httpx.AsyncClient(
            http2=True,
            timeout=30.0,
            follow_redirects=True
        )

        # Session tracking
        self.session_id = str(uuid.uuid4())
        self.request_id = str(uuid.uuid4())

    def _get_browser_headers(self, referer: Optional[str] = None) -> Dict[str, str]:
        """Get complete browser headers with all necessary fields.

        Args:
            referer: Optional referer URL

        Returns:
            Dictionary of headers
        """
        headers = {
            # Standard browser headers
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",

            # HTTP/2 pseudo-headers (will be handled by the client)
            "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",

            # Ozon-specific headers
            "X-O3-App-Name": "dweb_client",
            "X-O3-App-Version": f"release_{datetime.now().strftime('%d-%m-%Y')}_latest",
            "X-O3-Page-Type": "product",
            "X-O3-Sample-Trace": "false",

            # Session tracking
            "X-Request-Id": str(uuid.uuid4()),
            "X-Trace-Id": str(uuid.uuid4()),
        }

        if referer:
            headers["Referer"] = referer
            headers["Origin"] = "https://www.ozon.ru"

        return headers

    def _generate_cookies(self, product_id: Optional[str] = None) -> str:
        """Generate realistic cookie string.

        Args:
            product_id: Optional product ID for specific cookies

        Returns:
            Cookie string
        """
        cookies = {
            # Session cookies
            "__Secure-access-token": "",  # Empty for anonymous access
            "__Secure-refresh-token": "",
            "__Secure-user-id": "0",

            # Tracking cookies
            "abt_data": "1.VE-fFihVtwp4kEJOhK79MQTnxJAK7FsG7h1pJ54pHwFVDCcsaVPyLyRPJQWp2eYJ",
            "xcid": str(uuid.uuid4()).replace("-", ""),

            # Analytics cookies
            "_ga": f"GA1.2.{int(datetime.now().timestamp())}.{int(datetime.now().timestamp())}",
            "_gid": f"GA1.2.{int(datetime.now().timestamp())}.{int(datetime.now().timestamp())}",
            "_ym_uid": str(int(datetime.now().timestamp())),
            "_ym_d": str(int(datetime.now().timestamp())),

            # Feature flags
            "is_cookies_accepted": "1",
            "guest": "true",

            # Anti-bot cookies
            "ADDRESSBOOKBAR_WEB": "1",
            "feedbacklds": "0",
        }

        # Add product view history if product_id provided
        if product_id:
            cookies["__Secure-product-view"] = product_id

        return "; ".join([f"{k}={v}" for k, v in cookies.items()])

    async def get_competitor_data(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Get competitor data for a product using advanced techniques.

        Args:
            product_id: Ozon product ID

        Returns:
            Dictionary with competitor data or None if failed
        """
        try:
            # First, try the sync tls_client approach
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self._get_competitor_data_sync,
                product_id
            )

            if result and result.get('competitor_count', 0) > 0:
                return result

            # If sync approach fails, try async HTTP/2 approach
            return await self._get_competitor_data_http2(product_id)

        except Exception as e:
            logger.error(f"Error getting competitor data for product {product_id}: {e}")
            return None

    def _get_competitor_data_sync(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Synchronous method using tls_client with TLS fingerprint spoofing.

        Args:
            product_id: Ozon product ID

        Returns:
            Dictionary with competitor data or None if failed
        """
        try:
            # Build the modal URL for other sellers
            url = "https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2"
            params = {
                "url": f"/modal/otherOffersFromSellers?product_id={product_id}&page_changed=true"
            }

            # Product page URL for referer
            product_url = f"https://www.ozon.ru/product/product-{product_id}/"

            # Set up headers
            headers = self._get_browser_headers(referer=product_url)

            # Set cookies - tls_client uses a different cookie format
            cookie_string = self._generate_cookies(product_id)
            headers["Cookie"] = cookie_string

            logger.info(f"Fetching competitor data for product {product_id} using TLS client")

            # Make the request
            response = self.session.get(url, params=params, headers=headers)

            if response.status_code == 200:
                try:
                    data = response.json()
                    competitor_info = self._extract_competitor_info(data)

                    if competitor_info['competitor_count'] > 0:
                        logger.info(f"Successfully got {competitor_info['competitor_count']} competitors for product {product_id}")
                        return competitor_info
                    else:
                        logger.info(f"No competitors found in response for product {product_id}")

                except json.JSONDecodeError:
                    logger.error(f"Failed to parse JSON response for product {product_id}")

            elif response.status_code == 403:
                logger.warning(f"Access forbidden (403) for product {product_id}")

                # Check if we got antibot page
                if 'antibot' in response.text.lower()[:1000]:
                    logger.warning("Detected antibot challenge page")

            else:
                logger.warning(f"Got status {response.status_code} for product {product_id}")

        except Exception as e:
            logger.error(f"Sync method error: {e}")

        return None

    async def _get_competitor_data_http2(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Async method using httpx with HTTP/2.

        Args:
            product_id: Ozon product ID

        Returns:
            Dictionary with competitor data or None if failed
        """
        try:
            # Try product page API endpoint
            url = "https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2"

            # Try different URL patterns
            url_patterns = [
                f"/modal/otherOffersFromSellers?product_id={product_id}&page_changed=true",
                f"/product/product-{product_id}/?layout_container=pdpPage2column&layout_page_index=2",
                f"/product/{product_id}/?sh=modal&modalId=otherOffersFromSellers",
            ]

            for pattern in url_patterns:
                params = {"url": pattern}
                product_url = f"https://www.ozon.ru/product/product-{product_id}/"

                headers = self._get_browser_headers(referer=product_url)
                headers["Cookie"] = self._generate_cookies(product_id)

                logger.info(f"Trying pattern: {pattern}")

                response = await self.httpx_client.get(url, params=params, headers=headers)

                if response.status_code == 200:
                    try:
                        data = response.json()
                        competitor_info = self._extract_competitor_info(data)

                        if competitor_info['competitor_count'] > 0:
                            logger.info(f"HTTP/2: Found {competitor_info['competitor_count']} competitors")
                            return competitor_info

                    except json.JSONDecodeError:
                        pass

        except Exception as e:
            logger.error(f"HTTP/2 method error: {e}")

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
            if isinstance(value, str):
                try:
                    widget_data = json.loads(value)

                    # Look for various possible fields
                    if any(k in widget_data for k in ['totalCount', 'sellersCount', 'offersCount']):
                        result['competitor_count'] = (
                            widget_data.get('totalCount', 0) or
                            widget_data.get('sellersCount', 0) or
                            widget_data.get('offersCount', 0)
                        )

                    # Extract sellers/offers
                    for field in ['items', 'offers', 'sellers']:
                        if field in widget_data and isinstance(widget_data[field], list):
                            for item in widget_data[field]:
                                seller_info = self._extract_seller_info(item)
                                if seller_info:
                                    result['sellers'].append(seller_info)

                    # Extract minimum price
                    for price_field in ['minPrice', 'minimumPrice', 'lowestPrice']:
                        if price_field in widget_data:
                            result['competitor_min_price'] = float(widget_data[price_field])
                            break

                except json.JSONDecodeError:
                    continue
                except Exception as e:
                    logger.debug(f"Error parsing widget {key}: {e}")

        # Calculate min price from sellers if not found
        if not result['competitor_min_price'] and result['sellers']:
            prices = [s['price'] for s in result['sellers'] if s.get('price')]
            if prices:
                result['competitor_min_price'] = min(prices)
                result['market_min_price'] = min(prices)

        # Use seller count if totalCount not found
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
        try:
            seller_info = {}

            # Extract price (handle nested structures)
            price = None
            if 'price' in item:
                if isinstance(item['price'], (int, float)):
                    price = float(item['price'])
                elif isinstance(item['price'], dict):
                    price = float(item['price'].get('value', 0) or item['price'].get('price', 0))

            if price:
                seller_info['price'] = price

            # Extract seller name
            seller_name = (
                item.get('sellerName') or
                item.get('seller', {}).get('name') if isinstance(item.get('seller'), dict) else None or
                item.get('merchantName') or
                'Unknown'
            )
            seller_info['seller'] = seller_name

            # Extract additional info
            if 'rating' in item:
                seller_info['rating'] = item['rating']

            if 'delivery' in item or 'deliveryTime' in item:
                seller_info['delivery'] = item.get('delivery') or item.get('deliveryTime')

            return seller_info if seller_info else None

        except Exception as e:
            logger.debug(f"Error extracting seller info: {e}")
            return None

    async def close(self):
        """Close the HTTP clients."""
        await self.httpx_client.aclose()


# Test function
if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)

    test_product_id = sys.argv[1] if len(sys.argv) > 1 else "1644052324"

    async def test():
        client = AdvancedOzonClient()

        try:
            logger.info(f"Testing advanced client for product {test_product_id}")
            data = await client.get_competitor_data(test_product_id)

            if data:
                logger.info(f"\n✓ Successfully retrieved competitor data:")
                logger.info(f"  Competitor count: {data['competitor_count']}")
                logger.info(f"  Minimum price: {data['competitor_min_price']}")
                logger.info(f"  Number of sellers found: {len(data['sellers'])}")

                if data['sellers']:
                    logger.info("\n  First 3 sellers:")
                    for seller in data['sellers'][:3]:
                        logger.info(f"    - {seller['seller']}: ¥{seller['price']}")
            else:
                logger.info("✗ Failed to get competitor data")

        finally:
            await client.close()

    asyncio.run(test())