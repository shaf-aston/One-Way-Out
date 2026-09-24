// Pure core: what counts as an image this app will accept. No I/O.
//
// An image handed to an agent becomes a real file on this machine and a real path typed into
// a terminal, so this is a trust boundary. The bytes decide what a file is — never the type
// the page claimed, and never the name it was given.

/** Caps and the allow-list, in one place so changing them is a config edit, not a hunt. */
export const IMAGE_LIMITS = { bytes: 6 * 1024 * 1024 };

// Each entry: the extension we will write, and the bytes a real file of that kind starts with.
const MAGIC = [
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46], at8: [0x57, 0x45, 0x42, 0x50] },
];

/**
 * Turn a pasted data: URL into bytes worth writing, or say why not.
 * @param {string} dataUrl
 * @param {typeof Buffer} [Buf] - injected so this stays testable without node globals
 * @returns {{ok:true, ext:string, buffer:Buffer}|{ok:false, error:string}}
 */
export function readImage(dataUrl, Buf = Buffer) {
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl ?? ''));
  if (!m) return { ok: false, error: 'That does not look like an image.' };
  const buffer = Buf.from(m[1].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) return { ok: false, error: 'That image is empty.' };
  if (buffer.length > IMAGE_LIMITS.bytes) {
    return { ok: false, error: `Images have to be under ${Math.round(IMAGE_LIMITS.bytes / 1024 / 1024)}MB.` };
  }
  const hit = MAGIC.find((t) => t.bytes.every((b, i) => buffer[i] === b)
    && (!t.at8 || t.at8.every((b, i) => buffer[8 + i] === b)));
  if (!hit) return { ok: false, error: 'Only PNG, JPEG, GIF and WEBP images can be sent.' };
  return { ok: true, ext: hit.ext, buffer };
}
