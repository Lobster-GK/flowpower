#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * 递归合并源目录到目标目录（目标不存在则自动创建，文件以覆盖方式合并）
 * @param {string} source 源目录
 * @param {string} target 目标目录
 */
function mergeDir(source, target) {
  if (!fs.existsSync(source)) {
    console.error(`源目录不存在：${source}`);
    return;
  }
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const tgtPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      mergeDir(srcPath, tgtPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, tgtPath);
    }
  }
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // 脚本所在目录（包内）
const cwdDir = process.env.INIT_CWD || process.cwd(); // 项目根目录（用户执行 npm 命令的目录）

// 1. 合并 .lingma 目录
mergeDir(path.join(scriptDir, '.lingma'), path.join(cwdDir, '.lingma'));

// 2. 复制 skills 目录到 .lingma/skills
mergeDir(path.join(scriptDir, 'skills'), path.join(cwdDir, '.lingma', 'skills'));

// 3. 复制 scene-template 目录到 .lingma/apollo-flowpower/scene-template
mergeDir(
  path.join(scriptDir, 'scene-template'),
  path.join(cwdDir, '.lingma', 'apollo-flowpower', 'scene-template')
);

console.log('所有目录处理完成');