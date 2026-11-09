-- Draft relational schema for the planned Firestore -> Supabase migration.
-- Review legacy data mappings before applying to any database.
create extension if not exists pgcrypto;

create type public.user_role as enum ('vendedor', 'administrador', 'admin', 'supervisor');
create type public.user_status as enum ('activo', 'inactivo');
create type public.ticket_status as enum ('pendiente', 'pagado', 'anulado', 'perdedor', 'cobrado');

-- Supabase Auth owns credentials. This table owns application profile/role data.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  legacy_firestore_id text unique,
  nombre text not null,
  usuario text not null unique,
  rol public.user_role not null,
  estado public.user_status not null default 'activo',
  region text not null check (region in ('Nicaragua','Costa Rica','Honduras','El Salvador')),
  email text not null unique,
  id_supervisor uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (id_supervisor is null or id_supervisor <> id),
  check (email = usuario || '@app.local')
);

create table public.draws (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  juego text not null,
  hora_sorteo time not null,
  hora_cierre time not null,
  nombre text not null,
  dias_habilitados smallint[] check (dias_habilitados is null or dias_habilitados <@ array[0,1,2,3,4,5,6]::smallint[]),
  pais text,
  activo boolean not null default true,
  unique (juego, nombre)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  -- Public, printable lookup number. String preserves leading zeroes; 7 chars allow 1000000.
  id_ticket varchar(7) not null unique check (id_ticket ~ '^[0-9]{6,7}$'),
  numero_ticket varchar(7) not null unique check (numero_ticket ~ '^[0-9]{6,7}$'),
  legacy_firestore_id text unique,
  id_vendedor uuid not null references public.profiles(id) on delete restrict,
  id_sorteo uuid references public.draws(id) on delete restrict,
  timestamp_servidor timestamptz not null,
  fecha_venta date not null,
  juego text not null,
  sorteo text not null,
  numero_jugado text not null,
  monto_pago numeric(14,2) not null check (monto_pago >= 0),
  moneda char(3) not null check (moneda in ('C$', 'USD')),
  nombre_cliente text,
  premio_posible_cs numeric(14,2) check (premio_posible_cs is null or premio_posible_cs >= 0),
  firma_digital text not null unique,
  anulado boolean not null default false,
  estado public.ticket_status not null default 'pendiente',
  es_premiado boolean not null default false,
  monto_premio numeric(14,2) check (monto_premio is null or monto_premio >= 0),
  fecha_pago timestamptz,
  created_at timestamptz not null default now()
);
create index tickets_vendedor_fecha_idx on public.tickets(id_vendedor, fecha_venta);
create index tickets_vendedor_pago_idx on public.tickets(id_vendedor, fecha_pago);

create table public.ticket_plays (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  numero text not null,
  monto numeric(14,2) not null check (monto >= 0),
  premio_posible numeric(14,2) not null default 0 check (premio_posible >= 0),
  dia_juego date,
  ordinal smallint not null check (ordinal > 0),
  unique (ticket_id, ordinal)
);

create table public.draw_results (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  draw_id uuid not null references public.draws(id) on delete restrict,
  fecha date not null,
  numero_ganador text not null,
  timestamp timestamptz not null default now(),
  unique (draw_id, fecha)
);

create table public.number_limits (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  seller_id uuid references public.profiles(id) on delete cascade,
  draw_id uuid references public.draws(id) on delete cascade,
  juego text not null,
  numero text not null,
  max_monto numeric(14,2) not null check (max_monto >= 0),
  pais text,
  hora time
);

create table public.cash_closures (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  fecha date not null,
  denominaciones jsonb not null default '{}'::jsonb,
  monto_entregado_cs numeric(14,2) not null default 0,
  monto_entregado_usd numeric(14,2) not null default 0,
  monto_sistema_cs numeric(14,2) not null default 0,
  monto_sistema_usd numeric(14,2) not null default 0,
  descuadre_cs numeric(14,2) not null default 0,
  descuadre_usd numeric(14,2) not null default 0,
  cobrado boolean not null default false,
  timestamp timestamptz not null default now(),
  unique (seller_id, fecha)
);

create table public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  fecha date not null,
  vendido numeric(14,2) not null default 0,
  pagado numeric(14,2) not null default 0,
  cierre text not null check (cierre in ('pendiente','pagado')),
  egreso numeric(14,2) not null default 0,
  timestamp_creacion timestamptz not null default now(),
  timestamp_actualizacion timestamptz not null default now(),
  unique (seller_id, fecha)
);

create table public.admin_collections (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  rango_inicio date not null,
  rango_fin date not null check (rango_fin >= rango_inicio),
  total_vendido numeric(14,2) not null,
  total_pagado numeric(14,2) not null,
  total_neto numeric(14,2) not null,
  estado text not null default 'activo' check (estado in ('activo','anulado')),
  timestamp timestamptz not null default now()
);
create table public.admin_collection_days (
  collection_id uuid not null references public.admin_collections(id) on delete cascade,
  summary_id uuid not null references public.daily_summaries(id) on delete restrict,
  primary key (collection_id, summary_id),
  unique (summary_id)
);

create table public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  collection_id uuid references public.admin_collections(id) on delete restrict,
  monto_pago numeric(14,2) not null check (monto_pago >= 0),
  concepto text not null,
  estado text not null default 'activo' check (estado in ('activo','anulado')),
  timestamp timestamptz not null default now()
);

create table public.app_settings (
  id text primary key check (id = 'general'),
  tasa_cambio numeric(12,4) not null check (tasa_cambio > 0),
  contador_global_tickets bigint not null default 0 check (contador_global_tickets between 0 and 1000000),
  formato_ticket jsonb not null default '{}'::jsonb
);
-- Transitional storage for legacy configuration arrays whose exact shapes vary.
-- Each row can later be normalized without losing data during the first import.
create table public.legacy_config_items (
  id text primary key,
  category text not null check (category in ('number_limit','seller_receipt','income','fcm_token','unknown')),
  payload jsonb not null,
  imported_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  legacy_id text unique,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Intentionally no permissive client policies here. Add RLS only after role/access rules are ported.
