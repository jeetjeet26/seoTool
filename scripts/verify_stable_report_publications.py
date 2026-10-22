"""Verify stable publications using synthetic rows; every test write is rolled back.

Run with .venv/bin/python scripts/verify_stable_report_publications.py.
"""
from pathlib import Path
import json,uuid
from datetime import datetime,timedelta,timezone
import psycopg
from psycopg.rows import dict_row
from dotenv import dotenv_values

root=Path(__file__).resolve().parents[1]
env=dotenv_values(root/'.env')
checks=[]
with psycopg.connect(env['SUPABASE_DB_URL'],row_factory=dict_row,connect_timeout=20) as conn:
 try:
  assert conn.execute("select to_regclass('private.report_publications') t").fetchone()['t'], 'Apply the publication migrations before verification'
  admin=conn.execute("select id from public.profiles where role='admin' and is_active order by created_at limit 1").fetchone()['id']
  client=conn.execute('select id from public.clients order by created_at limit 1').fetchone()['id']
  expires=datetime.now(timezone.utc)+timedelta(days=30)
  def audit():
   return conn.execute("insert into public.audits(client_id,name,target_url,target_city,status) values(%s,'Publication verification (rollback)','https://example.com','Test','completed') returning id",(client,)).fetchone()['id']
  def publish(aid,token,pin,actor=admin):
   return conn.execute('select * from private.publish_report(%s,%s,%s,%s,%s)',(aid,token,pin,expires,actor)).fetchone()
  def count(aid):return conn.execute('select count(*) n from public.share_links where audit_id=%s',(aid,)).fetchone()['n']
  def denied(callback):
   try:
    with conn.transaction():callback()
   except psycopg.Error:return True
   return False
  aid=audit();token='A'*43;pin='123456'
  first=publish(aid,token,pin);assert first=={'share_token':token,'share_pin':pin,'reused':False}
  before=conn.execute('select published_at from public.audits where id=%s',(aid,)).fetchone()
  repeat=publish(aid,'B'*43,'234567');assert repeat=={**first,'reused':True}and count(aid)==1
  checks.append('first publish and repeated publish retain one URL/PIN')
  conn.execute("update public.audits set summary=jsonb_build_object('executive_summary','Edited after publication') where id=%s",(aid,))
  after=conn.execute('select published_at,summary from public.audits where id=%s',(aid,)).fetchone()
  assert after['published_at']==before['published_at'] and after['summary']['executive_summary']=='Edited after publication'
  assert publish(aid,'C'*43,'345678')==repeat and count(aid)==1
  assert conn.execute('select private.validate_share_access(%s,%s) id',(token,pin)).fetchone()['id']==aid
  checks.append('edits retain publication, original URL/PIN and readable current content')
  legacy=audit();old_token='D'*43;old_pin='456789'
  conn.execute('select private.create_share_link(%s,%s,%s,%s,%s)',(legacy,old_token,old_pin,expires,admin))
  assert publish(legacy,'E'*43,'567890')=={'share_token':None,'share_pin':None,'reused':True} and count(legacy)==1
  assert denied(lambda:conn.execute('select private.retain_report_publication(%s,%s,%s,%s)',(legacy,old_token,'000000',admin)))
  assert conn.execute('select private.retain_report_publication(%s,%s,%s,%s) retained',(legacy,old_token,old_pin,admin)).fetchone()['retained']
  assert publish(legacy,'F'*43,'678901')=={'share_token':old_token,'share_pin':old_pin,'reused':True} and count(legacy)==1
  checks.append('legacy URL/PIN retained after credential verification; invalid PIN rejected')
  assert denied(lambda:publish(aid,'G'*43,'789012',uuid.uuid4()))
  draft=audit();conn.execute("update public.audits set status='draft' where id=%s",(draft,))
  assert denied(lambda:publish(draft,'H'*43,'890123'))and count(draft)==0
  checks.append('unauthorized actors and incomplete reports cannot publish')
  conn.execute('update public.share_links set revoked_at=now() where audit_id=%s',(aid,))
  assert denied(lambda:publish(aid,'I'*43,'901234'))and count(aid)==1
  revoked_legacy=audit();conn.execute('select private.create_share_link(%s,%s,%s,%s,%s)',(revoked_legacy,'J'*43,'012345',expires,admin))
  conn.execute('update public.share_links set revoked_at=now() where audit_id=%s',(revoked_legacy,))
  assert denied(lambda:publish(revoked_legacy,'K'*43,'123456'))and count(revoked_legacy)==1
  checks.append('revoked canonical and legacy publications are not silently recreated')
  for role in ('anon','authenticated'):
   assert not conn.execute("select has_function_privilege(%s,'private.publish_report(uuid,text,text,timestamp with time zone,uuid)','execute') ok",(role,)).fetchone()['ok']
   assert not conn.execute("select has_table_privilege(%s,'private.report_publications','select') ok",(role,)).fetchone()['ok']
   assert not conn.execute("select has_table_privilege(%s,'private.report_publication_key','select') ok",(role,)).fetchone()['ok']
  assert conn.execute("select bool_and(relrowsecurity) ok from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('report_publications','report_publication_key')").fetchone()['ok']
  checks.append('credentials/key remain private with RLS and restricted function grants')
 finally:conn.rollback()
print(json.dumps({'passed':True,'checks':checks,'all_test_changes_rolled_back':True},indent=2))
