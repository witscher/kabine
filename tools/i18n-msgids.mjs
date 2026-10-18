// Prints the messages (msgid as in the catalogs) of the given source files, without touching the
// catalogs. Used when converting texts: the German translation goes into locales/de/*.json under
// exactly this msgid. Usage: node tools/i18n-msgids.mjs src/pages/login.tsx [more files]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformAsync } from "@babel/core";
import { getConfig } from "@lingui/conf";

const config = getConfig({ configPath: fileURLToPath(new URL("../lingui.config.ts", import.meta.url)) });
const out = [];
for (const file of process.argv.slice(2)) {
  await transformAsync(readFileSync(file, "utf8"), {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [
      ["@lingui/babel-plugin-lingui-macro", { linguiConfig: config, stripNonEssentialFields: false }],
      ["@lingui/babel-plugin-extract-messages", { onMessageExtracted: (m) => out.push(m.context ? `${m.message ?? m.id}  [context: ${m.context}]` : (m.message ?? m.id)) }],
    ],
  });
}
for (const m of [...new Set(out)]) console.log(JSON.stringify(m));
