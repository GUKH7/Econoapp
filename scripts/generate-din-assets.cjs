const { createCanvas } = require('canvas');
const { writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const NAVY = '#0F172A';
const TEAL = '#00D19A';
const OFF_WHITE = '#F5F7FA';

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

function drawMark(ctx, x, y, size) {
  ctx.fillStyle = NAVY;
  roundedRect(ctx, x, y, size, size, size * 0.24);

  ctx.fillStyle = TEAL;
  ctx.beginPath();
  ctx.arc(x + size * 0.29, y + size * 0.29, size * 0.055, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = size * 0.09;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.29, y + size * 0.53);
  ctx.lineTo(x + size * 0.29, y + size * 0.7);
  ctx.lineTo(x + size * 0.48, y + size * 0.7);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x + size * 0.48, y + size * 0.48, size * 0.22, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
}

function saveIcon(output, size, transparent = false) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!transparent) {
    ctx.fillStyle = OFF_WHITE;
    ctx.fillRect(0, 0, size, size);
  }
  const inset = size * 0.1;
  drawMark(ctx, inset, inset, size - inset * 2);
  writeFileSync(output, canvas.toBuffer('image/png'));
}

function saveSplash(output, size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = OFF_WHITE;
  ctx.fillRect(0, 0, size, size);
  drawMark(ctx, size * 0.29, size * 0.24, size * 0.42);
  ctx.fillStyle = NAVY;
  ctx.font = `900 ${Math.round(size * 0.15)}px Arial`;
  ctx.textAlign = 'center';
  ctx.fillText('Din', size / 2, size * 0.82);
  writeFileSync(output, canvas.toBuffer('image/png'));
}

const mobileAssets = path.join(root, 'mobile', 'assets');
const webAssets = path.join(root, 'web', 'assets');
saveIcon(path.join(mobileAssets, 'icon.png'), 1024);
saveIcon(path.join(mobileAssets, 'adaptive-icon.png'), 1024, true);
saveIcon(path.join(mobileAssets, 'favicon.png'), 192);
saveSplash(path.join(mobileAssets, 'splash-icon.png'), 1024);
saveIcon(path.join(webAssets, 'din-icon.png'), 192);

console.log('Ativos Din gerados.');
