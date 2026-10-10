// Минимален мост страница <-> Electron. Страницата работи и без него (в браузъра).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixelOffice', {
  action: (act) => ipcRenderer.send('action', String(act)),
  stats: (s) => ipcRenderer.send('stats', s),
  preferSize: (sz) => ipcRenderer.send('prefer-size', sz),
  onState: (fn) => ipcRenderer.on('state', (_e, st) => fn(st)),
  shop: (open) => ipcRenderer.send('shop', !!open),             // магазинът е отворен -> прозорецът временно расте
  onOpenShop: (fn) => ipcRenderer.on('open-shop', () => fn()),  // "Магазин" от менюто в трея / ⚙
  onVisible: (fn) => ipcRenderer.on('visible', (_e, v) => fn(!!v)), // скрит прозорец -> страницата не рисува
});
