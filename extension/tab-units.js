const {
  tabs,
} = browser

function getNoGroupId () {
  return browser.tabGroups?.TAB_GROUP_ID_NONE ?? -1
}

function getNoSplitViewId () {
  return tabs.SPLIT_VIEW_ID_NONE ?? -1
}

export function isGroupedTab (tab) {
  return tab.groupId !== undefined && tab.groupId !== getNoGroupId()
}

function isSplitViewTab (tab) {
  return tab.splitViewId !== undefined &&
    tab.splitViewId !== getNoSplitViewId()
}

export function sortTabsByIndex (tabList) {
  return [...tabList].sort((tab1, tab2) => tab1.index - tab2.index)
}

function makeTabUnit (tab) {
  return {
    id: 'tab:' + tab.id,
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
      id: 'splitView:' + splitViewId + ':' + unitTabs[0].id,
      type: 'splitView',
      splitViewId,
      tabs: unitTabs,
    },
  }
}

export function buildTabUnits (tabList) {
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
      id: 'group:' + groupId,
      type: 'group',
      groupId,
      tabs: groupTabs,
      units: buildTabUnits(groupTabs),
    },
  }
}

export function buildTopLevelUnits (tabList) {
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
