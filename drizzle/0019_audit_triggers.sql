-- سجل التعديلات: كل إنشاء وتعديل وحذف في الجداول الرئيسية يُسجَّل تلقائياً مع المستخدم (app.user_id)
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  uid bigint := nullif(current_setting('app.user_id', true), '')::bigint;
  old_j jsonb;
  new_j jsonb;
  diff jsonb;
BEGIN
  IF uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = uid) THEN
    uid := NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (entity, entity_id, action, user_id) VALUES (TG_TABLE_NAME, NEW.id::text, 'create', uid);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    old_j := to_jsonb(OLD) - 'updated_at' - 'last_login_at';
    new_j := to_jsonb(NEW) - 'updated_at' - 'last_login_at';
    IF old_j ? 'password_hash' AND old_j->'password_hash' IS DISTINCT FROM new_j->'password_hash' THEN
      old_j := jsonb_set(old_j, '{password_hash}', '"***"');
      new_j := jsonb_set(new_j, '{password_hash}', '"(تغيّرت)"');
    END IF;
    SELECT jsonb_object_agg(k, jsonb_build_array(old_j->k, new_j->k)) INTO diff
      FROM jsonb_object_keys(new_j) AS k WHERE old_j->k IS DISTINCT FROM new_j->k;
    IF diff IS NOT NULL THEN
      INSERT INTO audit_log (entity, entity_id, action, changes, user_id) VALUES (TG_TABLE_NAME, NEW.id::text, 'update', diff, uid);
    END IF;
    RETURN NEW;
  ELSE
    INSERT INTO audit_log (entity, entity_id, action, changes, user_id)
      VALUES (TG_TABLE_NAME, OLD.id::text, 'delete', to_jsonb(OLD) - 'password_hash', uid);
    RETURN OLD;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','adjustment_notes','bank_accounts','bank_reconciliations','breakdown_requests','charge_types',
    'commission_advance_requests','company_profile','contract_rates','contracts','cost_centers','custody_docs','drivers','employee_advances',
    'employees','evaluations','exchange_rates','expenses','fiscal_periods','fixed_assets','fleet_documents','hr_actions','invoice_template',
    'journal_entries','leave_requests','leave_types','locations','maintenance_orders','maintenance_plans','parties','payments','payroll_runs',
    'products','promotions','purchase_invoices','receipts','roles','routes','sales_invoices','stock_docs','tax_codes','traffic_violations',
    'users','vehicle_assignments','vehicle_types','vehicles','warehouses','waybills']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON %I', t);
    EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (user_id, at);
