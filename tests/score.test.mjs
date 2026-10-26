import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildReport,
  capProjects,
  categorizeRepo,
  clamp,
  daysSince,
  isLearningName,
  normalizeRepo,
  renderProfileReadme,
  renderReportMarkdown,
  scoreRepo,
  slugify,
  sortProjects,
} from '../scripts/lib.mjs';

const now = Date.now();
const recent = new Date(now - 5 * 86_400_000).toISOString();
const mature = new Date(now - 60 * 86_400_000).toISOString();

function makeRepo(overrides = {}) {
  return {
    name: 'sample-project',
    description: 'A small security tool with tests and documentation.',
    html_url: 'https://github.com/example/sample-project',
    homepage: 'https://example.dev/sample-project',
    topics: ['security', 'go', 'cli'],
    stargazers_count: 8,
    forks_count: 2,
    created_at: mature,
    pushed_at: recent,
    size: 500,
    license: { spdx_id: 'MIT' },
    fork: false,
    archived: false,
    default_branch: 'main',
    ...overrides,
  };
}

const richExtras = {
  pinned: true,
  paths: [
    '.github/workflows/ci.yml',
    'tests/score.test.mjs',
    'SECURITY.md',
    'cmd/main.go',
  ],
  readme: `# Sample\n\n## Usage\n\nRun it.\n\n## Security\n\nThreat model and disclosure details.\n${'x'.repeat(6000)}`,
  latestRelease: { tag_name: 'v1.2.0' },
};

test('slugify produces stable, URL-safe slugs', () => {
  assert.equal(slugify('Ghost Proxy'), 'ghost-proxy');
  assert.equal(slugify('  Nmap: Full-Port Scan! '), 'nmap-full-port-scan');
  assert.equal(slugify('---'), 'project');
  assert.equal(slugify('A'.repeat(90)).length, 60);
});

test('clamp and daysSince handle boundaries and invalid input', () => {
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(4, 0, 10), 4);
  assert.ok(daysSince(recent) < 6);
  assert.equal(daysSince('not-a-date'), 9999);
});

test('normalizeRepo detects documentation, CI, tests, and release signals', () => {
  const repo = normalizeRepo(makeRepo(), richExtras);

  assert.equal(repo.pinned, true);
  assert.equal(repo.hasReadme, true);
  assert.equal(repo.readmeHasUsage, true);
  assert.equal(repo.readmeHasSecurity, true);
  assert.equal(repo.hasCI, true);
  assert.equal(repo.hasTests, true);
  assert.equal(repo.hasSecurityPolicy, true);
  assert.equal(repo.latestRelease, 'v1.2.0');
  assert.equal(repo.license, 'MIT');
  assert.deepEqual(repo.topics, ['security', 'go', 'cli']);
});

test('scoreRepo rewards strong public evidence and penalizes missing basics', () => {
  const strong = scoreRepo(normalizeRepo(makeRepo(), richExtras));
  const weak = scoreRepo(
    normalizeRepo(
      makeRepo({
        description: '',
        topics: [],
        homepage: '',
        stargazers_count: 0,
        forks_count: 0,
        size: 10,
        license: null,
      }),
    ),
  );

  assert.equal(strong.score, 100);
  assert.ok(strong.signals.includes('pinned'));
  assert.ok(strong.signals.includes('ci'));
  assert.ok(strong.signals.includes('tests'));
  assert.ok(weak.score < strong.score);
  assert.ok(weak.penalties.includes('no-readme'));
  assert.ok(weak.penalties.includes('small-repo'));
  assert.ok(weak.penalties.includes('no-description'));
});

test('categorizeRepo respects hidden, pinned, topics, and overrides', () => {
  const normalized = normalizeRepo(makeRepo(), richExtras);

  assert.equal(categorizeRepo(normalized), 'featured');
  assert.equal(
    categorizeRepo({ ...normalized, pinned: false, topics: ['portfolio-lab'] }),
    'lab',
  );
  assert.equal(
    categorizeRepo({ ...normalized, pinned: false, topics: ['portfolio-hide'] }),
    'hidden',
  );
  assert.equal(categorizeRepo({ ...normalized, isFork: true }), 'hidden');
  assert.equal(
    categorizeRepo({ ...normalized, pinned: false, topics: [] }, { category: 'lab' }),
    'lab',
  );
  assert.equal(categorizeRepo(normalized, { hidden: true }), 'hidden');
});

test('isLearningName catches exercises without hiding real project names', () => {
  assert.equal(isLearningName('3-linux-cli-exercise'), true);
  assert.equal(isLearningName('Task-04'), true);
  assert.equal(isLearningName('Wireshark Notes'), true);
  assert.equal(isLearningName('Ghost-Proxy'), false);
  assert.equal(isLearningName('Guardian-Eye'), false);
});

test('sortProjects honors explicit order before score and recency', () => {
  const projects = [
    { name: 'A', order: 2, pinned: false, score: 90, pushedAt: recent },
    { name: 'B', order: 1, pinned: false, score: 10, pushedAt: recent },
    { name: 'C', pinned: true, score: 70, pushedAt: recent },
    { name: 'D', pinned: false, score: 80, pushedAt: recent },
  ];

  assert.deepEqual(
    sortProjects(projects).map((project) => project.name),
    ['B', 'A', 'C', 'D'],
  );
});

test('capProjects limits both categories and downgrades overflow', () => {
  const projects = [
    { name: 'F1', category: 'featured', score: 90 },
    { name: 'F2', category: 'featured', score: 80 },
    { name: 'F3', category: 'featured', score: 70 },
    { name: 'L1', category: 'lab', score: 50 },
    { name: 'L2', category: 'lab', score: 40 },
  ];

  const capped = capProjects(projects, 2, 1);

  assert.deepEqual(
    capped.map((project) => project.category),
    ['featured', 'featured', 'lab', 'learning', 'learning'],
  );
  assert.equal(capped.filter((project) => project.category === 'featured').length, 2);
  assert.equal(capped.filter((project) => project.category === 'lab').length, 1);
});

test('buildReport detects added, changed, and removed projects', () => {
  const oldProjects = [
    { name: 'A', score: 10, category: 'lab', pinned: false, description: 'old', tagline: 'old', release: '' },
    { name: 'C', score: 5, category: 'learning', pinned: false, description: 'gone', tagline: 'gone', release: '' },
  ];
  const newProjects = [
    {
      name: 'A',
      url: 'https://github.com/example/a',
      score: 70,
      category: 'featured',
      pinned: true,
      description: 'new',
      tagline: 'new',
      release: 'v2',
      signals: ['pinned'],
    },
    {
      name: 'B',
      url: 'https://github.com/example/b',
      score: 40,
      category: 'lab',
      pinned: false,
      description: 'b',
      tagline: 'b',
      release: '',
      signals: ['readme'],
    },
  ];

  const report = buildReport(oldProjects, newProjects, 'example', new Date('2026-01-02T03:04:05Z'));

  assert.equal(report.added.length, 1);
  assert.equal(report.added[0].name, 'B');
  assert.equal(report.changed.length, 1);
  assert.equal(report.changed[0].name, 'A');
  assert.equal(report.removed.length, 1);
  assert.equal(report.removed[0].name, 'C');

  const markdown = renderReportMarkdown(report);
  assert.match(markdown, /New projects/);
  assert.match(markdown, /\[B\]\(https:\/\/github\.com\/example\/b\)/);
  assert.match(markdown, /Removed projects/);
  assert.match(markdown, /- C/);
});

test('renderProfileReadme uses featured and lab data without badge walls', () => {
  const site = {
    name: 'Example Person',
    role: 'Security engineer',
    siteUrl: 'https://example.dev',
    githubUrl: 'https://github.com/example',
    email: 'hello@example.dev',
  };
  const projects = [
    ...Array.from({ length: 4 }, (_, index) => ({
      name: `Featured ${index + 1}`,
      url: `https://github.com/example/f${index + 1}`,
      tagline: `Featured ${index + 1} tagline`,
      language: 'Go',
      category: 'featured',
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      name: `Lab ${index + 1}`,
      url: `https://github.com/example/l${index + 1}`,
      tagline: `Lab ${index + 1} tagline`,
      language: 'Python',
      category: 'lab',
    })),
  ];

  const readme = renderProfileReadme(projects, site);

  assert.match(readme, /<h1>Example Person<\/h1>/);
  assert.match(readme, /Featured 3/);
  assert.doesNotMatch(readme, /Featured 4/);
  assert.match(readme, /Lab 3/);
  assert.doesNotMatch(readme, /Lab 4/);
  assert.match(readme, /no badges, no trackers/i);
});

test('published project data is internally consistent', () => {
  const data = JSON.parse(
    readFileSync(new URL('../src/data/projects.json', import.meta.url), 'utf8'),
  );
  const slugs = new Set();

  assert.ok(data.projects.length > 0);
  for (const project of data.projects) {
    assert.match(project.category, /^(featured|lab)$/);
    assert.ok(project.name);
    assert.ok(project.url.startsWith('https://github.com/'));
    assert.ok(project.tagline);
    assert.ok(project.description);
    assert.ok(project.slug);
    assert.equal(slugs.has(project.slug), false, `duplicate slug: ${project.slug}`);
    slugs.add(project.slug);
  }
});
