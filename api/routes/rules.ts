import { Router, Request, Response } from 'express';
import {
  createRule,
  activateRule,
  listRules,
  exportRules,
  importRules,
  validateRuleInput,
  validateRulePackage,
  createRulePreview,
  getRulePreviewDetail,
  listRulePreviews,
  confirmRulePreview,
  listActivationLogs,
  listRollbackPackages,
  getRollbackPackageExport,
  validateRollbackPackage,
  applyRollbackPackage,
  cancelRulePreview,
} from '../rules';
import type { Rule, RuleRollbackPackageExport } from '../../shared/types';
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
    const operator = typeof req.body?.operator === 'string' && req.body.operator.trim() !== '' ? req.body.operator : 'api';
    const result = activateRule(req.params.id, operator);
    if (!result.success) {
      return res.status(400).json({
        error: result.issues?.[0]?.message || '无法启用该规则',
        issues: result.issues,
      });
    }
    res.json({
      success: true,
      activated: req.params.id,
      activation_log: result.activation_log,
      rollback_package: result.rollback_package,
      rollback_export: result.rollback_export,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/:id/preview', (req: Request, res: Response) => {
  try {
    const result = createRulePreview(req.params.id);
    if (!result.success) {
      return res.status(400).json({
        error: result.issues?.[0]?.message || '预演创建失败',
        issues: result.issues,
      });
    }
    res.json(result.preview);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/previews', (_req: Request, res: Response) => {
  try {
    const limit = _req.query.limit ? Number(_req.query.limit) : 20;
    res.json(listRulePreviews(limit));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/previews/:id', (req: Request, res: Response) => {
  try {
    const detail = getRulePreviewDetail(req.params.id);
    if (!detail) {
      return res.status(404).json({ error: '预演记录不存在' });
    }
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/previews/:id/confirm', (req: Request, res: Response) => {
  try {
    const operator = (req.body as { operator?: string })?.operator || 'system';
    const result = confirmRulePreview(req.params.id, operator);
    if (!result.success) {
      return res.status(400).json({
        error: result.issues?.[0]?.message || '确认启用失败',
        issues: result.issues,
      });
    }
    res.json({
      success: true,
      activation_log: result.activation_log,
      rollback_package: result.rollback_package,
      rollback_export: result.rollback_export,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/previews/:id/cancel', (req: Request, res: Response) => {
  try {
    const result = cancelRulePreview(req.params.id);
    if (!result.success) {
      return res.status(400).json({
        error: result.issues?.[0]?.message || '取消预演失败',
        issues: result.issues,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/activation-logs', (_req: Request, res: Response) => {
  try {
    const limit = _req.query.limit ? Number(_req.query.limit) : 50;
    res.json(listActivationLogs(limit));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/rollback-packages', (_req: Request, res: Response) => {
  try {
    const limit = _req.query.limit ? Number(_req.query.limit) : 20;
    res.json(listRollbackPackages(limit));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/rollback-packages/:id/export', (req: Request, res: Response) => {
  try {
    const pkg = getRollbackPackageExport(req.params.id);
    if (!pkg) {
      return res.status(404).json({ error: '回退包不存在' });
    }
    const filename = `rollback_${pkg.package_id.slice(-8)}_${new Date().toISOString().slice(0, 10)}.json`;
    const encoded = encodeURIComponent(filename);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`
    );
    res.json(pkg);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/rollback-packages/validate', (req: Request, res: Response) => {
  try {
    const result = validateRollbackPackage(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      valid: false,
      issues: [{ message: 'JSON 解析失败：' + (err as Error).message, severity: 'error' }],
    });
  }
});

router.post('/rollback-packages/apply', (req: Request, res: Response) => {
  try {
    const operator = (req.body as { operator?: string })?.operator || 'system';
    const pkg = req.body as RuleRollbackPackageExport;
    const result = applyRollbackPackage(pkg, operator);
    if (!result.success) {
      return res.status(400).json({
        error: result.issues?.[0]?.message || '应用回退包失败',
        issues: result.issues,
      });
    }
    res.json({
      success: true,
      activation_log: result.activation_log,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
