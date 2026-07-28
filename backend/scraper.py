import asyncio
import json
import logging
import sys
import time
import traceback
from typing import List, Dict, Any, Callable, Optional
from playwright.async_api import async_playwright

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ScraperX")

class ScrapeLogger:
    def __init__(self, log_callback: Optional[Callable[[str], None]] = None):
        self.log_callback = log_callback

    def log(self, message: str):
        logger.info(message)
        if self.log_callback:
            try:
                # If callback is a coroutine, we schedule it or run it
                if asyncio.iscoroutinefunction(self.log_callback):
                    asyncio.create_task(self.log_callback(message))
                else:
                    self.log_callback(message)
            except Exception as e:
                logger.error(f"Error in log callback: {e}")

async def run_scraper(
    job_config: Dict[str, Any],
    log_callback: Callable[[str], None],
    status_callback: Callable[[str], None],
    preview: bool = False
) -> List[Dict[str, Any]]:
    
    scrape_logger = ScrapeLogger(log_callback)
    scrape_logger.log("Starting scraping process...")
    status_callback("running")
    
    # Extract config parameters
    job_id = job_config.get("id")
    job_name = job_config.get("name", "Unnamed Job")
    target_url = job_config.get("url", "")
    fields = job_config.get("fields", [])
    
    # Scraping configurations
    delay = float(job_config.get("delay", 0)) / 1000.0  # ms to s
    timeout = float(job_config.get("timeout", 30000))  # ms
    max_pages = 1 if preview else int(job_config.get("max_pages", 5))
    wait_condition = job_config.get("wait_condition", "domcontentloaded")
    user_agent = job_config.get("user_agent", "")
    custom_headers = job_config.get("headers", {})
    
    # Pagination configurations
    pagination_type = job_config.get("pagination_type", "none")  # none, next_button, url_pattern, infinite_scroll
    next_button_selector = job_config.get("next_button_selector", "")
    url_pattern = job_config.get("url_pattern", "")
    
    scraped_data = []
    
    # Helper to check memory usage limit (500 MB)
    def check_memory_limit(data_list) -> bool:
        serialized_size = len(json.dumps(data_list).encode('utf-8'))
        return serialized_size > 500 * 1024 * 1024  # 500 MB in bytes

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        # Setup context with custom User-Agent and headers
        context_args = {}
        if user_agent:
            context_args["user_agent"] = user_agent
        if custom_headers:
            context_args["extra_http_headers"] = custom_headers
            
        context = await browser.new_context(**context_args)
        page = await context.new_page()
        page.set_default_timeout(timeout)
        
        current_page_num = 1
        
        # Target Site Authentication (Optional)
        login_url = job_config.get("login_url", "")
        login_username_selector = job_config.get("login_username_selector", "")
        login_username_value = job_config.get("login_username_value", "")
        login_password_selector = job_config.get("login_password_selector", "")
        login_password_value = job_config.get("login_password_value", "")
        login_submit_selector = job_config.get("login_submit_selector", "")
        
        try:
            if login_url and login_username_selector and login_password_selector and login_submit_selector:
                scrape_logger.log(f"Target site requires authentication. Navigating to login URL: {login_url}")
                await page.goto(login_url, wait_until="domcontentloaded")
                await page.fill(login_username_selector, login_username_value)
                await page.fill(login_password_selector, login_password_value)
                scrape_logger.log("Form credentials filled. Clicking login submit button...")
                await page.click(login_submit_selector)
                try:
                    await page.wait_for_load_state("networkidle", timeout=10000)
                except Exception:
                    scrape_logger.log("Timeout waiting for network idle after login submit. Proceeding...")
                scrape_logger.log("Login sequence executed successfully.")

            while current_page_num <= max_pages:
                scrape_logger.log(f"Scraping page {current_page_num}...")
                
                # Determine URL to open
                if pagination_type == "url_pattern" and current_page_num > 1:
                    if "{page}" in url_pattern:
                        current_url = url_pattern.replace("{page}", str(current_page_num))
                    else:
                        current_url = f"{url_pattern}{current_page_num}"
                else:
                    current_url = target_url
                
                # Navigate if on first page or using URL Pattern
                if current_page_num == 1 or pagination_type == "url_pattern":
                    scrape_logger.log(f"Navigating to URL: {current_url}")
                    # Map wait conditions
                    wait_until_map = {
                        "networkidle": "networkidle",
                        "domcontentloaded": "domcontentloaded",
                        "load": "load"
                    }
                    playwright_wait = wait_until_map.get(wait_condition, "domcontentloaded")
                    await page.goto(current_url, wait_until=playwright_wait)
                
                # Wait for any selector check if specified in wait_condition
                if wait_condition == "selector_visible" and fields:
                    first_selector = fields[0].get("selector", "")
                    selector_type = fields[0].get("selector_type", "css")
                    if first_selector:
                        try:
                            locator_str = f"xpath={first_selector}" if selector_type == "xpath" else first_selector
                            await page.wait_for_selector(locator_str, state="visible", timeout=10000)
                        except Exception:
                            scrape_logger.log(f"Warning: Selector '{first_selector}' not visible yet.")

                # If delay is set, sleep
                if delay > 0:
                    await asyncio.sleep(delay)
                
                # Scroll handling for Infinite Scroll
                if pagination_type == "infinite_scroll" and current_page_num > 1:
                    scrape_logger.log("Performing page scroll down...")
                    last_height = await page.evaluate("document.body.scrollHeight")
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await asyncio.sleep(2.0)  # Wait for scroll load
                    new_height = await page.evaluate("document.body.scrollHeight")
                    if new_height == last_height:
                        scrape_logger.log("Reached bottom of infinite scroll, stopping.")
                        break
                
                # Extract page data
                page_items = await extract_fields_from_page(page, fields, scrape_logger)
                scrape_logger.log(f"Extracted {len(page_items)} rows from page {current_page_num}.")
                
                # Add metadata to each item if needed
                for item in page_items:
                    scraped_data.append(item)
                
                # Check memory limit
                if check_memory_limit(scraped_data):
                    scrape_logger.log("Warning: In-memory data size limit of 500 MB exceeded. Stopping.")
                    break
                
                if preview:
                    break
                
                # Pagination: Next Button Click
                if pagination_type == "next_button":
                    # Check if next button exists and is visible
                    has_next = False
                    try:
                        next_btn = page.locator(next_button_selector)
                        if await next_btn.count() > 0 and await next_btn.is_visible():
                            has_next = True
                    except Exception as e:
                        scrape_logger.log(f"Error checking Next Button selector: {e}")
                        
                    if has_next:
                        scrape_logger.log(f"Clicking next page button: {next_button_selector}")
                        await next_btn.click()
                        # Wait for load condition
                        try:
                            if wait_condition == "networkidle":
                                await page.wait_for_load_state("networkidle", timeout=timeout)
                            elif wait_condition == "load":
                                await page.wait_for_load_state("load", timeout=timeout)
                            else:
                                await page.wait_for_load_state("domcontentloaded", timeout=timeout)
                        except Exception as e:
                            scrape_logger.log(f"Timeout/Error waiting after next click: {e}")
                    else:
                        scrape_logger.log("Next button not found or not visible. Pagination finished.")
                        break
                
                current_page_num += 1

            status_callback("done")
            scrape_logger.log(f"Scraping completed successfully. Total items scraped: {len(scraped_data)}.")
            return scraped_data

        except Exception as e:
            tb = traceback.format_exc()
            scrape_logger.log(f"Critical error during scraping: {e}\n{tb}")
            status_callback("error")
            raise e
        finally:
            await browser.close()

async def extract_fields_from_page(page, fields: List[Dict[str, Any]], scrape_logger: ScrapeLogger) -> List[Dict[str, Any]]:
    # In order to align fields correctly, we identify which fields are lists and which are single values.
    # If a field is flagged as `is_list=True`, it extracts multiple items.
    # If all items are lists, we zip them together.
    # If some are list and some are single, we zip lists and repeat the single value for all zipped items.
    
    extracted = {}
    max_len = 1
    
    for f in fields:
        name = f.get("name", "field")
        selector = f.get("selector", "")
        sel_type = f.get("selector_type", "css")
        extract_target = f.get("extract_target", "text")
        attribute_name = f.get("attribute_name", "")
        is_list = f.get("is_list", False)
        
        if not selector:
            continue
            
        try:
            # Construct locator
            if sel_type == "xpath":
                locator = page.locator(f"xpath={selector}")
            else:
                locator = page.locator(selector)
                
            count = await locator.count()
            
            if is_list:
                values = []
                for i in range(count):
                    element = locator.nth(i)
                    if extract_target == "attribute" and attribute_name:
                        val = await element.get_attribute(attribute_name)
                    else:
                        val = await element.text_content()
                    values.append(val.strip() if val else "")
                extracted[name] = values
                max_len = max(max_len, len(values))
            else:
                if count > 0:
                    element = locator.first
                    if extract_target == "attribute" and attribute_name:
                        val = await element.get_attribute(attribute_name)
                    else:
                        val = await element.text_content()
                    extracted[name] = val.strip() if val else ""
                else:
                    extracted[name] = ""
        except Exception as e:
            scrape_logger.log(f"Error extracting field '{name}' with selector '{selector}': {e}")
            extracted[name] = [] if is_list else ""
            
    # Align rows
    rows = []
    for index in range(max_len):
        row = {}
        for f in fields:
            name = f.get("name", "field")
            val = extracted.get(name, "")
            if isinstance(val, list):
                if index < len(val):
                    row[name] = val[index]
                else:
                    row[name] = ""
            else:
                row[name] = val
        rows.append(row)
        
    return rows
