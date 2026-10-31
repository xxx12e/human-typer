#!/usr/bin/env node
// 发布前自检：清单引用的文件是否齐全、版本号是否一致、有没有远程代码或动态求值。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));

if (manifest.version !== pkg.version) {
  problems.push(`版本不一致：manifest ${manifest.version} / package ${pkg.version}`);
}
if (!fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').includes(`## ${manifest.version}`)) {
  problems.push('CHANGELOG 缺少当前版本条目');
}

const referenced = new Set([
  manifest.background?.service_worker,
  manifest.side_panel?.default_path
].filter(Boolean));
for (const name of referenced) {
  if (!fs.existsSync(path.join(root, name))) problems.push(`清单引用的文件不存在：${name}`);
}
for (const [size, file] of Object.entries(manifest.icons || {})) {
  if (!fs.existsSync(path.join(root, file))) problems.push(`图标文件不存在：${file}（${size}px）`);
}
// 本地化清单：每个声明过的语种都要有消息文件，并包含全部 __MSG_ 引用。
const localeDir = path.join(root, '_locales');
if (manifest.default_locale) {
  const locales = fs.existsSync(localeDir) ? fs.readdirSync(localeDir) : [];
  if (!locales.includes(manifest.default_locale)) problems.push(`缺少默认语种：${manifest.default_locale}`);
  const used = [...fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').matchAll(/__MSG_(\w+)__/g)]
    .map((match) => match[1]);
  for (const locale of locales) {
    const file = path.join(localeDir, locale, 'messages.json');
    if (!fs.existsSync(file)) { problems.push(`缺少消息文件：_locales/${locale}/messages.json`); continue; }
    const messages = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of used) {
      if (!messages[key]?.message) problems.push(`_locales/${locale} 缺少 ${key}`);
    }
  }
}
for (const name of read('popup.html').matchAll(/(?:src|href)="([^"]+)"/g)) {
  const target = name[1];
  if (/^https?:/i.test(target)) problems.push(`popup.html 引用了远程资源：${target}`);
  else if (!fs.existsSync(path.join(root, target))) problems.push(`popup.html 引用的文件不存在：${target}`);
}
// 后台通过 importScripts 加载的脚本也必须存在。
for (const name of read('background.js').matchAll(/importScripts\(([^)]*)\)/g)) {
  for (const file of name[1].matchAll(/'([^']+)'/g)) {
    if (!fs.existsSync(path.join(root, file[1]))) problems.push(`importScripts 引用的文件不存在：${file[1]}`);
  }
}
for (const file of fs.readdirSync(root).filter((name) => name.endsWith('.js'))) {
  const code = read(file);
  if (/\beval\s*\(/.test(code)) problems.push(`${file} 使用了 eval`);
  if (/new\s+Function\s*\(/.test(code)) problems.push(`${file} 使用了 new Function`);
  if (/https?:\/\/[^\s'"`]+\.js\b/.test(code)) problems.push(`${file} 似乎加载了远程脚本`);
}
if (!manifest.permissions?.includes('scripting')) problems.push('缺少 scripting 权限');

if (problems.length) {
  console.error(problems.map((line) => `- ${line}`).join('\n'));
  process.exit(1);
}
console.log(`自检通过：v${manifest.version}，权限 ${manifest.permissions.join(', ')}`);
