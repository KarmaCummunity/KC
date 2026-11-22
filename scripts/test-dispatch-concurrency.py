#!/usr/bin/env python3
"""Local-only two-connection dispatch proof. Requires psycopg and a migrated scratch DB.
DB_URL must point to a local server and a database named kc_*; never DEV/PROD.
"""
import concurrent.futures
import ipaddress
import json
import os
import time
import uuid
import psycopg
from psycopg.types.json import Jsonb

url = os.environ['DB_URL']
a = psycopg.connect(url, autocommit=True)
addr, name = a.execute("select host(inet_server_addr()),current_database()").fetchone()
if (addr and not ipaddress.ip_address(addr).is_private) or not name.startswith('kc_'):
    raise RuntimeError('local scratch database required')
if a.execute('select count(*) from kc_private.dispatch_gate').fetchone()[0]:
    raise RuntimeError('scratch dispatch gate must start closed')
actor, recipient, device, chat = [uuid.uuid4() for _ in range(4)]
origins = []
checks = 0

def check(value, label):
    global checks
    if not value:
        raise AssertionError(label)
    checks += 1
    print('ok', checks, '-', label, flush=True)

def emit(conn, reserved=None):
    payload = dict(kind='chat_message', recipient_id=str(recipient), actor_id=str(actor),
                   entity=dict(type='chat', id=str(chat)), data=dict(message_id=str(uuid.uuid4()), chat_id=str(chat)))
    if reserved is None:
        result = conn.execute("select kc_private.outbox_enqueue('notification',%s)", (Jsonb(payload),)).fetchone()[0]
    else:
        result = conn.execute("insert into kc_private.outbox_events(id,topic,payload) overriding system value values(%s,'notification',%s) returning id", (reserved, Jsonb(payload))).fetchone()[0]
    origins.append(result)
    return result

b = psycopg.connect(url)
try:
    for who in (actor, recipient):
        a.execute("insert into auth.users(id,email,raw_app_meta_data) values(%s,%s,'{\"provider\":\"google\"}')", (who, str(who)+'@dispatch.example.test'))
    a.execute("insert into public.user_devices(id,user_id,platform,push_token) values(%s,%s,'ios',%s)", (device,recipient,'synthetic-'+str(device)))
    origin = emit(a)
    scope = Jsonb(dict(event_ids=[origin]))
    b.execute('begin')
    check(b.execute('select kc_private.dispatch_deliver(%s)', (scope,)).fetchone()[0] == 1, 'first transaction delivers origin')
    check(a.execute('select kc_private.dispatch_deliver(%s)', (scope,)).fetchone()[0] == 0, 'concurrent origin worker skips locked origin')
    b.commit()
    check(a.execute('select count(*) from kc_private.dispatch_jobs where origin_event_id=%s',(origin,)).fetchone()[0] == 1, 'concurrent delivery yields one durable device job')
    b.execute('begin')
    first = b.execute("select * from kc_private.dispatch_claim(%s,'pending')", (scope,)).fetchall()
    check(len(first) == 1, 'first transaction claims one device job')
    check(a.execute("select count(*) from kc_private.dispatch_claim(%s,'pending')", (scope,)).fetchone()[0] == 0, 'concurrent job worker skips locked lease')
    b.commit()
    check(a.execute("select count(*) from kc_private.dispatch_claim(%s,'pending')", (scope,)).fetchone()[0] == 0, 'committed live lease remains exclusive')

    # A preactivation insert must finish before activation's table-lock barrier.
    b.execute('begin')
    old = emit(b)
    reserved = a.execute("select nextval(pg_get_serial_sequence('kc_private.outbox_events','id'))").fetchone()[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        def activate():
            with psycopg.connect(url, autocommit=True) as c:
                return c.execute("select kc_private.dispatch_activate('two-connection synthetic proof')").fetchone()[0]
        future = pool.submit(activate)
        time.sleep(0.2)
        check(not future.done(), 'activation waits for preexisting outbox writer')
        b.commit()
        future.result(timeout=5)
    check(a.execute('select count(*) from kc_private.dispatch_admissions where origin_event_id=%s',(old,)).fetchone()[0] == 0, 'preactivation transaction is not admitted')
    new = emit(a, reserved)
    check(a.execute('select count(*) from kc_private.dispatch_admissions where origin_event_id=%s',(new,)).fetchone()[0] == 1, 'new insertion with earlier-reserved id follows epoch, not max-id arithmetic')
    auto = Jsonb(dict(automatic=True))
    check(a.execute('select kc_private.dispatch_deliver(%s)',(auto,)).fetchone()[0] == 1, 'automatic mode delivers new admitted event only')
    js = a.execute("select * from kc_private.dispatch_claim(%s,'pending')",(auto,)).fetchall()
    check(len(js) == 1, 'automatic mode claims only current epoch job')
    batch = Jsonb([dict(id=j[0]['id'],lease_id=j[0]['lease_id']) for j in js])
    a.execute('select kc_private.dispatch_deactivate()')
    try:
        a.execute('select * from kc_private.dispatch_begin_send(%s,%s)',(auto,batch))
    except psycopg.Error:
        pass
    else:
        raise AssertionError('closed gate authorised POST')
    check(a.execute("select count(*) from kc_private.dispatch_jobs where phase='sending'").fetchone()[0] == 0, 'closing gate after claim prevents POST permission')
    a.execute("select kc_private.dispatch_activate('race qualification epoch')")
    current = emit(a)
    a.execute('select kc_private.dispatch_deliver(%s)',(auto,))
    fresh = a.execute("select * from kc_private.dispatch_claim(%s,'pending')",(auto,)).fetchall()
    check(len(fresh)==1, 'new epoch has one fresh automatic job')
    fresh_batch = Jsonb([dict(id=j[0]['id'],lease_id=j[0]['lease_id']) for j in fresh])
    b.execute('begin')
    check(len(b.execute('select * from kc_private.dispatch_begin_send(%s,%s)',(auto,fresh_batch)).fetchall())==1,
          'begin-send transaction grants one synthetic POST permission')
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        def deactivate():
            with psycopg.connect(url, autocommit=True) as c:
                c.execute('select kc_private.dispatch_deactivate()')
        future = pool.submit(deactivate)
        time.sleep(0.2)
        check(not future.done(), 'deactivation waits for in-progress POST-permission transaction')
        b.commit()
        future.result(timeout=5)
    check(a.execute('select count(*) from kc_private.dispatch_gate').fetchone()[0]==0,
          'deactivation finishes after permission transaction commits')
    accepted = Jsonb([dict(id=j[0]['id'],lease_id=j[0]['lease_id'],state='accepted',ticket_id='synthetic-race-ticket') for j in fresh])
    a.execute('select kc_private.dispatch_settle(%s,%s)',(auto,accepted))
    check(a.execute("select count(*) from kc_private.dispatch_jobs where ticket_id='synthetic-race-ticket' and phase='receipt'").fetchone()[0]==1,
          'already-authorised request can persist its accepted ticket after gate closes')

finally:
    b.rollback()
    b.close()
    a.execute('select kc_private.dispatch_deactivate()')
    a.execute('delete from kc_private.dispatch_jobs where recipient_id=%s',(recipient,))
    a.execute('delete from kc_private.dispatch_admissions where origin_event_id=any(%s)',(origins,))
    a.execute('delete from kc_private.outbox_events where id=any(%s)',(origins,))
    a.execute('delete from public.users where id=any(%s)',([actor,recipient],))
    a.execute('delete from auth.users where id=any(%s)',([actor,recipient],))
    a.close()
print('1..'+str(checks))
