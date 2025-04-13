# Human Verification System

A comprehensive anti-scraping solution that uses natural human interaction patterns to distinguish between real users and bots.

## Overview

This project provides a robust solution for protecting websites from automated scraping by implementing a behavioral analysis system. Instead of using traditional CAPTCHAs or puzzles, this system verifies users through natural interactions like mouse movements, keyboard patterns, and touch gestures.

## Features

- **Advanced Behavior Analysis**: Uses mouse movements, keyboard typing rhythm, and touch gestures to verify human users
- **Bot Detection**: Identifies automated scripts, bots, and scrapers through behavioral and environmental fingerprinting
- **Non-intrusive Verification**: Works invisibly in the background without disrupting user experience
- **Privacy-Focused**: Collects only necessary data for verification without storing personal information
- **Flexible Integration**: Easy to integrate with existing websites and applications

## Tech Stack

- **Frontend**: JavaScript (Vanilla)
- **Backend**: Node.js with Express
- **Data Storage**: In-memory (can be extended to use databases)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/human-verification-system.git
cd human-verification-system
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
node server.js
```

The server will run at http://localhost:3000

## Usage

### Basic Integration

1. Include the anti-scraper.js script in your HTML:
```html
<script src="/anti-scraper.js"></script>
```

2. Initialize the HumanVerifier:
```javascript
const verifier = new HumanVerifier({
  verificationEndpoint: '/verify',
  challengeEndpoint: '/challenge',
  mouseSampleRate: 100,
  keyboardSampleRate: 50,
  maxEvents: 50
});
```

3. Create a session and attach event listeners:
```javascript
verifier.createSession()
  .then(response => {
    if (response.success) {
      verifier.attachListeners();
    }
  });
```

4. Verify when needed:
```javascript
verifier.verify()
  .then(result => {
    if (result.success) {
      // User is verified as human
      console.log('Human verified!');
    } else {
      // Failed verification
      console.log('Verification failed');
    }
  });
```

## How It Works

1. When a user visits the site, a verification session is created
2. The system collects natural user interactions like mouse movements, keyboard typing patterns, and touch events
3. Data is analyzed for human-like behavior patterns
4. Multiple factors are considered to determine if the visitor is human
5. Upon verification, the user can access protected content

## Project Structure

- `server.js` - Express server with verification logic
- `public/anti-scraper.js` - Client-side verification code
- `public/verification.html` - Example verification page
- `public/index.html` - Example protected content page

## Security Considerations

- Use HTTPS in production to protect verification data
- Implement rate limiting to prevent abuse
- Add CSRF protection for endpoints
- Set secure and SameSite cookies in production

## License

MIT

## Author

[Your Name] 