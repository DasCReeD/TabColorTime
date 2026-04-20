# Tab Heat Map Extension Plan

## background.js (Core Engine)

```javascript
let tabOrder = [];
const HEAT_COLORS = ['grey', 'pink', 'purple', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red'];

// Event Listeners
chrome.tabs.onActivated.addListener(activeInfo => handleUpdate(activeInfo.tabId));
chrome.tabs.onCreated.addListener(tab => handleUpdate(tab.id));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible === true) handleUpdate(tabId);
});

async function handleUpdate(tabId) {
  // 1. Maintain Sort Order (Right = Hot)
  tabOrder = tabOrder.filter(id => id !== tabId);
  tabOrder.push(tabId);

  // 2. Validate current tabs
  const allTabs = await chrome.tabs.query({currentWindow: true});
  const validIds = allTabs.map(t => t.id);
  tabOrder = tabOrder.filter(id => validIds.includes(id));

  // 3. Batch, Move, and Color
  const totalTabs = tabOrder.length;
  for (let i = 0; i < totalTabs; i++) {
    const currentTabId = tabOrder[i];
    await chrome.tabs.move(currentTabId, { index: i });

    const colorIndex = Math.max(0, HEAT_COLORS.length - 1 - Math.floor((totalTabs - 1 - i) / 5));
    const isHotGroup = (colorIndex === HEAT_COLORS.length - 1);

    const groupId = await chrome.tabs.group({ tabIds: currentTabId });
    chrome.tabGroups.update(groupId, { 
      color: HEAT_COLORS[colorIndex],
      collapsed: !isHotGroup,
      title: isHotGroup ? "HOT" : "" 
    });
  }
}
```

## System Constraints & Considerations

- **Performance**: For a system architect's scale (high tab count), a 200ms debounce should be added to `handleUpdate` to prevent browser stutter during rapid switching.
- **Chrome UI**: Real-time hover detection on the native tab strip is not possible. If hover expansion is a hard requirement, a Side Panel UI must be developed to replace the native tab strip view.

## Key Architectural Notes for Implementation:
* **The "Hot Zone":** The logic is set so that the right-most side of your browser is the "Hot" end. New tabs and active audio tabs will automatically fly to the right.
* **Auto-Collapse:** To simulate the "shrinking" effect you wanted, the background script is configured to set `collapsed: true` for every group except the one containing the most recent tabs. This keeps your workspace clean.
* **Audio Escalation:** The listener is configured to trigger the `handleUpdate` function the moment `audible` becomes true, effectively "bumping" a background YouTube or music tab into your active red group. 

*Future Enhancement*: You may want to eventually move the `tabOrder` array into `chrome.storage.local` to ensure your heat-map state persists if the browser or service worker restarts.
