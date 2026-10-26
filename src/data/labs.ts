export interface Lab {
  slug: string;
  index: string;
  title: string;
  summary: string;
  command: string;
  tags: string[];
  date: string;
  readTime: string;
}

export const labs: Lab[] = [
  {
    slug: 'metasploitable',
    index: '01',
    title: 'Metasploitable 2: full assessment',
    summary:
      'OpenVAS, Nikto, Nmap, and Netcat against an intentionally vulnerable VM. What the scanners found, what needed triage, and how I would fix it.',
    command: 'nikto -h http://$TARGET:8180',
    tags: ['OpenVAS', 'Nikto', 'Netcat'],
    date: '2026-07-16',
    readTime: '6 min',
  },
  {
    slug: 'nmap',
    index: '02',
    title: 'Nmap: full TCP inventory',
    summary:
      'A complete port scan with service detection. The value is not the open-port list — it is the repeatable baseline and the evidence you keep.',
    command: 'nmap -p- -sV $TARGET -oN nmap-all-ports.txt',
    tags: ['Nmap', 'Enumeration', 'TCP'],
    date: '2026-07-16',
    readTime: '4 min',
  },
  {
    slug: 'wireshark',
    index: '03',
    title: 'Wireshark: ICMP latency',
    summary:
      'Four echo requests to localhost, the gateway, and a public host. A small exercise in capture filters, timestamps, and reading a path.',
    command: 'icmp.type == 8 || icmp.type == 0',
    tags: ['Wireshark', 'ICMP', 'Networking'],
    date: '2026-07-11',
    readTime: '3 min',
  },
  {
    slug: 'foundations',
    index: '04',
    title: 'Linux & scripting foundations',
    summary:
      'Permissions, arguments, interpreted vs compiled, and the first useful automation. The small habits that make larger security work possible.',
    command: 'chmod +x hello.sh && ./hello.sh Yedukrishna',
    tags: ['Linux', 'Bash', 'Python'],
    date: '2026-06-29',
    readTime: '5 min',
  },
];

export const labBySlug = Object.fromEntries(labs.map((lab) => [lab.slug, lab]));
