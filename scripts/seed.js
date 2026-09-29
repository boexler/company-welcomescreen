// Demo data: two visiting companies with employees and visits today/tomorrow.
//   npm run seed
import { db } from '../src/db.js';
import * as svc from '../src/service.js';

function logo(text, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 90"><rect x="0" y="15" width="60" height="60" rx="14" fill="${color}"/>` +
    `<text x="30" y="56" font-family="Segoe UI, Arial" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${text[0]}</text>` +
    `<text x="78" y="58" font-family="Segoe UI, Arial" font-size="34" font-weight="700" fill="#1d2433">${text}</text></svg>`;
}

const demo = [
  {
    name: 'Northwind Engineering',
    logo: logo('Northwind', '#1f6feb'),
    employees: [['Anna Becker', 'Managing Director'], ['Jonas Weber', 'Head of Purchasing'], ['Lea Hoffmann', 'Project Manager']],
    visit: { date: 'today', hosts: ['John Smith', 'Lisa Miller'], message: 'Great to have you here! Your meeting takes place in conference room “Rhine”.' },
  },
  {
    name: 'Solaris Energy AG',
    logo: logo('Solaris', '#f59e0b'),
    employees: [['Tom Schneider', 'CTO'], ['Mia Fischer', 'Key Account Manager']],
    visit: { date: 'today', end_date: 'tomorrow', hosts: ['Jane Doe'] },
  },
];

for (const c of demo) {
  const exists = db.prepare('SELECT id FROM companies WHERE name = ?').get(c.name);
  if (exists) {
    console.log(`Skipped (exists): ${c.name}`);
    continue;
  }
  svc.createCompany({ name: c.name, logo: c.logo });
  c.employees.forEach(([name, title], i) => svc.createEmployee({ company: c.name, name, title, sort_order: i }));
  svc.createVisit({ company: c.name, ...c.visit });
  console.log(`Created: ${c.name} (${c.employees.length} employees)`);
}
