export interface RawHouse {
  house_id: number;
  number: string;
  complement: string | null;
  leave_letter: boolean;
  legend: string | null;
  order: number | null;
  status: boolean;
  street_name: string;
  block_name: string;
  territory_name: string;
  dont_visit: boolean;
  report_type: string;
}
