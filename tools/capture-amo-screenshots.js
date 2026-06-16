import process from 'node:process'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { Builder, By, until } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'
import { download } from 'geckodriver'

const require = createRequire(import.meta.url)
const { Command } = require('selenium-webdriver/lib/command')
const { Zip } = require('selenium-webdriver/io/zip')
const io = require('selenium-webdriver/io')

const execFileAsync = promisify(execFile)

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXTENSION_DIR = resolve(ROOT_DIR, 'extension')
const AMO_ROOT_DIR = resolve(ROOT_DIR, 'amo')
const WAIT_MS = Number(process.env.AMO_WAIT_MS || 15_000)

const SCREENSHOT_FILENAMES = {
  menuItem: 'screenshot1_menu_item.png',
  shallowMenuItem: 'screenshot2_shallow_menu_item.png',
  notification: 'screenshot3_notification.png',
  selectWindow: 'screenshot4_select_window.png',
  settings: 'screenshot5_settings.png',
}

const DEFAULT_TARGETS = [
  'settings',
  'select',
  'menu',
  'shallow-menu',
  'notification',
]

const LOCALES = {
  en: {
    extensionLocale: 'en',
    firefoxLocale: 'en-US',
    labels: {
      move: 'Move',
      thisGroup: 'This Group',
    },
    tabs: {
      archive: 'Destination Archive',
      bug: 'Bug Tracker',
      destination: 'Destination Window',
      notificationFirst: 'Notification Source 1',
      notificationSecond: 'Notification Source 2',
      notificationTarget: 'Notification Target',
      project: 'Project Plan',
      research: 'Move Source Research',
      source: 'Move Source Tab',
    },
    groups: {
      archive: 'Archive',
      research: 'Research',
    },
  },
  ja: {
    extensionLocale: 'ja',
    firefoxLocale: 'ja',
    labels: {
      move: 'タブ移動',
      thisGroup: 'このグループ',
    },
    tabs: {
      archive: '移動先アーカイブ',
      bug: 'バグ管理',
      destination: '移動先ウィンドウ',
      notificationFirst: '通知元タブ 1',
      notificationSecond: '通知元タブ 2',
      notificationTarget: '通知先ウィンドウ',
      project: '計画書',
      research: '移動元リサーチ',
      source: '移動元タブ',
    },
    groups: {
      archive: 'アーカイブ',
      research: '調査',
    },
  },
}

const DEFAULT_LOCALES = Object.keys(LOCALES)

let driver
let extensionBaseUrl
let activeLocale
let activeOutputDir

async function runPowerShell (command, env = {}) {
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
  return await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedCommand,
  ], {
    env: {
      ...process.env,
      ...env,
    },
    windowsHide: true,
  })
}

function pageUrl (title) {
  return extensionBaseUrl + 'screenshot-tab.html?title=' +
    encodeURIComponent(title)
}

function screenshotPath (key) {
  return resolve(activeOutputDir, SCREENSHOT_FILENAMES[key])
}

function parseCrop (name, fallback) {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }

  const values = raw.split(',').map((value) => Number(value.trim()))
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(name + ' must be "x,y,width,height"')
  }
  const [x, y, width, height] = values
  return { x, y, width, height }
}

function getMenuCrop (windowRect, name, fallback) {
  const crop = parseCrop(name, fallback)
  return {
    x: windowRect.x + crop.x,
    y: windowRect.y + crop.y,
    width: crop.width,
    height: crop.height,
  }
}

async function writePng (path, base64) {
  await writeFile(path, Buffer.from(base64, 'base64'))
}

async function createDriver () {
  const geckoDriverPath = process.env.GECKODRIVER_PATH || await download()
  const options = new firefox.Options()
  options.addArguments('-remote-allow-system-access')
  options.setPreference('intl.locale.requested', activeLocale.firefoxLocale)
  options.setPreference('layout.css.prefers-color-scheme.content-override', 0)
  options.setPreference('ui.systemUsesDarkTheme', 1)

  if (process.env.AMO_HEADLESS === '1') {
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

async function installAddon ({ allowPrivateBrowsing = false } = {}) {
  const stats = statSync(EXTENSION_DIR)
  let buffer
  if (stats.isDirectory()) {
    const zip = new Zip()
    await zip.addDir(EXTENSION_DIR)
    await addForcedDefaultLocale(zip)
    zip.z_.file('screenshot-tab.html', `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Screenshot Tab</title>
          <style>
            html {
              color-scheme: light dark;
              font: 16px system-ui, sans-serif;
            }
            body {
              min-height: 100vh;
              margin: 0;
              background:
                linear-gradient(135deg, Canvas 0%, Canvas 42%,
                  color-mix(in srgb, AccentColor 12%, Canvas) 100%);
            }
          </style>
        </head>
        <body>
          <script src="screenshot-tab.js"></script>
        </body>
      </html>
    `)
    zip.z_.file('screenshot-tab.js', `
      document.title =
        new URLSearchParams(location.search).get('title') ||
        'Screenshot Tab'
    `)
    buffer = await zip.toBuffer('DEFLATE')
  } else {
    buffer = await io.read(EXTENSION_DIR)
  }

  return await driver.execute(
    new Command('install addon').
      setParameter('addon', buffer.toString('base64')).
      setParameter('temporary', true).
      setParameter('allowPrivateBrowsing', allowPrivateBrowsing),
  )
}

async function addForcedDefaultLocale (zip) {
  const messagesPath = resolve(EXTENSION_DIR, '_locales',
    activeLocale.extensionLocale, 'messages.json')
  const messages = await readFile(messagesPath)
  zip.z_.file('_locales/en/messages.json', messages)
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

async function waitForOptionsPage () {
  await driver.wait(until.elementLocated(By.id('contexts_tab')), WAIT_MS)
  await driver.wait(async () => {
    return await driver.executeScript(`
      return document.getElementById('label_name')?.textContent ===
          'ClickTabMove' &&
        document.getElementById('width')?.value !== ''
    `)
  }, WAIT_MS)
}

async function clearStorage () {
  await openExtensionPage('options.html')
  await waitForOptionsPage()
  await runExtensionScript('await browser.storage.sync.clear()')
}

async function setStorage (data) {
  await openExtensionPage('options.html')
  await waitForOptionsPage()
  await runExtensionScript('await browser.storage.sync.set(args[0])', data)
}

async function captureFullPage (path) {
  if (typeof driver.takeFullPageScreenshot === 'function') {
    await writePng(path, await driver.takeFullPageScreenshot())
    return
  }

  const pageSize = await driver.executeScript(`
    return {
      height: Math.ceil(Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      )),
      width: Math.ceil(Math.max(
        document.body.scrollWidth,
        document.documentElement.scrollWidth,
      )),
    }
  `)
  await driver.manage().window().setRect({
    width: pageSize.width,
    height: pageSize.height + 140,
  })
  await writePng(path, await driver.takeScreenshot())
}

async function captureScreenCrop (path, crop) {
  if (process.platform !== 'win32') {
    throw new Error('Native UI screenshots require Windows screen capture')
  }

  const command = `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $Path = $env:AMO_CAPTURE_PATH
    $X = [int] $env:AMO_CAPTURE_X
    $Y = [int] $env:AMO_CAPTURE_Y
    $Width = [int] $env:AMO_CAPTURE_WIDTH
    $Height = [int] $env:AMO_CAPTURE_HEIGHT
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($X, $Y, 0, 0, $bitmap.Size)
      $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  `
  await runPowerShell(command, {
    AMO_CAPTURE_HEIGHT: String(Math.round(crop.height)),
    AMO_CAPTURE_PATH: path,
    AMO_CAPTURE_WIDTH: String(Math.round(crop.width)),
    AMO_CAPTURE_X: String(Math.round(crop.x)),
    AMO_CAPTURE_Y: String(Math.round(crop.y)),
  })
}

async function getPrimaryScreenWorkingArea () {
  if (process.platform !== 'win32') {
    throw new Error('Windows screen bounds require Windows')
  }

  const { stdout } = await runPowerShell(`
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Windows.Forms
    $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    [Console]::Out.Write((
      @{
        height = $area.Height
        width = $area.Width
        x = $area.X
        y = $area.Y
      } | ConvertTo-Json -Compress
    ))
  `)
  return JSON.parse(stdout)
}

async function getNotificationCrop () {
  if (process.env.AMO_NOTIFICATION_CROP) {
    return parseCrop('AMO_NOTIFICATION_CROP')
  }

  const width = 394
  const height = 154
  const margin = Number(process.env.AMO_NOTIFICATION_MARGIN || 0)
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error('AMO_NOTIFICATION_MARGIN must be a non-negative number')
  }
  const area = await getPrimaryScreenWorkingArea()
  return {
    height,
    width,
    x: area.x + area.width - width - margin,
    y: area.y + area.height - height - margin,
  }
}

async function captureSettingsScreenshot () {
  await clearStorage()
  await setContentViewportWidth({
    x: 40,
    y: 40,
    width: 916,
    height: 1100,
  })
  await openExtensionPage('options.html')
  await waitForOptionsPage()
  await captureFullPage(screenshotPath('settings'))
}

async function setContentViewportWidth ({ x, y, width, height }) {
  await driver.manage().window().setRect({ x, y, width, height })
  const widthOffset = await driver.executeScript(`
    return Math.max(0, window.outerWidth - window.innerWidth)
  `)
  if (widthOffset > 0) {
    await driver.manage().window().setRect({
      x,
      y,
      width: width + widthOffset,
      height,
    })
  }
}

async function captureSelectWindowScreenshot () {
  await clearStorage()
  const optionsHandle = await driver.getWindowHandle()
  let setup
  try {
    setup = await runExtensionScript(`
      const sourceWindow = await browser.windows.create({
        focused: false,
        url: [
          args[0].source,
          args[0].project,
          args[0].research,
          args[0].bug,
        ],
      })
      const sourceTabs = await waitUntil(async () => {
        const tabs = await browser.tabs.query({ windowId: sourceWindow.id })
        if (tabs.length === 4) {
          tabs.sort((tab1, tab2) => tab1.index - tab2.index)
          return tabs
        }
      })
      const groupId = await browser.tabs.group({
        createProperties: { windowId: sourceWindow.id },
        tabIds: [sourceTabs[2].id],
      })
      if (browser.tabGroups?.update) {
        await browser.tabGroups.update(groupId, { title: args[0].researchGroup })
      }
      await browser.tabs.highlight({
        windowId: sourceWindow.id,
        tabs: [sourceTabs[0].index, sourceTabs[1].index],
      })
      await waitUntil(async () => {
        const titles = (await browser.tabs.query({
          windowId: sourceWindow.id,
        })).map(tab => tab.title)
        return args[0].titles.every(title => titles.includes(title))
      })
      const selectWindow = await browser.windows.create({
        type: 'detached_panel',
        url: browser.runtime.getURL('select.html'),
        width: 640,
        height: 480,
      })
      return {
        selectWindowId: selectWindow.id,
        sourceTabIds: sourceTabs.map(tab => tab.id),
        sourceWindowId: sourceWindow.id,
      }
    `, {
      bug: pageUrl(activeLocale.tabs.bug),
      project: pageUrl(activeLocale.tabs.project),
      research: pageUrl(activeLocale.tabs.research),
      researchGroup: activeLocale.groups.research,
      source: pageUrl(activeLocale.tabs.source),
      titles: [
        activeLocale.tabs.source,
        activeLocale.tabs.project,
        activeLocale.tabs.research,
        activeLocale.tabs.bug,
      ],
    })

    const selectHandle = await findWindowHandle(url =>
      url.endsWith('/select.html'))
    await driver.switchTo().window(selectHandle)
    await waitForSelectPage()
    await driver.switchTo().window(optionsHandle)
    await runExtensionScript(`
      const setup = args[0]
      await browser.windows.update(setup.sourceWindowId, {
        focused: true,
      })
      const sourceTabs = (await browser.tabs.query({
        windowId: setup.sourceWindowId,
      })).sort((tab1, tab2) => tab1.index - tab2.index)
      await browser.tabs.highlight({
        windowId: setup.sourceWindowId,
        tabs: [sourceTabs[0].index, sourceTabs[1].index],
      })
      await browser.runtime.sendMessage({
        type: 'reset',
        fromWindowId: setup.sourceWindowId,
        targetScope: 'global',
        destination: { type: 'newGroup' },
        notification: false,
        focus: false,
      })
    `, setup)
    await driver.switchTo().window(selectHandle)
    await waitForSelectCheckboxCount(5)
    await writePng(screenshotPath('selectWindow'),
      await driver.takeScreenshot())
  } finally {
    await driver.switchTo().window(optionsHandle).catch(() => {})
    if (setup) {
      await runExtensionScript(`
        const setup = args[0]
        await browser.windows.remove(setup.selectWindowId).catch(() => {})
        await browser.windows.remove(setup.sourceWindowId).catch(() => {})
      `, setup).catch(() => {})
    }
  }
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

async function waitForSelectPage () {
  await driver.wait(async () => {
    return await driver.executeScript(`
      return document.readyState === 'complete' &&
        !!document.getElementById('select') &&
        document.getElementById('label_move')?.textContent !== ''
    `)
  }, WAIT_MS, 'select page did not become ready')
}

async function waitForSelectCheckboxCount (count) {
  await driver.wait(async () => {
    return await driver.executeScript(`
      return document.querySelectorAll('#select input[type="checkbox"]').
        length === arguments[0]
    `, count)
  }, WAIT_MS, 'select checkbox count did not become ' + count)
}

async function openSelectedTabContextMenu () {
  await driver.setContext(firefox.Context.CHROME)
  try {
    const tabPoint = await driver.executeScript(`
      const rect = gBrowser.selectedTab.getBoundingClientRect()
      return {
        x: Math.round(rect.left + Math.min(rect.width / 2, 96)),
        y: Math.round(rect.top + rect.height / 2),
      }
    `)
    await driver.actions({ async: true }).
      move(tabPoint).
      contextClick().
      pause(350).
      perform()
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

function createLabelMatcher ({ exact, prefix }) {
  return { exact: exact || '', prefix: prefix || '' }
}

async function getVisibleChromeMenuLabels () {
  await driver.setContext(firefox.Context.CHROME)
  try {
    return await driver.executeScript(`
      function getLabel (item) {
        return item.getAttribute('label') || item.label ||
          item.textContent.trim()
      }

      return Array.from(document.querySelectorAll('menu, menuitem')).
        filter((item) => {
          const rect = item.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && !item.hidden
        }).
        map(getLabel).
        filter((label) => label.length > 0)
    `)
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

async function hoverChromeMenuItem (matcher) {
  await driver.setContext(firefox.Context.CHROME)
  try {
    const itemPoint = await driver.wait(async () => {
      return await driver.executeScript(`
        const matcher = arguments[0]

        function getLabel (item) {
          return item.getAttribute('label') || item.label ||
            item.textContent.trim()
        }

        function matches (label) {
          if (matcher.exact && label === matcher.exact) {
            return true
          }
          return matcher.prefix && label.startsWith(matcher.prefix)
        }

        const item = Array.from(document.querySelectorAll('menu, menuitem')).
          find((candidate) => {
            const rect = candidate.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 &&
              !candidate.hidden && matches(getLabel(candidate))
          })
        if (!item) {
          return null
        }

        const rect = item.getBoundingClientRect()
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        }
      `, matcher)
    }, WAIT_MS, 'menu item did not become visible')

    await driver.actions({ async: true }).
      move(itemPoint).
      pause(450).
      perform()
  } catch (error) {
    const labels = await getVisibleChromeMenuLabels().catch(() => [])
    throw new Error(error.message + '; visible menu labels: ' +
      JSON.stringify(labels))
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

async function getOpenChromeMenuCrop (topMatcher) {
  const windowRect = await driver.manage().window().getRect()
  await driver.setContext(firefox.Context.CHROME)
  try {
    const crop = await driver.executeScript(`
      const matcher = arguments[0]

      function getLabel (item) {
        return item.getAttribute('label') || item.label ||
          item.textContent.trim()
      }

      function matches (label) {
        if (matcher.exact && label === matcher.exact) {
          return true
        }
        return matcher.prefix && label.startsWith(matcher.prefix)
      }

      function toPlainRect (rect) {
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        }
      }

      function sameRect (rect1, rect2) {
        return Math.abs(rect1.left - rect2.left) < 1 &&
          Math.abs(rect1.top - rect2.top) < 1 &&
          Math.abs(rect1.width - rect2.width) < 1 &&
          Math.abs(rect1.height - rect2.height) < 1
      }

      const topItem = Array.from(document.querySelectorAll('menu, menuitem')).
        find((item) => {
          const rect = item.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 &&
            !item.hidden && matches(getLabel(item))
        })
      if (!topItem) {
        return null
      }

      const topItemRect = topItem.getBoundingClientRect()
      const parentPopupRect = topItem.closest('menupopup')?.
        getBoundingClientRect()
      const rects = [toPlainRect(topItemRect)]
      for (const popup of document.querySelectorAll('menupopup')) {
        const rect = popup.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
          continue
        }
        if (parentPopupRect && sameRect(rect, parentPopupRect)) {
          continue
        }
        rects.push(toPlainRect(rect))
      }

      const left = Math.floor(Math.min(...rects.map((rect) => rect.left)))
      const top = Math.floor(Math.min(...rects.map((rect) => rect.top)))
      const right = Math.ceil(Math.max(...rects.map((rect) => rect.right)))
      const bottom = Math.ceil(Math.max(...rects.map((rect) => rect.bottom)))
      return {
        x: left - 8,
        y: top - 8,
        width: right - left + 28,
        height: bottom - top + 16,
      }
    `, topMatcher)
    if (!crop) {
      throw new Error('top menu item was not found')
    }
    return {
      x: windowRect.x + crop.x,
      y: windowRect.y + crop.y,
      width: crop.width,
      height: crop.height,
    }
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

async function prepareMenuCapture ({ shallow }) {
  await setStorage({
    contexts: ['all', 'tab'],
    menuItems: shallow
      ? { one: ['global'] }
      : {
          all: ['global'],
          one: ['global', 'group'],
          right: ['global', 'group'],
        },
  })

  await driver.get(pageUrl(activeLocale.tabs.source))
  return await runExtensionScript(`
    const sourceTab = (await browser.tabs.query({
      active: true,
      currentWindow: true,
    }))[0]
    await browser.tabs.ungroup([sourceTab.id]).catch(() => {})
    const targetWindow = await browser.windows.create({
      focused: false,
      url: args[0].destination,
    })
    const archiveTab = await browser.tabs.create({
      active: false,
      windowId: targetWindow.id,
      url: args[0].archive,
    })
    const archiveGroupId = await browser.tabs.group({
      createProperties: { windowId: targetWindow.id },
      tabIds: [archiveTab.id],
    })
    if (browser.tabGroups?.update) {
      await browser.tabGroups.update(archiveGroupId, {
        title: args[0].archiveGroup,
      })
    }
    if (!args[0].shallow) {
      const sourceGroupId = await browser.tabs.group({
        tabIds: [sourceTab.id],
      })
      if (browser.tabGroups?.update) {
        await browser.tabGroups.update(sourceGroupId, {
          title: args[0].researchGroup,
        })
      }
    }
    await browser.windows.update(sourceTab.windowId, { focused: true })
    await wait(600)
    return {
      sourceTabId: sourceTab.id,
      targetWindowId: targetWindow.id,
    }
  `, {
    archive: pageUrl(activeLocale.tabs.archive),
    archiveGroup: activeLocale.groups.archive,
    destination: pageUrl(activeLocale.tabs.destination),
    researchGroup: activeLocale.groups.research,
    shallow,
  })
}

async function cleanupMenuCapture (setup) {
  if (!setup) {
    return
  }

  await runExtensionScript(`
    const setup = args[0]
    await browser.windows.remove(setup.targetWindowId).catch(() => {})
    await browser.tabs.ungroup([setup.sourceTabId]).catch(() => {})
  `, setup).catch(() => {})
}

async function captureMenuScreenshot ({ shallow, path, cropName, fallbackCrop }) {
  if (process.env.AMO_HEADLESS === '1') {
    throw new Error('Menu screenshots require a visible Firefox window')
  }

  let setup
  try {
    setup = await prepareMenuCapture({ shallow })
    await driver.manage().window().setRect({
      x: 20,
      y: 20,
      width: 1100,
      height: 780,
    })
    await driver.sleep(500)
    const topMatcher = shallow
      ? createLabelMatcher({ prefix: activeLocale.labels.move + ': ' })
      : createLabelMatcher({ exact: activeLocale.labels.move })

    await openSelectedTabContextMenu()
    if (shallow) {
      await hoverChromeMenuItem(topMatcher)
    } else {
      await hoverChromeMenuItem(topMatcher)
      await hoverChromeMenuItem(createLabelMatcher({
        exact: activeLocale.labels.thisGroup,
      }))
    }
    await driver.sleep(500)

    const windowRect = await driver.manage().window().getRect()
    const crop = process.env[cropName]
      ? getMenuCrop(windowRect, cropName, fallbackCrop)
      : await getOpenChromeMenuCrop(topMatcher)
    await captureScreenCrop(path, crop)
  } finally {
    await driver.actions({ async: true }).sendKeys('\uE00C').perform().
      catch(() => {})
    await cleanupMenuCapture(setup)
  }
}

async function acceptNotificationPermissionPrompt () {
  await driver.setContext(firefox.Context.CHROME)
  try {
    await driver.wait(async () => {
      return await driver.executeScript(`
        const panel = document.getElementById('notification-popup')
        const notification = panel?.querySelector(
          '#addon-webext-permissions-notification',
        )
        return panel?.state === 'open' && !!notification?.button
      `)
    }, WAIT_MS, 'notification permission prompt did not open')
    await driver.executeScript(`
      document.getElementById('notification-popup').
        querySelector('#addon-webext-permissions-notification').
        button.click()
    `)
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

async function ensureNotificationPermission () {
  await openExtensionPage('options.html')
  await waitForOptionsPage()
  const alreadyAllowed = await runExtensionScript(`
    return await browser.permissions.contains({
      permissions: ['notifications'],
    })
  `)
  if (alreadyAllowed) {
    return
  }

  await driver.findElement(By.id('notification')).click()
  await acceptNotificationPermissionPrompt()
}

async function captureNotificationScreenshot () {
  if (process.env.AMO_HEADLESS === '1') {
    throw new Error('Notification screenshots require a visible desktop')
  }

  await clearStorage()
  await ensureNotificationPermission()
  await runExtensionScript(`
    const sourceTabs = []
    let targetWindow
    try {
      sourceTabs.push(await browser.tabs.create({
        active: false,
        url: args[0].first,
      }))
      sourceTabs.push(await browser.tabs.create({
        active: false,
        url: args[0].second,
      }))
      targetWindow = await browser.windows.create({
        focused: false,
        url: args[0].target,
      })
      await browser.runtime.sendMessage({
        type: 'move',
        keyType: 'raw',
        tabIds: sourceTabs.map(tab => tab.id),
        destination: {
          type: 'window',
          windowId: targetWindow.id,
        },
        targetScope: 'global',
        sourceWindowId: sourceTabs[0].windowId,
        notification: true,
        focus: false,
      })
      await wait(1200)
    } finally {
      if (targetWindow) {
        await browser.windows.remove(targetWindow.id).catch(() => {})
      }
    }
  `, {
    first: pageUrl(activeLocale.tabs.notificationFirst),
    second: pageUrl(activeLocale.tabs.notificationSecond),
    target: pageUrl(activeLocale.tabs.notificationTarget),
  })

  await captureScreenCrop(screenshotPath('notification'),
    await getNotificationCrop())
}

async function main () {
  const targets = getRequestedTargets()
  const locales = getRequestedLocales()
  await mkdir(AMO_ROOT_DIR, { recursive: true })

  for (const localeId of locales) {
    await captureLocale(localeId, targets)
  }
}

async function captureLocale (localeId, targets) {
  activeLocale = LOCALES[localeId]
  activeOutputDir = resolve(AMO_ROOT_DIR, localeId)
  await mkdir(activeOutputDir, { recursive: true })

  console.log('Locale ' + localeId)
  driver = await createDriver()
  try {
    const addonId = await installAddon({ allowPrivateBrowsing: true })
    extensionBaseUrl = await getExtensionBaseUrl(addonId)
    if (!extensionBaseUrl) {
      throw new Error('Could not resolve the extension moz-extension URL')
    }

    await runIfRequested(targets, 'settings', captureSettingsScreenshot)
    await runIfRequested(targets, 'select', captureSelectWindowScreenshot)
    await runIfRequested(targets, 'menu', () => captureMenuScreenshot({
      shallow: false,
      path: screenshotPath('menuItem'),
      cropName: 'AMO_MENU_CROP',
      fallbackCrop: { x: 0, y: 92, width: 764, height: 126 },
    }))
    await runIfRequested(targets, 'shallow-menu', () => captureMenuScreenshot({
      shallow: true,
      path: screenshotPath('shallowMenuItem'),
      cropName: 'AMO_SHALLOW_MENU_CROP',
      fallbackCrop: { x: 0, y: 92, width: 407, height: 126 },
    }))
    await runIfRequested(targets, 'notification', captureNotificationScreenshot)
  } finally {
    if (driver) {
      await driver.quit()
    }
    driver = undefined
  }
}

function getRequestedTargets () {
  const rawTargets = process.env.AMO_SCREENSHOTS
  if (!rawTargets) {
    return new Set(DEFAULT_TARGETS)
  }

  const targets = rawTargets.
    split(',').
    map((target) => target.trim()).
    filter((target) => target.length > 0)
  const unsupportedTargets = targets.filter((target) =>
    !DEFAULT_TARGETS.includes(target))
  if (unsupportedTargets.length > 0) {
    throw new Error('Unsupported AMO_SCREENSHOTS target: ' +
      unsupportedTargets.join(', '))
  }
  return new Set(targets)
}

function getRequestedLocales () {
  const rawLocales = process.env.AMO_LOCALES || process.env.AMO_LOCALE
  if (!rawLocales) {
    return DEFAULT_LOCALES
  }

  const locales = rawLocales.
    split(',').
    map((locale) => locale.trim()).
    filter((locale) => locale.length > 0)
  const unsupportedLocales = locales.filter((locale) =>
    !Object.hasOwn(LOCALES, locale))
  if (unsupportedLocales.length > 0) {
    throw new Error('Unsupported AMO_LOCALES locale: ' +
      unsupportedLocales.join(', '))
  }
  return locales
}

async function runIfRequested (targets, target, run) {
  if (!targets.has(target)) {
    return
  }
  console.log('Capturing ' + target)
  await run()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
