# PII Masker - Chrome Extension

**Privacy-First Protection for Large Language Model Users**

A Chrome extension that detects and masks Personally Identifiable Information (PII) before you send messages to ChatGPT and other LLMs. **All processing happens locally in your browser - your data never leaves your machine.**

## Key Features

### Privacy & Security
- **100% Local Processing** - Zero external API calls. All detection and masking happens entirely in your browser
- **No Data Collection** - We don't collect, store, or transmit any of your data
- **No Network Requests** - Extension works completely offline after initial model download
- **Open Source** - Full code transparency for security auditing

### Detection Capabilities
- **AI-Powered Detection** - Uses machine learning (BERT) to detect names, organizations, and locations
- **Pattern Matching** - Detects emails, phone numbers, SSNs, credit cards, and more
- **Preview Before Sending** - Review what will be masked before submission
- **Universal Support** - Works on any website including ChatGPT, Claude, and others
- **Fast Performance** - Regex detection in under 10ms, ML detection in 100-300ms

## Quick Start

### Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked" and select the extension folder
5. Pin the extension to your toolbar for easy access

### Usage

1. Click the extension icon to enable it
2. (Optional) Enable "ML Detection (Beta)" for contextual PII detection
   - Note: First-time download is approximately 110MB (cached for future use)
3. Type your message on any website
4. Press Enter to submit
5. If PII is detected, a preview modal will appear
6. Choose your action: **Send Masked** | **Send Original** | **Cancel**

### Example

**Original Text:**
```
Hi, I'm Jennifer Anderson from Microsoft Corporation in Seattle.
Contact me at jennifer.anderson@microsoft.com or (206) 555-9876.
```

**Masked Text:**
```
Hi, I'm [REDACTED_NAME] [REDACTED_NAME] from [REDACTED_ORGANIZATION] [REDACTED_ORGANIZATION] in [REDACTED_LOCATION].
Contact me at [REDACTED_EMAIL] or [REDACTED_PHONE].
```

## Detection Coverage

### With ML Detection Enabled (Recommended)

**Contextual PII (ML-detected):**
- Names - "Jennifer Anderson", "Dr. Smith"
- Organizations - "Microsoft", "Harvard University"
- Locations - "Seattle", "123 Main Street"

**Structured PII (Regex-detected):**
- Email addresses
- Phone numbers
- Social Security Numbers
- Credit card numbers
- IP addresses (IPv4)
- Dates of birth
- Medical record numbers
- Vehicle Identification Numbers (VINs)
- ZIP codes

### Without ML Detection (Regex Only)

- All structured data listed above
- Names, organizations, and locations are NOT detected without ML

## Privacy Guarantee

**Your data never leaves your device. Here's our commitment:**

1. **No External Servers** - All processing runs in your browser using WebAssembly
2. **No Analytics** - We don't track usage, crashes, or any user behavior
3. **No Telemetry** - No data is sent to us or any third party
4. **Minimal Permissions** - Only requests necessary browser permissions:
   - `storage` - Save your extension settings locally
   - `activeTab` - Interact with the current webpage
   - `offscreen` - Run ML model in isolated context
   - `<all_urls>` - Work on any website you choose

5. **Offline Capable** - After initial ML model download, works completely offline
6. **Open Source** - Full source code available for security audit

## Technical Architecture

### How It Works

```
Web Page → Content Script → ML Detector → Background Worker → Offscreen Document → BERT Model
                ↓
          Preview Modal → User Choice → Masked/Original/Cancel
```

### Processing Flow

1. **Text Interception** - Captures text when you press Enter (before sending)
2. **Regex Detection** - Fast pattern matching for structured PII (under 10ms)
3. **ML Detection** - BERT Named Entity Recognition for contextual PII (100-300ms)
4. **Deduplication** - Removes overlapping detections to avoid double-masking
5. **Preview Generation** - Creates masked version for review
6. **User Decision** - Waits for your choice before allowing submission

### Technologies

- **Chrome Manifest V3** - Latest extension API standards
- **Transformers.js** - In-browser machine learning via WebAssembly
- **BERT NER Model** - Named Entity Recognition (quantized, approximately 110MB)
- **ONNX Runtime** - WebAssembly-based ML inference engine
- **Offscreen API** - Runs ML in isolated context to bypass Content Security Policy restrictions

### Performance Metrics

- **Regex detection**: Under 10 milliseconds
- **ML detection**: 100-300 milliseconds (after model loads)
- **Model loading**: 30-60 seconds (one-time on first use, then cached)
- **Memory usage**: Approximately 200MB when ML is enabled

## Project Structure

```
pii_masker_v2/
├── manifest.json         # Extension configuration and Chrome Web Store description
├── background.js         # Service worker managing offscreen document lifecycle
├── content.js           # Main detection, masking, and UI logic
├── ml-detector.js       # Hybrid regex + ML detection coordinator
├── offscreen.js         # ML inference using Transformers.js
├── offscreen.html       # Container for offscreen document
├── popup.html/js        # Extension settings user interface
├── preview.css          # Preview modal styling
├── transformers.min.js  # Transformers.js library (877KB)
└── icons/              # Extension icons (16px, 48px, 128px)
```

### Key Files

- **manifest.json** - Extension metadata including Chrome Web Store description
- **content.js** - Injected into web pages, handles detection and masking
- **ml-detector.js** - Combines regex patterns with ML results
- **offscreen.js** - Runs BERT model in isolated context (avoids CSP issues)
- **background.js** - Creates and manages offscreen document for ML processing

## Testing

### Basic Functionality Test

1. Navigate to ChatGPT or any website
2. Type: `Hi, I'm John Doe. Email me at john@example.com`
3. Press Enter
4. Verify preview modal appears showing:
   - Original text
   - Masked version with `[REDACTED_NAME]` and `[REDACTED_EMAIL]`
   - List of detected items

### ML Detection Test

1. Enable "ML Detection (Beta)" in extension popup
2. Wait for model to load (30-60 seconds on first use)
3. Type: `I work at Google in Mountain View. Call me at 555-1234.`
4. Press Enter
5. Verify detection of:
   - "Google" as organization
   - "Mountain View" as location
   - Phone number

### No-PII Test

1. Type: `What is the weather today?`
2. Press Enter
3. Message should send immediately without preview (no PII detected)

## Troubleshooting

### ML Model Not Loading

**Symptoms:** ML detection not working, only regex patterns detected

**Solutions:**
- Open browser console (F12) and check for error messages
- Clear browser cache and reload extension
- Verify stable internet connection for initial model download
- Check available disk space (model requires approximately 110MB)

### Preview Modal Not Appearing

**Symptoms:** Messages send without showing preview

**Solutions:**
- Verify extension is enabled in popup
- Check if PII was actually detected (try adding an email address)
- Refresh the webpage after reloading extension
- Check browser console for JavaScript errors

### Extension Context Invalidated Error

**Symptoms:** Error message in console after reloading extension

**Solutions:**
- This is normal behavior during development
- Simply refresh the webpage after reloading extension
- Not a problem for end users in production

## Chrome Web Store Information

The Chrome Web Store displays information from `manifest.json`:

**Name:** PII Masker

**Description:** Privacy-first PII detector and masker. All processing happens locally in your browser - no data ever leaves your device. Protects sensitive information before sending to LLMs.

**Version:** 1.0.0

To update the store listing description, edit the `description` field in `manifest.json`.

## Development

### Prerequisites

- Chrome 109 or later (or Chromium-based browser)
- No build tools required - pure JavaScript, HTML, and CSS

### Making Changes

1. Edit source files as needed
2. Navigate to `chrome://extensions/`
3. Click the reload button on the extension card
4. Refresh any open web pages to load updated content script

### Local Testing

No build process is required. The extension can be loaded directly from the source directory.

## Browser Compatibility

- **Chrome:** Version 109 or later (requires Offscreen API)
- **Edge:** Chromium-based versions
- **Brave:** Chromium-based versions
- **Other Chromium browsers:** Should work if they support Manifest V3 and Offscreen API

## Security Considerations

- Extension uses Content Security Policy to prevent code injection
- ML model runs in isolated offscreen document
- No eval() or dynamic code execution
- All dependencies are vendored (no CDN dependencies)
- Source code available for security audit

## License

MIT License - Free to use, modify, and distribute.

## Contributing

Contributions are welcome. Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes with clear commit messages
4. Submit a pull request with description of changes

## Roadmap

Potential future enhancements:
- Custom PII pattern definitions
- Whitelist for trusted websites
- Settings import/export
- Multiple masking strategies
- Additional language support
- Undo/restore masked data

## Support

For bug reports or feature requests, please open an issue on GitHub.

---

**Privacy-First Design**

This extension was built with privacy as the primary concern. Your sensitive data never leaves your device, and the code is fully transparent for verification.
