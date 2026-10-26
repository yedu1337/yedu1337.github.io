/**
 * Pure helpers for the project sync. Keeping the scoring here makes it testable
 * without touching the GitHub API.
 */

export const SECURITY_TOPICS = new Set([
  'security',
  'cybersecurity',
  'infosec',
  'network-security',
  'cryptography',
  'privacy',
  'appsec',
  'devsecops',
  'penetration-testing',
  'threat-modeling',
  'socks5',
  'tls',
  'encryption',
]);

const LEARNING_PATTERNS = [
  /^task[-_ ]?\d+/i,
  /exercise/i,
  /tutorial/i,
  /assignment/i,
  /practice/i,
  /^nmap/i,
  /wireshark/i,
  /metasploitable/i,
  /linux-cli/i,
  /frontend/i,
  /flask/i,
];

const USAGE_PATTERN = /^##\s+(install|installation|usage|quick ?start|getting started|setup)/im;
const SECURITY_PATTERN = /(threat model|security|privacy|disclosure)/i;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function slugify(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}

export function daysSince(value, now = Date.now()) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 9999;
  return Math.max(0, (now - time) / 86_400_000);
}

export function isLearningName(name) {
  return LEARNING_PATTERNS.some((pattern) => pattern.test(name));
}

export function normalizeRepo(repo, extras = {}) {
  const topics = (repo.topics || []).map((topic) => String(topic).toLowerCase());
  const paths = extras.paths || [];
  const readme = extras.readme || '';

  return {
    name: repo.name,
    description: repo.description || '',
    url: repo.html_url,
    homepage: repo.homepage || '',
    topics,
    stars: repo.stargazers_count || 0,
    forks: repo.forks_count || 0,
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    size: repo.size || 0,
    license: repo.license?.spdx_id || '',
    isFork: Boolean(repo.fork),
    isArchived: Boolean(repo.archived),
    isEmpty: (repo.size || 0) === 0,
    defaultBranch: repo.default_branch,
    pinned: Boolean(extras.pinned),
    readmeLength: readme.length,
    hasReadme: Boolean(readme),
    readmeHasUsage: USAGE_PATTERN.test(readme),
    readmeHasSecurity: SECURITY_PATTERN.test(readme),
    hasCI: paths.some((path) => path.startsWith('.github/workflows/')),
    hasTests: paths.some(
      (path) =>
        /(^|\/)(tests?|__tests__)\//.test(path) ||
        /\.(test|spec)\.[a-z0-9]+$/i.test(path),
    ),
    hasSecurityPolicy:
      paths.includes('SECURITY.md') || paths.includes('.github/SECURITY.md'),
    latestRelease: extras.latestRelease?.tag_name || '',
    hasReleases: Boolean(extras.latestRelease),
  };
}

export function scoreRepo(repo) {
  const signals = [];
  const penalties = [];
  let score = 0;

  if (repo.pinned) {
    score += 25;
    signals.push('pinned');
  }

  if (repo.topics.includes('portfolio-featured')) {
    score += 25;
    signals.push('topic:featured');
  }

  if (repo.description) {
    score += 6;
    signals.push('description');
  } else {
    penalties.push('no-description');
  }

  if (repo.readmeLength > 500) {
    score += 6;
    signals.push('readme:500');
  }
  if (repo.readmeLength > 2_000) {
    score += 6;
    signals.push('readme:2k');
  }
  if (repo.readmeLength > 5_000) {
    score += 6;
    signals.push('readme:5k');
  }
  if (repo.readmeLength > 10_000) {
    score += 4;
    signals.push('readme:10k');
  }

  if (repo.topics.length >= 3) {
    score += 5;
    signals.push('topics');
  }
  if (repo.license) {
    score += 4;
    signals.push('license');
  }
  if (repo.homepage) {
    score += 5;
    signals.push('homepage');
  }
  if (repo.readmeHasUsage) {
    score += 4;
    signals.push('usage');
  }

  if (repo.hasCI) {
    score += 5;
    signals.push('ci');
  }
  if (repo.hasTests) {
    score += 5;
    signals.push('tests');
  }
  if (repo.hasReleases) {
    score += 5;
    signals.push('releases');
  }
  if (repo.hasSecurityPolicy) {
    score += 3;
    signals.push('security-policy');
  }

  if (repo.topics.some((topic) => SECURITY_TOPICS.has(topic))) {
    score += 6;
    signals.push('security-topic');
  }
  if (repo.readmeHasSecurity) {
    score += 4;
    signals.push('security-readme');
  }

  const freshness = daysSince(repo.pushedAt);
  if (freshness <= 30) {
    score += 8;
    signals.push('fresh:30d');
  } else if (freshness <= 90) {
    score += 5;
    signals.push('fresh:90d');
  } else if (freshness <= 180) {
    score += 2;
    signals.push('fresh:180d');
  }

  score += Math.min(12, Math.round(4 * Math.log2(1 + repo.stars)));
  if (repo.stars > 0) signals.push(`stars:${repo.stars}`);

  score += Math.min(5, Math.round(2 * Math.log2(1 + repo.forks)));
  if (repo.forks > 0) signals.push(`forks:${repo.forks}`);

  if (daysSince(repo.createdAt) >= 7) {
    score += 3;
    signals.push('mature');
  }

  if (!repo.description) score -= 8;
  if (repo.size < 50) {
    score -= 5;
    penalties.push('small-repo');
  }
  if (isLearningName(repo.name)) {
    score -= 12;
    penalties.push('learning-name');
  }
  if (!repo.hasReadme) {
    score -= 20;
    penalties.push('no-readme');
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    signals,
    penalties,
  };
}

export function categorizeRepo(repo, overrides = {}) {
  if (overrides.hidden) return 'hidden';
  if (repo.isFork || repo.isArchived || repo.isEmpty) return 'hidden';

  const topics = repo.topics || [];
  if (topics.includes('portfolio-hide')) return 'hidden';

  if (overrides.category) return overrides.category;
  if (overrides.featured) return 'featured';
  if (topics.includes('portfolio-featured')) return 'featured';
  if (repo.pinned) return 'featured';
  if (topics.includes('portfolio-lab')) return 'lab';

  const { score } = scoreRepo(repo);
  if (score >= 60) return 'featured';
  if (score >= 30) return 'lab';
  return 'learning';
}

export function sortProjects(projects, overridesByName = {}) {
  return [...projects].sort((a, b) => {
    const orderA = a.order ?? overridesByName[a.name]?.order ?? Number.POSITIVE_INFINITY;
    const orderB = b.order ?? overridesByName[b.name]?.order ?? Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime();
  });
}

export function capProjects(projects, maxFeatured = 6, maxLab = 8) {
  let featured = 0;
  let lab = 0;

  return projects.map((project) => {
    let category = project.category;

    if (category === 'featured') {
      if (featured < maxFeatured) {
        featured += 1;
        return project;
      }
      category = project.score >= 30 ? 'lab' : 'learning';
    }

    if (category === 'lab') {
      if (lab < maxLab) {
        lab += 1;
        return { ...project, category };
      }
      category = 'learning';
    }

    return category === project.category ? project : { ...project, category };
  });
}

export function buildReport(oldProjects, newProjects, handle, generatedAt = new Date()) {
  const oldByName = new Map(oldProjects.map((project) => [project.name, project]));
  const newByName = new Map(newProjects.map((project) => [project.name, project]));

  const added = newProjects.filter((project) => !oldByName.has(project.name));
  const removed = oldProjects.filter((project) => !newByName.has(project.name));
  const changed = newProjects.filter((project) => {
    const old = oldByName.get(project.name);
    if (!old) return false;
    return (
      old.score !== project.score ||
      old.category !== project.category ||
      old.pinned !== project.pinned ||
      old.description !== project.description ||
      old.tagline !== project.tagline ||
      old.release !== project.release
    );
  });

  return {
    generatedAt: generatedAt.toISOString(),
    handle,
    added,
    removed,
    changed,
  };
}

export function renderReportMarkdown(report) {
  const rows = (projects, empty) => {
    if (projects.length === 0) return empty;
    return [
      '| Project | Score | Category | Why |',
      '| --- | ---: | --- | --- |',
      ...projects.map(
        (project) =>
          `| [${project.name}](${project.url}) | ${project.score} | ${project.category} | ${
            project.signals?.slice(0, 4).join(', ') || 'manual override'
          } |`,
      ),
    ].join('\n');
  };

  return [
    '## Project sync',
    '',
    `Generated: ${report.generatedAt}`,
    `Source: @${report.handle}`,
    '',
    '### New projects',
    rows(report.added, 'No new projects.'),
    '',
    '### Changed projects',
    rows(report.changed, 'No changed projects.'),
    '',
    '### Removed projects',
    report.removed.length > 0
      ? report.removed.map((project) => `- ${project.name}`).join('\n')
      : 'No removed projects.',
    '',
    '> Review the generated taglines and scores before merging. Edit `src/data/overrides.json` to change copy or ordering.',
  ].join('\n');
}

export function renderProfileReadme(projects, site) {
  const featured = projects.filter((project) => project.category === 'featured').slice(0, 3);
  const labs = projects.filter((project) => project.category === 'lab').slice(0, 3);

  const projectRows = featured.length
    ? [
        '| Project | What it is | Stack |',
        '| --- | --- | --- |',
        ...featured.map(
          (project) =>
            `| [${project.name}](${project.url}) | ${project.tagline} | ${project.language || '—'} |`,
        ),
      ].join('\n')
    : 'No featured projects yet.';

  const labRows = labs.length
    ? labs.map((project) => `- [${project.name}](${project.url}) — ${project.tagline}`).join('\n')
    : '- Lab notes are published on the portfolio.';

  return `<h1>${site.name}</h1>

<p><strong>${site.role}</strong> building encrypted tunnels, real-time detection systems, and hands-on security labs.</p>

<p>
  <a href="${site.siteUrl}">Portfolio</a> ·
  <a href="${site.githubUrl}">GitHub</a> ·
  <a href="mailto:${site.email}">Email</a>
</p>

## Selected work

<!-- PROJECTS:START -->
${projectRows}
<!-- PROJECTS:END -->

## Lab notes

${labRows}

## Toolbox

Go · Python · JavaScript · React · Flask · Linux · Nmap · Wireshark · OpenVAS · Nikto · Netcat

## Currently

- Building **Ghost-Proxy** — encrypted SOCKS5 tunnel
- Learning **detection engineering, web security, and cloud networking**
- Open to **security engineering, SOC, and offensive security** opportunities

---

<p><small>This profile is generated from my <a href="${site.siteUrl}">portfolio data</a>. No badges, no trackers.</small></p>
`;
}
