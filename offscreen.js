// Offscreen document script for ML processing
// This runs in a separate context where ES modules work

// Comprehensive suppression for worker-related errors
// These errors are harmless - ONNX/Transformers falls back to single-threaded mode automatically
const workerErrorPatterns = [
    'worker sent an error',
    'importScripts',
    'blob:chrome-extension',
    'WorkerGlobalScope',
    'Failed to load',
    'NetworkError',
    'onnxruntime-web',
    'ort-web',
    'document.currentScript',
    '__webpack_require__',
    'Content Security Policy',
    'script-src',
    'worker.js onmessage'
];

function shouldSuppressMessage(msg) {
    const msgStr = String(msg);
    return workerErrorPatterns.some(pattern => msgStr.includes(pattern));
}

// Suppress console.error
const originalConsoleError = console.error;
console.error = function (...args) {
    if (args.some(arg => shouldSuppressMessage(arg))) {
        return;
    }
    originalConsoleError.apply(console, args);
};

// Suppress console.warn
const originalConsoleWarn = console.warn;
console.warn = function (...args) {
    if (args.some(arg => shouldSuppressMessage(arg))) {
        return;
    }
    originalConsoleWarn.apply(console, args);
};

// Suppress console.log for worker errors
const originalConsoleLog = console.log;
console.log = function (...args) {
    if (args.some(arg => shouldSuppressMessage(arg))) {
        return;
    }
    originalConsoleLog.apply(console, args);
};

// Suppress all error events at the capture phase (before they bubble)
window.addEventListener('error', (event) => {
    if (shouldSuppressMessage(event.message) ||
        shouldSuppressMessage(event.error) ||
        shouldSuppressMessage(event.filename)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return false;
    }
}, true);

// Suppress unhandledrejection events
window.addEventListener('unhandledrejection', (event) => {
    if (shouldSuppressMessage(event.reason)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
}, true);

// Suppress securitypolicyviolation events (CSP errors)
window.addEventListener('securitypolicyviolation', (event) => {
    if (shouldSuppressMessage(event.blockedURI) ||
        shouldSuppressMessage(event.violatedDirective)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
}, true);

// CRITICAL: Completely disable Worker API before importing transformers.js
// This prevents transformers.js and ONNX Runtime from even attempting to create workers
// which would fail due to Chrome extension CSP restrictions on blob: URLs
const OriginalWorker = self.Worker;
self.Worker = class DisabledWorker {
    constructor() {
        // Don't throw an error, just create a non-functional worker
        // This allows libraries to gracefully fall back to single-threaded mode
    }
    postMessage() { }
    terminate() { }
    addEventListener() { }
    removeEventListener() { }
};

let pipeline, env;
let transformersLoaded = false;

// Load transformers.js
(async () => {
    try {
        // Pre-configure ONNX Runtime environment BEFORE importing transformers
        if (typeof self !== 'undefined') {
            self.ort = self.ort || {};
            self.ort.env = self.ort.env || {};
            self.ort.env.wasm = self.ort.env.wasm || {};

            // Disable workers completely
            self.ort.env.wasm.numThreads = 1;
            self.ort.env.wasm.proxy = false;

            // Set WASM paths to use CDN instead of relative paths
            // This avoids the document.currentScript.src issue in extension context
            self.ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
        }

        const transformersModule = await import('./transformers.min.js');
        pipeline = transformersModule.pipeline;
        env = transformersModule.env;
        transformersLoaded = true;

        // Configure Transformers.js to download from HuggingFace
        if (env) {
            env.allowLocalModels = false;
            env.allowRemoteModels = true;
            env.useBrowserCache = true;

            // Configure ONNX Runtime to completely disable Web Workers
            env.backends = {
                onnx: {
                    wasm: {
                        numThreads: 1,
                        simd: true,
                        proxy: false
                    }
                }
            };
        }
    } catch (error) {
        console.error('PII Masker: Failed to import transformers.js:', error);
        transformersLoaded = false;
    }
})();

let mlPipeline = null;
let isLoading = false;

// Listen for messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Health check
    if (request.action === 'ping') {
        sendResponse({ pong: true, transformersLoaded, modelLoaded: !!mlPipeline });
        return true;
    }

    if (request.action === 'initializeMLOffscreen') {
        (async () => {
            if (isLoading) {
                sendResponse({ success: false, error: 'Already loading model' });
                return;
            }

            if (mlPipeline) {
                sendResponse({ success: true, alreadyLoaded: true });
                return;
            }

            try {
                isLoading = true;

                // Wait for transformers to be loaded
                let attempts = 0;
                while (!transformersLoaded && attempts < 50) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }

                if (!transformersLoaded) {
                    throw new Error('Transformers.js failed to load after 5 seconds');
                }

                // Using custom fine-tuned BERT model for PII detection
                mlPipeline = await pipeline(
                    'token-classification',
                    'sfermion/bert-pii-detector-onnx',
                    {
                        quantized: false,
                        device: 'wasm',
                        session_options: {
                            executionProviders: ['wasm']
                        }
                    }
                );
                sendResponse({ success: true });
            } catch (error) {
                console.error('PII Masker: Model initialization failed:', error);
                sendResponse({ success: false, error: error.message });
            } finally {
                isLoading = false;
            }
        })();
        return true; // Keep channel open for async response
    }

    if (request.action === 'detectMLOffscreen') {
        (async () => {
            if (!mlPipeline) {
                sendResponse({ success: false, error: 'Model not loaded' });
                return;
            }

            try {
                const maxChars = 150;
                const overlap = 15;
                const chunks = [];

                if (request.text.length <= maxChars) {
                    chunks.push({ text: request.text, offset: 0 });
                } else {
                    for (let i = 0; i < request.text.length; i += maxChars - overlap) {
                        const chunk = request.text.substring(i, Math.min(i + maxChars, request.text.length));
                        chunks.push({ text: chunk, offset: i });
                    }
                }

                // Process all chunks
                let allResults = [];
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];

                    try {
                        const chunkResults = await mlPipeline(chunk.text, {
                            truncation: true,
                            max_length: 512
                        });

                        // Adjust positions based on chunk offset
                        const adjustedResults = chunkResults.map(token => {
                            const hasValidPos = token.start !== undefined && token.end !== undefined &&
                                token.start !== null && token.end !== null;

                            if (!hasValidPos) {
                                const cleanWord = token.word.replace(/^▁/, '').replace(/^##/, '').trim();
                                if (cleanWord.length > 0) {
                                    const foundInChunk = chunk.text.indexOf(cleanWord);
                                    if (foundInChunk !== -1) {
                                        return {
                                            ...token,
                                            start: foundInChunk + chunk.offset,
                                            end: foundInChunk + cleanWord.length + chunk.offset
                                        };
                                    }
                                }
                            }

                            return {
                                ...token,
                                start: hasValidPos ? token.start + chunk.offset : undefined,
                                end: hasValidPos ? token.end + chunk.offset : undefined
                            };
                        });

                        allResults = allResults.concat(adjustedResults);
                    } catch (chunkError) {
                        console.error('PII Masker: Error processing chunk:', chunkError);
                        // Continue processing other chunks
                    }
                }

                const results = allResults;

                // Step 1: Group subword tokens (##) into complete words
                const words = [];
                let currentWord = null;
                let lastSearchPos = 0;

                for (const token of results) {
                    if (token.word.startsWith('##')) {
                        // Continuation of previous word
                        if (currentWord) {
                            currentWord.word += token.word.substring(2);
                            if (token.end !== undefined) currentWord.end = token.end;
                            currentWord.score = Math.max(currentWord.score, token.score);
                        }
                    } else {
                        // New word
                        if (currentWord) {
                            words.push(currentWord);
                            if (currentWord.end !== undefined) {
                                lastSearchPos = currentWord.end;
                            }
                        }
                        currentWord = { ...token };

                        // Calculate position if not provided
                        if (currentWord.start === undefined || currentWord.start === null) {
                            const cleanWord = currentWord.word.replace(/^##/, '');
                            const foundIndex = request.text.indexOf(cleanWord, lastSearchPos);
                            if (foundIndex !== -1) {
                                currentWord.start = foundIndex;
                                currentWord.end = foundIndex + cleanWord.length;
                                lastSearchPos = foundIndex;
                            }
                        }
                    }
                }
                if (currentWord) words.push(currentWord);

                console.log('PII Masker Offscreen: After grouping subwords:', words.length, 'words');
                console.log('PII Masker Offscreen: Words sample:', words.slice(0, 10));

                // Step 2: Merge consecutive entities of the same type (e.g., "Dr." + "Sarah" + "Mitchell" into "Dr. Sarah Mitchell")
                const grouped = [];
                let current = null;

                for (const word of words) {
                    const entityType = mapEntityType(word.entity);

                    if (current && entityType === current.type && word.start !== undefined && word.start !== null && current.end !== undefined && current.end !== null && current.start !== undefined && current.start !== null) {
                        // Check if words are close enough (within 2 characters - space or punctuation)
                        const gap = word.start - current.end;
                        if (gap >= 0 && gap <= 2) {
                            // Merge with current entity - extract from original text
                            const mergedText = request.text.substring(current.start, word.end);
                            if (mergedText && mergedText.trim().length > 0) {
                                current.word = mergedText;
                                current.end = word.end;
                                current.score = Math.min(current.score, word.score); // Use minimum score for merged entity
                                continue;
                            }
                        }
                    }

                    // Start new entity - only if it has valid positions
                    if (current && current.start !== undefined && current.start !== null) {
                        grouped.push(current);
                    }
                    current = {
                        entity: word.entity,
                        type: entityType,
                        word: word.word,
                        score: word.score,
                        start: word.start,
                        end: word.end
                    };
                }
                if (current && current.start !== undefined && current.start !== null && current.word && current.word.trim().length > 0) {
                    grouped.push(current);
                }

                // Common words to filter out (false positives)
                const commonWords = new Set([
                    'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'and', 'or', 'but',
                    'is', 'are', 'was', 'were', 'of', 'me', 'you', 'call', 'my', 'his', 'her', 'their', 'our',
                    'also', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
                    'com', 'org', 'net', 'edu', 'gov'  // Common domain extensions
                ]);

                // Type-specific confidence thresholds
                const getMinConfidence = (entityType) => {
                    const type = entityType.toLowerCase().replace(/^[bi]-/, '');

                    // High-precision types (sensitive data needs high confidence)
                    const highPrecision = {
                        'socialnumber': 0.80,
                        'driverlicense': 0.75,
                        'passport': 0.75,
                        'idcard': 0.75,
                        'pass': 0.80
                    };

                    // Medium-precision types
                    const mediumPrecision = {
                        'givenname1': 0.60, 'givenname2': 0.60,
                        'lastname1': 0.60, 'lastname2': 0.60, 'lastname3': 0.60,
                        'email': 0.80,  // Much higher to avoid false positives
                        'tel': 0.90,     // Much higher - phone numbers need high confidence
                        'ip': 0.75,
                        'username': 0.65
                    };

                    // Low-precision types (location/time data)
                    const lowPrecision = {
                        'city': 0.55, 'country': 0.55, 'state': 0.55,
                        'street': 0.60, 'building': 0.60, 'postcode': 0.60,
                        'secaddress': 0.60, 'geocoord': 0.65,
                        'bod': 0.70, 'date': 0.60, 'time': 0.60,
                        'title': 0.50, 'sex': 0.65
                    };

                    return highPrecision[type] || mediumPrecision[type] || lowPrecision[type] || 0.60;
                };

                // Step 3: Filter and format
                const detected = grouped
                    .filter(entity => {
                        const minConfidence = getMinConfidence(entity.type);
                        return entity.score > minConfidence;
                    })
                    .filter(entity => entity.start !== undefined && entity.start !== null)
                    .filter(entity => {
                        const word = entity.word.toLowerCase().trim();
                        const type = entity.type.toLowerCase().replace(/^[bi]-/, '');

                        // Filter out very short words
                        if (word.length < 2) return false;

                        // Filter out words with mixed letters and numbers that aren't valid patterns
                        const hasLetters = /[a-z]/i.test(word);
                        const hasNumbers = /\d/.test(word);
                        if (hasLetters && hasNumbers && !word.includes('@') && !word.includes('.')) {
                            // Mixed alphanumeric like "5bseattle" - likely garbage
                            if (type !== 'username' && type !== 'pass' && type !== 'driverlicense') {
                                return false;
                            }
                        }

                        // IP addresses should look like IPs (numbers and dots)
                        if (type === 'ip' && !/^\d+\.\d+/.test(word)) {
                            return false;
                        }

                        // Email parts should contain @ or look like email
                        if (type === 'email') {
                            // Must contain @ or be a proper domain
                            if (!word.includes('@') && !word.includes('.')) {
                                return false;
                            }
                            // Filter common false positives
                            if (['his', 'her', 'my', 'your', 'office', 'home'].includes(word)) {
                                return false;
                            }
                        }

                        // Phone numbers should be mostly digits and have reasonable length
                        if (type === 'tel') {
                            const digits = word.replace(/\D/g, '');
                            // Must have at least 7 digits and not be just a partial number
                            if (digits.length < 7 || digits.length > 15) {
                                return false;
                            }
                            // Filter obvious partials like "617-555" without the last part
                            if (word.endsWith('-') || word.startsWith('-')) {
                                return false;
                            }
                        }

                        // Date of birth / dates should be complete
                        if (type === 'bod' || type === 'date') {
                            // Must have reasonable date format with at least month/day or year
                            const hasSlash = word.includes('/');
                            const hasDash = word.includes('-');
                            const digits = word.replace(/\D/g, '');
                            // Filter partials like "15" or "1985-"
                            if (digits.length < 4 || word.endsWith('-') || word.endsWith('/')) {
                                return false;
                            }
                            if (!hasSlash && !hasDash && digits.length < 6) {
                                return false;
                            }
                        }

                        // Address parts should be reasonable
                        if (type === 'street' || type === 'building' || type === 'secaddress') {
                            // Filter obvious garbage like "5bseattle" or "9810" (partial ZIP)
                            if (word.length < 3) return false;
                            // If it's just numbers and short, probably not an address
                            if (/^\d+$/.test(word) && word.length < 5) {
                                return false;
                            }
                        }

                        // Social security numbers should be digits with reasonable length
                        if (type === 'socialnumber' && word.length < 9) {
                            return false;
                        }

                        return true;
                    })
                    .map(entity => ({
                        type: entity.type,
                        value: entity.word,
                        score: entity.score,
                        start: entity.start,
                        end: entity.end,
                        source: 'ml',
                        confidence: entity.score
                    }));

                sendResponse({ success: true, detected });
            } catch (error) {
                console.error('PII Masker: Detection error:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
});

function mapEntityType(nerEntity) {
    // Piiranha model uses I- prefix labels for PII detection
    // Based on the model's id2label mapping:
    // 0-16: Various PII types, 17: "O" (outside/no entity)
    const mapping = {
        // Piiranha PII labels (I- prefix)
        'I-ACCOUNTNUM': 'account',
        'I-BUILDINGNUM': 'building',
        'I-CITY': 'location',
        'I-CREDITCARDNUMBER': 'creditCard',
        'I-DATEOFBIRTH': 'dateOfBirth',
        'I-DRIVERLICENSENUM': 'license',
        'I-EMAIL': 'email',
        'I-GIVENNAME': 'person',
        'I-IDCARDNUM': 'idCard',
        'I-PASSWORD': 'password',
        'I-SOCIALNUM': 'ssn',
        'I-STREET': 'address',
        'I-SURNAME': 'person',
        'I-TAXNUM': 'taxId',
        'I-TELEPHONENUM': 'phone',
        'I-USERNAME': 'username',
        'I-ZIPCODE': 'zipcode',
        'O': 'none',  // Outside/no entity

        // Legacy BERT-NER labels (for backwards compatibility)
        'B-PER': 'person',
        'I-PER': 'person',
        'B-LOC': 'location',
        'I-LOC': 'location',
        'B-ORG': 'organization',
        'I-ORG': 'organization',
        'B-MISC': 'misc',
        'I-MISC': 'misc'
    };

    return mapping[nerEntity] || nerEntity.replace(/^[BI]-/, '').toLowerCase();
}
