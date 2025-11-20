// Popup UI Script
document.addEventListener('DOMContentLoaded', async () => {
    const enableToggle = document.getElementById('enableToggle');
    const statusEl = document.getElementById('status');
    const reloadBtn = document.getElementById('reloadBtn');
    const statusValueEl = document.querySelector('.stat-value'); // First stat value is Status

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

        // Show reload button
        reloadBtn.classList.add('visible');
        reloadBtn.style.display = 'flex';

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

    // Handle reload button click
    reloadBtn.addEventListener('click', async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            chrome.tabs.reload(tabs[0].id);
            window.close(); // Close popup after action
        }
    });

    function updateStatus(enabled) {
        if (enabled) {
            statusEl.innerHTML = '<span class="status-dot"></span><span>Protection Active</span>';
            statusEl.className = 'status-badge active';
            if (statusValueEl) statusValueEl.textContent = 'Active';
        } else {
            statusEl.innerHTML = '<span class="status-dot"></span><span>Protection Inactive</span>';
            statusEl.className = 'status-badge inactive';
            if (statusValueEl) statusValueEl.textContent = 'Inactive';
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
