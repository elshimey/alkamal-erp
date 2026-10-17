-- ضوابط دفتر الأستاذ على مستوى قاعدة البيانات، فلا يمكن لأي شاشة أو استيراد تجاوزها:
-- 1) المبلغ بالريال يُحسب من مبلغ السطر وسعر الصرف.
-- 2) لا يُرحَّل قيد غير متوازن، أو على حساب تجميعي، أو بلا مركز تكلفة حيث يلزم، أو في فترة مقفلة.
-- 3) القيد المرحّل لا يُعدَّل ولا يُحذف؛ يُرجَع لمسودة أولاً (القرار 9)، والفترة المقفلة تمنع الإرجاع.

CREATE OR REPLACE FUNCTION journal_line_compute_base() RETURNS trigger AS $$
BEGIN
  IF NEW.currency_code = 'SAR' AND NEW.exchange_rate <> 1 THEN
    RAISE EXCEPTION 'سعر صرف الريال يجب أن يكون 1' USING ERRCODE = 'check_violation';
  END IF;
  NEW.debit_base := round(NEW.debit * NEW.exchange_rate, 2);
  NEW.credit_base := round(NEW.credit * NEW.exchange_rate, 2);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER journal_lines_compute_base
  BEFORE INSERT OR UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_line_compute_base();
--> statement-breakpoint

-- يمنع تعديل سطور قيد مرحّل
CREATE OR REPLACE FUNCTION journal_line_guard_posted() RETURNS trigger AS $$
DECLARE
  v_status journal_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO v_status FROM journal_entries WHERE id = OLD.entry_id;
    IF v_status = 'posted' THEN
      RAISE EXCEPTION 'لا يمكن تعديل سطور قيد مرحّل؛ أرجعه لمسودة أولاً' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO v_status FROM journal_entries WHERE id = NEW.entry_id;
    IF v_status = 'posted' THEN
      RAISE EXCEPTION 'لا يمكن تعديل سطور قيد مرحّل؛ أرجعه لمسودة أولاً' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER journal_lines_guard_posted
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_line_guard_posted();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION journal_entry_guard() RETURNS trigger AS $$
DECLARE
  v_period fiscal_periods%ROWTYPE;
  v_lines integer;
  v_debit numeric;
  v_credit numeric;
  v_bad text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'لا يمكن حذف قيد مرحّل؛ أرجعه لمسودة أولاً' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
    IF NEW.status = 'posted' THEN
      RAISE EXCEPTION 'القيد المرحّل لا يُعدَّل؛ أرجعه لمسودة أولاً' USING ERRCODE = 'check_violation';
    END IF;
    -- الإرجاع لمسودة ممنوع في فترة مقفلة
    SELECT * INTO v_period FROM fiscal_periods WHERE id = OLD.fiscal_period_id;
    IF v_period.status = 'closed' THEN
      RAISE EXCEPTION 'الفترة % / % مقفلة', v_period.month, v_period.year USING ERRCODE = 'check_violation';
    END IF;
    NEW.posted_at := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- الفترة تُحدَّد من تاريخ القيد دائماً
  SELECT * INTO v_period FROM fiscal_periods
    WHERE NEW.entry_date BETWEEN start_date AND end_date;
  NEW.fiscal_period_id := v_period.id;
  NEW.updated_at := now();

  IF NEW.status <> 'posted' THEN
    RETURN NEW;
  END IF;

  -- ── الترحيل ──
  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'لا توجد فترة محاسبية لتاريخ %', NEW.entry_date USING ERRCODE = 'check_violation';
  END IF;
  IF v_period.status = 'closed' THEN
    RAISE EXCEPTION 'الفترة % / % مقفلة', v_period.month, v_period.year USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*), coalesce(sum(debit_base), 0), coalesce(sum(credit_base), 0)
    INTO v_lines, v_debit, v_credit
    FROM journal_lines WHERE entry_id = NEW.id;

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'القيد يحتاج سطرين على الأقل' USING ERRCODE = 'check_violation';
  END IF;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'القيد غير متوازن: المدين % والدائن %', v_debit, v_credit USING ERRCODE = 'check_violation';
  END IF;
  IF v_debit = 0 THEN
    RAISE EXCEPTION 'لا يمكن ترحيل قيد بمبلغ صفر' USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(a.code, '، ') INTO v_bad
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.entry_id = NEW.id AND (NOT a.is_postable OR NOT a.is_active);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'حسابات لا تقبل الترحيل: %', v_bad USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(a.code, '، ') INTO v_bad
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.entry_id = NEW.id AND a.requires_cost_center AND l.cost_center_id IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'مركز التكلفة (المركبة) إلزامي على الحسابات: %', v_bad USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(a.code, '، ') INTO v_bad
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.entry_id = NEW.id AND a.currency_code IS NOT NULL AND a.currency_code <> l.currency_code;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'عملة السطر لا تطابق عملة الحساب: %', v_bad USING ERRCODE = 'check_violation';
  END IF;

  NEW.posted_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER journal_entries_guard
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entry_guard();
