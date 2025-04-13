const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const UAParser = require('ua-parser-js');
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const validator = require('validator');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// Set up logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'bot_detection.log' })
  ]
});

// Configuration settings
const config = {
  // Bot detection thresholds
  SCORE_THRESHOLD: 70,               // Score above which a request is considered a bot
  TOKEN_VALIDITY_MINUTES: 30,        // How long protection tokens are valid
  
  // Detection methods weights
  WEIGHTS: {
    USER_AGENT: 10,                  // Weight for user agent checks
    IP_REPUTATION: 15,               // Weight for IP reputation
    BROWSER_FEATURES: 20,            // Weight for browser feature checks
    MOUSE_MOVEMENTS: 15,             // Weight for mouse movement patterns
    KEYBOARD_PATTERNS: 10,           // Weight for keyboard interaction patterns
    TIME_ON_PAGE: 10,                // Weight for time spent on page
    FORM_INTERACTION: 10,            // Weight for form interaction patterns
    CHALLENGE_RESPONSE: 10           // Weight for challenge completion
  },
  
  // Honeypot fields
  HONEYPOT_FIELD_NAMES: ['website', 'email2', 'phone2', 'address2'],
  
  // Rate limiting
  RATE_LIMIT: {
    MAX_REQUESTS_PER_MINUTE: 60,     // Maximum requests allowed per minute per IP
    BLOCK_DURATION_MINUTES: 10       // How long to block IPs that exceed the rate limit
  },
  
  // Blacklists
  USER_AGENT_BLACKLIST: [
    'bot', 'crawl', 'spider', 'curl', 'wget', 'scrape', 'headless', 
    'python-requests', 'go-http-client', 'java', 'phantomjs', 'selenium'
  ],
  IP_BLACKLIST: [],                  // List of known bad IPs
  
  // Challenge difficulty
  CHALLENGE_DIFFICULTY: 'medium'     // Can be 'easy', 'medium', or 'hard'
};

// Bot detection scoring system
const botScoring = {
  suspiciousHeaders: 20,
  missingHeaders: 25,
  knownBotUA: 50,
  headlessBrowserUA: 40,
  inconsistentFingerprint: 35,
  rapidRequests: 30,
  abnormalBehavior: 45
};

// Client-side JavaScript for bot detection
const clientScript = `
(function() {
  // Client fingerprinting
  function generateFingerprint() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const screenProps = {
      width: window.screen.width,
      height: window.screen.height,
      pixelDepth: window.screen.pixelDepth,
      colorDepth: window.screen.colorDepth
    };
    
    const browserProps = {
      userAgent: navigator.userAgent,
      language: navigator.language,
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      timezone: new Date().getTimezoneOffset(),
      plugins: Array.from(navigator.plugins || []).map(p => p.name).join(',')
    };
    
    const fingerprint = JSON.stringify({...screenProps, ...browserProps});
    return btoa(fingerprint);
  }
  
  // Check cookie support
  function checkCookieSupport() {
    const testCookie = 'testCookie=true';
    document.cookie = testCookie;
    return document.cookie.indexOf(testCookie) !== -1;
  }
  
  // Track mouse movements and clicks
  let mouseMovements = 0;
  let mouseClicks = 0;
  
  document.addEventListener('mousemove', function() {
    mouseMovements++;
  });
  
  document.addEventListener('click', function(e) {
    mouseClicks++;
  });
  
  // Track keyboard activity
  let keyPresses = 0;
  let lastKeyTimes = [];
  
  document.addEventListener('keydown', function(e) {
    keyPresses++;
    lastKeyTimes.push(Date.now());
    
    // Keep only the last 10 key press times
    if (lastKeyTimes.length > 10) {
      lastKeyTimes.shift();
    }
  });
  
  // Calculate typing rhythm consistency
  function getTypingRhythmConsistency() {
    if (lastKeyTimes.length < 3) return 1; // Not enough data
    
    let intervals = [];
    for (let i = 1; i < lastKeyTimes.length; i++) {
      intervals.push(lastKeyTimes[i] - lastKeyTimes[i-1]);
    }
    
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;
    
    // Normalize to 0-1 range where 1 is very consistent (bot-like)
    return Math.min(1, 1 / (1 + Math.sqrt(variance) / 50));
  }
  
  // Track form interactions
  let formInteractions = {
    focuses: 0,
    changes: 0,
    completionTime: {}
  };
  
  document.addEventListener('DOMContentLoaded', function() {
    const inputs = document.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
      const startTime = {};
      
      input.addEventListener('focus', function() {
        formInteractions.focuses++;
        startTime[this.name] = Date.now();
      });
      
      input.addEventListener('blur', function() {
        if (startTime[this.name]) {
          formInteractions.completionTime[this.name] = Date.now() - startTime[this.name];
        }
      });
      
      input.addEventListener('change', function() {
        formInteractions.changes++;
      });
    });
  });
  
  // Challenge solving
  function solveChallenge(challenge) {
    try {
      // For math challenges
      if (challenge.type === 'math') {
        const result = eval(challenge.problem);
        return result.toString();
      }
      
      // For captcha or other types, the user would solve them manually
      return null;
    } catch(e) {
      return null;
    }
  }
  
  // Check WebGL capabilities
  function checkWebGL() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) return null;
      
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) return null;
      
      return {
        vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      };
    } catch (e) {
      return null;
    }
  }
  
  // Collect all data and send it to the server
  window.validateHuman = function() {
    const data = {
      fingerprint: generateFingerprint(),
      cookieSupport: checkCookieSupport(),
      mouseStats: {
        movements: mouseMovements,
        clicks: mouseClicks
      },
      keyboardStats: {
        keyPresses: keyPresses,
        typingRhythm: getTypingRhythmConsistency()
      },
      formStats: formInteractions,
      timeOnPage: (Date.now() - window.performance.timing.navigationStart) / 1000,
      webGL: checkWebGL(),
      screenSize: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      timezone: new Date().getTimezoneOffset(),
      challengeResponse: null  // Will be filled if a challenge is presented
    };
    
    fetch('/api/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(result => {
      if (result.status === 'challenge') {
        // Show challenge to user
        showChallenge(result.challenge);
      } else if (result.status === 'success') {
        // Store the token in a cookie
        document.cookie = "protection_token=" + result.token + "; path=/";
        
        // Redirect to the original destination
        if (result.redirect) {
          window.location.href = result.redirect;
        }
      } else {
        // Handle bot detection
        document.body.innerHTML = "<h1>Access Denied</h1><p>Automated access has been detected.</p>";
      }
    })
    .catch(error => {
      console.error('Verification error:', error);
    });
  };
  
  function showChallenge(challenge) {
    // Create a challenge UI for the user
    const container = document.createElement('div');
    container.style.padding = '20px';
    container.style.background = '#f5f5f5';
    container.style.border = '1px solid #ddd';
    container.style.borderRadius = '5px';
    container.style.margin = '20px auto';
    container.style.maxWidth = '400px';
    
    const title = document.createElement('h3');
    title.textContent = 'Complete the challenge to continue';
    container.appendChild(title);
    
    if (challenge.type === 'math') {
      const problem = document.createElement('p');
      problem.textContent = 'What is ' + challenge.problem + '?';
      container.appendChild(problem);
      
      const input = document.createElement('input');
      input.type = 'text';
      input.style.width = '100%';
      input.style.padding = '8px';
      input.style.margin = '10px 0';
      container.appendChild(input);
      
      const button = document.createElement('button');
      button.textContent = 'Submit';
      button.style.padding = '10px 15px';
      button.style.background = '#4CAF50';
      button.style.color = 'white';
      button.style.border = 'none';
      button.style.borderRadius = '4px';
      button.style.cursor = 'pointer';
      
      button.addEventListener('click', function() {
        const userAnswer = input.value.trim();
        submitChallengeResponse(challenge.id, userAnswer);
      });
      
      container.appendChild(button);
    }
    
    document.body.innerHTML = '';
    document.body.appendChild(container);
  }
  
  function submitChallengeResponse(challengeId, response) {
    fetch('/api/challenge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        challengeId: challengeId,
        response: response
      })
    })
    .then(response => response.json())
    .then(result => {
      if (result.status === 'success') {
        document.cookie = "protection_token=" + result.token + "; path=/";
        
        if (result.redirect) {
          window.location.href = result.redirect;
        }
      } else {
        // Failed the challenge
        showChallenge(result.challenge);
      }
    });
  }
  
  // Start verification process after a short delay
  setTimeout(function() {
    window.validateHuman();
  }, 1000);
})();
`;

// Protection page HTML template
const protectionPageTemplate = `
<!DOCTYPE html>
<html>
<head>
  <title>Verifying your browser</title>
  <style>
    body {
      font-family: 'Arial', sans-serif;
      text-align: center;
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background-color: #f5f5f7;
    }
    .container {
      max-width: 600px;
      padding: 40px;
      background: white;
      border-radius: 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-bottom: 20px;
    }
    p {
      color: #666;
      line-height: 1.6;
    }
    .spinner {
      margin: 30px auto;
      width: 50px;
      height: 50px;
      border: 5px solid #f3f3f3;
      border-top: 5px solid #3498db;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Verifying your browser</h1>
    <p>Please wait while we verify your browser. This process helps us prevent automated access and keep our site secure.</p>
    <div class="spinner"></div>
    <p id="redirect-message" class="hidden">Redirecting you to the site...</p>
  </div>
  <script>
    ${clientScript}
  </script>
</body>
</html>
`;

// Helper functions
function generateChallenge(difficulty) {
  const challenges = {
    'easy': () => {
      const a = Math.floor(Math.random() * 10);
      const b = Math.floor(Math.random() * 10);
      return {
        id: crypto.randomBytes(8).toString('hex'),
        type: 'math',
        problem: `${a} + ${b}`,
        answer: (a + b).toString(),
        expiry: Date.now() + (5 * 60 * 1000) // 5 minutes
      };
    },
    'medium': () => {
      const a = Math.floor(Math.random() * 20);
      const b = Math.floor(Math.random() * 20);
      const c = Math.floor(Math.random() * 10);
      return {
        id: crypto.randomBytes(8).toString('hex'),
        type: 'math',
        problem: `${a} + ${b} - ${c}`,
        answer: (a + b - c).toString(),
        expiry: Date.now() + (5 * 60 * 1000) // 5 minutes
      };
    },
    'hard': () => {
      const a = Math.floor(Math.random() * 20);
      const b = Math.floor(Math.random() * 20);
      const c = Math.floor(Math.random() * 10);
      const d = Math.floor(Math.random() * 10);
      return {
        id: crypto.randomBytes(8).toString('hex'),
        type: 'math',
        problem: `(${a} + ${b}) * ${c} - ${d}`,
        answer: ((a + b) * c - d).toString(),
        expiry: Date.now() + (5 * 60 * 1000) // 5 minutes
      };
    }
  };
  
  return challenges[difficulty || 'medium']();
}

function generateToken(userAgent, ip) {
  const secretKey = process.env.SECRET_KEY || 'your-secret-key-change-in-production';
  const data = `${userAgent}|${ip}|${new Date().toISOString().split('T')[0]}`;
  return crypto.createHmac('sha256', secretKey).update(data).digest('hex');
}

function verifyFingerprint(req) {
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const acceptEncoding = req.headers['accept-encoding'] || '';
  
  // Check for missing essential headers
  if (!userAgent || !acceptLanguage || !acceptEncoding) {
    return { valid: false, score: botScoring.missingHeaders, reason: 'Missing essential headers' };
  }
  
  // Parse user agent
  const parser = new UAParser(userAgent);
  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();
  
  // Check for known bot patterns
  const knownBotPatterns = ['bot', 'crawler', 'spider', 'headless', 'puppet'];
  if (knownBotPatterns.some(pattern => userAgent.toLowerCase().includes(pattern))) {
    return { valid: false, score: botScoring.knownBotUA, reason: 'Known bot user agent detected' };
  }
  
  // Check for headless browser signatures
  if ((browser.name === 'Chrome' && !userAgent.includes('Chrome')) || 
      (browser.name === 'Firefox' && !userAgent.includes('Firefox'))) {
    return { valid: false, score: botScoring.headlessBrowserUA, reason: 'Inconsistent browser signature' };
  }
  
  return { valid: true, score: 0, browser, os, device };
}

function calculateBotScore(clientData, req) {
  let score = 0;
  const parser = new UAParser(req.headers['user-agent']);
  const userAgent = parser.getResult();
  
  // Check user agent against blacklist
  const userAgentString = req.headers['user-agent'] || '';
  const hasBlacklistedUA = config.USER_AGENT_BLACKLIST.some(term => 
    userAgentString.toLowerCase().includes(term.toLowerCase())
  );
  
  if (hasBlacklistedUA) {
    score += config.WEIGHTS.USER_AGENT;
  }
  
  // Check mouse and keyboard activity (real users should have some)
  if (!clientData.mouseStats || clientData.mouseStats.movements < 5) {
    score += config.WEIGHTS.MOUSE_MOVEMENTS * 0.7;
  }
  
  if (!clientData.keyboardStats || clientData.keyboardStats.keyPresses < 1) {
    score += config.WEIGHTS.KEYBOARD_PATTERNS * 0.5;
  }
  
  // Check for very consistent typing rhythm (bot-like)
  if (clientData.keyboardStats && clientData.keyboardStats.typingRhythm > 0.9) {
    score += config.WEIGHTS.KEYBOARD_PATTERNS * 0.5;
  }
  
  // Check for very short time on page
  if (clientData.timeOnPage < 3) { // Less than 3 seconds
    score += config.WEIGHTS.TIME_ON_PAGE;
  }
  
  // Check if browser features are missing
  if (!clientData.webGL) {
    score += config.WEIGHTS.BROWSER_FEATURES * 0.7;
  }
  
  if (!clientData.cookieSupport) {
    score += config.WEIGHTS.BROWSER_FEATURES * 0.3;
  }
  
  return Math.min(100, score);
}

// Store active challenges
const activeChallengePairs = {};

// Middleware to check protection token
function checkProtectionToken(req, res, next) {
  // Extract protection token from cookies
  const token = req.cookies && req.cookies.protection_token;
  
  if (!token) {
    return res.redirect('/verify?redirect=' + encodeURIComponent(req.originalUrl));
  }
  
  try {
    const [data, signature] = token.split('.');
    const tokenData = verifyToken({ data, signature });
    
    if (!tokenData) {
      return res.redirect('/verify?redirect=' + encodeURIComponent(req.originalUrl));
    }
    
    if (tokenData.score > config.SCORE_THRESHOLD) {
      logger.info('Blocked high-score user', { score: tokenData.score, url: req.originalUrl, ip: req.ip });
      return res.status(403).send('Access denied');
    }
    
    // Add token data to request for further processing if needed
    req.tokenData = tokenData;
    next();
  } catch (e) {
    return res.redirect('/verify?redirect=' + encodeURIComponent(req.originalUrl));
  }
}

// Routes
app.get('/verify', (req, res) => {
  res.send(protectionPageTemplate);
});

app.post('/api/verify', (req, res) => {
  const clientData = req.body;
  const score = calculateBotScore(clientData, req);
  
  if (score > config.SCORE_THRESHOLD) {
    logger.info('Bot detected', { score, ip: req.ip, userAgent: req.headers['user-agent'] });
    
    // Generate challenge for suspicious traffic
    const challenge = generateChallenge(config.CHALLENGE_DIFFICULTY);
    activeChallengePairs[challenge.id] = challenge;
    
    return res.json({
      status: 'challenge',
      challenge: {
        id: challenge.id,
        type: challenge.type,
        problem: challenge.problem
      }
    });
  }
  
  // Generate token for legitimate traffic
  const token = generateToken(req.headers['user-agent'], req.ip);
  const tokenString = token.data + '.' + token.signature;
  
  res.cookie('verification_token', tokenString, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // secure in production
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });
  
  res.json({
    status: 'success',
    token: tokenString,
    redirect: req.query.redirect || '/'
  });
});

app.post('/api/challenge', (req, res) => {
  const { challengeId, response } = req.body;
  const challenge = activeChallengePairs[challengeId];
  
  if (!challenge) {
    return res.status(400).json({ status: 'error', message: 'Invalid challenge' });
  }
  
  if (challenge.expiry < Date.now()) {
    delete activeChallengePairs[challengeId];
    
    // Generate a new challenge
    const newChallenge = generateChallenge(config.CHALLENGE_DIFFICULTY);
    activeChallengePairs[newChallenge.id] = newChallenge;
    
    return res.json({
      status: 'challenge',
      challenge: {
        id: newChallenge.id,
        type: newChallenge.type,
        problem: newChallenge.problem
      },
      message: 'Challenge expired'
    });
  }
  
  if (response === challenge.answer) {
    // Generate a token with a lower score for users who passed the challenge
    const clientData = { fingerprint: crypto.randomBytes(16).toString('hex') };
    const token = generateToken(req.headers['user-agent'], req.ip);
    const tokenString = token.data + '.' + token.signature;
    
    delete activeChallengePairs[challengeId];
    
    return res.json({
      status: 'success',
      token: tokenString,
      redirect: req.query.redirect || '/'
    });
  } else {
    // Generate a new challenge
    const newChallenge = generateChallenge(config.CHALLENGE_DIFFICULTY);
    activeChallengePairs[newChallenge.id] = newChallenge;
    
    return res.json({
      status: 'challenge',
      challenge: {
        id: newChallenge.id,
        type: newChallenge.type,
        problem: newChallenge.problem
      },
      message: 'Incorrect answer'
    });
  }
});

// Protected route example
app.get('/protected', checkProtectionToken, (req, res) => {
  res.send('This is a protected route');
});

// Home page
app.get('/', (req, res) => {
  res.send(`
    <h1>JavaScript Anti-Scraper Solution</h1>
    <p>Welcome to the demo of the anti-scraper protection system.</p>
    <p><a href="/protected">Visit Protected Page</a></p>
  `);
});

// Start server
app.listen(port, () => {
  console.log(`Anti-scraper solution running at http://localhost:${port}`);
});

// Export the app and helper functions for use in other modules
module.exports = {
  app,
  checkProtectionToken,
  generateToken,
  verifyToken,
  calculateBotScore
}; 