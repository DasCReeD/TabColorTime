# TabColorTime

A Chrome extension that visually organizes your browser tabs into a color-coded "heat map" based on exactly how recently you interacted with them. 

TabColorTime natively leverages Chrome's Tab Groups feature to dynamically group tabs into sequential color blocks. Instead of hunting through tiny icons, you can immediately identify your most active workflow (hottest elements) naturally fading down to your oldest background references (coldest elements).

## Features

- **Recency-Based Heat Map**: Tabs are systematically sorted every time you click them. The newest tabs go straight into the "HOT" group.
- **7-Tier Thermal Gradient**: Built using a strict, visually intuitive thermal progression:
  1. Red (Hottest - Most recent)
  2. Orange (Very Warm)
  3. Yellow (Warm)
  4. Green (Cool)
  5. Cyan (Cold)
  6. Blue (Freezing)
  7. Grey (Dead - Oldest tabs)
- **Accordion Fisheye UI**: To save space horizontally, only your primary "HOT" group and the last group you explicitly clicked remain physically expanded. All older tab groups automatically collapse into tiny colored headers.
- **Dynamic Orientation**: Prefer your active tabs on the left edge? Click the extension's icon to quickly flip the stack generation to order from Left-to-Right or Right-to-Left instantly.
- **Debounced Rendering**: Employs a precisely timed delay so that rapid tab switching acts seamlessly without inducing UI stutter.
- **Painless Re-organization**: Features a surgical placement tracking system so tabs perfectly align across UI loops without causing "conveyor-belt" scrolling errors natively seen in automated group sorting.

## Installation

1. Clone or download this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** via the toggle in the top-right corner.
4. Click **Load unpacked**.
5. Select the directory where you saved the repository.
6. The extension is now installed. Pin its icon in Chrome to easily toggle the Right/Left layout!

## Under the Hood

TabColorTime natively adheres to strict **Manifest V3 Architecture**. It actively listens to tab focus shifting (`chrome.tabs.onActivated`), new tab spawns (`chrome.tabs.onCreated`), and audio playing (`chrome.tabs.onUpdated`). Tab metadata and lock states are sequentially stored and atomically retrieved from `chrome.storage.local` and `chrome.storage.session` to ensure tab history perfectly persists through aggressive service worker suspensions and browser restarts.
