import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { NodeIO } from '@gltf-transform/core';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/**
 * Shared NodeIO instance for both production code and tests: registers every
 * Khronos extension (so arbitrary sample/fixture glTFs round-trip) plus the
 * meshopt encode/decode dependencies (so our own EXT_meshopt_compression
 * tiers can be read back).
 */
export async function createIO(): Promise<NodeIO> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO();
  io.registerExtensions(ALL_EXTENSIONS);
  io.registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  return io;
}
