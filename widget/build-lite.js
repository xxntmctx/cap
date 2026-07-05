import fs from "node:fs/promises";
import { transform } from "lightningcss";
import { minify } from "terser";

console.time("build");

// 临时在 i18n 目录中写入 package.json 使其支持 ESM 导入
const tempPkgPath = "./src/src/i18n/package.json";
await fs.writeFile(tempPkgPath, JSON.stringify({ type: "module" }));

let trans;
try {
  trans = await import("./src/src/i18n/translations.js");
} finally {
  try {
    await fs.unlink(tempPkgPath);
  } catch {}
}

const { keys, shipped, shippedKeys, translations } = trans;

const minifyCSS = (input) => {
  const { code } = transform({
    filename: "cap.css",
    code: Buffer.from(input),
    minify: true,
    targets: {
      chrome: 90 << 16,
      firefox: 90 << 16,
      safari: (14 << 16) | (1 << 8),
    },
  });
  return code.toString();
};

const minifyJS = async (input) => {
  return (
    await minify(input, {
      compress: {
        drop_console: false,
        dead_code: true,
        reduce_vars: true,
      },
      output: {
        beautify: false,
        comments: false,
      },
      mangle: true,
    })
  ).code
    .split("\n")
    .map((e) => {
      return e.trimStart();
    })
    .join("\n");
};

const rawMain = await fs.readFile("./src/src/cap.js", "utf-8");
const rawCSS = await fs.readFile("./src/src/cap.css", "utf-8");
const minifiedWorker = await minifyJS(
  await fs.readFile("./src/src/worker.js", "utf-8"),
);
const minifiedCSS = minifyCSS(rawCSS);

const keepIdx = shippedKeys.map((k) => {
  const i = keys.indexOf(k);
  if (i === -1) throw new Error(`shippedKey '${k}' not in keys`);
  return i;
});
const i18nRows = {};
for (const code of shipped) {
  if (!translations[code])
    throw new Error(`shipped lang '${code}' missing from translations`);
  const vals = keepIdx.map((i) => translations[code][i]);
  const bad = vals.find((v) => v.includes("/"));
  if (bad) throw new Error(`'${code}' string contains the "/" delimiter: ${bad}`);
  i18nRows[code] = vals.join("/");
}
const i18nJSON = JSON.stringify(i18nRows);
console.log(
  `i18n: ${shipped.length} langs x ${shippedKeys.length} keys, ${i18nJSON.length}B raw`,
);

const bundle = rawMain
  .replace("%%workerScript%%", () => JSON.stringify(minifiedWorker))
  .replace("%%capCSS%%", () => minifiedCSS)
  .replace("%%i18nKeys%%", () => shippedKeys.join(","))
  .replace("%%i18nData%%", () => i18nJSON);

await fs.writeFile("./src/cap.min.js", bundle);
await fs.writeFile("./src/cap.min.js", await minifyJS(bundle));

await fs.writeFile(
  "./src/cap-floating.min.js",
  await minifyJS(await fs.readFile("./src/src/cap-floating.js", "utf-8")),
);

console.timeEnd("build");
