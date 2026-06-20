import type { Rule } from '../shared/types';

export interface SampleRow {
  batch_id: string;
  dish_name: string;
  planned_weight: number;
  actual_weight: number;
  temperature: number;
  timestamp: string;
}

export function generateSampleBatch(): {
  batchName: string;
  batchDate: string;
  rows: SampleRow[];
} {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const batchName = `样例批次-${dateStr}`;

  const dishes = [
    { name: '红烧肉', base: 500 },
    { name: '清炒时蔬', base: 300 },
    { name: '番茄炒蛋', base: 400 },
    { name: '糖醋排骨', base: 450 },
    { name: '麻婆豆腐', base: 350 },
    { name: '清蒸鲈鱼', base: 600 },
    { name: '宫保鸡丁', base: 380 },
    { name: '鱼香肉丝', base: 420 },
    { name: '酸辣土豆丝', base: 300 },
    { name: '红烧茄子', base: 350 },
    { name: '白切鸡', base: 550 },
    { name: '蛋炒饭', base: 400 },
  ];

  const rows: SampleRow[] = [];
  const baseTime = today;
  baseTime.setHours(10, 30, 0, 0);

  for (let i = 0; i < 3; i++) {
    dishes.forEach((dish, idx) => {
      const planned = dish.base;
      let actual = planned;
      let temp = 50 + Math.random() * 5;

      const anomalyFlag = (i * dishes.length + idx) % 7;
      if (anomalyFlag === 0) {
        actual = planned * (1.2 + Math.random() * 0.15);
      } else if (anomalyFlag === 1) {
        temp = 2 + Math.random();
      } else if (anomalyFlag === 2) {
        temp = 68 + Math.random() * 3;
      } else if (anomalyFlag === 3) {
        actual = planned * (1.18);
      } else if (anomalyFlag === 4 && i === 0) {
          actual = -50;
        } else {
        actual = planned * (0.98 + Math.random() * 0.04);
      }

      const t = new Date(baseTime.getTime() + (i * dishes.length + idx) * 60000);
      rows.push({
        batch_id: '',
        dish_name: dish.name,
        planned_weight: Math.round(planned),
        actual_weight: Math.round(actual * 10) / 10,
        temperature: Math.round(temp * 10) / 10,
        timestamp: t.toISOString(),
      });
    });
  }

  return {
    batchName,
    batchDate: dateStr,
    rows,
  };
}

export const SAMPLE_CSV_HEADER = 'dish_name,planned_weight,actual_weight,temperature,timestamp\n';

export function rowsToCsv(rows: SampleRow[]): string {
  let csv = SAMPLE_CSV_HEADER;
  rows.forEach((r) => {
    csv += `${r.dish_name},${r.planned_weight},${r.actual_weight},${r.temperature},${r.timestamp}\n`;
  });
  return csv;
}
