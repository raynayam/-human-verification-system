/**
 * Anti-Scraper Server
 * Node.js implementation for human verification and anti-scraping protection
 */

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const cors = require('cors');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.static(path.join(__dirname, 'public')));

// Store sessions and verification results
const sessions = new Map();
const verificationResults = new Map();

// Helper function to create a session ID
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

// Create challenge/session endpoint
app.post('/challenge', (req, res) => {
  // Generate a new session ID
  const sessionId = generateSessionId();
  
  // Store session data
  sessions.set(sessionId, {
    createdAt: Date.now(),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    verified: false
  });
  
  // Set as cookie and return in response
  res.cookie('sessionId', sessionId, { 
    httpOnly: true, 
    maxAge: 30 * 60 * 1000, // 30 minutes
    sameSite: 'strict'
  });
  
  res.json({
    success: true,
    sessionId: sessionId
  });
});

// Verification endpoint that processes the client data
app.post('/verify', (req, res) => {
  // Get client data
  const clientData = req.body;
  
  // Get session from either request body or cookie
  const sessionId = clientData.sessionId || req.cookies.sessionId;
  
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired session'
    });
  }
  
  // Get session data
  const session = sessions.get(sessionId);
  
  // Analyze the client data for bot detection
  const analysisResult = analyzeClientData(clientData, session);
  
  // Update session verification status
  session.verified = analysisResult.humanProbability > 0.7;
  sessions.set(sessionId, session);
  
  // Store verification result
  verificationResults.set(sessionId, {
    timestamp: Date.now(),
    result: analysisResult,
    clientData: clientData
  });
  
  // Return result to client
  res.json({
    success: session.verified,
    sessionId: sessionId,
    message: session.verified ? 
      'Verification successful' : 
      'Verification failed. Please try again with natural browsing behavior.',
    score: analysisResult.humanProbability
  });
});

// Helper function to analyze client data for bot detection
function analyzeClientData(clientData, session) {
  // Default result structure
  const result = {
    humanProbability: 0,
    botIndicators: [],
    anomalies: []
  };
  
  // Check for minimum required interactions
  const eventSummary = clientData.eventSummary || {};
  const totalEvents = (eventSummary.mouseEvents || 0) + 
                      (eventSummary.keyboardEvents || 0) + 
                      (eventSummary.touchEvents || 0);
  
  if (totalEvents < 5) {
    result.botIndicators.push('insufficient_interaction');
    result.humanProbability = 0.1;
    return result;
  }
  
  // Initialize base probability
  let probability = 0.5;
  
  // Check for mouse movement stats
  if (clientData.mouseStats) {
    const mouseStats = clientData.mouseStats;
    
    // Natural mouse movements tend to have varied speeds and directions
    if (mouseStats.movementCount > 10) {
      probability += 0.1;
    }
    
    if (mouseStats.uniqueDirections > 4) {
      probability += 0.1;
    }
    
    // Check for unnaturally straight or uniform movements
    if (mouseStats.uniqueDirections < 3 && mouseStats.movementCount > 5) {
      result.anomalies.push('uniform_mouse_movement');
      probability -= 0.1;
    }
    
    // Check for realistic mouse speeds
    if (mouseStats.averageSpeed > 0.05 && mouseStats.averageSpeed < 2.0) {
      probability += 0.1;
    } else {
      result.anomalies.push('abnormal_mouse_speed');
      probability -= 0.1;
    }
  }
  
  // Check for keyboard behavior
  if (clientData.keyboardStats) {
    const keyboardStats = clientData.keyboardStats;
    
    // Natural typing has varied timing
    if (keyboardStats.keyPressCount > 5) {
      probability += 0.1;
    }
    
    // Analyze key hold times (humans typically hold keys between 50-200ms)
    if (keyboardStats.averageKeyHoldTime > 30 && keyboardStats.averageKeyHoldTime < 300) {
      probability += 0.1;
    } else if (keyboardStats.keyPressCount > 0) {
      result.anomalies.push('abnormal_key_hold_time');
      probability -= 0.1;
    }
    
    // Check for realistic intervals between keypresses
    if (keyboardStats.averageTimeBetweenKeys > 70 && keyboardStats.averageTimeBetweenKeys < 500) {
      probability += 0.1;
    } else if (keyboardStats.keyPressCount > 1) {
      result.anomalies.push('abnormal_typing_rhythm');
      probability -= 0.1;
    }
  }
  
  // Check touch interactions for mobile
  if (clientData.touchStats) {
    const touchStats = clientData.touchStats;
    
    if (touchStats.touchCount > 3) {
      probability += 0.1;
    }
    
    // Multi-touch is a strong human indicator
    if (touchStats.multiTouchUsed) {
      probability += 0.15;
    }
  }
  
  // Environment checks
  if (clientData.environment) {
    const env = clientData.environment;
    
    // Check if userAgent matches session data
    if (session.userAgent !== env.userAgent) {
      result.botIndicators.push('mismatched_user_agent');
      probability -= 0.2;
    }
    
    // Look for automation indicators
    if (clientData.features && clientData.features.automationDetected) {
      result.botIndicators.push('automation_detected');
      probability -= 0.3;
    }
    
    // Check for suspicious browser features
    if (!env.hasLocalStorage || !env.hasSessionStorage) {
      result.botIndicators.push('missing_storage_apis');
      probability -= 0.1;
    }
    
    // Check for reasonable timing
    const totalTime = clientData.totalInteractionTime || 0;
    if (totalTime < 1000 && totalEvents > 10) {
      result.botIndicators.push('suspiciously_fast_interaction');
      probability -= 0.2;
    }
  }
  
  // Apply WebGL fingerprint checks
  if (clientData.webgl && clientData.webgl.available) {
    // Most bots either don't support WebGL or use generic drivers
    probability += 0.05;
  }
  
  // Normalize probability between 0 and 1
  probability = Math.max(0, Math.min(1, probability));
  result.humanProbability = probability;
  
  return result;
}

// Simple status endpoint
app.get('/status', (req, res) => {
  const sessionId = req.cookies.sessionId;
  let verified = false;
  
  if (sessionId && sessions.has(sessionId)) {
    verified = sessions.get(sessionId).verified;
  }
  
  res.json({
    status: 'online',
    verified: verified
  });
});

// Route to verification page
app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verification.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app; 