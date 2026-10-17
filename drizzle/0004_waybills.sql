CREATE TYPE "public"."expense_bill_to" AS ENUM('company', 'customer');--> statement-breakpoint
CREATE TYPE "public"."expense_payer" AS ENUM('driver_custody', 'customs_broker');--> statement-breakpoint
CREATE TYPE "public"."fuel_source" AS ENUM('custody', 'fuel_card', 'station_credit');--> statement-breakpoint
CREATE TYPE "public"."trip_stage_type" AS ENUM('loading', 'in_transit', 'border', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."waybill_execution" AS ENUM('fleet', 'carrier');--> statement-breakpoint
CREATE TYPE "public"."waybill_status" AS ENUM('draft', 'in_transit', 'delivered', 'approved', 'invoiced', 'rejected');--> statement-breakpoint
CREATE TABLE "trip_stages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_stages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"waybill_id" bigint NOT NULL,
	"stage" "trip_stage_type" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"odometer" integer,
	"note" text,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "waybill_expenses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "waybill_expenses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"waybill_id" bigint NOT NULL,
	"charge_type_id" bigint NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"bill_to" "expense_bill_to" DEFAULT 'company' NOT NULL,
	"payer" "expense_payer" DEFAULT 'driver_custody' NOT NULL,
	"party_id" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waybill_expenses_amounts" CHECK ("waybill_expenses"."amount" > 0 and "waybill_expenses"."exchange_rate" > 0),
	CONSTRAINT "waybill_expenses_broker" CHECK ("waybill_expenses"."payer" <> 'customs_broker' or "waybill_expenses"."party_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "waybill_fuel" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "waybill_fuel_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"waybill_id" bigint NOT NULL,
	"source" "fuel_source" NOT NULL,
	"party_id" bigint,
	"liters" numeric(10, 2),
	"amount" numeric(18, 3) NOT NULL,
	"vat_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"odometer" integer,
	"invoice_number" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waybill_fuel_amounts" CHECK ("waybill_fuel"."amount" > 0 and "waybill_fuel"."vat_amount" >= 0 and "waybill_fuel"."exchange_rate" > 0),
	CONSTRAINT "waybill_fuel_station" CHECK ("waybill_fuel"."source" <> 'station_credit' or "waybill_fuel"."party_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "waybills" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "waybills_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"waybill_date" date NOT NULL,
	"customer_id" bigint NOT NULL,
	"contract_id" bigint,
	"route_id" bigint NOT NULL,
	"shipper" text NOT NULL,
	"consignee" text NOT NULL,
	"delivery_address" text,
	"is_international" boolean DEFAULT false NOT NULL,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"execution" "waybill_execution" DEFAULT 'fleet' NOT NULL,
	"vehicle_id" bigint,
	"driver_id" bigint,
	"carrier_id" bigint,
	"carrier_cost" numeric(18, 3),
	"carrier_driver_name" text,
	"carrier_driver_mobile" varchar(20),
	"carrier_plate" varchar(30),
	"distance_km" integer,
	"weight_tons" numeric(10, 3),
	"container_number" varchar(30),
	"customs_declaration" varchar(40),
	"delivery_note_number" varchar(40),
	"amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"tax_code_id" bigint,
	"price_note" text,
	"driver_commission" numeric(18, 3) DEFAULT '0' NOT NULL,
	"sales_rep_id" bigint,
	"sales_rep_commission" numeric(18, 3) DEFAULT '0' NOT NULL,
	"odometer_start" integer,
	"odometer_end" integer,
	"empty_return" boolean DEFAULT false NOT NULL,
	"return_waybill_id" bigint,
	"notes" text,
	"status" "waybill_status" DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"override_reason" text,
	"approved_by" bigint,
	"approved_at" timestamp with time zone,
	"journal_entry_id" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waybills_number_unique" UNIQUE("number"),
	CONSTRAINT "waybills_execution_refs" CHECK (case "waybills"."execution"
        when 'fleet' then "waybills"."vehicle_id" is not null and "waybills"."driver_id" is not null and "waybills"."carrier_id" is null
        when 'carrier' then "waybills"."carrier_id" is not null and "waybills"."vehicle_id" is null and "waybills"."driver_id" is null
      end),
	CONSTRAINT "waybills_amounts" CHECK ("waybills"."amount" >= 0 and "waybills"."driver_commission" >= 0 and "waybills"."sales_rep_commission" >= 0 and coalesce("waybills"."carrier_cost", 0) >= 0),
	CONSTRAINT "waybills_odometer" CHECK ("waybills"."odometer_end" is null or "waybills"."odometer_start" is null or "waybills"."odometer_end" >= "waybills"."odometer_start")
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "waybill_id" bigint;--> statement-breakpoint
ALTER TABLE "trip_stages" ADD CONSTRAINT "trip_stages_waybill_id_waybills_id_fk" FOREIGN KEY ("waybill_id") REFERENCES "public"."waybills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stages" ADD CONSTRAINT "trip_stages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybill_expenses" ADD CONSTRAINT "waybill_expenses_waybill_id_waybills_id_fk" FOREIGN KEY ("waybill_id") REFERENCES "public"."waybills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybill_expenses" ADD CONSTRAINT "waybill_expenses_charge_type_id_charge_types_id_fk" FOREIGN KEY ("charge_type_id") REFERENCES "public"."charge_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybill_expenses" ADD CONSTRAINT "waybill_expenses_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybill_expenses" ADD CONSTRAINT "waybill_expenses_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybill_fuel" ADD CONSTRAINT "waybill_fuel_waybill_id_waybills_id_fk" FOREIGN KEY ("waybill_id") REFERENCES "public"."waybills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybill_fuel" ADD CONSTRAINT "waybill_fuel_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybill_fuel" ADD CONSTRAINT "waybill_fuel_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_carrier_id_parties_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_tax_code_id_tax_codes_id_fk" FOREIGN KEY ("tax_code_id") REFERENCES "public"."tax_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_sales_rep_id_parties_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_return_waybill_id_waybills_id_fk" FOREIGN KEY ("return_waybill_id") REFERENCES "public"."waybills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_stages_waybill_idx" ON "trip_stages" USING btree ("waybill_id","at");--> statement-breakpoint
CREATE INDEX "waybill_expenses_waybill_idx" ON "waybill_expenses" USING btree ("waybill_id");--> statement-breakpoint
CREATE INDEX "waybill_fuel_waybill_idx" ON "waybill_fuel" USING btree ("waybill_id");--> statement-breakpoint
CREATE INDEX "waybills_status_idx" ON "waybills" USING btree ("status","waybill_date");--> statement-breakpoint
CREATE INDEX "waybills_customer_idx" ON "waybills" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "waybills_vehicle_idx" ON "waybills" USING btree ("vehicle_id","waybill_date");--> statement-breakpoint
CREATE INDEX "waybills_driver_idx" ON "waybills" USING btree ("driver_id","waybill_date");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_waybill_id_waybills_id_fk" FOREIGN KEY ("waybill_id") REFERENCES "public"."waybills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_lines_waybill_idx" ON "journal_lines" USING btree ("waybill_id");