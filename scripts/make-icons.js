// Gera os PNGs dos ícones a partir dos SVGs usando o próprio Electron.
// Uso: npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function render(win, svgFile, size, out) {
  const b64 = fs.readFileSync(svgFile).toString('base64');
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="data:image/svg+xml;base64,${b64}" style="width:100vw;height:100vh;display:block"></body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await delay(150);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.resize({ width: size, height: size, quality: 'best' }).toPNG());
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1024, height: 1024, useContentSize: true, transparent: true, frame: false,
    enableLargerThanScreen: true, webPreferences: { offscreen: true },
  });
  win.setContentSize(1024, 1024);

  const iconset = path.join(root, 'build', 'icon.iconset');
  fs.mkdirSync(iconset, { recursive: true });
  const sizes = [16, 32, 128, 256, 512];
  for (const s of sizes) {
    await render(win, path.join(root, 'assets', 'icon.svg'), s, path.join(iconset, `icon_${s}x${s}.png`));
    await render(win, path.join(root, 'assets', 'icon.svg'), s * 2, path.join(iconset, `icon_${s}x${s}@2x.png`));
  }
  await render(win, path.join(root, 'assets', 'icon.svg'), 512, path.join(root, 'assets', 'icon.png'));
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'build', 'icon.icns')]);
  fs.rmSync(iconset, { recursive: true, force: true });

  await render(win, path.join(root, 'assets', 'tray.svg'), 18, path.join(root, 'assets', 'trayTemplate.png'));
  await render(win, path.join(root, 'assets', 'tray.svg'), 36, path.join(root, 'assets', 'trayTemplate@2x.png'));
  console.log('Ícones gerados.');
  app.quit();
});
