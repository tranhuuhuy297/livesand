// One-shot GPU -> CPU copy of an f32 storage buffer (debug/tests); stalls on mapAsync, so keep it out of the frame loop.

export async function readStorageBufferF32(device: GPUDevice, source: GPUBuffer, count: number, label: string): Promise<Float32Array> {
  const size = count * 4;
  if (!Number.isInteger(count) || count <= 0 || size > source.size) {
    throw new RangeError(`${label}: cannot read ${count} floats from a ${source.size}-byte buffer`);
  }
  const staging = device.createBuffer({ label: `${label}-readback`, size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    const encoder = device.createCommandEncoder({ label });
    encoder.copyBufferToBuffer(source, 0, staging, 0, size);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    return new Float32Array(staging.getMappedRange().slice(0));
  } finally {
    staging.destroy();
  }
}
