// ML-based PII Detection using Transformers.js (via Background Service Worker)
// This module communicates with the background worker to run ML inference

// Global variables for ML detector state
window.piiMaskerML = {
    modelLoaded: false,
    isLoading: false,
    initPromise: null
};

// Initialize the ML model in background worker
async function initializeMLDetector() {
    if (window.piiMaskerML.initPromise) {
        return window.piiMaskerML.initPromise;
    }

    if (window.piiMaskerML.modelLoaded) {
        return true;
    }

    window.piiMaskerML.initPromise = (async () => {
        try {
            window.piiMaskerML.isLoading = true;

            const response = await chrome.runtime.sendMessage({
                action: 'initializeML'
            });

            if (response && response.success) {
                window.piiMaskerML.modelLoaded = true;
                window.piiMaskerML.isLoading = false;
                return true;
            } else {
                throw new Error('Failed to initialize ML model: ' + (response?.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('PII Masker: Failed to load ML model:', error);
            console.error('This is normal on first load - the model (~110MB) needs to download.');
            console.error('Please wait 30-60 seconds and try again, or reload the page.');
            window.piiMaskerML.isLoading = false;
            window.piiMaskerML.initPromise = null;
            return false;
        }
    })();

    return window.piiMaskerML.initPromise;
}

// Detect PII using ML model (via background worker)
async function detectPIIWithML(text) {
    if (!window.piiMaskerML.modelLoaded) {
        return [];
    }

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'detectWithML',
            text: text
        });

        if (response && response.success) {
            return response.detected;
        } else {
            // Model not loaded yet - this can happen if ML initialization is still in progress
            if (response?.error === 'Model not loaded') {
                console.warn('PII Masker: ML model is still loading, using regex-only detection');
            } else {
                console.error('PII Masker: ML detection failed:', response?.error);
            }
            return [];
        }
    } catch (error) {
        console.error('PII Masker: ML detection error:', error);
        return [];
    }
}

// Note: All ML processing now happens in the background service worker
// This avoids CSP restrictions on websites like ChatGPT

// Combine regex and ML detection
async function detectPIIHybrid(text, regexPatterns) {
    const detectedItems = [];

    // 1. Regex detection (fast, for structured data)
    for (const [type, pattern] of Object.entries(regexPatterns)) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            detectedItems.push({
                type: type,
                value: match[0],
                index: match.index,
                source: 'regex',
                confidence: 1.0
            });
        }
    }

    // 2. ML detection (for contextual PII like names)
    if (window.piiMaskerML.modelLoaded) {
        const mlResults = await detectPIIWithML(text);

        // Add ML results, avoiding duplicates with regex results
        // Filter by type-specific confidence thresholds
        const getMinConfidence = (entityType) => {
            const type = entityType.toLowerCase().replace(/^[bi]-/, '');

            const highPrecision = {
                'socialnumber': 0.70, 'driverlicense': 0.65,
                'passport': 0.65, 'idcard': 0.65, 'pass': 0.70
            };

            const mediumPrecision = {
                'givenname1': 0.50, 'givenname2': 0.50,
                'lastname1': 0.50, 'lastname2': 0.50, 'lastname3': 0.50,
                'email': 0.60, 'tel': 0.55, 'ip': 0.60, 'username': 0.55
            };

            const lowPrecision = {
                'city': 0.40, 'country': 0.40, 'state': 0.40,
                'street': 0.45, 'building': 0.45, 'postcode': 0.45,
                'secaddress': 0.45, 'geocoord': 0.50,
                'bod': 0.45, 'date': 0.40, 'time': 0.40,
                'title': 0.40, 'sex': 0.50
            };

            return highPrecision[type] || mediumPrecision[type] || lowPrecision[type] || 0.45;
        };

        for (const mlItem of mlResults) {
            const minConfidence = getMinConfidence(mlItem.type);

            // Skip low-confidence detections based on type-specific threshold
            if (mlItem.score < minConfidence) {
                continue;
            } const isDuplicate = detectedItems.some(item => {
                // Check if positions overlap
                const overlap = !(item.index + item.value.length <= mlItem.start ||
                    mlItem.end <= item.index);
                return overlap;
            });

            if (!isDuplicate) {
                detectedItems.push({
                    type: mlItem.type,
                    value: mlItem.value,
                    index: mlItem.start,
                    source: 'ml',
                    confidence: mlItem.score
                });
            } else {
            }
        }
    } return detectedItems;
}

// Make functions available globally
window.initializeMLDetector = initializeMLDetector;
window.detectPIIWithML = detectPIIWithML;
window.detectPIIHybrid = detectPIIHybrid;