#!/usr/bin/env node
/**
 * build-client.mjs — 把 src/client/panel.js 生成为 lib/client.js。
 *
 * 1.2.0 起面板源码自包含在本仓库（不再按绝对行号从兄弟仓库抽取），
 * 构建只做两件事：套上宿主模块加载器的壳、把 id 与 package.json 对齐。
 *
 * 运行：node scripts/build-client.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const source = readFileSync(join(root, 'src', 'client', 'panel.js'), 'utf8')

const withId = /window\.__ModuleLoader__\.load\(\{\s*\n\s*id: "[^"]+"/.test(source)
  ? source.replace(/(window\.__ModuleLoader__\.load\(\{\s*\n\s*id: ")[^"]+(")/, '$1' + pkg.name + '$2')
  : source
writeFileSync(join(root, 'lib', 'client.js'), withId)
console.log('已生成 lib/client.js（' + String(withId.length) + ' 字节，id=' + pkg.name + '）')
