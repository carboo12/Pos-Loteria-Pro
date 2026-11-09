-- Initial canary policies for authenticated reads. Writes stay disabled until
-- business mutations are moved from Express/Firebase to audited server actions.
create or replace function public.has_admin_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.rol in ('administrador', 'admin') and p.estado = 'activo'
  );
$$;

create or replace function public.can_read_seller(target_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_seller = auth.uid()
    or public.has_admin_role()
    or exists (select 1 from public.profiles seller where seller.id = target_seller and seller.id_supervisor = auth.uid());
$$;

alter table public.profiles enable row level security;
alter table public.draws enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_plays enable row level security;
alter table public.draw_results enable row level security;
alter table public.number_limits enable row level security;
alter table public.cash_closures enable row level security;
alter table public.daily_summaries enable row level security;
alter table public.admin_collections enable row level security;
alter table public.admin_collection_days enable row level security;
alter table public.commission_payments enable row level security;
alter table public.app_settings enable row level security;
alter table public.legacy_config_items enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles read self or staff" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_admin_role() or id_supervisor = auth.uid());
create policy "draws read authenticated" on public.draws for select to authenticated using (true);
create policy "tickets read seller or staff" on public.tickets for select to authenticated
  using (public.can_read_seller(id_vendedor));
create policy "ticket plays read with ticket access" on public.ticket_plays for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id));
create policy "draw results read authenticated" on public.draw_results for select to authenticated using (true);
create policy "limits read seller or staff" on public.number_limits for select to authenticated
  using (seller_id is null or public.can_read_seller(seller_id));
create policy "closures read seller or staff" on public.cash_closures for select to authenticated
  using (public.can_read_seller(seller_id));
create policy "summaries read seller or staff" on public.daily_summaries for select to authenticated
  using (public.can_read_seller(seller_id));
create policy "admin collections read participants or staff" on public.admin_collections for select to authenticated
  using (admin_id = auth.uid() or public.can_read_seller(seller_id));
create policy "admin collection days read by collection access" on public.admin_collection_days for select to authenticated
  using (exists (select 1 from public.admin_collections c where c.id = collection_id));
create policy "commission payments read participants or staff" on public.commission_payments for select to authenticated
  using (admin_id = auth.uid() or public.can_read_seller(seller_id));
create policy "settings read authenticated" on public.app_settings for select to authenticated using (true);
create policy "legacy config read staff" on public.legacy_config_items for select to authenticated using (public.has_admin_role());
create policy "audit logs read staff" on public.audit_logs for select to authenticated using (public.has_admin_role());

grant execute on function public.has_admin_role() to authenticated;
grant execute on function public.can_read_seller(uuid) to authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tickets','ticket_plays','cash_closures','app_settings','draws','number_limits','draw_results'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
