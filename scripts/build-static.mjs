import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');
const srcDir = path.join(rootDir, 'src');

async function exists(filePath){
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

async function copyDirectory(source, target){
  if (!(await exists(source))) return;
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries){
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()){
      await copyDirectory(from, to);
    } else if (entry.isFile()){
      await fs.copyFile(from, to);
    }
  }
}

function transformIndex(html){
  let output = html
    .replace(/\s*<script\s+type="module"\s+src="\/src\/main\.js"><\/script>\s*/i, '\n')
    .replace(/<link\s+rel="stylesheet"\s+href="\/src\/styles\.css"\s*\/?>(\s*)/i, '<link rel="stylesheet" href="/assets/styles.css" />$1');

  if (!output.includes('/assets/styles.css')){
    output = output.replace('</head>', '  <link rel="stylesheet" href="/assets/styles.css" />\n</head>');
  }

  if (!output.includes('/assets/main.js')){
    output = output.replace('</body>', '  <script defer src="/assets/main.js"></script>\n</body>');
  }

  return output;
}

function transformMain(js){
  return js.replace(/^\s*import\s+['"]\.\/styles\.css['"];?\s*\n/, '');
}

async function main(){
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(path.join(distDir, 'assets'), { recursive: true });

  // Public files such as config.json and the example logo are copied first.
  await copyDirectory(publicDir, distDir);

  // The browser bundle is intentionally dependency-free. We transform the Vite
  // style import into a plain CSS link so the production build can run anywhere.
  const indexHtml = await fs.readFile(path.join(rootDir, 'index.html'), 'utf8');
  await fs.writeFile(path.join(distDir, 'index.html'), transformIndex(indexHtml));

  const mainJs = await fs.readFile(path.join(srcDir, 'main.js'), 'utf8');
  await fs.writeFile(path.join(distDir, 'assets', 'main.js'), transformMain(mainJs));

  await fs.copyFile(path.join(srcDir, 'styles.css'), path.join(distDir, 'assets', 'styles.css'));

  console.log('Static build completed: dist/');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
