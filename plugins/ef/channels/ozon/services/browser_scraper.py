#!/usr/bin/env python3
"""
Browser-based scraper for Ozon competitor data.
Uses Selenium to bypass anti-bot protection.
"""

import json
import logging
import time
from typing import Dict, Any, Optional
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException

logger = logging.getLogger(__name__)


class OzonBrowserScraper:
    """Browser-based scraper to get competitor data from Ozon."""
    
    def __init__(self, headless: bool = True):
        """Initialize the browser scraper.
        
        Args:
            headless: Whether to run browser in headless mode
        """
        self.headless = headless
        self.driver: Optional[webdriver.Chrome] = None
        
    def _setup_driver(self):
        """Setup Chrome driver with anti-detection options."""
        options = Options()
        
        # Anti-detection options
        options.add_argument('--disable-blink-features=AutomationControlled')
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option('useAutomationExtension', False)
        
        # Performance options
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-gpu')
        options.add_argument('--window-size=1920,1080')
        
        if self.headless:
            options.add_argument('--headless')
            
        # User agent
        options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
        
        self.driver = webdriver.Chrome(options=options)
        
        # Execute script to remove webdriver property
        self.driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
            'source': 'Object.defineProperty(navigator, "webdriver", {get: () => undefined})'
        })
        
    def get_competitor_data(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Get competitor data for a product using browser.
        
        Args:
            product_id: Ozon product ID
            
        Returns:
            Dictionary with competitor data or None if failed
        """
        try:
            if not self.driver:
                self._setup_driver()
                
            # Construct the API URL
            api_url = f'https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=/modal/otherOffersFromSellers?product_id={product_id}&page_changed=true'
            
            logger.info(f"Fetching competitor data for product {product_id}")
            
            # Navigate to the API endpoint
            self.driver.get(api_url)
            
            # Wait for the page to load
            time.sleep(2)
            
            # Try to get the JSON response
            try:
                # Check if we got JSON response
                pre_element = self.driver.find_element(By.TAG_NAME, 'pre')
                json_text = pre_element.text
                
                # Parse the JSON
                data = json.loads(json_text)
                
                # Extract competitor info from widgetStates
                competitor_info = self._extract_competitor_info(data)
                
                logger.info(f"Successfully extracted competitor data for product {product_id}")
                return competitor_info
                
            except Exception as e:
                logger.error(f"Failed to parse JSON response: {e}")
                
                # Check if we hit antibot
                if 'antibot' in self.driver.current_url.lower() or 'Antibot' in self.driver.page_source:
                    logger.warning("Detected antibot page, retrying with delay...")
                    time.sleep(5)
                    return None
                    
                return None
                
        except WebDriverException as e:
            logger.error(f"WebDriver error: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
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
                    
                    # Check for seller count
                    if 'totalCount' in widget_data:
                        result['competitor_count'] = widget_data['totalCount']
                        
                    # Check for seller list
                    if 'items' in widget_data and isinstance(widget_data['items'], list):
                        for item in widget_data['items']:
                            if 'price' in item:
                                seller_info = {
                                    'price': item.get('price'),
                                    'seller': item.get('sellerName', 'Unknown'),
                                    'rating': item.get('rating'),
                                    'delivery': item.get('deliveryTime')
                                }
                                result['sellers'].append(seller_info)
                                
                    # Check for minimum price
                    if 'minPrice' in widget_data:
                        result['competitor_min_price'] = widget_data['minPrice']
                        
                except json.JSONDecodeError:
                    continue
                except Exception as e:
                    logger.debug(f"Error parsing widget {key}: {e}")
                    
        # Calculate min price from sellers if not found
        if not result['competitor_min_price'] and result['sellers']:
            prices = [s['price'] for s in result['sellers'] if s.get('price')]
            if prices:
                result['competitor_min_price'] = min(prices)
                
        return result
        
    def close(self):
        """Close the browser driver."""
        if self.driver:
            self.driver.quit()
            self.driver = None
            
    def __del__(self):
        """Cleanup on destruction."""
        self.close()


if __name__ == "__main__":
    # Test the scraper
    import sys
    
    logging.basicConfig(level=logging.INFO)
    
    test_product_id = sys.argv[1] if len(sys.argv) > 1 else "1644052324"
    
    scraper = OzonBrowserScraper(headless=False)  # Run with visible browser for testing
    
    try:
        data = scraper.get_competitor_data(test_product_id)
        if data:
            logger.info(f"\nCompetitor data for product {test_product_id}:")
            logger.info(json.dumps(data, indent=2, ensure_ascii=False))
        else:
            logger.info("Failed to get competitor data")
    finally:
        scraper.close()