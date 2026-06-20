import { Router, Request, Response } from 'express';
import {
  createRule,
  activateRule,
  listRules,
  exportRules,
  importRules,
  validateRuleInput,
  validateRulePackage,
} from '../rules';
import type { Rule } from '../../shared/types';
import type { RuleExportPackage } from '../rules';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(listRules());
});

router.get('/export', (_req: Request, res: Response) => {
  const pkg = exportRules();
  const filename = `rules_${new Date().toISOString().slice(0, 10)}.json`;
  const encoded = encodeURIComponent(filename);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`
  );
  res.json(pkg);
});

router.post('/validate', (req: Request, res: Response) => {
  try {
    const pkg = req.body as RuleExportPackage;
    const result = validateRulePackage(pkg, true);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      valid: false,
      issues: [{ message: 'JSON 解析失败：' + (err as Error).message, severity: 'error' }],
    });
  }
});

router.post('/import', (req: Request, res: Response) => {
  try {
    const pkg = req.body as RuleExportPackage;
    const activateFirst = req.query.activate === '1';

    const preValidation = validateRulePackage(pkg, true);
    if (!preValidation.valid) {
      return res.status(400).json({
        error: '规则校验失败',
        issues: preValidation.issues,
      });
    }

    const result = importRules(pkg, activateFirst);
    if (result.imported.length === 0) {
      return res.status(400).json({
        error: '没有可导入的规则',
        issues: result.issues,
      });
    }

    res.json({
      imported: result.imported,
      warnings: result.issues,
      count: result.imported.length,
    });
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '版本号已存在' });
    }
    res.status(500).json({ error: (err as Error).message });
  }
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

    const validation = validateRuleInput(input, true);
    if (!validation.valid) {
      return res.status(400).json({
        error: validation.issues[0]?.message || '规则参数校验失败',
        issues: validation.issues,
      });
    }

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
    const existing = listRules();
    const target = existing.find((r) => r.id === req.params.id);
    if (!target) {
      return res.status(404).json({ error: '规则不存在' });
    }
    activateRule(req.params.id);
    res.json({ success: true, activated: req.params.id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
