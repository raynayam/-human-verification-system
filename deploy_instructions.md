# Deployment Instructions for Anti-Scraper Protection System

This guide provides detailed instructions on how to deploy the Anti-Scraper Protection System on your website or web application.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Server Deployment](#server-deployment)
3. [Frontend Integration](#frontend-integration)
4. [Configuration](#configuration)
5. [Testing](#testing)
6. [Monitoring](#monitoring)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have:

- Python 3.7 or higher
- A web server (Apache, Nginx, etc.)
- Access to modify your website's HTML
- Basic knowledge of your web stack

## Server Deployment

### Option 1: Standalone Server

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/anti-scraper-solution.git
   cd anti-scraper-solution
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure the server**:
   Edit `config.py` to match your requirements:
   ```python
   # Example: Adjust threshold scores
   config['threshold_score'] = 70  # Make detection more strict
   config['block_threshold'] = 80  # Block more aggressively
   ```

4. **Run with Gunicorn for production**:
   ```bash
   pip install gunicorn
   gunicorn -w 4 -b 0.0.0.0:5000 anti_scraper_solution:app
   ```

5. **Set up a reverse proxy** (example for Nginx):
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location /bot-protection/ {
           proxy_pass http://localhost:5000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

### Option 2: Integrated with Your Existing Flask App

1. **Install the package**:
   ```bash
   pip install anti-scraper-protection
   ```

2. **Import and initialize in your Flask app**:
   ```python
   from flask import Flask
   from anti_scraper_solution import setup_protection

   app = Flask(__name__)
   protection = setup_protection(app)
   ```

3. **Apply protection to routes**:
   ```python
   from anti_scraper_solution import check_protection_token

   @app.route('/protected-data')
   @check_protection_token()
   def protected_data():
       return "Protected content"
   ```

## Frontend Integration

### 1. Add the Protection Script

Add the following code to the `<head>` section of your HTML:

```html
<script src="https://your-domain.com/bot-protection.js"></script>
```

Alternatively, you can also use our CDN:

```html
<script src="https://cdn.antiscraper.example.com/protection.js"></script>
```

### 2. Verify Script Loading

Open your browser's developer tools and check the console to ensure the script is loading correctly. You should see no errors.

### 3. Add Protection to Forms

If you need to protect specific forms:

```html
<form action="/submit" method="post" data-protected="true">
    <!-- form fields -->
</form>
```

### 4. API Integration

For API endpoints, you'll need to pass the protection token:

```javascript
// Example API call with protection token
async function fetchProtectedData() {
    const token = localStorage.getItem('protection_token');
    
    const response = await fetch('/api/data', {
        headers: {
            'X-Protection-Token': token
        }
    });
    
    return response.json();
}
```

## Configuration

### Server-Side Configuration

The full configuration options are available in `config.py`:

```python
config = {
    # Detection thresholds
    'threshold_score': 60,  # Bot detection threshold (0-100)
    'block_threshold': 85,  # Complete blocking threshold
    
    # Token settings
    'token_validity': 1800,  # Token validity in seconds
    'fingerprint_validity': 86400,  # Fingerprint validity in seconds
    
    # Challenge settings
    'challenge_difficulty': 2,  # Challenge difficulty (1-3)
    
    # Detection methods
    'honeypot_fields': ['email_confirm', 'phone_alt', 'username_2'],
    'track_mouse': True,  # Track mouse movements
    'track_scroll': True,  # Track scroll behavior
    
    # Page protection
    'obfuscate_selectors': True,  # Randomize CSS selectors
    
    # Rate limiting
    'rate_limits': {
        'default': 60,     # Requests per minute
        'api': 120,        # API requests per minute
        'search': 30,      # Search requests per minute
    },
    
    # IP management
    'ip_whitelist': [],    # IPs to whitelist
    'ip_blacklist': [],    # IPs to block
}
```

### Client-Side Configuration

You can customize client-side behavior with data attributes:

```html
<html data-protection-level="high">
    <!-- "high" enables all protection features -->
</html>

<div data-protected="false">
    <!-- Content excluded from protection -->
</div>
```

## Testing

### Testing Bot Detection

1. **Manual Testing**:
   - Use a headless browser (`puppeteer`, `selenium`) to access your site
   - Monitor the admin dashboard to see if it's detected

2. **Automated Testing Script**:
   ```python
   import requests
   from selenium import webdriver
   
   # Test 1: Basic HTTP request (should be blocked)
   response = requests.get("https://your-site.com/protected-page")
   print(f"Basic HTTP: {response.status_code}")
   
   # Test 2: Selenium automation (should be detected)
   driver = webdriver.Chrome()
   driver.get("https://your-site.com/protected-page")
   print("Selenium: Page title:", driver.title)
   driver.quit()
   ```

### Verifying Legitimate User Access

Test with real browsers to ensure legitimate users aren't blocked:

1. Access your website from different browsers (Chrome, Firefox, Safari)
2. Test on different devices (desktop, mobile)
3. Test with different network conditions

## Monitoring

### Dashboard Access

Access the admin dashboard at:
```
https://your-domain.com/admin/bot-detections
```

### Metrics to Monitor

1. **Detection Rate**: Percentage of traffic identified as bots
2. **False Positive Rate**: Legitimate users incorrectly identified as bots
3. **Blocking Rate**: Percentage of traffic completely blocked
4. **Challenge Success Rate**: Percentage of users successfully completing challenges

### Setting up Alerts

Configure alerts for unusual activity:

```python
# Example: Email alert configuration
config['alerts'] = {
    'email': 'security@your-domain.com',
    'threshold': 50,  # Alert when bot traffic exceeds 50%
    'cooldown': 3600  # Don't send more than one alert per hour
}
```

## Troubleshooting

### Common Issues

1. **Legitimate Users Blocked**:
   - Lower the `threshold_score` in config
   - Check browser console for errors
   - Review logs for false positive patterns

2. **Bots Still Getting Through**:
   - Increase the `threshold_score`
   - Enable additional detection methods
   - Update the bot signature database

3. **Performance Issues**:
   - Consider using a CDN for the JavaScript file
   - Add caching for token validation
   - Scale horizontally by adding more servers

### Support

For additional help:
- Visit the GitHub issues page
- Email support at support@example.com
- Join our community Discord server 