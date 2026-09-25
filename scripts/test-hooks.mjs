// Tests run outside Next. On the server, Next resolves "server-only" to a no-op (its point is
// to fail client bundles); do the same here so server modules can be imported by tests.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const empty = pathToFileURL(resolvePath("node_modules/server-only/empty.js")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: empty, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
