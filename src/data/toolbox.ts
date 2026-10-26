export interface ToolGroup {
  label: string;
  items: string[];
}

export const toolbox: ToolGroup[] = [
  {
    label: 'Build',
    items: ['Go', 'Python', 'JavaScript', 'React', 'Flask', 'SQLite', 'Git'],
  },
  {
    label: 'Security',
    items: ['Nmap', 'Wireshark', 'OpenVAS', 'Nikto', 'Netcat', 'Linux CLI', 'Threat modeling'],
  },
  {
    label: 'Exploring',
    items: ['Docker', 'Detection engineering', 'Cloud security', 'Burp Suite'],
  },
];
