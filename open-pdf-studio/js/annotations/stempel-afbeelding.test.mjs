// Eigen stempel uit een afbeelding (#749): het type herkennen en alleen
// PNG/JPEG rechtstreeks insluiten; de rest wordt PNG.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { mimeUitNaam, formaatUitBytes, isInsluitbaar } from './stempel-afbeelding.js';

const bytes = (...b) => new Uint8Array(b);
const tekst = (s) => new TextEncoder().encode(s);

test('MIME-type uit de bestandsnaam', () => {
  assert.equal(mimeUitNaam('C:\\stempels\\Logo.PNG'), 'image/png');
  assert.equal(mimeUitNaam('/home/a/stempel.svg'), 'image/svg+xml');
  assert.equal(mimeUitNaam('foto.jpeg'), 'image/jpeg');
  assert.equal(mimeUitNaam('kaart.gif'), 'image/gif');
  assert.equal(mimeUitNaam('zonder-extensie'), '');
});

test('formaat uit de eerste bytes', () => {
  assert.equal(formaatUitBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'png');
  assert.equal(formaatUitBytes(bytes(0xff, 0xd8, 0xff, 0xe0)), 'jpeg');
  assert.equal(formaatUitBytes(tekst('GIF89a....')), 'gif');
  assert.equal(formaatUitBytes(tekst('BM......')), 'bmp');
  assert.equal(formaatUitBytes(tekst('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(formaatUitBytes(tekst('<?xml version="1.0"?>\n<!-- x -->\n<svg xmlns="http://www.w3.org/2000/svg"/>')), 'svg');
  assert.equal(formaatUitBytes(tekst('gewoon tekst')), '');
});

test('alleen PNG en JPEG gaan rechtstreeks naar pdf-lib', () => {
  assert.equal(isInsluitbaar('png'), true);
  assert.equal(isInsluitbaar('jpeg'), true);
  for (const f of ['gif', 'bmp', 'svg', 'webp', '']) assert.equal(isInsluitbaar(f), false, f);
});

test('de stempel bewaart een data:-URL en de saver zet andere formaten om naar PNG', () => {
  const stamps = fs.readFileSync(new URL('./stamps.js', import.meta.url), 'utf8');
  const laden = stamps.slice(stamps.indexOf('async function loadCustomStamp('));
  assert.doesNotMatch(laden, /imageData: url/, 'geen tijdelijke blob:-URL meer');
  assert.match(laden, /readAsDataURL\(blob\)/);
  assert.match(laden, /alsPngDataUrl\(img\)/);
  assert.match(laden, /new Blob\(\[bytes\], mime \? \{ type: mime \} : \{\}\)/);
  const saver = fs.readFileSync(new URL('../pdf/saver.js', import.meta.url), 'utf8');
  const lees = saver.slice(saver.indexOf('async function imageBytesFromDataUrl('), saver.indexOf('async function naarPngBytes('));
  assert.match(lees, /if \(!isInsluitbaar\(formaat\)\) bytes = await naarPngBytes\(bytes, formaat\);/);
});
