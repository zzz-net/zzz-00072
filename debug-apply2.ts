import { initDatabase } from './api/db.js';
import { listRollbackPackages, getRollbackPackageExport, applyRollbackPackage, validateRollbackPackage } from './api/rules.js';

initDatabase();

try {
  const rbs = listRollbackPackages(1);
  if (rbs.length === 0) { console.log('no pkgs'); process.exit(0); }
  const latest = rbs[0];
  console.log('Using pkg:', latest.id, latest.name);
  
  const exported = getRollbackPackageExport(latest.id);
  console.log('Export pkg_id:', exported?.package_id);
  console.log('Export to_rule.version:', exported?.to_rule?.version);
  console.log('Export snapshot len:', exported?.all_rules_snapshot?.length);
  
  const validation = validateRollbackPackage(exported as any);
  console.log('Validation valid:', validation.valid);
  console.log('Validation issues count:', validation.issues.length);
  validation.issues.forEach((i, idx) => console.log(`  [${idx}] ${i.severity} ${i.field || ''}: ${i.message}`.substring(0, 120)));
  
  if (!validation.valid) process.exit(1);
  
  console.log('\n=== applyRollbackPackage ===');
  try {
    const result = applyRollbackPackage(validation.parsed!, 'debug_op');
    console.log('Result success:', result.success);
    console.log('Result issues:', result.issues?.length || 0);
    result.issues?.forEach((i, idx) => console.log(`  [${idx}] ${i.severity}: ${i.message}`));
    if (result.activation_log) {
      console.log('Activation log id:', result.activation_log.id);
      console.log('Activation log action:', result.activation_log.action);
    }
  } catch (err) {
    console.error('EXCEPTION:', (err as Error).message);
    console.error('STACK:', (err as Error).stack);
  }
} catch (err) {
  console.error('Outer EXCEPTION:', (err as Error).message);
  console.error('STACK:', (err as Error).stack);
}
