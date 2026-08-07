import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const INDEX_PATH = resolve("site/index.html");
const CSS_MARKER = '<link rel="stylesheet" href="./cc-ui.css" />';
const JS_MARKER = '<script src="./cc-ui.js"></script>';

let html = await readFile(INDEX_PATH, "utf8");
let changed = false;

if (!html.includes(CSS_MARKER)) {
  html = html.replace("</head>", `  ${CSS_MARKER}\n</head>`);
  changed = true;
}

if (!html.includes(JS_MARKER)) {
  html = html.replace("</body>", `  ${JS_MARKER}\n</body>`);
  changed = true;
}

if (changed) {
  await writeFile(INDEX_PATH, html, "utf8");
  console.log("Enabled crowd-control UI assets in site/index.html.");
} else {
  console.log("Crowd-control UI assets are already enabled.");
}
