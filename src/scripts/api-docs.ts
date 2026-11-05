import bundleUrl from 'swagger-ui-dist/swagger-ui-bundle.js?url';
import { askForJson, submitMethods, type DocsRequest } from '../lib/api-docs';

/**
 * #781. Mounts Swagger UI on a docs page from the spec the page carries in
 * `data-spec`, so no spec is fetched and the private one never has a URL of
 * its own.
 *
 * The library is the package's own prebuilt bundle, emitted untouched from
 * our origin and loaded as a classic script: bundled through Vite it is one
 * 1.4 MB chunk that cannot be split, and Vite warns on every build.
 */

interface SwaggerUIOptions {
  readonly spec: object;
  readonly domNode: HTMLElement;
  readonly validatorUrl: string | null;
  readonly deepLinking: boolean;
  readonly supportedSubmitMethods: readonly string[];
  readonly syntaxHighlight: { readonly activated: boolean };
  readonly requestInterceptor: (request: DocsRequest) => DocsRequest;
}

declare global {
  interface Window {
    SwaggerUIBundle?: (options: SwaggerUIOptions) => unknown;
  }
}

const loadLibrary = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = bundleUrl;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () =>
      reject(new Error(`could not load ${bundleUrl}`)),
    );
    document.head.append(script);
  });

const mount = document.querySelector<HTMLElement>('[data-spec]');
if (mount) {
  await loadLibrary();
  const SwaggerUIBundle = window.SwaggerUIBundle;
  if (!SwaggerUIBundle)
    throw new Error(`${bundleUrl} defined no SwaggerUIBundle`);
  SwaggerUIBundle({
    spec: JSON.parse(mount.dataset.spec ?? '{}'),
    domNode: mount,
    validatorUrl: null,
    deepLinking: false,
    supportedSubmitMethods: submitMethods(location.hostname),
    // The highlighter colours code with inline styles no stylesheet can reach.
    syntaxHighlight: { activated: false },
    requestInterceptor: askForJson,
  });
}
