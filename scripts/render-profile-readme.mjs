#!/usr/bin/env node
/**
 * Render the GitHub profile README from the same project data as the site.
 * The profile repository is updated by a separate, explicitly configured
 * workflow; this script only writes the reviewable source file.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProfileReadme } from './lib.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const check = process.argv.includes('--check');
const projectsPath = path.join(root, 'src/data/projects.json');
const siteConfigPath = path.join(root, 'site.config.json');
const outputPath = path.join(root, 'profile-readme/README.md');

const [site, projectsData] = await Promise.all([
  readFile(siteConfigPath, 'utf8').then(JSON.parse),
  readFile(projectsPath, 'utf8').then(JSON.parse),
]);

const readme = renderProfileReadme(projectsData.projects || [], site);

if (check) {
  let current = '';
  try {
    current = await readFile(outputPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (current !== readme) {
    console.error('profile-readme/README.md is out of date. Run `npm run profile`.');
    process.exitCode = 1;
  } else {
    console.log('Profile README is current.');
  }
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, readme);
  console.log(`Wrote ${path.relative(root, outputPath)}.`);
}
