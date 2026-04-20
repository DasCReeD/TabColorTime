const HEAT_COLORS = ['grey', 'pink', 'purple', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red'];

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

// Mock state: 12 tabs
let windowTabs = [];
let tabOrder = [];
for (let i=1; i<=12; i++) {
    windowTabs.push({id: i, index: i-1});
    tabOrder.push(i); // 1 is oldest, 12 is newest
}

console.log("INITIAL STATE (Clicking tab 12)");
let { chunks } = getTabChunks(windowTabs, tabOrder);
let isHotOnLeft = true;
let fingerprint = isHotOnLeft + "|" + chunks.map(c => c.slice().sort().join(',')).join('|');
console.log("Fingerprint:", fingerprint);

console.log("\nSIMULATING SWITCH TO TAB 10 (inside HOT group)");
tabOrder = tabOrder.filter(id => id !== 10);
tabOrder.push(10); // 10 is now the newest
let { chunks: chunks2 } = getTabChunks(windowTabs, tabOrder);
let fingerprint2 = isHotOnLeft + "|" + chunks2.map(c => c.slice().sort().join(',')).join('|');
console.log("Fingerprint:", fingerprint2);
console.log("Matches?", fingerprint === fingerprint2);

console.log("\nSIMULATING SWITCH TO TAB 2 (in Grey group limit - crosses boundary!)");
tabOrder = tabOrder.filter(id => id !== 2);
tabOrder.push(2);
let { chunks: chunks3 } = getTabChunks(windowTabs, tabOrder);
let fingerprint3 = isHotOnLeft + "|" + chunks3.map(c => c.slice().sort().join(',')).join('|');
console.log("Fingerprint:", fingerprint3);
console.log("Matches state 2?", fingerprint2 === fingerprint3);
