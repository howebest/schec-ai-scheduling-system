import type { DatasetRecord } from '../api/client';

export interface PageProps {
  datasetId?: string;
  datasets: DatasetRecord[];
  refresh: () => void;
  notify: (text: string) => void;
}
