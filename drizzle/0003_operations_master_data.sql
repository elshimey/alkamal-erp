CREATE TYPE "public"."contract_status" AS ENUM('draft', 'active', 'expired', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."location_level" AS ENUM('country', 'city', 'site');--> statement-breakpoint
CREATE TYPE "public"."pricing_method" AS ENUM('per_km_vehicle_type', 'specific_vehicle', 'route_fixed', 'car_transport', 'per_quantity');--> statement-breakpoint
CREATE TABLE "charge_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "charge_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name_ar" text NOT NULL,
	"revenue_account_id" bigint,
	"cost_account_id" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "charge_types_name_ar_unique" UNIQUE("name_ar")
);
--> statement-breakpoint
CREATE TABLE "contract_rates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contract_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"contract_id" bigint NOT NULL,
	"method" "pricing_method" NOT NULL,
	"route_id" bigint,
	"vehicle_type_id" bigint,
	"vehicle_id" bigint,
	"price" numeric(18, 3) NOT NULL,
	"unit" text,
	"notes" text,
	CONSTRAINT "contract_rates_price_positive" CHECK ("contract_rates"."price" > 0),
	CONSTRAINT "contract_rates_method_refs" CHECK (case "contract_rates"."method"
        when 'per_km_vehicle_type' then "contract_rates"."vehicle_type_id" is not null
        when 'specific_vehicle' then "contract_rates"."vehicle_id" is not null and "contract_rates"."route_id" is not null
        when 'route_fixed' then "contract_rates"."route_id" is not null
        when 'car_transport' then "contract_rates"."route_id" is not null
        when 'per_quantity' then "contract_rates"."unit" is not null
      end)
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contracts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"customer_id" bigint NOT NULL,
	"number" varchar(30) NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"credit_limit" numeric(18, 3),
	"payment_terms_days" smallint DEFAULT 30 NOT NULL,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_number_unique" UNIQUE("number"),
	CONSTRAINT "contracts_dates" CHECK ("contracts"."to_date" >= "contracts"."from_date")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "locations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"level" "location_level" NOT NULL,
	"name_ar" text NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"is_border_crossing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_country_root" CHECK (("locations"."level" = 'country') = ("locations"."parent_id" is null))
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "routes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"from_location_id" bigint NOT NULL,
	"to_location_id" bigint NOT NULL,
	"distance_km" integer,
	"is_international" boolean DEFAULT false NOT NULL,
	"driver_commission" numeric(18, 3) DEFAULT '0' NOT NULL,
	"estimated_diesel_liters" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routes_distinct_ends" CHECK ("routes"."from_location_id" <> "routes"."to_location_id")
);
--> statement-breakpoint
ALTER TABLE "charge_types" ADD CONSTRAINT "charge_types_revenue_account_id_accounts_id_fk" FOREIGN KEY ("revenue_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_types" ADD CONSTRAINT "charge_types_cost_account_id_accounts_id_fk" FOREIGN KEY ("cost_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_rates" ADD CONSTRAINT "contract_rates_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_rates" ADD CONSTRAINT "contract_rates_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_rates" ADD CONSTRAINT "contract_rates_vehicle_type_id_vehicle_types_id_fk" FOREIGN KEY ("vehicle_type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_rates" ADD CONSTRAINT "contract_rates_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_locations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_rates_contract_idx" ON "contract_rates" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contracts_customer_idx" ON "contracts" USING btree ("customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_parent_name_uq" ON "locations" USING btree (coalesce("parent_id", 0),"name_ar");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_from_to_uq" ON "routes" USING btree ("from_location_id","to_location_id");