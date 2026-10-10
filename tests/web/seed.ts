import {levels, statuses} from '../../src/lib/crm';
import {dateAt} from '../../src/lib/dates';
import type {Client} from '../../src/types';

const universities = [['University of Toronto', 'Канада', 'Computer Science'], ['University of Amsterdam', 'Нидерланды', 'Business Analytics'], ['University of Manchester', 'Великобритания', 'Management'], ['Bocconi University', 'Италия', 'Economics'], ['Technical University of Munich', 'Германия', 'Data Science'], ['University of Melbourne', 'Австралия', 'Public Policy'], ['ETH Zürich', 'Швейцария', 'Robotics'], ['University of British Columbia', 'Канада', 'Engineering']];

/** The 100 demo applicants from the original prototype. */
export function seed(): Client[] {
  const first = ['Амина', 'Алихан', 'Диана', 'Данияр', 'Аружан', 'Тимур', 'Айлин', 'Санжар', 'Мадина', 'Нурасыл'];
  const last = ['Садыкова', 'Омаров', 'Ким', 'Нурланов', 'Ахметова', 'Исаев', 'Серикова', 'Толеуов', 'Каримова', 'Алиев'];
  return Array.from({length: 100}, (_, i) => {
    const apps = Array.from({length: 2 + i % 4}, (_, j) => {
      const u = universities[(i + j) % universities.length];
      return {id: `a${i}-${j}`, university: u[0], country: u[1], program: u[2], deadline: dateAt(5 + (i * 3 + j * 7) % 85), status: statuses[(i + j) % 6]};
    });
    return {
      id: `c${i + 1}`,
      name: i < 10 ? first[i] + ' ' + last[i] : first[i % 10] + ' ' + ['Абдрахман', 'Есен', 'Бекен', 'Серик', 'Аман', 'Нур', 'Жан', 'Болат', 'Асқар'][Math.floor(i / 10) - 1],
      email: `applicant${i + 1}@example.com`,
      phone: '',
      level: levels[i % 3],
      year: 2027,
      country: [...new Set(apps.map(a => a.country))].join(', '),
      notes: i === 0 ? 'Интересует Computer Science. Приоритет — программы со стипендией. Проверить требования к портфолио.' : '',
      apps,
      tasks: [{id: `t${i}`, title: ['Проверить мотивационное письмо', 'Запросить рекомендательное письмо', 'Подготовить резюме', 'Проверить перевод диплома', 'Уточнить требования программы'][i % 5], date: dateAt(i < 5 ? i - 1 : 7 + i % 30), done: i % 7 === 6}],
      demo: true,
    };
  });
}
