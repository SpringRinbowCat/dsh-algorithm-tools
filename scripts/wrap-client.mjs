/**
 * scripts/wrap-client.mjs
 *
 * 将 tsdown 输出的 ESM client bundle（lib/client.mjs）转换为 dsh client-modules
 * 要求的浏览器注册格式：`window.__ModuleLoader__.load({ id, factory })`。
 *
 * 官方 client 插件（dshmarket / dsh-client-ui-*）的 lib/client.js 都是这种包装；
 * 不做这一步，即使 dsh.client 声明正确，浏览器端也不会注册该 client 插件。
 *
 * 输入：lib/client.mjs（tsdown 的 ESM 输出）
 * 输出：覆盖 lib/client.mjs（CJS factory 包装，导出同名 exports 字段）
 *
 * 处理两种 export 形态（rolldown/tsdown 通常输出尾部集中 export 语句）：
 *   - 尾部 `export { a, b, c };` → 捕获名字并移除
 *   - 内联 `export const x` / `export function x` → 剥掉 export 关键字并捕获名字
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT_ENTRY = join(ROOT, 'client', 'index.ts')
const CLIENT_BUNDLE = join(ROOT, 'lib', 'client.mjs')
// 客户端插件注册 id 必须等于 package.json 的 name，否则改名后浏览器端会注册不上
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const PLUGIN_ID = pkg.name

const result = await build({
  entryPoints: [CLIENT_ENTRY],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  write: false,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
})
const body = result.outputFiles[0]?.text
if (!body) throw new Error('wrap-client: esbuild produced no client bundle')

const wrapped = `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body.trimEnd()}
return module.exports;
} });
`

await writeFile(CLIENT_BUNDLE, wrapped, 'utf8')
console.log(`wrap-client: ${CLIENT_BUNDLE} wrapped`)
