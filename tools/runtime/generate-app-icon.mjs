/**
 * Build Windows desktop icons from public/app-icon.svg (full-bleed OS tile).
 * Outputs public/icon.ico (multi-size) and public/icon.png (256px).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const svgPath = path.join(root, 'public', 'app-icon.svg');
const fallbackSvg = path.join(root, 'public', 'brand-mark.svg');
const outIco = path.join(root, 'public', 'icon.ico');
const outPng = path.join(root, 'public', 'icon.png');

const sourcePath = fs.existsSync(svgPath) ? svgPath : fallbackSvg;
if (!fs.existsSync(sourcePath)) {
  console.error('Missing icon source:', sourcePath);
  process.exit(1);
}

const svg = fs.readFileSync(sourcePath);

/** Windows taskbar icons look tiny when the glyph floats in transparent padding. */
async function renderIconPng(size) {
  const density = Math.max(128, size * 5);
  return sharp(svg, { density })
    .resize(size, size, { fit: 'fill' })
    .png()
    .toBuffer();
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(sizes.map((size) => renderIconPng(size)));

await sharp(pngBuffers[pngBuffers.length - 1]).toFile(outPng);
const ico = await pngToIco(pngBuffers);
fs.writeFileSync(outIco, ico);

console.log('Wrote', path.relative(root, outIco), 'from', path.relative(root, sourcePath));
console.log('Wrote', path.relative(root, outPng));
