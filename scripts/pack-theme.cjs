// Packs a theme folder (theme.json plus the pictures and fonts it names) into a .notestheme file
// you can import in Settings → Appearance. See src/shared/themePack.ts for what theme.json holds.
//
//   npm run pack-theme -- path/to/theme-folder [out.notestheme]

const { readdirSync, readFileSync, statSync, writeFileSync } = require('fs')
const { basename, join, relative, resolve } = require('path')
const JSZip = require('jszip')

const folder = process.argv[2]
if (!folder) {
  console.error('Usage: npm run pack-theme -- <theme folder> [out.notestheme]')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(folder, 'theme.json'), 'utf8'))
const out = resolve(process.argv[3] || `${basename(resolve(folder))}.notestheme`)

function* filesIn(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* filesIn(full)
    else yield full
  }
}

const zip = new JSZip()
for (const file of filesIn(folder)) {
  if (basename(file).startsWith('.')) continue
  zip.file(relative(folder, file).split('\\').join('/'), readFileSync(file))
}
zip
  .generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  .then((data) => {
    writeFileSync(out, data)
    console.log(`${manifest.name}: ${out} (${(data.length / 1024 / 1024).toFixed(1)} MB)`)
  })
