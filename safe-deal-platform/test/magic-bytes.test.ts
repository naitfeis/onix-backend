import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectMimeFromMagic, mimeMatchesMagic } from '../src/chat-attachments/magic-bytes';

describe('magic-bytes', () => {
  it('detects jpeg png gif webp pdf', () => {
    assert.equal(detectMimeFromMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
    assert.equal(
      detectMimeFromMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
      'image/png',
    );
    assert.equal(detectMimeFromMagic(Buffer.from('GIF89a......')), 'image/gif');
    const webp = Buffer.alloc(12);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    assert.equal(detectMimeFromMagic(webp), 'image/webp');
    assert.equal(detectMimeFromMagic(Buffer.from('%PDF-1.4....')), 'application/pdf');
  });

  it('rejects mismatch', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    assert.equal(mimeMatchesMagic('image/jpeg', detectMimeFromMagic(png)), false);
    assert.equal(mimeMatchesMagic('image/png', detectMimeFromMagic(png)), true);
  });
});
