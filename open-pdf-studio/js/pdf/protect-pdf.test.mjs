import assert from 'node:assert/strict';
import test from 'node:test';
import { controleerWachtwoorden, bronVoorBeveiliging } from './protect-pdf-regels.js';

const leeg = { gebruiker: '', gebruikerHerhaald: '', eigenaar: '', eigenaarHerhaald: '' };

test('controleerWachtwoorden: minstens één wachtwoord', () => {
  assert.equal(controleerWachtwoorden(leeg), 'protectPdf.needPassword');
});

test('controleerWachtwoorden: een open-wachtwoord alleen is genoeg', () => {
  assert.equal(controleerWachtwoorden({ ...leeg, gebruiker: 'abcdef', gebruikerHerhaald: 'abcdef' }), null);
});

test('controleerWachtwoorden: een rechten-wachtwoord alleen is genoeg', () => {
  assert.equal(controleerWachtwoorden({ ...leeg, eigenaar: 'abcdef', eigenaarHerhaald: 'abcdef' }), null);
});

test('controleerWachtwoorden: herhaling moet kloppen', () => {
  assert.equal(controleerWachtwoorden({ ...leeg, gebruiker: 'abcdef', gebruikerHerhaald: 'abcdeg' }), 'protectPdf.userMismatch');
  assert.equal(controleerWachtwoorden({ ...leeg, eigenaar: 'abcdef', eigenaarHerhaald: '' }), 'protectPdf.ownerMismatch');
});

test('controleerWachtwoorden: twee gelijke wachtwoorden zijn niet toegestaan', () => {
  assert.equal(
    controleerWachtwoorden({ gebruiker: 'abcdef', gebruikerHerhaald: 'abcdef', eigenaar: 'abcdef', eigenaarHerhaald: 'abcdef' }),
    'protectPdf.samePassword');
});

test('controleerWachtwoorden: een te kort wachtwoord wordt geweigerd', () => {
  assert.equal(controleerWachtwoorden({ ...leeg, gebruiker: 'abc', gebruikerHerhaald: 'abc' }), 'protectPdf.tooShort');
  assert.equal(controleerWachtwoorden({ ...leeg, eigenaar: 'ab', eigenaarHerhaald: 'ab' }), 'protectPdf.tooShort');
});

// De bron van de beveiligde kopie: het opgeslagen bestand, nooit een verouderde
// werkkopie, en niets voor een met een wachtwoord geopend document.
test('bronVoorBeveiliging: na een paginabewerking het opgeslagen bestand, niet de werkkopie', () => {
  const doc = { filePath: 'C:/Temp/opds-edit-1.pdf', saveTargetPath: 'D:/Projecten/a.pdf', isUntitled: false };
  assert.equal(bronVoorBeveiliging(doc), 'D:/Projecten/a.pdf');
});

test('bronVoorBeveiliging: zonder werkkopie het geopende bestand', () => {
  assert.equal(bronVoorBeveiliging({ filePath: 'D:/Projecten/a.pdf' }), 'D:/Projecten/a.pdf');
});

test('bronVoorBeveiliging: een met een wachtwoord geopend document levert niets', () => {
  const doc = {
    filePath: 'C:/Temp/opds-beveiligd/1-ab.pdf',
    passwordProtected: true,
    originalFilePath: 'D:/Projecten/geheim.pdf',
  };
  assert.equal(bronVoorBeveiliging(doc), null);
});

test('bronVoorBeveiliging: een naamloos document levert niets', () => {
  assert.equal(bronVoorBeveiliging({ filePath: 'C:/Temp/naamloos.pdf', isUntitled: true }), null);
  assert.equal(bronVoorBeveiliging(null), null);
});
