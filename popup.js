// Popup UI Script
document.addEventListener('DOMContentLoaded', async () => {
    const enableToggle = document.getElementById('enableToggle');
    const statusEl = document.getElementById('status');

    // Load current settings and ensure ML is always enabled
    const settings = await chrome.storage.local.get(['enabled', 'useML']);

    // Update UI
    const isEnabled = settings.enabled ?? true;
    enableToggle.checked = isEnabled;
    updateStatus(isEnabled);

    // Force ML detection to always be enabled (for existing and new users)
    await chrome.storage.local.set({ useML: true });

    // Handle enable toggle change
    enableToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        await chrome.storage.local.set({ enabled });
        updateStatus(enabled);

        // Show user feedback
        if (!enabled) {
            // Show a temporary message
            const statusEl = document.getElementById('status');
            const originalHTML = statusEl.innerHTML;
            statusEl.innerHTML = '<span class="status-dot"></span><span>Reload page to disable</span>';
            statusEl.style.fontSize = '12px';

            setTimeout(() => {
                statusEl.innerHTML = originalHTML;
                statusEl.style.fontSize = '';
            }, 3000);
        }

        // Notify all tabs about the change (ML is always enabled)
        const tabs = await chrome.tabs.query({});
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
                action: 'settingsChanged',
                enabled,
                useML: true
            }).catch(() => {
                // Tab might not have content script
            });
        });
    });

    function updateStatus(enabled) {
        if (enabled) {
            statusEl.innerHTML = '<span class="status-dot"></span><span>Protection Active</span>';
            statusEl.className = 'status-badge active';
        } else {
            statusEl.innerHTML = '<span class="status-dot"></span><span>Protection Inactive</span>';
            statusEl.className = 'status-badge inactive';
        }
    }

    // Add click handler for the protection toggle container (for better UX)
    const protectionContainer = document.getElementById('protectionToggleContainer');
    const protectionSwitchLabel = document.getElementById('protectionSwitchLabel');

    // Handle clicking the container (but not the switch itself)
    protectionContainer.addEventListener('click', (e) => {
        // Only trigger if not clicking the switch label or input
        if (!protectionSwitchLabel.contains(e.target)) {
            enableToggle.click();
        }
    });

    // Prevent event propagation when clicking the switch itself
    protectionSwitchLabel.addEventListener('click', (e) => {
        e.stopPropagation();
    });
});
