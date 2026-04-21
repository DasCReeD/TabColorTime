const HEAT_COLORS = ['grey', 'pink', 'purple', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red'];
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

  // If this tab is already the most recent, skip the write entirely.
  // This prevents unnecessary storage churn and downstream UI recalculations
  // when the user clicks within the same group repeatedly.
  if (currentOrder.length > 0 && currentOrder[currentOrder.length - 1] === tabId) {
    return;
  }

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
    
    let colorChunks = Array(HEAT_COLORS.length).fill().map(() => []);
    let remainingTabs = [...currentWindowOrder];
    
    // Fill from hottest to coldest
    for (let c = HEAT_COLORS.length - 1; c >= 0; c--) {
        if (remainingTabs.length === 0) break;
        
        let takeCount = 5;
        if (c === HEAT_COLORS.length - 1) takeCount = 10;
        if (c === 0) takeCount = remainingTabs.length; // Sweep all remaining into grey
        
        let startIdx = Math.max(0, remainingTabs.length - takeCount);
        colorChunks[c] = remainingTabs.slice(startIdx);
        remainingTabs = remainingTabs.slice(0, startIdx);
    }
    
    return { chunks: colorChunks, currentWindowOrder };
}

async function applyHeatmapVisualsToWindow(win, windowTabs, chunks, isHotOnLeft) {
    let diagnosticApiCalls = 0;
    const currentPhysicalOrder = windowTabs.map(t => t.id);

    // 1. Calculate the ideal perfect visual sequence of tabs
    // This allows us to strictly evaluate physical DOM layout integrity before mutating anything via Chrome APIs.
    let idealChunkSequence = [];
    let orderedChunksIndices = [];
    for (let i = 0; i < chunks.length; i++) {
        let chunkIndex = isHotOnLeft ? (chunks.length - 1 - i) : i;
        orderedChunksIndices.push(chunkIndex);
        
        let chunkIds = chunks[chunkIndex];
        if (chunkIds.length > 0) {
            // Internal sorting to preserve native layout within the chunk bucket constraint
            let sortedChunk = chunkIds.slice().sort((a,b) => currentPhysicalOrder.indexOf(a) - currentPhysicalOrder.indexOf(b));
            idealChunkSequence.push(...sortedChunk);
        }
    }
    
    // 2. Validate current visual sequence against ideal
    const currentTrackedPhysicalOrder = currentPhysicalOrder.filter(id => idealChunkSequence.includes(id));
    const isPerfectlyOrdered = idealChunkSequence.every((val, index) => val === currentTrackedPhysicalOrder[index]);

    const sessionSettings = await chrome.storage.session.get(['lastExpandedGroupId']);
    const lastExpandedGroupId = sessionSettings.lastExpandedGroupId || null;
    let usedGroupIds = new Set();
    
    let nextExpectedIndex = windowTabs.filter(t => t.pinned).length;

    // 3. Process the groups structurally
    for (let chunkIndex of orderedChunksIndices) {
      let chunkIds = chunks[chunkIndex];
      if (chunkIds.length === 0) continue;
      
      chunkIds.sort((a, b) => currentPhysicalOrder.indexOf(a) - currentPhysicalOrder.indexOf(b));
      
      const isHotGroup = (chunkIndex === HEAT_COLORS.length - 1);
      const groupColor = HEAT_COLORS[chunkIndex];
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
        
        if (needsGrouping) {
          diagnosticApiCalls++;
          const groupArgs = { tabIds: chunkIds };
          if (targetGroupId !== null) groupArgs.groupId = targetGroupId;
          targetGroupId = await chrome.tabs.group(groupArgs);
        }
        
        const targetCollapsed = !(isHotGroup || targetGroupId === lastExpandedGroupId);
        
        if (targetGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            // Only force Chromium to slide the DOM around if the mathematical sequence fails validation!
            if (!isPerfectlyOrdered) {
               diagnosticApiCalls++;
               try {
                   await chrome.tabGroups.move(targetGroupId, { index: nextExpectedIndex });
               } catch(e) {}
            }
            nextExpectedIndex += chunkIds.length;
            
            try {
                const currentGroupInfo = await chrome.tabGroups.get(targetGroupId);
                if (currentGroupInfo.color !== groupColor || 
                    currentGroupInfo.collapsed !== targetCollapsed || 
                    currentGroupInfo.title !== targetTitle) {
                    
                    diagnosticApiCalls++;
                    await chrome.tabGroups.update(targetGroupId, { 
                      color: groupColor,
                      collapsed: targetCollapsed,
                      title: targetTitle
                    });
                }
            } catch (e) {
            }
        }
      } catch(e) {
        console.error(`Error processing color ${groupColor}:`, e);
      }
    }
    
    return diagnosticApiCalls;
}

async function executeHeatMapUpdate(force = false) {
  if (isScriptUpdatingGroups) return;
  isScriptUpdatingGroups = true;
  
  try {
    // Atomically fetch the state parameters to prevent overwriting bugs
    const settings = await chrome.storage.local.get(['sortDirection', 'tabOrder', 'windowFingerprints']);
    const isHotOnLeft = settings.sortDirection === 'left';
    let tabOrder = settings.tabOrder || [];
    const windowFingerprints = settings.windowFingerprints || {};
    
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
      
      // Build a deterministic fingerprint of the mathematical layout
      const fingerprint = isHotOnLeft + "|" + chunks.map(c => c.slice().sort().join(',')).join('|');
      
      if (!force && windowFingerprints[win.id] === fingerprint) {
          continue; // Grouping boundaries are unchanged. Skip UI APIs to completely prevent visual "bouncing".
      }
      windowFingerprints[win.id] = fingerprint;
      
      const apiCallsMade = await applyHeatmapVisualsToWindow(win, windowTabs, chunks, isHotOnLeft);
      // Optional logging for diagnostic use
      if (apiCallsMade > 0) console.log(`Window ${win.id} required ${apiCallsMade} UI API calls to stabilize.`);
    }
    
    await chrome.storage.local.set({ windowFingerprints });
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
        executeHeatMapUpdate(true);
    }
});
