// Ponte entre a interface e o processo principal. Roda com sandbox: expõe só
// funções específicas, nunca o ipcRenderer inteiro nem nada do Node.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENTS, IPC, type OraculoApi } from '../shared/ipc'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: OraculoApi = {
  getLeagues: () => ipcRenderer.invoke(IPC.getLeagues),
  getMarket: () => ipcRenderer.invoke(IPC.getMarket),
  refreshMarket: () => ipcRenderer.invoke(IPC.refreshMarket),
  getHistory: (request) => ipcRenderer.invoke(IPC.getHistory, request),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  hotkeyStatus: () => ipcRenderer.invoke(IPC.hotkeyStatus),
  setHotkey: (slot, accelerator) => ipcRenderer.invoke(IPC.hotkeySet, { slot, accelerator }),
  suspendHotkeys: (on) => ipcRenderer.invoke(IPC.hotkeySuspend, on),
  priceCheck: (request) => ipcRenderer.invoke(IPC.priceCheck, request),
  searchCatalog: () => ipcRenderer.invoke(IPC.searchCatalog),
  searchTiers: (request) => ipcRenderer.invoke(IPC.searchTiers, request),
  baseMods: (baseType) => ipcRenderer.invoke(IPC.baseMods, baseType),
  farmTablets: () => ipcRenderer.invoke(IPC.farmTablets),
  farmOpenRecipe: (ref) => ipcRenderer.invoke(IPC.farmOpenRecipe, ref),
  farmRecipePrice: (ref) => ipcRenderer.invoke(IPC.farmRecipePrice, ref),
  farmTopTablets: (mechanicId) => ipcRenderer.invoke(IPC.farmTopTablets, mechanicId),
  farmTabletRegex: () => ipcRenderer.invoke(IPC.farmTabletRegex),
  filterGroups: () => ipcRenderer.invoke(IPC.filterGroups),
  marketSearch: (search) => ipcRenderer.invoke(IPC.marketSearch, search),
  openExternal: (target) => ipcRenderer.invoke(IPC.openExternal, target),
  hideOverlay: () => ipcRenderer.invoke(IPC.hideOverlay),
  hideCampaign: () => ipcRenderer.invoke(IPC.hideCampaign),
  showCampaign: () => ipcRenderer.invoke(IPC.showCampaign),
  getCampaign: () => ipcRenderer.invoke(IPC.getCampaign),
  campaignUi: (change) => ipcRenderer.invoke(IPC.campaignUi, change ?? {}),
  campaignFit: (height) => ipcRenderer.invoke(IPC.campaignFit, height),
  openApp: (page) => ipcRenderer.invoke(IPC.openApp, page),
  answerClose: (answer) => ipcRenderer.invoke(IPC.answerClose, answer),
  toggleWatch: (ref) => ipcRenderer.invoke(IPC.toggleWatch, ref),
  setWatchAlert: (ref) => ipcRenderer.invoke(IPC.setWatchAlert, ref),
  getTracker: () => ipcRenderer.invoke(IPC.getTracker),
  chooseLogFile: () => ipcRenderer.invoke(IPC.chooseLogFile),
  setLogPath: (path) => ipcRenderer.invoke(IPC.setLogPath, { path }),
  reloadTracker: () => ipcRenderer.invoke(IPC.reloadTracker),
  getCollection: () => ipcRenderer.invoke(IPC.collectionGet),
  addToCollection: (text) => ipcRenderer.invoke(IPC.collectionAdd, text),
  removeFromCollection: (id) => ipcRenderer.invoke(IPC.collectionRemove, id),
  clearCollection: () => ipcRenderer.invoke(IPC.collectionClear),
  toggleCollection: (enabled) => ipcRenderer.invoke(IPC.collectionToggle, enabled),
  acknowledgeCollection: (id) => ipcRenderer.invoke(IPC.collectionAck, id),
  getBuilds: () => ipcRenderer.invoke(IPC.buildGet),
  importBuild: (input, kind) => ipcRenderer.invoke(IPC.buildImport, { input, kind }),
  clearBuild: (kind) => ipcRenderer.invoke(IPC.buildClear, kind),
  buildTiers: (kind) => ipcRenderer.invoke(IPC.buildTiers, kind),
  openBuildItemTrade: (kind, slot) => ipcRenderer.invoke(IPC.buildOpenTrade, { kind, slot }),
  buildItemInfo: (kind, slot) => ipcRenderer.invoke(IPC.buildItemInfo, { kind, slot }),
  buildGemIcon: (name) => ipcRenderer.invoke(IPC.buildGemIcon, name),
  onBuilds: (listener) => subscribe(EVENTS.build, listener),
  onTracker: (listener) => subscribe(EVENTS.tracker, listener),
  onCollection: (listener) => subscribe(EVENTS.collection, listener),
  onMarket: (listener) => subscribe(EVENTS.market, listener),
  onSettings: (listener) => subscribe(EVENTS.settings, listener),
  onOverlay: (listener) => subscribe(EVENTS.overlay, listener),
  onCampaign: (listener) => subscribe(EVENTS.campaign, listener),
  onNavigate: (listener) => subscribe(EVENTS.navigate, listener),
  onCloseAsk: (listener) => subscribe(EVENTS.closeAsk, () => listener()),
}

contextBridge.exposeInMainWorld('oraculo', api)
