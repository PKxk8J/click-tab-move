import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Builder } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'
import { download } from 'geckodriver'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const EXTENSION_DIR = resolve(ROOT_DIR, 'extension')
const DEFAULT_TAB_COUNT = 500
const DEFAULT_MAX_MS = 30_000
const PERF_TIMEOUT_MS = 300_000

let driver
let extensionBaseUrl

function readMinInteger (name, defaultValue, min) {
  const value = process.env[name]
  if (value === undefined || value === '') {
    return defaultValue
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer greater than or equal to ${min}`)
  }
  return parsed
}

function readPositiveNumber (name, defaultValue) {
  const value = process.env[name]
  if (value === undefined || value === '') {
    return defaultValue
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`)
  }
  return parsed
}

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

async function runExtensionScript (script, ...args) {
  const result = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1]
    const args = Array.from(arguments).slice(0, -1)

    async function run () {
      const wait = msec => new Promise(resolve => setTimeout(resolve, msec))
      async function waitUntil (predicate, timeout = 30000) {
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

describe('Firefox real tab moving performance', () => {
  before(async () => {
    driver = await createDriver()
    await driver.manage().setTimeouts({
      script: PERF_TIMEOUT_MS,
    })
    const addonId = await driver.installAddon(EXTENSION_DIR, true)
    extensionBaseUrl = await getExtensionBaseUrl(addonId)
    assert.ok(extensionBaseUrl, '拡張機能の moz-extension URL を取得できません')
    await openExtensionPage('options.html')
  })

  after(async () => {
    if (driver) {
      await driver.quit()
    }
  })

  test('大量の実タブをパフォーマンス予算内に別ウィンドウへ移動する', {
    timeout: PERF_TIMEOUT_MS,
  }, async (t) => {
    const tabCount = readMinInteger('PERF_TAB_COUNT', DEFAULT_TAB_COUNT, 2)
    const maxMs = readPositiveNumber('PERF_MAX_MS', DEFAULT_MAX_MS)

    const result = await runExtensionScript(`
      const { run } = await import(browser.runtime.getURL('move.js'))
      const tabCount = args[0]
      const token = 'click-tab-move-perf-' + Date.now() + '-' + Math.random()
      const makeUrl = index => 'about:blank#' + token + '-' +
        String(index).padStart(5, '0')
      const expectedUrls = Array.from(
        { length: tabCount },
        (_, index) => makeUrl(index),
      )
      const createdTabs = []
      let sourceWindow
      let targetWindow

      try {
        sourceWindow = await browser.windows.create({
          focused: true,
          url: makeUrl(0),
        })
        const initialTabs = sourceWindow.tabs ||
          await browser.tabs.query({ windowId: sourceWindow.id })
        createdTabs.push(
          [...initialTabs].sort((tab1, tab2) => tab1.index - tab2.index)[0],
        )

        for (let index = 1; index < tabCount; index++) {
          createdTabs.push(await browser.tabs.create({
            active: false,
            windowId: sourceWindow.id,
            url: makeUrl(index),
          }))
        }

        targetWindow = await browser.windows.create({
          focused: false,
          url: 'about:blank#' + token + '-target',
        })

        const createdIds = createdTabs.map(tab => tab.id)
        const readyTabs = await waitUntil(async () => {
          const tabs = []
          for (const id of createdIds) {
            const tab = await browser.tabs.get(id).catch(() => null)
            if (!tab) {
              return
            }
            tabs.push(tab)
          }
          return tabs.every((tab, index) =>
            tab.windowId === sourceWindow.id &&
            tab.url === expectedUrls[index]) && tabs
        }, 120000)
        if (!readyTabs) {
          throw new Error('created tab URLs did not settle')
        }

        const startedAt = performance.now()
        await run(createdTabs[0].id, 'all', {
          type: 'window',
          windowId: targetWindow.id,
        }, false, false, 'global')
        const durationMs = performance.now() - startedAt

        const orderedTabs = await waitUntil(async () => {
          const tabs = await browser.tabs.query({ windowId: targetWindow.id })
          const createdIdSet = new Set(createdIds)
          const orderedCreatedTabs = tabs.
            filter(tab => createdIdSet.has(tab.id)).
            sort((tab1, tab2) => tab1.index - tab2.index)
          if (orderedCreatedTabs.length !== tabCount) {
            return
          }

          const orderedUrls = orderedCreatedTabs.map(tab => tab.url)
          return orderedUrls.join('\\n') === expectedUrls.join('\\n') &&
            orderedCreatedTabs
        }, 120000)
        if (!orderedTabs) {
          const tabs = await browser.tabs.query({ windowId: targetWindow.id })
          const createdIdSet = new Set(createdIds)
          const orderedUrls = tabs.
            filter(tab => createdIdSet.has(tab.id)).
            sort((tab1, tab2) => tab1.index - tab2.index).
            map(tab => tab.url)
          throw new Error(
            'tabs were not moved in source order. expected ' +
              expectedUrls.join(', ') + ', got ' + orderedUrls.join(', '),
          )
        }

        return {
          tabCount,
          durationMs,
          firstUrl: orderedTabs[0].url,
          lastUrl: orderedTabs[orderedTabs.length - 1].url,
          targetWindowId: targetWindow.id,
        }
      } finally {
        if (targetWindow) {
          await browser.windows.remove(targetWindow.id).catch(() => {})
        }
        if (sourceWindow) {
          await browser.windows.remove(sourceWindow.id).catch(() => {})
        }
      }
    `, tabCount)

    t.diagnostic([
      `tabs=${result.tabCount}`,
      `durationMs=${result.durationMs.toFixed(2)}`,
      `maxMs=${maxMs}`,
      `targetWindow=${result.targetWindowId}`,
      `first=${result.firstUrl}`,
      `last=${result.lastUrl}`,
    ].join(' '))

    assert.equal(result.tabCount, tabCount)
    assert.ok(
      result.durationMs <= maxMs,
      `expected ${tabCount} real tabs to be moved within ${maxMs}ms, ` +
        `but took ${result.durationMs.toFixed(2)}ms`,
    )
  })
})
