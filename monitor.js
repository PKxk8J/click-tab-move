'use strict'

// フォーカスタブの監視

var _export

{
    const {
        tabs,
        windows
    } = browser
    const {
        debug,
        onError
    } = common

    let onActivated
    let onInactivated

    function setActiveTabCallbacks(_onActivated, _onInactivated) {
        onActivated = _onActivated
        onInactivated = _onInactivated
    }

    const windowToActiveTab = new Map()
    const activeTabToWindow = new Map()

    function isActiveTab(tabId) {
        return activeTabToWindow.has(tabId)
    }

    function update(windowId, tabId) {
        const old = windowToActiveTab.get(windowId)
        if (old) {
            debug('Tab' + tabId + ' became active instead of tab' + old + ' in window' + windowId)
            activeTabToWindow.delete(old)
        } else {
            debug('Tab' + tabId + ' became active in window' + windowId)
        }
        windowToActiveTab.set(windowId, tabId)
        activeTabToWindow.set(tabId, windowId)
        if (onActivated) {
            onActivated(windowId, tabId)
        }
    }

    // 別のタブにフォーカスを移した
    tabs.onActivated.addListener((activeInfo) => (async function () {
        update(activeInfo.windowId, activeInfo.tabId)
    })().catch(onError))

    // ウインドウができた
    windows.onCreated.addListener((window) => (async function () {
        // for (const tab of window.tabs) {
        //   if (tab.active) {
        //     update(window.id, tab.id)
        //     return
        //   }
        // }
        const [tab] = await tabs.query({windowId: window.id, active: true})
        update(window.id, tab.id)
    })().catch(onError))

    // ウインドウがなくなった
    windows.onRemoved.addListener((windowId) => {
        const old = windowToActiveTab.get(windowId)
        if (!old) {
            return
        }

        debug('Tab' + old + ' became inactive with window' + windowId)
        activeTabToWindow.delete(old)
        windowToActiveTab.delete(windowId)
        if (onInactivated) {
            onInactivated(windowId)
        }
    })

    _export = Object.freeze({
        setActiveTabCallbacks,
        isActiveTab
    })
}

const monitor = _export
