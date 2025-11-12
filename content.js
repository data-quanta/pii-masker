// Content Script - PII Masker Extension
// Detects and masks sensitive information before sending to LLMs

// Comprehensive regex patterns for PII detection
// IMPORTANT: Ordered array to ensure specific patterns are checked FIRST
const PII_PATTERNS_ORDERED = [
    // Most specific first
    { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
    { name: 'creditCard', pattern: /\b(?:4\d{3}|5[1-5]\d{2}|6011|3[47]\d{2})[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
    { name: 'cvv', pattern: /\b(?:(?:CVV|CVC|CSC)[-:\s]+\d{3,4}|(?:expires\s+\d{1,2}\/\d{4}\))\s+should|\d{4,16}[,\s]+(?:CVV|CVC|CSC)[-:\s]+\d{3,4})\b/gi },
    { name: 'policyNumber', pattern: /\b(?:policy|insurance)(?:\s+(?:number|#))?[-:\s]*(?:POL-|POLICY-)?\d{4}-\d{7,10}\b/gi },
    { name: 'medicalRecord', pattern: /\b(?:MRN|HIC|medical\s+record(?:\s+number)?)[-:\s]+\d{2,3}-?\d{2,3}-?\d{4,5}[A-Z]?\b/gi },
    { name: 'vin', pattern: /\b(?:(?:VIN|vehicle\s+identification\s+number)[-:\s]+)?[A-HJ-NPR-Z0-9]{17}\b/gi },
    { name: 'routingNumber', pattern: /\b(?:routing(?:\s+(?:number|#))?[-:\s]+)\d{9}\b/gi },
    { name: 'bankAccount', pattern: /\b(?:account(?:\s+(?:number|#|no\.?))?[-:\s]+)\d{10,17}\b/gi },
    { name: 'passport', pattern: /\b(?:passport(?:\s+(?:number|#|no\.?))?[-:\s]+)?[A-Z]{1,2}\d{7,9}\b/gi },
    { name: 'driversLicense', pattern: /\b(?:(?:driver'?s?\s+(?:license|DL)(?:\s+(?:number|#|no\.?))?[-:\s]+)|(?:license\s+number(?:\s+is)?[-:\s]+))[A-Z]\d{7,8}\b/gi },
    { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
    { name: 'phone', pattern: /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
    { name: 'zipCode', pattern: /\b\d{5}(?:-\d{4})?\b/g },
    { name: 'ipv4', pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g },
    { name: 'dateOfBirth', pattern: /\b(?:DOB|date\s+of\s+birth|born\s+on|birth\s+date)[-:\s]+(?:(?:0?[1-9]|1[0-2])[-\/](?:0?[1-9]|[12][0-9]|3[01])[-\/](?:19|20)\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s]+\d{1,2},?[\s]+(?:19|20)\d{2})\b/gi },
    { name: 'titleName', pattern: /\b(?:Dr|Mr|Mrs|Ms|Prof|Professor)\.?\s+[A-Z][a-z]+(?:[-'\s][A-Z][a-z]+)*(?:\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*){0,2}\b/g },
    { name: 'fullName', pattern: /\b(?:my\s+(?:name|colleague)\s+is|with|coordinating\s+with)\s+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g },
    { name: 'organization', pattern: /\b(?:[A-Z][A-Za-z]+\s+){1,4}(?:Corporation|Corp\.?|Inc\.?|LLC|Ltd\.?|Limited|Company|Co\.?|Bank|Services|Systems|Solutions|Technologies|Group|Partners|Industries|Medical\s+Center|University|College|Pharmacy)\b/g }
];

// Convert to object for backward compatibility
const PII_PATTERNS = {};
for (const item of PII_PATTERNS_ORDERED) {
    PII_PATTERNS[item.name] = item.pattern;
}

// Store for PII mappings (original -> masked)
let piiMappings = {};

// Flag to prevent infinite loops when re-triggering events
let isProcessingSubmission = false;

// Get settings from background
let isEnabled = true;
let maskingMode = 'regex'; // 'regex' or 'hybrid' (regex + ML)
let useML = true; // ML detection is always enabled by default

// Initialize settings
chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (chrome.runtime.lastError) return;

    if (response) {
        isEnabled = response.enabled;
        maskingMode = response.maskingMode || 'regex';
        useML = response.useML ?? true; // Default to true if not set

        // Initialize ML model (always enabled)
        if (useML && window.initializeMLDetector) {
            initializeMLDetector().catch(err => {
                console.error('PII Masker: Failed to initialize ML model:', err);
            });
        }
    }
});

// Initialize ML detector immediately on load
if (window.initializeMLDetector) {
    initializeMLDetector().catch(err => {
        console.error('PII Masker: Failed to initialize ML model:', err);
    });
}

// Listen for settings changes from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'settingsChanged') {
        isEnabled = request.enabled;
        useML = request.useML;

        // Initialize ML if just enabled
        if (isEnabled && useML && !window.piiMaskerML.modelLoaded && window.initializeMLDetector) {
            initializeMLDetector().catch(err => {
                console.error('PII Masker: ML initialization failed:', err);
            });
        }

        sendResponse({ success: true });
    }
});

// Function to generate mask placeholder with descriptive labels
function generateMask(type) {
    // Map types to more user-friendly labels
    const labelMap = {
        'email': 'REDACTED_EMAIL',
        'phone': 'REDACTED_PHONE',
        'ssn': 'REDACTED_SSN',
        'creditCard': 'REDACTED_CREDIT_CARD',
        'zipCode': 'REDACTED_ZIP',
        'ipv4': 'REDACTED_IP',
        'dateOfBirth': 'REDACTED_DOB',
        'passport': 'REDACTED_PASSPORT',
        'driversLicense': 'REDACTED_LICENSE',
        'bankAccount': 'REDACTED_ACCOUNT',
        'medicalRecord': 'REDACTED_MEDICAL_ID',
        'vin': 'REDACTED_VIN',
        'policyNumber': 'REDACTED_POLICY',
        'routingNumber': 'REDACTED_ROUTING',
        'person': 'REDACTED_NAME',
        'organization': 'REDACTED_ORGANIZATION',
        'location': 'REDACTED_LOCATION',
        'titleName': 'REDACTED_NAME'
    };
    const label = labelMap[type] || `REDACTED_${type.toUpperCase()}`;
    return `[${label}]`;
}

// Function to detect PII without masking (for preview)
async function detectPII(text) {
    if (!text || !isEnabled) return [];

    // Wait for ML to load if it's still loading
    if (useML && window.piiMaskerML?.isLoading) {
        const maxWaitTime = 30000;
        const startTime = Date.now();
        while (window.piiMaskerML?.isLoading && (Date.now() - startTime) < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Try to initialize ML if not loaded yet and not loading
    if (useML && window.initializeMLDetector && (!window.piiMaskerML || !window.piiMaskerML.modelLoaded) && !window.piiMaskerML?.isLoading) {
        try {
            await window.initializeMLDetector();
        } catch (err) {
            console.error('PII Masker: Failed to initialize ML:', err);
        }
    }

    // Use hybrid detection if ML is enabled and loaded
    if (useML && window.piiMaskerML && window.piiMaskerML.modelLoaded && window.detectPIIHybrid) {
        try {
            return await window.detectPIIHybrid(text, PII_PATTERNS);
        } catch (error) {
            console.error('PII Masker: ML detection failed:', error);
            // Fall through to regex-only detection
        }
    }

    // Regex-only detection (fast, always available)
    // Use ORDERED array to ensure specific patterns are checked first
    const detected = [];

    for (const { name, pattern } of PII_PATTERNS_ORDERED) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            detected.push({
                type: name,
                value: match[0],
                index: match.index,
                source: 'regex',
                confidence: 1.0
            });
        }
    }

    return detected;
}// Function to detect and mask PII using regex
function maskPIIWithRegex(text) {
    if (!text || !isEnabled) return text;

    let maskedText = text;

    // Mask each PII type
    for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;

        maskedText = maskedText.replace(pattern, (match) => {
            const mask = generateMask(type);
            piiMappings[mask] = match;
            return mask;
        });
    }

    return maskedText;
}

// Function to mask text based on detected PII items (works with both regex and ML)
function maskDetectedPII(text, detectedItems) {
    if (!text || !detectedItems || detectedItems.length === 0) return text;

    // Remove duplicates and overlapping items (keep the first one found)
    const uniqueItems = [];
    const sortedByStart = [...detectedItems].sort((a, b) => a.index - b.index);

    for (const item of sortedByStart) {
        const overlaps = uniqueItems.some(existing => {
            const itemEnd = item.index + item.value.length;
            const existingEnd = existing.index + existing.value.length;
            return !(itemEnd <= existing.index || item.index >= existingEnd);
        });

        if (!overlaps) {
            uniqueItems.push(item);
        }
    }

    // Sort by index in reverse order to avoid position shifts when replacing
    const sortedItems = uniqueItems.sort((a, b) => b.index - a.index);

    let maskedText = text;

    // Replace each detected item with a mask
    for (const item of sortedItems) {
        const mask = generateMask(item.type);
        piiMappings[mask] = item.value;

        // Verify the text at this position matches what we expect
        const actualText = maskedText.substring(item.index, item.index + item.value.length);
        if (actualText !== item.value) {
            continue; // Skip this item if text doesn't match
        }

        const before = maskedText.substring(0, item.index);
        const after = maskedText.substring(item.index + item.value.length);
        maskedText = before + mask + after;
    }

    return maskedText;
}

// Function to show preview modal
function showPreviewModal(originalText, maskedText, detectedItems, onConfirm, onCancel) {
    // Create modal HTML
    const modal = document.createElement('div');
    modal.className = 'pii-masker-preview-overlay';
    // Force opacity to 1 from the start to avoid CSS animation issues
    modal.style.opacity = '1';


    const hasPII = detectedItems.length > 0; modal.innerHTML = `
        <div class="pii-masker-preview-modal">
            <div class="pii-masker-preview-header">
                <h2 class="pii-masker-preview-title">
                    <span>${hasPII ? '🛡️' : '✅'}</span>
                    <span>${hasPII ? 'PII Detected - Review Before Sending' : 'Ready to Send'}</span>
                </h2>
                <p class="pii-masker-preview-subtitle">
                    ${hasPII
            ? `Found ${detectedItems.length} sensitive item${detectedItems.length !== 1 ? 's' : ''} that will be protected`
            : 'No sensitive information detected - safe to send'
        }
                </p>
            </div>
            
            <div class="pii-masker-preview-content">
                <div class="pii-masker-preview-section">
                    <div class="pii-masker-preview-label">📄 ${hasPII ? 'Original Text' : 'Your Message'}</div>
                    <div class="pii-masker-preview-text">${escapeHtml(originalText)}</div>
                </div>
                
                ${hasPII ? `
                    <div class="pii-masker-preview-section">
                        <div class="pii-masker-preview-label" style="display: flex; justify-content: space-between; align-items: center;">
                            <span>🔒 Protected Version (Will Be Sent)</span>
                            <button class="pii-masker-btn pii-masker-btn-secondary" id="pii-masker-copy-btn" style="padding: 6px 12px; font-size: 12px;">
                                📋 Copy
                            </button>
                        </div>
                        <div class="pii-masker-preview-text masked" id="pii-masker-masked-text">${escapeHtml(maskedText)}</div>
                    </div>
                ` : ''}
            </div>
            
            <div class="pii-masker-preview-actions">
                <button class="pii-masker-btn pii-masker-btn-secondary" id="pii-masker-cancel">
                    ← Cancel
                </button>
                ${hasPII ? `
                    <button class="pii-masker-btn pii-masker-btn-danger" id="pii-masker-send-original">
                        ⚠️ Send Original
                    </button>
                    <button class="pii-masker-btn pii-masker-btn-primary" id="pii-masker-confirm">
                        ✓ Send Protected
                    </button>
                ` : `
                    <button class="pii-masker-btn pii-masker-btn-primary" id="pii-masker-confirm">
                        ✓ Send Message
                    </button>
                `}
            </div>
        </div>
    `;

    // Add event listeners
    document.body.appendChild(modal);

    modal.querySelector('#pii-masker-cancel').addEventListener('click', () => {
        document.body.removeChild(modal);
        onCancel();
    });    // Copy button handler
    const copyBtn = modal.querySelector('#pii-masker-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            const maskedTextElement = modal.querySelector('#pii-masker-masked-text');
            const textToCopy = maskedTextElement ? maskedTextElement.textContent : maskedText;

            try {
                await navigator.clipboard.writeText(textToCopy);
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => {
                    copyBtn.textContent = '📋 Copy';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy text:', err);
                copyBtn.textContent = '❌ Failed';
                setTimeout(() => {
                    copyBtn.textContent = '📋 Copy';
                }, 2000);
            }
        });
    }

    const sendOriginalBtn = modal.querySelector('#pii-masker-send-original');
    if (sendOriginalBtn) {
        sendOriginalBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
            onConfirm(false); // Don't mask
        });
    }

    modal.querySelector('#pii-masker-confirm').addEventListener('click', () => {
        document.body.removeChild(modal);
        onConfirm(hasPII); // Mask if PII detected, otherwise send as-is
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
            onCancel();
        }
    });
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Function to intercept input before submission
function setupInputInterception() {
    // Monitor all text inputs, textareas, and contenteditable elements
    const inputSelectors = 'input[type="text"], textarea, [contenteditable="true"]';

    // Listen for form submissions
    document.addEventListener('submit', (e) => {
        if (!isEnabled) return;

        const form = e.target;
        const inputs = form.querySelectorAll(inputSelectors);

        inputs.forEach(input => {
            const originalValue = input.value || input.textContent;
            const maskedValue = maskPIIWithRegex(originalValue);

            if (maskedValue !== originalValue) {
                if (input.value !== undefined) {
                    input.value = maskedValue;
                } else {
                    input.textContent = maskedValue;
                }
            }
        });
    }, true);

    // For sites that don't use forms (like chat interfaces)
    // Monitor specific buttons/elements - capture phase to intercept early
    document.addEventListener('click', async (e) => {
        if (!isEnabled) return;

        // Skip if we're already processing to avoid infinite loop
        if (isProcessingSubmission) {
            return;
        }

        // Check if clicked element is a submit button (but not stop button)
        const button = e.target.closest('button[data-testid="send-button"], button#composer-submit-button');
        if (!button) return;        // Don't intercept if it's the stop button
        if (button.getAttribute('data-testid') === 'stop-button' || button.getAttribute('aria-label')?.includes('Stop')) {
            return;
        }

        // For ChatGPT's ProseMirror editor
        const proseMirrorInput = document.querySelector('#prompt-textarea');
        if (proseMirrorInput) {
            const originalValue = proseMirrorInput.textContent || proseMirrorInput.innerText;

            // Only intercept if there's text
            if (!originalValue || originalValue.trim().length === 0) {
                return;
            }

            // Prevent submission
            e.preventDefault();
            e.stopImmediatePropagation();

            // Detect PII (async)
            const detectedPII = await detectPII(originalValue);

            // Generate masked version for preview
            const maskedValue = detectedPII.length > 0 ? maskDetectedPII(originalValue, detectedPII) : originalValue;

            // Show preview modal
            showPreviewModal(
                originalValue,
                maskedValue,
                detectedPII,
                (shouldMask) => {
                    // User confirmed - proceed with submission
                    isProcessingSubmission = true;

                    if (shouldMask) {
                        proseMirrorInput.textContent = maskedValue;
                    } else {
                        proseMirrorInput.textContent = originalValue;
                    }

                    // Trigger input event so ProseMirror registers the change
                    const inputEvent = new Event('input', { bubbles: true });
                    proseMirrorInput.dispatchEvent(inputEvent);

                    // Re-click the button after a short delay
                    setTimeout(() => {
                        button.click();

                        // Reset flag after a delay
                        setTimeout(() => {
                            isProcessingSubmission = false;
                        }, 500);
                    }, 50);
                },
                () => {
                    // User cancelled - do not send
                    isProcessingSubmission = false;
                }
            );

            return false;
        }

        // Fallback for other sites
        setTimeout(() => {
            const container = button.closest('form, div, main, section') || document.body;
            const inputs = container.querySelectorAll(inputSelectors);

            inputs.forEach(input => {
                const originalValue = input.value || input.textContent || input.innerText;
                const maskedValue = maskPIIWithRegex(originalValue);

                if (maskedValue !== originalValue) {
                    if (input.value !== undefined) {
                        input.value = maskedValue;
                    } else if (input.textContent !== undefined) {
                        input.textContent = maskedValue;
                    } else if (input.innerText !== undefined) {
                        input.innerText = maskedValue;
                    }
                }
            });
        }, 0);
    }, true);
}

// Add visual indicator when PII is detected
function addVisualFeedback(element) {
    const originalBorder = element.style.border;
    const originalBoxShadow = element.style.boxShadow;
    const originalTransition = element.style.transition;

    element.style.transition = 'all 0.3s ease';
    element.style.border = '2px solid #f59e0b';
    element.style.boxShadow = '0 0 0 3px rgba(251, 191, 36, 0.2), 0 4px 12px rgba(245, 158, 11, 0.3)';

    setTimeout(() => {
        element.style.transition = 'all 0.5s ease';
        element.style.border = originalBorder;
        element.style.boxShadow = originalBoxShadow;
        setTimeout(() => {
            element.style.transition = originalTransition;
        }, 500);
    }, 2000);
}

// Monitor input fields for real-time feedback (optional)
function setupRealtimeMonitoring() {
    const inputSelectors = 'input[type="text"], textarea, [contenteditable="true"]';

    document.addEventListener('input', (e) => {
        if (!isEnabled) return;

        const input = e.target;
        if (!input.matches(inputSelectors)) return;

        const text = input.value || input.textContent || '';

        // Check if text contains PII (without masking yet)
        let hasPII = false;
        for (const pattern of Object.values(PII_PATTERNS)) {
            pattern.lastIndex = 0; // Reset regex state
            if (pattern.test(text)) {
                hasPII = true;
                break;
            }
        }

        if (hasPII) {
            addVisualFeedback(input);
        }
    });
}

// Store the text content before it gets cleared
let capturedText = '';

// Listen for Enter key with IMMEDIATE prevention (capture phase)
document.addEventListener('keydown', async (e) => {
    if (!isEnabled) return;

    // Skip if we're already processing to avoid infinite loop
    if (isProcessingSubmission) return;

    // Check if Enter key was pressed (without Shift for new line)
    const target = e.target; if (e.key === 'Enter' && !e.shiftKey) {
        // Handle ProseMirror (ChatGPT)
        if (target.id === 'prompt-textarea' || target.closest('#prompt-textarea')) {
            const proseMirrorInput = document.querySelector('#prompt-textarea');
            if (proseMirrorInput) {
                // Capture text and IMMEDIATELY prevent submission
                capturedText = proseMirrorInput.textContent || proseMirrorInput.innerText || '';

                if (capturedText && capturedText.trim().length > 0) {
                    // Prevent default submission
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    const originalValue = capturedText;

                    // Detect PII (async)
                    const detectedPII = await detectPII(originalValue);

                    // Generate masked version for preview (works with both regex and ML)
                    const maskedValue = detectedPII.length > 0 ? maskDetectedPII(originalValue, detectedPII) : originalValue;

                    // ALWAYS show preview modal (even if no PII detected)
                    showPreviewModal(
                        originalValue,
                        maskedValue,
                        detectedPII,
                        (shouldMask) => {
                            // User confirmed - proceed with submission
                            // Set flag to prevent re-entry
                            isProcessingSubmission = true;

                            if (shouldMask) {
                                proseMirrorInput.textContent = maskedValue;
                            } else {
                                // User chose to send original
                                proseMirrorInput.textContent = originalValue;
                            }

                            // Dispatch input event
                            const inputEvent = new Event('input', { bubbles: true });
                            proseMirrorInput.dispatchEvent(inputEvent);

                            // Submit
                            setTimeout(() => {
                                const enterEvent = new KeyboardEvent('keydown', {
                                    key: 'Enter',
                                    code: 'Enter',
                                    keyCode: 13,
                                    which: 13,
                                    bubbles: true,
                                    cancelable: true
                                });
                                proseMirrorInput.dispatchEvent(enterEvent);

                                // Reset flag and clear captured text
                                setTimeout(() => {
                                    isProcessingSubmission = false;
                                    capturedText = ''; // Clear for next message
                                }, 500);
                            }, 50);
                        },
                        () => {
                            // User cancelled - DO NOT SEND
                            capturedText = '';
                            isProcessingSubmission = false;
                            // Do not re-trigger submission - user wants to edit or cancel
                        }
                    );
                } else {
                    // Empty text, allow submission
                    capturedText = '';
                }
            }
            return;
        }
    }

    // Fallback for regular inputs - ONLY on Enter key
    if (e.key === 'Enter' && !e.shiftKey) {
        const inputSelectors = 'input[type="text"], textarea, [contenteditable="true"]';
        if (target.matches(inputSelectors)) {
            setTimeout(() => {
                const originalValue = target.value || target.textContent || target.innerText;
                const maskedValue = maskPIIWithRegex(originalValue);

                if (maskedValue !== originalValue) {
                    if (target.value !== undefined) {
                        target.value = maskedValue;
                    } else if (target.textContent !== undefined) {
                        target.textContent = maskedValue;
                    }
                }
            }, 0);
        }
    }
}, true); // Use capture phase to intercept BEFORE ChatGPT's handlers

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setupInputInterception();
        setupRealtimeMonitoring();
    });
} else {
    setupInputInterception();
    setupRealtimeMonitoring();
}

// Save mappings periodically
setInterval(() => {
    if (Object.keys(piiMappings).length > 0) {
        try {
            chrome.runtime.sendMessage({
                action: 'savePIIMappings',
                mappings: piiMappings
            }, (response) => {
                if (chrome.runtime.lastError) {
                    // Extension context invalidated, stop trying to save (normal on reload)
                    // Don't log error - this is expected behavior
                }
            });
        } catch (error) {
            // Silently ignore - extension context invalidated
        }
    }
}, 5000);
