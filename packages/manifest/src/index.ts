export {
  ManifestSchema,
  StageParamsSchema,
  ProxyVariantSchema,
  TierSchema,
  Vec3Schema,
  type Manifest,
  type StageParams,
  type ProxyVariant,
  type Tier,
  type Vec3,
} from './schema.js';
export { validateManifest, ManifestValidationError } from './validate.js';
export { resolveUrl } from './resolve-url.js';
