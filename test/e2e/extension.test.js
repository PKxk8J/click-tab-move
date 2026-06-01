import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Builder, By, until } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'
import { download } from 'geckodriver'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const EXTENSION_DIR = resolve(ROOT_DIR, 'extension')
const WAIT_MS = 15_000

let driver
let extensionBaseUrl

async function createDriver () {
  const geckoDriverPath = process.env.GECKODRIVER_PATH || await download()
  const options = new firefox.Options()
  options.addArguments('-remote-allow-system-access')
  if (process.env.E2E_HEADLESS !== '0') {
    options.addArguments('-headless')
  }
  if (process.env.FIREFOX_BINARY) {
    options.setBinary(process.env.FIREFOX_BINARY)
  }

  return new Builder().
    forBrowser('firefox').
    setFirefoxOptions(options).
    setFirefoxService(new firefox.ServiceBuilder(geckoDriverPath)).
    build()
}

async function getExtensionBaseUrl (addonId) {
  await driver.setContext(firefox.Context.CHROME)
  try {
    return await driver.executeScript(`
      const policy = WebExtensionPolicy.getByID(arguments[0])
      return policy?.getURL('') || null
    `, addonId)
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

async function openExtensionPage (path) {
  await driver.get(extensionBaseUrl + path)
}

async function openFreshOptionsPage () {
  await openExtensionPage('options.html')
  await waitForOptionsPage()
  await runExtensionScript('await browser.storage.sync.clear()')
  await driver.navigate().refresh()
  await waitForOptionsPage()
}

async function waitForOptionsPage () {
  await driver.wait(until.elementLocated(By.id('contexts_tab')), WAIT_MS)
  await driver.wait(async () => {
    return await driver.executeScript(`
      return document.getElementById('label_name')?.textContent === 'ClickTabMove' &&
        document.getElementById('width')?.value !== ''
    `)
  }, WAIT_MS)
}

async function runExtensionScript (script, ...args) {
  const result = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1]
    const args = Array.from(arguments).slice(0, -1)

    async function run () {
      const wait = msec => new Promise(resolve => setTimeout(resolve, msec))
      async function waitUntil (predicate, timeout = 5000) {
        const startedAt = Date.now()
        while (Date.now() - startedAt < timeout) {
          const value = await predicate()
          if (value) {
            return value
          }
          await wait(100)
        }
        return await predicate()
      }

      ${script}
    }

    run().then(
      value => done({ ok: true, value }),
      error => done({
        ok: false,
        message: error?.message || String(error),
        stack: error?.stack || '',
      }),
    )
  `, ...args)

  if (!result.ok) {
    throw new Error(result.stack || result.message)
  }
  return result.value
}

async function getStorageData () {
  return await runExtensionScript('return await browser.storage.sync.get()')
}

async function waitForStorageData (predicate, description) {
  let latest
  await driver.wait(async () => {
    latest = await getStorageData()
    return predicate(latest)
  }, WAIT_MS, description)
  return latest
}

async function setInputValue (id, value) {
  const input = await driver.findElement(By.id(id))
  await driver.executeScript(`
    arguments[0].value = String(arguments[1])
    arguments[0].dispatchEvent(new Event('input', { bubbles: true }))
    arguments[0].dispatchEvent(new Event('change', { bubbles: true }))
  `, input, value)
}

async function setCheckboxValue (id, checked) {
  const input = await driver.findElement(By.id(id))
  if (await input.isSelected() !== checked) {
    await input.click()
  }
}

async function setSelectValue (id, value) {
  const select = await driver.findElement(By.id(id))
  await driver.executeScript(`
    arguments[0].value = arguments[1]
    arguments[0].dispatchEvent(new Event('change', { bubbles: true }))
  `, select, value)
}

async function getInputValue (id) {
  return await (await driver.findElement(By.id(id))).getAttribute('value')
}

async function findWindowHandle (predicate) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < WAIT_MS) {
    for (const handle of await driver.getAllWindowHandles()) {
      await driver.switchTo().window(handle)
      const url = await driver.getCurrentUrl().catch(() => '')
      if (predicate(url)) {
        return handle
      }
    }
    await driver.sleep(100)
  }
  throw new Error('matching window handle was not found')
}

describe('Firefox extension E2E', () => {
  before(async () => {
    driver = await createDriver()
    const addonId = await driver.installAddon(EXTENSION_DIR, true)
    extensionBaseUrl = await getExtensionBaseUrl(addonId)
    assert.ok(extensionBaseUrl, '拡張機能の moz-extension URL を取得できません')
  })

  after(async () => {
    if (driver) {
      await driver.quit()
    }
  })

  test('options page saves settings and restores them after reload', async () => {
    await openFreshOptionsPage()

    assert.equal(await getInputValue('width'), '640')
    assert.equal(await getInputValue('height'), '480')
    assert.equal(await (await driver.findElement(By.id('contexts_tab'))).isSelected(), true)
    assert.equal(await (await driver.findElement(By.id('contexts_all'))).isSelected(), false)

    await setInputValue('width', 777)
    await setInputValue('height', 333)
    await setCheckboxValue('contexts_all', true)
    await setCheckboxValue('menuItems_global_right', false)
    await setCheckboxValue('focus', true)
    await setSelectValue('pinnedGroupAction', 'skipPinned')

    await waitForStorageData((data) => {
      return data.selectSize?.[0] === 777 &&
        data.selectSize?.[1] === 333 &&
        data.contexts?.includes('all') &&
        !data.menuItems?.right &&
        data.focus === true &&
        data.pinnedGroupAction === 'skipPinned'
    }, 'options page settings were not saved')

    await driver.navigate().refresh()
    await waitForOptionsPage()

    assert.equal(await getInputValue('width'), '777')
    assert.equal(await getInputValue('height'), '333')
    assert.equal(await (await driver.findElement(By.id('contexts_all'))).isSelected(), true)
    assert.equal(await (await driver.findElement(By.id('menuItems_global_right'))).isSelected(), false)
    assert.equal(await (await driver.findElement(By.id('focus'))).isSelected(), true)
    assert.equal(await getInputValue('pinnedGroupAction'), 'skipPinned')
  })

  test('background move message moves a tab to another Firefox window', async () => {
    await openFreshOptionsPage()

    const result = await runExtensionScript(`
      let sourceTab
      let targetWindow
      try {
        sourceTab = await browser.tabs.create({
          active: true,
          url: 'about:blank',
        })
        targetWindow = await browser.windows.create({
          focused: false,
          url: 'about:blank',
        })

        await browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: [sourceTab.id],
          destination: {
            type: 'window',
            windowId: targetWindow.id,
          },
          targetScope: 'global',
          sourceWindowId: sourceTab.windowId,
          notification: false,
          focus: false,
        })

        let movedTab
        for (let i = 0; i < 50; i++) {
          movedTab = await browser.tabs.get(sourceTab.id)
          if (movedTab.windowId === targetWindow.id) {
            break
          }
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        const targetTabs = await browser.tabs.query({
          windowId: targetWindow.id,
        })

        return {
          movedWindowId: movedTab.windowId,
          sourceTabId: sourceTab.id,
          sourceWindowId: sourceTab.windowId,
          targetTabIds: targetTabs.map(tab => tab.id),
          targetWindowId: targetWindow.id,
        }
      } finally {
        if (targetWindow) {
          await browser.windows.remove(targetWindow.id).catch(() => {})
        }
        if (sourceTab) {
          await browser.tabs.remove(sourceTab.id).catch(() => {})
        }
      }
    `)

    assert.equal(result.movedWindowId, result.targetWindowId)
    assert.notEqual(result.sourceWindowId, result.targetWindowId)
    assert.ok(result.targetTabIds.includes(result.sourceTabId))
  })

  test('selected tabs move to a new Firefox window in source order', async () => {
    await openFreshOptionsPage()

    const result = await runExtensionScript(`
      const createdTabs = []
      try {
        createdTabs.push(await browser.tabs.create({
          active: false,
          url: 'about:blank',
        }))
        createdTabs.push(await browser.tabs.create({
          active: false,
          url: 'about:blank',
        }))

        await browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: createdTabs.map(tab => tab.id),
          destination: {
            type: 'newWindow',
          },
          targetScope: 'global',
          sourceWindowId: createdTabs[0].windowId,
          notification: false,
          focus: false,
        })

        const movedTabs = await waitUntil(async () => {
          const tabs = []
          for (const tab of createdTabs) {
            tabs.push(await browser.tabs.get(tab.id))
          }
          const movedWindowId = tabs[0].windowId
          if (movedWindowId !== createdTabs[0].windowId &&
              tabs.every(tab => tab.windowId === movedWindowId)) {
            return tabs
          }
        })
        const targetTabs = await browser.tabs.query({
          windowId: movedTabs[0].windowId,
        })
        targetTabs.sort((tab1, tab2) => tab1.index - tab2.index)

        return {
          movedWindowId: movedTabs[0].windowId,
          sourceTabIds: createdTabs.map(tab => tab.id),
          sourceWindowId: createdTabs[0].windowId,
          targetTabIds: targetTabs.map(tab => tab.id),
        }
      } finally {
        for (const tab of createdTabs) {
          await browser.tabs.remove(tab.id).catch(() => {})
        }
      }
    `)

    assert.notEqual(result.movedWindowId, result.sourceWindowId)
    assert.deepEqual(result.targetTabIds, result.sourceTabIds)
  })

  test('pinned tab stays pinned after moving to another Firefox window', async () => {
    await openFreshOptionsPage()

    const result = await runExtensionScript(`
      let sourceTab
      let targetWindow
      try {
        sourceTab = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        sourceTab = await browser.tabs.update(sourceTab.id, {
          pinned: true,
        })
        targetWindow = await browser.windows.create({
          focused: false,
          url: 'about:blank',
        })

        await browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: [sourceTab.id],
          destination: {
            type: 'window',
            windowId: targetWindow.id,
          },
          targetScope: 'global',
          sourceWindowId: sourceTab.windowId,
          notification: false,
          focus: false,
        })

        const movedTab = await waitUntil(async () => {
          const tab = await browser.tabs.get(sourceTab.id)
          if (tab.windowId === targetWindow.id && tab.pinned) {
            return tab
          }
        })
        const targetTabs = await browser.tabs.query({
          windowId: targetWindow.id,
        })
        targetTabs.sort((tab1, tab2) => tab1.index - tab2.index)

        return {
          movedIndex: movedTab.index,
          movedPinned: movedTab.pinned,
          movedWindowId: movedTab.windowId,
          sourceTabId: sourceTab.id,
          sourceWindowId: sourceTab.windowId,
          targetPinnedTabIds: targetTabs.
            filter(tab => tab.pinned).
            map(tab => tab.id),
          targetWindowId: targetWindow.id,
        }
      } finally {
        if (targetWindow) {
          await browser.windows.remove(targetWindow.id).catch(() => {})
        }
        if (sourceTab) {
          await browser.tabs.remove(sourceTab.id).catch(() => {})
        }
      }
    `)

    assert.equal(result.movedWindowId, result.targetWindowId)
    assert.notEqual(result.sourceWindowId, result.targetWindowId)
    assert.equal(result.movedPinned, true)
    assert.equal(result.movedIndex, 0)
    assert.deepEqual(result.targetPinnedTabIds, [result.sourceTabId])
  })

  test('selected tabs move into a new Firefox tab group', async () => {
    await openFreshOptionsPage()

    const result = await runExtensionScript(`
      const createdTabs = []
      try {
        createdTabs.push(await browser.tabs.create({
          active: false,
          url: 'about:blank',
        }))
        createdTabs.push(await browser.tabs.create({
          active: false,
          url: 'about:blank',
        }))

        await browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: createdTabs.map(tab => tab.id),
          destination: {
            type: 'newGroup',
          },
          targetScope: 'global',
          sourceWindowId: createdTabs[0].windowId,
          notification: false,
          focus: false,
        })

        const groupedTabs = await waitUntil(async () => {
          const tabs = []
          for (const tab of createdTabs) {
            tabs.push(await browser.tabs.get(tab.id))
          }
          const groupId = tabs[0].groupId
          if (groupId !== browser.tabGroups.TAB_GROUP_ID_NONE &&
              tabs.every(tab => tab.groupId === groupId)) {
            return tabs
          }
        })

        return {
          groupIds: groupedTabs.map(tab => tab.groupId),
          tabIds: groupedTabs.map(tab => tab.id),
          windowIds: groupedTabs.map(tab => tab.windowId),
        }
      } finally {
        for (const tab of createdTabs) {
          await browser.tabs.remove(tab.id).catch(() => {})
        }
      }
    `)

    assert.equal(result.tabIds.length, 2)
    assert.notEqual(result.groupIds[0], -1)
    assert.equal(new Set(result.groupIds).size, 1)
    assert.equal(new Set(result.windowIds).size, 1)
  })

  test('moving all tabs from one window to another closes the source window', async () => {
    await openFreshOptionsPage()

    const result = await runExtensionScript(`
      let sourceWindow
      let targetWindow
      try {
        sourceWindow = await browser.windows.create({
          focused: false,
          url: 'about:blank',
        })
        const secondSourceTab = await browser.tabs.create({
          active: false,
          windowId: sourceWindow.id,
          url: 'about:blank',
        })
        targetWindow = await browser.windows.create({
          focused: false,
          url: 'about:blank',
        })
        const sourceTabIds = [
          sourceWindow.tabs[0].id,
          secondSourceTab.id,
        ]

        await browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: sourceTabIds,
          destination: {
            type: 'window',
            windowId: targetWindow.id,
          },
          targetScope: 'global',
          sourceWindowId: sourceWindow.id,
          notification: false,
          focus: false,
        })

        const moved = await waitUntil(async () => {
          const targetTabs = await browser.tabs.query({
            windowId: targetWindow.id,
          })
          const targetTabIds = targetTabs.
            sort((tab1, tab2) => tab1.index - tab2.index).
            map(tab => tab.id)
          const sourceClosed = await browser.windows.get(sourceWindow.id).
            then(() => false, () => true)
          if (sourceClosed &&
              sourceTabIds.every(tabId => targetTabIds.includes(tabId))) {
            return { sourceClosed, sourceTabIds, targetTabIds }
          }
        })
        if (!moved) {
          throw new Error('source window did not close after moving all tabs')
        }
        return moved
      } finally {
        if (targetWindow) {
          await browser.windows.remove(targetWindow.id).catch(() => {})
        }
        if (sourceWindow) {
          await browser.windows.remove(sourceWindow.id).catch(() => {})
        }
      }
    `)

    assert.equal(result.sourceClosed, true)
    assert.deepEqual(result.targetTabIds.slice(-2), result.sourceTabIds)
  })

  test('whole tab group stays grouped after moving to another window', async () => {
    await openFreshOptionsPage()

    const result = await runExtensionScript(`
      const createdTabs = []
      let targetWindow
      try {
        createdTabs.push(await browser.tabs.create({
          active: false,
          url: 'about:blank',
        }))
        createdTabs.push(await browser.tabs.create({
          active: false,
          url: 'about:blank',
        }))
        const groupId = await browser.tabs.group({
          tabIds: createdTabs.map(tab => tab.id),
        })
        targetWindow = await browser.windows.create({
          focused: false,
          url: 'about:blank',
        })

        await browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: createdTabs.map(tab => tab.id),
          destination: {
            type: 'window',
            windowId: targetWindow.id,
          },
          targetScope: 'global',
          sourceWindowId: createdTabs[0].windowId,
          notification: false,
          focus: false,
        })

        const movedTabs = await waitUntil(async () => {
          const tabs = []
          for (const tab of createdTabs) {
            tabs.push(await browser.tabs.get(tab.id))
          }
          if (tabs.every(tab => tab.windowId === targetWindow.id &&
              tab.groupId === groupId)) {
            return tabs
          }
        })
        if (!movedTabs) {
          throw new Error('group did not move to the target window')
        }
        return {
          groupId,
          movedGroupIds: movedTabs.map(tab => tab.groupId),
          movedWindowIds: movedTabs.map(tab => tab.windowId),
          targetWindowId: targetWindow.id,
        }
      } finally {
        if (targetWindow) {
          await browser.windows.remove(targetWindow.id).catch(() => {})
        }
        for (const tab of createdTabs) {
          await browser.tabs.remove(tab.id).catch(() => {})
        }
      }
    `)

    assert.deepEqual(result.movedGroupIds, [result.groupId, result.groupId])
    assert.deepEqual(result.movedWindowIds, [
      result.targetWindowId,
      result.targetWindowId,
    ])
  })

  test('selected tabs merge into an existing Firefox tab group', async () => {
    await openFreshOptionsPage()

    const result = await runExtensionScript(`
      const createdTabs = []
      try {
        const destinationTab = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        const movingTab1 = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        const movingTab2 = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        createdTabs.push(destinationTab, movingTab1, movingTab2)
        const destinationGroupId = await browser.tabs.group({
          tabIds: [destinationTab.id],
        })

        await browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: [movingTab1.id, movingTab2.id],
          destination: {
            type: 'group',
            groupId: destinationGroupId,
          },
          targetScope: 'global',
          sourceWindowId: movingTab1.windowId,
          notification: false,
          focus: false,
        })

        const groupedTabs = await waitUntil(async () => {
          const tabs = []
          for (const tab of createdTabs) {
            tabs.push(await browser.tabs.get(tab.id))
          }
          if (tabs.every(tab => tab.groupId === destinationGroupId)) {
            return tabs
          }
        })
        if (!groupedTabs) {
          throw new Error('tabs did not merge into destination group')
        }
        return {
          destinationGroupId,
          groupIds: groupedTabs.map(tab => tab.groupId),
          tabIds: groupedTabs.map(tab => tab.id),
        }
      } finally {
        for (const tab of createdTabs) {
          await browser.tabs.remove(tab.id).catch(() => {})
        }
      }
    `)

    assert.equal(result.tabIds.length, 3)
    assert.deepEqual(result.groupIds, [
      result.destinationGroupId,
      result.destinationGroupId,
      result.destinationGroupId,
    ])
  })

  test('skip pinned setting leaves pinned tabs outside a new group', async () => {
    await openFreshOptionsPage()

    const result = await runExtensionScript(`
      const createdTabs = []
      try {
        await browser.storage.sync.set({
          pinnedGroupAction: 'skipPinned',
        })
        const pinnedTab = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        await browser.tabs.update(pinnedTab.id, {
          pinned: true,
        })
        const unpinnedTab = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        createdTabs.push(pinnedTab, unpinnedTab)

        await browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: createdTabs.map(tab => tab.id),
          destination: {
            type: 'newGroup',
          },
          targetScope: 'global',
          sourceWindowId: pinnedTab.windowId,
          notification: false,
          focus: false,
        })

        const finalTabs = await waitUntil(async () => {
          const pinned = await browser.tabs.get(pinnedTab.id)
          const unpinned = await browser.tabs.get(unpinnedTab.id)
          if (pinned.pinned &&
              pinned.groupId === browser.tabGroups.TAB_GROUP_ID_NONE &&
              unpinned.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
            return { pinned, unpinned }
          }
        })
        if (!finalTabs) {
          throw new Error('skipPinned did not leave the pinned tab outside group')
        }
        return {
          noneGroupId: browser.tabGroups.TAB_GROUP_ID_NONE,
          pinnedGroupId: finalTabs.pinned.groupId,
          pinnedPinned: finalTabs.pinned.pinned,
          unpinnedGroupId: finalTabs.unpinned.groupId,
        }
      } finally {
        for (const tab of createdTabs) {
          await browser.tabs.remove(tab.id).catch(() => {})
        }
      }
    `)

    assert.equal(result.pinnedPinned, true)
    assert.equal(result.pinnedGroupId, result.noneGroupId)
    assert.notEqual(result.unpinnedGroupId, result.noneGroupId)
  })

  test('unpin pinned setting groups pinned tabs after unpinning them', async () => {
    await openFreshOptionsPage()

    const result = await runExtensionScript(`
      const createdTabs = []
      try {
        await browser.storage.sync.set({
          pinnedGroupAction: 'unpinPinned',
        })
        const pinnedTab = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        await browser.tabs.update(pinnedTab.id, {
          pinned: true,
        })
        const unpinnedTab = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        createdTabs.push(pinnedTab, unpinnedTab)

        await browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: createdTabs.map(tab => tab.id),
          destination: {
            type: 'newGroup',
          },
          targetScope: 'global',
          sourceWindowId: pinnedTab.windowId,
          notification: false,
          focus: false,
        })

        const groupedTabs = await waitUntil(async () => {
          const pinned = await browser.tabs.get(pinnedTab.id)
          const unpinned = await browser.tabs.get(unpinnedTab.id)
          if (!pinned.pinned &&
              pinned.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE &&
              pinned.groupId === unpinned.groupId) {
            return [pinned, unpinned]
          }
        })
        if (!groupedTabs) {
          throw new Error('unpinPinned did not group the selected tabs')
        }
        return {
          groupIds: groupedTabs.map(tab => tab.groupId),
          noneGroupId: browser.tabGroups.TAB_GROUP_ID_NONE,
          pinnedStates: groupedTabs.map(tab => tab.pinned),
        }
      } finally {
        for (const tab of createdTabs) {
          await browser.tabs.remove(tab.id).catch(() => {})
        }
      }
    `)

    assert.deepEqual(result.pinnedStates, [false, false])
    assert.notEqual(result.groupIds[0], result.noneGroupId)
    assert.equal(new Set(result.groupIds).size, 1)
  })

  test('select window moves only checked tabs to the chosen window', async () => {
    await openFreshOptionsPage()

    const optionsHandle = await driver.getWindowHandle()
    let setup
    try {
      setup = await runExtensionScript(`
        const sourceWindow = await browser.windows.create({
          focused: false,
          url: 'about:blank',
        })
        const secondSourceTab = await browser.tabs.create({
          active: false,
          windowId: sourceWindow.id,
          url: 'about:blank',
        })
        const targetWindow = await browser.windows.create({
          focused: false,
          url: 'about:blank',
        })
        await browser.windows.create({
          type: 'detached_panel',
          url: browser.runtime.getURL('select.html'),
          width: 640,
          height: 480,
        })
        return {
          sourceTabs: [
            { id: sourceWindow.tabs[0].id, windowId: sourceWindow.id },
            { id: secondSourceTab.id, windowId: sourceWindow.id },
          ],
          sourceWindowId: sourceWindow.id,
          targetWindowId: targetWindow.id,
        }
      `)

      const selectHandle = await findWindowHandle(url =>
        url.endsWith('/select.html'))
      await driver.switchTo().window(optionsHandle)
      await runExtensionScript(`
        const setup = args[0]
        await browser.runtime.sendMessage({
          type: 'reset',
          fromWindowId: setup.sourceWindowId,
          targetScope: 'global',
          destination: {
            type: 'window',
            windowId: setup.targetWindowId,
          },
          notification: false,
          focus: false,
        })
      `, setup)

      await driver.switchTo().window(selectHandle)
      await driver.wait(async () => {
        return await driver.executeScript(`
          return document.querySelectorAll('#select input[type="checkbox"]').
            length === 2
        `)
      }, WAIT_MS)
      assert.equal(await driver.executeScript(`
        return document.getElementById('move').disabled
      `), true)

      const checkboxes = await driver.findElements(By.css(
        '#select input[type="checkbox"]',
      ))
      await checkboxes[0].click()
      assert.equal(await driver.executeScript(`
        return document.getElementById('move').disabled
      `), false)
      await driver.findElement(By.id('move')).click()
      await driver.wait(async () => {
        return !(await driver.getAllWindowHandles()).includes(selectHandle)
      }, WAIT_MS)

      await driver.switchTo().window(optionsHandle)
      const result = await runExtensionScript(`
        const setup = args[0]
        const moved = await browser.tabs.get(setup.sourceTabs[0].id)
        const stayed = await browser.tabs.get(setup.sourceTabs[1].id)
        return {
          movedWindowId: moved.windowId,
          sourceWindowId: setup.sourceWindowId,
          stayedWindowId: stayed.windowId,
          targetWindowId: setup.targetWindowId,
        }
      `, setup)

      assert.equal(result.movedWindowId, result.targetWindowId)
      assert.equal(result.stayedWindowId, result.sourceWindowId)
    } finally {
      if (setup) {
        await driver.switchTo().window(optionsHandle).catch(() => {})
        await runExtensionScript(`
          const setup = args[0]
          await browser.windows.remove(setup.targetWindowId).catch(() => {})
          await browser.windows.remove(setup.sourceWindowId).catch(() => {})
        `, setup).catch(() => {})
      }
    }
  })

  test('pinned confirmation dialog can skip pinned tabs without remembering', async () => {
    await openFreshOptionsPage()

    const optionsHandle = await driver.getWindowHandle()
    let setup
    try {
      setup = await runExtensionScript(`
        const pinnedTab = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        await browser.tabs.update(pinnedTab.id, {
          pinned: true,
        })
        const unpinnedTab = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: [pinnedTab.id, unpinnedTab.id],
          destination: {
            type: 'newGroup',
          },
          targetScope: 'global',
          sourceWindowId: pinnedTab.windowId,
          notification: false,
          focus: false,
        }).catch(console.error)
        return {
          pinnedTabId: pinnedTab.id,
          unpinnedTabId: unpinnedTab.id,
        }
      `)

      const dialogHandle = await findWindowHandle(url =>
        url.includes('/pinned.html?'))
      await driver.wait(until.elementLocated(By.id('skipPinned')), WAIT_MS)
      assert.equal(await driver.findElement(By.id('remember')).isSelected(),
        false)
      await driver.findElement(By.id('skipPinned')).click()
      await driver.wait(async () => {
        return !(await driver.getAllWindowHandles()).includes(dialogHandle)
      }, WAIT_MS)

      await driver.switchTo().window(optionsHandle)
      const result = await runExtensionScript(`
        const setup = args[0]
        const finalTabs = await waitUntil(async () => {
          const pinned = await browser.tabs.get(setup.pinnedTabId)
          const unpinned = await browser.tabs.get(setup.unpinnedTabId)
          if (pinned.groupId === browser.tabGroups.TAB_GROUP_ID_NONE &&
              unpinned.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
            return { pinned, unpinned }
          }
        })
        if (!finalTabs) {
          throw new Error('dialog decision did not move only the unpinned tab')
        }
        const storage = await browser.storage.sync.get('pinnedGroupAction')
        return {
          noneGroupId: browser.tabGroups.TAB_GROUP_ID_NONE,
          pinnedGroupId: finalTabs.pinned.groupId,
          pinnedPinned: finalTabs.pinned.pinned,
          remembered: Object.hasOwn(storage, 'pinnedGroupAction'),
          unpinnedGroupId: finalTabs.unpinned.groupId,
        }
      `, setup)

      assert.equal(result.pinnedPinned, true)
      assert.equal(result.pinnedGroupId, result.noneGroupId)
      assert.notEqual(result.unpinnedGroupId, result.noneGroupId)
      assert.equal(result.remembered, false)
    } finally {
      if (setup) {
        await driver.switchTo().window(optionsHandle).catch(() => {})
        await runExtensionScript(`
          const setup = args[0]
          await browser.tabs.remove(setup.pinnedTabId).catch(() => {})
          await browser.tabs.remove(setup.unpinnedTabId).catch(() => {})
        `, setup).catch(() => {})
      }
    }
  })

  test('group-scope move to the same window extracts selected tab from group', async () => {
    await openFreshOptionsPage()

    const result = await runExtensionScript(`
      const createdTabs = []
      try {
        const beforeTab = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        createdTabs.push(beforeTab)
        const groupTab1 = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        createdTabs.push(groupTab1)
        const groupTab2 = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        createdTabs.push(groupTab2)
        const groupTab3 = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        createdTabs.push(groupTab3)
        const afterTab = await browser.tabs.create({
          active: false,
          url: 'about:blank',
        })
        createdTabs.push(afterTab)
        const groupId = await browser.tabs.group({
          tabIds: [groupTab1.id, groupTab2.id, groupTab3.id],
        })

        await browser.runtime.sendMessage({
          type: 'move',
          keyType: 'raw',
          tabIds: [groupTab2.id],
          destination: {
            type: 'window',
            windowId: groupTab2.windowId,
          },
          targetScope: 'group',
          groupId,
          sourceWindowId: groupTab2.windowId,
          notification: false,
          focus: false,
        })

        const finalTabs = await waitUntil(async () => {
          const tabs = await browser.tabs.query({
            windowId: groupTab2.windowId,
          })
          tabs.sort((tab1, tab2) => tab1.index - tab2.index)
          const createdTabIds = new Set(createdTabs.map(tab => tab.id))
          const createdOnlyTabs = tabs.filter(tab => createdTabIds.has(tab.id))
          const extractedTab = createdOnlyTabs.find(tab =>
            tab.id === groupTab2.id)
          const groupedTabs = tabs.filter(tab =>
            [groupTab1.id, groupTab3.id].includes(tab.id))
          if (extractedTab &&
              extractedTab.groupId === browser.tabGroups.TAB_GROUP_ID_NONE &&
              groupedTabs.every(tab => tab.groupId === groupId)) {
            return createdOnlyTabs
          }
        })
        if (!finalTabs) {
          throw new Error('selected group tab was not extracted')
        }
        return {
          afterTabId: afterTab.id,
          beforeTabId: beforeTab.id,
          finalOrder: finalTabs.map(tab => tab.id),
          groupId,
          groupTabIds: [groupTab1.id, groupTab3.id],
          memberships: finalTabs.map(tab => ({
            groupId: tab.groupId,
            id: tab.id,
          })),
          noneGroupId: browser.tabGroups.TAB_GROUP_ID_NONE,
          selectedTabId: groupTab2.id,
        }
      } finally {
        for (const tab of createdTabs) {
          await browser.tabs.remove(tab.id).catch(() => {})
        }
      }
    `)

    const selected = result.memberships.find((tab) =>
      tab.id === result.selectedTabId)
    const remainingGroupTabs = result.memberships.filter((tab) =>
      result.groupTabIds.includes(tab.id))

    assert.equal(selected.groupId, result.noneGroupId)
    assert.deepEqual(remainingGroupTabs.map((tab) => tab.groupId), [
      result.groupId,
      result.groupId,
    ])
    assert.deepEqual(result.finalOrder, [
      result.beforeTabId,
      result.groupTabIds[0],
      result.groupTabIds[1],
      result.selectedTabId,
      result.afterTabId,
    ])
  })
})
