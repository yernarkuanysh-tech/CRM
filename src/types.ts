export type Level = 'Бакалавриат' | 'Магистратура' | 'PhD';
export type AppStatus = 'Подбор программы' | 'Документы' | 'Подана' | 'Интервью' | 'Оффер' | 'Отказ';
export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'CHF' | 'KZT';
export type FeeStatus = 'unknown' | 'unpaid' | 'paid' | 'waived';
export type TestType = 'IELTS' | 'TOEFL' | 'TOEFL-120' | 'DET';

export interface Application {
  id: string;
  university: string;
  program: string;
  country: string;
  deadline: string;
  status: AppStatus;
  feeAmount?: number | null;
  feeCurrency?: Currency;
  feeStatus?: FeeStatus;
  feePaidDate?: string;
}

export interface Task {
  id: string;
  title: string;
  date: string;
  done: boolean;
}

export interface ClientDocument {
  id: string;
  name: string;
  type: string;
  url: string;
}

export interface TestResult {
  id: string;
  type: TestType;
  score: number;
  date: string;
}

export interface FeeTotal {
  currency: string;
  amount: number;
}

export interface ReportEvent {
  date: string;
  channel: string;
  note: string;
  recordedAt: string;
  source: string;
}

export interface ReportApplication {
  university: string;
  program: string;
  status: AppStatus;
  deadline: string;
  feeAmount: number | null;
  feeCurrency: Currency;
  feeStatus: FeeStatus;
}

export interface Report {
  id: string;
  demo: boolean;
  client: {name: string; level: Level; year: number; semester: string; consultant: string};
  stage: string;
  from: string;
  to: string;
  done: string;
  next: string;
  clientAction: string;
  applications: ReportApplication[];
  appCount: number;
  sentCount: number;
  offerCount: number;
  fees: FeeTotal[];
  periodFees: FeeTotal[];
  undatedPaid: number;
  createdAt: string;
  createdDate?: string;
  sent: ReportEvent | null;
  ack: ReportEvent | null;
}

export interface Client {
  id: string;
  name: string;
  level: Level;
  year: number;
  email?: string;
  phone?: string;
  country?: string;
  folder?: string;
  academicField?: string;
  semester?: string;
  funding?: string;
  english?: string;
  exam?: string;
  consultant?: string;
  startDate?: string;
  notes?: string;
  gmailEmail?: string;
  apps: Application[];
  docs: ClientDocument[];
  tasks: Task[];
  tests?: TestResult[];
  reports?: Report[];
  demo?: boolean;
}

export type Role = 'owner' | 'staff';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Settings {
  name?: string;
  email?: string;
  organization: string;
  year: number;
  recoveryEnabled?: boolean;
  currentUser: User | null;
  teamCount: number;
}

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  expires: number;
  sentAt: string | null;
}

export interface Team {
  limit: number;
  used: number;
  mailConfigured: boolean;
  staff: StaffMember[];
  invitations: Invitation[];
}
