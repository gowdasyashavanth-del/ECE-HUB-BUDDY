import { ComponentType, lazy, type LazyExoticComponent } from "react";

function isSessionStorageAvailable(): boolean {
  try {
    const test = "__test_storage__";
    sessionStorage.setItem(test, test);
    sessionStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lazy loads a named export from an ES module, with automatic single-reload retry
 * to protect against stale chunk hashes after new deployments.
 */
export function lazyNamed<
  TModule extends Record<string, any>,
  TKey extends keyof TModule
>(
  importer: () => Promise<TModule>,
  name: TKey
): LazyExoticComponent<TModule[TKey] extends ComponentType<infer P> ? ComponentType<P> : ComponentType<any>> {
  return lazy(async () => {
    const retryKey = `chunk_retry_${String(name)}`;
    const storageOk = isSessionStorageAvailable();
    try {
      const module = await importer();
      if (storageOk) {
        try {
          sessionStorage.removeItem(retryKey);
        } catch {
          // Ignore storage cleanup errors
        }
      }
      return { default: module[name] };
    } catch (error) {
      if (storageOk) {
        let alreadyRetried = false;
        try {
          alreadyRetried = Boolean(sessionStorage.getItem(retryKey));
        } catch {
          alreadyRetried = false;
        }

        if (!alreadyRetried) {
          try {
            sessionStorage.setItem(retryKey, "1");
            window.location.reload();
            return new Promise<{ default: any }>(() => {});
          } catch {
            // If setting fails, do not reload to prevent infinite reload loops
          }
        }
        try {
          sessionStorage.removeItem(retryKey);
        } catch {
          // Ignore storage cleanup errors
        }
      }
      throw error;
    }
  });
}
