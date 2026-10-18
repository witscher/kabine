// Compiles Lingui macros (t, msg, plural, <Trans>) in app, worker and tests. Runs before TypeScript is
// stripped, so Babel parses TS and JSX itself. Only files that import a macro are touched. The browser
// uses the global Lingui instance, the worker the one of the current request (lingui.worker.config.ts).
import { fileURLToPath } from "node:url";
import { transformAsync } from "@babel/core";
import { getConfig } from "@lingui/conf";
import type { Plugin } from "vite";

const MACROS = /@lingui\/(core|react)\/macro/;
const CLIENT_CONFIG = getConfig({ configPath: fileURLToPath(new URL("../lingui.config.ts", import.meta.url)) });
const WORKER_CONFIG = getConfig({ configPath: fileURLToPath(new URL("../lingui.worker.config.ts", import.meta.url)) });

export function linguiMacro(): Plugin {
  return {
    name: "kabine-lingui-macro",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0]!;
      if (!/\.[cm]?[jt]sx?$/.test(file) || file.includes("/node_modules/") || !MACROS.test(code)) return null;
      const client = this.environment?.name === "client";
      const out = await transformAsync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        parserOpts: { plugins: ["typescript", "jsx"] },
        plugins: [["@lingui/babel-plugin-lingui-macro", { linguiConfig: client ? CLIENT_CONFIG : WORKER_CONFIG }]],
      });
      return out?.code ? { code: out.code, map: out.map } : null;
    },
  };
}
