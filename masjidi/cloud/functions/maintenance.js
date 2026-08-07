/**
 * صيانة دورية للبيانات المتراكمة.
 */

// `AuditLog` ينمو بسطر لكل تحوّل حالة وكل حركة مال، وباقة Back4app المجانية
// 250 ميغابايت تشترك فيها بيانات 18 ألف مسجد. ستة أشهر تكفي للمساءلة أمام
// المتبرّع، وما قبلها يُؤرشَف خارج المنصّة إن لزم.
const AUDIT_RETENTION_DAYS = 180;
const PRUNE_BATCH = 500;

Parse.Cloud.job('pruneAuditLog', async (request) => {
  const { params, message } = request;

  const days = Math.max(Number(params.retentionDays) || AUDIT_RETENTION_DAYS, 30);
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);

  let removed = 0;
  for (;;) {
    const batch = await new Parse.Query('AuditLog')
      .lessThan('createdAt', cutoff)
      .limit(PRUNE_BATCH)
      .find({ useMasterKey: true });

    if (batch.length === 0) break;
    await Parse.Object.destroyAll(batch, { useMasterKey: true });
    removed += batch.length;

    message(`حُذف ${removed} سطراً حتى الآن…`);
    if (batch.length < PRUNE_BATCH) break;
  }

  const summary = `حُذف ${removed} سطر تدقيق أقدم من ${days} يوماً.`;
  message(summary);
  return summary;
});
