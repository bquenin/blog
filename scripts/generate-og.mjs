#!/usr/bin/env node
/**
 * Generates public/default-og.jpg (1200x630), the site-wide social preview
 * image used when a page has no image of its own.
 *
 * Usage: node scripts/generate-og.mjs
 */
/* eslint-disable no-console -- CLI script */
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(ROOT, "public/default-og.jpg");

const font = "Helvetica Neue, Helvetica, Arial, sans-serif";
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#212737"/>
  <rect x="0" y="600" width="1200" height="30" fill="#ff6b01"/>
  <text x="600" y="345" text-anchor="middle" font-family="${font}" font-weight="700"
        font-size="220" fill="#eaedf3" letter-spacing="-6">qube</text>
  <text x="600" y="450" text-anchor="middle" font-family="${font}" font-size="44"
        fill="#eaedf3" fill-opacity="0.75">Bertrand Quenin · bquenin.dev</text>
</svg>`;

await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(out);
console.log(`wrote ${path.relative(ROOT, out)}`);
