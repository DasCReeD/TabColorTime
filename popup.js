document.addEventListener('DOMContentLoaded', async () => {
    const select = document.getElementById('sortDirection');
    
    // Load current setting (default is right)
    const result = await chrome.storage.local.get(['sortDirection']);
    if (result.sortDirection) {
        select.value = result.sortDirection;
    }
    
    // Listen for changes
    select.addEventListener('change', async (e) => {
        await chrome.storage.local.set({ sortDirection: e.target.value });
        
        // Force the background script to run a visual update right now
        // so the user sees the direction flip immediately
        chrome.runtime.sendMessage({ action: 'forceUpdate' });
    });
});
