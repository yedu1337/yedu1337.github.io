import rss from '@astrojs/rss';
import { labs } from '../data/labs';
import { SITE } from '../consts';

export async function GET(context) {
  return rss({
    title: `${SITE.name} — Lab Notes`,
    description: 'Short, reproducible security lab notes from an isolated home lab.',
    site: context.site,
    items: labs.map((lab) => ({
      title: lab.title,
      description: lab.summary,
      link: `/lab/${lab.slug}/`,
      pubDate: new Date(lab.date),
    })),
    customData: '<language>en-us</language>',
  });
}
