import * as XLSX from 'xlsx';
import type { Attendee } from '@/lib/supabase';

type ExportRow = {
  'Registration Number': string;
  'Delegate Name': string;
  Category: string;
  'Phone Number': string;
  Email: string;
  Gender: string;
  'Food Preference': string;
  'Payment Status': string;
  'Registration Type': string;
  'Attendance Status': string;
  'Created Date': string;
};

export function exportAttendeesToExcel(
  attendees: Attendee[],
  fileName: string = 'attendees',
  includeSensitive: boolean = true,
) {
  const rows: ExportRow[] = attendees.map((a) => ({
    'Registration Number': a.registration_number,
    'Delegate Name': a.name,
    Category: a.category,
    'Phone Number': includeSensitive ? (a.phone_number ?? '') : '',
    Email: includeSensitive ? (a.email ?? '') : '',
    Gender: includeSensitive ? (a.gender ?? '') : '',
    'Food Preference': a.food_preference,
    'Payment Status': a.payment_status,
    'Registration Type':
      a.registration_type === 'spot' ? 'Spot' : 'Pre-Registered',
    'Attendance Status': a.attendance_status.replace(/_/g, ' '),
    'Created Date': new Date(a.created_at).toLocaleString(),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 22 },
    { wch: 28 },
    { wch: 18 },
    { wch: 16 },
    { wch: 28 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 22 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Attendees');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${fileName}_${stamp}.xlsx`);
}
