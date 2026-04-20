const CDP = require('chrome-remote-interface');
async function run() {
  let client;
  try {
    client = await CDP({target: t => t.url && t.url.includes('mlpafghgmighkeccbkpjeieokpjhnido'), host: '127.0.0.1', port: 9222});
    await client.Runtime.enable();
    
    // Inject a console log listener
    client.Runtime.consoleAPICalled(({args}) => {
      console.log('EXT-LOG:', args.map(a => a.value || a.description).join(' '));
    });
    
    console.log('Querying current groups...');
    const groupsBefore = JSON.parse((await client.Runtime.evaluate({expression: 'chrome.tabGroups.query({}).then(g=>JSON.stringify(g))', awaitPromise: true})).result.value);
    console.log('Groups Before:', groupsBefore.map(g => `${g.color}(${g.id})[${g.collapsed?'C':'E'}]`).join(', '));
    
    const hotGroupId = groupsBefore.find(g => g.color === 'red').id;

    console.log('Setting to left-to-right (isHotOnLeft = true) ...');
    await client.Runtime.evaluate({expression: 'chrome.storage.local.set({sortDirection: "left"})', awaitPromise: true});
    await client.Runtime.evaluate({expression: 'executeHeatMapUpdate(true)', awaitPromise: true});
    
    await new Promise(r => setTimeout(r, 2000));
    const groupsAfter = JSON.parse((await client.Runtime.evaluate({expression: 'chrome.tabGroups.query({}).then(g=>JSON.stringify(g))', awaitPromise: true})).result.value);
    console.log('Groups After:', groupsAfter.map(g => `${g.color}(${g.id})[${g.collapsed?'C':'E'}]`).join(', '));

    console.log('Triggering tab activation mathematically instead of physically...');
    // We can directly call scheduleUpdate(someTabId) to avoid UI interference
    // Let's find two tabs in the HOT group
    const tabs = JSON.parse((await client.Runtime.evaluate({expression: 'chrome.tabs.query({groupId: '+hotGroupId+'}).then(t=>JSON.stringify(t))', awaitPromise: true})).result.value);
    
    console.log('Activating tab:', tabs[0].id);
    await client.Runtime.evaluate({expression: 'chrome.tabs.update(' + tabs[0].id + ', {active: true})', awaitPromise: true});
    
    // The debounce timer is 400ms. Wait 2 seconds.
    await new Promise(r => setTimeout(r, 2000));
    const groupsAfter1 = JSON.parse((await client.Runtime.evaluate({expression: 'chrome.tabGroups.query({}).then(g=>JSON.stringify(g))', awaitPromise: true})).result.value);
    console.log('Groups After Tab 1:', groupsAfter1.map(g => `${g.color}(${g.id})[${g.collapsed?'C':'E'}]`).join(', '));

    console.log('Activating tab:', tabs[1].id);
    await client.Runtime.evaluate({expression: 'chrome.tabs.update(' + tabs[1].id + ', {active: true})', awaitPromise: true});
    
    await new Promise(r => setTimeout(r, 2000));
    const groupsAfter2 = JSON.parse((await client.Runtime.evaluate({expression: 'chrome.tabGroups.query({}).then(g=>JSON.stringify(g))', awaitPromise: true})).result.value);
    console.log('Groups After Tab 2:', groupsAfter2.map(g => `${g.color}(${g.id})[${g.collapsed?'C':'E'}]`).join(', '));

  } catch (err) {
    console.error(err);
  } finally {
    if (client) await client.close();
  }
}
run();
