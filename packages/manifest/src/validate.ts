import type { z } from 'zod';
import { ManifestSchema, type Manifest } from './schema.js';

export class ManifestValidationError extends Error {
  readonly issues: { path: string; message: string }[];

  constructor(issues: { path: string; message: string }[]) {
    const summary = issues.map((i) => `  - ${i.path || '(root)'}: ${i.message}`).join('\n');
    super(`Invalid understudy manifest:\n${summary}`);
    this.name = 'ManifestValidationError';
    this.issues = issues;
  }
}

function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Parses and validates a manifest. Throws ManifestValidationError with a
 * readable path for every problem found (not just the first one).
 */
export function validateManifest(json: unknown): Manifest {
  const result = ManifestSchema.safeParse(json);
  if (!result.success) {
    throw new ManifestValidationError(formatIssues(result.error));
  }
  return result.data;
}
