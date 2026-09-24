import { readFile, writeFile } from "node:fs/promises";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: npm run version:set -- 0.1.1");
  process.exit(1);
}

async function updateJson(path, change) {
  const data = JSON.parse(await readFile(path, "utf8"));
  change(data);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

await updateJson("package.json", data => { data.version = version; });
await updateJson("package-lock.json", data => {
  data.version = version;
  data.packages[""].version = version;
});
await updateJson("src-tauri/tauri.conf.json", data => { data.version = version; });
const cargoPath = "src-tauri/Cargo.toml";
const cargo = await readFile(cargoPath, "utf8");
await writeFile(cargoPath, cargo.replace(/^version = "[^"]+"$/m, `version = "${version}"`));
console.log(`Set Daily Drive version to ${version}. Commit the changes and create tag v${version} to build the release.`);
