import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  if (/^[a-zA-Z]:[\\/]/.test(specifier)) {
    specifier = pathToFileURL(specifier).href;
  }

  if (specifier.startsWith('@/')) {
    const resolvedPath = path.resolve('.', specifier.slice(2));
    for (const ext of ['', '.ts', '.tsx', '.js', '/index.ts', '/index.js']) {
      if (existsSync(resolvedPath + ext)) {
        return nextResolve(pathToFileURL(resolvedPath + ext).href, context);
      }
    }
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && context.parentURL) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const target = path.resolve(parentDir, specifier);
      for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js']) {
        if (existsSync(target + ext)) {
          return nextResolve(pathToFileURL(target + ext).href, context);
        }
      }
    }
    throw err;
  }
}
