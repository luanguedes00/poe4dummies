// Gera build/icon.png (512) e build/icon.ico (16 a 256) a partir de build/icon.svg
// (16 e 24 px usam build/icon-small.svg, mais legível em tamanho pequeno).
// Usa o Electron do próprio projeto para rasterizar; não baixa nada.
// Rodar: node_modules\electron\dist\electron.exe scripts\make-icon.cjs
//   (ou: npm run icon)

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SVG = path.join(ROOT, 'build', 'icon.svg')
// Versão simplificada (traços grossos, sem detalhes) para tamanhos de barra de tarefas/título.
const SVG_SMALL = path.join(ROOT, 'build', 'icon-small.svg')
const SMALL_MAX = 24
const PNG_OUT = path.join(ROOT, 'build', 'icon.png')
const ICO_OUT = path.join(ROOT, 'build', 'icon.ico')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** Desenha o SVG num canvas do tamanho pedido e devolve o PNG. */
async function rasterize(win, svgText, size) {
  const dataUrl = await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = ${size}; c.height = ${size}
        const ctx = c.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, ${size}, ${size})
        resolve(c.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('SVG inválido'))
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svgText).toString('base64'))}
    })
  `)
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

/** ICO com entradas PNG (aceito pelo Windows Vista em diante e pelo electron-builder). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reservado
  header.writeUInt16LE(1, 2) // tipo: ícone
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o) // 0 = 256
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2) // paleta
    dir.writeUInt8(0, o + 3) // reservado
    dir.writeUInt16LE(1, o + 4) // planos
    dir.writeUInt16LE(32, o + 6) // bits por pixel
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const svgText = fs.readFileSync(SVG, 'utf8')
    const smallText = fs.readFileSync(SVG_SMALL, 'utf8')
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
    await win.loadURL('about:blank')
    fs.writeFileSync(PNG_OUT, await rasterize(win, svgText, 512))
    const entries = []
    for (const size of ICO_SIZES) {
      const source = size <= SMALL_MAX ? smallText : svgText
      entries.push({ size, png: await rasterize(win, source, size) })
    }
    fs.writeFileSync(ICO_OUT, buildIco(entries))
    console.log(`ok: ${path.relative(ROOT, PNG_OUT)}, ${path.relative(ROOT, ICO_OUT)} (${ICO_SIZES.join(', ')})`)
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
