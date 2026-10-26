#!/usr/bin/env node
/**
 * Discover public repositories, score them, and write the project data used by
 * the portfolio. New projects are never published automatically: this script
 * only prepares a reviewable diff, and the workflow opens a pull request.
 *
 * Usage:
 *   GH_TOKEN=... npm run sync
 *   GH_TOKEN=... npm run sync:dry
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Octokit } from 'octokit';
import {
  buildReport,
  capProjects,
  categorizeRepo,
  normalizeRepo,
  renderReportMarkdown,
  scoreRepo,
  slugify,
  sortProjects,
} from './lib.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const projectsPath = path.join(root, 'src/data/projects.json');
const overridesPath = path.join(root, 'src/data/overrides.json');
const reportJsonPath = path.join(root, 'src/data/sync-report.json');
const reportMdPath = path.join(root, 'src/data/sync-report.md');
const siteConfigPath = path.join(root, 'site.config.json');

const dryRun = process.argv.includes('--dry-run');
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const site = JSON.parse(await readFile(siteConfigPath, 'utf8'));
const handle = process.env.GITHUB_HANDLE || site.handle;

if (!handle) {
  throw new Error('No GitHub handle found. Set GITHUB_HANDLE or site.config.json handle.');
}

if (!token) {
  console.warn(
    'No GH_TOKEN or GITHUB_TOKEN set. GitHub allows a small number of unauthenticated requests; this may fail.',
  );
}

const octokit = new Octokit({
  auth: token || undefined,
  userAgent: 'yedukrishna-portfolio-sync',
});

function isNotFound(error) {
  return error?.status === 404 || error?.response?.status === 404;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function humanizeName(name) {
  return String(name).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstSentence(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return sentence.length > 150 ? `${sentence.slice(0, 147).trimEnd()}…` : sentence;
}

function fallbackTagline(repo) {
  return firstSentence(repo.description) || `Source and notes for ${humanizeName(repo.name)}.`;
}

function fallbackDescription(repo) {
  return (
    repo.description ||
    `Source, notes, and revision history for ${humanizeName(repo.name)}.`
  );
}

function repoKeyFromUrl(url) {
  if (!url) return '';
  const match = String(url).match(/github\.com\/[^/]+\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function storedProject(project) {
  return {
    slug: project.slug || slugify(project.name),
    name: project.name,
    tagline: project.tagline || '',
    description: project.description || '',
    url: project.url,
    homepage: project.homepage || '',
    language: project.language || '',
    topics: project.topics || [],
    stars: Number(project.stars) || 0,
    forks: Number(project.forks) || 0,
    score: Number(project.score) || 0,
    category: project.category || 'lab',
    pinned: Boolean(project.pinned),
    createdAt: project.createdAt || '',
    pushedAt: project.pushedAt || '',
    release: project.release || '',
    license: project.license || '',
    highlights: project.highlights || [],
    caseStudy: project.caseStudy || '',
    cover: project.cover || '',
  };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

async function fetchPinnedNames(login) {
  try {
    const data = await octokit.graphql(
      `query PinnedRepositories($login: String!) {
        user(login: $login) {
          pinnedItems(first: 6, types: REPOSITORY) {
            nodes {
              ... on Repository {
                nameWithOwner
              }
            }
          }
        }
      }`,
      { login },
    );

    return new Set(
      (data?.user?.pinnedItems?.nodes || [])
        .map((node) => node?.nameWithOwner?.split('/')?.[1])
        .filter(Boolean),
    );
  } catch (error) {
    console.warn(
      `Could not read pinned repositories (${error?.message || 'unknown error'}). Continuing without pins.`,
    );
    return new Set();
  }
}

async function fetchReadme(owner, repo) {
  try {
    const { data } = await octokit.rest.repos.getReadme({
      owner,
      repo,
      mediaType: { format: 'raw' },
    });

    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && data.content) {
      return Buffer.from(data.content, 'base64').toString('utf8');
    }
    return '';
  } catch (error) {
    if (isNotFound(error)) return '';
    throw error;
  }
}

async function fetchPaths(owner, repo, defaultBranch) {
  try {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch,
      recursive: 'true',
    });

    return (data.tree || [])
      .filter((item) => item.type === 'blob' && item.path)
      .map((item) => item.path);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function fetchLatestRelease(owner, repo) {
  try {
    const { data } = await octokit.rest.repos.getLatestRelease({ owner, repo });
    return data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function fetchExtras(repo, owner) {
  const [readme, paths, latestRelease] = await Promise.all([
    fetchReadme(owner, repo.name),
    fetchPaths(owner, repo.name, repo.default_branch || 'main'),
    fetchLatestRelease(owner, repo.name),
  ]);

  return { readme, paths, latestRelease };
}

function buildProject(repo, extras, override, previous, pinned) {
  const normalized = normalizeRepo(repo, { ...extras, pinned });
  const scored = scoreRepo(normalized);
  const category = categorizeRepo(normalized, override);

  if (category !== 'featured' && category !== 'lab') return null;

  const signals = [
    ...(override.category ? [`override:${override.category}`] : []),
    ...(override.featured ? ['override:featured'] : []),
    ...scored.signals,
  ];

  return {
    slug: override.slug || previous?.slug || slugify(repo.name),
    name: override.name || previous?.name || repo.name,
    tagline:
      override.tagline ||
      previous?.tagline ||
      fallbackTagline(normalized),
    description:
      override.description ||
      previous?.description ||
      fallbackDescription(normalized),
    url: normalized.url,
    homepage: normalized.homepage || previous?.homepage || '',
    language:
      override.languageLabel ||
      previous?.language ||
      normalized.language ||
      'Mixed',
    topics: unique([
      ...(override.topics || []),
      ...(normalized.topics || []),
      ...(previous?.topics || []),
    ]),
    stars: normalized.stars,
    forks: normalized.forks,
    score: scored.score,
    signals,
    penalties: scored.penalties,
    category,
    order: override.order,
    pinned: normalized.pinned,
    createdAt: normalized.createdAt,
    pushedAt: normalized.pushedAt,
    release: normalized.latestRelease || previous?.release || '',
    license: normalized.license || previous?.license || '',
    highlights: override.highlights || previous?.highlights || [],
    caseStudy: override.caseStudy || previous?.caseStudy || '',
    cover: override.cover || previous?.cover || '',
  };
}

async function main() {
  console.log(`Reading public repositories for @${handle}${dryRun ? ' (dry run)' : ''}...`);

  const [repos, overrides, previousData, pinnedNames] = await Promise.all([
    octokit.paginate(octokit.rest.repos.listForUser, {
      username: handle,
      per_page: 100,
      type: 'owner',
      sort: 'pushed',
    }),
    readFile(overridesPath, 'utf8').then(JSON.parse),
    readFile(projectsPath, 'utf8')
      .then(JSON.parse)
      .catch((error) => {
        if (error?.code === 'ENOENT') return { projects: [] };
        throw error;
      }),
    fetchPinnedNames(handle),
  ]);

  const oldProjects = (previousData.projects || []).map(storedProject);
  const oldByRepo = new Map(
    oldProjects
      .map((project) => [repoKeyFromUrl(project.url), project])
      .filter(([key]) => key),
  );

  const candidates = repos.filter((repo) => {
    const override = overrides[repo.name] || {};
    if (repo.private || repo.disabled || repo.fork || repo.archived || !repo.size) return false;
    if (override.hidden) return false;
    if (repo.name.toLowerCase().endsWith('.github.io')) return false;
    if (repo.name.toLowerCase() === handle.toLowerCase()) return false;
    return true;
  });

  console.log(
    `Found ${repos.length} public repositories; checking ${candidates.length} candidates.`,
  );

  const projects = (
    await mapLimit(candidates, 4, async (repo) => {
      const extras = await fetchExtras(repo, handle);
      const override = overrides[repo.name] || {};
      const previous = oldByRepo.get(repo.name.toLowerCase());
      return buildProject(repo, extras, override, previous, pinnedNames.has(repo.name));
    })
  ).filter(Boolean);

  const sorted = capProjects(sortProjects(projects, overrides), 6, 8).filter(
    (project) => project.category === 'featured' || project.category === 'lab',
  );
  const nextProjects = sorted.map(storedProject);
  const dataChanged =
    JSON.stringify(nextProjects) !== JSON.stringify(oldProjects);
  const report = buildReport(oldProjects, sorted, handle, new Date());

  if (dryRun) {
    console.log('');
    console.log(renderReportMarkdown(report));
    console.log('');
    console.log(
      dataChanged
        ? 'Dry run: project data would change.'
        : 'Dry run: project data is already current.',
    );
    return;
  }

  if (!dataChanged) {
    console.log('Project data is already current. Nothing written.');
    return;
  }

  const nextData = {
    generatedAt: new Date().toISOString(),
    projects: nextProjects,
  };

  await mkdir(path.dirname(reportJsonPath), { recursive: true });
  await Promise.all([
    writeFile(projectsPath, `${JSON.stringify(nextData, null, 2)}\n`),
    writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(reportMdPath, `${renderReportMarkdown(report)}\n`),
  ]);

  console.log('');
  console.log(renderReportMarkdown(report));
  console.log('');
  console.log(`Wrote ${path.relative(root, projectsPath)} and sync reports.`);
}

main().catch((error) => {
  console.error(`Project sync failed: ${error?.message || error}`);
  process.exitCode = 1;
});
