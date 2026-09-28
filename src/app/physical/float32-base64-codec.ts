// Float32Array <-> base64 (little-endian) so per-cell reference depth fits in localStorage JSON.

// String.fromCharCode spreads stay well below engine argument limits at this chunk size.
const CHUNK_BYTES = 0x8000;

export function float32ToBase64(values: Float32Array): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i], true);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_BYTES));
  }
  return btoa(binary);
}

/** Throws RangeError on malformed base64 or a byte length that is not a whole number of floats. */
export function base64ToFloat32(text: string): Float32Array {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new RangeError('Invalid base64 data');
  }
  if (binary.length % 4 !== 0) throw new RangeError(`Base64 data is ${binary.length} bytes, not a multiple of 4`);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}
