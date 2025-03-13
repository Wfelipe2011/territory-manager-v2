export interface Output {
  territoryName: string;
  blockName: string;
  streetName: string;
  houses: {
    id: number;
    number: string;
    complement: string | null;
    leaveLetter: boolean;
    legend: string | null;
    order: number | null;
    status: boolean;
  }[];
}

export interface Round {
  id: number;
  house_id: number;
  territory_id: number;
  completed: boolean;
  leave_letter: boolean;
  start_date: Date;
  update_date: Date;
  completed_date: Date;
  end_date: null;
  congregation_id: number;
}
