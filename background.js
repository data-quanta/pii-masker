// Background Service Worker for PII Masker

// ML Model state
let offscreenDocumentReady = false;
let mlModelLoaded = false;
let mlLoading = false;

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
    // Initialize default settings
    chrome.storage.local.set({
        enabled: true,
        maskingMode: 'regex',
        useML: true,
        detectedPII: {}
    });
});

// Setup offscreen document on startup
chrome.runtime.onStartup.addListener(() => {
    setupOffscreenDocument();
});

// Setup offscreen document for ML processing
async function setupOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        offscreenDocumentReady = true;
        return true;
    }

    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['WORKERS'],
            justification: 'Run ML model for PII detection without CSP restrictions'
        });
        offscreenDocumentReady = true;
        return true;
    } catch (error) {
        console.error('PII Masker: Failed to create offscreen document:', error);
        return false;
    }
}

// Initialize ML model in offscreen document
async function initializeMLModel() {
    if (mlLoading) {
        return false;
    }

    if (mlModelLoaded) {
        return true;
    }

    try {
        mlLoading = true;

        // Create offscreen document if needed
        if (!offscreenDocumentReady) {
            const success = await setupOffscreenDocument();
            if (!success) {
                throw new Error('Failed to setup offscreen document');
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Request offscreen document to load ML model
        // Retry logic for connection establishment
        let attempts = 0;
        const maxAttempts = 3;
        let response;

        while (attempts < maxAttempts) {
            try {
                response = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Timeout waiting for offscreen document response (120s)'));
                    }, 120000);

                    chrome.runtime.sendMessage({
                        action: 'initializeMLOffscreen'
                    }, (res) => {
                        clearTimeout(timeout);
                        if (chrome.runtime.lastError) {
                            // If receiving end doesn't exist, we might need to wait a bit more
                            if (chrome.runtime.lastError.message.includes('Receiving end does not exist')) {
                                reject(new Error('Receiving end does not exist'));
                            } else {
                                reject(new Error(chrome.runtime.lastError.message));
                            }
                        } else {
                            resolve(res);
                        }
                    });
                });
                break; // Success
            } catch (error) {
                attempts++;
                if (error.message === 'Receiving end does not exist' && attempts < maxAttempts) {
                    console.log(`PII Masker: Offscreen not ready, retrying (${attempts}/${maxAttempts})...`);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
                } else {
                    throw error; // Re-throw other errors or if max attempts reached
                }
            }
        }

        if (response && response.success) {
            mlModelLoaded = true;
            mlLoading = false;
            return true;
        } else {
            throw new Error(response?.error || 'Unknown error from offscreen document');
        }
    } catch (error) {
        console.error('PII Masker: Failed to load ML model:', error);
        mlLoading = false;
        mlModelLoaded = false;
        return false;
    }
}

// Run ML detection via offscreen document
async function detectWithML(text) {
    if (!mlModelLoaded) {
        return { success: false, error: 'Model not loaded' };
    }

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'detectMLOffscreen',
            text: text
        });
        return response;
    } catch (error) {
        console.error('PII Masker: ML detection error:', error);
        return { success: false, error: error.message };
    }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPIIMappings') {
        chrome.storage.local.get('detectedPII', (result) => {
            sendResponse({ mappings: result.detectedPII || {} });
        });
        return true; // Keep channel open for async response
    }

    if (request.action === 'savePIIMappings') {
        chrome.storage.local.set({ detectedPII: request.mappings }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === 'getSettings') {
        chrome.storage.local.get(['enabled', 'maskingMode', 'useML'], (result) => {
            sendResponse({
                enabled: result.enabled ?? true,
                maskingMode: result.maskingMode || 'regex',
                useML: result.useML ?? true // ML is always enabled by default
            });
        });
        return true;
    }

    // ML Model initialization
    if (request.action === 'initializeML') {
        initializeMLModel().then(success => {
            sendResponse({ success, modelLoaded: mlModelLoaded });
        });
        return true;
    }

    // ML Detection
    if (request.action === 'detectWithML') {
        detectWithML(request.text).then(result => {
            sendResponse(result);
        });
        return true;
    }

    // Check ML status
    if (request.action === 'getMLStatus') {
        sendResponse({
            loaded: mlModelLoaded,
            loading: mlLoading
        });
        return true;
    }
});
