import flask
from flask import Flask, request, jsonify, render_template_string, make_response
import re
import json
import time
import hashlib
import random
import string
import base64
import logging
import datetime
from functools import wraps
from user_agents import parse

# Initialize Flask app
app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Store detected bots
detected_bots = {}

# Configuration settings - customize these based on your needs
config = {
    'threshold_score': 60,  # Score threshold to consider a visitor a bot (0-100)
    'block_threshold': 85,  # Score threshold to block the request completely
    'token_validity': 1800,  # Token validity in seconds (30 minutes)
    'fingerprint_validity': 86400,  # Fingerprint validity in seconds (24 hours)
    'challenge_difficulty': 2,  # JavaScript challenge difficulty (1-3)
    'honeypot_fields': ['email_confirm', 'phone_alt', 'username_2'],  # Hidden form fields
    'rate_limits': {
        'default': 60,       # Requests per minute for regular users
        'api': 120,          # Requests per minute for API endpoints
        'search': 30,        # Requests per minute for search operations
        'high_value': 15     # Requests per minute for high-value content
    },
    'ip_whitelist': [],      # IPs to whitelist completely
    'ip_blacklist': [],      # IPs to block completely
    'user_agent_blacklist': [
        'PhantomJS', 'HeadlessChrome', 'Headless', 'Playwright', 
        'Selenium', 'webdriver', 'puppeteer', 'cypress', 'Scrapy', 
        'python-requests', 'Go-http-client', 'node-fetch'
    ],
    'suspicious_headers': [
        'X-Forwarded-For', 'Via', 'Forwarded', 'X-Real-IP', 
        'X-ProxyUser-Ip', 'CF-Connecting-IP'
    ],
    'track_mouse': True,     # Track mouse movements as bot detection signal
    'track_scroll': True,    # Track scroll behavior as bot detection signal
    'obfuscate_selectors': True,  # Randomize CSS selectors to break scrapers
}

# HTML/JS snippets - these will be included in your website
HTML_HEAD_SNIPPET = '''
<script>
(function() {
    const BOT_CHECK_ENDPOINT = "/bot-detection/check";
    const CHALLENGE_ENDPOINT = "/bot-detection/challenge";
    
    // Generate a browser fingerprint
    function generateFingerprint() {
        const components = [
            navigator.userAgent,
            navigator.language,
            screen.colorDepth,
            screen.width + 'x' + screen.height,
            new Date().getTimezoneOffset(),
            !!window.sessionStorage,
            !!window.localStorage,
            !!window.indexedDB,
            !!window.openDatabase,
            navigator.cpuClass || '',
            navigator.platform || '',
            navigator.doNotTrack || '',
            navigator.plugins ? navigator.plugins.length : 0,
            navigator.webdriver ? 'true' : 'false'
        ];
        return btoa(components.join('|||')).replace(/=/g, '');
    }
    
    // Check if cookies are enabled
    function areCookiesEnabled() {
        try {
            document.cookie = "cookietest=1; SameSite=Strict";
            const result = document.cookie.indexOf("cookietest=") !== -1;
            document.cookie = "cookietest=1; SameSite=Strict; expires=Thu, 01-Jan-1970 00:00:01 GMT";
            return result;
        } catch (e) {
            return false;
        }
    }
    
    // Check for browser automation tools
    function checkAutomationIndicators() {
        const automationIndicators = {
            webdriver: !!navigator.webdriver,
            selenium: !!window.document._selenium || !!window._SELENIUM_IDE_RECORDER,
            phantom: !!window.callPhantom || !!window._phantom,
            nightmare: !!window.__nightmare,
            domAutomation: !!window.domAutomation || !!window.domAutomationController,
            headless: !navigator.plugins.length && !navigator.mimeTypes.length
        };
        return automationIndicators;
    }
    
    // Track user interaction signals
    let mouseMovements = 0;
    let scrollEvents = 0;
    let keyPresses = 0;
    let lastActivityTime = Date.now();
    
    function trackUserActivity() {
        document.addEventListener('mousemove', () => { 
            mouseMovements++; 
            lastActivityTime = Date.now();
        });
        document.addEventListener('scroll', () => { 
            scrollEvents++; 
            lastActivityTime = Date.now();
        });
        document.addEventListener('keydown', () => { 
            keyPresses++; 
            lastActivityTime = Date.now();
        });
    }
    
    // Solve challenge for token
    function solveChallenge(challenge) {
        let result = "";
        try {
            // This is a simple challenge - the server will verify the solution
            const values = challenge.split('|');
            const operation = values[0];
            const a = parseInt(values[1]);
            const b = parseInt(values[2]);
            
            switch(operation) {
                case 'add': result = a + b; break;
                case 'sub': result = a - b; break;
                case 'mul': result = a * b; break;
                default: result = 0;
            }
        } catch(e) {
            result = "error";
        }
        return result.toString();
    }
    
    // Get a protection token
    async function getProtectionToken() {
        const fingerprint = generateFingerprint();
        
        // Collect browser information
        const browserInfo = {
            fingerprint: fingerprint,
            screen: {
                width: screen.width,
                height: screen.height,
                colorDepth: screen.colorDepth
            },
            timezone: new Date().getTimezoneOffset(),
            language: navigator.language,
            cookiesEnabled: areCookiesEnabled(),
            webGL: detectWebGL(),
            automationIndicators: checkAutomationIndicators(),
            userActivity: {
                mouseMovements: mouseMovements,
                scrollEvents: scrollEvents,
                keyPresses: keyPresses,
                timeSinceLastActivity: Date.now() - lastActivityTime
            }
        };
        
        try {
            // Request a challenge first
            const challengeResponse = await fetch(CHALLENGE_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    fingerprint: fingerprint
                })
            });
            
            const challengeData = await challengeResponse.json();
            
            // Solve the challenge
            const solution = solveChallenge(challengeData.challenge);
            
            // Send solution and browser info to get a token
            const response = await fetch(BOT_CHECK_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    challenge: challengeData.challenge,
                    solution: solution,
                    info: browserInfo
                })
            });
            
            const data = await response.json();
            
            // If we got a token, store it
            if (data.token) {
                localStorage.setItem('protection_token', data.token);
                localStorage.setItem('token_expiry', Date.now() + (30 * 60 * 1000)); // 30 minutes
                
                // Add token to all forms
                addTokenToForms(data.token);
                
                return data.token;
            } else {
                console.error("Failed to get protection token");
                return null;
            }
        } catch (error) {
            console.error("Error getting protection token:", error);
            return null;
        }
    }
    
    // Detect WebGL capabilities
    function detectWebGL() {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        
        if (!gl) {
            return { available: false };
        }
        
        return {
            available: true,
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER)
        };
    }
    
    // Add the token to all forms on the page
    function addTokenToForms(token) {
        const forms = document.querySelectorAll('form');
        forms.forEach(form => {
            let input = form.querySelector('input[name="protection_token"]');
            if (!input) {
                input = document.createElement('input');
                input.type = 'hidden';
                input.name = 'protection_token';
                form.appendChild(input);
            }
            input.value = token;
        });
    }
    
    // Add random delay to events to defeat timing analysis
    function randomDelay(callback) {
        const delay = Math.random() * 100;
        setTimeout(callback, delay);
    }
    
    // Initialize protection
    function initProtection() {
        // Start tracking user activity
        trackUserActivity();
        
        // Check if we have a valid token
        const token = localStorage.getItem('protection_token');
        const expiry = localStorage.getItem('token_expiry');
        
        if (!token || !expiry || parseInt(expiry) < Date.now()) {
            // Get a new token
            randomDelay(() => {
                getProtectionToken();
            });
        } else {
            // We have a valid token, add it to forms
            addTokenToForms(token);
        }
        
        // Add honeypot fields to forms
        addHoneypotFields();
        
        // Re-validate token periodically
        setInterval(() => {
            const tokenExpiry = localStorage.getItem('token_expiry');
            if (!tokenExpiry || parseInt(tokenExpiry) < Date.now()) {
                getProtectionToken();
            }
        }, 10 * 60 * 1000); // Check every 10 minutes
    }
    
    // Add honeypot fields to forms
    function addHoneypotFields() {
        const forms = document.querySelectorAll('form');
        const honeypotNames = ['email_confirm', 'phone_alt', 'username_2'];
        
        forms.forEach(form => {
            // Add one random honeypot field per form
            const fieldName = honeypotNames[Math.floor(Math.random() * honeypotNames.length)];
            
            let honeypot = form.querySelector(`input[name="${fieldName}"]`);
            if (!honeypot) {
                honeypot = document.createElement('input');
                honeypot.type = 'text';
                honeypot.name = fieldName;
                honeypot.autocomplete = 'off';
                
                // Hide it with CSS
                honeypot.style.position = 'absolute';
                honeypot.style.opacity = '0';
                honeypot.style.height = '0';
                honeypot.style.width = '0';
                honeypot.style.zIndex = '-1';
                honeypot.tabIndex = -1;
                
                form.appendChild(honeypot);
            }
        });
    }
    
    // Run on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initProtection);
    } else {
        initProtection();
    }
})();
</script>
'''

# Flask routes for the anti-scraper system
@app.route('/bot-detection/challenge', methods=['POST'])
def get_challenge():
    """Generate a challenge for the client to solve."""
    data = request.get_json()
    fingerprint = data.get('fingerprint', '')
    
    # Create a simple math challenge based on difficulty
    operations = ['add', 'sub', 'mul']
    operation = random.choice(operations)
    
    # Adjust number ranges based on difficulty
    difficulty = config['challenge_difficulty']
    if difficulty == 1:
        a = random.randint(1, 10)
        b = random.randint(1, 10)
    elif difficulty == 2:
        a = random.randint(10, 100)
        b = random.randint(10, 100)
    else:
        a = random.randint(100, 1000)
        b = random.randint(100, 1000)
    
    challenge = f"{operation}|{a}|{b}"
    
    # Store the expected solution
    if operation == 'add':
        solution = a + b
    elif operation == 'sub':
        solution = a - b
    else:  # mul
        solution = a * b
    
    # Create a challenge ID
    challenge_id = hashlib.md5(f"{fingerprint}:{time.time()}".encode()).hexdigest()
    
    # Store the challenge in a database or cache
    # For this example, we'll just use an in-memory dictionary
    # In production, use Redis or a database
    if not hasattr(app, 'challenges'):
        app.challenges = {}
    
    app.challenges[challenge_id] = {
        'challenge': challenge,
        'solution': solution,
        'created_at': time.time(),
        'fingerprint': fingerprint
    }
    
    return jsonify({
        'challenge': challenge,
        'id': challenge_id
    })

@app.route('/bot-detection/check', methods=['POST'])
def check_bot():
    """Check if the client is a bot based on the provided information."""
    data = request.get_json()
    
    # Extract data from the request
    challenge = data.get('challenge', '')
    solution = data.get('solution', '')
    info = data.get('info', {})
    
    # Calculate bot score
    score = calculate_bot_score(request, info, challenge, solution)
    
    # Generate a token if the score is below the threshold
    if score < config['threshold_score']:
        token = generate_token(info.get('fingerprint', ''))
        return jsonify({
            'token': token,
            'expires_in': config['token_validity']
        })
    else:
        # Log the bot detection
        log_bot_detection(request, score, info)
        
        # If score is above block threshold, return a fake token
        if score >= config['block_threshold']:
            fake_token = ''.join(random.choices(string.ascii_letters + string.digits, k=64))
            return jsonify({
                'token': fake_token,
                'expires_in': config['token_validity']
            })
        else:
            # Otherwise, return a real token but flag for monitoring
            token = generate_token(info.get('fingerprint', ''), is_suspicious=True)
            return jsonify({
                'token': token,
                'expires_in': config['token_validity']
            })

def calculate_bot_score(request, info, challenge, solution):
    """Calculate a score indicating how likely the client is a bot."""
    score = 0
    
    # 1. Check the solution to the challenge
    if not verify_challenge_solution(challenge, solution):
        score += 30
    
    # 2. Check browser automation indicators
    automation = info.get('automationIndicators', {})
    if automation.get('webdriver', False):
        score += 25
    if automation.get('selenium', False):
        score += 25
    if automation.get('phantom', False):
        score += 25
    if automation.get('nightmare', False):
        score += 25
    if automation.get('domAutomation', False):
        score += 25
    if automation.get('headless', False):
        score += 20
    
    # 3. Check user agent
    user_agent = request.headers.get('User-Agent', '')
    for blacklisted_ua in config['user_agent_blacklist']:
        if blacklisted_ua.lower() in user_agent.lower():
            score += 20
            break
    
    # Parse user agent for inconsistencies
    try:
        parsed_ua = parse(user_agent)
        
        # Check for inconsistent browser/OS combinations
        browser = parsed_ua.browser.family
        os = parsed_ua.os.family
        
        inconsistent_combos = [
            (browser == 'Chrome' and os == 'iOS'),  # Chrome doesn't exist on iOS
            (browser == 'Safari' and os == 'Windows'),  # Safari doesn't exist on Windows
            (browser == 'IE' and os == 'Android'),  # IE doesn't exist on Android
        ]
        
        if any(inconsistent_combos):
            score += 25
    except:
        # Error parsing user agent - suspicious
        score += 10
    
    # 4. Check IP reputation (in a real system, check against IP reputation databases)
    ip = request.remote_addr
    if ip in config['ip_blacklist']:
        score += 50
    
    # 5. Check suspicious headers
    for header in config['suspicious_headers']:
        if header in request.headers:
            score += 5
    
    # 6. Check for missing headers that normal browsers would have
    required_headers = ['Accept', 'Accept-Language', 'Accept-Encoding']
    for header in required_headers:
        if header not in request.headers:
            score += 10
    
    # 7. Check for cookies
    if not info.get('cookiesEnabled', True):
        score += 15
    
    # 8. Check user behavior if available
    user_activity = info.get('userActivity', {})
    if config['track_mouse'] and user_activity.get('mouseMovements', 0) < 3:
        score += 10
    
    if config['track_scroll'] and user_activity.get('scrollEvents', 0) < 1:
        score += 10
    
    if user_activity.get('keyPresses', 0) < 1:
        score += 5
    
    # 9. Check time between requests (requires server-side session tracking)
    # This would be implemented in a real system
    
    # Ensure the score is within bounds
    score = max(0, min(score, 100))
    
    return score

def verify_challenge_solution(challenge, solution):
    """Verify the solution to the provided challenge."""
    try:
        parts = challenge.split('|')
        operation = parts[0]
        a = int(parts[1])
        b = int(parts[2])
        
        expected_solution = 0
        if operation == 'add':
            expected_solution = a + b
        elif operation == 'sub':
            expected_solution = a - b
        elif operation == 'mul':
            expected_solution = a * b
        
        return str(expected_solution) == str(solution)
    except:
        return False

def generate_token(fingerprint, is_suspicious=False):
    """Generate a token for the client."""
    # Create a payload
    payload = {
        'fingerprint': fingerprint,
        'created_at': time.time(),
        'expires_at': time.time() + config['token_validity'],
        'is_suspicious': is_suspicious
    }
    
    # In production, you'd encrypt this token or use JWT
    # For this example, we'll just use base64 encoding
    token_str = json.dumps(payload)
    token = base64.b64encode(token_str.encode()).decode()
    
    # Store the token (in a real system, use Redis or a database)
    if not hasattr(app, 'tokens'):
        app.tokens = {}
        
    app.tokens[token] = payload
    
    return token

def log_bot_detection(request, score, info):
    """Log bot detection for analysis and improvement."""
    detection = {
        'timestamp': datetime.datetime.now().isoformat(),
        'ip': request.remote_addr,
        'user_agent': request.headers.get('User-Agent', ''),
        'score': score,
        'fingerprint': info.get('fingerprint', ''),
        'automation_indicators': info.get('automationIndicators', {}),
        'headers': dict(request.headers)
    }
    
    # In production, store this in a database
    # For this example, we'll just log it
    logger.warning(f"Bot detected: {detection}")
    
    # Track in memory for demonstration
    ip = request.remote_addr
    if ip not in detected_bots:
        detected_bots[ip] = []
    
    detected_bots[ip].append(detection)

def verify_protection_token(token):
    """Verify a protection token."""
    if not token:
        return False
    
    # In production, you'd decrypt the token or verify the JWT
    # For this example, we'll just decode the base64
    try:
        token_str = base64.b64decode(token.encode()).decode()
        payload = json.loads(token_str)
        
        # Check if the token is expired
        if payload.get('expires_at', 0) < time.time():
            return False
        
        # Verify the token in our store
        if not hasattr(app, 'tokens') or token not in app.tokens:
            return False
        
        # If the token is for a suspicious client, we may want to
        # add additional checks here
        
        return True
    except:
        return False

# Middleware to check protection token
def check_protection_token():
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Skip check for the bot detection endpoints
            if request.path.startswith('/bot-detection/'):
                return f(*args, **kwargs)
            
            # Get the token from the request
            token = None
            if request.method == 'GET':
                token = request.args.get('protection_token')
            elif request.method == 'POST':
                if request.content_type == 'application/json':
                    data = request.get_json(silent=True)
                    if data:
                        token = data.get('protection_token')
                else:
                    token = request.form.get('protection_token')
            
            # Also check for token in headers
            if not token:
                token = request.headers.get('X-Protection-Token')
            
            # Verify the token
            if verify_protection_token(token):
                return f(*args, **kwargs)
            
            # Token is invalid, redirect to protection page
            # In a real implementation, you might want to show a captcha or block the request
            return render_template_string(PROTECTION_PAGE)
        
        return decorated_function
    return decorator

# Example protection page with captcha
PROTECTION_PAGE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Site Protection</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            margin-top: 50px;
        }
        .container {
            max-width: 500px;
            margin: 0 auto;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 5px;
        }
        button {
            background-color: #4CAF50;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
        }
    </style>
    {{ bot_protection_script }}
</head>
<body>
    <div class="container">
        <h1>Please Wait</h1>
        <p>We're making sure you're a genuine visitor to our site.</p>
        <p>This should only take a moment...</p>
        <div id="captcha-container">
            <!-- Captcha will appear here if needed -->
        </div>
        <button onclick="window.location.reload()">Continue to Site</button>
    </div>
</body>
</html>
'''

# Example route protected by the token middleware
@app.route('/')
@check_protection_token()
def index():
    return "Protected content!"

# Route for monitoring bot detections (admin only)
@app.route('/admin/bot-detections', methods=['GET'])
def admin_bot_detections():
    # In a real app, authenticate admin access
    return jsonify(detected_bots)

# Integration instructions for website owners
INTEGRATION_INSTRUCTIONS = '''
# Anti-Scraper Protection System Integration Guide

## Overview
This system provides advanced protection against web scrapers, bots, and automated crawlers.

## Quick Integration
Add the following script tag to the head section of your HTML:

```html
<script src="https://your-domain.com/bot-protection.js"></script>
```

## Server-Side Integration
1. For each protected endpoint, add the @check_protection_token() decorator:

```python
@app.route('/your-protected-endpoint')
@check_protection_token()
def protected_endpoint():
    # Your code here
    return result
```

2. For API endpoints, verify the token:

```python
@app.route('/api/data', methods=['POST'])
def api_endpoint():
    # Get token from request
    token = request.headers.get('X-Protection-Token')
    
    # Verify token
    if not verify_protection_token(token):
        return jsonify({'error': 'Invalid protection token'}), 403
    
    # Continue with normal processing
    return jsonify({'data': 'your data'})
```

## Advanced Configuration
You can customize the bot detection system by modifying the configuration:

```python
config = {
    'threshold_score': 60,  # Score threshold to consider a visitor a bot
    'block_threshold': 85,  # Score threshold to block completely
    # ... other options
}
```

## Monitoring
Access the admin dashboard at /admin/bot-detections to see detected bots and scraping attempts.
'''

@app.route('/bot-protection.js')
def bot_protection_js():
    """Serve the bot protection JavaScript."""
    response = make_response(HTML_HEAD_SNIPPET)
    response.headers['Content-Type'] = 'application/javascript'
    return response

# Dynamic CSS to defeat scrapers by randomizing selectors
@app.route('/dynamic-css')
def dynamic_css():
    """Generate dynamic CSS with random selectors to break scrapers."""
    random_class_suffix = ''.join(random.choices(string.ascii_lowercase, k=8))
    
    css = f'''
    .product-{random_class_suffix} {{ display: flex; flex-direction: column; }}
    .price-{random_class_suffix} {{ font-weight: bold; color: #c00; }}
    .name-{random_class_suffix} {{ font-size: 18px; }}
    .rating-{random_class_suffix} {{ display: inline-block; }}
    '''
    
    response = make_response(css)
    response.headers['Content-Type'] = 'text/css'
    return response

# Helper route for integration instructions
@app.route('/integration-guide')
def integration_guide():
    return INTEGRATION_INSTRUCTIONS

if __name__ == '__main__':
    app.run(debug=True) 