export interface RawTerritoryAll {
  territory_id: number;
  type_id: number;
  name: string;
  overseer: string;
  signature: number;
  has_rounds: boolean;
  expiration_date: Date;
  key: string;
  positive_completed: Date[];
  negative_completed: string;
}

export interface RawTerritoryOne {
  image_url: string;
  territory_id: number;
  territory_name: string;
  overseer: string;
  signature: number;
  has_rounds: boolean;
  positive_completed: string;
  negative_completed: string;
  block_id: number;
  block_name: string;
  connections: number;
  initial_date: Date;
  expiration_date?: Date;
  finished: boolean;
  signature_key?: string;
  signature_expiration_date?: Date;
  round_update_at?: Date;
}
