import { Router, Request, Response } from 'express';
import { createRule, activateRule, listRules } from '../rules';
import type { Rule } from '../../shared/types';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(listRules());
});

router.post('/', (req: Request, res: Response) => {
  try {
    const input = req.body as {
      version: string;
      over_prep_threshold_pct: number;
      over_prep_threshold_abs: number;
      spoilage_temp_min: number;
      spoilage_temp_max: number;
      description: string;
    };

    if (!input.version) return res.status(400).json({ error: '版本号必填' });

    const rule: Rule = createRule(input);
    res.json(rule);
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '版本号已存在' });
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/:id/activate', (req: Request, res: Response) => {
  try {
    activateRule(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
