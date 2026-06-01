import {
  DEFAULT_FOCUS,
  DEFAULT_NOTIFICATION,
  KEY_CANCEL,
  KEY_DESTINATION,
  KEY_FOCUS,
  KEY_GROUP_ID,
  KEY_MOVE,
  KEY_MOVE_TO_X,
  KEY_NEW_GROUP,
  KEY_NEW_WINDOW,
  KEY_NOTIFICATION,
  KEY_RAW,
  KEY_RESET,
  KEY_SELECT,
  KEY_SELECT_SIZE,
  KEY_TARGET_GLOBAL,
  KEY_TARGET_GROUP,
  KEY_TARGET_SCOPE,
  debug,
  onError,
} from './common.js'

const {
  i18n,
  runtime,
  tabs,
  windows,
} = browser

async function closeWindow () {
  const windowInfo = await windows.getCurrent()
  runtime.sendMessage({
    type: KEY_SELECT_SIZE,
    selectSize: [windowInfo.width, windowInfo.height],
  })

  await windows.remove(windowInfo.id)
  debug('Select window ' + windowInfo.id + ' was closed')
}

function getNoGroupId () {
  return browser.tabGroups?.TAB_GROUP_ID_NONE ?? -1
}

function getNoSplitViewId () {
  return tabs.SPLIT_VIEW_ID_NONE ?? -1
}

function isGroupedTab (tab) {
  return tab.groupId !== undefined && tab.groupId !== getNoGroupId()
}

function isSplitViewTab (tab) {
  return tab.splitViewId !== undefined &&
    tab.splitViewId !== getNoSplitViewId()
}

function sortTabsByIndex (tabList) {
  return [...tabList].sort((tab1, tab2) => tab1.index - tab2.index)
}

function makeTabUnit (tab) {
  return {
    type: 'tab',
    tabs: [tab],
  }
}

function makeSplitViewUnit (tabList, startIndex) {
  const splitViewId = tabList[startIndex].splitViewId
  const unitTabs = []
  let index = startIndex
  for (; index < tabList.length; index++) {
    if (tabList[index].splitViewId !== splitViewId) {
      break
    }
    unitTabs.push(tabList[index])
  }

  return {
    nextIndex: index,
    unit: {
      type: 'splitView',
      splitViewId,
      tabs: unitTabs,
    },
  }
}

function buildTabUnits (tabList) {
  const units = []
  const sortedTabs = sortTabsByIndex(tabList)
  for (let i = 0; i < sortedTabs.length;) {
    const tab = sortedTabs[i]
    if (isSplitViewTab(tab)) {
      const { unit, nextIndex } = makeSplitViewUnit(sortedTabs, i)
      units.push(unit)
      i = nextIndex
      continue
    }

    units.push(makeTabUnit(tab))
    i++
  }
  return units
}

function makeGroupUnit (tabList, startIndex) {
  const groupId = tabList[startIndex].groupId
  const groupTabs = []
  let index = startIndex
  for (; index < tabList.length; index++) {
    if (tabList[index].groupId !== groupId) {
      break
    }
    groupTabs.push(tabList[index])
  }

  return {
    nextIndex: index,
    unit: {
      type: 'group',
      groupId,
      tabs: groupTabs,
    },
  }
}

function buildTopLevelUnits (tabList) {
  const units = []
  const sortedTabs = sortTabsByIndex(tabList)
  for (let i = 0; i < sortedTabs.length;) {
    const tab = sortedTabs[i]
    if (isGroupedTab(tab)) {
      const { unit, nextIndex } = makeGroupUnit(sortedTabs, i)
      units.push(unit)
      i = nextIndex
      continue
    }

    if (isSplitViewTab(tab)) {
      const { unit, nextIndex } = makeSplitViewUnit(sortedTabs, i)
      units.push(unit)
      i = nextIndex
      continue
    }

    units.push(makeTabUnit(tab))
    i++
  }
  return units
}

function parseDestination (value) {
  if (!value) {
    return { type: 'newWindow' }
  }
  return JSON.parse(value)
}

function getSelectedTabIds () {
  const select = document.getElementById(KEY_SELECT)
  return [...select.options].
    filter((option) => option.selected).
    flatMap((option) => option.dataset.tabIds.split(',').map(Number))
}

function getDestination () {
  return parseDestination(document.getElementById(KEY_DESTINATION).value)
}

function sendResult () {
  runtime.sendMessage({
    type: KEY_MOVE,
    keyType: KEY_RAW,
    tabIds: getSelectedTabIds(),
    [KEY_DESTINATION]: getDestination(),
    notification: document.getElementById(KEY_NOTIFICATION).value === 'true',
    focus: document.getElementById(KEY_FOCUS).value === 'true',
  })
}

async function getGroupInfoMap () {
  const infos = new Map()
  if (typeof browser.tabGroups?.query !== 'function') {
    return infos
  }

  const groups = await browser.tabGroups.query({})
  for (const group of groups) {
    infos.set(group.id, {
      title: group.title || '',
    })
  }
  return infos
}

function getUnitTitle (unit, groupInfos) {
  if (unit.type === 'group') {
    const groupInfo = groupInfos.get(unit.groupId)
    const groupTitle = groupInfo?.title || ''
    return i18n.getMessage('groupEntry',
      [unit.tabs[0].windowId, groupTitle, unit.tabs[0].title])
  }
  if (unit.type === 'splitView') {
    return unit.tabs.map((tab) => tab.title).join(' / ')
  }
  return unit.tabs[0].title
}

async function getGroupDestinationTitle (groupId) {
  const tabList = await tabs.query({})
  const groupTab = tabList.find((tab) => tab.groupId === groupId)
  if (!groupTab) {
    return String(groupId)
  }

  let title = ''
  if (typeof browser.tabGroups?.query === 'function') {
    const groups = await browser.tabGroups.query({})
    title = groups.find((group) => group.id === groupId)?.title || title
  }
  return i18n.getMessage('groupEntry', [groupTab.windowId, title,
    groupTab.title])
}

async function getDestinationTitle (destination) {
  if (destination.type === 'newWindow') {
    return i18n.getMessage(KEY_NEW_WINDOW)
  }
  if (destination.type === 'newGroup') {
    return i18n.getMessage(KEY_NEW_GROUP)
  }
  if (destination.type === 'group') {
    return getGroupDestinationTitle(destination.groupId)
  }

  const [tab] = await tabs.query({
    windowId: destination.windowId,
    active: true,
  })
  return i18n.getMessage('windowEntry', [destination.windowId, tab.title])
}

async function reset (
  fromWindowId, groupId, targetScope, destination, notification, focus) {
  const title = i18n.getMessage(KEY_MOVE_TO_X,
    await getDestinationTitle(destination))
  document.title = title
  document.getElementById(KEY_MOVE_TO_X).textContent = title
  document.getElementById(KEY_DESTINATION).value = JSON.stringify(destination)

  document.getElementById(KEY_NOTIFICATION).value = String(notification)
  document.getElementById(KEY_FOCUS).value = String(focus)

  let tabList = await tabs.query({ windowId: fromWindowId })
  if (targetScope === KEY_TARGET_GROUP) {
    tabList = tabList.filter((tab) => tab.groupId === groupId)
  }
  const units = targetScope === KEY_TARGET_GLOBAL
    ? buildTopLevelUnits(tabList)
    : buildTabUnits(tabList)
  const groupInfos = await getGroupInfoMap()

  const select = document.getElementById(KEY_SELECT)
  select.replaceChildren()
  for (const unit of units) {
    const option = document.createElement('option')
    option.value = unit.tabs.map((tab) => tab.id).join(',')
    option.dataset.tabIds = option.value
    option.textContent = getUnitTitle(unit, groupInfos)
    select.appendChild(option)
  }

  select.focus()
  await windows.update(windows.WINDOW_ID_CURRENT, { focused: true })
}

function normalizeDestinationMessage (message) {
  if (message[KEY_DESTINATION]) {
    return message[KEY_DESTINATION]
  }
  if (message.toWindowId === undefined) {
    return { type: 'newWindow' }
  }
  return { type: 'window', windowId: message.toWindowId }
}

async function handleMessage (message) {
  debug('Message ' + JSON.stringify(message) + ' was received')
  if (message.type !== KEY_RESET) {
    return
  }

  await reset(
    message.fromWindowId,
    message[KEY_GROUP_ID],
    message[KEY_TARGET_SCOPE] || KEY_TARGET_GLOBAL,
    normalizeDestinationMessage(message),
    message.notification ?? DEFAULT_NOTIFICATION,
    message.focus ?? DEFAULT_FOCUS,
  )
}

function setLabelText (id, key) {
  document.getElementById(id).textContent = i18n.getMessage(key)
}

async function init () {
  setLabelText('label_' + KEY_MOVE, KEY_MOVE)
  setLabelText('label_' + KEY_CANCEL, KEY_CANCEL)

  document.getElementById(KEY_MOVE).addEventListener('click', () => {
    ;(async () => {
      sendResult()
      await closeWindow()
    })().catch(onError)
  })
  document.getElementById(KEY_CANCEL).addEventListener('click', () => {
    closeWindow().catch(onError)
  })
  document.getElementById(KEY_SELECT).addEventListener('dblclick', () => {
    ;(async () => {
      sendResult()
      await closeWindow()
    })().catch(onError)
  })

  runtime.onMessage.addListener((message) => {
    return handleMessage(message).catch(onError)
  })
}

init().catch(onError)
