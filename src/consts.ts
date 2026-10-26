import siteConfig from '../site.config.json';

export const SITE = siteConfig;

export const NAV = [
  { href: '/work/', label: 'Work' },
  { href: '/lab/', label: 'Lab' },
  { href: '/about/', label: 'About' },
  { href: '/#contact', label: 'Contact' },
];

export const SOCIALS = [
  { href: SITE.githubUrl, label: 'GitHub' },
  ...(SITE.linkedinUrl ? [{ href: SITE.linkedinUrl, label: 'LinkedIn' }] : []),
  { href: `mailto:${SITE.email}`, label: 'Email' },
];
