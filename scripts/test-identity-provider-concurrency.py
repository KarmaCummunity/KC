"""Local synthetic PostgreSQL only: parallel provider approvals reserve one identity."""
import concurrent.futures
import ipaddress
import os
import time
import uuid

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.types.json import Jsonb


def race(rollback=False):
    url = os.environ['DB_URL']
    host = conninfo_to_dict(url).get('host', '')
    assert host in ('localhost', '127.0.0.1', '::1') or host.startswith('/'), 'loopback or Unix socket connection required'
    admin = psycopg.connect(url, autocommit=True, options='-c statement_timeout=5000')
    address, database = admin.execute('select host(inet_server_addr()),current_database()').fetchone()
    # A loopback connection to the local Docker stack reports its private container IP.
    assert (not address or ipaddress.ip_address(address).is_private) and database.startswith('kc_'), 'local scratch database required'
    users = [uuid.uuid4(), uuid.uuid4()]
    attempts = [uuid.uuid4(), uuid.uuid4()]
    tag = uuid.uuid4().hex
    identity_hash = tag * 2
    connections = [psycopg.connect(url, options='-c statement_timeout=5000 -c lock_timeout=4000') for _ in users]
    events = [tag + str(i) for i in range(2)]
    try:
        for user in users:
            admin.execute("insert into auth.users(id,email,raw_app_meta_data) values(%s,%s,'{\"provider\":\"google\"}')", (user, str(user) + '@synthetic.example.test'))
        for i in range(2):
            admin.execute("insert into public.identity_verifications(id,user_id,provider,provider_session_id,status) values(%s,%s,'didit',%s,'in_progress')", (attempts[i], users[i], events[i]))

        def decide(i):
            payload = dict(type='identity.decided', provider_session_id=events[i], outcome='approved', document_type='il_id_card', document_country='ISR', document_expires_on='2099-01-01', date_of_birth='1990-01-01', identity_hash=identity_hash, name_match=True)
            return connections[i].execute("select event_status,event_error_code from public.identity_verification_apply('didit',%s,%s)", (events[i], Jsonb(payload))).fetchone()

        first_result = decide(0)
        assert first_result == ('processed', None), first_result

        def contender():
            result = decide(1)
            connections[1].commit()
            return result

        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            future = pool.submit(contender)
            for _ in range(150):
                wait = admin.execute('select wait_event_type from pg_stat_activity where pid=%s', (connections[1].info.backend_pid,)).fetchone()
                if wait and wait[0] == 'Lock':
                    break
                assert not future.done(), 'contender must actually wait on the hash conflict'
                time.sleep(.01)
            else:
                raise AssertionError('hash lock wait not observed')
            connections[0].rollback() if rollback else connections[0].commit()
            assert future.result(timeout=6) == ('processed', None)
        levels = [admin.execute('select verification_level from public.users where id=%s', (user,)).fetchone()[0] for user in users]
        statuses = [admin.execute('select status,decision_reason_code from public.identity_verifications where id=%s', (attempt,)).fetchone() for attempt in attempts]
        owner = admin.execute('select user_id from kc_private.identity_hashes where identity_hash=%s', (identity_hash,)).fetchone()[0]
        assert levels == ([0, 2] if rollback else [2, 0]), levels
        assert owner == users[1 if rollback else 0], owner
        assert statuses == ([('in_progress', None), ('approved', None)] if rollback else [('approved', None), ('declined', 'identity_already_used')]), statuses
        event_count = admin.execute('select count(*) from billing.webhook_events where provider_event_id=any(%s)', (events,)).fetchone()[0]
        assert event_count == (1 if rollback else 2), event_count
        print(f'PASS provider/provider rollback={rollback}: actual lock wait; levels={levels}; statuses={statuses}; single hash owner; transactional event receipt')
    finally:
        for connection in connections:
            connection.rollback()
            connection.close()
        for user in users:
            admin.execute('delete from auth.users where id=%s', (user,))
        admin.execute('delete from billing.webhook_events where provider_event_id=any(%s)', (events,))
        admin.close()


if __name__ == '__main__':
    for rollback in (False, True):
        race(rollback)
