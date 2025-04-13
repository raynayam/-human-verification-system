import requests
from bs4 import BeautifulSoup
import time
import random
import csv
import argparse
import json
import os
import re
import base64
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException, ElementClickInterceptedException
import pandas as pd
from fake_useragent import UserAgent

# Try to import undetected_chromedriver, but don't fail if it's not available
try:
    import undetected_chromedriver as uc
    UC_AVAILABLE = True
except ImportError:
    UC_AVAILABLE = False
    print("Warning: undetected_chromedriver not available. Install with 'pip install undetected-chromedriver'")
    print("Falling back to regular Selenium WebDriver.")

# Default selectors for TruePeopleSearch
TPS_SELECTORS = {
    "result_card": "card-summary",
    "name": "name",
    "age": "age",
    "address": "address",
    "next_button": "//a[contains(text(), 'Next')]",
    "captcha_iframe": "iframe[title='reCAPTCHA']",
    "cookie_accept": "cookieAcceptButton"
}

# Selectors for alternative sites
ALTERNATIVE_SELECTORS = {
    "fastpeoplesearch": {
        "result_card": "list-view-item",
        "name": "name",
        "age": "age",
        "address": "address primary",
        "next_button": "//a[contains(@rel, 'next')]",
        "captcha_iframe": "iframe[title='reCAPTCHA']",
        "cookie_accept": "gdpr-agree-btn"
    },
    "spokeo": {
        "result_card": "search-listing",
        "name": "name",
        "age": "age",
        "address": "address",
        "next_button": "//a[contains(@class, 'pagination-next')]",
        "captcha_iframe": "iframe[title='reCAPTCHA']",
        "cookie_accept": "consent-button"
    },
    "whitepages": {
        "result_card": "serp-card",
        "name": "name",
        "age": "age",
        "address": "address",
        "next_button": "//a[contains(@class, 'next-page')]",
        "captcha_iframe": "iframe[title='reCAPTCHA']",
        "cookie_accept": "onetrust-accept-btn-handler"
    }
}

class PeopleSearchScraper:
    def __init__(self, headless=True, selectors=None, proxy=None, wait_time=(2, 5), 
                 site="truepeoplesearch", captcha_api_key=None, use_undetected=False):
        """Initialize the scraper with browser options."""
        self.ua = UserAgent()
        self.site = site.lower()
        self.captcha_api_key = captcha_api_key
        self.use_undetected = use_undetected
        self.proxy = proxy
        self.headless = headless
        
        # Set default selectors based on site
        if self.site == "truepeoplesearch":
            default_selectors = TPS_SELECTORS
            self.base_url = "https://www.truepeoplesearch.com/results"
        elif self.site in ALTERNATIVE_SELECTORS:
            default_selectors = ALTERNATIVE_SELECTORS[self.site]
            if self.site == "fastpeoplesearch":
                self.base_url = "https://www.fastpeoplesearch.com/name"
            elif self.site == "spokeo":
                self.base_url = "https://www.spokeo.com/search"
            elif self.site == "whitepages":
                self.base_url = "https://www.whitepages.com/name"
        else:
            # Default to TruePeopleSearch if site not recognized
            default_selectors = TPS_SELECTORS
            self.base_url = "https://www.truepeoplesearch.com/results"
            
        # Set up browser options for regular mode
        self.options = Options()
        if headless:
            self.options.add_argument("--headless")
        self.options.add_argument("--no-sandbox")
        self.options.add_argument("--disable-dev-shm-usage")
        self.options.add_argument(f"user-agent={self.ua.random}")
        
        # Add SSL bypass arguments
        self.options.add_argument('--ignore-certificate-errors')
        self.options.add_argument('--ignore-ssl-errors')
            
        # Add proxy if provided
        if proxy:
            self.options.add_argument(f'--proxy-server={proxy}')
        
        self.driver = None
        self.results = []
        self.wait_time = wait_time  # Random wait time range (min, max) in seconds
        
        # Use custom selectors if provided, otherwise use defaults
        self.selectors = default_selectors.copy()
        if selectors:
            self.selectors.update(selectors)
            
        # Load name ethnicity data if available
        self.name_ethnicity_data = self._load_name_ethnicity_data()
            
    def _load_name_ethnicity_data(self):
        """Load name ethnicity data from a JSON file if available."""
        try:
            if os.path.exists("name_ethnicity_data.json"):
                with open("name_ethnicity_data.json", "r") as f:
                    return json.load(f)
        except Exception as e:
            print(f"Error loading name ethnicity data: {e}")
        return {}

    def start_browser(self):
        """Start the web browser with proper driver management."""
        try:
            # First try undetected_chromedriver if requested and available
            if self.use_undetected and UC_AVAILABLE:
                try:
                    options = uc.ChromeOptions()
                    
                    # Add proxy if provided
                    if self.proxy:
                        options.add_argument(f'--proxy-server={self.proxy}')
                    
                    # Add SSL certificate workarounds
                    options.add_argument('--ignore-certificate-errors')
                    options.add_argument('--ignore-ssl-errors')
                    
                    # Add user agent
                    options.add_argument(f"user-agent={self.ua.random}")
                    
                    # Create undetected Chrome instance
                    self.driver = uc.Chrome(options=options)
                    print("Started undetected browser")
                except Exception as e:
                    print(f"Failed to start undetected browser: {e}")
                    print("Falling back to regular WebDriver")
                    self.driver = None  # Ensure driver is None for the fallback
            
            # If undetected_chromedriver failed or wasn't requested, use regular WebDriver
            if self.driver is None:
                # Add these SSL workarounds if not already present
                if '--ignore-certificate-errors' not in str(self.options.arguments):
                    self.options.add_argument('--ignore-certificate-errors')
                if '--ignore-ssl-errors' not in str(self.options.arguments):
                    self.options.add_argument('--ignore-ssl-errors')
                
                service = Service(ChromeDriverManager().install())
                self.driver = webdriver.Chrome(service=service, options=self.options)
                print("Started regular browser")
                
            self.driver.implicitly_wait(10)
            print("Browser started successfully")
        except Exception as e:
            print(f"Error starting browser: {e}")
            raise
        
    def close_browser(self):
        """Close the web browser."""
        if self.driver:
            self.driver.quit()
            self.driver = None
            
    def search_by_location(self, state, city=None, age_min=65, language="Spanish"):
        """
        Search for people in a specific location with age and language filters.
        """
        if not self.driver:
            self.start_browser()
            
        # Format the search URL based on the selected site
        if self.site == "truepeoplesearch":
            if city:
                search_url = f"{self.base_url}?citystatezip={city}%2C+{state}"
            else:
                search_url = f"{self.base_url}?statecity={state}"
        elif self.site == "fastpeoplesearch":
            if city:
                search_url = f"{self.base_url}/{state}/{city}"
            else:
                search_url = f"{self.base_url}/{state}"
        elif self.site == "spokeo":
            if city:
                search_url = f"{self.base_url}?q={city}%2C+{state}"
            else:
                search_url = f"{self.base_url}?q={state}"
        elif self.site == "whitepages":
            if city:
                search_url = f"{self.base_url}/{state}/{city}"
            else:
                search_url = f"{self.base_url}/{state}"
        else:
            # Default format
            if city:
                search_url = f"{self.base_url}?location={city}%2C+{state}"
            else:
                search_url = f"{self.base_url}?location={state}"
            
        print(f"Searching: {search_url}")
        self.driver.get(search_url)
        
        # Handle potential CAPTCHA or cookie consent dialogs
        self._handle_popups()
        
        # Extract search results
        self._extract_search_results(age_min, language)
        
    def _random_wait(self):
        """Wait a random amount of time to avoid being detected as a bot."""
        wait_time = random.uniform(self.wait_time[0], self.wait_time[1])
        time.sleep(wait_time)
        
    def _handle_popups(self):
        """Handle any popups, CAPTCHA, or consent dialogs."""
        try:
            # Accept cookies button
            cookie_elements = self.driver.find_elements(By.ID, self.selectors["cookie_accept"])
            if cookie_elements and cookie_elements[0].is_displayed():
                cookie_elements[0].click()
                print("Accepted cookies")
        except (TimeoutException, NoSuchElementException):
            pass
            
        # Check for CAPTCHA
        self._handle_captcha()
            
    def _solve_captcha_with_service(self, site_key, page_url):
        """
        Solve CAPTCHA using a solving service like 2Captcha.
        Returns the solution token if successful.
        """
        if not self.captcha_api_key:
            print("No CAPTCHA API key provided")
            return None
            
        try:
            # This example uses 2Captcha API
            print("Submitting CAPTCHA to solving service...")
            
            # Submit the CAPTCHA
            captcha_submit_url = f"https://2captcha.com/in.php"
            data = {
                "key": self.captcha_api_key,
                "method": "userrecaptcha",
                "googlekey": site_key,
                "pageurl": page_url,
                "json": 1
            }
            
            response = requests.post(captcha_submit_url, data=data)
            response_data = response.json()
            
            if response_data["status"] == 1:
                # Request was successful
                captcha_id = response_data["request"]
                print(f"CAPTCHA submitted successfully. ID: {captcha_id}")
                
                # Wait for solution
                result_url = f"https://2captcha.com/res.php?key={self.captcha_api_key}&action=get&id={captcha_id}&json=1"
                max_attempts = 30
                for attempt in range(max_attempts):
                    time.sleep(5)  # Wait 5 seconds between checks
                    print(f"Checking CAPTCHA solution (attempt {attempt+1}/{max_attempts})...")
                    
                    response = requests.get(result_url)
                    result_data = response.json()
                    
                    if result_data["status"] == 1:
                        # CAPTCHA solved
                        solution = result_data["request"]
                        print("CAPTCHA solved successfully!")
                        return solution
                        
                    if "CAPCHA_NOT_READY" not in result_data["request"]:
                        # Error occurred
                        print(f"Error solving CAPTCHA: {result_data['request']}")
                        return None
                
                print("Timed out waiting for CAPTCHA solution")
                return None
            else:
                print(f"Error submitting CAPTCHA: {response_data['request']}")
                return None
                
        except Exception as e:
            print(f"Error in CAPTCHA solving service: {e}")
            return None
            
    def _handle_captcha(self):
        """
        Handle CAPTCHA challenges using a solving service if API key is provided,
        otherwise prompt the user to solve it manually.
        """
        try:
            # Check if CAPTCHA iframe exists
            captcha_iframe = self.driver.find_elements(By.CSS_SELECTOR, self.selectors["captcha_iframe"])
            
            if captcha_iframe:
                print("\n" + "=" * 50)
                print("CAPTCHA detected!")
                
                if self.captcha_api_key:
                    # Try to solve CAPTCHA automatically using service
                    try:
                        print("Attempting to solve CAPTCHA automatically...")
                        
                        # Get the reCAPTCHA site key
                        current_url = self.driver.current_url
                        site_key = None
                        
                        # Find the sitekey in the page source
                        page_source = self.driver.page_source
                        site_key_match = re.search(r'data-sitekey="([^"]+)"', page_source)
                        
                        if site_key_match:
                            site_key = site_key_match.group(1)
                            
                            # Solve the CAPTCHA
                            solution = self._solve_captcha_with_service(site_key, current_url)
                            
                            if solution:
                                # Execute JavaScript to set the g-recaptcha-response
                                self.driver.execute_script(f'document.getElementById("g-recaptcha-response").innerHTML="{solution}";')
                                
                                # Look for the submit button and click it
                                submit_button = self.driver.find_element(By.XPATH, "//button[@type='submit']")
                                submit_button.click()
                                
                                # Wait to see if we're redirected past the CAPTCHA
                                time.sleep(5)
                                
                                # Check if we're still on a CAPTCHA page
                                if not self.driver.find_elements(By.CSS_SELECTOR, self.selectors["captcha_iframe"]):
                                    print("CAPTCHA solved successfully!")
                                    return
                                else:
                                    print("Automatic CAPTCHA solution failed. Falling back to manual method.")
                        else:
                            print("Could not find reCAPTCHA site key. Falling back to manual method.")
                    except Exception as e:
                        print(f"Error during automatic CAPTCHA solving: {e}")
                        print("Falling back to manual method.")
                
                # Manual CAPTCHA solving
                print("Please solve the CAPTCHA manually.")
                print("The script will wait for 60 seconds.")
                print("=" * 50 + "\n")
                
                # Save screenshot to help solve CAPTCHA if in headless mode
                self.driver.save_screenshot("captcha.png")
                print("Screenshot saved as 'captcha.png'")
                
                # Wait for user to solve CAPTCHA manually
                time.sleep(60)
                print("Continuing after CAPTCHA wait...")
                
                # Check if we're still on a CAPTCHA page
                if self.driver.find_elements(By.CSS_SELECTOR, self.selectors["captcha_iframe"]):
                    print("CAPTCHA still not solved. Please run the script again and solve the CAPTCHA faster.")
                    raise Exception("CAPTCHA not solved in time")
                    
        except Exception as e:
            print(f"Error handling CAPTCHA: {e}")
            
    def _extract_search_results(self, age_min=65, language="Spanish"):
        """
        Extract search results from the page.
        """
        try:
            # Wait for results to load
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.CLASS_NAME, self.selectors["result_card"]))
            )
            
            # Get all result cards
            result_cards = self.driver.find_elements(By.CLASS_NAME, self.selectors["result_card"])
            
            print(f"Found {len(result_cards)} results on this page")
            
            for card in result_cards:
                try:
                    # Extract information from the result card
                    name = card.find_element(By.CLASS_NAME, self.selectors["name"]).text
                    
                    # Try to extract age - different sites format this differently
                    age = 0
                    try:
                        age_text = card.find_element(By.CLASS_NAME, self.selectors["age"]).text
                        
                        # Extract age from text using regex
                        age_match = re.search(r'\b(\d{2,3})\b', age_text)
                        if age_match:
                            age = int(age_match.group(1))
                        else:
                            # Try another pattern if the first one fails
                            age_match = re.search(r'Age:?\s*(\d{2,3})', age_text)
                            if age_match:
                                age = int(age_match.group(1))
                    except NoSuchElementException:
                        # If age isn't available, try to estimate from other data
                        print(f"Age not found for {name}, skipping...")
                        continue
                    
                    # Extract address
                    address = ""
                    try:
                        address = card.find_element(By.CLASS_NAME, self.selectors["address"]).text
                    except NoSuchElementException:
                        # Address might not be available
                        pass
                    
                    # Determine if the person likely speaks Spanish
                    speaks_spanish = self._check_if_speaks_spanish(name)
                    spanish_probability = speaks_spanish if isinstance(speaks_spanish, float) else (0.8 if speaks_spanish else 0.0)
                    
                    if age >= age_min and spanish_probability > 0.5:
                        person_info = {
                            'name': name,
                            'age': age,
                            'address': address,
                            'speaks_spanish_probability': spanish_probability,
                            'source': self.site
                        }
                        self.results.append(person_info)
                        print(f"Found: {name}, {age} years old, Spanish probability: {spanish_probability:.2f}")
                        
                except Exception as e:
                    print(f"Error extracting data from card: {e}")
                    
                # Random wait between processing cards to avoid detection
                time.sleep(random.uniform(0.5, 1.5))
                    
            # Check if there are more pages
            self._random_wait()  # Wait before attempting to go to next page
            self._check_next_page(age_min, language)
                
        except Exception as e:
            print(f"Error extracting search results: {e}")
            
    def _check_if_speaks_spanish(self, name):
        """
        Determine if a person likely speaks Spanish using multiple approaches.
        Returns a probability between 0 and 1.
        """
        try:
            # Clean and normalize the name
            name = name.lower().strip()
            name_parts = name.split()
            
            # Method a: Check against common Hispanic surnames
            hispanic_surnames = [
                "garcia", "rodriguez", "martinez", "hernandez", "lopez", 
                "gonzalez", "perez", "sanchez", "ramirez", "torres",
                "flores", "rivera", "gomez", "diaz", "reyes", "morales",
                "cruz", "ortiz", "gutierrez", "chavez", "ramos", "gonzales",
                "ruiz", "alvarez", "mendoza", "vasquez", "castillo", "jimenez",
                "moreno", "romero", "herrera", "medina", "aguilar", "vargas",
                "fernandez", "guzman", "munoz", "rojas", "soto", "contreras",
                "silva", "ortega", "delgado", "castro", "suarez", "pena",
                "rios", "alvarado", "sandoval", "maldonado", "carrillo",
                "mejia", "acosta", "vega", "fuentes", "dominguez", "cabrera",
                "campos", "valenzuela", "santiago", "miranda", "rosales", "guerra"
            ]
            
            surname_score = 0
            for surname in hispanic_surnames:
                if surname in name_parts:
                    surname_score = 0.7
                    break
            
            # Method b: Check our name ethnicity database if available
            ethnicity_score = 0
            if self.name_ethnicity_data:
                for part in name_parts:
                    if part in self.name_ethnicity_data:
                        if "hispanic" in self.name_ethnicity_data[part]:
                            ethnicity_score = max(ethnicity_score, self.name_ethnicity_data[part]["hispanic"])
            
            # Method c: Check for common Spanish first names if not already matched by surname
            if surname_score == 0:
                spanish_first_names = [
                    "jose", "juan", "miguel", "carlos", "rafael", "pedro", "manuel",
                    "francisco", "luis", "jorge", "ricardo", "ramon", "enrique", "jesus",
                    "maria", "ana", "carmen", "rosa", "graciela", "luz", "guadalupe",
                    "pilar", "elena", "teresa", "dolores", "sofia", "josefina", "gabriela"
                ]
                
                # Check if first name (usually first part of the name) is in our Spanish first names list
                if name_parts and name_parts[0] in spanish_first_names:
                    surname_score = 0.5
            
            # Combine the scores (prioritize ethnicity data if available)
            final_score = max(surname_score, ethnicity_score)
            
            return final_score
            
        except Exception as e:
            print(f"Error checking if person speaks Spanish: {e}")
            return 0
            
    def _check_next_page(self, age_min, language):
        """Check if there's a next page and navigate to it if so."""
        try:
            next_button = self.driver.find_elements(By.XPATH, self.selectors["next_button"])
            
            if next_button and next_button[0].is_displayed() and next_button[0].is_enabled():
                print("Moving to next page...")
                try:
                    next_button[0].click()
                    # Wait for page to load
                    self._random_wait()
                    # Extract results from the new page
                    self._extract_search_results(age_min, language)
                except ElementClickInterceptedException:
                    # If click is intercepted, try scrolling to the button
                    self.driver.execute_script("arguments[0].scrollIntoView(true);", next_button[0])
                    time.sleep(1)
                    next_button[0].click()
                    self._random_wait()
                    self._extract_search_results(age_min, language)
            else:
                print("No more pages available")
        except NoSuchElementException:
            # No more pages
            print("No more pages found")
        except Exception as e:
            print(f"Error navigating to next page: {e}")
            
    def save_results(self, filename="spanish_seniors.csv"):
        """Save results to a CSV file."""
        if not self.results:
            print("No results to save.")
            return
            
        df = pd.DataFrame(self.results)
        df.to_csv(filename, index=False)
        print(f"Saved {len(self.results)} results to {filename}")
        
def create_name_ethnicity_data():
    """
    Create a basic name ethnicity database.
    In a real implementation, you would use a more comprehensive database
    or API service for name ethnicity prediction.
    """
    data = {}
    
    # Just a sample of Hispanic surnames with confidence scores
    hispanic_surnames = {
        "garcia": 0.9, "rodriguez": 0.9, "martinez": 0.9, "hernandez": 0.9,
        "lopez": 0.85, "gonzalez": 0.9, "perez": 0.85, "sanchez": 0.9,
        "ramirez": 0.9, "torres": 0.85, "flores": 0.8, "rivera": 0.85,
        "gomez": 0.85, "diaz": 0.8, "reyes": 0.8, "morales": 0.8
    }
    
    for surname, confidence in hispanic_surnames.items():
        data[surname] = {"hispanic": confidence}
        
    # Save the data
    with open("name_ethnicity_data.json", "w") as f:
        json.dump(data, f)
        
    print("Created basic name ethnicity database")
    return data
        
def main():
    parser = argparse.ArgumentParser(description="Scrape people search websites for Spanish-speaking seniors")
    parser.add_argument("--state", required=True, help="State to search in (e.g., 'Florida')")
    parser.add_argument("--city", help="City to search in (optional)")
    parser.add_argument("--age", type=int, default=65, help="Minimum age (default: 65)")
    parser.add_argument("--output", default="spanish_seniors.csv", help="Output filename")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    parser.add_argument("--proxy", help="Proxy to use (e.g., '123.45.67.89:8080')")
    parser.add_argument("--config", help="Path to JSON configuration file for selectors")
    parser.add_argument("--wait-min", type=float, default=2.0, help="Minimum wait time between actions")
    parser.add_argument("--wait-max", type=float, default=5.0, help="Maximum wait time between actions")
    parser.add_argument("--site", default="truepeoplesearch", 
                        choices=["truepeoplesearch", "fastpeoplesearch", "spokeo", "whitepages"],
                        help="People search website to use")
    parser.add_argument("--captcha-api-key", help="API key for CAPTCHA solving service (e.g., 2Captcha)")
    parser.add_argument("--undetected", action="store_true", help="Use undetected_chromedriver to avoid detection")
    
    args = parser.parse_args()
    
    # Load custom selectors from config file if provided
    selectors = None
    if args.config:
        try:
            with open(args.config, 'r') as f:
                selectors = json.load(f)
        except Exception as e:
            print(f"Error loading config file: {e}")
            print("Using default selectors")
    
    # Create name ethnicity data if it doesn't exist
    if not os.path.exists("name_ethnicity_data.json"):
        create_name_ethnicity_data()
    
    scraper = PeopleSearchScraper(
        headless=args.headless,
        selectors=selectors,
        proxy=args.proxy,
        wait_time=(args.wait_min, args.wait_max),
        site=args.site,
        captcha_api_key=args.captcha_api_key,
        use_undetected=args.undetected
    )
    
    try:
        print(f"Starting search on {args.site}...")
        scraper.search_by_location(args.state, args.city, args.age)
        scraper.save_results(args.output)
        print(f"Search completed. Found {len(scraper.results)} matching records.")
    except KeyboardInterrupt:
        print("\nSearch interrupted by user.")
        if scraper.results:
            save_choice = input("Do you want to save the results collected so far? (y/n): ")
            if save_choice.lower() == 'y':
                scraper.save_results(args.output)
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        scraper.close_browser()
        
if __name__ == "__main__":
    main() 