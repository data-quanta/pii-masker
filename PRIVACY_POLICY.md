# Privacy Policy for PII Masker

**Last Updated:** November 11, 2025

## Overview
PII Masker is a browser extension that detects and masks personally identifiable information (PII) in text before you send it to AI chatbots like ChatGPT, Claude, and others.

## Data Collection and Processing

### What We Process
- **Text Input:** The extension analyzes text you type in supported chat interfaces to detect PII (names, emails, phone numbers, addresses, SSN, credit cards, etc.)
- **Detection Results:** Temporarily stores detected PII patterns during your browsing session

### How We Process Data
- **100% Local Processing:** All PII detection happens entirely in your browser using local machine learning models
- **No Server Communication:** Your text is NEVER sent to our servers or any third-party services
- **No Cloud Storage:** We do not store, log, or transmit your data to any external location
- **In-Memory Only:** Detected PII is stored temporarily in browser memory and cleared when you close your browser

### Local Storage
The extension uses Chrome's local storage API (`chrome.storage.local`) to save:
- User preferences (extension enabled/disabled state)
- Temporary PII mappings during active browsing sessions
- These are stored locally on your device and never transmitted

## Third-Party Services

### Machine Learning Model
- The extension downloads a pre-trained BERT model (~110MB) from HuggingFace on first use
- This model runs entirely in your browser (via ONNX Runtime Web)
- The model is cached locally and does not communicate with external servers after download

### No Analytics or Tracking
- We do NOT collect usage analytics
- We do NOT track your browsing activity
- We do NOT use cookies or tracking pixels
- We do NOT share data with advertisers or third parties

## Permissions Explanation

The extension requires the following Chrome permissions:

- **`activeTab`**: To detect text input in the current tab's chat interface
- **`storage`**: To save your preferences and temporary PII mappings locally
- **`offscreen`**: To run the ML model in an isolated context for better performance
- **`scripting`**: To inject the PII detection interface into supported websites

## Data Security
- All processing occurs in isolated browser contexts
- No data is transmitted over the network (except for one-time model download)
- No user identification or authentication required

## Your Rights
- You can disable the extension at any time from Chrome's extension settings
- You can clear all stored data by removing the extension
- You control what text the extension processes (via preview modal before sending)

## Changes to Privacy Policy
We may update this privacy policy to reflect changes in our practices or for legal compliance. Updates will be posted with a new "Last Updated" date.

## Contact
For privacy concerns or questions:
- GitHub Issues: https://github.com/data-quanta/pii-masker/issues
- GitHub Repository: https://github.com/data-quanta/pii-masker

## Consent
By installing and using PII Masker, you agree to this privacy policy.

---

**Key Commitment:** Your privacy is our priority. We built this extension specifically to PROTECT your data, not collect it. Everything happens locally in your browser.
