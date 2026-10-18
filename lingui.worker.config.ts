import base from "./lingui.config";

// Worker code translates in the language of the current request or recipient (worker/i18n.ts), not
// with the global Lingui instance of the browser. Only the macro compiler reads this file.
export default { ...base, runtimeConfigModule: { i18n: ["#i18n", "i18n"] } };
