const HEAT_COLORS = ['grey', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red'];
let updateTimeout = null;
let isUpdatingAccordion = false;
let isScriptUpdatingGroups = false;

// Event Listeners
chrome.tabs.onActivated.addListener(activeInfo => scheduleUpdate(activeInfo.tabId));
chrome.tabs.onCreated.addListener(tab => scheduleUpdate(tab.id));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible === true) scheduleUpdate(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const result = await chrome.storage.local.get(['tabOrder']);
  let currentOrder = result.tabOrder || [];
  currentOrder = currentOrder.filter(id => id !== tabId);
  await chrome.storage.local.set({ tabOrder: currentOrder });
});

chrome.tabGroups.onUpdated.addListener(async (group) => {
    // Prevent infinite loops when our own script collapses things
    if (isUpdatingAccordion || isScriptUpdatingGroups) return;
    
    // If a non-HOT group was expanded (either manually or by Chrome reacting to a tab click)
    if (!group.collapsed && group.title !== "HOT") {
        await chrome.storage.session.set({ lastExpandedGroupId: group.id });
        isUpdatingAccordion = true;
        
        try {
            const allGroups = await chrome.tabGroups.query({ windowId: group.windowId });
            for (const g of allGroups) {
                // Collapse everything else immediately except the newly expanded one and HOT
                if (g.id !== group.id && g.title !== "HOT" && !g.collapsed) {
                    try {
                        await chrome.tabGroups.update(g.id, { collapsed: true });
                    } catch(e) {
                         // Ignore if group already missing
                    }
                }
            }
        } finally {
            // Give Chrome time to process these updates before listening again
            setTimeout(() => { isUpdatingAccordion = false; }, 200);
        }
    }
});

async function scheduleUpdate(tabId) {
  // Always fetch fresh state from local storage first. 
  // This physically ensures that if Chrome just woke this service worker up,
  // we do not mutate an empty "amnesiac" array.
  const result = await chrome.storage.local.get(['tabOrder']);
  let currentOrder = result.tabOrder || [];

  // Move the interacted tab to the back of the array (The "HOT" end)
  currentOrder = currentOrder.filter(id => id !== tabId);
  currentOrder.push(tabId);
  
  await chrome.storage.local.set({ tabOrder: currentOrder });

  // Debounce the actual visual update so the browser doesn't stutter 
  if (updateTimeout) clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    executeHeatMapUpdate();
  }, 400);
}

// Pure function to calculate heat map chunks
function getTabChunks(windowTabs, tabOrder) {
    const validIdsInWindow = windowTabs.map(t => t.id);
    let currentWindowOrder = tabOrder.filter(id => validIdsInWindow.includes(id));
    const missingIds = validIdsInWindow.filter(id => !currentWindowOrder.includes(id));
    currentWindowOrder = [...missingIds, ...currentWindowOrder];
    
    const totalTabs = currentWindowOrder.length;
    let chunks = [];
    
    // The HOT group gets up to 10 tabs, specifically to keep more recent tabs visible
    let hotChunkStart = Math.max(0, totalTabs - 10);
    if (totalTabs > 0) {
        chunks.unshift(currentWindowOrder.slice(hotChunkStart, totalTabs));
    }
    
    // Older tabs are grouped into smaller chunks of 5 to provide a richer color gradient
    for (let i = hotChunkStart; i > 0; i -= 5) {
      let start = Math.max(0, i - 5);
      chunks.unshift(currentWindowOrder.slice(start, i));
    }
    return { chunks, currentWindowOrder };
}

async function applyHeatmapVisualsToWindow(win, windowTabs, chunks, isHotOnLeft) {
    // Find the first index available for unpinned tabs to anchor the stacking
    let nextExpectedIndex = windowTabs.filter(t => t.pinned).length;
    
    let usedGroupIds = new Set();
    const currentPhysicalOrder = windowTabs.map(t => t.id);
    
    // Retrieve the active expanded group from session storage, if any
    const sessionSettings = await chrome.storage.session.get(['lastExpandedGroupId']);
    const lastExpandedGroupId = sessionSettings.lastExpandedGroupId || null;

    for (let i = 0; i < chunks.length; i++) {
      let chunkIndex = isHotOnLeft ? (chunks.length - 1 - i) : i;
      let chunkIds = chunks[chunkIndex];
      
      if (chunkIds.length === 0) continue;
      
      // Sort the internal tabs in the chunk based on their pre-existing physical position
      // This ensures tabs don't randomly flip positions inside of a group.
      chunkIds.sort((a, b) => currentPhysicalOrder.indexOf(a) - currentPhysicalOrder.indexOf(b));
      
      const chunkDistanceFromRight = chunks.length - 1 - chunkIndex;
      const colorIndex = Math.max(0, HEAT_COLORS.length - 1 - chunkDistanceFromRight);
      const isHotGroup = (chunkDistanceFromRight === 0);
      const groupColor = HEAT_COLORS[colorIndex];
      const targetTitle = isHotGroup ? "HOT" : "";
      
      try {
        let targetGroupId = null;
        let needsGrouping = true;
        
        let groupCounts = {};
        for (let id of chunkIds) {
            const gId = windowTabs.find(t => t.id === id).groupId;
            if (gId !== chrome.tabGroups.TAB_GROUP_ID_NONE && !usedGroupIds.has(gId)) {
                groupCounts[gId] = (groupCounts[gId] || 0) + 1;
            }
        }
        
        let bestGroupId = null;
        let maxCount = 0;
        for (let gId in groupCounts) {
            if (groupCounts[gId] > maxCount) {
                maxCount = groupCounts[gId];
                bestGroupId = parseInt(gId);
            }
        }
        
        if (bestGroupId !== null) {
            usedGroupIds.add(bestGroupId);
            targetGroupId = bestGroupId;
            
            const allInSameGroup = chunkIds.length === maxCount;
            const allGroupMembersInWindow = windowTabs.filter(t => t.groupId === bestGroupId).map(t => t.id);
            const noExtraMembers = allGroupMembersInWindow.length === chunkIds.length;
            
            if (allInSameGroup && noExtraMembers) {
               needsGrouping = false;
            }
        }
        
        // Only physically recreate/assign the group if the membership changed
        if (needsGrouping) {
          const groupArgs = { tabIds: chunkIds };
          if (targetGroupId !== null) groupArgs.groupId = targetGroupId;
          targetGroupId = await chrome.tabs.group(groupArgs);
        }
        
        // It should be collapsed UNLESS it is the HOT group OR the last physical group the user explicitly expanded
        const targetCollapsed = !(isHotGroup || targetGroupId === lastExpandedGroupId);
        
        if (targetGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            const liveGroupTabs = await chrome.tabs.query({ windowId: win.id, groupId: targetGroupId });
            if (liveGroupTabs.length > 0) {
                const currentPhysicalIndex = liveGroupTabs[0].index;
                // Only physically rearrange the group if it is incorrectly placed.
                if (currentPhysicalIndex !== nextExpectedIndex) {
                    try {
                        await chrome.tabGroups.move(targetGroupId, { index: nextExpectedIndex });
                    } catch(e) { /* ignore moving edge case errors */ }
                }
                nextExpectedIndex += liveGroupTabs.length;
            }
            
            try {
                const currentGroupInfo = await chrome.tabGroups.get(targetGroupId);
                if (currentGroupInfo.color !== groupColor || 
                    currentGroupInfo.collapsed !== targetCollapsed || 
                    currentGroupInfo.title !== targetTitle) {
                    
                    await chrome.tabGroups.update(targetGroupId, { 
                      color: groupColor,
                      collapsed: targetCollapsed,
                      title: targetTitle
                    });
                }
            } catch (e) {
                // Handle case where group was destroyed explicitly by the user mid-iteration
            }
        }
      } catch(e) {
        console.error(`Error creating/updating group for color ${groupColor}:`, e);
      }
    }
}

async function executeHeatMapUpdate() {
  if (isScriptUpdatingGroups) return;
  isScriptUpdatingGroups = true;
  
  try {
    // Atomically fetch the state parameters to prevent overwriting bugs
    const settings = await chrome.storage.local.get(['sortDirection', 'tabOrder']);
    const isHotOnLeft = settings.sortDirection === 'left';
    let tabOrder = settings.tabOrder || [];
    
    // Purge globally dead tabs from master list to prevent ghost IDs
    const allOpenTabs = await chrome.tabs.query({});
    const allValidIds = allOpenTabs.map(t => t.id);
    
    // Apply purging and only save back to local storage if dead IDs were found
    const purgedTabOrder = tabOrder.filter(id => allValidIds.includes(id));
    if (purgedTabOrder.length !== tabOrder.length) {
        tabOrder = purgedTabOrder;
        await chrome.storage.local.set({ tabOrder });
    }

    const windows = await chrome.windows.getAll();
    
    // Process each window independently to prevent cross-window grouping errors
    for (const win of windows) {
      const windowTabs = await chrome.tabs.query({ windowId: win.id, pinned: false });
      if (windowTabs.length === 0) continue;

      const { chunks } = getTabChunks(windowTabs, tabOrder);
      await applyHeatmapVisualsToWindow(win, windowTabs, chunks, isHotOnLeft);
    }
  } catch (error) {
    console.error("Heat map processing failed", error);
  } finally {
    // Release the lock, but add a small delay to allow Chrome's async event queue
    // to drain any pending 'onUpdated' events fired by our API calls above.
    setTimeout(() => {
        isScriptUpdatingGroups = false;
    }, 500);
  }
}

// Allow popup to manually trigger updates
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'forceUpdate') {
        executeHeatMapUpdate();
    }
});
