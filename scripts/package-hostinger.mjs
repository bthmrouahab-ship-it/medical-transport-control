// يجهّز ملف الرفع إلى Hostinger: محتوى public_html كاملًا (الموقع المبني + خادم PHP) في ملف zip واحد.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("..", import.meta.url));
const site = join(root, "dist", "public");
const api = join(root, "api");
const output = join(root, "dist", "althumama-hostinger.zip");
// ملف الإعداد فيه كلمة مرور قاعدة البيانات: لا يُرفع أبدًا ضمن الحزمة
const skip = new Set(["config.php", ".gitkeep"]);

if (!existsSync(join(site, "index.html"))) {
  console.error("لم يُبنَ الموقع بعد: شغّل vite build أولًا");
  process.exit(1);
}

const files = {};
function add(dir, prefix) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) add(path, `${prefix}${name}/`);
    else if (!skip.has(name)) files[`${prefix}${name}`] = readFileSync(path);
  }
}
add(site, "");
add(api, "api/");

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(output, zipSync(files, { level: 9 }));
const size = (statSync(output).size / 1024 / 1024).toFixed(2);
console.log(`\n✔ ملف الرفع جاهز: ${relative(root, output).split(sep).join("/")} (${Object.keys(files).length} ملف، ${size} ميجابايت)`);
console.log("  ارفعه إلى public_html من File Manager في Hostinger ثم اختر Extract.");
