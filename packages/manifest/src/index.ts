export {
  ManifestSchema,
  StageParamsSchema,
  ProxyVariantSchema,
  ProxyPosterSchema,
  TierSchema,
  Vec3Schema,
  type Manifest,
  type StageParams,
  type ProxyVariant,
  type ProxyPoster,
  type Tier,
  type Vec3,
} from './schema.js';
export { validateManifest, ManifestValidationError } from './validate.js';
export { resolveUrl } from './resolve-url.js';
